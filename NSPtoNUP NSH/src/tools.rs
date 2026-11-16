//! Command-line tools bundled with the App: locate, run, read output line by line, cancel.

use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::error::{AppError, Msg, Result};
use crate::nxpatch;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tool {
    /// Reads and decrypts NSPs (base game, update, DLC), based on LibHac; replaces nsz and hactool
    Nxpatch,
    Nup,
}

impl Tool {
    pub const ALL: [Tool; 2] = [Tool::Nxpatch, Tool::Nup];

    pub fn name(self) -> &'static str {
        match self {
            Tool::Nxpatch => "nxpatch",
            Tool::Nup => "nup",
        }
    }

    fn file_name(self) -> String {
        if cfg!(windows) { format!("{}.exe", self.name()) } else { self.name().to_owned() }
    }

    /// Tool location, searched in order:
    ///   1. Packaged macOS: <App>.app/Contents/Resources/tools/
    ///   2. Packaged Windows / Linux: tools/ next to the executable
    ///   3. Development (nsh run / nsh test): tools/<platform>/ in the project (from scripts/fetch-tools.sh)
    pub fn path(self) -> Option<PathBuf> {
        tool_dirs().into_iter().map(|dir| dir.join(self.file_name())).find(|path| path.is_file())
    }
}

/// Directory name of the current platform, matching scripts/fetch-tools.sh: macos-arm64, windows-x64, linux-x64 …
pub fn platform_dir() -> String {
    let os = std::env::consts::OS;
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        other => other,
    };
    format!("{os}-{arch}")
}

fn tool_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(exe_dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) {
        dirs.push(exe_dir.join("../Resources/tools"));
        dirs.push(exe_dir.join("tools"));
    }
    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tools").join(platform_dir()));
    dirs
}

// MARK: - Cancellation

/// Cancellation flag for one conversion; running tools are killed (along with their child processes)
#[derive(Default)]
pub struct Cancel {
    flag: AtomicBool,
}

impl Cancel {
    pub fn new() -> Arc<Cancel> {
        Arc::new(Cancel::default())
    }

    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }

    pub fn check(&self) -> Result<()> {
        if self.is_cancelled() { Err(AppError::cancelled()) } else { Ok(()) }
    }
}

// MARK: - Running

pub struct ToolResult {
    pub status: Option<i32>,
    /// Last few lines of output (redacted), for error messages
    pub tail: Vec<String>,
}

impl ToolResult {
    pub fn success(&self) -> bool {
        self.status == Some(0)
    }

    /// Failure text: title (key) + reason. nxpatch prints "nxpatch-error <code> <detail> <English message>" to stderr,
    /// translated by error code; for other tools the last three output lines are used (verbatim)
    pub fn failure(&self, title: &str) -> AppError {
        let detail = self
            .tail
            .iter()
            .rev()
            .find_map(|line| line.strip_prefix("nxpatch-error\t"))
            .map(nxpatch::error_line)
            .or_else(|| {
                let start = self.tail.len().saturating_sub(3);
                let text = self.tail[start..].join("\n");
                (!text.is_empty()).then(|| Msg::raw(text))
            });
        AppError::msg(Msg::with_detail(Msg::new(title), detail))
    }
}

