use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::os::windows::process::CommandExt;
use std::process::Command;
use tauri::AppHandle;
use windows::core::HSTRING;
use windows::Win32::Networking::WinHttp::{
    WinHttpCloseHandle, WinHttpConnect, WinHttpOpen, WinHttpOpenRequest, WinHttpQueryDataAvailable,
    WinHttpQueryHeaders, WinHttpReadData, WinHttpReceiveResponse, WinHttpSendRequest,
    WinHttpSetTimeouts, WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_FLAG_SECURE,
    WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_QUERY_STATUS_CODE,
};

const REPO_OWNER: &str = "ForUltraplayer";
const REPO_NAME: &str = "TouchDeck";
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_url: String,
    pub download_url: Option<String>,
    pub notes: String,
}

fn parse_url_parts(raw_url: &str) -> Result<(String, u16, String, bool), String> {
    let https = raw_url.starts_with("https://");
    let stripped = raw_url
        .strip_prefix("https://")
        .or_else(|| raw_url.strip_prefix("http://"))
        .ok_or_else(|| format!("지원하지 않는 URL: {raw_url}"))?;

    let (authority, path_query) = match stripped.find('/') {
        Some(idx) => (&stripped[..idx], &stripped[idx..]),
        None => (stripped, "/"),
    };
    let (host, port) = match authority.find(':') {
        Some(idx) => {
            let p: u16 = authority[idx + 1..].parse().unwrap_or(if https { 443 } else { 80 });
            (&authority[..idx], p)
        }
        None => (authority, if https { 443 } else { 80 }),
    };
    Ok((host.to_string(), port, path_query.to_string(), https))
}

