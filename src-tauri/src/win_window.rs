use crate::win_com::ComGuard;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::Once;
use std::thread;
use std::time::Duration;
use windows::core::{w, Interface, HSTRING};
use windows::Win32::Foundation::{ERROR_SUCCESS, HWND, MAX_PATH, POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, MonitorFromRect, MONITORINFO, MONITOR_DEFAULTTOPRIMARY,
    MONITOR_DEFAULTTONULL,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoTaskMemFree, IPersistFile, CLSCTX_INPROC_SERVER, STGM_READ,
};
use windows::Win32::System::Registry::{
    RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER,
    KEY_QUERY_VALUE, KEY_SET_VALUE, REG_BINARY, REG_VALUE_TYPE,
};
use windows::Win32::UI::Shell::{
    FOLDERID_Startup, IShellLinkW, SHGetKnownFolderPath, ShellLink, KF_FLAG_DEFAULT, SLGP_RAWPATH,
};
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowW, GetClassNameW, GetForegroundWindow, GetWindow, GetWindowLongPtrW, GetWindowLongW,
    IsIconic, IsWindow, IsWindowVisible, SetWindowLongPtrW, SetWindowLongW, SetWindowPos,
    ShowWindow, GWLP_HWNDPARENT, GWL_EXSTYLE, GW_HWNDPREV, HWND_NOTOPMOST, HWND_TOPMOST,
    SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW,
    SW_SHOWNOACTIVATE, WS_EX_NOACTIVATE,
};

static DESKTOP_LAYER_ENABLED: AtomicBool = AtomicBool::new(false);
static DESKTOP_ALWAYS_ON_TOP: AtomicBool = AtomicBool::new(false);
static USER_HIDDEN: AtomicBool = AtomicBool::new(false);
static MAIN_HWND: AtomicIsize = AtomicIsize::new(0);
static MONITOR_STARTED: Once = Once::new();

pub fn set_user_hidden(hidden: bool) {
    USER_HIDDEN.store(hidden, Ordering::SeqCst);
}

const STARTUP_SHORTCUT_NAME: &str = "TouchDeck.lnk";

fn startup_dir() -> Result<PathBuf, String> {
    unsafe {
        if let Ok(pw) = SHGetKnownFolderPath(&FOLDERID_Startup, KF_FLAG_DEFAULT, None) {
            let s = pw.to_string().ok();
            CoTaskMemFree(Some(pw.0 as *const _));
            if let Some(path) = s.filter(|p| !p.is_empty()) {
                return Ok(PathBuf::from(path));
            }
        }
    }
    let appdata = std::env::var("APPDATA").map_err(|_| "APPDATA not found".to_string())?;
    Ok(PathBuf::from(appdata)
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs")
        .join("Startup"))
}

fn startup_shortcut_path() -> Result<PathBuf, String> {
    Ok(startup_dir()?.join(STARTUP_SHORTCUT_NAME))
}

// Windows Task Manager / Settings records disabled Startup folder items under
// HKCU\...\Explorer\StartupApproved\StartupFolder as a 12-byte REG_BINARY where
// an odd first byte (e.g. 0x03, 0x01) means disabled and even (0x02, 0x06) enabled.
fn is_startup_approved_bytes_disabled(data: &[u8]) -> bool {
    !data.is_empty() && (data[0] & 1) != 0
}

pub fn is_startup_approved_disabled() -> bool {
    unsafe {
        let mut hkey = HKEY::default();
        let open_res = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            w!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder"),
            0,
            KEY_QUERY_VALUE,
            &mut hkey,
        );
        if open_res != ERROR_SUCCESS {
            return false;
        }
        let mut reg_type = REG_VALUE_TYPE::default();
        let mut buf = [0u8; 32];
        let mut len = buf.len() as u32;
        let query_res = RegQueryValueExW(
            hkey,
            w!("TouchDeck.lnk"),
            None,
            Some(&mut reg_type),
            Some(buf.as_mut_ptr()),
            Some(&mut len),
        );
        let _ = RegCloseKey(hkey);
        query_res == ERROR_SUCCESS
            && reg_type == REG_BINARY
            && is_startup_approved_bytes_disabled(&buf[..len as usize])
    }
}

fn clear_startup_approved_entry() {
    unsafe {
        let mut hkey = HKEY::default();
        let open_res = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            w!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder"),
            0,
            KEY_SET_VALUE,
            &mut hkey,
        );
        if open_res == ERROR_SUCCESS {
            let _ = RegDeleteValueW(hkey, w!("TouchDeck.lnk"));
            let _ = RegCloseKey(hkey);
        }
    }
}

