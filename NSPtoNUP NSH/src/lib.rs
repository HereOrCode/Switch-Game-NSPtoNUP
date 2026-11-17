//! The Rust side of NSPtoNUP: TSX imports `Native` from `nsptonup/native`.
//!
//! The UI (game library, queue, settings) lives in TSX; this handles what TSX can't or shouldn't do:
//! launching the bundled nxpatch / nup, reading and writing GB-sized files, system file dialogs,
//! downloading and cropping covers, reading and writing the data directory.
//!
//! Structured data is always passed as JSON strings; types are defined in `ui/native.ts`.

mod cover;
mod error;
mod formats;
mod mock;
mod nxpatch;
mod paths;
mod pipeline;
mod probe;
mod tools;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use nsh_core::file_dialog::{FileFilter, OpenDialog, SaveDialog};
use nsh_core::prelude::*;
use serde_json::json;

use crate::tools::{Cancel, Tool};

/// The crate's exports (`nsh.json` `"rust"`).
#[native_module("nsptonup/native")]
fn native(registry: &mut Registry) {
    registry.module::<Native>();
}

/// NSPtoNUP's native side: tools, files, dialogs and covers. Structured values are JSON strings (`ui/native.ts`).
#[module]
pub struct Native;

/// Conversions in progress: task id -> cancellation flag
fn jobs() -> &'static Mutex<HashMap<String, Arc<Cancel>>> {
    static JOBS: OnceLock<Mutex<HashMap<String, Arc<Cancel>>>> = OnceLock::new();
    JOBS.get_or_init(Default::default)
}

#[module]
impl Native {
    /// Sets up the app's directories in `dataDir` (`process.dataDir`); JSON `Environment`: data and covers directories,
    /// default output, platform, tools found.
    pub fn init(data_dir: Option<String>) -> String {
        let mut data = data_dir
            .map(PathBuf::from)
            .unwrap_or_else(|| dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("NSPtoNUP NSH"));
        let mock = mock::enabled();
        if mock && paths::try_get().is_none() {
            data = data.with_file_name(format!("{}-mock", data.file_name().unwrap_or_default().to_string_lossy()));
            mock::install(&data);
        }
        let paths = paths::init(paths::ensure(data));
        let tools: serde_json::Map<String, serde_json::Value> = Tool::ALL
            .iter()
            .map(|t| (t.name().to_owned(), json!(t.path().map(|p| p.display().to_string()))))
            .collect();
        json!({
            "dataDir": paths.data.display().to_string(),
            "coversDir": paths.covers().display().to_string(),
            "workDir": paths::display(&paths.work),
            "defaultOutput": paths::default_output().display().to_string(),
            "platform": tools::platform_dir(),
            "tools": tools,
            "mock": mock,
        })
        .to_string()
    }

    /// Reads `name` (a file of the data directory); null when it does not exist.
    pub fn read_data(name: String) -> Option<String> {
        std::fs::read_to_string(paths::get().data.join(file_name(&name)?)).ok()
    }

    /// Writes `name` in the data directory, replacing it atomically.
    pub fn write_data(name: String, text: String) -> Result<(), String> {
        let name = file_name(&name).ok_or_else(|| error::Msg::with("error_file_name_invalid", [name.clone().into()]).json())?;
        let path = paths::get().data.join(name);
        let temp = path.with_extension("tmp");
        std::fs::write(&temp, text).map_err(|e| e.to_string())?;
        std::fs::rename(&temp, &path).map_err(|e| e.to_string())
    }

    /// Checks a prod.keys file by its key names and value formats only; JSON `KeysCheck`.
    pub fn check_keys(path: String) -> String {
        let check = formats::check_keys(Path::new(&path));
        json!({
            "keyCount": check.key_count,
            "missing": check.missing,
            "unreadable": check.unreadable,
            "ignored": check.ignored,
        })
        .to_string()
    }

    /// Checks a title.keys file (entries counted, no key kept); JSON `TitleKeysCheck`.
    pub fn check_title_keys(path: String) -> String {
        let check = formats::check_title_keys(Path::new(&path));
        json!({ "count": check.count, "skippedLines": check.skipped_lines, "unreadable": check.unreadable }).to_string()
    }

