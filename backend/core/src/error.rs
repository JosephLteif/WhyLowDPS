use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("SimulationCraft error: {0}")]
    SimcError(String),

    #[error("Storage error: {0}")]
    StorageError(String),

    #[error("Data parsing error: {0}")]
    ParseError(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Regex error: {0}")]
    RegexError(#[from] regex::Error),

    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("Internal error: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, AppError>;
