//! Test fixtures shared across Menreiki crates. Never ships in a release.

/// Builds a syntactically complete PDF with `page_count` blank US-letter
/// pages (612x792 pt), with a correct xref table so strict parsers accept it.
pub fn minimal_pdf(page_count: u16) -> Vec<u8> {
    let mut objects: Vec<String> = Vec::new();
    objects.push("<< /Type /Catalog /Pages 2 0 R >>".to_string());
    let kids: Vec<String> = (0..page_count)
        .map(|index| format!("{} 0 R", 3 + u32::from(index)))
        .collect();
    objects.push(format!(
        "<< /Type /Pages /Kids [{}] /Count {} >>",
        kids.join(" "),
        page_count
    ));
    for _ in 0..page_count {
        objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>".to_string());
    }

    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = Vec::new();
    for (index, body) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.push_str(&format!("{} 0 obj\n{body}\nendobj\n", index + 1));
    }

    let xref_offset = pdf.len();
    pdf.push_str(&format!("xref\n0 {}\n", objects.len() + 1));
    pdf.push_str("0000000000 65535 f \n");
    for offset in &offsets {
        pdf.push_str(&format!("{offset:010} 00000 n \n"));
    }
    pdf.push_str(&format!(
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n",
        objects.len() + 1
    ));
    pdf.into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn declares_requested_page_count() {
        let pdf = String::from_utf8(minimal_pdf(3)).unwrap();

        assert!(pdf.starts_with("%PDF-1.4"));
        assert!(pdf.contains("/Count 3"));
        assert!(pdf.ends_with("%%EOF\n"));
    }
}
