export interface WindowConfig {
  x: number | null;
  y: number | null;
  alwaysOnTop: boolean;
  desktopLayer: boolean;
  locked: boolean;
}

export interface GridConfig {
  columns: number;
  rows: number;
  cellSize: number;
  gap: number;
  borderRadius: number;
}

export interface ThemeConfig {
  backgroundType: "solid" | "gradient" | "image";
  backgroundColor: string;
  backgroundOpacity: number;
  gradientEndColor: string;
  backgroundImage: string | null;
  backgroundBlur: number;
  backgroundDim: number;
  fontFamily: string;
  defaultButtonColor: string;
  defaultButtonOpacity: number;
  buttonStyle?: "solid" | "glass" | "transparent";
  autoFontSize?: boolean;
  iconRounded?: boolean;
}

export interface MultiStep {
  action: ButtonAction;
  delayMs: number;
}

export type ButtonAction =
  | {
      type: "app";
      exe: string;
      args?: string;
      workDir?: string;
      procName?: string;
      classHint?: string;
      titleHint?: string;
      toggleMinimize?: boolean;
    }
  | {
      type: "folder";
      path: string;
    }
  | {
      type: "url";
      url: string;
    }
  | {
      type: "media";
      command: "play_pause" | "next" | "prev" | "stop";
    }
  | {
      type: "volume";
      command: "up" | "down" | "mute";
      step: number;
      target?: "speaker" | "mic";
    }
  | {
      type: "audio_device";
      deviceId?: string | null;
    }
  | {
      type: "hotkey";
      keys: string[];
    }
  | {
      type: "page";
      pageIndex: number;
    }
  | {
      type: "multi";
      steps: MultiStep[];
    }
  | {
      type: "widget";
      kind: "clock" | "sys_stats" | "now_playing";
    };

export interface ButtonItem {
  id: string;
  label: string;
  showLabel: boolean;
  fontSize: number;
  textColor: string;
  bgColor: string | null;
  bgOpacity: number | null;
  iconPath: string | null;
  badge?: string | null;
  accentColor?: string | null;
  action: ButtonAction;
}

export interface DeckPage {
  id: string;
  name: string;
  slots: Record<string, ButtonItem>;
}

export interface DeckConfig {
  version: number;
  window: WindowConfig;
  grid: GridConfig;
  theme: ThemeConfig;
  pages: DeckPage[];
}

export interface EnvInfo {
  dataDir: string;
  isPortable: boolean;
  autostart: boolean;
}

export interface VolumeState {
  level: number;
  muted: boolean;
  micMuted: boolean;
}

export interface AudioDeviceInfo {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface NowPlayingInfo {
  title: string;
  artist: string;
  playing: boolean;
}

export interface SystemStats {
  cpuPercent: number;
  memPercent: number;
}

export interface RunningStatus {
  running: string[];
  foregroundProc: string;
}

export interface ResolvedDrop {
  kind: "app" | "folder" | "url" | "image";
  label: string;
  exe: string;
  args: string;
  workDir: string;
  procName: string;
  url: string;
  iconPath: string | null;
}
