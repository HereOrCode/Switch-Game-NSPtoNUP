//! Calls into nxpatch (../tools/nxpatch, based on LibHac): reads NSPs directly, no unpacking first.
//!   identify  identify base game / update / DLC, Title ID and version (several at once)
//!   control   extract the Control NCA (control.nacp and icon)
//!   extract   extract the nup directory layout (see pipeline.rs)
//! nxpatch picks the title key: a common .tik in the NSP first, then title.keys; key values never pass through the App.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, Arg, Msg, Result};
use crate::formats::Nacp;
use crate::tools::{self, Cancel, Tool};

/// Content info of one NSP
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NspContent {
    pub path: String,
    /// base / update / dlc
    pub kind: String,
    /// 16 uppercase hex digits
    pub title_id: String,
    /// cnmt version (the high 16 bits are the revision)
    pub version: u32,
    pub size: u64,
}

impl NspContent {
    /// Title ID of the owning base game: Title ID & ~0x1FFF
    pub fn base_title_id(&self) -> String {
        base_title_id(&self.title_id)
    }
}

pub fn base_title_id(title_id: &str) -> String {
    let value = u64::from_str_radix(title_id, 16).unwrap_or(0);
    format!("{:016X}", value & !0x1FFF)
}

/// Identify result: content or failure reason
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identified {
    pub path: String,
    pub content: Option<NspContent>,
    pub error: Option<Msg>,
}

/// Error code → UI text (see ../tools/nxpatch/README.md); unknown codes show nxpatch's English message
pub fn describe(code: &str, detail: &str, message: &str) -> Msg {
    let with_detail = |key: &str| Msg::with(key, [Arg::Text(detail.to_owned())]);
    match code {
        "invalid_nsp" => Msg::new("nxpatch_error_invalid_nsp"),
        "nsz_unsupported" => Msg::new("nxpatch_error_nsz_unsupported"),
        "no_cnmt" => Msg::new("nxpatch_error_no_cnmt"),
        "bad_cnmt" => Msg::new("nxpatch_error_bad_cnmt"),
        "unsupported_type" => Msg::new("nxpatch_error_unsupported_type"),
        "not_base" if detail == "dlc" => Msg::new("nxpatch_error_not_base_dlc"),
        "not_base" => Msg::new("nxpatch_error_not_base_update"),
        "update_mismatch" => with_detail("nxpatch_error_update_mismatch"),
        "dlc_mismatch" => with_detail("nxpatch_error_dlc_mismatch"),
        "nca_not_found" if detail == "control" => Msg::new("nxpatch_error_control_nca_not_found"),
        "nca_not_found" if detail == "data" => Msg::new("nxpatch_error_data_nca_not_found"),
        "nca_not_found" => Msg::new("nxpatch_error_program_nca_not_found"),
        "missing_key" => with_detail("nxpatch_error_missing_key"),
        "missing_title_key" => with_detail("nxpatch_error_missing_title_key"),
        _ if message.is_empty() => Msg::new("error_nsp_unrecognized"),
        _ => Msg::raw(message),
    }
}

/// "<code> <detail> <English message>" (stderr nxpatch-error line minus prefix, or identify error line minus first two
/// columns)
pub fn error_line(fields: &str) -> Msg {
    let parts: Vec<&str> = fields.split('\t').collect();
    let field = |i: usize| parts.get(i).copied().unwrap_or("");
    describe(field(0), field(1), field(2))
}

fn keys_args(command: &str, keys: &Path, title_keys: Option<&Path>) -> Vec<String> {
    let mut args = vec![command.to_owned(), "-k".to_owned(), keys.display().to_string()];
    if let Some(title_keys) = title_keys {
        args.extend(["--titlekeys".to_owned(), title_keys.display().to_string()]);
    }
    args
}

/// Identifies NSPs. At most 40 paths per call (Windows limits command-line length); reads only a few KB of the Meta NCA
pub fn identify(nsps: &[PathBuf], keys: &Path, mut progress: impl FnMut(usize)) -> Result<Vec<Identified>> {
    let mut results = Vec::new();
    for chunk in nsps.chunks(40) {
        let mut args = keys_args("identify", keys, None);
        args.extend(chunk.iter().map(|p| p.display().to_string()));
        let mut lines = Vec::new();
        let result = tools::run(Tool::Nxpatch, &args, None, &mut |line| lines.push(line.to_owned()))?;
        if !result.success() {
            return Err(result.failure("error_nsp_unreadable"));
        }
        for path in chunk {
            let text = path.display().to_string();
            let fields = lines
                .iter()
                .map(|l| l.split('\t').collect::<Vec<_>>())
                .find(|f| f.len() >= 3 && f[1] == text);
            results.push(match fields {
                Some(f) if f[0] == "content" && f.len() >= 5 => match (u64::from_str_radix(f[3], 16), f[4].parse::<u32>()) {
                    (Ok(_), Ok(version)) => Identified {
                        path: text,
                        content: Some(NspContent {
                            path: path.display().to_string(),
                            kind: f[2].to_owned(),
                            title_id: f[3].to_uppercase(),
                            version,
                            size: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
                        }),
                        error: None,
                    },
                    _ => Identified { path: text, content: None, error: Some(Msg::new("error_nsp_unrecognized")) },
                },
                // error <path> <error code> <detail> <English message>
                Some(f) => Identified { path: text, content: None, error: Some(error_line(&f[2..].join("\t"))) },
                None => Identified { path: text, content: None, error: Some(Msg::new("error_nsp_unrecognized")) },
            });
        }
        progress(results.len());
    }
    Ok(results)
}

