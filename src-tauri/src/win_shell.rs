use crate::config::get_data_dir;
use crate::win_com::ComGuard;
use image::{imageops::FilterType, RgbaImage};
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::Path;
use windows::core::{Interface, HSTRING};
use windows::Win32::Foundation::MAX_PATH;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};
use windows::Win32::Networking::WinHttp::{
    WinHttpCloseHandle, WinHttpConnect, WinHttpOpen, WinHttpOpenRequest, WinHttpQueryDataAvailable,
    WinHttpReadData, WinHttpReceiveResponse, WinHttpSendRequest, WinHttpSetTimeouts,
    WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_FLAG_SECURE, WINHTTP_OPEN_REQUEST_FLAGS,
};
use windows::Win32::Storage::FileSystem::{
    FILE_ATTRIBUTE_DIRECTORY, FILE_FLAGS_AND_ATTRIBUTES,
};
use windows::Win32::System::Com::{
    CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER, STGM_READ,
};
use windows::Win32::UI::Controls::{IImageList, ILD_TRANSPARENT};
use windows::Win32::UI::Shell::{
    IShellLinkW, SHGetFileInfoW, SHGetImageList, ShellLink, SHFILEINFOW, SHGFI_SYSICONINDEX,
    SHGFI_USEFILEATTRIBUTES, SHIL_JUMBO, SLGP_RAWPATH,
};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedDrop {
    pub kind: String, // "app" | "folder" | "url" | "image"
    pub label: String,
    pub exe: String,
    pub args: String,
    pub work_dir: String,
    pub proc_name: String,
    pub url: String,
    pub icon_path: Option<String>,
}

fn expand_env_vars(input: &str) -> String {
    let mut out = input.to_string();
    for (k, v) in std::env::vars() {
        let token = format!("%{}%", k);
        if out.to_ascii_lowercase().contains(&token.to_ascii_lowercase()) {
            // Case-insensitive replace
            let lower = out.to_ascii_lowercase();
            let token_lower = token.to_ascii_lowercase();
            let mut result = String::new();
            let mut idx = 0;
            while let Some(pos) = lower[idx..].find(&token_lower) {
                result.push_str(&out[idx..idx + pos]);
                result.push_str(&v);
                idx += pos + token.len();
            }
            result.push_str(&out[idx..]);
            out = result;
        }
    }
    out
}

fn utf16_buf_to_string(buf: &[u16]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

#[derive(Debug, Default)]
struct LnkData {
    target: String,
    args: String,
    work_dir: String,
    icon_file: String,
}

fn parse_lnk(lnk_path: &str) -> Result<LnkData, String> {
    let _com = ComGuard::sta();
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
            .map_err(|e| format!("CoCreateInstance ShellLink: {e}"))?;
        let persist: IPersistFile = link
            .cast()
            .map_err(|e| format!("cast IPersistFile: {e}"))?;
        persist
            .Load(&HSTRING::from(lnk_path), STGM_READ)
            .map_err(|e| format!("IPersistFile::Load: {e}"))?;

        let mut target_buf = vec![0u16; MAX_PATH as usize * 2];
        let _ = link.GetPath(&mut target_buf, std::ptr::null_mut(), SLGP_RAWPATH.0 as u32);
        let target = expand_env_vars(utf16_buf_to_string(&target_buf).trim());

        let mut args_buf = vec![0u16; 2048];
        let _ = link.GetArguments(&mut args_buf);
        let args = utf16_buf_to_string(&args_buf).trim().to_string();

        let mut wd_buf = vec![0u16; MAX_PATH as usize * 2];
        let _ = link.GetWorkingDirectory(&mut wd_buf);
        let work_dir = expand_env_vars(utf16_buf_to_string(&wd_buf).trim());

        let mut icon_buf = vec![0u16; MAX_PATH as usize * 2];
        let mut _icon_idx: i32 = 0;
        let _ = link.GetIconLocation(&mut icon_buf, &mut _icon_idx);
        let icon_file = expand_env_vars(utf16_buf_to_string(&icon_buf).trim());

        Ok(LnkData {
            target,
            args,
            work_dir,
            icon_file,
        })
    }
}

