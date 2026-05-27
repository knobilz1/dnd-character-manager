fn main() {
    // Forward GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the Rust compiler so
    // they can be embedded via env!() at compile time (never in the JS bundle).
    //
    // In CI the vars are set as environment variables in the runner — env!() picks
    // them up automatically.  Locally they live in the repo-root .env file, so
    // build.rs reads that file and emits cargo:rustc-env directives.
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let env_path = std::path::Path::new(&manifest_dir).join("../.env");

    // Tell Cargo to re-run this script when .env or the env vars change.
    println!("cargo:rerun-if-changed={}", env_path.display());
    println!("cargo:rerun-if-env-changed=GOOGLE_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=GOOGLE_CLIENT_SECRET");

    if let Ok(contents) = std::fs::read_to_string(&env_path) {
        for line in contents.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((key, val)) = line.split_once('=') {
                let key = key.trim();
                let val = val.trim();
                if matches!(key, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET") {
                    println!("cargo:rustc-env={key}={val}");
                }
            }
        }
    }

    tauri_build::build()
}
