mod campaign;
mod dm;
mod local_llm;
mod oauth;
mod party_listener;
mod terrain;
mod tts;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_opener::init())
    .manage(dm::DmTurnControl::default())
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
      dm::warmup_dm_session,
      dm::check_claude_auth,
      dm::connect_claude,
      dm::install_claude_cli,
      dm::cancel_dm_turn,
      local_llm::ask_dm_local,
      local_llm::end_local_dm_session,
      local_llm::list_local_llm_models,
      party_listener::start_party_listener,
      party_listener::party_listener_port,
      party_listener::local_lan_ip,
      party_listener::respond_to_player_turn,
      party_listener::push_narration,
      campaign::list_campaigns,
      campaign::create_campaign,
      campaign::export_campaign,
      campaign::import_campaign,
      campaign::establish_campaign_lore,
      campaign::update_campaign_lore,
      campaign::read_campaign_lore,
      campaign::read_campaign_notes,
      campaign::save_campaign_notes,
      campaign::read_campaign_memory,
      campaign::read_campaign_flagged_facts,
      campaign::append_session_recap,
      campaign::append_memory_note,
      campaign::append_entity_fact,
      campaign::append_location_fact,
      campaign::upsert_party_member,
      campaign::resolve_flagged_fact,
      campaign::set_npc_voice,
      campaign::read_npc_voices,
      campaign::campaign_archetype_voice_count,
      campaign::sync_dm_rules,
      campaign::log_voice_debug,
      campaign::reconcile_npc_voices,
      campaign::reconcile_campaign_hooks,
      campaign::read_campaign_entities,
      campaign::read_campaign_locations,
      campaign::compact_campaign_memory,
      campaign::compact_campaign_knowledge,
      campaign::extract_module_text,
      campaign::chapterize_and_import_module,
      campaign::get_module_chapters,
      campaign::list_campaign_modules,
      campaign::set_active_module,
      campaign::set_current_chapter,
      campaign::read_campaign_plan,
      campaign::resolve_chapter_section,
      campaign::suggest_session_plan,
      terrain::read_terrain_catalog,
      terrain::save_terrain_catalog,
      tts::speak_text,
      tts::warmup_tts,
      tts::probe_cuda,
      tts::set_tts_engine,
      tts::f5_runtime_installed,
      tts::install_f5_runtime,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
