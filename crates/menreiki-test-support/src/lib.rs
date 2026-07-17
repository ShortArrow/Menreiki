//! Test fixtures shared across Menreiki crates. Never ships in a release.

/// Builds a syntactically complete PDF with `page_count` blank US-letter
/// pages (612x792 pt), with a correct xref table so strict parsers accept it.
pub fn minimal_pdf(page_count: u16) -> Vec<u8> {
    minimal_pdf_with_text(&vec![""; usize::from(page_count)])
}

/// Builds a PDF with one US-letter page per entry, each showing its text in
/// 24pt Helvetica near the top-left corner. ASCII text only.
pub fn minimal_pdf_with_text(page_texts: &[&str]) -> Vec<u8> {
    let mut objects: Vec<String> = Vec::new();
    objects.push("<< /Type /Catalog /Pages 2 0 R >>".to_string());
    let kids: Vec<String> = (0..page_texts.len())
        .map(|index| format!("{} 0 R", 4 + 2 * index))
        .collect();
    objects.push(format!(
        "<< /Type /Pages /Kids [{}] /Count {} >>",
        kids.join(" "),
        page_texts.len()
    ));
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string());
    for (index, text) in page_texts.iter().enumerate() {
        let content = format!("BT /F1 24 Tf 72 700 Td ({}) Tj ET", escape_pdf_string(text));
        objects.push(format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] \
             /Resources << /Font << /F1 3 0 R >> >> /Contents {} 0 R >>",
            5 + 2 * index
        ));
        objects.push(format!(
            "<< /Length {} >>\nstream\n{content}\nendstream",
            content.len()
        ));
    }
    assemble_pdf(&objects)
}

fn escape_pdf_string(text: &str) -> String {
    text.replace('\\', r"\\").replace('(', r"\(").replace(')', r"\)")
}

fn assemble_pdf(objects: &[String]) -> Vec<u8> {
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

    #[test]
    fn embeds_page_text_with_escaping() {
        let pdf = String::from_utf8(minimal_pdf_with_text(&["mail (x): a@b.com"])).unwrap();

        assert!(pdf.contains(r"(mail \(x\): a@b.com) Tj"));
    }
}
