use crate::config::ButtonAction;
use crate::win_com::ComGuard;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};
use windows::core::{Interface, HSTRING, PCWSTR, VARIANT};
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT, TRUE};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_LOCAL_SERVER};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, SetActiveWindow, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY,
    KEYEVENTF_KEYUP, VK_MENU,
};
use windows::Win32::UI::Shell::{IShellWindows, IWebBrowser2, ShellExecuteW, ShellWindows};
use windows::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, BringWindowToTop, EnumWindows, FlashWindowEx, GetClassNameW,
    GetForegroundWindow, GetWindow, GetWindowLongW, GetWindowRect, GetWindowTextLengthW,
    GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible,
    SetForegroundWindow, SetWindowPos, ShowWindow, SwitchToThisWindow, ASFW_ANY, FLASHWINFO,
    FLASHW_STOP, GWL_EXSTYLE, GW_OWNER, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE,
    SWP_SHOWWINDOW, SW_HIDE, SW_MINIMIZE, SW_RESTORE, SW_SHOW, SW_SHOWNORMAL, WS_EX_TOOLWINDOW,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningStatus {
    pub running: Vec<String>,
    pub foreground_proc: String,
}

pub fn get_running_status(targets: &[String]) -> RunningStatus {
    let mut target_map: HashMap<String, Vec<&String>> = HashMap::with_capacity(targets.len());
    for t in targets {
        let trimmed = t.trim();
        if trimmed.is_empty() {
            continue;
        }
        let low = trimmed.to_ascii_lowercase();
        let stem = low.strip_suffix(".exe").unwrap_or(&low).to_string();
        if !stem.is_empty() {
            target_map.entry(stem).or_default().push(t);
        }
    }

    let mut fg_pid: u32 = 0;
    unsafe {
        let fg = GetForegroundWindow();
        if !fg.0.is_null() {
            GetWindowThreadProcessId(fg, Some(&mut fg_pid));
        }
    }

    let mut matched_stems: HashSet<String> = HashSet::with_capacity(target_map.len());
    let mut fg_proc = String::new();
    let mut name_buf = String::with_capacity(64);

    unsafe {
        if let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            let mut entry = PROCESSENTRY32W::default();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            if Process32FirstW(snap, &mut entry).is_ok() {
                loop {
                    let len = entry
                        .szExeFile
                        .iter()
                        .position(|&c| c == 0)
                        .unwrap_or(entry.szExeFile.len());
                    name_buf.clear();
                    for ch in std::char::decode_utf16(entry.szExeFile[..len].iter().copied()) {
                        let c = ch.unwrap_or(std::char::REPLACEMENT_CHARACTER);
                        for lc in c.to_lowercase() {
                            name_buf.push(lc);
                        }
                    }
                    let stem = name_buf.strip_suffix(".exe").unwrap_or(&name_buf);

                    if fg_pid != 0 && entry.th32ProcessID == fg_pid && fg_proc.is_empty() {
                        fg_proc.push_str(stem);
                    }
                    if target_map.contains_key(stem) && !matched_stems.contains(stem) {
                        matched_stems.insert(stem.to_string());
                    }

                    if Process32NextW(snap, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = windows::Win32::Foundation::CloseHandle(snap);
        }
    }

    let mut running = Vec::with_capacity(matched_stems.len());
    for t in targets {
        let trimmed = t.trim();
        if trimmed.is_empty() {
            continue;
        }
        let low = trimmed.to_ascii_lowercase();
        let stem = low.strip_suffix(".exe").unwrap_or(&low);
        if matched_stems.contains(stem) {
            running.push(t.clone());
        }
    }

    RunningStatus {
        running,
        foreground_proc: fg_proc,
    }
}

fn expand_env_vars(input: &str) -> String {
    let mut out = input.to_string();
    for (k, v) in std::env::vars() {
        let token = format!("%{}%", k);
        if out.to_ascii_lowercase().contains(&token.to_ascii_lowercase()) {
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

fn resolve_exe_with_fallback(raw_exe: &str) -> String {
    let exe = expand_env_vars(raw_exe);
    let p = Path::new(&exe);
    if exe.is_empty() || p.exists() {
        return exe;
    }

    if let (Some(app_dir), Some(file_name)) = (p.parent(), p.file_name()) {
        if let Some(parent_dir) = app_dir.parent() {
            if let Ok(entries) = std::fs::read_dir(parent_dir) {
                let mut candidates: Vec<(std::time::SystemTime, std::path::PathBuf)> = Vec::new();
                for entry in entries.flatten() {
                    let dir_name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                    if dir_name.starts_with("app-") {
                        let cand = entry.path().join(file_name);
                        if cand.exists() {
                            let mtime = entry
                                .metadata()
                                .and_then(|m| m.modified())
                                .unwrap_or(std::time::UNIX_EPOCH);
                            candidates.push((mtime, cand));
                        }
                    }
                }
                candidates.sort_by(|a, b| b.0.cmp(&a.0));
                if let Some((_, best)) = candidates.first() {
                    return best.to_string_lossy().to_string();
                }
            }
        }
    }

    exe
}

fn get_pids_by_name(proc_name: &str) -> HashSet<u32> {
    let mut pids = HashSet::new();
    if proc_name.is_empty() {
        return pids;
    }
    let target = if proc_name.to_ascii_lowercase().ends_with(".exe") {
        proc_name.to_ascii_lowercase()
    } else {
        format!("{}.exe", proc_name.to_ascii_lowercase())
    };

    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return pids;
        };
        let mut entry = PROCESSENTRY32W::default();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        if Process32FirstW(snap, &mut entry).is_ok() {
            loop {
                let len = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name = OsString::from_wide(&entry.szExeFile[..len])
                    .to_string_lossy()
                    .to_ascii_lowercase();
                if name == target {
                    pids.insert(entry.th32ProcessID);
                }
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = windows::Win32::Foundation::CloseHandle(snap);
    }
    pids
}

#[derive(Clone)]
struct WinInfo {
    hwnd: HWND,
    title: String,
    class_name: String,
    iconic: bool,
}

fn find_process_windows(proc_name: &str) -> Vec<WinInfo> {
    let pids = get_pids_by_name(proc_name);
    if pids.is_empty() {
        return Vec::new();
    }

    struct SearchState {
        pids: HashSet<u32>,
        wins: Vec<WinInfo>,
    }

    let mut state = SearchState {
        pids,
        wins: Vec::new(),
    };

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let state = &mut *(lparam.0 as *mut SearchState);
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if !state.pids.contains(&pid) {
            return TRUE;
        }
        if !IsWindowVisible(hwnd).as_bool() {
            return TRUE;
        }
        if let Ok(owner) = GetWindow(hwnd, GW_OWNER) {
            if !owner.0.is_null() {
                return TRUE;
            }
        }
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        if (ex_style & WS_EX_TOOLWINDOW.0) != 0 {
            return TRUE;
        }

        let iconic = IsIconic(hwnd).as_bool();
        let mut rc = RECT::default();
        let _ = GetWindowRect(hwnd, &mut rc);
        let w = rc.right - rc.left;
        let h = rc.bottom - rc.top;
        if !iconic && (w < 120 || h < 80) {
            return TRUE;
        }

        let mut cls_buf = [0u16; 128];
        let clen = GetClassNameW(hwnd, &mut cls_buf);
        let class_name = String::from_utf16_lossy(&cls_buf[..clen as usize]);

        let tlen = GetWindowTextLengthW(hwnd);
        let title = if tlen > 0 {
            let mut tbuf = vec![0u16; (tlen + 1) as usize];
            let got = GetWindowTextW(hwnd, &mut tbuf);
            String::from_utf16_lossy(&tbuf[..got as usize])
        } else {
            String::new()
        };

        if title.trim().is_empty() && !iconic && (w < 250 || h < 200) {
            return TRUE;
        }

        state.wins.push(WinInfo {
            hwnd,
            title,
            class_name,
            iconic,
        });
        TRUE
    }

    unsafe {
        let _ = EnumWindows(Some(enum_proc), LPARAM(&mut state as *mut _ as isize));
    }
    state.wins
}

fn pick_best_window(wins: &[WinInfo], class_hint: &str, title_hint: &str) -> Option<HWND> {
    if wins.is_empty() {
        return None;
    }
    if !title_hint.is_empty() {
        let needle = title_hint.to_ascii_lowercase();
        if let Some(w) = wins
            .iter()
            .find(|w| w.title.to_ascii_lowercase().contains(&needle))
        {
            return Some(w.hwnd);
        }
    }
    if !class_hint.is_empty() {
        if let Some(w) = wins
            .iter()
            .find(|w| w.class_name.eq_ignore_ascii_case(class_hint))
        {
            return Some(w.hwnd);
        }
    }
    if let Some(w) = wins.iter().find(|w| !w.title.trim().is_empty()) {
        return Some(w.hwnd);
    }
    Some(wins[0].hwnd)
}

fn send_alt_tap() {
    unsafe {
        let inputs = [
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_MENU,
                        wScan: 0x45,
                        dwFlags: KEYEVENTF_EXTENDEDKEY,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_MENU,
                        wScan: 0x45,
                        dwFlags: KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
        ];
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

pub fn force_foreground(hwnd: HWND) -> bool {
    unsafe {
        if hwnd.0.is_null() || !IsWindow(hwnd).as_bool() {
            return false;
        }

        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
            thread::sleep(Duration::from_millis(40));
        } else if !IsWindowVisible(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_SHOW);
        }

        let _ = AllowSetForegroundWindow(ASFW_ANY);
        let fg = GetForegroundWindow();
        let cur_thread = GetCurrentThreadId();
        let fg_thread = if !fg.0.is_null() {
            GetWindowThreadProcessId(fg, None)
        } else {
            0
        };
        let target_thread = GetWindowThreadProcessId(hwnd, None);

        let attached_fg =
            fg_thread != 0 && fg_thread != cur_thread && AttachThreadInput(cur_thread, fg_thread, true).as_bool();
        let attached_target = target_thread != 0
            && target_thread != cur_thread
            && target_thread != fg_thread
            && AttachThreadInput(cur_thread, target_thread, true).as_bool();

        let _ = BringWindowToTop(hwnd);
        let _ = ShowWindow(
            hwnd,
            if IsIconic(hwnd).as_bool() {
                SW_RESTORE
            } else {
                SW_SHOW
            },
        );
        let _ = SetForegroundWindow(hwnd);
        let _ = SetActiveWindow(hwnd);

        if attached_target {
            let _ = AttachThreadInput(cur_thread, target_thread, false);
        }
        if attached_fg {
            let _ = AttachThreadInput(cur_thread, fg_thread, false);
        }

        if GetForegroundWindow() != hwnd {
            SwitchToThisWindow(hwnd, true);
            thread::sleep(Duration::from_millis(25));
        }

        if GetForegroundWindow() != hwnd {
            send_alt_tap();
            let _ = AllowSetForegroundWindow(ASFW_ANY);
            let _ = SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            );
            let _ = SetWindowPos(
                hwnd,
                HWND_NOTOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            );
            let _ = BringWindowToTop(hwnd);
            let _ = SetForegroundWindow(hwnd);
        }

        let mut fi = FLASHWINFO {
            cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
            hwnd,
            dwFlags: FLASHW_STOP,
            uCount: 0,
            dwTimeout: 0,
        };
        let _ = FlashWindowEx(&mut fi);

        GetForegroundWindow() == hwnd
    }
}

fn shell_open(target: &str, args: &str, work_dir: &str) {
    unsafe {
        let _ = AllowSetForegroundWindow(ASFW_ANY);
        let show = if target.to_ascii_lowercase().ends_with(".cmd")
            || target.to_ascii_lowercase().ends_with(".bat")
        {
            SW_HIDE
        } else {
            SW_SHOWNORMAL
        };
        let op = HSTRING::from("open");
        let file = HSTRING::from(target);
        let params = if args.is_empty() {
            PCWSTR::null()
        } else {
            PCWSTR(HSTRING::from(args).as_ptr())
        };
        let wd_hstr;
        let dir = if !work_dir.is_empty() {
            wd_hstr = HSTRING::from(work_dir);
            PCWSTR(wd_hstr.as_ptr())
        } else if let Some(parent) = Path::new(target).parent() {
            if parent.exists() {
                wd_hstr = HSTRING::from(parent.to_string_lossy().as_ref());
                PCWSTR(wd_hstr.as_ptr())
            } else {
                PCWSTR::null()
            }
        } else {
            PCWSTR::null()
        };

        let _args_keep = HSTRING::from(args);
        let params_ptr = if args.is_empty() {
            PCWSTR::null()
        } else {
            PCWSTR(_args_keep.as_ptr())
        };
        let _ = params;

        ShellExecuteW(None, &op, &file, params_ptr, dir, show);
    }
}

fn wait_and_focus_process(proc_name: &str, class_hint: &str, title_hint: &str, timeout_ms: u64) {
    let start = Instant::now();
    while start.elapsed().as_millis() < timeout_ms as u128 {
        let wins = find_process_windows(proc_name);
        if let Some(hwnd) = pick_best_window(&wins, class_hint, title_hint) {
            thread::sleep(Duration::from_millis(80));
            force_foreground(hwnd);
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn normalize_folder(path: &str) -> String {
    let expanded = expand_env_vars(path);
    let trimmed = expanded.trim_end_matches(['\\', '/']);
    trimmed.to_ascii_lowercase()
}

fn find_explorer_for_folder(folder: &str) -> (Option<HWND>, HashSet<isize>) {
    let mut all_hwnds = HashSet::new();
    let target = normalize_folder(folder);
    let mut matched = None;

    let _com = ComGuard::sta();
    unsafe {
        if let Ok(shell_wins) =
            CoCreateInstance::<_, IShellWindows>(&ShellWindows, None, CLSCTX_LOCAL_SERVER)
        {
            let count = shell_wins.Count().unwrap_or(0);
            for i in 0..count {
                let var = VARIANT::from(i);
                if let Ok(disp) = shell_wins.Item(&var) {
                    if let Ok(wb) = disp.cast::<IWebBrowser2>() {
                        if let Ok(hwnd_val) = wb.HWND() {
                            let hwnd = HWND(hwnd_val.0 as *mut _);
                            all_hwnds.insert(hwnd.0 as isize);
                            if matched.is_none() {
                                if let Ok(bstr_url) = wb.LocationURL() {
                                    let url_str = bstr_url.to_string();
                                    if let Some(path_part) = url_str.strip_prefix("file:///") {
                                        let decoded = percent_decode(path_part).replace('/', "\\");
                                        if normalize_folder(&decoded) == target {
                                            matched = Some(hwnd);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    (matched, all_hwnds)
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn handle_chrome(exe: &str, args: &str, work_dir: &str) {
    let before_wins = find_process_windows("chrome");
    let before_set: HashSet<isize> = before_wins.iter().map(|w| w.hwnd.0 as isize).collect();
    let before_top = before_wins.first().map(|w| w.hwnd);

    unsafe {
        let fg = GetForegroundWindow();
        let cur = GetCurrentThreadId();
        let fg_t = if !fg.0.is_null() {
            GetWindowThreadProcessId(fg, None)
        } else {
            0
        };
        let attached = fg_t != 0 && fg_t != cur && AttachThreadInput(cur, fg_t, true).as_bool();
        let _ = AllowSetForegroundWindow(ASFW_ANY);
        shell_open(exe, args, work_dir);
        if attached {
            let _ = AttachThreadInput(cur, fg_t, false);
        }
    }

    let start = Instant::now();
    while start.elapsed().as_millis() < 1800 {
        thread::sleep(Duration::from_millis(60));
        let cur_fg = unsafe { GetForegroundWindow() };
        let now_wins = find_process_windows("chrome");

        for w in &now_wins {
            if !before_set.contains(&(w.hwnd.0 as isize)) {
                force_foreground(w.hwnd);
                return;
            }
        }
        for w in &now_wins {
            if w.hwnd == cur_fg {
                if w.iconic {
                    force_foreground(w.hwnd);
                }
                return;
            }
        }
        if let Some(first) = now_wins.first() {
            if Some(first.hwnd) != before_top {
                force_foreground(first.hwnd);
                return;
            }
        }
    }

    let final_wins = find_process_windows("chrome");
    if final_wins.len() == 1 || final_wins.first().map(|w| w.iconic).unwrap_or(false) {
        if let Some(first) = final_wins.first() {
            force_foreground(first.hwnd);
        }
    }
}

pub fn execute_launch_action(action: &ButtonAction) -> Result<(), String> {
    match action {
        ButtonAction::App {
            exe,
            args,
            work_dir,
            proc_name,
            class_hint,
            title_hint,
            toggle_minimize,
        } => {
            let resolved_exe = resolve_exe_with_fallback(exe);
            let resolved_wd = expand_env_vars(work_dir);
            let effective_proc = if proc_name.is_empty() {
                Path::new(&resolved_exe)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string()
            } else {
                proc_name.clone()
            };

            // Chrome multi-profile handling
            if effective_proc.eq_ignore_ascii_case("chrome")
                && args.to_ascii_lowercase().contains("--profile-directory")
            {
                let exe_clone = resolved_exe;
                let args_clone = args.clone();
                let wd_clone = resolved_wd;
                thread::spawn(move || handle_chrome(&exe_clone, &args_clone, &wd_clone));
                return Ok(());
            }

            let wins = find_process_windows(&effective_proc);
            if let Some(hwnd) = pick_best_window(&wins, class_hint, title_hint) {
                let do_toggle = *toggle_minimize;
                let hwnd_raw = hwnd.0 as isize;
                thread::spawn(move || unsafe {
                    let target = HWND(hwnd_raw as *mut _);
                    if do_toggle && GetForegroundWindow() == target && !IsIconic(target).as_bool() {
                        let _ = ShowWindow(target, SW_MINIMIZE);
                    } else {
                        force_foreground(target);
                    }
                });
                return Ok(());
            }

            let ch = class_hint.clone();
            let th = title_hint.clone();
            let args_clone = args.clone();
            thread::spawn(move || {
                shell_open(&resolved_exe, &args_clone, &resolved_wd);
                if !effective_proc.is_empty() {
                    wait_and_focus_process(&effective_proc, &ch, &th, 8000);
                }
            });
            Ok(())
        }
        ButtonAction::Folder { path } => {
            let folder = expand_env_vars(path);
            thread::spawn(move || {
                let (matched, before_hwnds) = find_explorer_for_folder(&folder);
                if let Some(hwnd) = matched {
                    force_foreground(hwnd);
                    return;
                }
                let quoted = format!("\"{}\"", folder);
                shell_open("explorer.exe", &quoted, "");

                let start = Instant::now();
                while start.elapsed().as_millis() < 4000 {
                    thread::sleep(Duration::from_millis(100));
                    let (found, now_hwnds) = find_explorer_for_folder(&folder);
                    if let Some(h) = found {
                        force_foreground(h);
                        return;
                    }
                    for h in now_hwnds {
                        if !before_hwnds.contains(&h) {
                            force_foreground(HWND(h as *mut _));
                            return;
                        }
                    }
                }
            });
            Ok(())
        }
        ButtonAction::Url { url } => {
            let u = url.clone();
            thread::spawn(move || {
                let fg_before = unsafe { GetForegroundWindow() };
                shell_open(&u, "", "");
                let start = Instant::now();
                while start.elapsed().as_millis() < 1500 {
                    thread::sleep(Duration::from_millis(70));
                    let cur_fg = unsafe { GetForegroundWindow() };
                    if !cur_fg.0.is_null() && cur_fg != fg_before {
                        if unsafe { IsIconic(cur_fg).as_bool() } {
                            force_foreground(cur_fg);
                        }
                        return;
                    }
                }
            });
            Ok(())
        }
        _ => Ok(()),
    }
}
