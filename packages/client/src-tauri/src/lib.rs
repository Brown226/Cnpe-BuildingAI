mod agent_bridge;
mod browser;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(agent_bridge::AgentBridgeState::default())
        .manage(browser::BrowserState(std::sync::Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            agent_bridge::agent_start,
            agent_bridge::agent_rpc,
            agent_bridge::agent_notify,
            agent_bridge::agent_stop,
            agent_bridge::pick_folder,
            agent_bridge::reveal_path,
            browser::browser_open,
            browser::browser_bounds,
            browser::browser_navigate,
            browser::browser_eval,
            browser::browser_go_back,
            browser::browser_go_forward,
            browser::browser_reload,
            browser::browser_read,
            browser::browser_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