/// Runs a tool and waits for it. stdout and stderr are split into lines on \n or \r, redacted, and passed to on_line
pub fn run(tool: Tool, args: &[String], cancel: Option<&Cancel>, on_line: &mut dyn FnMut(&str)) -> Result<ToolResult> {
    let path = tool.path().ok_or_else(|| AppError::with("error_tool_missing", [tool.name().into()]))?;
    let mut command = Command::new(&path);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // Tools run outside the App's data directory and don't depend on the current directory
    if let Some(dir) = path.parent() {
        command.current_dir(dir);
    }
    configure(&mut command);
    let mut child =
        command.spawn().map_err(|e| AppError::with("error_tool_launch", [tool.name().into(), e.to_string().into()]))?;

    let (sender, receiver) = mpsc::channel::<String>();
    let readers: Vec<_> = [child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>),
        child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>)]
    .into_iter()
    .flatten()
    .map(|stream| {
        let sender = sender.clone();
        std::thread::spawn(move || read_lines(stream, sender))
    })
    .collect();
    drop(sender);

    let mut tail: Vec<String> = Vec::new();
    let mut killed_at: Option<Instant> = None;
    loop {
        match receiver.recv_timeout(Duration::from_millis(200)) {
            Ok(raw) => {
                let Some(line) = sanitize(&raw) else { continue };
                tail.push(line.clone());
                if tail.len() > 40 {
                    tail.remove(0);
                }
                on_line(&line);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if cancel.is_some_and(Cancel::is_cancelled) {
            match killed_at {
                None => {
                    terminate(&mut child, false);
                    killed_at = Some(Instant::now());
                }
                // Force-kill if it hasn't exited within 2 seconds
                Some(at) if at.elapsed() > Duration::from_secs(2) => terminate(&mut child, true),
                _ => {}
            }
        }
    }
    for reader in readers {
        let _ = reader.join();
    }
    let status = child.wait()?;
    if let Some(cancel) = cancel {
        cancel.check()?;
    }
    Ok(ToolResult { status: status.code(), tail })
}

fn read_lines(mut stream: Box<dyn Read + Send>, sender: mpsc::Sender<String>) {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 64 * 1024];
    loop {
        let read = match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        buffer.extend_from_slice(&chunk[..read]);
        while let Some(index) = buffer.iter().position(|&b| b == b'\n' || b == b'\r') {
            let line: Vec<u8> = buffer.drain(..=index).collect();
            let text = String::from_utf8_lossy(&line[..line.len() - 1]).into_owned();
            if !text.is_empty() && sender.send(text).is_err() {
                return;
            }
        }
    }
    if !buffer.is_empty() {
        let _ = sender.send(String::from_utf8_lossy(&buffer).into_owned());
    }
}

#[cfg(unix)]
fn configure(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    // Separate process group: on cancel, child processes unpacked by PyInstaller are killed too
    command.process_group(0);
}

#[cfg(windows)]
fn configure(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    // CREATE_NO_WINDOW: don't pop up a console window
    command.creation_flags(0x0800_0000);
}

#[cfg(unix)]
fn terminate(child: &mut Child, force: bool) {
    let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
    unsafe {
        libc::kill(-(child.id() as i32), signal);
    }
}

#[cfg(windows)]
fn terminate(child: &mut Child, _force: bool) {
    let _ = child.kill();
}

// MARK: - Log redaction

/// Keeps keys out of the log; returning None drops the whole line
pub fn sanitize(line: &str) -> Option<String> {
    // Tools may print unrecognized keys together with their values
    if line.contains("(value \"") {
        return None;
    }
    if !line.to_lowercase().contains("key") {
        return Some(line.to_owned());
    }
    let mut out = String::with_capacity(line.len());
    let mut run = String::new();
    for c in line.chars() {
        if c.is_ascii_hexdigit() {
            run.push(c);
            continue;
        }
        flush_hex(&mut out, &mut run);
        out.push(c);
    }
    flush_hex(&mut out, &mut run);
    Some(out)
}

fn flush_hex(out: &mut String, run: &mut String) {
    if run.len() >= 32 { out.push_str("<hidden>") } else { out.push_str(run) }
    run.clear();
}

/// Don't show titlekeys in the log
pub fn describe(args: &[String]) -> String {
    args.iter()
        .map(|arg| {
            if arg.starts_with("--titlekey=") {
                "--titlekey=<hidden>".to_owned()
            } else if arg.contains(' ') {
                format!("\"{arg}\"")
            } else {
                arg.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_hides_key_values() {
        assert_eq!(sanitize("[WARN]: Failed to match key \"x\", (value \"00\")"), None);
        let hex = "0123456789abcdef0123456789abcdef";
        assert_eq!(sanitize(&format!("titlekey {hex}")).unwrap(), "titlekey <hidden>");
        assert_eq!(sanitize(&format!("file {hex}.nca")).unwrap(), format!("file {hex}.nca"));
    }

    #[test]
    fn describe_hides_titlekey() {
        let args = vec!["-k".to_owned(), "--titlekey=abcd".to_owned(), "a b".to_owned()];
        assert_eq!(describe(&args), "-k --titlekey=<hidden> \"a b\"");
    }
}
