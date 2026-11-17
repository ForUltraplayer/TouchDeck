use serde::Serialize;
use std::sync::Mutex;
use windows::core::{Interface, GUID, HRESULT, PCWSTR};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::FILETIME;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    eCapture, eCommunications, eConsole, eMultimedia, eRender, IMMDeviceEnumerator,
    MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_APARTMENTTHREADED, STGM_READ,
};
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows::Win32::System::Threading::GetSystemTimes;
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
    pub mic_muted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlayingInfo {
    pub title: String,
    pub artist: String,
    pub playing: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub cpu_percent: u8,
    pub mem_percent: u8,
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
    capture: bool,
    f: F,
) -> Result<T, String> {
    let _com = ComGuard::new();
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("MMDeviceEnumerator: {e}"))?;
        let (flow, role) = if capture {
            (eCapture, eCommunications)
        } else {
            (eRender, eMultimedia)
        };
        let device = enumerator
            .GetDefaultAudioEndpoint(flow, role)
            .map_err(|e| format!("GetDefaultAudioEndpoint: {e}"))?;
        let volume: IAudioEndpointVolume = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Activate IAudioEndpointVolume: {e}"))?;
        f(&volume)
    }
}

pub fn get_volume_state() -> Result<VolumeState, String> {
    let (level, muted) = with_endpoint_volume(false, |vol| unsafe {
        let scalar = vol
            .GetMasterVolumeLevelScalar()
            .map_err(|e| format!("GetMasterVolumeLevelScalar: {e}"))?;
        let m = vol.GetMute().map_err(|e| format!("GetMute: {e}"))?.as_bool();
        Ok(((scalar * 100.0).round().clamp(0.0, 100.0) as u8, m))
    })?;

    let mic_muted = with_endpoint_volume(true, |vol| unsafe {
        Ok(vol.GetMute().map(|b| b.as_bool()).unwrap_or(false))
    })
    .unwrap_or(false);

    Ok(VolumeState {
        level,
        muted,
        mic_muted,
    })
}

pub fn adjust_volume(command: &str, step: u8, target: &str) -> Result<VolumeState, String> {
    if target.eq_ignore_ascii_case("mic") {
        with_endpoint_volume(true, |vol| unsafe {
            let mut muted = vol.GetMute().map_err(|e| e.to_string())?.as_bool();
            if command == "mute" {
                muted = !muted;
                vol.SetMute(muted, std::ptr::null())
                    .map_err(|e| e.to_string())?;
            }
            Ok(())
        })?;
        return get_volume_state();
    }

    with_endpoint_volume(false, |vol| unsafe {
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
        Ok(())
    })?;

    get_volume_state()
}

pub fn list_audio_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    let _com = ComGuard::new();
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("MMDeviceEnumerator: {e}"))?;

        let default_id = enumerator
            .GetDefaultAudioEndpoint(eRender, eMultimedia)
            .ok()
            .and_then(|d| d.GetId().ok())
            .map(|pw| {
                let s = pw.to_string().unwrap_or_default();
                CoTaskMemFree(Some(pw.0 as *const _));
                s
            })
            .unwrap_or_default();

        let collection = enumerator
            .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            .map_err(|e| format!("EnumAudioEndpoints: {e}"))?;
        let count = collection.GetCount().map_err(|e| e.to_string())?;
        let mut list = Vec::with_capacity(count as usize);

        for i in 0..count {
            let Ok(dev) = collection.Item(i) else {
                continue;
            };
            let Ok(id_pw) = dev.GetId() else {
                continue;
            };
            let id = id_pw.to_string().unwrap_or_default();
            CoTaskMemFree(Some(id_pw.0 as *const _));

            let mut name = id.clone();
            if let Ok(props) = dev.OpenPropertyStore(STGM_READ) {
                if let Ok(pv) = props.GetValue(&PKEY_Device_FriendlyName) {
                    if let Ok(pw_name) = PropVariantToStringAlloc(&pv) {
                        if let Ok(s) = pw_name.to_string() {
                            if !s.is_empty() {
                                name = s;
                            }
                        }
                        CoTaskMemFree(Some(pw_name.0 as *const _));
                    }
                }
            }

            list.push(AudioDeviceInfo {
                is_default: id == default_id,
                id,
                name,
            });
        }
        Ok(list)
    }
}

// Undocumented Windows PolicyConfig COM vtable for switching default audio playback device
#[repr(C)]
struct IPolicyConfigVtbl {
    base: [usize; 13], // IUnknown (3) + methods 3..12
    set_default_endpoint:
        unsafe extern "system" fn(*mut core::ffi::c_void, PCWSTR, u32) -> HRESULT,
}

