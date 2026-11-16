//! Fixed directories used by the App. The data directory is decided by nsh (same as TSX's process.dataDir),
//! recorded in Native.init for use by background threads.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub struct Paths {
    /// Game library, settings, covers
    pub data: PathBuf,
    /// Temp directory used during conversion
    pub work: PathBuf,
}

static PATHS: OnceLock<Paths> = OnceLock::new();

pub fn init(data: PathBuf) -> &'static Paths {
    PATHS.get_or_init(|| {
        let work = dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join("NSPtoNUP NSH").join("work");
        Paths { data, work }
    })
}

pub fn try_get() -> Option<&'static Paths> {
    PATHS.get()
}

pub fn get() -> &'static Paths {
    PATHS.get().expect("Native.init has not been called")
}

impl Paths {
    pub fn covers(&self) -> PathBuf {
        ensure(self.data.join("covers"))
    }

    pub fn work_root(&self) -> PathBuf {
        ensure(self.work.clone())
    }
}

/// Default output directory: Documents/NSPtoNUP
pub fn default_output() -> PathBuf {
    dirs::document_dir().or_else(dirs::home_dir).unwrap_or_else(std::env::temp_dir).join("NSPtoNUP")
}

pub fn ensure(path: PathBuf) -> PathBuf {
    let _ = std::fs::create_dir_all(&path);
    path
}

/// For display: write the home directory as ~
pub fn display(path: &Path) -> String {
    if let Some(home) = dirs::home_dir()
        && let Ok(rest) = path.strip_prefix(&home)
    {
        return format!("~/{}", rest.display());
    }
    path.display().to_string()
}

/// Generates a unique directory name
pub fn unique_name(prefix: &str) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{prefix}-{:x}-{:x}", std::process::id(), nanos)
}
