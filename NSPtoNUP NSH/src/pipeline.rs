//! The five steps of NSP → NUP (nxpatch reads the NSP directly, no unpacking first):
//! identify contents → nxpatch extracts exefs/romfs (base game, update, DLC) → read nacp → cover → nup pack

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::cover;
use crate::error::{AppError, Arg, Msg, Result};
use crate::nxpatch;
use crate::paths;
use crate::tools::{self, Cancel, Tool};

/// The five steps; indices match the UI (ui/state/steps.ts)
#[derive(Clone, Copy)]
pub enum Step {
    Identify = 0,
    Program = 1,
    Metadata = 2,
    Cover = 3,
    Pack = 4,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event {
    StepStarted { step: u8 },
    StepFinished { step: u8, detail: Msg },
    /// null means progress is indeterminate
    Progress { value: Option<f64> },
    /// Tool output (not translated)
    Log { line: String },
    /// Log written by the App itself (translated by the UI)
    LogMsg { msg: Msg },
}

/// Update or DLC packed together with the base game
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Extra {
    /// update / dlc
    pub kind: String,
    pub nsp: String,
    /// cnmt version (nxpatch picks the update's directory name in the NUP; this is for display only)
    pub version: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    pub nsp: String,
    /// Update (at most one) and DLC
    #[serde(default)]
    pub extras: Vec<Extra>,
    pub keys: String,
    /// Optional: title.keys (used when the NSP has no usable common .tik)
    pub title_keys: Option<String>,
    pub output_directory: String,
    /// Old file overwritten on reconversion
    pub previous_output: Option<String>,
    pub name: Option<String>,
    pub publisher: Option<String>,
    pub display_version: Option<String>,
    #[serde(default)]
    pub localized_names: BTreeMap<String, String>,
    pub cover: Option<String>,
    pub auto_cover: bool,
    pub cover_destination: String,
    pub cleanup: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub nup: String,
    pub nup_size: u64,
    pub title_id: Option<String>,
    pub name: String,
    pub publisher: Option<String>,
    pub display_version: Option<String>,
    pub localized_names: BTreeMap<String, String>,
    pub cover: Option<String>,
    pub cover_downloaded: bool,
    pub warnings: Vec<Msg>,
}

pub struct Pipeline<'a> {
    input: Input,
    emit: &'a (dyn Fn(Event) + Sync),
    cancel: &'a Cancel,
    work_dir: PathBuf,
}

