use std::fs;

use menreiki_core::Rect;
use menreiki_project::{
    clear_analysis, import, load_decisions, save_decisions, FindingDecision, RegionDecision,
    ReviewDecisions, TextDecision,
};

fn fresh_project(tmp: &tempfile::TempDir) -> std::path::PathBuf {
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    import(&input, &project_dir).unwrap();
    project_dir
}

fn sample_decisions() -> ReviewDecisions {
    ReviewDecisions {
        findings: vec![FindingDecision {
            category: "email".to_string(),
            text: "taro@example.com".to_string(),
            action: "mask".to_string(),
            value: String::new(),
        }],
        texts: vec![TextDecision {
            text: "株式会社アルファ技研".to_string(),
            action: "replace".to_string(),
            value: "開発会社A".to_string(),
        }],
        regions: vec![RegionDecision {
            rect: Rect {
                x: 0.0,
                y: 3100.0,
                width: 2550.0,
                height: 200.0,
            },
            action: "erase".to_string(),
            page: None,
            drawn_on: 0,
        }],
    }
}

#[test]
fn decisions_round_trip_and_default_to_empty() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = fresh_project(&tmp);

    assert_eq!(load_decisions(&project_dir).unwrap(), ReviewDecisions::default());

    let decisions = sample_decisions();
    save_decisions(&project_dir, &decisions).unwrap();

    assert_eq!(load_decisions(&project_dir).unwrap(), decisions);
}

#[test]
fn decisions_survive_clear_analysis() {
    let tmp = tempfile::tempdir().unwrap();
    let project_dir = fresh_project(&tmp);
    let decisions = sample_decisions();
    save_decisions(&project_dir, &decisions).unwrap();

    clear_analysis(&project_dir).unwrap();

    assert_eq!(load_decisions(&project_dir).unwrap(), decisions);
}
