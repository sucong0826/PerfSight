
pub mod models;
pub mod collector;
pub mod commands;
pub mod database;
pub mod analysis;
pub mod ws_server;

use commands::CollectionState;
use database::Database;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Get platform-specific app data directory
            // Windows: C:\Users\Username\AppData\Local\com.perfsight.dev
            // Mac: ~/Library/Application Support/com.perfsight.dev
            // Linux: ~/.local/share/com.perfsight.dev
            let app_data_dir = app.path().app_local_data_dir().expect("Failed to get app data dir");
            
            // Ensure directory exists
            if !app_data_dir.exists() {
                std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data dir");
            }
            
            let db_path = app_data_dir.join("perfsight.db");
            println!("Database path: {:?}", db_path);

            let db = Database::new(db_path.to_str().unwrap()).expect("Failed to init DB");
            
            app.manage(db);
            app.manage(CollectionState::new());
            
            // Start WebSocket Server for Chrome Extension
            ws_server::start_server(app.handle().clone());
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_process_list,
            commands::get_collection_status,
            commands::start_collection,
            commands::stop_collection,
            commands::get_reports,
            commands::get_report_detail,
            commands::delete_report,
            commands::delete_reports,
            commands::debug_get_macos_rusage,
            commands::export_report_pdf,
            commands::export_report_dataset,
            commands::import_report_dataset
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