fn parse_url_file(url_path: &str) -> Result<(String, Option<String>), String> {
    let content = fs::read_to_string(url_path).map_err(|e| e.to_string())?;
    let mut url = None;
    let mut icon = None;
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("URL=") {
            url = Some(rest.trim().to_string());
        } else if let Some(rest) = trimmed.strip_prefix("IconFile=") {
            icon = Some(expand_env_vars(rest.trim()));
        }
    }
    match url {
        Some(u) => Ok((u, icon)),
        None => Err("URL= 항목을 찾지 못했습니다.".into()),
    }
}

fn hicon_to_rgba(hicon: HICON) -> Result<RgbaImage, String> {
    unsafe {
        let mut icon_info = ICONINFO::default();
        GetIconInfo(hicon, &mut icon_info).map_err(|e| format!("GetIconInfo: {e}"))?;

        struct IconBmpGuard(ICONINFO);
        impl Drop for IconBmpGuard {
            fn drop(&mut self) {
                unsafe {
                    if !self.0.hbmColor.is_invalid() {
                        let _ = DeleteObject(self.0.hbmColor);
                    }
                    if !self.0.hbmMask.is_invalid() {
                        let _ = DeleteObject(self.0.hbmMask);
                    }
                }
            }
        }
        let _guard = IconBmpGuard(icon_info);

        let hbm = if !icon_info.hbmColor.is_invalid() {
            icon_info.hbmColor
        } else {
            icon_info.hbmMask
        };

        let mut bmp = BITMAP::default();
        if GetObjectW(
            hbm,
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bmp as *mut _ as *mut _),
        ) == 0
        {
            return Err("GetObjectW failed".into());
        }

        let w = bmp.bmWidth.max(1) as u32;
        let h = bmp.bmHeight.max(1) as u32;

        let hdc = CreateCompatibleDC(None);
        if hdc.is_invalid() {
            return Err("CreateCompatibleDC failed".into());
        }
        struct DcGuard(windows::Win32::Graphics::Gdi::HDC);
        impl Drop for DcGuard {
            fn drop(&mut self) {
                unsafe {
                    let _ = DeleteDC(self.0);
                }
            }
        }
        let _dc_guard = DcGuard(hdc);

        let mut bi = BITMAPINFO::default();
        bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bi.bmiHeader.biWidth = w as i32;
        bi.bmiHeader.biHeight = -(h as i32); // top-down
        bi.bmiHeader.biPlanes = 1;
        bi.bmiHeader.biBitCount = 32;
        bi.bmiHeader.biCompression = BI_RGB.0;

        let mut bgra = vec![0u8; (w * h * 4) as usize];
        let lines = GetDIBits(
            hdc,
            hbm,
            0,
            h,
            Some(bgra.as_mut_ptr() as *mut _),
            &mut bi,
            DIB_RGB_COLORS,
        );
        if lines == 0 {
            return Err("GetDIBits color failed".into());
        }

        let mut any_alpha = false;
        for chunk in bgra.chunks_exact_mut(4) {
            chunk.swap(0, 2); // BGRA -> RGBA
            if chunk[3] != 0 {
                any_alpha = true;
            }
        }

        // Legacy icons without alpha channel: reconstruct transparency from hbmMask
        if !any_alpha && !icon_info.hbmMask.is_invalid() {
            let mut mask_bgra = vec![0u8; (w * h * 4) as usize];
            let mlines = GetDIBits(
                hdc,
                icon_info.hbmMask,
                0,
                h,
                Some(mask_bgra.as_mut_ptr() as *mut _),
                &mut bi,
                DIB_RGB_COLORS,
            );
            if mlines != 0 {
                for (px, m) in bgra.chunks_exact_mut(4).zip(mask_bgra.chunks_exact(4)) {
                    px[3] = if m[0] == 0 && m[1] == 0 && m[2] == 0 {
                        255
                    } else {
                        0
                    };
                }
            }
        }

        let mut img =
            RgbaImage::from_raw(w, h, bgra).ok_or_else(|| "RgbaImage::from_raw failed".to_string())?;

        // Detect small legacy icon stuck in top-left corner of 256x256 jumbo canvas
        let (mut min_x, mut min_y, mut max_x, mut max_y) = (w, h, 0u32, 0u32);
        for y in 0..h {
            for x in 0..w {
                if img.get_pixel(x, y)[3] > 8 {
                    min_x = min_x.min(x);
                    min_y = min_y.min(y);
                    max_x = max_x.max(x);
                    max_y = max_y.max(y);
                }
            }
        }
        if max_x >= min_x && max_y >= min_y {
            let bw = max_x - min_x + 1;
            let bh = max_y - min_y + 1;
            if min_x <= 8 && min_y <= 8 && bw <= 72 && bh <= 72 && w >= 128 {
                let cropped = image::imageops::crop(&mut img, min_x, min_y, bw, bh).to_image();
                img = image::imageops::resize(&cropped, 256, 256, FilterType::Lanczos3);
            }
        }

        Ok(img)
    }
}

