mod config;
mod win_focus;
mod win_media;
mod win_shell;
mod win_window;

use config::{
    copy_image_to_assets, get_data_dir, is_portable_mode, load_config, resolve_asset_path,
    save_config, ButtonAction, ButtonItem, DeckConfig,
};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use win_media::VolumeState;
use win_shell::ResolvedDrop;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvInfo {
    data_dir: String,
    is_portable: bool,
    autostart: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteResult {
    volume: Option<VolumeState>,
}

#[tauri::command]
fn get_config() -> Result<DeckConfig, String> {
    load_config()
}

#[tauri::command]
fn save_config_cmd(config: DeckConfig) -> Result<(), String> {
    save_config(&config)
}

#[tauri::command]
fn get_env_info() -> Result<EnvInfo, String> {
    Ok(EnvInfo {
        data_dir: get_data_dir()?.to_string_lossy().to_string(),
        is_portable: is_portable_mode(),
        autostart: win_window::is_autostart_enabled(),
    })
}

#[tauri::command]
fn inspect_drop(path: String) -> Result<ResolvedDrop, String> {
    win_shell::inspect_dropped_path(&path)
}

#[tauri::command]
fn import_image(path: String, prefix: String) -> Result<String, String> {
    copy_image_to_assets(&path, &prefix)
}

#[tauri::command]
fn resolve_asset(rel_path: String) -> Result<String, String> {
    Ok(resolve_asset_path(&rel_path)?.to_string_lossy().to_string())
}

#[tauri::command]
fn extract_icon_for_path(path: String, is_folder: bool) -> Result<String, String> {
    win_shell::extract_icon_asset(&path, is_folder)
}

#[tauri::command]
fn execute_action(action: ButtonAction) -> Result<ExecuteResult, String> {
    match &action {
        ButtonAction::App { .. } | ButtonAction::Folder { .. } | ButtonAction::Url { .. } => {
            win_focus::execute_launch_action(&action)?;
            Ok(ExecuteResult { volume: None })
        }
        ButtonAction::Media { command } => {
            win_media::send_media_command(command)?;
            Ok(ExecuteResult { volume: None })
        }
        ButtonAction::Volume { command, step } => {
            let vol = win_media::adjust_volume(command, *step)?;
            Ok(ExecuteResult { volume: Some(vol) })
        }
        ButtonAction::Hotkey { keys } => {
            win_media::send_hotkey(keys)?;
            Ok(ExecuteResult { volume: None })
        }
        ButtonAction::Page { .. } => Ok(ExecuteResult { volume: None }),
    }
}

#[tauri::command]
fn get_volume_state() -> Result<VolumeState, String> {
    win_media::get_volume_state()
}

#[tauri::command]
fn set_autostart_cmd(enabled: bool) -> Result<bool, String> {
    win_window::set_autostart(enabled)
}

#[tauri::command]
fn open_data_folder() -> Result<(), String> {
    let dir = get_data_dir()?;
    win_focus::execute_launch_action(&ButtonAction::Folder {
        path: dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn enable_portable_mode() -> Result<String, String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe_path
        .parent()
        .ok_or_else(|| "exe parent not found".to_string())?;
    let target = exe_dir.join("data");
    if target.exists() {
        return Ok(target.to_string_lossy().to_string());
    }
    let current = get_data_dir()?;
    std::fs::create_dir_all(target.join("assets")).map_err(|e| e.to_string())?;
    if current.join("config.json").exists() {
        let _ = std::fs::copy(current.join("config.json"), target.join("config.json"));
    }
    if let Ok(entries) = std::fs::read_dir(current.join("assets")) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Some(name) = p.file_name() {
                    let _ = std::fs::copy(&p, target.join("assets").join(name));
                }
            }
        }
    }
    Ok(target.to_string_lossy().to_string())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyLauncherEntry {
    mode: String,
    #[serde(default)]
    proc: String,
    #[serde(default)]
    exe: String,
    #[serde(default)]
    args: String,
    #[serde(default)]
    work_dir: String,
    #[serde(default)]
    folder: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    class_hint: String,
    #[serde(default)]
    title_hint: String,
}

#[tauri::command]
fn import_launchers_json(path: String) -> Result<usize, String> {
    let legacy_path = Path::new(&path);
    if !legacy_path.exists() {
        return Err(format!("파일을 찾을 수 없습니다: {path}"));
    }
    let text = std::fs::read_to_string(legacy_path).map_err(|e| e.to_string())?;
    let map: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&text).map_err(|e| e.to_string())?;

    let mut cfg = load_config()?;
    let mut new_slots: HashMap<String, ButtonItem> = HashMap::new();
    let mut imported = 0usize;

    for (idx, (json_key, val)) in map.iter().enumerate() {
        let entry: LegacyLauncherEntry =
            serde_json::from_value(val.clone()).map_err(|e| e.to_string())?;

        let (action, icon_path) = match entry.mode.as_str() {
            "folder" => {
                let icon = win_shell::extract_icon_asset(r"C:\Windows\explorer.exe", false).ok();
                (ButtonAction::Folder { path: entry.folder }, icon)
            }
            "url" => {
                let icon = win_shell::extract_icon_asset(
                    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                    false,
                )
                .ok();
                (ButtonAction::Url { url: entry.url }, icon)
            }
            _ => {
                let icon = win_shell::extract_icon_asset(&entry.exe, false).ok();
                (
                    ButtonAction::App {
                        exe: entry.exe,
                        args: entry.args,
                        work_dir: entry.work_dir,
                        proc_name: entry.proc,
                        class_hint: entry.class_hint,
                        title_hint: entry.title_hint,
                    },
                    icon,
                )
            }
        };

        new_slots.insert(
            idx.to_string(),
            ButtonItem {
                id: format!("btn-import-{}", json_key.to_lowercase()),
                label: json_key.replace('_', " "),
                show_label: true,
                font_size: 13,
                text_color: "#FFFFFF".into(),
                bg_color: None,
                bg_opacity: None,
                icon_path,
                action,
            },
        );
        imported += 1;
    }

    if cfg.pages.is_empty() {
        cfg.pages.push(config::DeckPage {
            id: "page-1".into(),
            name: "메인".into(),
            slots: new_slots,
        });
    } else {
        cfg.pages[0].slots = new_slots;
    }
    save_config(&cfg)?;
    Ok(imported)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let show_i = MenuItem::with_id(app, "show", "TouchDeck 보이기", true, None::<&str>)?;
            let hide_i = MenuItem::with_id(app, "hide", "숨기기", true, None::<&str>)?;
            let settings_i =
                MenuItem::with_id(app, "settings", "설정 열기", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &hide_i, &settings_i, &quit_i])?;

            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_skip_taskbar(true);
            }

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("TouchDeck")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                    "settings" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                            let _ = w.emit("open-settings", ());
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config_cmd,
            get_env_info,
            inspect_drop,
            import_image,
            resolve_asset,
            extract_icon_for_path,
            execute_action,
            get_volume_state,
            set_autostart_cmd,
            open_data_folder,
            enable_portable_mode,
            import_launchers_json
        ])
        .run(tauri::generate_context!())
        .expect("error while running TouchDeck");
}
