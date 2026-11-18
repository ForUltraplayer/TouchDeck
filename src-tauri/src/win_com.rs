use windows::Win32::System::Com::{
    CoInitializeEx, CoUninitialize, COINIT, COINIT_APARTMENTTHREADED, COINIT_MULTITHREADED,
};

/// RAII guard for Win32 COM initialization that uninitializes only when
/// `CoInitializeEx` succeeded (`S_OK` or `S_FALSE`), avoiding unbalanced refcount
/// decrements on `RPC_E_CHANGED_MODE`.
pub struct ComGuard(bool);

impl ComGuard {
    pub fn sta() -> Self {
        Self::with_mode(COINIT_APARTMENTTHREADED)
    }

    pub fn mta() -> Self {
        Self::with_mode(COINIT_MULTITHREADED)
    }

    fn with_mode(mode: COINIT) -> Self {
        let should_uninit = unsafe { CoInitializeEx(None, mode).is_ok() };
        Self(should_uninit)
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.0 {
            unsafe {
                CoUninitialize();
            }
        }
    }
}