impl<'a> Pipeline<'a> {
    pub fn new(input: Input, emit: &'a (dyn Fn(Event) + Sync), cancel: &'a Cancel) -> Pipeline<'a> {
        let work_dir = paths::get().work_root().join(paths::unique_name("job"));
        Pipeline { input, emit, cancel, work_dir }
    }

    pub fn run(&self) -> Result<Output> {
        std::fs::create_dir_all(&self.work_dir)?;
        let result = self.steps();
        if self.input.cleanup {
            let _ = std::fs::remove_dir_all(&self.work_dir);
        }
        result
    }

    fn steps(&self) -> Result<Output> {
        let input = &self.input;
        let nsp = PathBuf::from(&input.nsp);
        let keys = PathBuf::from(&input.keys);
        let title_keys = input.title_keys.as_ref().map(PathBuf::from);
        let update = input.extras.iter().find(|e| e.kind == "update");
        let dlcs: Vec<&Extra> = input.extras.iter().filter(|e| e.kind == "dlc").collect();
        self.check_disk_space()?;
        let dump_dir = self.work_dir.join("dump");

        // ① Identify: confirm the base is a base game (updates / DLC were identified on add; ownership is rechecked on
        // extract)
        self.begin(Step::Identify)?;
        let base = nxpatch::identify_one(&nsp, &keys)?;
        match base.kind.as_str() {
            "base" => {}
            "update" => return Err(AppError::with("error_is_update_add_base", [base.title_id.clone().into()])),
            _ => return Err(AppError::with("error_is_dlc_add_base", [base.title_id.clone().into()])),
        }
        let mut parts: Vec<Arg> = vec![Msg::with("step_identify_detail_base", [base.title_id.clone().into()]).into()];
        if let Some(update) = update {
            parts.push(Msg::with("step_identify_detail_update", [(update.version >> 16).to_string().into()]).into());
        }
        if !dlcs.is_empty() {
            parts.push(Msg::with("content_dlc_count", [dlcs.len().to_string().into()]).into());
        }
        self.finish(Step::Identify, Msg::with("text_raw", [Arg::Join { join: parts, sep: " + ".to_owned() }]));

        // ② Extract: nxpatch writes base/, updates/<version>/, dlc/<Title ID>/0/ from the NSP, reporting real progress
        self.begin(Step::Program)?;
        let dlc_paths: Vec<&str> = dlcs.iter().map(|d| d.nsp.as_str()).collect();
        let args = nxpatch::extract_args(
            &keys,
            title_keys.as_deref(),
            &input.nsp,
            update.map(|u| u.nsp.as_str()),
            &dlc_paths,
            &dump_dir,
        );
        let total = AtomicU64::new(0);
        self.run_tool(Tool::Nxpatch, &args, "error_extract_failed", Some(&|line: &str| {
            let mut fields = line.split('\t');
            match fields.next() {
                Some("total") => {
                    total.store(fields.next().and_then(|v| v.parse().ok()).unwrap_or(0), Ordering::SeqCst);
                    true
                }
                Some("progress") => {
                    let all = total.load(Ordering::SeqCst);
                    if let (Some(done), true) = (fields.next().and_then(|v| v.parse::<u64>().ok()), all > 0) {
                        (self.emit)(Event::Progress { value: Some((done as f64 / all as f64).min(0.99)) });
                    }
                    true
                }
                // part <base|update|dlc> <exefs|romfs> <file count> <revision or Title ID>
                Some("part") => {
                    self.log_msg(nxpatch::describe_part(&line.split('\t').collect::<Vec<_>>()));
                    true
                }
                _ => false,
            }
        }))?;
        if !dump_dir.join("base/exefs/main").is_file() {
            return Err(AppError::key("error_exefs_main_missing"));
        }
        self.finish(Step::Program, Msg::raw(format_bytes(directory_size(&dump_dir, false))));

        // ③ Read game info: with an update, its nacp wins (name, version update)
        self.begin(Step::Metadata)?;
        let control_nsp = update.map(|u| PathBuf::from(&u.nsp)).unwrap_or_else(|| nsp.clone());
        let meta = nxpatch::read_control(&control_nsp, &keys, title_keys.as_deref(), &self.work_dir, Some(self.cancel))?;
        let title_id = Some(base.title_id.clone());
        let nacp = meta.nacp.as_ref();
        let stem = nsp.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "game".to_owned());
        let name = non_empty(&input.name).or_else(|| nacp.and_then(|n| n.primary_name())).unwrap_or(stem);
        let publisher = non_empty(&input.publisher).or_else(|| nacp.and_then(|n| n.primary_publisher()));
        let version = non_empty(&input.display_version).or_else(|| nacp.and_then(|n| n.display_version.clone()));
        let localized = if input.localized_names.is_empty() {
            nacp.map(|n| n.localized_names()).unwrap_or_default()
        } else {
            input.localized_names.clone()
        };
        let summary = [Some(name.clone()), version.as_ref().map(|v| format!("v{v}")), publisher.clone()];
        self.finish(Step::Metadata, Msg::raw(summary.into_iter().flatten().collect::<Vec<_>>().join(" · ")));

        // ④ Cover
        self.begin(Step::Cover)?;
        let mut warnings = Vec::new();
        let mut cover = input.cover.clone().filter(|c| Path::new(c).is_file());
        let mut downloaded = false;
        if cover.is_some() {
            self.finish(Step::Cover, Msg::new("step_cover_existing"));
        } else if let (true, Some(title_id)) = (input.auto_cover, &title_id) {
            match cover::download(title_id, Path::new(&input.cover_destination)) {
                Ok(()) => {
                    cover = Some(input.cover_destination.clone());
                    downloaded = true;
                    self.finish(Step::Cover, Msg::new("step_cover_downloaded"));
                }
                Err(error) => {
                    warnings.push(Msg::new("warning_cover_not_found"));
                    self.log_msg(Msg::with("log_cover_error", [error.msg.into()]));
                    self.finish(Step::Cover, Msg::new("step_cover_not_found"));
                }
            }
        } else {
            warnings.push(Msg::new("warning_cover_not_set"));
            self.finish(Step::Cover, Msg::new("step_cover_not_set"));
        }

        // ⑤ Pack
        self.begin(Step::Pack)?;
        let output_dir = PathBuf::from(&input.output_directory);
        std::fs::create_dir_all(&output_dir)?;
        let output = self.output_path(&output_dir, &name);
        // The bundled nup has no zstandard, so content is written as-is without compression
        let mut pack_args = vec!["pack".to_owned(), dump_dir.display().to_string(), output.display().to_string()];
        pack_args.extend(["--name".to_owned(), name.clone()]);
        if let Some(version) = &version {
            pack_args.extend(["--display-version".to_owned(), version.clone()]);
        }
        if let Some(publisher) = &publisher {
            pack_args.extend(["--publisher".to_owned(), publisher.clone()]);
        }
        for (tag, value) in &localized {
            pack_args.extend(["--lang-name".to_owned(), format!("{tag}={value}")]);
        }
        if let Some(cover) = &cover {
            pack_args.extend(["--icon".to_owned(), cover.clone()]);
        }
        // Take the larger of two sources (the UI only moves forward):
        //   ① NUP size written ÷ size of content to pack: uncompressed, so roughly equal; changes steadily
        //   ② the percentage nup reports (by files done): "pack: 23/44 files (52%)"
        // Progress lines are only used for computation, not written to the log
        let pack_total = directory_size(&dump_dir, false) + cover.as_ref().map(|c| size(Path::new(c))).unwrap_or(0);
        self.measuring(pack_total, || size_allocated(&output), || {
            self.run_tool(Tool::Nup, &pack_args, "error_pack_failed", Some(&|line: &str| {
                // No compression is expected; keep nup's "zstandard not installed" notice out of the log so it won't
                // look like an error
                if line.contains("zstandard not installed") {
                    return true;
                }
                match parse_pack_percent(line) {
                    Some(percent) => {
                        (self.emit)(Event::Progress { value: Some((percent / 100.0).min(0.99)) });
                        true
                    }
                    None => false,
                }
            }))
        })?;
        (self.emit)(Event::Progress { value: None });
        self.run_tool(Tool::Nup, &["verify".to_owned(), output.display().to_string()], "error_verify_failed", None)?;
        let file_name = output.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        self.finish(Step::Pack, Msg::raw(file_name));

        Ok(Output {
            nup_size: size(&output),
            nup: output.display().to_string(),
            title_id,
            name,
            publisher,
            display_version: version,
            localized_names: localized,
            cover,
            cover_downloaded: downloaded,
            warnings,
        })
    }

    // MARK: - Steps

    fn begin(&self, step: Step) -> Result<()> {
        self.cancel.check()?;
        (self.emit)(Event::StepStarted { step: step as u8 });
        (self.emit)(Event::Progress { value: None });
        Ok(())
    }

    fn finish(&self, step: Step, detail: Msg) {
        (self.emit)(Event::StepFinished { step: step as u8, detail });
    }

    fn log(&self, line: String) {
        (self.emit)(Event::Log { line });
    }

    fn log_msg(&self, msg: Msg) {
        (self.emit)(Event::LogMsg { msg });
    }

    /// Runs a long tool, measuring output size every 0.5 s to report progress (up to 99%; the step's end fills it)
    fn measuring(&self, total: u64, measure: impl Fn() -> u64 + Sync, work: impl FnOnce() -> Result<()>) -> Result<()> {
        let done = AtomicBool::new(false);
        std::thread::scope(|scope| {
            scope.spawn(|| {
                if total == 0 {
                    return;
                }
                while !done.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(500));
                    if done.load(Ordering::SeqCst) {
                        break;
                    }
                    let value = measure();
                    // With no output yet, stay "indeterminate" and let the UI show simulated progress
                    if value > 0 {
                        (self.emit)(Event::Progress { value: Some((value as f64 / total as f64).min(0.99)) });
                    }
                }
            });
            let result = work();
            done.store(true, Ordering::SeqCst);
            result
        })
    }

    /// on_line returns true when it handled the line (e.g. a progress line), so it isn't logged; failure is the title
    /// key
    fn run_tool(&self, tool: Tool, args: &[String], failure: &str, on_line: Option<&dyn Fn(&str) -> bool>) -> Result<()> {
        self.log(format!("$ {} {}", tool.name(), tools::describe(args)));
        let result = tools::run(tool, args, Some(self.cancel), &mut |line| {
            if on_line.is_some_and(|f| f(line)) {
                return;
            }
            self.log(format!("[{}] {line}", tool.name()));
        })?;
        if !result.success() {
            return Err(result.failure(failure));
        }
        Ok(())
    }

    // MARK: - Files

    fn check_disk_space(&self) -> Result<()> {
        let Ok(available) = fs4::available_space(&self.work_dir) else { return Ok(()) };
        let nsp_size = size(Path::new(&self.input.nsp)) + self.input.extras.iter().map(|e| size(Path::new(&e.nsp))).sum::<u64>();
        // Peak: extracted exefs/romfs + the written NUP (updates carry a full romfs, so content can exceed the NSP)
        let factor = if self.input.extras.iter().any(|e| e.kind == "update") { 2.5 } else { 2.2 };
        let needed = (nsp_size as f64 * factor) as u64;
        if available < needed {
            return Err(AppError::with("error_disk_space", [format_bytes(needed).into(), format_bytes(available).into()]));
        }
        Ok(())
    }

    fn output_path(&self, dir: &Path, name: &str) -> PathBuf {
        let safe: String = name.chars().map(|c| if "/:\\?%*|\"<>".contains(c) { ' ' } else { c }).collect();
        let safe = safe.trim();
        let base = if safe.is_empty() { "game" } else { safe };
        let mut candidate = dir.join(format!("{base}.nup"));

        // Reconversion: overwrite this game's previous output
        if let Some(previous) = &self.input.previous_output
            && Path::new(previous) == candidate
        {
            let _ = std::fs::remove_file(previous);
            return candidate;
        }
        let mut index = 2;
        while candidate.exists() {
            candidate = dir.join(format!("{base} ({index}).nup"));
            index += 1;
        }
        candidate
    }
}

