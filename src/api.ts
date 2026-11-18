import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type {
  AudioDeviceInfo,
  ButtonAction,
  DeckConfig,
  DiscordState,
  EnvInfo,
  NowPlayingInfo,
  ResolvedDrop,
  RunningStatus,
  SystemStats,
  UpdateInfo,
  VolumeState,
} from "./types";

export const api = {
  getConfig: () => invoke<DeckConfig>("get_config"),
  saveConfig: (config: DeckConfig) => invoke<void>("save_config_cmd", { config }),
  getEnvInfo: () => invoke<EnvInfo>("get_env_info"),
  inspectDrop: (path: string) => invoke<ResolvedDrop>("inspect_drop", { path }),
  fetchFavicon: (url: string) => invoke<string>("fetch_favicon", { url }),
  importImage: (path: string, prefix: string) =>
    invoke<string>("import_image", { path, prefix }),
  resolveAsset: (relPath: string) => invoke<string>("resolve_asset", { relPath }),
  extractIconForPath: (path: string, isFolder: boolean) =>
    invoke<string>("extract_icon_for_path", { path, isFolder }),
  executeAction: (action: ButtonAction) =>
    invoke<{ volume: VolumeState | null; message: string | null }>("execute_action", { action }),
  getDiscordState: () => invoke<DiscordState>("get_discord_state"),
  authorizeDiscord: (clientId: string, clientSecret: string) =>
    invoke<void>("authorize_discord", { clientId, clientSecret }),
  disconnectDiscord: () => invoke<void>("disconnect_discord"),
  getVolumeState: () => invoke<VolumeState>("get_volume_state"),
  listAudioDevices: () => invoke<AudioDeviceInfo[]>("list_audio_devices"),
  getNowPlaying: () => invoke<NowPlayingInfo | null>("get_now_playing"),
  getSystemStats: (includeTemp?: boolean) =>
    invoke<SystemStats>("get_system_stats", { includeTemp: includeTemp ?? false }),
  getRunningStatus: (procNames: string[]) =>
    invoke<RunningStatus>("get_running_status", { procNames }),
  setNoActivate: (enabled: boolean) => invoke<void>("set_no_activate", { enabled }),
  clampWindowPos: (x: number, y: number, w: number, h: number) =>
    invoke<[number, number]>("clamp_window_pos", { x, y, w, h }),
  syncWindowBounds: (
    anchorX: number | null,
    anchorY: number | null,
    gridW: number,
    gridH: number,
    dockW: number,
    targetW: number,
    targetH: number,
    apply = true
  ) =>
    invoke<{
      x: number;
      y: number;
      baseX: number;
      baseY: number;
      dockOnLeft: boolean;
      dockPhysW: number;
      scale: number;
      recentered: boolean;
    }>("sync_window_bounds", {
      anchorX,
      anchorY,
      gridW,
      gridH,
      dockW,
      targetW,
      targetH,
      apply,
    }),
  setDesktopLayer: (enabled: boolean, alwaysOnTop = false) =>
    invoke<void>("set_desktop_layer", { enabled, alwaysOnTop }),
  setUserHidden: (hidden: boolean) => invoke<void>("set_user_hidden", { hidden }),
  tickDesktopVisibility: (alwaysOnTop: boolean) =>
    invoke<void>("tick_desktop_visibility", { alwaysOnTop }),
  setAutostart: (enabled: boolean) => invoke<boolean>("set_autostart_cmd", { enabled }),
  openDataFolder: () => invoke<void>("open_data_folder"),
  enablePortableMode: () => invoke<string>("enable_portable_mode"),
  importLaunchersJson: (path: string) => invoke<number>("import_launchers_json", { path }),
  exportConfigFile: (path: string, config: DeckConfig) =>
    invoke<void>("export_config_file", { path, config }),
  importConfigFile: (path: string) => invoke<DeckConfig>("import_config_file", { path }),
  checkUpdate: () => invoke<UpdateInfo>("check_update"),
  applyUpdate: (downloadUrl: string) => invoke<void>("apply_update", { downloadUrl }),
};

export function assetUrl(absPath: string | undefined | null): string | null {
  if (!absPath) return null;
  return convertFileSrc(absPath);
}

export function hexToRgba(hex: string, opacityPercent: number): string {
  const clean = hex.replace("#", "").trim();
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean.padEnd(6, "0").slice(0, 6);
  const num = parseInt(full, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const a = Math.max(0, Math.min(1, opacityPercent / 100));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