fn utf16_buf_to_string(buf: &[u16]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

fn paths_match_windows(a: &str, b: &str) -> bool {
    let norm = |s: &str| {
        s.trim()
            .trim_end_matches(['\\', '/'])
            .replace('/', "\\")
            .to_ascii_lowercase()
    };
    norm(a) == norm(b)
}

fn read_shortcut_target_and_dir(lnk_path: &Path) -> Option<(String, String)> {
    let _com = ComGuard::sta();
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        let persist: IPersistFile = link.cast().ok()?;
        persist
            .Load(&HSTRING::from(lnk_path.to_string_lossy().as_ref()), STGM_READ)
            .ok()?;

        let mut target_buf = vec![0u16; MAX_PATH as usize * 2];
        link.GetPath(&mut target_buf, std::ptr::null_mut(), SLGP_RAWPATH.0 as u32)
            .ok()?;
        let target = utf16_buf_to_string(&target_buf);

        let mut wd_buf = vec![0u16; MAX_PATH as usize * 2];
        link.GetWorkingDirectory(&mut wd_buf).ok()?;
        let work_dir = utf16_buf_to_string(&wd_buf);

        Some((target, work_dir))
    }
}

pub fn is_autostart_enabled() -> bool {
    startup_shortcut_path()
        .map(|p| p.exists() && !is_startup_approved_disabled())
        .unwrap_or(false)
}

/// Keeps the Startup shortcut in sync on launch:
/// - Skips dev/target builds.
/// - Respects Windows Task Manager's disabled state (`StartupApproved`).
/// - Rewrites an existing shortcut only when its target or working dir changed.
/// - Recreates a missing shortcut when `saved_pref == Some(true)` (e.g. after a
///   manual NSIS upgrade whose uninstall step removed the old shortcut).
/// Returns `Some(true)` when an existing active shortcut should be backfilled into config.
pub fn sync_autostart_on_startup(saved_pref: Option<bool>) -> Result<Option<bool>, String> {
    if cfg!(debug_assertions) {
        return Ok(None);
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_str = exe.to_string_lossy();
    if exe_str.contains("\\target\\") || exe_str.contains("/target/") {
        return Ok(None);
    }
    let exe_dir = exe
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let lnk_path = startup_shortcut_path()?;
    let disabled_by_os = is_startup_approved_disabled();

    if lnk_path.exists() {
        if disabled_by_os {
            return Ok(None);
        }
        let matches = read_shortcut_target_and_dir(&lnk_path).is_some_and(|(t, wd)| {
            paths_match_windows(&t, &exe_str) && paths_match_windows(&wd, &exe_dir)
        });
        if !matches {
            set_autostart(true)?;
        }
        return Ok(if saved_pref.is_none() {
            Some(true)
        } else {
            None
        });
    }

    if saved_pref == Some(true) && !disabled_by_os {
        set_autostart(true)?;
    }
    Ok(None)
}

pub fn set_autostart(enabled: bool) -> Result<bool, String> {
    let lnk_path = startup_shortcut_path()?;
    if !enabled {
        if lnk_path.exists() {
            std::fs::remove_file(&lnk_path).map_err(|e| e.to_string())?;
        }
        clear_startup_approved_entry();
        return Ok(false);
    }

    if let Some(parent) = lnk_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe_path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let _com = ComGuard::sta();
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
            .map_err(|e| e.to_string())?;
        link.SetPath(&HSTRING::from(exe_path.to_string_lossy().as_ref()))
            .map_err(|e| e.to_string())?;
        link.SetWorkingDirectory(&HSTRING::from(exe_dir.as_str()))
            .map_err(|e| e.to_string())?;
        let persist: IPersistFile = link.cast().map_err(|e| e.to_string())?;
        persist
            .Save(&HSTRING::from(lnk_path.to_string_lossy().as_ref()), true)
            .map_err(|e| e.to_string())?;
    }
    // Clear any prior Task Manager "Disabled" entry so Windows actually launches it.
    clear_startup_approved_entry();
    Ok(true)
}

