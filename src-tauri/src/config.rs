use crate::i18n::{self, detail, t, Text};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static CONFIG_LOCK: Mutex<()> = Mutex::new(());
// User-facing message left by a config reset, handed to the UI once.
static CONFIG_NOTICE: Mutex<Option<String>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowConfig {
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub always_on_top: bool,
    pub desktop_layer: bool,
    pub locked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridConfig {
    pub columns: u32,
    pub rows: u32,
    pub cell_size: u32,
    pub gap: u32,
    pub border_radius: u32,
}

fn default_button_style() -> String {
    "solid".into()
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeConfig {
    pub background_type: String, // "solid" | "gradient" | "image"
    pub background_color: String,
    pub background_opacity: u8, // 0..=100
    pub gradient_end_color: String,
    pub background_image: Option<String>,
    pub background_blur: u32,
    pub background_dim: u8, // 0..=100
    pub font_family: String,
    pub default_button_color: String,
    pub default_button_opacity: u8,
    #[serde(default = "default_button_style")]
    pub button_style: String, // "solid" | "glass" | "transparent"
    #[serde(default = "default_true")]
    pub auto_font_size: bool,
    #[serde(default = "default_true")]
    pub icon_rounded: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordConfig {
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiStep {
    pub action: Box<ButtonAction>,
    #[serde(default)]
    pub delay_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ButtonAction {
    App {
        exe: String,
        #[serde(default)]
        args: String,
        #[serde(default, rename = "workDir")]
        work_dir: String,
        #[serde(default, rename = "procName")]
        proc_name: String,
        #[serde(default, rename = "classHint")]
        class_hint: String,
        #[serde(default, rename = "titleHint")]
        title_hint: String,
        #[serde(default, rename = "toggleMinimize")]
        toggle_minimize: bool,
    },
    Folder {
        path: String,
    },
    Url {
        url: String,
    },
    Media {
        command: String, // "play_pause" | "next" | "prev" | "stop"
    },
    Volume {
        command: String, // "up" | "down" | "mute"
        #[serde(default = "default_step")]
        step: u8,
        #[serde(default = "default_speaker")]
        target: String, // "speaker" | "mic"
    },
    AudioDevice {
        #[serde(default, rename = "deviceId")]
        device_id: Option<String>, // None = cycle output devices
    },
    Hotkey {
        keys: Vec<String>,
    },
    Page {
        #[serde(rename = "pageIndex")]
        page_index: usize,
    },
    Multi {
        steps: Vec<MultiStep>,
    },
    Discord {
        command: String, // "mute" | "deaf" | "disconnect"
    },
    Widget {
        kind: String, // "clock" | "sys_stats" | "now_playing"
        #[serde(default)]
        metrics: Vec<String>,
    },
}

fn default_step() -> u8 {
    5
}

fn default_speaker() -> String {
    "speaker".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ButtonItem {
    pub id: String,
    pub label: String,
    pub show_label: bool,
    pub font_size: u32,
    pub text_color: String,
    pub bg_color: Option<String>,
    pub bg_opacity: Option<u8>,
    pub icon_path: Option<String>,
    #[serde(default)]
    pub badge: Option<String>,
    #[serde(default)]
    pub accent_color: Option<String>,
    pub action: ButtonAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckPage {
    pub id: String,
    pub name: String,
    pub slots: HashMap<String, ButtonItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckConfig {
    pub version: u32,
    pub window: WindowConfig,
    pub grid: GridConfig,
    pub theme: ThemeConfig,
    pub pages: Vec<DeckPage>,
    #[serde(default)]
    pub vault: Vec<ButtonItem>,
    #[serde(default)]
    pub discord: DiscordConfig,
    #[serde(default = "default_true")]
    pub auto_check_update: bool,
    #[serde(default)]
    pub language: Option<String>, // "ko" | "en" | "ja"; None = follow Windows
}

impl Default for DeckConfig {
    fn default() -> Self {
        let mut page2_slots = HashMap::new();
        page2_slots.insert(
            "0".to_string(),
            ButtonItem {
                id: "btn-vol-down".into(),
                label: t(Text::LabelVolumeDown).into(),
                show_label: true,
                font_size: 13,
                text_color: "#FFFFFF".into(),
                bg_color: None,
                bg_opacity: None,
                icon_path: None,
                badge: None,
                accent_color: None,
                action: ButtonAction::Volume {
                    command: "down".into(),
                    step: 5,
                    target: "speaker".into(),
                },
            },
        );
        page2_slots.insert(
            "1".to_string(),
            ButtonItem {
                id: "btn-vol-mute".into(),
                label: t(Text::LabelMute).into(),
                show_label: true,
                font_size: 13,
                text_color: "#FFFFFF".into(),
                bg_color: None,
                bg_opacity: None,
                icon_path: None,
                badge: None,
                accent_color: None,
                action: ButtonAction::Volume {
                    command: "mute".into(),
                    step: 0,
                    target: "speaker".into(),
                },
            },
        );
        page2_slots.insert(
            "2".to_string(),
            ButtonItem {
                id: "btn-vol-up".into(),
                label: t(Text::LabelVolumeUp).into(),
                show_label: true,
                font_size: 13,
                text_color: "#FFFFFF".into(),
                bg_color: None,
                bg_opacity: None,
                icon_path: None,
                badge: None,
                accent_color: None,
                action: ButtonAction::Volume {
                    command: "up".into(),
                    step: 5,
                    target: "speaker".into(),
                },
            },
        );
        page2_slots.insert(
            "3".to_string(),
            ButtonItem {
                id: "btn-mic-mute".into(),
                label: t(Text::LabelMic).into(),
                show_label: true,
                font_size: 13,
                text_color: "#FFFFFF".into(),
                bg_color: None,
                bg_opacity: None,
                icon_path: None,
                badge: None,
                accent_color: None,
                action: ButtonAction::Volume {
                    command: "mute".into(),
                    step: 0,
                    target: "mic".into(),
                },
            },
        );
        page2_slots.insert(
            "4".to_string(),
            ButtonItem {
                id: "btn-audio-dev".into(),
                label: t(Text::LabelSwitchOutput).into(),
                show_label: true,
                font_size: 13,
                text_color: "#FFFFFF".into(),
                bg_color: None,
                bg_opacity: None,
                icon_path: None,
                badge: None,
                accent_color: None,
                action: ButtonAction::AudioDevice { device_id: None },
            },
        );
        page2_slots.insert(
            "5".to_string(),
            ButtonItem {
                id: "btn-media-prev".into(),
                label: t(Text::LabelPrevTrack).into(),
                show_label: true,
                font_size: 13,
                text_color: "#FFFFFF".into(),
                bg_color: None,
                bg_opacity: None,
                icon_path: None,
                badge: None,
                accent_color: None,
                action: ButtonAction::Media {
                    command: "prev".into(),
                },
            },
        );
        page2_slots.insert(
            "6".to_string(),
            ButtonItem {
                id: "btn-media-play".into(),
                label: t(Text::LabelPlayPause).into(),
                show_label: true,
                font_size: 13,
                text_color: "#FFFFFF".into(),
                bg_color: None,
                bg_opacity: None,
                icon_path: None,
                badge: None,
                accent_color: None,
                action: ButtonAction::Media {
                    command: "play_pause".into(),
                },
            },
        );
        page2_slots.insert(
            "7".to_string(),
            ButtonItem {
                id: "btn-media-next".into(),
                label: t(Text::LabelNextTrack).into(),
                show_label: true,
                font_size: 13,
                text_color: "#FFFFFF".into(),
                bg_color: None,
                bg_opacity: None,
                icon_path: None,
                badge: None,
                accent_color: None,
                action: ButtonAction::Media {
                    command: "next".into(),
                },
            },
        );
        page2_slots.insert(
            "8".to_string(),
            ButtonItem {
                id: "btn-widget-sys".into(),
                label: t(Text::LabelSystem).into(),
                show_label: true,
                font_size: 13,
                text_color: "#FFFFFF".into(),
                bg_color: None,
                bg_opacity: None,
                icon_path: None,
                badge: None,
                accent_color: None,
                action: ButtonAction::Widget {
                    kind: "sys_stats".into(),
                    metrics: vec!["cpu_pct".into(), "ram_pct".into()],
                },
            },
        );
        page2_slots.insert(
            "9".to_string(),
            ButtonItem {
                id: "btn-widget-clock".into(),
                label: t(Text::LabelClock).into(),
                show_label: true,
                font_size: 13,
                text_color: "#FFFFFF".into(),
                bg_color: None,
                bg_opacity: None,
                icon_path: None,
                badge: None,
                accent_color: None,
                action: ButtonAction::Widget {
                    kind: "clock".into(),
                    metrics: Vec::new(),
                },
            },
        );

        Self {
            version: 1,
            window: WindowConfig {
                x: None,
                y: None,
                always_on_top: false,
                desktop_layer: false,
                locked: false,
            },
            grid: GridConfig {
                columns: 5,
                rows: 4,
                cell_size: 128,
                gap: 10,
                border_radius: 14,
            },
            theme: ThemeConfig {
                background_type: "solid".into(),
                background_color: "#222429".into(),
                background_opacity: 84,
                gradient_end_color: "#14161B".into(),
                background_image: None,
                background_blur: 8,
                background_dim: 35,
                font_family: "Pretendard".into(),
                default_button_color: "#32353D".into(),
                default_button_opacity: 88,
                button_style: "solid".into(),
                auto_font_size: true,
                icon_rounded: true,
            },
            pages: vec![
                DeckPage {
                    id: "page-1".into(),
                    name: t(Text::PageMain).into(),
                    slots: HashMap::new(),
                },
                DeckPage {
                    id: "page-2".into(),
                    name: t(Text::PageMedia).into(),
                    slots: page2_slots,
                },
            ],
            vault: Vec::new(),
            discord: DiscordConfig::default(),
            auto_check_update: true,
            language: None,
        }
    }
}

pub fn get_data_dir() -> Result<PathBuf, String> {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let portable_dir = exe_dir.join("data");
            let portable_flag = exe_dir.join("portable.flag");
            if portable_dir.exists() || portable_flag.exists() {
                fs::create_dir_all(portable_dir.join("assets")).map_err(|e| e.to_string())?;
                return Ok(portable_dir);
            }
        }
    }

    let appdata = std::env::var("APPDATA").map_err(|_| "APPDATA env not set".to_string())?;
    let dir = PathBuf::from(appdata).join("TouchDeck");
    fs::create_dir_all(dir.join("assets")).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn is_portable_mode() -> bool {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            return exe_dir.join("data").exists() || exe_dir.join("portable.flag").exists();
        }
    }
    false
}

fn sanitize_config(mut cfg: DeckConfig) -> DeckConfig {
    cfg.grid.columns = cfg.grid.columns.clamp(2, 10);
    cfg.grid.rows = cfg.grid.rows.clamp(1, 8);
    cfg.grid.cell_size = cfg.grid.cell_size.clamp(60, 200);
    cfg.grid.gap = cfg.grid.gap.clamp(0, 32);
    if cfg.pages.is_empty() {
        cfg.pages = DeckConfig::default().pages;
    } else if cfg.pages[0].id.trim().is_empty() {
        cfg.pages[0].id = "page-1".into();
    }
    cfg.language = cfg
        .language
        .filter(|code| i18n::Lang::from_code(code).is_some());
    cfg
}

fn save_config_to_dir(dir: &Path, cfg: &DeckConfig) -> Result<(), String> {
    let cfg_path = dir.join("config.json");
    // Per-process temp name so two processes never write into the same temp file.
    let tmp_path = dir.join(format!("config.json.{}.tmp", std::process::id()));
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    let written = fs::File::create(&tmp_path)
        .and_then(|mut f| {
            f.write_all(json.as_bytes())?;
            f.sync_all()
        })
        .and_then(|_| fs::rename(&tmp_path, &cfg_path));
    if written.is_err() {
        let _ = fs::remove_file(&tmp_path);
    }
    written.map_err(|e| e.to_string())
}

// Writes `bytes` next to config.json as `config.json.<tag>-<unix_secs>`; an
// existing backup is never overwritten (same-second names get a numeric suffix).
fn write_config_backup(dir: &Path, tag: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut n = 0u32;
    loop {
        let path = dir.join(if n == 0 {
            format!("config.json.{tag}-{secs}")
        } else {
            format!("config.json.{tag}-{secs}-{n}")
        });
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                f.write_all(bytes)
                    .and_then(|_| f.sync_all())
                    .map_err(|e| e.to_string())?;
                return Ok(path);
            }
            Err(e) if e.kind() == ErrorKind::AlreadyExists => n += 1,
            Err(e) => return Err(e.to_string()),
        }
    }
}

// Returns the config plus a user-facing notice when a corrupt file was reset.
// A read failure on an existing file is an error and never overwrites it.
fn load_or_recover_config_in(dir: &Path) -> Result<(DeckConfig, Option<String>), String> {
    let cfg_path = dir.join("config.json");
    let mut tries = 0;
    let bytes = loop {
        match fs::read(&cfg_path) {
            Ok(bytes) => break bytes,
            Err(e) if e.kind() == ErrorKind::NotFound => {
                let def = DeckConfig::default();
                save_config_to_dir(dir, &def)?;
                return Ok((def, None));
            }
            Err(e) => {
                tries += 1;
                if tries >= 3 {
                    return Err(detail(Text::ConfigReadFailed, e));
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
    };
    match serde_json::from_slice::<DeckConfig>(&bytes) {
        Ok(cfg) => Ok((sanitize_config(cfg), None)),
        Err(_) => {
            let bak_path = write_config_backup(dir, "corrupt", &bytes)
                .map_err(|e| detail(Text::ConfigCorruptBackupFailed, e))?;
            let def = DeckConfig::default();
            save_config_to_dir(dir, &def)?;
            Ok((def, Some(i18n::config_reset_notice(&bak_path))))
        }
    }
}

fn save_config_unlocked(cfg: &DeckConfig) -> Result<(), String> {
    let dir = get_data_dir()?;
    save_config_to_dir(&dir, cfg)
}

fn load_config_unlocked() -> Result<DeckConfig, String> {
    let dir = get_data_dir()?;
    let (cfg, notice) = load_or_recover_config_in(&dir)?;
    if let Some(notice) = notice {
        *CONFIG_NOTICE.lock().unwrap_or_else(|e| e.into_inner()) = Some(notice);
    }
    Ok(cfg)
}

fn merge_ui_discord(merged: &mut DeckConfig, disk: &DeckConfig) {
    if merged.discord.access_token.is_empty() && merged.discord.refresh_token.is_empty() {
        if !disk.discord.access_token.is_empty() || !disk.discord.refresh_token.is_empty() {
            merged.discord = disk.discord.clone();
        } else if merged.discord.client_id.is_empty() && !disk.discord.client_id.is_empty() {
            merged.discord.client_id = disk.discord.client_id.clone();
            merged.discord.client_secret = disk.discord.client_secret.clone();
        }
    }
}

pub fn load_config() -> Result<DeckConfig, String> {
    let _guard = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let cfg = load_config_unlocked()?;
    i18n::set_current(cfg.language.as_deref());
    Ok(cfg)
}

// Raw save without the UI merge; currently has no caller (imports go through
// `import_config_with_backup`, the UI through `save_config_from_ui`).
#[allow(dead_code)]
pub fn save_config(cfg: &DeckConfig) -> Result<(), String> {
    let _guard = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    save_config_unlocked(cfg)
}

pub fn save_config_from_ui(cfg: &DeckConfig) -> Result<(), String> {
    let _guard = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut merged = sanitize_config(cfg.clone());
    // An unreadable disk config aborts the save: writing without the merge
    // would drop the stored Discord tokens.
    let disk = load_config_unlocked()?;
    merge_ui_discord(&mut merged, &disk);
    save_config_unlocked(&merged)?;
    i18n::set_current(merged.language.as_deref());
    Ok(())
}

pub fn update_discord_config<F: FnOnce(&mut DiscordConfig)>(f: F) -> Result<DiscordConfig, String> {
    let _guard = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut cfg = load_config_unlocked()?;
    f(&mut cfg.discord);
    save_config_unlocked(&cfg)?;
    Ok(cfg.discord)
}

/// Read-only view of the stored Discord section for polling callers. Never
/// recovers, rewrites or backs up config.json; any failure yields `None`.
pub fn read_discord_config() -> Option<DiscordConfig> {
    let _guard = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let bytes = fs::read(get_data_dir().ok()?.join("config.json")).ok()?;
    serde_json::from_slice::<DeckConfig>(&bytes)
        .ok()
        .map(|cfg| cfg.discord)
}

/// Returns the pending config-reset notice, if any, and clears it.
pub fn take_config_notice() -> Option<String> {
    CONFIG_NOTICE.lock().unwrap_or_else(|e| e.into_inner()).take()
}

fn import_config_in<F: FnOnce(DeckConfig) -> DeckConfig>(
    dir: &Path,
    disk: DeckConfig,
    f: F,
) -> Result<DeckConfig, String> {
    let mut next = sanitize_config(f(disk.clone()));
    // An import without tokens (e.g. an exported file) keeps the stored Discord auth.
    if next.discord.access_token.is_empty()
        && next.discord.refresh_token.is_empty()
        && !disk.discord.client_id.is_empty()
    {
        next.discord = disk.discord;
    }
    let current = fs::read(dir.join("config.json")).map_err(|e| e.to_string())?;
    write_config_backup(dir, "before-import", &current)
        .map_err(|e| detail(Text::ImportBackupFailed, e))?;
    save_config_to_dir(dir, &next)?;
    Ok(next)
}

/// Replaces the stored config with `f(current)`. The current config.json is
/// first copied to `config.json.before-import-<unix_secs>`; if that backup
/// cannot be written nothing is replaced.
pub fn import_config_with_backup<F: FnOnce(DeckConfig) -> DeckConfig>(
    f: F,
) -> Result<DeckConfig, String> {
    let _guard = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let disk = load_config_unlocked()?;
    let next = import_config_in(&get_data_dir()?, disk, f)?;
    i18n::set_current(next.language.as_deref());
    Ok(next)
}

pub fn copy_image_to_assets(source_path: &str, prefix: &str) -> Result<String, String> {
    let src = Path::new(source_path);
    if !src.exists() {
        return Err(detail(Text::FileDoesNotExist, source_path));
    }
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let safe_prefix: String = prefix
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    let name = format!("{}_{}.{}", safe_prefix, stamp, ext);
    let data_dir = get_data_dir()?;
    let dest = data_dir.join("assets").join(&name);
    fs::copy(src, &dest).map_err(|e| e.to_string())?;
    Ok(format!("assets/{name}"))
}

pub fn resolve_asset_path(rel_or_abs: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel_or_abs);
    if p.is_absolute() {
        return Ok(p.to_path_buf());
    }
    Ok(get_data_dir()?.join(p))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_config_clamps_grid_and_restores_empty_pages() {
        let mut cfg = DeckConfig::default();
        cfg.grid.columns = 99;
        cfg.grid.rows = 0;
        cfg.grid.cell_size = 10;
        cfg.grid.gap = 99;
        cfg.pages.clear();

        let out = sanitize_config(cfg);
        assert_eq!(out.grid.columns, 10);
        assert_eq!(out.grid.rows, 1);
        assert_eq!(out.grid.cell_size, 60);
        assert_eq!(out.grid.gap, 32);
        assert!(!out.pages.is_empty());
    }

    #[test]
    fn merge_ui_discord_preserves_disk_tokens_when_ui_stale() {
        let mut ui = DeckConfig::default();
        let mut disk = DeckConfig::default();
        disk.discord.client_id = "cid".into();
        disk.discord.client_secret = "csec".into();
        disk.discord.access_token = "acc".into();
        disk.discord.refresh_token = "ref".into();

        merge_ui_discord(&mut ui, &disk);
        assert_eq!(ui.discord.access_token, "acc");
        assert_eq!(ui.discord.refresh_token, "ref");
        assert_eq!(ui.discord.client_id, "cid");
    }

    #[test]
    fn language_is_optional_and_sanitized_to_supported_codes() {
        let mut json = serde_json::to_value(DeckConfig::default()).unwrap();
        assert!(json["language"].is_null());

        // A config written before the field existed keeps loading.
        json.as_object_mut().unwrap().remove("language");
        let old: DeckConfig = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(old.language, None);

        json["language"] = "ja".into();
        let ja: DeckConfig = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(sanitize_config(ja).language.as_deref(), Some("ja"));

        json["language"] = "fr".into();
        let other: DeckConfig = serde_json::from_value(json).unwrap();
        assert_eq!(sanitize_config(other).language, None);
    }

    fn test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "touchdeck_cfg_test_{name}_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn backups_in(dir: &Path, tag: &str) -> Vec<PathBuf> {
        fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with(&format!("config.json.{tag}-")))
            })
            .collect()
    }

    #[test]
    fn load_or_recover_backs_up_corrupted_json_and_returns_default() {
        let dir = test_dir("corrupt");
        fs::write(dir.join("config.json"), "{not valid json").unwrap();

        let (loaded, notice) = load_or_recover_config_in(&dir).unwrap();
        assert!(!loaded.pages.is_empty());
        let backups = backups_in(&dir, "corrupt");
        assert_eq!(backups.len(), 1);
        assert_eq!(fs::read_to_string(&backups[0]).unwrap(), "{not valid json");
        let backup_name = backups[0].file_name().unwrap().to_str().unwrap();
        assert!(notice.unwrap().contains(backup_name));
        assert!(serde_json::from_slice::<DeckConfig>(&fs::read(dir.join("config.json")).unwrap()).is_ok());

        // A second reset in the same second must not overwrite the first backup.
        fs::write(dir.join("config.json"), "second corruption").unwrap();
        load_or_recover_config_in(&dir).unwrap();
        assert_eq!(backups_in(&dir, "corrupt").len(), 2);
        assert_eq!(fs::read_to_string(&backups[0]).unwrap(), "{not valid json");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_or_recover_leaves_valid_and_absent_config_without_backup_or_notice() {
        let dir = test_dir("valid");
        let (created, notice) = load_or_recover_config_in(&dir).unwrap();
        assert!(notice.is_none());
        assert!(dir.join("config.json").exists());

        let mut cfg = created;
        cfg.pages[0].name = "kept".into();
        save_config_to_dir(&dir, &cfg).unwrap();
        let (loaded, notice) = load_or_recover_config_in(&dir).unwrap();
        assert!(notice.is_none());
        assert_eq!(loaded.pages[0].name, "kept");
        assert!(backups_in(&dir, "corrupt").is_empty());
        // The atomic save leaves no temp file behind.
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_or_recover_errors_without_writing_when_config_is_locked() {
        use std::os::windows::fs::OpenOptionsExt;

        let dir = test_dir("locked");
        let cfg_path = dir.join("config.json");
        fs::write(&cfg_path, "{not valid json").unwrap();
        // Deny reads but share write + delete, so an overwrite attempt would succeed
        // and the assertions below would catch it.
        let deny_read = || {
            fs::OpenOptions::new()
                .read(true)
                .share_mode(0x2 | 0x4)
                .open(&cfg_path)
                .unwrap()
        };

        let lock = deny_read();
        assert!(load_or_recover_config_in(&dir).is_err());
        drop(lock);
        assert_eq!(fs::read_to_string(&cfg_path).unwrap(), "{not valid json");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);

        // The same lock does not stop a replace, so the check above is meaningful.
        let lock = deny_read();
        assert!(fs::read(&cfg_path).is_err());
        fs::write(dir.join("probe"), "probe").unwrap();
        assert!(fs::rename(dir.join("probe"), &cfg_path).is_ok());
        drop(lock);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_backs_up_current_config_and_keeps_disk_discord() {
        let dir = test_dir("import");
        let mut disk = DeckConfig::default();
        disk.discord.client_id = "cid".into();
        disk.discord.client_secret = "csec".into();
        disk.discord.access_token = "acc".into();
        save_config_to_dir(&dir, &disk).unwrap();
        let before = fs::read(dir.join("config.json")).unwrap();

        let mut imported = DeckConfig::default();
        imported.grid.columns = 99;
        imported.discord.client_id = "cid".into();
        let saved = import_config_in(&dir, disk, |_| imported).unwrap();

        assert_eq!(saved.grid.columns, 10);
        assert_eq!(saved.discord.client_secret, "csec");
        assert_eq!(saved.discord.access_token, "acc");
        let backups = backups_in(&dir, "before-import");
        assert_eq!(backups.len(), 1);
        assert_eq!(fs::read(&backups[0]).unwrap(), before);
        let (reloaded, _) = load_or_recover_config_in(&dir).unwrap();
        assert_eq!(reloaded.discord.access_token, "acc");
        let _ = fs::remove_dir_all(&dir);
    }
}
