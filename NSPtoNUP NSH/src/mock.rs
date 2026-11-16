//! Demo mode (debug builds only): starting with NSPTONUP_MOCK=1 generates 30 games for viewing the UI.
//!
//! Game info is real data (mock/games.json); covers and icons are read from a local cache at
//! ~/Library/Caches/NSPtoNUP/MockAssets if present; without it, no images are shown.
//! Data lives in a separate data directory, rebuilt on each launch (settings.json kept); the real game library is
//! untouched. Conversion tasks and logs are simulated by the UI (ui/state/mock.ts).
//! NSPs and NUPs are 1–3 MB sparse placeholders (no disk usage), so "Show in Finder", "Move to Trash" etc. work.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::{Value, json};

use crate::error::Msg;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    title_id: String,
    name: String,
    publisher: String,
    size: u64,
    localized_names: serde_json::Map<String, Value>,
}

pub fn enabled() -> bool {
    cfg!(debug_assertions) && std::env::var("NSPTONUP_MOCK").is_ok_and(|v| v == "1")
}

/// Rebuilds the demo directory and writes library.json
pub fn install(data: &Path) {
    // Settings (UI language etc.) are kept; everything else is rebuilt
    let settings = std::fs::read(data.join("settings.json")).ok();
    let _ = std::fs::remove_dir_all(data);
    if let Some(settings) = settings {
        let _ = std::fs::create_dir_all(data);
        let _ = std::fs::write(data.join("settings.json"), settings);
    }
    let covers = data.join("covers");
    let out = data.join("out");
    let nsp_dir = data.join("nsp");
    for dir in [&covers, &out, &nsp_dir] {
        let _ = std::fs::create_dir_all(dir);
    }
    let assets = dirs::cache_dir().unwrap_or_default().join("NSPtoNUP/MockAssets");
    let entries: Vec<Entry> = serde_json::from_str(include_str!("mock/games.json")).unwrap_or_default();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);

    let games: Vec<Value> = entries
        .iter()
        .enumerate()
        .map(|(i, entry)| {
            let tid = entry.title_id.as_str();
            let id = format!("00000000-0000-4000-8000-{}", &tid[tid.len() - 12..]);
            let mut game = json!({
                "id": id,
                "nspPath": format!("/Users/Shared/Switch/{} [{}][v0].nsp", entry.name, tid),
                "fileSize": entry.size,
                "addedAt": iso8601(now - i as u64 * 3600 * 5),
                "titleId": tid,
                "name": entry.name,
                "publisher": entry.publisher,
                "localizedNames": entry.localized_names,
                "metadataLoaded": true,
                "coverLookupFailed": false,
                "status": "notConverted",
                "warnings": [],
            });
            let (state, problem) = state(tid);
            match state {
                "done" | "doneWithoutIcon" => {
                    // The NUP is only a placeholder (a 1–3 MB sparse file)
                    let nup = out.join(format!("{}.nup", entry.name.replace(['/', ':'], " ")));
                    let size = placeholder_size(tid);
                    if let Ok(file) = std::fs::File::create(&nup) {
                        let _ = file.set_len(size);
                    }
                    game["status"] = json!("converted");
                    game["nupPath"] = json!(nup.display().to_string());
                    game["nupSize"] = json!(size);
                    if state == "doneWithoutIcon" {
                        game["warningMessages"] = json!([Msg::new("warning_cover_not_found")]);
                    }
                }
                "failed" => {
                    game["status"] = json!("failed");
                    game["lastErrorMessage"] = json!(problem);
                }
                "unreadable" => {
                    game["metadataLoaded"] = json!(false);
                    game["metadataErrorMessage"] = json!(problem);
                }
                _ => {}
            }
            // Attached updates / DLC (placeholders): BotW was converted with them; TotK got an update afterwards and
            // needs reconversion
            let extras = contents(tid);
            if !extras.is_empty() {
                let attached: Vec<Value> = extras
                    .iter()
                    .map(|(kind, title_id, version, display, size)| {
                        let suffix = if *kind == "update" { format!("v{version}") } else { "DLC".to_owned() };
                        let path = nsp_dir.join(format!("{} [{title_id}][{suffix}].nsp", entry.name.replace(['/', ':'], " ")));
                        // Placeholders are only a few MB; the game library's fileSize is still the real value, so the
                        // UI is unchanged
                        if let Ok(file) = std::fs::File::create(&path) {
                            let _ = file.set_len(placeholder_size(title_id));
                        }
                        json!({
                            "kind": kind, "nspPath": path.display().to_string(), "titleId": title_id,
                            "version": version, "displayVersion": display, "fileSize": size,
                        })
                    })
                    .collect();
                if let Some(display) = extras.iter().find(|e| e.0 == "update").and_then(|e| e.3) {
                    game["displayVersion"] = json!(display);
                }
                if tid != "0100F2C0115B6000" {
                    game["convertedContentPaths"] = json!(attached.iter().map(|a| a["nspPath"].clone()).collect::<Vec<_>>());
                }
                game["attached"] = json!(attached);
            }
            // Games without a cover don't use an image
            if matches!(state, "doneWithoutIcon" | "noCover") {
                game["coverLookupFailed"] = json!(true);
            } else if let Some(name) = copy(&assets.join(format!("{tid}-banner.jpg")), &covers, &format!("{id}-cover.jpg")) {
                game["coverFile"] = json!(name);
                game["coverSource"] = json!("downloaded");
            }
            if state != "unreadable"
                && let Some(name) = copy(&assets.join(format!("{tid}-icon.jpg")), &covers, &format!("{id}-icon.jpg"))
            {
                game["iconFile"] = json!(name);
            }
            game
        })
        .collect();
    let _ = std::fs::write(data.join("library.json"), serde_json::to_string_pretty(&games).unwrap_or_default());
}

