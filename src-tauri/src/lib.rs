mod dm;
mod oauth;
mod party_listener;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      oauth::start_oauth_server,
      oauth::get_fresh_access_token,
      oauth::clear_google_token,
      dm::ask_dm,
      party_listener::start_party_listener,
      party_listener::party_listener_port,
      party_listener::local_lan_ip,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
