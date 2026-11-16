//! Minimal parsing of NACP, prod.keys and title.keys (nxpatch reads and decrypts the NSP).

use std::collections::BTreeMap;
use std::path::Path;

use crate::error::{AppError, Result};

// MARK: - NACP（control.nacp）

/// BCP-47 tags for the 16 NACP language slots (used by nup --lang-name)
pub const LANGUAGE_TAGS: [&str; 16] = [
    "en-US", "en-GB", "ja", "fr", "de", "es-419", "es", "it", "nl", "fr-CA", "pt", "ru", "ko", "zh-Hant", "zh-Hans",
    "pt-BR",
];

pub struct Nacp {
    /// Language tag -> game name
    pub names: BTreeMap<String, String>,
    /// Language tag -> publisher
    pub publishers: BTreeMap<String, String>,
    pub display_version: Option<String>,
}

impl Nacp {
    pub fn parse(data: &[u8]) -> Result<Nacp> {
        if data.len() < 0x3070 {
            return Err(AppError::key("error_nacp_size"));
        }
        let mut names = BTreeMap::new();
        let mut publishers = BTreeMap::new();
        for (i, tag) in LANGUAGE_TAGS.iter().enumerate() {
            let base = i * 0x300;
            if let Some(name) = c_string(data, base, 0x200) {
                names.insert(tag.to_string(), name);
            }
            if let Some(publisher) = c_string(data, base + 0x200, 0x100) {
                publishers.insert(tag.to_string(), publisher);
            }
        }
        Ok(Nacp { names, publishers, display_version: c_string(data, 0x3060, 0x10) })
    }

    /// Default language: American English first, otherwise the first non-empty slot
    pub fn primary_name(&self) -> Option<String> {
        pick(&self.names)
    }

    pub fn primary_publisher(&self) -> Option<String> {
        pick(&self.publishers)
    }

    /// Localized names that differ from the default name
    pub fn localized_names(&self) -> BTreeMap<String, String> {
        let primary = self.primary_name();
        self.names.iter().filter(|(_, v)| Some(*v) != primary.as_ref()).map(|(k, v)| (k.clone(), v.clone())).collect()
    }
}

fn pick(values: &BTreeMap<String, String>) -> Option<String> {
    LANGUAGE_TAGS.iter().find_map(|tag| values.get(*tag).cloned())
}

// MARK: - prod.keys

pub struct KeysCheck {
    pub key_count: usize,
    /// None means nothing is missing
    pub missing: Option<Vec<String>>,
    pub unreadable: bool,
    /// Entries whose value isn't hex or whose length isn't a multiple of 32 (e.g. 34-digit *_kek_source from some dump
    /// tools).
    /// nxpatch (LibHac) skips these entries when reading, so they're harmless; this is only a hint
    pub ignored: Vec<String>,
}

/// Only checks key name and value format; no key values are stored
pub fn check_keys(path: &Path) -> KeysCheck {
    let Ok(text) = std::fs::read_to_string(path) else {
        return KeysCheck { key_count: 0, missing: None, unreadable: true, ignored: Vec::new() };
    };
    let mut names = std::collections::HashSet::new();
    let mut ignored = Vec::new();
    for line in text.lines() {
        let Some((name, value)) = line.split_once('=') else { continue };
        let name = name.trim().to_lowercase();
        let value = value.trim();
        if value.is_empty() || !value.chars().all(|c| c.is_ascii_hexdigit()) || value.len() % 32 != 0 {
            ignored.push(name);
            continue;
        }
        names.insert(name);
    }
    if names.is_empty() {
        return KeysCheck { key_count: 0, missing: None, unreadable: true, ignored };
    }
    let mut missing = Vec::new();
    if !names.contains("header_key") {
        missing.push("header_key".to_owned());
    }
    if !names.iter().any(|n| n.starts_with("key_area_key_application_") || n.starts_with("master_key_")) {
        missing.push("key_area_key_application_xx / master_key_xx".to_owned());
    }
    KeysCheck { key_count: names.len(), missing: (!missing.is_empty()).then_some(missing), unreadable: false, ignored }
}

// MARK: - title.keys

pub struct TitleKeysCheck {
    /// Entry count (one line per game)
    pub count: usize,
    /// Number of unrecognized lines (harmless)
    pub skipped_lines: usize,
    pub unreadable: bool,
}

