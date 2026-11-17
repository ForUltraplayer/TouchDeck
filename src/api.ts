import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type { ButtonAction, DeckConfig, EnvInfo, ResolvedDrop, VolumeState } from "./types";

export const api = {
  getConfig: () => invoke<DeckConfig>("get_config"),
  saveConfig: (config: DeckConfig) => invoke<void>("save_config_cmd", { config }),
  getEnvInfo: () => invoke<EnvInfo>("get_env_info"),
  inspectDrop: (path: string) => invoke<ResolvedDrop>("inspect_drop", { path }),
  importImage: (path: string, prefix: string) =>
    invoke<string>("import_image", { path, prefix }),
  resolveAsset: (relPath: string) => invoke<string>("resolve_asset", { relPath }),
  extractIconForPath: (path: string, isFolder: boolean) =>
    invoke<string>("extract_icon_for_path", { path, isFolder }),
  executeAction: (action: ButtonAction) =>
    invoke<{ volume: VolumeState | null }>("execute_action", { action }),
  getVolumeState: () => invoke<VolumeState>("get_volume_state"),
  setAutostart: (enabled: boolean) => invoke<boolean>("set_autostart_cmd", { enabled }),
  openDataFolder: () => invoke<void>("open_data_folder"),
  enablePortableMode: () => invoke<string>("enable_portable_mode"),
  importLaunchersJson: (path: string) => invoke<number>("import_launchers_json", { path }),
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
