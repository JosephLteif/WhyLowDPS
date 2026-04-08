use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimcProfile {
    pub name: String,
    pub lines: Vec<String>,
}

impl fmt::Display for SimcProfile {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for line in &self.lines {
            writeln!(f, "{}", line)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimcProfileset {
    pub name: String,
    pub actor: String,
    pub lines: Vec<String>,
}

impl fmt::Display for SimcProfileset {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "profileset.\"{}\"+=actor={}", self.name, self.actor)?;
        for line in &self.lines {
            writeln!(f, "profileset.\"{}\"+={}", self.name, line)?;
        }
        Ok(())
    }
}

/// Output from a simc subprocess, including all generated report files.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimcOutput {
    pub json: serde_json::Value,
    pub html_report: Option<String>,
    pub text_output: Option<String>,
}