    /// Tells prod.keys from title.keys by content: "prod", "title" or "unknown".
    pub fn detect_key_file(path: String) -> String {
        formats::detect_key_file(Path::new(&path)).to_owned()
    }

    /// Expands files and folders into the NSPs in them; JSON `Scan`: `nsps` (sorted, unique) and `others`.
    pub fn scan(paths: Vec<String>) -> String {
        serde_json::to_string(&probe::scan(&paths)).unwrap_or_default()
    }

    /// Identifies NSPs (base, update or DLC; Title ID and version) with nxpatch; `onProgress` hears how many are done;
    /// JSON `Identified[]`.
    pub async fn identify(nsps: Vec<String>, keys: String, on_progress: Callback<f64>) -> Result<String, String> {
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel::<usize>();
        let work = blocking(move || {
            let paths: Vec<PathBuf> = nsps.iter().map(PathBuf::from).collect();
            nxpatch::identify(&paths, Path::new(&keys), |done| {
                let _ = sender.send(done);
            })
            .map(|r| serde_json::to_string(&r).unwrap_or_default())
            .map_err(|e| e.json())
        });
        while let Some(done) = receiver.recv().await {
            on_progress.post(done as f64);
        }
        work.await.map_err(|e| e.to_string())?
    }

    /// A file's size and whether it exists; JSON `FileInfo`.
    pub fn file_info(path: String) -> String {
        match std::fs::metadata(&path) {
            Ok(meta) => json!({ "exists": true, "isFile": meta.is_file(), "size": meta.len() }),
            Err(_) => json!({ "exists": false, "isFile": false, "size": 0 }),
        }
        .to_string()
    }

    /// Removes a file the app made (a cover, an icon); missing files are fine.
    pub fn remove_file(path: String) {
        let _ = std::fs::remove_file(path);
    }

    /// Moves a file the app made (a cover chosen in the add sheet) to its place.
    pub fn move_file(from: String, to: String) -> Result<(), String> {
        let _ = std::fs::remove_file(&to);
        std::fs::rename(&from, &to).or_else(|_| std::fs::copy(&from, &to).map(|_| ())).map_err(|e| e.to_string())
    }

    /// A path in the cache directory for temporary files (an add sheet's cover).
    pub fn temp_path(name: String) -> String {
        let dir = paths::ensure(paths::get().work.join("temp"));
        dir.join(format!("{}-{}", paths::unique_name("t"), file_name(&name).unwrap_or("file"))).display().to_string()
    }

    /// Formats a byte count as Finder does ("17.69 GB").
    pub fn format_bytes(bytes: f64) -> String {
        pipeline::format_bytes(bytes.max(0.0) as u64)
    }

