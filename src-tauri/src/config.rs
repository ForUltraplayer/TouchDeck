use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

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
}

impl Default for DeckConfig {
    fn default() -> Self {
        let mut page2_slots = HashMap::new();
        page2_slots.insert(
            "0".to_string(),
            ButtonItem {
                id: "btn-vol-down".into(),
                label: "볼륨 -".into(),
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
                label: "음소거".into(),
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
                label: "볼륨 +".into(),
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
                label: "마이크".into(),
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
                label: "출력 전환".into(),
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
                label: "이전 곡".into(),
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
                label: "재생/정지".into(),
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
                label: "다음 곡".into(),
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
                label: "시스템".into(),
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
                label: "시계".into(),
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
                    name: "메인".into(),
                    slots: HashMap::new(),
                },
                DeckPage {
                    id: "page-2".into(),
                    name: "미디어".into(),
                    slots: page2_slots,
                },
            ],
            vault: Vec::new(),
            discord: DiscordConfig::default(),
            auto_check_update: true,
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

pub fn load_config() -> Result<DeckConfig, String> {
    let dir = get_data_dir()?;
    let cfg_path = dir.join("config.json");
    if !cfg_path.exists() {
        let def = DeckConfig::default();
        save_config(&def)?;
        return Ok(def);
    }
    let text = fs::read_to_string(&cfg_path).map_err(|e| format!("read config failed: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("parse config failed: {e}"))
}

pub fn save_config(cfg: &DeckConfig) -> Result<(), String> {
    let dir = get_data_dir()?;
    let cfg_path = dir.join("config.json");
    let tmp_path = dir.join("config.json.tmp");
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(&tmp_path, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, &cfg_path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn copy_image_to_assets(source_path: &str, prefix: &str) -> Result<String, String> {
    let src = Path::new(source_path);
    if !src.exists() {
        return Err(format!("파일이 존재하지 않습니다: {source_path}"));
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
