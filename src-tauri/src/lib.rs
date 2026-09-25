mod commands;
mod deezer;
mod discord_rpc;
mod soundcloud;
mod yandex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
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
      commands::analyze_track_tags,
      commands::build_recommendations,
      commands::format_duration,
      commands::save_update_file,
      commands::remove_file,
      commands::update_download_dir,
      commands::launch_file,
      commands::download_track_file,
      discord_rpc::discord_rpc_connect,
      discord_rpc::discord_rpc_set_activity,
      discord_rpc::discord_rpc_disconnect,
      soundcloud::soundcloud_search,
      soundcloud::soundcloud_stream_url,
      soundcloud::soundcloud_charts,
      soundcloud::soundcloud_search_artists,
      soundcloud::soundcloud_artist_tracks,
      soundcloud::soundcloud_search_playlists,
      soundcloud::soundcloud_playlist_tracks,
      deezer::deezer_search,
      deezer::deezer_search_artists,
      deezer::deezer_search_playlists,
      deezer::deezer_artist_tracks,
      deezer::deezer_playlist_tracks,
      deezer::deezer_track_stream,
      yandex::yandex_search,
      yandex::yandex_search_artists,
      yandex::yandex_search_playlists,
      yandex::yandex_artist_tracks,
      yandex::yandex_playlist_tracks,
      yandex::yandex_track_stream,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
