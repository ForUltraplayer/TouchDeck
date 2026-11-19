use crate::config::{read_discord_config, DiscordConfig};
use serde::Serialize;
use serde_json::{json, Value};
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::os::windows::io::AsRawHandle;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use windows::core::HSTRING;
use windows::Win32::Foundation::HANDLE;
use windows::Win32::Networking::WinHttp::{
    WinHttpCloseHandle, WinHttpConnect, WinHttpOpen, WinHttpOpenRequest, WinHttpQueryDataAvailable,
    WinHttpReadData, WinHttpReceiveResponse, WinHttpSendRequest, WinHttpSetTimeouts,
    WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_FLAG_SECURE,
};
use windows::Win32::System::Pipes::PeekNamedPipe;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordState {
    pub pipe_connected: bool,
    pub authenticated: bool,
    pub muted: bool,
    pub deaf: bool,
    pub in_voice: bool,
    pub last_error: Option<String>,
}

pub enum DiscordCommand {
    Authorize {
        client_id: String,
        client_secret: String,
    },
    #[allow(dead_code)]
    Reconnect,
    Disconnect,
    ToggleMute,
    ToggleDeaf,
    DisconnectVoice,
}

#[derive(Clone)]
pub struct DiscordBridge {
    state: Arc<Mutex<DiscordState>>,
    tx: Sender<DiscordCommand>,
}

impl DiscordBridge {
    pub fn start(app: AppHandle) -> Self {
        let state = Arc::new(Mutex::new(DiscordState::default()));
        let (tx, rx) = mpsc::channel::<DiscordCommand>();
        let state_bg = Arc::clone(&state);

        thread::spawn(move || {
            run_worker(app, state_bg, rx);
        });

        Self { state, tx }
    }

    pub fn get_state(&self) -> DiscordState {
        self.state.lock().map(|g| g.clone()).unwrap_or_default()
    }

    pub fn send(&self, cmd: DiscordCommand) -> Result<(), String> {
        self.tx.send(cmd).map_err(|e| format!("Discord 워커 전송 실패: {e}"))
    }
}

fn update_state<F: FnOnce(&mut DiscordState)>(
    app: &AppHandle,
    state_lock: &Arc<Mutex<DiscordState>>,
    f: F,
) {
    let snapshot = {
        let Ok(mut g) = state_lock.lock() else {
            return;
        };
        f(&mut g);
        g.clone()
    };
    let _ = app.emit("discord-state", &snapshot);
}

fn open_discord_pipe() -> Option<File> {
    for i in 0..10 {
        let path = format!(r"\\.\pipe\discord-ipc-{i}");
        if let Ok(f) = OpenOptions::new().read(true).write(true).open(&path) {
            return Some(f);
        }
    }
    None
}

fn write_frame(pipe: &mut File, opcode: u32, payload: &Value) -> Result<(), String> {
    let json_bytes = serde_json::to_vec(payload).map_err(|e| e.to_string())?;
    let len = json_bytes.len() as u32;
    let mut buf = Vec::with_capacity(8 + json_bytes.len());
    buf.extend_from_slice(&opcode.to_le_bytes());
    buf.extend_from_slice(&len.to_le_bytes());
    buf.extend_from_slice(&json_bytes);
    pipe.write_all(&buf).map_err(|e| e.to_string())?;
    pipe.flush().map_err(|e| e.to_string())
}

const MAX_FRAME_LEN: usize = 4 * 1024 * 1024;
const PIPE_DRAIN_THRESHOLD: usize = 32 * 1024;

