; Custom NSIS uninstall hook (see tauri.conf.json's bundle.windows.nsis.installerHooks).
;
; The standard Tauri/NSIS uninstall only removes what the installer itself
; put down (the app binary, shortcuts, registry keys) -- it never touches
; anything the app wrote at runtime. Everything Tavern Sheet writes (campaign
; data, memory/entities/locations files, downloaded Piper voices, settings)
; lives under one root, $LOCALAPPDATA\com.nabil.dndsheet (see campaign.rs's
; campaigns_root / tts.rs's ensure_voice_available, both built on Tauri's
; app_data_dir() -- confirmed on disk, not $APPDATA\..., Tauri v2 resolves
; app_data_dir() to LOCAL AppData on Windows). Left alone, that directory
; survives an uninstall/reinstall untouched, which is what prompted this.
;
; Runs AFTER the normal uninstall (files/shortcuts/registry already gone) so
; this is purely an optional final step, never a partial/broken uninstall if
; the user says no.
!macro NSIS_HOOK_POSTUNINSTALL
  MessageBox MB_YESNO|MB_ICONQUESTION "Remove all Tavern Sheet campaign data, memory, and settings too?$\r$\n$\r$\nThis deletes everything in:$\r$\n$LOCALAPPDATA\com.nabil.dndsheet$\r$\n$\r$\nThis cannot be undone. Choose No to keep your campaigns in case you reinstall later." IDYES ts_remove_data IDNO ts_keep_data
  ts_remove_data:
    RMDir /r "$LOCALAPPDATA\com.nabil.dndsheet"
    Delete "$TEMP\tavern_sheet_claude_debug.log"
  ts_keep_data:
!macroend
