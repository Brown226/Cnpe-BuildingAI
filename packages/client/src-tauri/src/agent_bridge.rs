//! 客户端 ↔ agent-core sidecar 的 stdio JSON-RPC 桥（设计文档 §3.1）。
//!
//! 职责：拉起 Node sidecar 进程、按行收发协议帧、
//! 把服务端通知（approval/request、engine/event）转为 Tauri 事件，
//! 并为渲染进程提供通用的请求-响应命令。
//!
//! 协议约定见 packages/@buildingai/agent-core/src/protocol/messages.ts。

use serde::Serialize;
use serde_json::{json, Map, Value};
// Tauri v2：事件收发须显式引入 trait（emit/listen 均挂在 Emitter 上）；path() 挂在 Manager 上
use tauri::{Emitter, Manager};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicI64, Ordering},
        mpsc, Arc, Mutex,
    },
};

/// 随包自包含运行时（打包期经 bundle.resources 装配到 resource_dir）。
///
/// 布局（由 scripts/build-sidecar-bundle.mjs 产出）：
/// `<resource_dir>/agent-core-runtime/node(.exe)` + `<...>/agent-core/dist/index.js`
struct BundledRuntime {
    node: PathBuf,
    script: PathBuf,
    cwd: PathBuf,
}

/// 探测随包运行时；开发环境（未打包）不存在该目录，返回 None 走系统 node。
fn bundled_runtime(app: &tauri::AppHandle) -> Option<BundledRuntime> {
    const NODE_EXE: &str = if cfg!(windows) { "node.exe" } else { "node" };
    let base = app.path().resource_dir().ok()?.join("agent-core-runtime");
    if !base.is_dir() {
        return None;
    }
    let node = base.join(NODE_EXE);
    if !node.is_file() {
        return None;
    }
    let script = base.join("agent-core").join("dist").join("index.js");
    if !script.is_file() {
        return None;
    }
    let cwd = base.join("agent-core");
    Some(BundledRuntime { node, script, cwd })
}

#[derive(Default)]
pub struct AgentBridgeState {
    child: Mutex<Option<Child>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    /// jsonrpc id -> (发送端)，收到对应响应后投递
    pending: Arc<Mutex<HashMap<i64, mpsc::Sender<Result<Value, String>>>>>,
    next_id: AtomicI64,
}

#[derive(Clone, Serialize)]
struct RpcLine {
    jsonrpc: &'static str,
    id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

/// 拉起 sidecar 并启动 stdout 读线程。
///
/// 解析链：显式参数 → 随包自包含运行时（resource_dir/agent-core-runtime，打包态）
/// → 开发目录约定（default_script_path）+ 系统 node（开发兜底）。
/// script/node_bin/cwd 参数保留用于开发调试覆盖。
#[tauri::command]
pub fn agent_start(
    state: tauri::State<'_, AgentBridgeState>,
    app: tauri::AppHandle,
    script: Option<String>,
    node_bin: Option<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok(()); // 幂等：已在运行
    }

    // 解析顺序：显式参数 → 随包自包含运行时（打包态）→ 开发目录约定 / 系统 node
    let bundled = bundled_runtime(&app);
    let script_path = script
        .or_else(|| bundled.as_ref().map(|b| b.script.to_string_lossy().into_owned()))
        .unwrap_or_else(default_script_path);
    if !std::path::Path::new(&script_path).exists() {
        return Err(format!("sidecar 入口不存在: {script_path}"));
    }

    let explicit_node = node_bin.is_some();
    let node_path = node_bin
        .or_else(|| bundled.as_ref().map(|b| b.node.to_string_lossy().into_owned()))
        .unwrap_or_else(|| "node".into());

