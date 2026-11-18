use serde::Serialize;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use windows::core::{w, BSTR, PCSTR, VARIANT};
use windows::Win32::Foundation::{FILETIME, HMODULE};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoSetProxyBlanket, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_MULTITHREADED, EOAC_NONE, RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE,
};
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCollectQueryData, PdhGetFormattedCounterArrayW,
    PdhGetFormattedCounterValue, PdhOpenQueryW, PDH_FMT_COUNTERVALUE,
    PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE,
};
use windows::Win32::System::Power::{CallNtPowerInformation, ProcessorInformation};
use windows::Win32::System::SystemInformation::{
    GetSystemInfo, GlobalMemoryStatusEx, MEMORYSTATUSEX, SYSTEM_INFO,
};
use windows::Win32::System::Threading::GetSystemTimes;
use windows::Win32::System::Wmi::{
    IWbemLocator, WbemLocator, WBEM_FLAG_FORWARD_ONLY, WBEM_FLAG_RETURN_IMMEDIATELY,
};

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub cpu_percent: u8,
    pub mem_percent: u8,
    pub cpu_clock_mhz: Option<u32>,
    pub cpu_temp_c: Option<i32>,
    pub gpu_percent: Option<u8>,
    pub gpu_temp_c: Option<i32>,
    pub gpu_clock_mhz: Option<u32>,
    pub vram_percent: Option<u8>,
    pub gpu_name: Option<String>,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct ProcessorPowerInfo {
    number: u32,
    max_mhz: u32,
    current_mhz: u32,
    mhz_limit: u32,
    max_idle_state: u32,
    current_idle_state: u32,
}

#[repr(C)]
struct NvmlUtilization {
    gpu: u32,
    memory: u32,
}

#[repr(C)]
struct NvmlMemory {
    total: u64,
    free: u64,
    used: u64,
}

struct NvmlApi {
    _lib: HMODULE,
    device: *mut c_void,
    name: Option<String>,
    get_util: unsafe extern "C" fn(*mut c_void, *mut NvmlUtilization) -> i32,
    get_temp: unsafe extern "C" fn(*mut c_void, u32, *mut u32) -> i32,
    get_clock: unsafe extern "C" fn(*mut c_void, u32, *mut u32) -> i32,
    get_mem: unsafe extern "C" fn(*mut c_void, *mut NvmlMemory) -> i32,
}
unsafe impl Send for NvmlApi {}

static NVML_STATE: Mutex<Option<Option<NvmlApi>>> = Mutex::new(None);

unsafe fn load_nvml() -> Option<NvmlApi> {
    let lib = LoadLibraryW(w!("nvml.dll")).ok()?;
    let init: unsafe extern "C" fn() -> i32 =
        std::mem::transmute(GetProcAddress(lib, PCSTR(b"nvmlInit_v2\0".as_ptr()))?);
    if init() != 0 {
        return None;
    }
    let get_count: unsafe extern "C" fn(*mut u32) -> i32 =
        std::mem::transmute(GetProcAddress(lib, PCSTR(b"nvmlDeviceGetCount_v2\0".as_ptr()))?);
    let mut count = 0u32;
    if get_count(&mut count) != 0 || count == 0 {
        return None;
    }
    let get_handle: unsafe extern "C" fn(u32, *mut *mut c_void) -> i32 = std::mem::transmute(
        GetProcAddress(lib, PCSTR(b"nvmlDeviceGetHandleByIndex_v2\0".as_ptr()))?,
    );
    let mut device: *mut c_void = std::ptr::null_mut();
    if get_handle(0, &mut device) != 0 || device.is_null() {
        return None;
    }

    let name = GetProcAddress(lib, PCSTR(b"nvmlDeviceGetName\0".as_ptr())).and_then(|p| {
        let f: unsafe extern "C" fn(*mut c_void, *mut u8, u32) -> i32 = std::mem::transmute(p);
        let mut buf = [0u8; 96];
        if f(device, buf.as_mut_ptr(), 96) == 0 {
            let len = buf.iter().position(|&b| b == 0).unwrap_or(96);
            Some(String::from_utf8_lossy(&buf[..len]).to_string())
        } else {
            None
        }
    });

    let get_util = std::mem::transmute(GetProcAddress(
        lib,
        PCSTR(b"nvmlDeviceGetUtilizationRates\0".as_ptr()),
    )?);
    let get_temp = std::mem::transmute(GetProcAddress(
        lib,
        PCSTR(b"nvmlDeviceGetTemperature\0".as_ptr()),
    )?);
    let get_clock = std::mem::transmute(GetProcAddress(
        lib,
        PCSTR(b"nvmlDeviceGetClockInfo\0".as_ptr()),
    )?);
    let get_mem = std::mem::transmute(GetProcAddress(
        lib,
        PCSTR(b"nvmlDeviceGetMemoryInfo\0".as_ptr()),
    )?);

    Some(NvmlApi {
        _lib: lib,
        device,
        name,
        get_util,
        get_temp,
        get_clock,
        get_mem,
    })
}