pub fn set_no_activate(hwnd_raw: isize, enabled: bool) {
    unsafe {
        let hwnd = HWND(hwnd_raw as *mut _);
        if hwnd.0.is_null() || !IsWindow(hwnd).as_bool() {
            return;
        }
        let ex = GetWindowLongW(hwnd, GWL_EXSTYLE);
        let flag = WS_EX_NOACTIVATE.0 as i32;
        let next = if enabled { ex | flag } else { ex & !flag };
        if next != ex {
            SetWindowLongW(hwnd, GWL_EXSTYLE, next);
            let _ = SetWindowPos(
                hwnd,
                None,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBoundsResult {
    pub x: i32,
    pub y: i32,
    pub base_x: i32,
    pub base_y: i32,
    pub dock_on_left: bool,
    pub dock_phys_w: i32,
    pub scale: f64,
    pub recentered: bool,
}

unsafe fn get_monitor_work_area(x: i32, y: i32, w: i32, h: i32) -> (RECT, bool) {
    let center = POINT {
        x: x + w / 2,
        y: y + h / 2,
    };
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    let mon = MonitorFromPoint(center, MONITOR_DEFAULTTONULL);
    if !mon.is_invalid() && GetMonitorInfoW(mon, &mut info).as_bool() {
        return (info.rcWork, false);
    }
    let win_rc = RECT {
        left: x,
        top: y,
        right: x + w.max(1),
        bottom: y + h.max(1),
    };
    let mon_rect = MonitorFromRect(&win_rc, MONITOR_DEFAULTTONULL);
    if !mon_rect.is_invalid() && GetMonitorInfoW(mon_rect, &mut info).as_bool() {
        return (info.rcWork, false);
    }
    let primary = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
    if GetMonitorInfoW(primary, &mut info).as_bool() {
        return (info.rcWork, true);
    }
    (
        RECT {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1040,
        },
        true,
    )
}

pub fn clamp_window_position(x: i32, y: i32, w: i32, h: i32) -> (i32, i32) {
    unsafe {
        let (rc, recentered) = get_monitor_work_area(x, y, w, h);
        if recentered {
            let cx = rc.left + ((rc.right - rc.left) - w).max(0) / 2;
            let cy = rc.top + ((rc.bottom - rc.top) - h).max(0) / 2;
            return (cx, cy);
        }
        let max_x = (rc.right - w).max(rc.left);
        let max_y = (rc.bottom - h).max(rc.top);
        (x.clamp(rc.left, max_x), y.clamp(rc.top, max_y))
    }
}

fn compute_window_bounds(
    rc: RECT,
    recentered: bool,
    raw_x: i32,
    raw_y: i32,
    phys_grid_w: i32,
    phys_grid_h: i32,
    phys_dock_w: i32,
    phys_target_w: i32,
    phys_target_h: i32,
    scale: f64,
) -> WindowBoundsResult {
    let (base_x, base_y) = if recentered {
        let cx = rc.left + ((rc.right - rc.left) - phys_grid_w).max(0) / 2;
        let cy = rc.top + ((rc.bottom - rc.top) - phys_grid_h).max(0) / 2;
        (cx, cy)
    } else {
        (raw_x, raw_y)
    };

    // If expanding the dock to the right would overflow this monitor's work area,
    // expand the dock to the left of the grid instead so the grid stays anchored.
    let dock_on_left = phys_dock_w > 0 && (base_x + phys_grid_w + phys_dock_w > rc.right);

    let desired_x = if dock_on_left {
        base_x - phys_dock_w
    } else {
        base_x
    };
    let desired_y = base_y;

    let max_x = (rc.right - phys_target_w).max(rc.left);
    let max_y = (rc.bottom - phys_target_h).max(rc.top);
    let final_x = desired_x.clamp(rc.left, max_x);
    let final_y = desired_y.clamp(rc.top, max_y);

    WindowBoundsResult {
        x: final_x,
        y: final_y,
        base_x,
        base_y,
        dock_on_left,
        dock_phys_w: if dock_on_left { phys_dock_w } else { 0 },
        scale,
        recentered,
    }
}

pub fn sync_window_bounds(
    hwnd_raw: isize,
    cur_pos: (i32, i32),
    scale: f64,
    anchor_x: Option<i32>,
    anchor_y: Option<i32>,
    grid_w: f64,
    grid_h: f64,
    dock_w: f64,
    target_w: f64,
    target_h: f64,
    apply: bool,
) -> Result<WindowBoundsResult, String> {
    let scale = if scale > 0.0 { scale } else { 1.0 };
    let phys_grid_w = (grid_w * scale).round() as i32;
    let phys_grid_h = (grid_h * scale).round() as i32;
    let phys_dock_w = (dock_w * scale).round() as i32;
    let phys_target_w = (target_w * scale).round() as i32;
    let phys_target_h = (target_h * scale).round() as i32;

    let raw_x = anchor_x.unwrap_or(cur_pos.0);
    let raw_y = anchor_y.unwrap_or(cur_pos.1);

    unsafe {
        let (rc, recentered) = get_monitor_work_area(raw_x, raw_y, phys_grid_w, phys_grid_h);
        let res = compute_window_bounds(
            rc,
            recentered,
            raw_x,
            raw_y,
            phys_grid_w,
            phys_grid_h,
            phys_dock_w,
            phys_target_w,
            phys_target_h,
            scale,
        );

        if apply {
            let hwnd = HWND(hwnd_raw as *mut _);
            if !hwnd.0.is_null() && IsWindow(hwnd).as_bool() {
                let _ = SetWindowPos(
                    hwnd,
                    None,
                    res.x,
                    res.y,
                    phys_target_w,
                    phys_target_h,
                    SWP_NOZORDER | SWP_NOACTIVATE,
                );
            }
        }

        Ok(res)
    }
}

pub fn start_desktop_monitor() {
    MONITOR_STARTED.call_once(|| {
        thread::spawn(|| loop {
            let enabled = DESKTOP_LAYER_ENABLED.load(Ordering::Relaxed);
            let hidden = USER_HIDDEN.load(Ordering::Relaxed);
            let hwnd = MAIN_HWND.load(Ordering::Relaxed);
            if enabled && !hidden && hwnd != 0 {
                let aot = DESKTOP_ALWAYS_ON_TOP.load(Ordering::Relaxed);
                tick_desktop_visibility(hwnd, aot);
                thread::sleep(Duration::from_millis(150));
            } else {
                thread::sleep(Duration::from_millis(400));
            }
        });
    });
}

unsafe fn ensure_progman_owner(hwnd: HWND) {
    let cur_owner = GetWindowLongPtrW(hwnd, GWLP_HWNDPARENT);
    if let Ok(progman) = FindWindowW(w!("Progman"), None) {
        if !progman.0.is_null() {
            let target = progman.0 as isize;
            if cur_owner != target {
                SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, target);
            }
            return;
        }
    }
    // If Explorer is restarting and the old Progman handle is gone, detach the dead owner.
    if cur_owner != 0 && !IsWindow(HWND(cur_owner as *mut _)).as_bool() {
        SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, 0);
    }
}

pub fn set_desktop_layer(hwnd_raw: isize, enabled: bool, always_on_top: bool) {
    MAIN_HWND.store(hwnd_raw, Ordering::SeqCst);
    DESKTOP_ALWAYS_ON_TOP.store(always_on_top, Ordering::SeqCst);
    DESKTOP_LAYER_ENABLED.store(enabled, Ordering::SeqCst);
    start_desktop_monitor();
    unsafe {
        let hwnd = HWND(hwnd_raw as *mut _);
        if hwnd.0.is_null() || !IsWindow(hwnd).as_bool() {
            return;
        }
        if enabled {
            ensure_progman_owner(hwnd);
        } else {
            SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, 0);
        }
    }
}

unsafe fn is_window_behind(target: HWND, other: HWND) -> bool {
    let mut cur = target;
    for _ in 0..256 {
        let Ok(prev) = GetWindow(cur, GW_HWNDPREV) else {
            break;
        };
        if prev.0.is_null() {
            break;
        }
        if prev == other {
            return true;
        }
        cur = prev;
    }
    false
}

unsafe fn is_desktop_host_class(hwnd: HWND) -> bool {
    const WORKER_W: [u16; 7] = [b'W' as u16, b'o' as u16, b'r' as u16, b'k' as u16, b'e' as u16, b'r' as u16, b'W' as u16];
    const PROGMAN: [u16; 7] = [b'P' as u16, b'r' as u16, b'o' as u16, b'g' as u16, b'm' as u16, b'a' as u16, b'n' as u16];
    let mut buf = [0u16; 64];
    let len = GetClassNameW(hwnd, &mut buf);
    if len <= 0 {
        return false;
    }
    let slice = &buf[..len as usize];
    slice == WORKER_W || slice == PROGMAN
}

static LAST_RAISE_FAIL_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn tick_desktop_visibility(hwnd_raw: isize, always_on_top: bool) {
    if !DESKTOP_LAYER_ENABLED.load(Ordering::SeqCst) || USER_HIDDEN.load(Ordering::SeqCst) {
        return;
    }
    unsafe {
        let hwnd = HWND(hwnd_raw as *mut _);
        if hwnd.0.is_null() || !IsWindow(hwnd).as_bool() {
            return;
        }

        // Re-attach if Progman was not ready at logon or Explorer restarted.
        ensure_progman_owner(hwnd);

        let mut need_raise = false;
        if IsIconic(hwnd).as_bool() || !IsWindowVisible(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            need_raise = true;
        }

        let fg = GetForegroundWindow();
        if !fg.0.is_null() && fg != hwnd && is_desktop_host_class(fg) && is_window_behind(hwnd, fg) {
            let now = now_ms();
            let last = LAST_RAISE_FAIL_MS.load(Ordering::Relaxed);
            if now.saturating_sub(last) >= 1000 {
                need_raise = true;
            }
        } else {
            LAST_RAISE_FAIL_MS.store(0, Ordering::Relaxed);
        }

        if need_raise {
            let _ = SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
            if !always_on_top {
                let _ = SetWindowPos(
                    hwnd,
                    HWND_NOTOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
            }
            if !fg.0.is_null() && fg != hwnd && is_desktop_host_class(fg) && is_window_behind(hwnd, fg) {
                LAST_RAISE_FAIL_MS.store(now_ms(), Ordering::Relaxed);
            } else {
                LAST_RAISE_FAIL_MS.store(0, Ordering::Relaxed);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn work_rect() -> RECT {
        RECT {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1040,
        }
    }

    #[test]
    fn dock_opens_to_left_when_anchored_on_right_corner() {
        let rc = work_rect();
        // 568px wide grid placed near right corner at x=1340 (right edge=1908 <= 1920)
        let res = compute_window_bounds(rc, false, 1340, 20, 568, 500, 256, 824, 500, 1.0);
        assert!(res.dock_on_left);
        assert_eq!(res.dock_phys_w, 256);
        assert_eq!(res.x, 1084);
        assert_eq!(res.y, 20);
        // Right edge stays anchored at 1908
        assert_eq!(res.x + 824, 1908);
    }

    #[test]
    fn dock_opens_to_right_when_anchored_on_left_corner() {
        let rc = work_rect();
        let res = compute_window_bounds(rc, false, 20, 20, 568, 500, 256, 824, 500, 1.0);
        assert!(!res.dock_on_left);
        assert_eq!(res.dock_phys_w, 0);
        assert_eq!(res.x, 20);
        assert_eq!(res.y, 20);
    }

    #[test]
    fn modal_pushes_left_and_up_from_bottom_right_corner() {
        let rc = work_rect();
        // Small 400x350 grid placed at bottom-right (1500, 680), opening 600x680 modal
        let res = compute_window_bounds(rc, false, 1500, 680, 400, 350, 0, 600, 680, 1.0);
        assert!(!res.dock_on_left);
        assert_eq!(res.x, 1320); // 1920 - 600
        assert_eq!(res.y, 360); // 1040 - 680
    }

    #[test]
    fn closing_dock_or_modal_restores_anchor_position() {
        let rc = work_rect();
        let res = compute_window_bounds(rc, false, 1500, 680, 400, 350, 0, 400, 350, 1.0);
        assert_eq!(res.x, 1500);
        assert_eq!(res.y, 680);
    }

    #[test]
    fn disconnected_monitor_recenters_on_primary_work_area() {
        let rc = work_rect();
        let res = compute_window_bounds(rc, true, 4000, 3000, 568, 500, 0, 568, 500, 1.0);
        assert!(res.recentered);
        assert_eq!(res.x, (1920 - 568) / 2);
        assert_eq!(res.y, (1040 - 500) / 2);
    }

    #[test]
    fn startup_approved_disabled_detects_odd_flag_bytes() {
        assert!(!is_startup_approved_bytes_disabled(&[]));
        assert!(!is_startup_approved_bytes_disabled(&[0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        assert!(!is_startup_approved_bytes_disabled(&[0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        assert!(is_startup_approved_bytes_disabled(&[0x03, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]));
        assert!(is_startup_approved_bytes_disabled(&[0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    }

    #[test]
    fn paths_match_windows_ignores_case_slashes_and_trailing_sep() {
        assert!(paths_match_windows(
            r"C:\Users\Me\AppData\Local\TouchDeck\touchdeck.exe",
            r"c:/users/me/appdata/local/touchdeck/TouchDeck.exe"
        ));
        assert!(paths_match_windows(
            r"C:\Program Files\TouchDeck\",
            r"C:\Program Files\TouchDeck"
        ));
        assert!(!paths_match_windows(
            r"C:\TouchDeck\touchdeck.exe",
            r"D:\TouchDeck\touchdeck.exe"
        ));
    }
}