pub fn extract_icon_asset(source_path: &str, is_folder: bool) -> Result<String, String> {
    let _com = ComGuard::sta();
    let expanded = expand_env_vars(source_path);
    let data_dir = get_data_dir()?;

    let mut hasher = DefaultHasher::new();
    expanded.to_ascii_lowercase().hash(&mut hasher);
    is_folder.hash(&mut hasher);
    let hash = hasher.finish();
    let rel_path = format!("assets/icon_{:016x}.png", hash);
    let dest = data_dir.join(&rel_path);
    if dest.exists() {
        return Ok(rel_path);
    }

    unsafe {
        let mut shfi = SHFILEINFOW::default();
        let mut flags = SHGFI_SYSICONINDEX;
        let attrs = if is_folder {
            flags |= SHGFI_USEFILEATTRIBUTES;
            FILE_ATTRIBUTE_DIRECTORY
        } else {
            FILE_FLAGS_AND_ATTRIBUTES(0)
        };

        let hres = SHGetFileInfoW(
            &HSTRING::from(expanded.as_str()),
            attrs,
            Some(&mut shfi),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            flags,
        );
        if hres == 0 {
            return Err(format!("SHGetFileInfoW failed for {expanded}"));
        }

        let image_list: IImageList =
            SHGetImageList(SHIL_JUMBO as i32).map_err(|e| format!("SHGetImageList: {e}"))?;
        let hicon = image_list
            .GetIcon(shfi.iIcon, ILD_TRANSPARENT.0)
            .map_err(|e| format!("IImageList::GetIcon: {e}"))?;

        let img_res = hicon_to_rgba(hicon);
        let _ = DestroyIcon(hicon);
        let img = img_res?;
        img.save(&dest).map_err(|e| format!("save icon png: {e}"))?;
        Ok(rel_path)
    }
}

