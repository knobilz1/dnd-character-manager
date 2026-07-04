mod campaign;
mod dm;
mod oauth;
mod party_listener;
mod terrain;

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
      campaign::list_campaigns,
      campaign::create_campaign,
      campaign::read_campaign_notes,
      campaign::save_campaign_notes,
      campaign::read_campaign_memory,
      campaign::append_session_recap,
      campaign::append_memory_note,
      campaign::compact_campaign_memory,
      campaign::extract_module_text,
      campaign::chapterize_and_import_module,
      campaign::get_module_chapters,
      campaign::set_current_chapter,
      campaign::read_campaign_plan,
      campaign::suggest_session_plan,
      terrain::read_terrain_catalog,
      terrain::save_terrain_catalog,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