/// Demo conversion states (by Title ID, rest "not started") and failure reasons; converting / waiting are simulated by
/// the UI
fn state(tid: &str) -> (&'static str, Option<Msg>) {
    let state = match tid {
        "0100F2C0115B6000" | "01007EF00011E000" | "0100000000010000" | "0100152000022000" | "01006F8002326000"
        | "010015100B514000" | "0100633007D48000" => "done",
        "01002B30028F6000" => "doneWithoutIcon",
        "010093801237C000" => {
            let detail = crate::nxpatch::describe("missing_key", "key_area_key_application_11", "");
            return ("failed", Some(Msg::with_detail(Msg::new("error_extract_failed"), Some(detail))));
        }
        "01006A800016E000" => {
            return ("failed", Some(Msg::with("error_disk_space", ["38 GB".into(), "21 GB".into()])));
        }
        "0100E65002BB8000" => return ("unreadable", Some(crate::nxpatch::describe("nca_not_found", "control", ""))),
        "0100A5C00D162000" => "noCover",
        _ => "",
    };
    (state, None)
}

/// Demo updates and DLC: (kind, Title ID, cnmt version, display version, size)
fn contents(tid: &str) -> Vec<(&'static str, &'static str, u32, Option<&'static str>, u64)> {
    match tid {
        "01007EF00011E000" => vec![
            ("update", "01007EF00011E800", 786_432, Some("1.6.0"), 412_000_000),
            ("dlc", "01007EF00011F001", 0, None, 1_210_000_000),
        ],
        "0100F2C0115B6000" => vec![("update", "0100F2C0115B6800", 327_680, Some("1.2.1"), 1_380_000_000)],
        _ => vec![],
    }
}

/// Fixed pseudo-random number from the Title ID (FNV-1a), so placeholder sizes are the same on every launch
fn hash(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |value, byte| (value ^ byte as u64).wrapping_mul(0x100_0000_01b3))
}

/// Actual placeholder size: 1–3 MB (sparse file, no disk usage)
fn placeholder_size(key: &str) -> u64 {
    let h = hash(key);
    (1 + h % 3) * 1_000_000 + h % 997_000
}

fn copy(from: &Path, dir: &Path, name: &str) -> Option<String> {
    let to: PathBuf = dir.join(name);
    std::fs::copy(from, &to).ok().map(|_| name.to_owned())
}

/// Seconds -> ISO 8601 (UTC)
fn iso8601(secs: u64) -> String {
    let days = secs / 86400;
    let rem = secs % 86400;
    // Days since 1970-01-01 -> year, month, day (Howard Hinnant's algorithm)
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

#[cfg(test)]
mod tests {
    #[test]
    fn formats_iso8601() {
        assert_eq!(super::iso8601(0), "1970-01-01T00:00:00Z");
        assert_eq!(super::iso8601(1_763_251_200), "2025-11-16T00:00:00Z");
    }
}