fn read_nvml_stats(out: &mut SystemStats) -> bool {
    let Ok(mut guard) = NVML_STATE.lock() else {
        return false;
    };
    if guard.is_none() {
        *guard = Some(unsafe { load_nvml() });
    }
    let Some(Some(api)) = guard.as_ref() else {
        return false;
    };

    unsafe {
        out.gpu_name = api.name.clone();
        let mut util = NvmlUtilization { gpu: 0, memory: 0 };
        if (api.get_util)(api.device, &mut util) == 0 {
            out.gpu_percent = Some(util.gpu.min(100) as u8);
        }
        let mut temp = 0u32;
        if (api.get_temp)(api.device, 0, &mut temp) == 0 {
            out.gpu_temp_c = Some(temp as i32);
        }
        let mut clk = 0u32;
        if (api.get_clock)(api.device, 0, &mut clk) == 0 {
            out.gpu_clock_mhz = Some(clk);
        }
        let mut mem = NvmlMemory {
            total: 0,
            free: 0,
            used: 0,
        };
        if (api.get_mem)(api.device, &mut mem) == 0 && mem.total > 0 {
            let pct = ((mem.used as f64 / mem.total as f64) * 100.0).round() as u8;
            out.vram_percent = Some(pct.min(100));
        }
    }
    true
}

struct CpuPdhState {
    query: isize,
    cpu_perf_counter: isize,
    base_mhz: u32,
}

struct GpuPdhState {
    query: isize,
    gpu_3d_counter: isize,
}

static CPU_PDH_STATE: Mutex<Option<CpuPdhState>> = Mutex::new(None);
static GPU_PDH_STATE: Mutex<Option<GpuPdhState>> = Mutex::new(None);

fn get_base_cpu_mhz() -> u32 {
    unsafe {
        let mut sys = SYSTEM_INFO::default();
        GetSystemInfo(&mut sys);
        let num = sys.dwNumberOfProcessors.max(1) as usize;
        let mut buf = vec![ProcessorPowerInfo::default(); num];
        let byte_len = (num * std::mem::size_of::<ProcessorPowerInfo>()) as u32;
        let status = CallNtPowerInformation(
            ProcessorInformation,
            None,
            0,
            Some(buf.as_mut_ptr() as *mut _),
            byte_len,
        );
        if status.0 == 0 && !buf.is_empty() {
            return buf[0].max_mhz;
        }
    }
    0
}

