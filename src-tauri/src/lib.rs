mod config;
mod i18n;
mod win_com;
mod win_discord;
mod win_focus;
mod win_hw;
mod win_media;
mod win_shell;
mod win_updater;
mod win_window;

use config::{
    copy_image_to_assets, get_data_dir, import_config_with_backup, is_portable_mode, load_config,
    resolve_asset_path, save_config_from_ui, set_autostart_preference, ButtonAction, ButtonItem,
    DeckConfig,
};
use i18n::{detail, t, Text};
use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};
use win_discord::{DiscordBridge, DiscordCommand, DiscordState};
use win_focus::RunningStatus;
use win_hw::SystemStats;
use win_media::{AudioDeviceInfo, NowPlayingInfo, VolumeState};
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

// Tray menu items with the language their labels currently show, kept so the
// labels can follow a language change without a restart.
struct TrayLabels {
    items: [(MenuItem<tauri::Wry>, Text); 4],
    lang: Mutex<i18n::Lang>,
}

// Call after a config save/import, off the main thread and outside the config lock.
fn refresh_tray_labels(app: &AppHandle) {
    let Some(tray) = app.try_state::<TrayLabels>() else {
        return;
    };
    let lang = i18n::current();
    let shown = std::mem::replace(&mut *tray.lang.lock().unwrap_or_else(|e| e.into_inner()), lang);
    if shown != lang {
        for (item, text) in &tray.items {
            let _ = item.set_text(text.in_lang(lang));
        }
    }
}

