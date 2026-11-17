use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::Once;
use std::thread;
use std::time::Duration;
use windows::core::{w, Interface, HSTRING};
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTOPRIMARY, MONITOR_DEFAULTTONULL,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowW, GetClassNameW, GetForegroundWindow, GetWindow, GetWindowLongW, IsIconic,
    IsWindow, IsWindowVisible, SetWindowLongPtrW, SetWindowLongW, SetWindowPos, ShowWindow,
    GWLP_HWNDPARENT, GWL_EXSTYLE, GW_HWNDPREV, HWND_NOTOPMOST, HWND_TOPMOST, SWP_FRAMECHANGED,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW, SW_SHOWNOACTIVATE,
    WS_EX_NOACTIVATE,
};

static DESKTOP_LAYER_ENABLED: AtomicBool = AtomicBool::new(false);
static DESKTOP_ALWAYS_ON_TOP: AtomicBool = AtomicBool::new(false);
static USER_HIDDEN: AtomicBool = AtomicBool::new(false);
static MAIN_HWND: AtomicIsize = AtomicIsize::new(0);
static MONITOR_STARTED: Once = Once::new();

pub fn set_user_hidden(hidden: bool) {
    USER_HIDDEN.store(hidden, Ordering::SeqCst);
}

fn startup_shortcut_path() -> Result<PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|_| "APPDATA not found".to_string())?;
    Ok(PathBuf::from(appdata)
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs")
        .join("Startup")
        .join("TouchDeck.lnk"))
}

pub fn is_autostart_enabled() -> bool {
    startup_shortcut_path().map(|p| p.exists()).unwrap_or(false)
}

pub fn set_autostart(enabled: bool) -> Result<bool, String> {
    let lnk_path = startup_shortcut_path()?;
    if !enabled {
        if lnk_path.exists() {
            std::fs::remove_file(&lnk_path).map_err(|e| e.to_string())?;
        }
        return Ok(false);
    }

    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe_path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let res = (|| -> Result<(), String> {
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
            Ok(())
        })();
        CoUninitialize();
        res?;
    }
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

pub fn clamp_window_position(x: i32, y: i32, w: i32, h: i32) -> (i32, i32) {
    unsafe {
        let center = POINT {
            x: x + w / 2,
            y: y + h / 2,
        };
        let mon = MonitorFromPoint(center, MONITOR_DEFAULTTONULL);
        if !mon.is_invalid() {
            return (x, y);
        }
        let primary = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(primary, &mut info).as_bool() {
            let rc = info.rcWork;
            let cx = rc.left + ((rc.right - rc.left) - w).max(0) / 2;
            let cy = rc.top + ((rc.bottom - rc.top) - h).max(0) / 2;
            return (cx, cy);
        }
        (100, 100)
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
            if let Ok(progman) = FindWindowW(w!("Progman"), None) {
                if !progman.0.is_null() {
                    SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, progman.0 as isize);
                }
            }
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

pub fn tick_desktop_visibility(hwnd_raw: isize, always_on_top: bool) {
    if !DESKTOP_LAYER_ENABLED.load(Ordering::SeqCst) || USER_HIDDEN.load(Ordering::SeqCst) {
        return;
    }
    unsafe {
        let hwnd = HWND(hwnd_raw as *mut _);
        if hwnd.0.is_null() || !IsWindow(hwnd).as_bool() {
            return;
        }

        let mut need_raise = false;
        if IsIconic(hwnd).as_bool() || !IsWindowVisible(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            need_raise = true;
        }

        let fg = GetForegroundWindow();
        if !fg.0.is_null() && fg != hwnd && is_desktop_host_class(fg) && is_window_behind(hwnd, fg) {
            need_raise = true;
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
        }
    }
}