// True once a whole frame (8-byte header + payload) is buffered, so read_frame cannot block.
// The header is peeked without being consumed.
fn pipe_frame_ready(pipe: &File) -> Result<bool, String> {
    let mut hdr = [0u8; 8];
    let mut peeked: u32 = 0;
    let mut avail: u32 = 0;
    unsafe {
        PeekNamedPipe(
            HANDLE(pipe.as_raw_handle() as *mut _),
            Some(hdr.as_mut_ptr() as *mut _),
            hdr.len() as u32,
            Some(&mut peeked),
            Some(&mut avail),
            None,
        )
        .map_err(|e| e.to_string())?;
    }
    if peeked < 8 {
        return Ok(false);
    }
    let len = u32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]) as usize;
    if len > MAX_FRAME_LEN {
        return Err("Discord IPC frame too large".into());
    }
    // A frame larger than the pipe buffer never becomes fully available: the writer waits for
    // us to drain it. A full buffer means the rest is already on its way, so reading is safe.
    Ok(avail as usize >= 8 + len || avail as usize >= PIPE_DRAIN_THRESHOLD)
}

fn read_frame(pipe: &mut File) -> Result<(u32, Value), String> {
    let mut hdr = [0u8; 8];
    pipe.read_exact(&mut hdr).map_err(|e| e.to_string())?;
    let opcode = u32::from_le_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]);
    let len = u32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]) as usize;
    if len > MAX_FRAME_LEN {
        return Err("Discord IPC frame too large".into());
    }
    let mut data = vec![0u8; len];
    pipe.read_exact(&mut data).map_err(|e| e.to_string())?;
    let val: Value = serde_json::from_slice(&data).map_err(|e| e.to_string())?;
    Ok((opcode, val))
}

fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn http_post_form(host: &str, path: &str, body: &str) -> Result<Value, String> {
    unsafe {
        let session = WinHttpOpen(
            &HSTRING::from("TouchDeck/1.0"),
            WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
            None,
            None,
            0,
        );
        if session.is_null() {
            return Err("WinHttpOpen failed".into());
        }
        struct HGuard(*mut core::ffi::c_void);
        impl Drop for HGuard {
            fn drop(&mut self) {
                unsafe {
                    if !self.0.is_null() {
                        let _ = WinHttpCloseHandle(self.0);
                    }
                }
            }
        }
        let _sg = HGuard(session);
        let _ = WinHttpSetTimeouts(session, 5000, 5000, 5000, 5000);

        let conn = WinHttpConnect(session, &HSTRING::from(host), 443, 0);
        if conn.is_null() {
            return Err("WinHttpConnect failed".into());
        }
        let _cg = HGuard(conn);

        let req = WinHttpOpenRequest(
            conn,
            &HSTRING::from("POST"),
            &HSTRING::from(path),
            None,
            None,
            std::ptr::null(),
            WINHTTP_FLAG_SECURE,
        );
        if req.is_null() {
            return Err("WinHttpOpenRequest failed".into());
        }
        let _rg = HGuard(req);

        let headers = HSTRING::from("Content-Type: application/x-www-form-urlencoded\r\n");
        let body_bytes = body.as_bytes();
        WinHttpSendRequest(
            req,
            Some(headers.as_wide()),
            Some(body_bytes.as_ptr() as *const _),
            body_bytes.len() as u32,
            body_bytes.len() as u32,
            0,
        )
        .map_err(|e| format!("WinHttpSendRequest: {e}"))?;

        WinHttpReceiveResponse(req, std::ptr::null_mut())
            .map_err(|e| format!("WinHttpReceiveResponse: {e}"))?;

        let mut out = Vec::new();
        loop {
            let mut avail: u32 = 0;
            WinHttpQueryDataAvailable(req, &mut avail).map_err(|e| e.to_string())?;
            if avail == 0 {
                break;
            }
            let chunk = avail.min(65536) as usize;
            let mut buf = vec![0u8; chunk];
            let mut read = 0u32;
            WinHttpReadData(req, buf.as_mut_ptr() as *mut _, chunk as u32, &mut read)
                .map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            out.extend_from_slice(&buf[..read as usize]);
        }
        serde_json::from_slice(&out).map_err(|e| format!("OAuth JSON 파싱 실패: {e}"))
    }
}

