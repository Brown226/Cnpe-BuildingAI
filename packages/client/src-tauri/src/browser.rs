//! 内嵌浏览器（T3.6 方案 A）：Tauri 子级 Webview + 控制命令。
//!
//! 架构：主窗口内嵌一个子 webview（系统 WebView2/WKWebView/WebKitGTK），
//! 前端渲染地址栏/tab 面板；agent 经 agent-core 工具 → invoke 本模块命令
//! 驱动导航/求值/采集（browser_eval 用 eval_with_callback 回传结果）。
//!
//! 注意（tauri 2.11 文档）：Windows 上在同步命令/事件处理器里创建子 webview
//! 会死锁，因此 browser_open 为 async 命令且 webview 创建走 tauri::async_runtime。

use std::{
    sync::{mpsc, Mutex},
    time::Duration,
};

use tauri::{
    webview::{Webview, WebviewBuilder},
    AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl,
};

pub struct BrowserState(pub Mutex<Option<Webview>>);

/// 注入到浏览器 webview 的全局 hook，便于 agent 用 browser_eval 采集。
const BROWSER_INIT_SCRIPT: &str = r#"
(function(){
  Object.defineProperty(window, '__ba_ready', { value: true, writable: false });
})();
"#;

fn url_of(raw: &str) -> Result<url::Url, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("空 URL".into());
    }
    let normalized = if raw.starts_with("http://") || raw.starts_with("https://") {
        raw.to_string()
    } else {
        format!("https://{raw}")
    };
    url::Url::parse(&normalized).map_err(|e| format!("无效 URL {normalized}: {e}"))
}

/// 打开/导航内嵌浏览器。已存在则 navigate，否则创建子 webview。
#[tauri::command]
pub async fn browser_open(
    app: AppHandle,
    window: tauri::Window,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<String, String> {
    let state = app.state::<BrowserState>();
    let target = url_of(&url)?;
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(wv) = guard.as_ref() {
        wv.navigate(target).map_err(|e| e.to_string())?;
        let _ = wv.set_position(LogicalPosition::new(x, y));
        let _ = wv.set_size(LogicalSize::new(w, h));
        return Ok("navigated".into());
    }

    // 创建：Windows 下须 async 上下文，Tauri async command 已在 thread pool 运行
    let builder = WebviewBuilder::new("_browser", WebviewUrl::External(target))
        .initialization_script(BROWSER_INIT_SCRIPT);
    let wv = window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w, h))
        .map_err(|e| format!("创建浏览器视图失败: {e}"))?;
    *guard = Some(wv);
    Ok("created".into())
}

/// 调整内嵌浏览器区域（前端面板 bounds 同步）。
#[tauri::command]
pub fn browser_bounds(app: AppHandle, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let state = app.state::<BrowserState>();
    if let Some(wv) = state.0.lock().map_err(|e| e.to_string())?.as_ref() {
        let _ = wv.set_position(LogicalPosition::new(x, y));
        let _ = wv.set_size(LogicalSize::new(w, h));
    }
    Ok(())
}

#[tauri::command]
pub fn browser_navigate(app: AppHandle, url: String) -> Result<(), String> {
    let state = app.state::<BrowserState>();
    let target = url_of(&url)?;
    if let Some(wv) = state.0.lock().map_err(|e| e.to_string())?.as_ref() {
        wv.navigate(target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 执行 JS 并同步回传结果（agent 采集页面内容/文本的核心通道）。
#[tauri::command]
pub fn browser_eval(app: AppHandle, js: String) -> Result<String, String> {
    let state = app.state::<BrowserState>();
    let (tx, rx) = mpsc::channel();
    {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        let wv = guard.as_ref().ok_or("浏览器未打开")?;
        wv.eval_with_callback(js, move |result| {
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;
    }
    rx.recv_timeout(Duration::from_secs(6))
        .map_err(|_| "eval 超时（6s）".to_string())
}

#[tauri::command]
pub fn browser_go_back(app: AppHandle) -> Result<(), String> {
    browser_eval_raw(&app, "history.back()")
}

#[tauri::command]
pub fn browser_go_forward(app: AppHandle) -> Result<(), String> {
    browser_eval_raw(&app, "history.forward()")
}

#[tauri::command]
pub fn browser_reload(app: AppHandle) -> Result<(), String> {
    browser_eval_raw(&app, "location.reload()")
}

#[tauri::command]
pub fn browser_close(app: AppHandle) -> Result<(), String> {
    let state = app.state::<BrowserState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(wv) = guard.take() {
        let _ = wv.close();
    }
    Ok(())
}

fn browser_eval_raw(app: &AppHandle, js: &str) -> Result<(), String> {
    let state = app.state::<BrowserState>();
    if let Some(wv) = state.0.lock().map_err(|e| e.to_string())?.as_ref() {
        wv.eval(js).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 采集页面内文（便捷：browser_eval 的常见用途）。
#[tauri::command]
pub fn browser_read(app: AppHandle) -> Result<String, String> {
    browser_eval(app, "document.body ? document.body.innerText : ''".to_string())
}
