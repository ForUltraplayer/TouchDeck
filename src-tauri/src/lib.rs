mod config;
mod win_discord;
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
use std::thread;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State};
use win_discord::{DiscordBridge, DiscordCommand, DiscordState};
use win_focus::RunningStatus;
use win_media::{AudioDeviceInfo, NowPlayingInfo, SystemStats, VolumeState};
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
    message: Option<String>,
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
    let mut res = win_shell::inspect_dropped_path(&path)?;
    if res.kind == "url" && !res.url.is_empty() {
        if let Ok(fav) = win_shell::fetch_favicon_asset(&res.url) {
            res.icon_path = Some(fav);
        }
    }
    Ok(res)
}

#[tauri::command]
fn fetch_favicon(url: String) -> Result<String, String> {
    win_shell::fetch_favicon_asset(&url)
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

fn execute_single_action(
    action: &ButtonAction,
    discord: Option<&DiscordBridge>,
) -> Result<ExecuteResult, String> {
    match action {
        ButtonAction::App { .. } | ButtonAction::Folder { .. } | ButtonAction::Url { .. } => {
            win_focus::execute_launch_action(action)?;
            Ok(ExecuteResult {
                volume: None,
                message: None,
            })
        }
        ButtonAction::Media { command } => {
            win_media::send_media_command(command)?;
            Ok(ExecuteResult {
                volume: None,
                message: None,
            })
        }
        ButtonAction::Volume {
            command,
            step,
            target,
        } => {
            let vol = win_media::adjust_volume(command, *step, target)?;
            Ok(ExecuteResult {
                volume: Some(vol),
                message: None,
            })
        }
        ButtonAction::AudioDevice { device_id } => {
            let name = win_media::switch_audio_device(device_id.as_deref())?;
            Ok(ExecuteResult {
                volume: win_media::get_volume_state().ok(),
                message: Some(format!("출력 장치: {name}")),
            })
        }
        ButtonAction::Hotkey { keys } => {
            win_media::send_hotkey(keys)?;
            Ok(ExecuteResult {
                volume: None,
                message: None,
            })
        }
        ButtonAction::Discord { command } => {
            let bridge = discord.ok_or_else(|| "Discord 브리지가 초기화되지 않았습니다.".to_string())?;
            let st = bridge.get_state();
            if !st.authenticated {
                return Err("Discord RPC가 연결되지 않았습니다. 설정에서 승인해 주세요.".into());
            }
            match command.as_str() {
                "mute" => bridge.send(DiscordCommand::ToggleMute)?,
                "deaf" => bridge.send(DiscordCommand::ToggleDeaf)?,
                "disconnect" => bridge.send(DiscordCommand::DisconnectVoice)?,
                _ => return Err(format!("알 수 없는 Discord 명령: {command}")),
            }
            Ok(ExecuteResult {
                volume: None,
                message: None,
            })
        }
        ButtonAction::Multi { steps } => {
            let steps_owned = steps.clone();
            let discord_owned = discord.cloned();
            thread::spawn(move || {
                for step in steps_owned {
                    let _ = execute_single_action(&step.action, discord_owned.as_ref());
                    if step.delay_ms > 0 {
                        thread::sleep(Duration::from_millis(step.delay_ms as u64));
                    }
                }
            });
            Ok(ExecuteResult {
                volume: None,
                message: None,
            })
        }
        ButtonAction::Page { .. } | ButtonAction::Widget { .. } => Ok(ExecuteResult {
            volume: None,
            message: None,
        }),
    }
}

#[tauri::command]
fn execute_action(
    action: ButtonAction,
    discord: State<'_, DiscordBridge>,
) -> Result<ExecuteResult, String> {
    execute_single_action(&action, Some(discord.inner()))
}

#[tauri::command]
fn get_discord_state(discord: State<'_, DiscordBridge>) -> DiscordState {
    discord.get_state()
}

#[tauri::command]
fn authorize_discord(
    client_id: String,
    client_secret: String,
    discord: State<'_, DiscordBridge>,
) -> Result<(), String> {
    discord.send(DiscordCommand::Authorize {
        client_id,
        client_secret,
    })
}

#[tauri::command]
fn disconnect_discord(discord: State<'_, DiscordBridge>) -> Result<(), String> {
    discord.send(DiscordCommand::Disconnect)
}

#[tauri::command]
fn get_volume_state() -> Result<VolumeState, String> {
    win_media::get_volume_state()
}

#[tauri::command]
fn list_audio_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    win_media::list_audio_devices()
}

#[tauri::command]
fn get_now_playing() -> Option<NowPlayingInfo> {
    win_media::get_now_playing()
}

#[tauri::command]
fn get_system_stats() -> SystemStats {
    win_media::get_system_stats()
}

#[tauri::command]
fn get_running_status(proc_names: Vec<String>) -> RunningStatus {
    win_focus::get_running_status(&proc_names)
}

#[tauri::command]
fn set_no_activate(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    win_window::set_no_activate(hwnd.0 as isize, enabled);
    Ok(())
}

#[tauri::command]
fn clamp_window_pos(x: i32, y: i32, w: i32, h: i32) -> (i32, i32) {
    win_window::clamp_window_position(x, y, w, h)
}

#[tauri::command]
fn ensure_desktop_visible(window: tauri::WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    win_window::ensure_desktop_visible(hwnd.0 as isize);
    Ok(())
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
                let icon = win_shell::fetch_favicon_asset(&entry.url).ok().or_else(|| {
                    win_shell::extract_icon_asset(
                        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                        false,
                    )
                    .ok()
                });
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
                        toggle_minimize: false,
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
                badge: None,
                accent_color: None,
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
            let bridge = DiscordBridge::start(app.handle().clone());
            app.manage(bridge);

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
                            let _ = w.emit("tray-show", ());
                        }
                    }
                    "hide" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.emit("tray-hide", ());
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
                            let _ = w.emit("tray-show", ());
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
            fetch_favicon,
            import_image,
            resolve_asset,
            extract_icon_for_path,
            execute_action,
            get_discord_state,
            authorize_discord,
            disconnect_discord,
            get_volume_state,
            list_audio_devices,
            get_now_playing,
            get_system_stats,
            get_running_status,
            set_no_activate,
            clamp_window_pos,
            ensure_desktop_visible,
            set_autostart_cmd,
            open_data_folder,
            enable_portable_mode,
            import_launchers_json
        ])
        .run(tauri::generate_context!())
        .expect("error while running TouchDeck");
}