    let working_dir = cwd
        .or_else(|| bundled.as_ref().map(|b| b.cwd.to_string_lossy().into_owned()))
        .unwrap_or_else(|| {
            std::path::Path::new(&script_path)
                .parent()
                .and_then(|p| p.parent())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| ".".to_string())
        });

    let mut child = Command::new(&node_path)
        .arg(&script_path)
        .current_dir(&working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            if bundled.is_none() && !explicit_node {
                format!(
                    "启动 sidecar 失败: {e}（未检测到随包运行时，且系统可能未安装 Node——请重新安装客户端或安装 Node 22+）"
                )
            } else {
                format!("启动 sidecar 失败: {e}")
            }
        })?;

    let stdout = child.stdout.take().ok_or("无法获取 sidecar stdout")?;
    let stdin = child.stdin.take().ok_or("无法获取 sidecar stdin")?;
    *state.stdin.lock().map_err(|e| e.to_string())? = Some(stdin);
    *guard = Some(child);

    // 读线程：逐行分发到事件系统 / pending 表
    let pending_map = state.pending.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(trimmed) else { continue };

            let id = value.get("id").and_then(Value::as_i64).unwrap_or(-2);
            let method = value.get("method").and_then(Value::as_str).map(String::from);

            match method {
                Some(name) => {
                    // 服务端通知 → 转发给 WebView
                    let payload = json!({ "method": name, "params": value.get("params") });
                    let _ = app.emit("agent-event", payload);
                }
                None => {
                    // 响应帧 → 投递给等待中的调用方
                    if let Some(sender) = pending_map.lock().ok().and_then(|mut m| m.remove(&id)) {
                        let result = if let Some(err) = value.get("error") {
                            Err(format!("{err}"))
                        } else {
                            Ok(value.get("result").cloned().unwrap_or(Value::Null))
                        };
                        let _ = sender.send(result);
                    }
                }
            }
        }
        // 进程退出：通知 WebView
        let _ = app.emit("agent-event", json!({"method": "engine/event", "params": {"kind": "process_exit"}}));
    });

    Ok(())
}

/// 通用 RPC 调用（30s 超时；长对话请改走通知流）。
#[tauri::command]
pub fn agent_rpc(
    state: tauri::State<'_, AgentBridgeState>,
    method: String,
    params: Option<Map<String, Value>>,
) -> Result<Value, String> {
    let id = state.next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel();

    state
        .pending
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, tx);

    let frame = RpcLine {
        jsonrpc: "2.0",
        id,
        method: Some(method),
        params: params.map(Value::Object),
    };
    write_line(&state.stdin, &frame)?;

    match rx.recv_timeout(std::time::Duration::from_secs(30)) {
        Ok(result) => result,
        Err(_) => {
            // 清理悬挂条目
            if let Ok(mut m) = state.pending.lock() {
                m.remove(&id);
            }
            Err("sidecar 响应超时".into())
        }
    }
}

/// 发送通知帧（审批结果等无需响应的场景）。
#[tauri::command]
pub fn agent_notify(state: tauri::State<'_, AgentBridgeState>, method: String, params: Value) -> Result<(), String> {
    let frame = RpcLine {
        jsonrpc: "2.0",
        id: 0,
        method: Some(method),
        params: Some(params),
    };
    write_line(&state.stdin, &frame)
}

/// 停止 sidecar（杀进程树交给 sidecar 自身的 disconnect 处理逻辑优雅退出）。
#[tauri::command]
pub fn agent_stop(state: tauri::State<'_, AgentBridgeState>) -> Result<(), String> {
    drop(state.stdin.lock().map_err(|e| e.to_string())?.take());
    if let Some(mut child) = state.child.lock().map_err(|e| e.to_string())?.take() {
        let _ = child.kill();
    }
    Ok(())
}

/// 系统目录选择框（复刻 Kun workspace:pick-directory）：用户取消返回 None
#[tauri::command]
pub fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .blocking_pick_folder()
        .map(|p| p.to_string())
}

/// 在系统文件管理器中定位文件/目录
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

fn write_line(
    stdin: &Arc<Mutex<Option<ChildStdin>>>,
    frame: &RpcLine,
) -> Result<(), String> {
    let mut guard = stdin.lock().map_err(|e| e.to_string())?;
    let handle = guard.as_mut().ok_or("sidecar 未运行")?;
    let mut line = serde_json::to_string(frame).map_err(|e| e.to_string())?;
    line.push('\n');
    handle
        .write_all(line.as_bytes())
        .and_then(|_| handle.flush())
        .map_err(|e| format!("写入 sidecar 失败: {e}"))
}

fn default_script_path() -> String {
    // 多候选探测，摆脱对进程 CWD 的依赖（exe 可能从任意目录启动）：
    // ① cwd/packages/@buildingai/...（仓库根启动）
    // ② cwd/../../packages/@buildingai/...（src-tauri 启动，开发期约定）
    // ③ exe 同级/packages/@buildingai/...（发布期随包布局）
    let rel_repo: std::path::PathBuf =
        ["packages", "@buildingai", "agent-core", "dist", "index.js"].iter().collect();
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join(&rel_repo));
        candidates.push(
            cwd.join(["..", ".."].iter().collect::<std::path::PathBuf>())
                .join(&rel_repo),
        );
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(&rel_repo));
        }
    }
    for c in &candidates {
        if c.exists() {
            return c.to_string_lossy().to_string();
        }
    }
    candidates
        .first()
        .map(|c| c.to_string_lossy().to_string())
        .unwrap_or_default()
}
