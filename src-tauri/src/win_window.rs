use std::path::PathBuf;
use windows::core::{Interface, HSTRING};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

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