    /// Reads a game's details from an NSP (only its Meta and Control NCAs are read); `allowPatch` reads an update's own
    /// details; JSON `ProbeResult`.
    pub async fn probe(
        nsp: String,
        keys: String,
        title_keys: Option<String>,
        icon_destination: Option<String>,
        allow_patch: bool,
    ) -> Result<String, String> {
        blocking(move || {
            let title_keys = title_keys.map(PathBuf::from);
            let icon = icon_destination.map(PathBuf::from);
            probe::probe(Path::new(&nsp), Path::new(&keys), title_keys.as_deref(), icon.as_deref(), allow_patch)
                .map(|r| serde_json::to_string(&r).unwrap_or_default())
                .map_err(|e| e.json())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    /// Converts an NSP to a NUP. `onEvent` hears JSON `PipelineEvent`s; resolves with JSON `ConvertResult`.
    pub async fn convert(job_id: String, input: String, on_event: Callback<String>) -> String {
        let input: pipeline::Input = match serde_json::from_str(&input) {
            Ok(input) => input,
            Err(e) => return json!({ "ok": false, "cancelled": false, "error": error::Msg::raw(e.to_string()) }).to_string(),
        };
        let cancel = Cancel::new();
        jobs().lock().unwrap().insert(job_id.clone(), cancel.clone());

        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel::<String>();
        let work = blocking(move || {
            let sender = Mutex::new(sender);
            let emit = move |event: pipeline::Event| {
                if let Ok(text) = serde_json::to_string(&event) {
                    let _ = sender.lock().unwrap().send(text);
                }
            };
            let pipeline = pipeline::Pipeline::new(input, &emit, &cancel);
            pipeline.run()
        });
        // Events are forwarded to TSX on the engine thread; the channel closes when the worker thread ends
        while let Some(event) = receiver.recv().await {
            on_event.post(event);
        }
        jobs().lock().unwrap().remove(&job_id);
        match work.await {
            Ok(Ok(output)) => json!({ "ok": true, "output": output }),
            Ok(Err(error)) => json!({ "ok": false, "cancelled": error.cancelled, "error": error.msg }),
            Err(error) => json!({ "ok": false, "cancelled": false, "error": error::Msg::raw(error.to_string()) }),
        }
        .to_string()
    }

    /// Stops a conversion started with `convert`.
    pub fn cancel(job_id: String) {
        if let Some(cancel) = jobs().lock().unwrap().get(&job_id) {
            cancel.cancel();
        }
    }

    /// Downloads the 16:9 cover of `titleId` to `destination`.
    pub async fn download_cover(title_id: String, destination: String) -> Result<(), String> {
        blocking(move || cover::download(&title_id, Path::new(&destination)).map_err(|e| e.json()))
            .await
            .map_err(|e| e.to_string())?
    }

    /// Saves an image as a 16:9 JPEG at `destination`; resolves whether it had to be cropped.
    pub async fn save_cover(image: String, destination: String) -> Result<bool, String> {
        blocking(move || {
            let data = std::fs::read(&image).map_err(|_| error::Msg::new("error_image_unreadable").json())?;
            cover::save(&data, Path::new(&destination)).map_err(|e| e.json())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    /// Shows the open dialog for NSP files and folders; the paths picked (empty when cancelled).
    pub async fn pick_nsps(title: String, button: String) -> Result<Vec<String>, String> {
        let dialog = OpenDialog::files_and_folders()
            .multiple(true)
            .filter(FileFilter::new("NSP", ["nsp"]))
            .title(title)
            .button_label(button);
        pick(dialog).await
    }

    /// Shows the open dialog for a keys file (`title` says which one).
    pub async fn pick_keys(title: String, button: String) -> Result<Option<String>, String> {
        let dialog = OpenDialog::files().title(title).button_label(button);
        Ok(pick(dialog).await?.into_iter().next())
    }

    /// Shows the save dialog (in Downloads, named `name`) and writes `text` there; resolves whether it was saved.
    pub async fn save_text(name: String, text: String, button: String) -> Result<bool, String> {
        let mut dialog = SaveDialog::new().file_name(name).button_label(button);
        if let Some(downloads) = dirs::download_dir() {
            dialog = dialog.directory(downloads);
        }
        match pick_save_path(dialog).await? {
            Some(path) => std::fs::write(path, text).map(|_| true).map_err(|e| e.to_string()),
            None => Ok(false),
        }
    }

    /// Moves `path` to the trash (the Recycle Bin on Windows).
    pub async fn trash(path: String) -> Result<(), String> {
        move_to_trash(PathBuf::from(path)).await.map(|_| ())
    }

    /// Shows the open dialog for an image (`filter` names the image types).
    pub async fn pick_image(title: String, button: String, filter: String) -> Result<Option<String>, String> {
        let dialog = OpenDialog::files()
            .filter(FileFilter::new(&filter, ["jpg", "jpeg", "png", "webp", "gif", "bmp"]))
            .title(title)
            .button_label(button);
        Ok(pick(dialog).await?.into_iter().next())
    }

    /// Shows the open dialog for a folder.
    pub async fn pick_folder(title: String, button: String) -> Result<Option<String>, String> {
        let dialog = OpenDialog::folders().title(title).button_label(button);
        Ok(pick(dialog).await?.into_iter().next())
    }

    /// Shows `path` selected in Finder, File Explorer or the file manager.
    pub async fn reveal(path: String) -> Result<(), String> {
        reveal_path(PathBuf::from(path)).await
    }

    /// A `NSPTONUP_*` environment variable in debug builds (`NSPTONUP_ADD`: an NSP to add at launch); null in release
    /// builds.
    pub fn debug_env(name: String) -> Option<String> {
        (cfg!(debug_assertions) && name.starts_with("NSPTONUP_")).then(|| std::env::var(&name).ok()).flatten()
    }

    /// `~/…` for a path under the home directory.
    pub fn display_path(path: String) -> String {
        paths::display(Path::new(&path))
    }
}

async fn pick(dialog: OpenDialog) -> Result<Vec<String>, String> {
    Ok(pick_paths(dialog).await?.unwrap_or_default().into_iter().map(|p| p.display().to_string()).collect())
}

/// Only allows single-level file names under the data directory
fn file_name(name: &str) -> Option<&str> {
    (!name.is_empty() && !name.contains(['/', '\\']) && name != "." && name != "..").then_some(name)
}

/// End to end: one full conversion of a sample NSP (skipped by default). The sample is Saturn Bomberman;
/// NSPTONUP_E2E_NSP and NSPTONUP_E2E_KEYS give the paths of the NSP and prod.keys:
/// `NSPTONUP_E2E_NSP=… NSPTONUP_E2E_KEYS=… cargo test e2e -- --ignored --nocapture`
#[cfg(test)]
mod e2e {
    use super::*;

    #[test]
    #[ignore]
    fn converts_sample_nsp() {
        let path = |name: &str| std::path::absolute(std::env::var(name).unwrap_or_else(|_| panic!("set {name}"))).unwrap();
        let nsp = path("NSPTONUP_E2E_NSP");
        let keys = path("NSPTONUP_E2E_KEYS");
        let temp = std::env::temp_dir().join(paths::unique_name("nsptonup-e2e"));
        paths::init(paths::ensure(temp.join("data")));

        let icon = temp.join("icon.jpg");
        let probed = probe::probe(&nsp, &keys, None, Some(&icon), false).expect("probe");
        println!("probe: {}", serde_json::to_string(&probed).unwrap());
        assert_eq!(probed.title_id.as_deref(), Some("01007700157CE000"));
        assert!(icon.is_file());

        let input: pipeline::Input = serde_json::from_value(json!({
            "nsp": nsp.display().to_string(),
            "keys": keys.display().to_string(),
            "outputDirectory": temp.join("out").display().to_string(),
            "autoCover": true,
            "coverDestination": temp.join("cover.jpg").display().to_string(),
            "cleanup": true,
        }))
        .unwrap();
        let cancel = Cancel::new();
        let emit = |event: pipeline::Event| {
            let text = serde_json::to_string(&event).unwrap();
            if !text.contains("\"progress\"") {
                println!("{text}");
            }
        };
        let output = pipeline::Pipeline::new(input, &emit, &cancel).run().expect("convert");
        println!("output: {}", serde_json::to_string(&output).unwrap());
        assert!(Path::new(&output.nup).is_file());
        assert!(output.nup_size > 100 << 20);
        // The NUP icon is the game's own 1:1 icon, not the 16:9 cover. Records follow SPEC §5 numbering: icon in TLV
        // 0x0003, name in 0x0005 (upstream nup once shifted every record down by one)
        let tlv = |kind: u16, payload: &[u8]| {
            let mut record = kind.to_le_bytes().to_vec();
            record.extend([0, 0]);
            record.extend((payload.len() as u32).to_le_bytes());
            record.extend(payload);
            record
        };
        let contains = |haystack: &[u8], needle: &[u8]| haystack.windows(needle.len()).any(|w| w == needle);
        let icon = std::fs::read(&icon).unwrap();
        let nup = std::fs::read(&output.nup).unwrap();
        assert!(contains(&nup, &tlv(0x0003, &icon)), "1:1 icon not in TLV 0x0003");
        assert!(contains(&nup, &tlv(0x0005, b"Saturn Bomberman")), "name not in TLV 0x0005");
        std::fs::remove_dir_all(&temp).ok();
    }
}