fn parse_pack_percent(line: &str) -> Option<f64> {
    // "pack: 23/44 files (52%)"
    let rest = line.strip_prefix("pack: ")?;
    let (counts, percent) = rest.split_once(" files (")?;
    let (a, b) = counts.split_once('/')?;
    if a.parse::<u64>().is_err() || b.parse::<u64>().is_err() {
        return None;
    }
    percent.strip_suffix("%)")?.parse().ok()
}

fn non_empty(value: &Option<String>) -> Option<String> {
    value.as_ref().map(|v| v.trim().to_owned()).filter(|v| !v.is_empty())
}

fn walk(dir: &Path, f: &mut dyn FnMut(&Path)) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(t) if t.is_dir() => walk(&path, f),
            Ok(_) => f(&path),
            Err(_) => {}
        }
    }
}

pub fn size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/// Actual disk usage: tools first set a file to its full size and then fill it in,
/// so file size doesn't reflect write progress, but actual usage does
fn size_allocated(path: &Path) -> u64 {
    let Ok(meta) = std::fs::metadata(path) else { return 0 };
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        meta.blocks() * 512
    }
    #[cfg(not(unix))]
    {
        meta.len()
    }
}

fn directory_size(dir: &Path, allocated: bool) -> u64 {
    let mut total = 0;
    walk(dir, &mut |path| total += if allocated { size_allocated(path) } else { size(path) });
    total
}

/// Matches macOS ByteCountFormatter (.file): decimal units
pub fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["bytes", "KB", "MB", "GB", "TB"];
    if bytes < 1000 {
        return format!("{bytes} bytes");
    }
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1000.0 && unit < UNITS.len() - 1 {
        value /= 1000.0;
        unit += 1;
    }
    // KB without decimals, MB with one, GB and above with two; trailing zeros dropped
    let digits = unit.saturating_sub(1).min(2);
    let text = format!("{value:.digits$}");
    let text = if text.contains('.') { text.trim_end_matches('0').trim_end_matches('.').to_owned() } else { text };
    format!("{text} {}", UNITS[unit])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pack_progress() {
        assert_eq!(parse_pack_percent("pack: 23/44 files (52%)"), Some(52.0));
        assert_eq!(parse_pack_percent("pack: done"), None);
    }

    #[test]
    fn formats_bytes_like_finder() {
        assert_eq!(format_bytes(17_690_000_000), "17.69 GB");
        assert_eq!(format_bytes(594_000_000), "594 MB");
        assert_eq!(format_bytes(594_420_000), "594.4 MB");
    }
}