fn winhttp_get(raw_url: &str, max_bytes: usize) -> Result<Vec<u8>, String> {
    let (host, port, path_query, https) = parse_url_parts(raw_url)?;
    unsafe {
        let ua = format!("TouchDeck/{}", env!("CARGO_PKG_VERSION"));
        let session = WinHttpOpen(
            &HSTRING::from(ua),
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
        let _ = WinHttpSetTimeouts(session, 5000, 5000, 10000, 30000);

        let conn = WinHttpConnect(session, &HSTRING::from(host.as_str()), port, 0);
        if conn.is_null() {
            return Err("WinHttpConnect failed".into());
        }
        let _cg = HGuard(conn);

        let flags = if https {
            WINHTTP_FLAG_SECURE
        } else {
            windows::Win32::Networking::WinHttp::WINHTTP_OPEN_REQUEST_FLAGS(0)
        };
        let req = WinHttpOpenRequest(
            conn,
            &HSTRING::from("GET"),
            &HSTRING::from(path_query.as_str()),
            None,
            None,
            std::ptr::null(),
            flags,
        );
        if req.is_null() {
            return Err("WinHttpOpenRequest failed".into());
        }
        let _rg = HGuard(req);

        let headers = HSTRING::from("Accept: application/vnd.github+json\r\n");
        WinHttpSendRequest(req, Some(headers.as_wide()), None, 0, 0, 0)
            .map_err(|e| format!("WinHttpSendRequest: {e}"))?;
        WinHttpReceiveResponse(req, std::ptr::null_mut())
            .map_err(|e| format!("WinHttpReceiveResponse: {e}"))?;

        let mut status: u32 = 0;
        let mut status_len = std::mem::size_of::<u32>() as u32;
        let _ = WinHttpQueryHeaders(
            req,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            None,
            Some(&mut status as *mut _ as *mut _),
            &mut status_len,
            std::ptr::null_mut(),
        );
        if status >= 400 {
            return Err(format!("HTTP 오류 상태 코드: {status}"));
        }

        let mut out = Vec::new();
        loop {
            let mut avail: u32 = 0;
            WinHttpQueryDataAvailable(req, &mut avail)
                .map_err(|e| format!("WinHttpQueryDataAvailable: {e}"))?;
            if avail == 0 {
                break;
            }
            let chunk = avail.min(65536) as usize;
            let mut buf = vec![0u8; chunk];
            let mut read = 0u32;
            WinHttpReadData(req, buf.as_mut_ptr() as *mut _, chunk as u32, &mut read)
                .map_err(|e| format!("WinHttpReadData: {e}"))?;
            if read == 0 {
                break;
            }
            out.extend_from_slice(&buf[..read as usize]);
            if out.len() > max_bytes {
                return Err("다운로드 크기가 제한을 초과했습니다.".into());
            }
        }
        Ok(out)
    }
}

fn parse_semver(v: &str) -> (u32, u32, u32) {
    let clean = v.trim().trim_start_matches(['v', 'V']);
    let core = clean.split(['-', '+']).next().unwrap_or(clean);
    let mut parts = core.split('.').map(|s| s.parse::<u32>().unwrap_or(0));
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

pub fn check_for_update() -> Result<UpdateInfo, String> {
    let api_url = format!("https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/releases/latest");
    let bytes = winhttp_get(&api_url, 2 * 1024 * 1024)?;
    let val: Value = serde_json::from_slice(&bytes).map_err(|e| format!("JSON 파싱 실패: {e}"))?;

    let tag = val
        .get("tag_name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "릴리즈 태그 정보를 찾지 못했습니다.".to_string())?;
    let latest_version = tag.trim().trim_start_matches(['v', 'V']).to_string();
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    let has_update = parse_semver(&latest_version) > parse_semver(&current_version);
    let release_url = val
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let notes = val
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let mut download_url = None;
    if let Some(assets) = val.get("assets").and_then(|v| v.as_array()) {
        for asset in assets {
            let name = asset
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if name.ends_with(".exe") {
                if let Some(u) = asset.get("browser_download_url").and_then(|v| v.as_str()) {
                    download_url = Some(u.to_string());
                    break;
                }
            }
        }
    }

    Ok(UpdateInfo {
        current_version,
        latest_version,
        has_update,
        release_url,
        download_url,
        notes,
    })
}

pub fn download_and_apply_update(app: &AppHandle, download_url: &str) -> Result<(), String> {
    let cur_exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let cur_dir = cur_exe
        .parent()
        .ok_or_else(|| "실행 경로 확인 실패".to_string())?;

    // Ensure current directory is writable before downloading
    let probe = cur_dir.join(".touchdeck_write_test");
    fs::write(&probe, b"1").map_err(|_| {
        "설치 폴더에 쓰기 권한이 없어 자동 교체할 수 없습니다. 릴리즈 페이지에서 직접 다운로드해 주세요."
            .to_string()
    })?;
    let _ = fs::remove_file(&probe);

    let bytes = winhttp_get(download_url, 128 * 1024 * 1024)?;
    if bytes.len() < 1_000_000 || &bytes[..2] != b"MZ" {
        return Err("다운로드된 실행 파일이 올바르지 않습니다.".into());
    }

    let new_exe = std::env::temp_dir().join("touchdeck_update_new.exe");
    fs::write(&new_exe, &bytes).map_err(|e| format!("임시 파일 저장 실패: {e}"))?;

    let pid = std::process::id();
    let bat_path = std::env::temp_dir().join("touchdeck_apply_update.cmd");
    let script = format!(
        "@echo off\r\n\
         set /a tries=0\r\n\
         :wait\r\n\
         timeout /t 1 /nobreak >nul\r\n\
         tasklist /FI \"PID eq {pid}\" 2>nul | find \"{pid}\" >nul\r\n\
         if not errorlevel 1 goto wait\r\n\
         :copytry\r\n\
         copy /y \"{src}\" \"{dst}\" >nul 2>&1\r\n\
         if errorlevel 1 (\r\n\
           set /a tries+=1\r\n\
           if %tries% LSS 6 (\r\n\
             timeout /t 1 /nobreak >nul\r\n\
             goto copytry\r\n\
           )\r\n\
         )\r\n\
         del /q \"{src}\" >nul 2>&1\r\n\
         start \"\" \"{dst}\"\r\n\
         del \"%~f0\"\r\n",
        pid = pid,
        src = new_exe.to_string_lossy(),
        dst = cur_exe.to_string_lossy()
    );
    fs::write(&bat_path, script.as_bytes()).map_err(|e| format!("업데이트 스크립트 실패: {e}"))?;

    Command::new("cmd.exe")
        .args(["/c", &bat_path.to_string_lossy()])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("업데이터 실행 실패: {e}"))?;

    app.exit(0);
    Ok(())
}
