use std::fs;

use menreiki_entity::Entity;
use menreiki_project::{clear_analysis, import, load_entities, save_entities};

#[test]
fn entities_round_trip_and_survive_clear_analysis() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("spec.pdf");
    fs::write(&input, b"%PDF-1.7 fake body").unwrap();
    let project_dir = tmp.path().join("spec.menreiki");
    import(&input, &project_dir).unwrap();

    assert!(load_entities(&project_dir).unwrap().is_empty());

    let entities = vec![Entity {
        id: "organization-001".to_string(),
        category: "organization".to_string(),
        alias: "開発会社A".to_string(),
        variants: vec![
            "株式会社アルファ技研".to_string(),
            "アルファ技研".to_string(),
        ],
        align: Some("right".to_string()),
    }];
    save_entities(&project_dir, &entities).unwrap();
    clear_analysis(&project_dir).unwrap();

    assert_eq!(load_entities(&project_dir).unwrap(), entities);
}