// Commands that touch files or COM are async + spawn_blocking: sync commands run
// on the main thread, and a stall there can stall the Explorer-owned desktop window.
#[tauri::command]
async fn get_config() -> Result<DeckConfig, String> {
    tauri::async_runtime::spawn_blocking(load_config)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn take_config_notice() -> Option<String> {
    config::take_config_notice()
}

#[tauri::command]
async fn save_config_cmd(app: AppHandle, config: DeckConfig) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_config_from_ui(&config)?;
        refresh_tray_labels(&app);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_system_language() -> String {
    i18n::system().code().into()
}

#[tauri::command]
async fn get_env_info() -> Result<EnvInfo, String> {
    tauri::async_runtime::spawn_blocking(|| {
        Ok(EnvInfo {
            data_dir: get_data_dir()?.to_string_lossy().to_string(),
            is_portable: is_portable_mode(),
            autostart: win_window::is_autostart_enabled(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn inspect_drop(path: String) -> Result<ResolvedDrop, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut res = win_shell::inspect_dropped_path(&path)?;
        if res.kind == "url" && !res.url.is_empty() {
            if let Ok(fav) = win_shell::fetch_favicon_asset(&res.url) {
                res.icon_path = Some(fav);
            }
        }
        Ok(res)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn fetch_favicon(url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || win_shell::fetch_favicon_asset(&url))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn import_image(path: String, prefix: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || copy_image_to_assets(&path, &prefix))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn resolve_asset(rel_path: String) -> Result<String, String> {
    Ok(resolve_asset_path(&rel_path)?.to_string_lossy().to_string())
}

#[tauri::command]
async fn extract_icon_for_path(path: String, is_folder: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || win_shell::extract_icon_asset(&path, is_folder))
        .await
        .map_err(|e| e.to_string())?
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
                message: Some(detail(Text::OutputDevice, name)),
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
            let bridge = discord.ok_or_else(|| t(Text::DiscordBridgeNotReady).to_string())?;
            let st = bridge.get_state();
            if !st.authenticated {
                return Err(t(Text::DiscordNotConnected).into());
            }
            match command.as_str() {
                "mute" => bridge.send(DiscordCommand::ToggleMute)?,
                "deaf" => bridge.send(DiscordCommand::ToggleDeaf)?,
                "disconnect" => bridge.send(DiscordCommand::DisconnectVoice)?,
                _ => return Err(detail(Text::UnknownDiscordCommand, command)),
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
async fn execute_action(
    action: ButtonAction,
    discord: State<'_, DiscordBridge>,
) -> Result<ExecuteResult, String> {
    let bridge = discord.inner().clone();
    tauri::async_runtime::spawn_blocking(move || execute_single_action(&action, Some(&bridge)))
        .await
        .map_err(|e| e.to_string())?
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
async fn check_update() -> Result<win_updater::UpdateInfo, String> {
    tauri::async_runtime::spawn_blocking(win_updater::check_for_update)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn apply_update(app: AppHandle, download_url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        win_updater::download_and_apply_update(&app, &download_url)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_volume_state() -> Result<VolumeState, String> {
    tauri::async_runtime::spawn_blocking(win_media::get_volume_state)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_audio_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    tauri::async_runtime::spawn_blocking(win_media::list_audio_devices)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_now_playing() -> Option<NowPlayingInfo> {
    tauri::async_runtime::spawn_blocking(win_media::get_now_playing)
        .await
        .ok()
        .flatten()
}

#[tauri::command]
async fn get_system_stats(include_temp: Option<bool>) -> Result<SystemStats, String> {
    let want_temp = include_temp.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || win_hw::get_system_stats(want_temp))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_running_status(proc_names: Vec<String>) -> RunningStatus {
    tauri::async_runtime::spawn_blocking(move || win_focus::get_running_status(&proc_names))
        .await
        .unwrap_or(RunningStatus {
            running: Vec::new(),
            foreground_proc: String::new(),
        })
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
fn sync_window_bounds(
    window: tauri::WebviewWindow,
    anchor_x: Option<i32>,
    anchor_y: Option<i32>,
    grid_w: f64,
    grid_h: f64,
    dock_w: f64,
    target_w: f64,
    target_h: f64,
    apply: Option<bool>,
) -> Result<win_window::WindowBoundsResult, String> {
    let apply = apply.unwrap_or(true);
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let cur = window.outer_position().map(|p| (p.x, p.y)).unwrap_or((100, 100));
    let scale = window.scale_factor().unwrap_or(1.0);
    let mut res = win_window::sync_window_bounds(
        hwnd, cur, scale, anchor_x, anchor_y, grid_w, grid_h, dock_w, target_w, target_h, apply,
    )?;
    if apply {
        let new_scale = window.scale_factor().unwrap_or(scale);
        if (new_scale - scale).abs() > 0.01 {
            res = win_window::sync_window_bounds(
                hwnd,
                (res.x, res.y),
                new_scale,
                anchor_x,
                anchor_y,
                grid_w,
                grid_h,
                dock_w,
                target_w,
                target_h,
                true,
            )?;
        }
    }
    Ok(res)
}

#[tauri::command]
fn set_desktop_layer(
    window: tauri::WebviewWindow,
    enabled: bool,
    always_on_top: Option<bool>,
) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    win_window::set_desktop_layer(hwnd.0 as isize, enabled, always_on_top.unwrap_or(false));
    Ok(())
}

#[tauri::command]
fn set_user_hidden(hidden: bool) {
    win_window::set_user_hidden(hidden);
}

#[tauri::command]
fn tick_desktop_visibility(window: tauri::WebviewWindow, always_on_top: bool) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    win_window::tick_desktop_visibility(hwnd.0 as isize, always_on_top);
    Ok(())
}

#[tauri::command]
async fn set_autostart_cmd(enabled: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let actual = win_window::set_autostart(enabled)?;
        if let Err(e) = set_autostart_preference(actual) {
            append_startup_log(&format!("save autostart preference failed: {e}"));
        }
        Ok(actual)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_data_folder() -> Result<(), String> {
    let dir = get_data_dir()?;
    win_focus::execute_launch_action(&ButtonAction::Folder {
        path: dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
async fn enable_portable_mode() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(enable_portable_mode_sync)
        .await
        .map_err(|e| e.to_string())?
}

fn enable_portable_mode_sync() -> Result<String, String> {
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
    let copy_res = (|| -> Result<(), String> {
        if current.join("config.json").exists() {
            std::fs::copy(current.join("config.json"), target.join("config.json"))
                .map_err(|e| detail(Text::ConfigCopyFailed, e))?;
        }
        if let Ok(entries) = std::fs::read_dir(current.join("assets")) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() {
                    if let Some(name) = p.file_name() {
                        std::fs::copy(&p, target.join("assets").join(name))
                            .map_err(|e| detail(Text::AssetCopyFailed, e))?;
                    }
                }
            }
        }
        Ok(())
    })();
    if let Err(e) = copy_res {
        let _ = std::fs::remove_dir_all(&target);
        return Err(e);
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
async fn import_launchers_json(app: AppHandle, path: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let imported = import_launchers_json_sync(&path)?;
        refresh_tray_labels(&app);
        Ok(imported)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn import_launchers_json_sync(path: &str) -> Result<usize, String> {
    let legacy_path = Path::new(path);
    if !legacy_path.exists() {
        return Err(detail(Text::FileNotFound, path));
    }
    let text = std::fs::read_to_string(legacy_path).map_err(|e| e.to_string())?;
    let map: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&text).map_err(|e| e.to_string())?;

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

    // Page 1 is replaced as a whole; the previous config.json is backed up first.
    import_config_with_backup(move |mut cfg| {
        if cfg.pages.is_empty() {
            cfg.pages.push(config::DeckPage {
                id: "page-1".into(),
                name: t(Text::PageMain).into(),
                slots: new_slots,
            });
        } else {
            cfg.pages[0].slots = new_slots;
        }
        cfg
    })?;
    Ok(imported)
}

#[tauri::command]
async fn export_config_file(
    app: AppHandle,
    path: String,
    config: DeckConfig,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // The export strips secrets, so it must never land on the live config.json.
        let live = std::fs::canonicalize(get_data_dir()?.join("config.json")).ok();
        if live.is_some() && std::fs::canonicalize(&path).ok() == live {
            return Err(t(Text::ExportOntoLiveConfig).into());
        }
        save_config_from_ui(&config)?;
        refresh_tray_labels(&app);
        // Exported files are meant to be shared or copied around: keep the
        // Discord client id but never the secret or the tokens.
        let mut exported = config;
        exported.discord.client_secret.clear();
        exported.discord.access_token.clear();
        exported.discord.refresh_token.clear();
        let json = serde_json::to_string_pretty(&exported).map_err(|e| e.to_string())?;
        std::fs::write(&path, json).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn import_config_file(app: AppHandle, path: String) -> Result<DeckConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let cfg: DeckConfig = serde_json::from_str(&text)
            .map_err(|e| detail(Text::InvalidConfigJson, e))?;
        if cfg.pages.is_empty() {
            return Err(t(Text::ConfigHasNoPages).into());
        }
        let saved = import_config_with_backup(move |_| cfg)?;
        refresh_tray_labels(&app);
        Ok(saved)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn append_startup_log(msg: &str) {
    let dir = get_data_dir().unwrap_or_else(|_| std::env::temp_dir());
    let path = dir.join("startup.log");
    // Bound the log size so repeated errors never grow indefinitely.
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > 128 * 1024 {
            let _ = std::fs::write(&path, b"");
        }
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = writeln!(f, "[{secs}] {msg}");
    }
}

fn build_tray_icon(app: &AppHandle, menu: &Menu<tauri::Wry>) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::new()
        .menu(menu)
        .tooltip("TouchDeck")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                win_window::set_user_hidden(false);
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.emit("tray-show", ());
                }
            }
            "hide" => {
                win_window::set_user_hidden(true);
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.emit("tray-hide", ());
                    let _ = w.hide();
                }
            }
            "settings" => {
                win_window::set_user_hidden(false);
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
                win_window::set_user_hidden(false);
                if let Some(w) = tray.app_handle().get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.emit("tray-show", ());
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app).map(|_| ())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let prev_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        append_startup_log(&format!("panic: {info}"));
        prev_hook(info);
    }));

    let res = tauri::Builder::default()
        // Must stay the first plugin: a second launch hands over to the running
        // instance here and exits before anything else touches config.json.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            win_window::set_user_hidden(false);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.emit("tray-show", ());
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let bridge = DiscordBridge::start(app.handle().clone());
            app.manage(bridge);

            // Loaded before the tray menu is built: this sets the backend language.
            let startup_cfg = load_config();
            if let Err(ref e) = startup_cfg {
                append_startup_log(&format!("startup config load failed: {e}"));
            }
            let saved_autostart = startup_cfg.as_ref().ok().and_then(|c| c.autostart);
            let lang = i18n::current();
            let item = |id: &str, text: Text| {
                MenuItem::with_id(app, id, text.in_lang(lang), true, None::<&str>)
                    .map(|item| (item, text))
            };
            let items = [
                item("show", Text::TrayShow)?,
                item("hide", Text::TrayHide)?,
                item("settings", Text::TraySettings)?,
                item("quit", Text::TrayQuit)?,
            ];
            let menu =
                Menu::with_items(app, &[&items[0].0, &items[1].0, &items[2].0, &items[3].0])?;
            app.manage(TrayLabels {
                items,
                lang: Mutex::new(lang),
            });

            // Sync or restore the Startup shortcut off the main UI thread.
            thread::spawn(move || match win_window::sync_autostart_on_startup(saved_autostart) {
                Ok(Some(val)) => {
                    if let Err(e) = set_autostart_preference(val) {
                        append_startup_log(&format!("autostart backfill failed: {e}"));
                    }
                }
                Ok(None) => {}
                Err(e) => append_startup_log(&format!("autostart sync failed: {e}")),
            });

            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_skip_taskbar(true);
                if let Ok(cfg) = startup_cfg {
                    if let (Some(x), Some(y)) = (cfg.window.x, cfg.window.y) {
                        let cols = cfg.grid.columns as f64;
                        let rows = cfg.grid.rows as f64;
                        let cell = cfg.grid.cell_size as f64;
                        let gap = cfg.grid.gap as f64;
                        let grid_w = cols * cell + (cols - 1.0).max(0.0) * gap + 28.0;
                        let grid_h = rows * cell + (rows - 1.0).max(0.0) * gap + 92.0;
                        if let Ok(hwnd) = w.hwnd() {
                            let scale = w.scale_factor().unwrap_or(1.0);
                            let cur = w.outer_position().map(|p| (p.x, p.y)).unwrap_or((x, y));
                            let res = win_window::sync_window_bounds(
                                hwnd.0 as isize,
                                cur,
                                scale,
                                Some(x),
                                Some(y),
                                grid_w,
                                grid_h,
                                0.0,
                                grid_w,
                                grid_h,
                                true,
                            );
                            if res.is_ok() {
                                let new_scale = w.scale_factor().unwrap_or(scale);
                                if (new_scale - scale).abs() > 0.01 {
                                    let _ = win_window::sync_window_bounds(
                                        hwnd.0 as isize,
                                        (x, y),
                                        new_scale,
                                        Some(x),
                                        Some(y),
                                        grid_w,
                                        grid_h,
                                        0.0,
                                        grid_w,
                                        grid_h,
                                        true,
                                    );
                                }
                            }
                        }
                    }
                }
            }

            if let Err(e) = build_tray_icon(app.handle(), &menu) {
                append_startup_log(&format!("initial tray icon build failed: {e}"));
                let handle = app.handle().clone();
                let retry_menu = menu.clone();
                thread::spawn(move || {
                    // Explorer's notification area may not be ready right after Windows logon.
                    const DELAYS_MS: [u64; 10] =
                        [1000, 1500, 2000, 2000, 3000, 3000, 4000, 5000, 5000, 5000];
                    for (idx, delay) in DELAYS_MS.iter().enumerate() {
                        thread::sleep(Duration::from_millis(*delay));
                        let (tx, rx) = std::sync::mpsc::sync_channel::<Result<(), String>>(1);
                        let h = handle.clone();
                        let m = retry_menu.clone();
                        if handle
                            .run_on_main_thread(move || {
                                let res = build_tray_icon(&h, &m).map_err(|err| err.to_string());
                                let _ = tx.send(res);
                            })
                            .is_err()
                        {
                            break;
                        }
                        match rx.recv_timeout(Duration::from_secs(5)) {
                            Ok(Ok(())) => {
                                append_startup_log(&format!(
                                    "tray icon created on retry {}",
                                    idx + 1
                                ));
                                return;
                            }
                            Ok(Err(err)) => {
                                if idx + 1 == DELAYS_MS.len() {
                                    append_startup_log(&format!(
                                        "tray icon retry {} failed (giving up): {err}",
                                        idx + 1
                                    ));
                                }
                            }
                            Err(_) => break,
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            take_config_notice,
            save_config_cmd,
            get_system_language,
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
            sync_window_bounds,
            set_desktop_layer,
            set_user_hidden,
            tick_desktop_visibility,
            set_autostart_cmd,
            open_data_folder,
            enable_portable_mode,
            import_launchers_json,
            export_config_file,
            import_config_file,
            check_update,
            apply_update
        ])
        .run(tauri::generate_context!());

    if let Err(e) = res {
        append_startup_log(&format!("error while running TouchDeck: {e}"));
        std::process::exit(1);
    }
}
