use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Identity of an imported document, derived from its raw bytes.
///
/// The hash anchors every later artifact (OCR results, findings, decisions,
/// audit reports) to the exact input, which is what makes runs reproducible.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceDocument {
    file_name: String,
    sha256: String,
    byte_len: u64,
}

impl SourceDocument {
    /// Derives the document identity from the original file name and raw bytes.
    pub fn from_bytes(file_name: impl Into<String>, bytes: &[u8]) -> Self {
        let digest = Sha256::digest(bytes);
        Self {
            file_name: file_name.into(),
            sha256: format!("{digest:x}"),
            byte_len: bytes.len() as u64,
        }
    }

    pub fn file_name(&self) -> &str {
        &self.file_name
    }

    /// Lowercase hex encoding of the SHA-256 digest of the input bytes.
    pub fn sha256_hex(&self) -> &str {
        &self.sha256
    }

    pub fn byte_len(&self) -> u64 {
        self.byte_len
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_identity_from_file_name_and_bytes() {
        let doc = SourceDocument::from_bytes("input.pdf", b"hello");

        assert_eq!(doc.file_name(), "input.pdf");
        assert_eq!(
            doc.sha256_hex(),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
        assert_eq!(doc.byte_len(), 5);
    }

    #[test]
    fn identical_bytes_yield_identical_identity() {
        let a = SourceDocument::from_bytes("a.pdf", b"same bytes");
        let b = SourceDocument::from_bytes("a.pdf", b"same bytes");

        assert_eq!(a, b);
    }
}
