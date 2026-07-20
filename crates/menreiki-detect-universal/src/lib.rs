//! Locale-independent detection rules for the Menreiki engine.
//!
//! These identifiers have the same written form in every language — email
//! addresses (RFC 5322-ish), URLs, IPv4 addresses, and MAC addresses — so a
//! language pack such as `menreiki-lang-ja` composes them in rather than
//! redefining them. Locale-specific formats (phone numbers, postal codes,
//! dates) belong in the language pack, not here.

use menreiki_detect::RegexRule;

/// Detection rules for identifiers whose form does not depend on language.
///
/// International phone numbers in `+<country code>` (E.164) form are matched
/// here because the leading `+CC` is universal; nation-local formats (such as
/// a Japanese 0-prefixed number) stay in the language pack.
pub fn universal_rules() -> Vec<RegexRule> {
    [
        ("email", r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
        // Tolerates a lost colon (OCR reads "https //host" for "https://host").
        ("url", r"https?\s?:?//[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+"),
        ("ip-address", r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
        (
            "mac-address",
            r"\b(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b",
        ),
        (
            "phone",
            r"\+\d{1,3}[\s.\-]?\(?\d{1,4}\)?(?:[\s.\-]?\d{2,4}){2,4}",
        ),
    ]
    .into_iter()
    .map(|(category, pattern)| {
        RegexRule::new(category, pattern).expect("built-in pattern is valid")
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use menreiki_core::{OcrLine, PageOcr, Rect, Span};
    use menreiki_detect::detect_page;

    fn page(text: &str) -> PageOcr {
        PageOcr {
            width: 1000,
            height: 100,
            lines: vec![OcrLine {
                text: text.to_string(),
                words: vec![Span {
                    text: text.to_string(),
                    rect: Rect {
                        x: 0.0,
                        y: 0.0,
                        width: 100.0,
                        height: 20.0,
                    },
                }],
            }],
        }
    }

    #[test]
    fn detects_universal_identifiers() {
        let cases = [
            ("Contact: taro@example.com", "email"),
            ("see https://example.com/path", "url"),
            ("host 192.168.10.21 online", "ip-address"),
            ("nic 01:23:45:ab:cd:ef", "mac-address"),
        ];
        for (text, category) in cases {
            let findings = detect_page(&page(text), &universal_rules());
            assert!(
                findings.iter().any(|f| f.category == category),
                "{category} not found in {text:?}: {findings:?}"
            );
        }
    }

    #[test]
    fn url_tolerates_a_lost_colon_from_ocr() {
        let findings = detect_page(&page("参照 https //example.com/a"), &universal_rules());

        assert!(findings.iter().any(|f| f.category == "url"), "{findings:?}");
    }

    #[test]
    fn detects_international_phone_numbers() {
        for text in [
            "連絡先 +81 3-1234-5678",
            "call +1 (555) 123-4567",
            "tel +44 20 7946 0958",
        ] {
            let findings = detect_page(&page(text), &universal_rules());
            let phone = findings.iter().find(|f| f.category == "phone");
            assert!(phone.is_some(), "no phone in {text:?}: {findings:?}");
            assert!(
                phone.unwrap().text.starts_with('+'),
                "expected E.164 form in {text:?}"
            );
        }
    }
}
