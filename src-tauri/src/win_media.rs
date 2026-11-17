use serde::Serialize;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL, VK_DELETE, VK_DOWN, VK_END,
    VK_ESCAPE, VK_F1, VK_F10, VK_F11, VK_F12, VK_F2, VK_F3, VK_F4, VK_F5, VK_F6, VK_F7, VK_F8,
    VK_F9, VK_HOME, VK_INSERT, VK_LEFT, VK_LWIN, VK_MEDIA_NEXT_TRACK, VK_MEDIA_PLAY_PAUSE,
    VK_MEDIA_PREV_TRACK, VK_MEDIA_STOP, VK_MENU, VK_NEXT, VK_PRIOR, VK_RETURN, VK_RIGHT, VK_SHIFT,
    VK_SPACE, VK_TAB, VK_UP,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeState {
    pub level: u8,
    pub muted: bool,
}

struct ComGuard;
impl ComGuard {
    fn new() -> Self {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
        Self
    }
}
impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}

fn with_endpoint_volume<T, F: FnOnce(&IAudioEndpointVolume) -> Result<T, String>>(
    f: F,
) -> Result<T, String> {
    let _com = ComGuard::new();
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("MMDeviceEnumerator: {e}"))?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eMultimedia)
            .map_err(|e| format!("GetDefaultAudioEndpoint: {e}"))?;
        let volume: IAudioEndpointVolume = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Activate IAudioEndpointVolume: {e}"))?;
        f(&volume)
    }
}

pub fn get_volume_state() -> Result<VolumeState, String> {
    with_endpoint_volume(|vol| unsafe {
        let scalar = vol
            .GetMasterVolumeLevelScalar()
            .map_err(|e| format!("GetMasterVolumeLevelScalar: {e}"))?;
        let muted = vol.GetMute().map_err(|e| format!("GetMute: {e}"))?.as_bool();
        Ok(VolumeState {
            level: (scalar * 100.0).round().clamp(0.0, 100.0) as u8,
            muted,
        })
    })
}

pub fn adjust_volume(command: &str, step: u8) -> Result<VolumeState, String> {
    with_endpoint_volume(|vol| unsafe {
        let cur = vol
            .GetMasterVolumeLevelScalar()
            .map_err(|e| e.to_string())?;
        let mut muted = vol.GetMute().map_err(|e| e.to_string())?.as_bool();
        let delta = (step as f32) / 100.0;

        match command {
            "up" => {
                let next = (cur + delta).clamp(0.0, 1.0);
                vol.SetMasterVolumeLevelScalar(next, std::ptr::null())
                    .map_err(|e| e.to_string())?;
                if muted {
                    vol.SetMute(false, std::ptr::null())
                        .map_err(|e| e.to_string())?;
                    muted = false;
                }
            }
            "down" => {
                let next = (cur - delta).clamp(0.0, 1.0);
                vol.SetMasterVolumeLevelScalar(next, std::ptr::null())
                    .map_err(|e| e.to_string())?;
            }
            "mute" => {
                muted = !muted;
                vol.SetMute(muted, std::ptr::null())
                    .map_err(|e| e.to_string())?;
            }
            _ => return Err(format!("알 수 없는 볼륨 명령: {command}")),
        }

        let final_scalar = vol
            .GetMasterVolumeLevelScalar()
            .map_err(|e| e.to_string())?;
        Ok(VolumeState {
            level: (final_scalar * 100.0).round().clamp(0.0, 100.0) as u8,
            muted,
        })
    })
}

fn tap_vk(vk: VIRTUAL_KEY, extended: bool) {
    let ext = if extended {
        KEYEVENTF_EXTENDEDKEY
    } else {
        KEYBD_EVENT_FLAGS(0)
    };
    unsafe {
        let inputs = [
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: vk,
                        wScan: 0,
                        dwFlags: ext,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: vk,
                        wScan: 0,
                        dwFlags: ext | KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
        ];
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

pub fn send_media_command(command: &str) -> Result<(), String> {
    let vk = match command {
        "play_pause" => VK_MEDIA_PLAY_PAUSE,
        "next" => VK_MEDIA_NEXT_TRACK,
        "prev" => VK_MEDIA_PREV_TRACK,
        "stop" => VK_MEDIA_STOP,
        _ => return Err(format!("알 수 없는 미디어 명령: {command}")),
    };
    tap_vk(vk, true);
    Ok(())
}

fn parse_vk(key: &str) -> Option<VIRTUAL_KEY> {
    let k = key.trim().to_ascii_uppercase();
    match k.as_str() {
        "CTRL" | "CONTROL" => Some(VK_CONTROL),
        "SHIFT" => Some(VK_SHIFT),
        "ALT" => Some(VK_MENU),
        "WIN" | "META" | "SUPER" => Some(VK_LWIN),
        "ENTER" | "RETURN" => Some(VK_RETURN),
        "ESC" | "ESCAPE" => Some(VK_ESCAPE),
        "SPACE" => Some(VK_SPACE),
        "TAB" => Some(VK_TAB),
        "INS" | "INSERT" => Some(VK_INSERT),
        "DEL" | "DELETE" => Some(VK_DELETE),
        "HOME" => Some(VK_HOME),
        "END" => Some(VK_END),
        "PGUP" | "PAGEUP" => Some(VK_PRIOR),
        "PGDN" | "PAGEDOWN" => Some(VK_NEXT),
        "UP" => Some(VK_UP),
        "DOWN" => Some(VK_DOWN),
        "LEFT" => Some(VK_LEFT),
        "RIGHT" => Some(VK_RIGHT),
        "F1" => Some(VK_F1),
        "F2" => Some(VK_F2),
        "F3" => Some(VK_F3),
        "F4" => Some(VK_F4),
        "F5" => Some(VK_F5),
        "F6" => Some(VK_F6),
        "F7" => Some(VK_F7),
        "F8" => Some(VK_F8),
        "F9" => Some(VK_F9),
        "F10" => Some(VK_F10),
        "F11" => Some(VK_F11),
        "F12" => Some(VK_F12),
        _ if k.len() == 1 => {
            let ch = k.as_bytes()[0];
            if ch.is_ascii_alphanumeric() {
                Some(VIRTUAL_KEY(ch as u16))
            } else {
                None
            }
        }
        _ => None,
    }
}

pub fn send_hotkey(keys: &[String]) -> Result<(), String> {
    let vks: Vec<VIRTUAL_KEY> = keys.iter().filter_map(|k| parse_vk(k)).collect();
    if vks.is_empty() {
        return Err("유효한 단축키가 없습니다.".into());
    }

    let mut inputs = Vec::with_capacity(vks.len() * 2);
    for &vk in &vks {
        inputs.push(INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: KEYBD_EVENT_FLAGS(0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        });
    }
    for &vk in vks.iter().rev() {
        inputs.push(INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        });
    }

    unsafe {
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
    Ok(())
}