#[repr(C)]
struct IPolicyConfigRaw {
    vtbl: *const IPolicyConfigVtbl,
}

pub fn switch_audio_device(device_id: Option<&str>) -> Result<String, String> {
    let devices = list_audio_devices()?;
    if devices.is_empty() {
        return Err("활성 오디오 출력 장치가 없습니다.".into());
    }

    let target = if let Some(req_id) = device_id.filter(|s| !s.is_empty()) {
        devices
            .iter()
            .find(|d| d.id == req_id)
            .ok_or_else(|| "지정한 오디오 장치를 찾을 수 없습니다.".to_string())?
    } else {
        let cur_idx = devices.iter().position(|d| d.is_default).unwrap_or(0);
        let next_idx = (cur_idx + 1) % devices.len();
        &devices[next_idx]
    };

    let _com = ComGuard::new();
    unsafe {
        let clsid = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);
        let iid = GUID::from_u128(0xf8679f50_850a_41cf_9c72_430f290290c8);

        let unknown: windows::core::IUnknown =
            CoCreateInstance(&clsid, None, CLSCTX_ALL)
                .map_err(|e| format!("PolicyConfig CoCreateInstance: {e}"))?;
        let mut raw_ptr: *mut core::ffi::c_void = std::ptr::null_mut();
        unknown
            .query(&iid, &mut raw_ptr)
            .ok()
            .map_err(|e| format!("PolicyConfig QueryInterface: {e}"))?;

        let cfg = raw_ptr as *mut IPolicyConfigRaw;
        let vtbl = (*cfg).vtbl;
        let release_fn: unsafe extern "system" fn(*mut core::ffi::c_void) -> u32 =
            std::mem::transmute((*vtbl).base[2]);

        let wid: Vec<u16> = target.id.encode_utf16().chain(std::iter::once(0)).collect();
        for role in [eConsole.0 as u32, eMultimedia.0 as u32, eCommunications.0 as u32] {
            let hr = ((*vtbl).set_default_endpoint)(raw_ptr, PCWSTR(wid.as_ptr()), role);
            if hr.is_err() {
                release_fn(raw_ptr);
                return Err(format!("SetDefaultEndpoint failed: {hr:?}"));
            }
        }
        release_fn(raw_ptr);
    }

    Ok(target.name.clone())
}

pub fn get_now_playing() -> Option<NowPlayingInfo> {
    let mgr = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .ok()?
        .get()
        .ok()?;
    let session = mgr.GetCurrentSession().ok()?;
    let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
    let title = props.Title().ok()?.to_string();
    let artist = props.Artist().ok().map(|s| s.to_string()).unwrap_or_default();
    let playing = session
        .GetPlaybackInfo()
        .ok()
        .and_then(|p| p.PlaybackStatus().ok())
        .map(|s| s == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
        .unwrap_or(false);

    if title.is_empty() && artist.is_empty() {
        return None;
    }
    Some(NowPlayingInfo {
        title,
        artist,
        playing,
    })
}

static PREV_CPU: Mutex<Option<(u64, u64, u64)>> = Mutex::new(None);

fn ft_to_u64(ft: FILETIME) -> u64 {
    ((ft.dwHighDateTime as u64) << 32) | (ft.dwLowDateTime as u64)
}

pub fn get_system_stats() -> SystemStats {
    let mut cpu_percent = 0u8;
    unsafe {
        let mut idle = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        if GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)).is_ok() {
            let i = ft_to_u64(idle);
            let k = ft_to_u64(kernel);
            let u = ft_to_u64(user);
            if let Ok(mut guard) = PREV_CPU.lock() {
                if let Some((pi, pk, pu)) = *guard {
                    let di = i.saturating_sub(pi);
                    let dk = k.saturating_sub(pk);
                    let du = u.saturating_sub(pu);
                    let total = dk + du;
                    if total > 0 {
                        let busy = total.saturating_sub(di);
                        cpu_percent = ((busy as f64 / total as f64) * 100.0)
                            .round()
                            .clamp(0.0, 100.0) as u8;
                    }
                }
                *guard = Some((i, k, u));
            }
        }
    }

    let mut mem_percent = 0u8;
    unsafe {
        let mut ms = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            ..Default::default()
        };
        if GlobalMemoryStatusEx(&mut ms).is_ok() {
            mem_percent = ms.dwMemoryLoad.min(100) as u8;
        }
    }

    SystemStats {
        cpu_percent,
        mem_percent,
    }
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