fn exchange_code(client_id: &str, client_secret: &str, code: &str) -> Result<(String, String), String> {
    let body = format!(
        "client_id={}&client_secret={}&grant_type=authorization_code&code={}&redirect_uri={}",
        url_encode(client_id),
        url_encode(client_secret),
        url_encode(code),
        url_encode("http://localhost")
    );
    let val = http_post_form("discord.com", "/api/oauth2/token", &body)?;
    if let Some(err) = val.get("error").and_then(|v| v.as_str()) {
        let desc = val
            .get("error_description")
            .and_then(|v| v.as_str())
            .unwrap_or(err);
        return Err(format!("OAuth 오류: {desc}"));
    }
    let access = val
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "access_token 없음".to_string())?
        .to_string();
    let refresh = val
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Ok((access, refresh))
}

fn refresh_oauth(client_id: &str, client_secret: &str, refresh_token: &str) -> Result<(String, String), String> {
    let body = format!(
        "client_id={}&client_secret={}&grant_type=refresh_token&refresh_token={}",
        url_encode(client_id),
        url_encode(client_secret),
        url_encode(refresh_token)
    );
    let val = http_post_form("discord.com", "/api/oauth2/token", &body)?;
    let access = val
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "refresh 실패".to_string())?
        .to_string();
    let refresh = val
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .unwrap_or(refresh_token)
        .to_string();
    Ok((access, refresh))
}

// Applies `f` to the stored Discord section in place and announces the saved value.
fn save_discord_cfg<F: FnOnce(&mut DiscordConfig)>(app: &AppHandle, f: F) -> Result<(), String> {
    let saved = crate::config::update_discord_config(f)?;
    let _ = app.emit("discord-config-updated", &saved);
    Ok(())
}

fn next_nonce() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("td-{ms}")
}

