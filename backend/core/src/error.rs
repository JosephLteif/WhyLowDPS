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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn string_variants_render_expected_messages() {
        assert_eq!(
            AppError::SimcError("boom".to_string()).to_string(),
            "SimulationCraft error: boom"
        );
        assert_eq!(
            AppError::StorageError("disk".to_string()).to_string(),
            "Storage error: disk"
        );
        assert_eq!(
            AppError::ParseError("bad json".to_string()).to_string(),
            "Data parsing error: bad json"
        );
        assert_eq!(
            AppError::Internal("oops".to_string()).to_string(),
            "Internal error: oops"
        );
    }

    #[test]
    fn from_conversions_wrap_source_errors() {
        let io_error: AppError = std::io::Error::other("missing file").into();
        assert!(matches!(io_error, AppError::IoError(_)));
        assert_eq!(io_error.to_string(), "IO error: missing file");

        let invalid_pattern = "(".to_string();
        let regex_error: AppError = regex::Regex::new(&invalid_pattern)
            .expect_err("invalid regex")
            .into();
        assert!(matches!(regex_error, AppError::RegexError(_)));
        assert!(regex_error.to_string().starts_with("Regex error: "));

        let json_error: AppError = serde_json::from_str::<serde_json::Value>("{")
            .expect_err("invalid json")
            .into();
        assert!(matches!(json_error, AppError::JsonError(_)));
        assert!(json_error.to_string().starts_with("JSON error: "));
    }

    #[test]
    fn result_alias_uses_app_error() {
        fn fail() -> Result<()> {
            Err(AppError::Internal("expected".to_string()))
        }

        let err = fail().expect_err("result should carry app error");
        assert!(matches!(err, AppError::Internal(message) if message == "expected"));
    }
}
