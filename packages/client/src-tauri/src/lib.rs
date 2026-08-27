mod agent_bridge;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(agent_bridge::AgentBridgeState::default())
        .invoke_handler(tauri::generate_handler![
            agent_bridge::agent_start,
            agent_bridge::agent_rpc,
            agent_bridge::agent_notify,
            agent_bridge::agent_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