fn http_get_bytes(host: &str, port: u16, path_query: &str, https: bool) -> Result<Vec<u8>, String> {
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
        struct HandleGuard(*mut core::ffi::c_void);
        impl Drop for HandleGuard {
            fn drop(&mut self) {
                unsafe {
                    if !self.0.is_null() {
                        let _ = WinHttpCloseHandle(self.0);
                    }
                }
            }
        }
        let _s_guard = HandleGuard(session);
        let _ = WinHttpSetTimeouts(session, 2500, 2500, 2500, 2500);

        let conn = WinHttpConnect(session, &HSTRING::from(host), port, 0);
        if conn.is_null() {
            return Err("WinHttpConnect failed".into());
        }
        let _c_guard = HandleGuard(conn);

        let flags = if https {
            WINHTTP_FLAG_SECURE
        } else {
            WINHTTP_OPEN_REQUEST_FLAGS(0)
        };
        let req = WinHttpOpenRequest(
            conn,
            &HSTRING::from("GET"),
            &HSTRING::from(path_query),
            None,
            None,
            std::ptr::null(),
            flags,
        );
        if req.is_null() {
            return Err("WinHttpOpenRequest failed".into());
        }
        let _r_guard = HandleGuard(req);

        WinHttpSendRequest(req, None, None, 0, 0, 0)
            .map_err(|e| format!("WinHttpSendRequest: {e}"))?;
        WinHttpReceiveResponse(req, std::ptr::null_mut())
            .map_err(|e| format!("WinHttpReceiveResponse: {e}"))?;

        let mut out = Vec::new();
        loop {
            let mut avail: u32 = 0;
            WinHttpQueryDataAvailable(req, &mut avail)
                .map_err(|e| format!("WinHttpQueryDataAvailable: {e}"))?;
            if avail == 0 {
                break;
            }
            let chunk_len = avail.min(65536) as usize;
            let mut buf = vec![0u8; chunk_len];
            let mut read: u32 = 0;
            WinHttpReadData(req, buf.as_mut_ptr() as *mut _, chunk_len as u32, &mut read)
                .map_err(|e| format!("WinHttpReadData: {e}"))?;
            if read == 0 {
                break;
            }
            out.extend_from_slice(&buf[..read as usize]);
            if out.len() > 524_288 {
                break;
            }
        }
        Ok(out)
    }
}

pub fn fetch_favicon_asset(raw_url: &str) -> Result<String, String> {
    let trimmed = raw_url.trim();
    let without_scheme = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .unwrap_or(trimmed);
    let authority = without_scheme.split('/').next().unwrap_or("");
    let host = authority.split(':').next().unwrap_or("").trim();
    if host.is_empty() {
        return Err("유효한 도메인이 아닙니다.".into());
    }

    let data_dir = get_data_dir()?;
    let mut hasher = DefaultHasher::new();
    host.to_ascii_lowercase().hash(&mut hasher);
    let rel_path = format!("assets/fav_{:016x}.png", hasher.finish());
    let dest = data_dir.join(&rel_path);
    if dest.exists() {
        return Ok(rel_path);
    }

    let is_local_or_ip = host.eq_ignore_ascii_case("localhost")
        || host.chars().all(|c| c.is_ascii_digit() || c == '.');

    let bytes = if is_local_or_ip {
        let port: u16 = authority
            .split(':')
            .nth(1)
            .and_then(|p| p.parse().ok())
            .unwrap_or(if trimmed.starts_with("https://") { 443 } else { 80 });
        http_get_bytes(host, port, "/favicon.ico", trimmed.starts_with("https://"))?
    } else {
        let q = format!("/s2/favicons?domain={host}&sz=128");
        http_get_bytes("www.google.com", 443, &q, true)?
    };

    if bytes.is_empty() {
        return Err("파비콘 응답이 비어 있습니다.".into());
    }
    let img = image::load_from_memory(&bytes).map_err(|e| format!("이미지 디코드 실패: {e}"))?;
    let resized = if img.width() < 64 {
        img.resize_exact(128, 128, FilterType::Lanczos3)
    } else {
        img
    };
    resized.save(&dest).map_err(|e| format!("파비콘 저장 실패: {e}"))?;
    Ok(rel_path)
}

fn clean_label_from_path(p: &Path) -> String {
    p.file_stem()
        .or_else(|| p.file_name())
        .and_then(|s| s.to_str())
        .unwrap_or("APP")
        .to_string()
}

