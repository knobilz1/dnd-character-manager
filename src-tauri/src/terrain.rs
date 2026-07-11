//! terrain.rs — a single global catalog of the DM's physical terrain pieces
//! (elevation, difficult terrain, cover, etc.), independent of any one
//! campaign since it's real-world 3D-printed inventory the DM owns, reused
//! across campaigns.
//!
//! Deliberately manually written/edited (same textarea+save pattern as
//! campaign.rs's Notes dialog) rather than photo-scanned: a camera can see
//! that a hex is raised, but not whether that's meant to block line of sight,
//! grant high ground, or is just decorative — only the DM knows the gameplay
//! meaning of a piece they printed. See campaign.rs's `suggest_session_plan`
//! for where this catalog actually gets used (session-prep planning).

use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const DEFAULT_TERRAIN_CATALOG: &str = "# Terrain Catalog\n\n_List the physical terrain pieces you own here — name, appearance, and what each does mechanically (blocks line of sight, difficult terrain, elevation, cover, etc.). This is referenced when a campaign asks for a session-prep suggestion (\"Plan next session\")._\n";

pub(crate) fn terrain_catalog_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Couldn't resolve app data dir: {e}"))?
        .join("terrain_catalog.md"))
}

/// Pure: reads the catalog file, or a seed default if it doesn't exist yet.
pub(crate) fn read_terrain_catalog_at(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|_| DEFAULT_TERRAIN_CATALOG.to_string())
}

fn write_terrain_catalog_at(path: &Path, content: &str) -> Result<(), String> {
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_terrain_catalog(app: AppHandle) -> Result<String, String> {
    Ok(read_terrain_catalog_at(&terrain_catalog_path(&app)?))
}

#[tauri::command]
pub fn save_terrain_catalog(app: AppHandle, content: String) -> Result<(), String> {
    write_terrain_catalog_at(&terrain_catalog_path(&app)?, &content)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Scratch(PathBuf);
    impl Scratch {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "terrain-test-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn read_terrain_catalog_at_returns_seed_default_when_missing() {
        let root = Scratch::new("missing");
        let path = root.0.join("terrain_catalog.md");
        let content = read_terrain_catalog_at(&path);
        assert!(content.contains("Terrain Catalog"));
    }

    #[test]
    fn write_then_read_terrain_catalog_roundtrips() {
        let root = Scratch::new("roundtrip");
        let path = root.0.join("terrain_catalog.md");
        write_terrain_catalog_at(&path, "# Terrain Catalog\n\n- Rocky Hill: blocks line of sight from below.\n").unwrap();
        let content = read_terrain_catalog_at(&path);
        assert!(content.contains("Rocky Hill"));
    }
}