/// title.keys: each line is "32-digit Rights ID = 32-digit key"; only entries are counted, no key values are stored
pub fn check_title_keys(path: &Path) -> TitleKeysCheck {
    let Ok(text) = std::fs::read_to_string(path) else {
        return TitleKeysCheck { count: 0, skipped_lines: 0, unreadable: true };
    };
    let mut ids = std::collections::HashSet::new();
    let mut skipped = 0;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }
        let valid = trimmed.split_once('=').map(|(id, key)| (id.trim(), key.trim())).filter(|(id, key)| {
            id.len() == 32 && key.len() == 32 && id.chars().chain(key.chars()).all(|c| c.is_ascii_hexdigit())
        });
        match valid {
            Some((id, _)) => {
                ids.insert(id.to_lowercase());
            }
            None => skipped += 1,
        }
    }
    TitleKeysCheck { count: ids.len(), skipped_lines: skipped, unreadable: false }
}

/// Tells prod.keys and title.keys apart by content (not by file name, which the user may have changed)
pub fn detect_key_file(path: &Path) -> &'static str {
    let title = check_title_keys(path);
    // Every title.keys line is "Rights ID = key"; prod.keys names aren't hex and are skipped
    if title.count > 0 && title.skipped_lines == 0 {
        return "title";
    }
    if check_keys(path).unreadable { "unknown" } else { "prod" }
}

// MARK: - Byte helpers

fn c_string(data: &[u8], offset: usize, max_length: usize) -> Option<String> {
    let slice = &data[offset..(offset + max_length).min(data.len())];
    let end = slice.iter().position(|&b| b == 0).unwrap_or(slice.len());
    let value = String::from_utf8_lossy(&slice[..end]).trim().to_owned();
    (!value.is_empty()).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nacp_prefers_american_english() {
        let mut data = vec![0u8; 0x4000];
        let ja = b"\xe3\x82\xbc\xe3\x83\xab\xe3\x83\x80"; // ゼルダ
        data[2 * 0x300..2 * 0x300 + ja.len()].copy_from_slice(ja);
        data[0..5].copy_from_slice(b"Zelda");
        data[0x200..0x208].copy_from_slice(b"Nintendo");
        data[0x3060..0x3065].copy_from_slice(b"1.2.1");
        let nacp = Nacp::parse(&data).unwrap();
        assert_eq!(nacp.primary_name().as_deref(), Some("Zelda"));
        assert_eq!(nacp.primary_publisher().as_deref(), Some("Nintendo"));
        assert_eq!(nacp.display_version.as_deref(), Some("1.2.1"));
        assert_eq!(nacp.localized_names().get("ja").map(String::as_str), Some("ゼルダ"));
        assert!(!nacp.localized_names().contains_key("en-US"));
    }

    fn temp_file(name: &str, text: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("nsptonup-keys-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, text).unwrap();
        path
    }

    #[test]
    fn keys_check_reports_missing_and_ignored() {
        let k32 = "00112233445566778899aabbccddeeff";
        let path = temp_file("a.keys", &format!("header_key = {k32}{k32}\nfoo = zz\nbar_kek_source = {k32}00\n"));
        let check = check_keys(&path);
        assert_eq!(check.key_count, 1);
        assert_eq!(check.missing.unwrap().len(), 1);
        assert_eq!(check.ignored, vec!["foo", "bar_kek_source"]);
        let path = temp_file("b.keys", &format!("header_key = {k32}{k32}\nmaster_key_00 = {k32}\n"));
        assert!(check_keys(&path).missing.is_none());
    }

    #[test]
    fn detects_title_keys() {
        let k32 = "00112233445566778899aabbccddeeff";
        let title = temp_file("title.keys", &format!("{k32} = {k32}\n# comment\n"));
        assert_eq!(detect_key_file(&title), "title");
        assert_eq!(check_title_keys(&title).count, 1);
        let prod = temp_file("prod.keys", &format!("header_key = {k32}{k32}\n"));
        assert_eq!(detect_key_file(&prod), "prod");
        let other = temp_file("other.keys", "hello\n");
        assert_eq!(detect_key_file(&other), "unknown");
    }
}