fn infer_proc_name(exe_path: &str, icon_file: &str) -> String {
    let stem = Path::new(exe_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let lower = stem.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "conhost" | "powershell" | "pwsh" | "cmd" | "wscript" | "cscript"
    ) && !icon_file.is_empty()
    {
        if let Some(icon_stem) = Path::new(icon_file).file_stem().and_then(|s| s.to_str()) {
            if !icon_stem.is_empty() {
                return icon_stem.to_string();
            }
        }
    }
    stem
}

pub fn inspect_dropped_path(raw_path: &str) -> Result<ResolvedDrop, String> {
    let p = Path::new(raw_path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "ico" | "svg" | "bmp") {
        return Ok(ResolvedDrop {
            kind: "image".into(),
            label: clean_label_from_path(p),
            exe: raw_path.into(),
            args: String::new(),
            work_dir: String::new(),
            proc_name: String::new(),
            url: String::new(),
            icon_path: None,
        });
    }

    if p.is_dir() {
        let label = p
            .file_name()
            .and_then(|s| s.to_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(raw_path)
            .to_string();
        let icon_path = extract_icon_asset(r"C:\Windows\explorer.exe", false)
            .or_else(|_| extract_icon_asset(raw_path, true))
            .ok();
        return Ok(ResolvedDrop {
            kind: "folder".into(),
            label,
            exe: raw_path.into(),
            args: String::new(),
            work_dir: String::new(),
            proc_name: String::new(),
            url: String::new(),
            icon_path,
        });
    }

    if ext == "lnk" {
        let lnk = parse_lnk(raw_path)?;
        let label = clean_label_from_path(p);

        if !lnk.target.is_empty() && Path::new(&lnk.target).is_dir() {
            let icon_path = extract_icon_asset(r"C:\Windows\explorer.exe", false).ok();
            return Ok(ResolvedDrop {
                kind: "folder".into(),
                label,
                exe: lnk.target,
                args: String::new(),
                work_dir: String::new(),
                proc_name: String::new(),
                url: String::new(),
                icon_path,
            });
        }

        let icon_src = if !lnk.icon_file.is_empty() && Path::new(&lnk.icon_file).exists() {
            lnk.icon_file.clone()
        } else if !lnk.target.is_empty() {
            lnk.target.clone()
        } else {
            raw_path.to_string()
        };

        let icon_path = extract_icon_asset(&icon_src, false)
            .or_else(|_| extract_icon_asset(raw_path, false))
            .ok();

        let exe = if lnk.target.is_empty() {
            raw_path.to_string()
        } else {
            lnk.target
        };
        let proc_name = infer_proc_name(&exe, &lnk.icon_file);

        return Ok(ResolvedDrop {
            kind: "app".into(),
            label,
            exe,
            args: lnk.args,
            work_dir: lnk.work_dir,
            proc_name,
            url: String::new(),
            icon_path,
        });
    }

    if ext == "url" {
        let (url, icon_file) = parse_url_file(raw_path)?;
        let label = clean_label_from_path(p);
        let icon_path = icon_file
            .as_deref()
            .and_then(|f| extract_icon_asset(f, false).ok())
            .or_else(|| {
                extract_icon_asset(r"C:\Program Files\Google\Chrome\Application\chrome.exe", false).ok()
            });
        return Ok(ResolvedDrop {
            kind: "url".into(),
            label,
            exe: String::new(),
            args: String::new(),
            work_dir: String::new(),
            proc_name: String::new(),
            url,
            icon_path,
        });
    }

    // Regular .exe / .cmd / .bat / file
    let label = clean_label_from_path(p);
    let icon_path = extract_icon_asset(raw_path, false).ok();
    let proc_name = infer_proc_name(raw_path, "");
    let work_dir = p
        .parent()
        .and_then(|d| d.to_str())
        .unwrap_or("")
        .to_string();

    Ok(ResolvedDrop {
        kind: "app".into(),
        label,
        exe: raw_path.into(),
        args: String::new(),
        work_dir,
        proc_name,
        url: String::new(),
        icon_path,
    })
}
