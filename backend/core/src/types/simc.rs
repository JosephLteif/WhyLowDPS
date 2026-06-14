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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn simc_profile_display_emits_each_line_with_trailing_newline() {
        let profile = SimcProfile {
            name: "Mage".to_string(),
            lines: vec!["mage=\"Tester\"".to_string(), "spec=frost".to_string()],
        };

        assert_eq!(profile.to_string(), "mage=\"Tester\"\nspec=frost\n");
    }

    #[test]
    fn simc_profile_display_is_empty_when_profile_has_no_lines() {
        let profile = SimcProfile {
            name: "Empty".to_string(),
            lines: vec![],
        };

        assert_eq!(profile.to_string(), "");
    }

    #[test]
    fn simc_profileset_display_prefixes_actor_and_profileset_lines() {
        let profileset = SimcProfileset {
            name: "Combo 1".to_string(),
            actor: "mage".to_string(),
            lines: vec!["talents=abc".to_string(), "head=id=123".to_string()],
        };

        assert_eq!(
            profileset.to_string(),
            "profileset.\"Combo 1\"+=actor=mage\nprofileset.\"Combo 1\"+=talents=abc\nprofileset.\"Combo 1\"+=head=id=123\n"
        );
    }

    #[test]
    fn simc_profileset_display_emits_actor_line_when_profileset_has_no_options() {
        let profileset = SimcProfileset {
            name: "Baseline".to_string(),
            actor: "warrior".to_string(),
            lines: vec![],
        };

        assert_eq!(
            profileset.to_string(),
            "profileset.\"Baseline\"+=actor=warrior\n"
        );
    }

    #[test]
    fn simc_profile_and_profileset_round_trip_through_json() {
        let profile = SimcProfile {
            name: "Mage".to_string(),
            lines: vec!["mage=\"Tester\"".to_string(), "spec=fire".to_string()],
        };
        let profile_value = serde_json::to_value(&profile).expect("serialize profile");
        let decoded_profile: SimcProfile =
            serde_json::from_value(profile_value).expect("deserialize profile");
        assert_eq!(decoded_profile.name, profile.name);
        assert_eq!(decoded_profile.lines, profile.lines);

        let profileset = SimcProfileset {
            name: "Combo A".to_string(),
            actor: "mage".to_string(),
            lines: vec!["profileset_option=1".to_string()],
        };
        let profileset_value = serde_json::to_value(&profileset).expect("serialize profileset");
        let decoded_profileset: SimcProfileset =
            serde_json::from_value(profileset_value).expect("deserialize profileset");
        assert_eq!(decoded_profileset.name, profileset.name);
        assert_eq!(decoded_profileset.actor, profileset.actor);
        assert_eq!(decoded_profileset.lines, profileset.lines);
    }

    #[test]
    fn simc_output_serializes_optional_reports() {
        let output = SimcOutput {
            json: json!({"player_name": "Tester", "dps": 1234.5}),
            html_report: Some("<html>report</html>".to_string()),
            text_output: None,
        };

        let serialized = serde_json::to_value(&output).expect("serialize simc output");
        assert_eq!(serialized.get("player_name"), None);
        assert_eq!(
            serialized
                .get("json")
                .and_then(|value| value.get("player_name")),
            Some(&json!("Tester"))
        );
        assert_eq!(
            serialized
                .get("html_report")
                .and_then(|value| value.as_str()),
            Some("<html>report</html>")
        );
        assert!(serialized.get("text_output").is_some());
        assert!(serialized.get("text_output").unwrap().is_null());
    }

    #[test]
    fn simc_output_deserializes_missing_optional_reports_as_none() {
        let output: SimcOutput = serde_json::from_value(json!({
            "json": {
                "player_name": "Tester",
                "dps": 1234.5
            }
        }))
        .expect("deserialize simc output");

        assert_eq!(output.json["player_name"], json!("Tester"));
        assert_eq!(output.html_report, None);
        assert_eq!(output.text_output, None);
    }

    #[test]
    fn simc_output_deserializes_explicit_null_optional_reports_as_none() {
        let output: SimcOutput = serde_json::from_value(json!({
            "json": {
                "player_name": "Tester"
            },
            "html_report": null,
            "text_output": null
        }))
        .expect("deserialize simc output");

        assert_eq!(output.json["player_name"], json!("Tester"));
        assert_eq!(output.html_report, None);
        assert_eq!(output.text_output, None);
    }
}
