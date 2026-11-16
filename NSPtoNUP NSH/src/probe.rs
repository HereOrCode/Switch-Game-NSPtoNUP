//! Fast game info on NSP import: nxpatch reads the Meta and Control NCAs straight from the NSP, without unpacking it.
//! Also expands selected folders (finding the NSPs inside).

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, Result};
use crate::nxpatch;
use crate::paths;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    /// Title ID of the base game (an update patch also returns its base game's)
    pub title_id: Option<String>,
    pub name: Option<String>,
    pub publisher: Option<String>,
    pub display_version: Option<String>,
    pub localized_names: BTreeMap<String, String>,
    /// Where the 1:1 icon (JPEG) is saved, chosen by the caller
    pub icon: Option<String>,
}

/// Reads game info; the icon is written to icon_destination (not saved when None).
/// allow_patch: read an update patch's own info (the update's display version etc.)
pub fn probe(
    nsp: &Path,
    keys: &Path,
    title_keys: Option<&Path>,
    icon_destination: Option<&Path>,
    allow_patch: bool,
) -> Result<ProbeResult> {
    let content = nxpatch::identify_one(nsp, keys)?;
    match content.kind.as_str() {
        "base" => {}
        "update" if allow_patch => {}
        "update" => {
            return Err(AppError::with("error_probe_is_update", [content.title_id.clone().into()]));
        }
        _ => {
            return Err(AppError::with("error_probe_is_dlc", [content.title_id.clone().into()]));
        }
    }

    let work_dir = paths::get().work_root().join(paths::unique_name("probe"));
    std::fs::create_dir_all(&work_dir)?;
    let result = (|| {
        let meta = nxpatch::read_control(nsp, keys, title_keys, &work_dir, None)?;
        let icon = match (meta.icon, icon_destination) {
            (Some(path), Some(destination)) => {
                if let Some(parent) = destination.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                std::fs::copy(&path, destination).ok().map(|_| destination.display().to_string())
            }
            _ => None,
        };
        let nacp = meta.nacp.as_ref();
        Ok(ProbeResult {
            title_id: Some(content.base_title_id()),
            name: nacp.and_then(|n| n.primary_name()),
            publisher: nacp.and_then(|n| n.primary_publisher()),
            display_version: nacp.and_then(|n| n.display_version.clone()),
            localized_names: nacp.map(|n| n.localized_names()).unwrap_or_default(),
            icon,
        })
    })();
    let _ = std::fs::remove_dir_all(&work_dir);
    result
}

/// Result of expanding the selected files and folders
#[derive(Serialize)]
pub struct Scan {
    /// NSPs found (deduplicated, sorted by path)
    pub nsps: Vec<String>,
    /// Files that aren't .nsp
    pub others: Vec<String>,
}

/// Files are kept as-is (.nsp); folders are searched recursively for .nsp, ignoring hidden files
pub fn scan(paths: &[String]) -> Scan {
    let mut nsps = Vec::new();
    let mut others = Vec::new();
    for path in paths {
        let path = PathBuf::from(path);
        if path.is_dir() {
            walk(&path, &mut nsps);
        } else if path.is_file() {
            if is_nsp(&path) { nsps.push(path) } else { others.push(path.display().to_string()) }
        }
    }
    let mut seen = HashSet::new();
    let mut nsps: Vec<String> =
        nsps.into_iter().map(|p| p.display().to_string()).filter(|p| seen.insert(p.clone())).collect();
    nsps.sort_by_key(|p| p.to_lowercase());
    Scan { nsps, others }
}

fn is_nsp(path: &Path) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case("nsp"))
}

fn walk(dir: &Path, found: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let path = entry.path();
        match entry.file_type() {
            // Don't descend into macOS bundles (.app etc.)
            Ok(t) if t.is_dir() && path.extension().is_none_or(|e| e != "app") => walk(&path, found),
            Ok(t) if t.is_file() && is_nsp(&path) => found.push(path),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn scans_folders_for_nsps() {
        let dir = std::env::temp_dir().join(format!("nsptonup-scan-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        for name in ["b.nsp", "sub/a.NSP", ".hidden.nsp", "note.txt"] {
            std::fs::write(dir.join(name), "").unwrap();
        }
        let other = dir.join("note.txt").display().to_string();
        let scan = super::scan(&[dir.display().to_string(), other.clone()]);
        assert_eq!(scan.nsps.len(), 2);
        assert!(scan.nsps[0].ends_with("b.nsp"));
        assert_eq!(scan.others, vec![other]);
        std::fs::remove_dir_all(&dir).ok();
    }
}