pub fn identify_one(nsp: &Path, keys: &Path) -> Result<NspContent> {
    let mut results = identify(&[nsp.to_path_buf()], keys, |_| {})?;
    let item = results.pop().ok_or_else(|| AppError::key("error_nsp_unrecognized"))?;
    item.content.ok_or_else(|| AppError::msg(item.error.unwrap_or_else(|| Msg::new("error_nsp_unrecognized"))))
}

/// Game info extracted from Control
pub struct GameMetadata {
    pub nacp: Option<Nacp>,
    /// 1:1 icon (JPEG)
    pub icon: Option<PathBuf>,
}

/// Extracts the NSP's Control NCA and reads the nacp and icon (files go in work_dir/control)
pub fn read_control(
    nsp: &Path,
    keys: &Path,
    title_keys: Option<&Path>,
    work_dir: &Path,
    cancel: Option<&Cancel>,
) -> Result<GameMetadata> {
    let dir = work_dir.join("control");
    let _ = std::fs::remove_dir_all(&dir);
    let mut args = keys_args("control", keys, title_keys);
    args.extend(["--nsp".to_owned(), nsp.display().to_string(), "--out".to_owned(), dir.display().to_string()]);
    let result = tools::run(Tool::Nxpatch, &args, cancel, &mut |_| {})?;
    if !result.success() {
        return Err(result.failure("error_control_failed"));
    }
    let nacp = std::fs::read(dir.join("control.nacp")).ok().and_then(|data| Nacp::parse(&data).ok());
    let mut icons: Vec<PathBuf> =
        std::fs::read_dir(&dir).map(|entries| entries.flatten().map(|e| e.path()).collect()).unwrap_or_default();
    icons.sort();
    let name = |p: &PathBuf| p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let icon = icons
        .iter()
        .find(|p| name(p) == "icon_AmericanEnglish.dat")
        .or_else(|| icons.iter().find(|p| name(p).starts_with("icon_")))
        .cloned();
    Ok(GameMetadata { nacp, icon })
}

/// Arguments for extract (progress handling aside from the output directory not included)
pub fn extract_args(
    keys: &Path,
    title_keys: Option<&Path>,
    base: &str,
    update: Option<&str>,
    dlcs: &[&str],
    out: &Path,
) -> Vec<String> {
    let mut args = keys_args("extract", keys, title_keys);
    args.extend(["--base".to_owned(), base.to_owned()]);
    if let Some(update) = update {
        args.extend(["--update".to_owned(), update.to_owned()]);
    }
    for dlc in dlcs {
        args.extend(["--dlc".to_owned(), (*dlc).to_owned()]);
    }
    args.extend(["--out".to_owned(), out.display().to_string()]);
    args
}

/// An extract part line (part <base|update|dlc> <exefs|romfs> <file count> <revision or Title ID>) → log text,
/// e.g. "base game romfs: 5172 files"
pub fn describe_part(fields: &[&str]) -> Msg {
    let section = fields.get(2).copied().unwrap_or("");
    let files: u64 = fields.get(3).and_then(|v| v.parse().ok()).unwrap_or(0);
    let id = fields.get(4).copied().unwrap_or("");
    let part = match fields.get(1).copied() {
        Some("update") => Msg::with("log_part_update", [id.into(), section.into()]),
        Some("dlc") => Msg::with("log_part_dlc", [id.into()]),
        _ => Msg::with("log_part_base", [section.into()]),
    };
    // log_part_files: %{1} is the file count (Msg.count), %{2} is the part
    Msg { key: "log_part_files".to_owned(), args: vec![part.into()], count: Some(files) }
}

#[cfg(test)]
mod tests {
    #[test]
    fn maps_error_codes() {
        let msg = super::error_line("missing_key\tkey_area_key_application_15\tprod.keys is missing ...");
        assert_eq!(msg.key, "nxpatch_error_missing_key");
        assert_eq!(super::error_line("unknown\t\tSomething odd").key, "text_raw");
        assert_eq!(super::error_line("not_base\tdlc\t").key, "nxpatch_error_not_base_dlc");
    }

    #[test]
    fn groups_by_base_title_id() {
        assert_eq!(super::base_title_id("0100A00019DE0800"), "0100A00019DE0000");
        assert_eq!(super::base_title_id("0100A00019DE1001"), "0100A00019DE0000");
        assert_eq!(super::base_title_id("0100A00019DE0000"), "0100A00019DE0000");
    }
}
