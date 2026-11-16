//! All user-facing text is a Msg (key + arguments), translated by the UI into the current language (locales/app.yml,
//! ui/i18n.ts).
//! Rust contains no UI text.

use std::fmt;

use serde::Serialize;

/// Key + arguments; an argument can be text, another Msg, or a list joined by a separator
#[derive(Clone, Debug, Serialize)]
pub struct Msg {
    pub key: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<Arg>,
    /// Count that selects key_one when the English count is 1
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub enum Arg {
    Text(String),
    Msg(Msg),
    Join { join: Vec<Arg>, sep: String },
}

impl From<&str> for Arg {
    fn from(text: &str) -> Arg {
        Arg::Text(text.to_owned())
    }
}

impl From<String> for Arg {
    fn from(text: String) -> Arg {
        Arg::Text(text)
    }
}

impl From<Msg> for Arg {
    fn from(msg: Msg) -> Arg {
        Arg::Msg(msg)
    }
}

impl Msg {
    pub fn new(key: &str) -> Msg {
        Msg { key: key.to_owned(), args: Vec::new(), count: None }
    }

    pub fn with(key: &str, args: impl IntoIterator<Item = Arg>) -> Msg {
        Msg { key: key.to_owned(), args: args.into_iter().collect(), count: None }
    }

    /// Untranslated text (game names, paths, tool output)
    pub fn raw(text: impl Into<String>) -> Msg {
        Msg::with("text_raw", [Arg::Text(text.into())])
    }

    /// Title + detail (on a new line)
    pub fn with_detail(title: Msg, detail: Option<Msg>) -> Msg {
        match detail {
            Some(detail) => Msg::with("text_with_detail", [title.into(), detail.into()]),
            None => title,
        }
    }

    pub fn json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

#[derive(Debug)]
pub struct AppError {
    pub msg: Msg,
    /// Cancelled (the user stopped the conversion); the UI doesn't show it as a failure
    pub cancelled: bool,
}

impl AppError {
    pub fn key(key: &str) -> AppError {
        AppError { msg: Msg::new(key), cancelled: false }
    }

    pub fn with(key: &str, args: impl IntoIterator<Item = Arg>) -> AppError {
        AppError { msg: Msg::with(key, args), cancelled: false }
    }

    pub fn msg(msg: Msg) -> AppError {
        AppError { msg, cancelled: false }
    }

    pub fn cancelled() -> AppError {
        AppError { msg: Msg::new("log_cancelled"), cancelled: true }
    }

    /// Failure reason handed to TSX (Msg JSON, parsed by errorMsg in ui/i18n.ts)
    pub fn json(&self) -> String {
        self.msg.json()
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.msg.json())
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> AppError {
        AppError::msg(Msg::raw(error.to_string()))
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