fn run_worker(app: AppHandle, state_lock: Arc<Mutex<DiscordState>>, rx: Receiver<DiscordCommand>) {
    let mut pipe: Option<File> = None;
    let mut last_connect_try = Instant::now() - Duration::from_secs(10);
    let mut pending_auth = false;
    let mut tried_refresh = false;

    loop {
        // Process outbound commands. Without a pipe there is nothing to poll, so block on the
        // channel until the next connect attempt instead of spinning.
        let first = if pipe.is_some() {
            match rx.try_recv() {
                Ok(cmd) => Some(cmd),
                Err(TryRecvError::Empty) => None,
                Err(TryRecvError::Disconnected) => return,
            }
        } else {
            match rx.recv_timeout(Duration::from_secs(4).saturating_sub(last_connect_try.elapsed())) {
                Ok(cmd) => Some(cmd),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        };
        for cmd in first.into_iter().chain(rx.try_iter()) {
            match cmd {
                DiscordCommand::Authorize {
                    client_id,
                    client_secret,
                } => {
                    let saved = save_discord_cfg(&app, |cur| {
                        cur.client_id = client_id.trim().to_string();
                        cur.client_secret = client_secret.trim().to_string();
                        cur.access_token.clear();
                        cur.refresh_token.clear();
                    });
                    pipe = None;
                    // Without the saved client id there is nothing to authorize with.
                    pending_auth = saved.is_ok();
                    tried_refresh = false;
                    last_connect_try = Instant::now() - Duration::from_secs(10);
                    update_state(&app, &state_lock, |s| {
                        s.authenticated = false;
                        s.pipe_connected = false;
                        s.last_error = saved.err();
                    });
                }
                DiscordCommand::Reconnect => {
                    pipe = None;
                    tried_refresh = false;
                    last_connect_try = Instant::now() - Duration::from_secs(10);
                }
                DiscordCommand::Disconnect => {
                    pipe = None;
                    tried_refresh = false;
                    let _ = save_discord_cfg(&app, |cur| {
                        cur.access_token.clear();
                        cur.refresh_token.clear();
                    });
                    update_state(&app, &state_lock, |s| {
                        *s = DiscordState::default();
                    });
                }
                DiscordCommand::ToggleMute => {
                    if let Some(p) = pipe.as_mut() {
                        let next_mute = !state_lock.lock().map(|g| g.muted).unwrap_or(false);
                        let _ = write_frame(
                            p,
                            1,
                            &json!({
                                "cmd": "SET_VOICE_SETTINGS",
                                "args": { "mute": next_mute },
                                "nonce": next_nonce()
                            }),
                        );
                    }
                }
                DiscordCommand::ToggleDeaf => {
                    if let Some(p) = pipe.as_mut() {
                        let next_deaf = !state_lock.lock().map(|g| g.deaf).unwrap_or(false);
                        let _ = write_frame(
                            p,
                            1,
                            &json!({
                                "cmd": "SET_VOICE_SETTINGS",
                                "args": { "deaf": next_deaf },
                                "nonce": next_nonce()
                            }),
                        );
                    }
                }
                DiscordCommand::DisconnectVoice => {
                    if let Some(p) = pipe.as_mut() {
                        let _ = write_frame(
                            p,
                            1,
                            &json!({
                                "cmd": "SELECT_VOICE_CHANNEL",
                                "args": { "channel_id": Value::Null },
                                "nonce": next_nonce()
                            }),
                        );
                    }
                }
            }
        }

        // Try connect if needed and client_id exists
        if pipe.is_none() && last_connect_try.elapsed() >= Duration::from_secs(4) {
            last_connect_try = Instant::now();
            let dc = read_discord_config().unwrap_or_default();
            if !dc.client_id.is_empty() && (!dc.access_token.is_empty() || pending_auth) {
                if let Some(mut p) = open_discord_pipe() {
                    if write_frame(&mut p, 0, &json!({ "v": 1, "client_id": dc.client_id })).is_ok()
                    {
                        pipe = Some(p);
                        update_state(&app, &state_lock, |s| {
                            s.pipe_connected = true;
                            s.last_error = None;
                        });
                    }
                } else if pending_auth {
                    pending_auth = false;
                    update_state(&app, &state_lock, |s| {
                        s.last_error = Some("실행 중인 Discord 데스크톱 앱을 찾지 못했습니다.".into());
                    });
                }
            }
        }

        // Poll incoming frames
        let mut drop_pipe = false;
        if let Some(p) = pipe.as_mut() {
            match pipe_frame_ready(p) {
                Ok(true) => match read_frame(p) {
                    Ok((opcode, val)) => {
                        if opcode == 2 {
                            drop_pipe = true;
                        } else {
                            let cmd_name = val.get("cmd").and_then(|v| v.as_str()).unwrap_or("");
                            let evt_name = val.get("evt").and_then(|v| v.as_str()).unwrap_or("");

                            if evt_name == "READY" {
                                let dc = read_discord_config().unwrap_or_default();
                                if !dc.access_token.is_empty() {
                                    let _ = write_frame(
                                        p,
                                        1,
                                        &json!({
                                            "cmd": "AUTHENTICATE",
                                            "args": { "access_token": dc.access_token },
                                            "nonce": next_nonce()
                                        }),
                                    );
                                } else if pending_auth {
                                    pending_auth = false;
                                    let _ = write_frame(
                                        p,
                                        1,
                                        &json!({
                                            "cmd": "AUTHORIZE",
                                            "args": {
                                                "client_id": dc.client_id,
                                                "scopes": ["rpc", "rpc.voice.read", "rpc.voice.write"]
                                            },
                                            "nonce": next_nonce()
                                        }),
                                    );
                                }
                            } else if evt_name == "ERROR" {
                                let msg = val
                                    .pointer("/data/message")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Discord RPC 오류")
                                    .to_string();

                                if cmd_name == "AUTHENTICATE" && !tried_refresh {
                                    tried_refresh = true;
                                    let dc = read_discord_config().unwrap_or_default();
                                    if !dc.refresh_token.is_empty() && !dc.client_secret.is_empty() {
                                        if let Ok((acc, ref_t)) =
                                            refresh_oauth(&dc.client_id, &dc.client_secret, &dc.refresh_token)
                                        {
                                            let _ = save_discord_cfg(&app, |cur| {
                                                cur.access_token = acc.clone();
                                                cur.refresh_token = ref_t;
                                            });
                                            let _ = write_frame(
                                                p,
                                                1,
                                                &json!({
                                                    "cmd": "AUTHENTICATE",
                                                    "args": { "access_token": acc },
                                                    "nonce": next_nonce()
                                                }),
                                            );
                                            continue;
                                        }
                                    }
                                }

                                update_state(&app, &state_lock, |s| {
                                    s.authenticated = false;
                                    s.last_error = Some(msg);
                                });
                            } else if cmd_name == "AUTHORIZE" {
                                if let Some(code) = val.pointer("/data/code").and_then(|v| v.as_str()) {
                                    let dc = read_discord_config().unwrap_or_default();
                                    match exchange_code(&dc.client_id, &dc.client_secret, code) {
                                        Ok((acc, ref_t)) => {
                                            let _ = save_discord_cfg(&app, |cur| {
                                                cur.access_token = acc.clone();
                                                cur.refresh_token = ref_t;
                                            });
                                            let _ = write_frame(
                                                p,
                                                1,
                                                &json!({
                                                    "cmd": "AUTHENTICATE",
                                                    "args": { "access_token": acc },
                                                    "nonce": next_nonce()
                                                }),
                                            );
                                        }
                                        Err(e) => {
                                            update_state(&app, &state_lock, |s| {
                                                s.last_error = Some(e);
                                            });
                                        }
                                    }
                                }
                            } else if cmd_name == "AUTHENTICATE" {
                                tried_refresh = false;
                                update_state(&app, &state_lock, |s| {
                                    s.authenticated = true;
                                    s.last_error = None;
                                });
                                let _ = write_frame(
                                    p,
                                    1,
                                    &json!({
                                        "cmd": "SUBSCRIBE",
                                        "evt": "VOICE_SETTINGS_UPDATE",
                                        "nonce": next_nonce()
                                    }),
                                );
                                let _ = write_frame(
                                    p,
                                    1,
                                    &json!({
                                        "cmd": "SUBSCRIBE",
                                        "evt": "VOICE_CHANNEL_SELECT",
                                        "nonce": next_nonce()
                                    }),
                                );
                                let _ = write_frame(
                                    p,
                                    1,
                                    &json!({
                                        "cmd": "GET_VOICE_SETTINGS",
                                        "nonce": next_nonce()
                                    }),
                                );
                            } else if evt_name == "VOICE_SETTINGS_UPDATE"
                                || cmd_name == "GET_VOICE_SETTINGS"
                                || cmd_name == "SET_VOICE_SETTINGS"
                            {
                                let mute = val.pointer("/data/mute").and_then(|v| v.as_bool());
                                let deaf = val.pointer("/data/deaf").and_then(|v| v.as_bool());
                                if mute.is_some() || deaf.is_some() {
                                    update_state(&app, &state_lock, |s| {
                                        if let Some(m) = mute {
                                            s.muted = m;
                                        }
                                        if let Some(d) = deaf {
                                            s.deaf = d;
                                        }
                                    });
                                }
                            } else if evt_name == "VOICE_CHANNEL_SELECT" {
                                let ch_id = val
                                    .pointer("/data/channel_id")
                                    .and_then(|v| v.as_str())
                                    .is_some();
                                update_state(&app, &state_lock, |s| {
                                    s.in_voice = ch_id;
                                });
                            }
                        }
                    }
                    Err(_) => {
                        drop_pipe = true;
                    }
                },
                Ok(_) => {}
                Err(_) => {
                    drop_pipe = true;
                }
            }
        }

        if drop_pipe {
            // tried_refresh is not reset here: if Discord closes the pipe after a failed
            // AUTHENTICATE, resetting would retry the OAuth refresh on every reconnect.
            pipe = None;
            update_state(&app, &state_lock, |s| {
                s.pipe_connected = false;
                s.authenticated = false;
            });
        }

        if pipe.is_some() {
            thread::sleep(Duration::from_millis(50));
        }
    }
}