fn read_pdh_stats(out: &mut SystemStats, need_gpu_fallback: bool) {
    unsafe {
        if let Ok(mut guard) = CPU_PDH_STATE.lock() {
            if guard.is_none() {
                let mut query: isize = 0;
                if PdhOpenQueryW(None, 0, &mut query) == 0 {
                    let mut cpu_c: isize = 0;
                    let _ = PdhAddEnglishCounterW(
                        query,
                        w!("\\Processor Information(_Total)\\% Processor Performance"),
                        0,
                        &mut cpu_c,
                    );
                    let _ = PdhCollectQueryData(query);
                    *guard = Some(CpuPdhState {
                        query,
                        cpu_perf_counter: cpu_c,
                        base_mhz: get_base_cpu_mhz(),
                    });
                }
            }

            if let Some(st) = guard.as_ref() {
                if PdhCollectQueryData(st.query) == 0
                    && st.cpu_perf_counter != 0
                    && st.base_mhz > 0
                {
                    let mut val = PDH_FMT_COUNTERVALUE::default();
                    if PdhGetFormattedCounterValue(
                        st.cpu_perf_counter,
                        PDH_FMT_DOUBLE,
                        None,
                        &mut val,
                    ) == 0
                    {
                        let pct = val.Anonymous.doubleValue;
                        if pct > 0.0 && pct < 500.0 {
                            out.cpu_clock_mhz =
                                Some(((st.base_mhz as f64) * pct / 100.0).round() as u32);
                        }
                    }
                }
            }
        }

        if need_gpu_fallback {
            if let Ok(mut guard) = GPU_PDH_STATE.lock() {
                if guard.is_none() {
                    let mut query: isize = 0;
                    if PdhOpenQueryW(None, 0, &mut query) == 0 {
                        let mut gpu_c: isize = 0;
                        let _ = PdhAddEnglishCounterW(
                            query,
                            w!("\\GPU Engine(*engtype_3D)\\Utilization Percentage"),
                            0,
                            &mut gpu_c,
                        );
                        let _ = PdhCollectQueryData(query);
                        *guard = Some(GpuPdhState {
                            query,
                            gpu_3d_counter: gpu_c,
                        });
                    }
                }

                if let Some(st) = guard.as_ref() {
                    if PdhCollectQueryData(st.query) == 0 && st.gpu_3d_counter != 0 {
                        let mut buf_size = 0u32;
                        let mut item_count = 0u32;
                        let _ = PdhGetFormattedCounterArrayW(
                            st.gpu_3d_counter,
                            PDH_FMT_DOUBLE,
                            &mut buf_size,
                            &mut item_count,
                            None,
                        );
                        if buf_size > 0 && item_count > 0 {
                            let words = (buf_size as usize + 7) / 8;
                            let mut raw = vec![0u64; words];
                            let ptr = raw.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
                            if PdhGetFormattedCounterArrayW(
                                st.gpu_3d_counter,
                                PDH_FMT_DOUBLE,
                                &mut buf_size,
                                &mut item_count,
                                Some(ptr),
                            ) == 0
                            {
                                let slice = std::slice::from_raw_parts(ptr, item_count as usize);
                                let sum: f64 = slice
                                    .iter()
                                    .map(|item| item.FmtValue.Anonymous.doubleValue)
                                    .sum();
                                out.gpu_percent = Some(sum.round().clamp(0.0, 100.0) as u8);
                            }
                        }
                    }
                }
            }
        }
    }
}

struct TempCache {
    last_checked: Instant,
    temp: Option<i32>,
}

static TEMP_CACHE: Mutex<Option<TempCache>> = Mutex::new(None);
static TEMP_REFRESHING: AtomicBool = AtomicBool::new(false);

