//! OCR engine selection: the requested language first, the profile
//! languages as a fallback — and a record of which one was used, so the UI
//! can warn when recognition ran in a language other than the document's.
//!
//! Kept free of Windows types so the decision is testable without an OCR
//! engine; `lib.rs` injects the Windows constructors.

use std::fmt::Display;

use serde::Serialize;

/// Which OCR language a run asked for and which one it actually got.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrLanguageStatus {
    pub requested: String,
    /// The engine's recognizer language tag, or "unknown" when it could not
    /// be read.
    pub used: String,
    /// True when the requested language's engine could not be created and
    /// the profile languages were used instead. Decided by that failure,
    /// not by `used != requested`: the profile may itself resolve to the
    /// requested language.
    pub fell_back: bool,
}

/// Creates an engine for `requested`, falling back to the profile languages
/// when that fails. The fallback warning goes to stderr in the CLI's format;
/// it names only the language and the error, never document text.
pub fn select_engine<E, LanguageError, ProfileError>(
    requested: &str,
    from_language: impl FnOnce(&str) -> Result<E, LanguageError>,
    from_profile: impl FnOnce() -> Result<E, ProfileError>,
    language_tag: impl Fn(&E) -> Option<String>,
) -> Result<(E, OcrLanguageStatus), String>
where
    LanguageError: Display,
    ProfileError: Display,
{
    let (engine, fell_back) = match from_language(requested) {
        Ok(engine) => (engine, false),
        Err(error) => {
            eprintln!(
                "warning: OCR language '{requested}' is unavailable ({error}); \
                 falling back to the profile languages"
            );
            (from_profile().map_err(|error| error.to_string())?, true)
        }
    };
    let used = language_tag(&engine).unwrap_or_else(|| "unknown".to_string());
    Ok((
        engine,
        OcrLanguageStatus {
            requested: requested.to_string(),
            used,
            fell_back,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stand-in engine that only knows its language tag.
    struct FakeEngine(Option<&'static str>);

    fn tag(engine: &FakeEngine) -> Option<String> {
        engine.0.map(str::to_string)
    }

    #[test]
    fn requested_language_available_does_not_fall_back() {
        let (_, status) = select_engine(
            "ja",
            |_| Ok::<_, String>(FakeEngine(Some("ja"))),
            || -> Result<FakeEngine, String> { panic!("profile must not be tried") },
            tag,
        )
        .unwrap();
        assert_eq!(
            status,
            OcrLanguageStatus {
                requested: "ja".into(),
                used: "ja".into(),
                fell_back: false,
            }
        );
    }

    #[test]
    fn missing_language_pack_falls_back_to_the_profile_language() {
        let (_, status) = select_engine(
            "ja",
            |_| Err::<FakeEngine, _>("no ja pack"),
            || Ok::<_, String>(FakeEngine(Some("en-US"))),
            tag,
        )
        .unwrap();
        assert_eq!(
            status,
            OcrLanguageStatus {
                requested: "ja".into(),
                used: "en-US".into(),
                fell_back: true,
            }
        );
    }

    #[test]
    fn fallback_is_reported_even_when_the_profile_resolves_to_the_same_language() {
        let (_, status) = select_engine(
            "ja",
            |_| Err::<FakeEngine, _>("forced"),
            || Ok::<_, String>(FakeEngine(Some("ja"))),
            tag,
        )
        .unwrap();
        assert!(status.fell_back);
        assert_eq!(status.used, "ja");
    }

    #[test]
    fn unreadable_language_tag_is_unknown() {
        let (_, status) = select_engine(
            "ja",
            |_| Err::<FakeEngine, _>("no ja pack"),
            || Ok::<_, String>(FakeEngine(None)),
            tag,
        )
        .unwrap();
        assert_eq!(status.used, "unknown");
        assert!(status.fell_back);
    }

    #[test]
    fn both_engines_failing_is_an_error() {
        let result = select_engine(
            "ja",
            |_| Err::<FakeEngine, _>("no ja pack"),
            || Err::<FakeEngine, _>("no profile language"),
            tag,
        );
        assert_eq!(result.err().as_deref(), Some("no profile language"));
    }

    #[test]
    fn status_serializes_in_camel_case() {
        let status = OcrLanguageStatus {
            requested: "ja".into(),
            used: "en-US".into(),
            fell_back: true,
        };
        assert_eq!(
            serde_json::to_value(&status).unwrap(),
            serde_json::json!({ "requested": "ja", "used": "en-US", "fellBack": true })
        );
    }
}