fn query_wmi_cpu_temp() -> Option<i32> {
    unsafe {
        let should_uninit = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
        let res = (|| -> Option<i32> {
            let locator: IWbemLocator =
                CoCreateInstance(&WbemLocator, None, CLSCTX_INPROC_SERVER).ok()?;

            // 1. Try LibreHardwareMonitor / OpenHardwareMonitor WMI providers
            for ns in [r"root\LibreHardwareMonitor", r"root\OpenHardwareMonitor"] {
                if let Ok(svc) =
                    locator.ConnectServer(&BSTR::from(ns), &BSTR::new(), &BSTR::new(), &BSTR::new(), 0, &BSTR::new(), None)
                {
                    let _ = CoSetProxyBlanket(
                        &svc,
                        10, // RPC_C_AUTHN_WINNT
                        0,
                        None,
                        RPC_C_AUTHN_LEVEL_CALL,
                        RPC_C_IMP_LEVEL_IMPERSONATE,
                        None,
                        EOAC_NONE,
                    );
                    if let Ok(enm) = svc.ExecQuery(
                        &BSTR::from("WQL"),
                        &BSTR::from("SELECT Name, Value FROM Sensor WHERE SensorType='Temperature'"),
                        WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY,
                        None,
                    ) {
                        let mut fallback: Option<i32> = None;
                        loop {
                            let mut objs = [None];
                            let mut ret = 0u32;
                            if enm.Next(2000, &mut objs, &mut ret).is_err() || ret == 0 {
                                break;
                            }
                            if let Some(obj) = &objs[0] {
                                let mut v_name = VARIANT::default();
                                let mut v_val = VARIANT::default();
                                if obj.Get(w!("Name"), 0, &mut v_name, None, None).is_ok()
                                    && obj.Get(w!("Value"), 0, &mut v_val, None, None).is_ok()
                                {
                                    let name = v_name.to_string().to_ascii_lowercase();
                                    let val_str = v_val.to_string();
                                    if let Ok(temp_f) = val_str.parse::<f64>() {
                                        let t = temp_f.round() as i32;
                                        if t > 0 && t < 130 {
                                            if name.contains("cpu package")
                                                || name.contains("tctl")
                                                || name.contains("core average")
                                            {
                                                return Some(t);
                                            }
                                            if name.contains("cpu") && fallback.is_none() {
                                                fallback = Some(t);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        if fallback.is_some() {
                            return fallback;
                        }
                    }
                }
            }

            // 2. Fallback: standard ACPI thermal zone (supported on laptops/some boards)
            if let Ok(svc) = locator.ConnectServer(
                &BSTR::from(r"root\wmi"),
                &BSTR::new(),
                &BSTR::new(),
                &BSTR::new(),
                0,
                &BSTR::new(),
                None,
            ) {
                let _ = CoSetProxyBlanket(
                    &svc,
                    10,
                    0,
                    None,
                    RPC_C_AUTHN_LEVEL_CALL,
                    RPC_C_IMP_LEVEL_IMPERSONATE,
                    None,
                    EOAC_NONE,
                );
                if let Ok(enm) = svc.ExecQuery(
                    &BSTR::from("WQL"),
                    &BSTR::from("SELECT CurrentTemperature FROM MSAcpi_ThermalZoneTemperature"),
                    WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY,
                    None,
                ) {
                    let mut objs = [None];
                    let mut ret = 0u32;
                    if enm.Next(2000, &mut objs, &mut ret).is_ok() && ret > 0 {
                        if let Some(obj) = &objs[0] {
                            let mut v_val = VARIANT::default();
                            if obj
                                .Get(w!("CurrentTemperature"), 0, &mut v_val, None, None)
                                .is_ok()
                            {
                                if let Ok(k10) = v_val.to_string().parse::<f64>() {
                                    let c = ((k10 - 2732.0) / 10.0).round() as i32;
                                    if c > 0 && c < 130 {
                                        return Some(c);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            None
        })();
        if should_uninit {
            CoUninitialize();
        }
        res
    }
}

fn read_cached_cpu_temp() -> Option<i32> {
    let (should_refresh, cached_temp) = {
        let Ok(guard) = TEMP_CACHE.lock() else {
            return None;
        };
        let refresh = match guard.as_ref() {
            Some(c) => {
                let ttl = if c.temp.is_some() {
                    Duration::from_secs(4)
                } else {
                    Duration::from_secs(20)
                };
                c.last_checked.elapsed() >= ttl
            }
            None => true,
        };
        (refresh, guard.as_ref().and_then(|c| c.temp))
    };

    if !should_refresh {
        return cached_temp;
    }

    if TEMP_REFRESHING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return cached_temp;
    }

    let t = query_wmi_cpu_temp();
    if let Ok(mut guard) = TEMP_CACHE.lock() {
        *guard = Some(TempCache {
            last_checked: Instant::now(),
            temp: t,
        });
    }
    TEMP_REFRESHING.store(false, Ordering::SeqCst);
    t
}

static PREV_CPU: Mutex<Option<(u64, u64, u64)>> = Mutex::new(None);

fn ft_to_u64(ft: FILETIME) -> u64 {
    ((ft.dwHighDateTime as u64) << 32) | (ft.dwLowDateTime as u64)
}

pub fn get_system_stats(include_temp: bool) -> SystemStats {
    let mut out = SystemStats::default();

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
                        out.cpu_percent = ((busy as f64 / total as f64) * 100.0)
                            .round()
                            .clamp(0.0, 100.0) as u8;
                    }
                }
                *guard = Some((i, k, u));
            }
        }

        let mut ms = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            ..Default::default()
        };
        if GlobalMemoryStatusEx(&mut ms).is_ok() {
            out.mem_percent = ms.dwMemoryLoad.min(100) as u8;
        }
    }

    let nvml_ok = read_nvml_stats(&mut out);
    read_pdh_stats(&mut out, !nvml_ok);

    if include_temp {
        out.cpu_temp_c = read_cached_cpu_temp();
    }

    out
}
