import React from "react";
import {
  AppWindow,
  ArrowRightCircle,
  Clock,
  Cpu,
  Folder,
  Globe,
  HeadphoneOff,
  Headphones,
  Keyboard,
  Layers,
  Mic,
  MicOff,
  Music,
  Pause,
  PhoneOff,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Square,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { assetUrl, hexToRgba } from "../api";
import type {
  ButtonItem,
  DiscordState,
  NowPlayingInfo,
  SystemStats,
  ThemeConfig,
  VolumeState,
} from "../types";

interface Props {
  slotIndex: number;
  item?: ButtonItem;
  resolvedIconAbsPath?: string;
  theme: ThemeConfig;
  cellSize: number;
  borderRadius: number;
  editMode: boolean;
  locked: boolean;
  isDropHover: boolean;
  isDraggingSource: boolean;
  isRunning: boolean;
  isForeground: boolean;
  volumeState: VolumeState | null;
  discordState: DiscordState | null;
  nowPlaying: NowPlayingInfo | null;
  systemStats: SystemStats | null;
  clockText: { time: string; date: string };
  onExecute: (item: ButtonItem) => void;
  onEdit: (slotIndex: number) => void;
  onContextMenu: (slotIndex: number, e: React.MouseEvent) => void;
  onStartSlotDrag: (slotIndex: number, e: React.PointerEvent) => void;
}

function renderFallbackIcon(
  item: ButtonItem,
  volumeState: VolumeState | null,
  discordState: DiscordState | null,
  nowPlaying: NowPlayingInfo | null,
  size: number
) {
  const act = item.action;
  switch (act.type) {
    case "folder":
      return <Folder size={size} strokeWidth={1.8} color="#F7C948" />;
    case "url":
      return <Globe size={size} strokeWidth={1.8} color="#60A5FA" />;
    case "volume":
      if (act.target === "mic") {
        return volumeState?.micMuted ? (
          <MicOff size={size} strokeWidth={2} color="#F87171" />
        ) : (
          <Mic size={size} strokeWidth={1.8} color="#38BDF8" />
        );
      }
      if (act.command === "mute") {
        return volumeState?.muted ? (
          <VolumeX size={size} strokeWidth={2} color="#F87171" />
        ) : (
          <Volume2 size={size} strokeWidth={1.8} color="#34D399" />
        );
      }
      if (act.command === "down") {
        return <Volume1 size={size} strokeWidth={1.8} color="#A7F3D0" />;
      }
      return <Volume2 size={size} strokeWidth={1.8} color="#34D399" />;
    case "audio_device":
      return <Headphones size={size} strokeWidth={1.8} color="#38BDF8" />;
    case "discord":
      if (act.command === "mute") {
        return discordState?.muted ? (
          <MicOff size={size} strokeWidth={2} color="#F87171" />
        ) : (
          <Mic size={size} strokeWidth={1.8} color={discordState?.authenticated ? "#818CF8" : "#64748B"} />
        );
      }
      if (act.command === "deaf") {
        return discordState?.deaf ? (
          <HeadphoneOff size={size} strokeWidth={2} color="#F87171" />
        ) : (
          <Headphones size={size} strokeWidth={1.8} color={discordState?.authenticated ? "#818CF8" : "#64748B"} />
        );
      }
      return <PhoneOff size={size} strokeWidth={1.8} color={discordState?.inVoice ? "#F87171" : "#64748B"} />;
    case "media":
      if (act.command === "next") return <SkipForward size={size} strokeWidth={1.8} color="#E2E8F0" />;
      if (act.command === "prev") return <SkipBack size={size} strokeWidth={1.8} color="#E2E8F0" />;
      if (act.command === "stop") return <Square size={size} strokeWidth={1.8} color="#F87171" />;
      if (nowPlaying?.playing) {
        return <Pause size={size * 0.85} strokeWidth={2} color="#34D399" />;
      }
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
          <Play size={size * 0.72} strokeWidth={2} color="#A78BFA" />
          <Pause size={size * 0.65} strokeWidth={2} color="#A78BFA" />
        </span>
      );
    case "hotkey":
      return <Keyboard size={size} strokeWidth={1.8} color="#FBBF24" />;
    case "page":
      return <ArrowRightCircle size={size} strokeWidth={1.8} color="#38BDF8" />;
    case "multi":
      return <Layers size={size} strokeWidth={1.8} color="#F472B6" />;
    case "widget":
      if (act.kind === "clock") return <Clock size={size * 0.8} strokeWidth={1.8} color="#38BDF8" />;
      if (act.kind === "sys_stats") return <Cpu size={size * 0.8} strokeWidth={1.8} color="#34D399" />;
      return <Music size={size * 0.8} strokeWidth={1.8} color="#A78BFA" />;
    default:
      return <AppWindow size={size} strokeWidth={1.8} color="#CBD5E1" />;
  }
}

export const ButtonTile: React.FC<Props> = React.memo(({
  slotIndex,
  item,
  resolvedIconAbsPath,
  theme,
  cellSize,
  borderRadius,
  editMode,
  locked,
  isDropHover,
  isDraggingSource,
  isRunning,
  isForeground,
  volumeState,
  discordState,
  nowPlaying,
  systemStats,
  clockText,
  onExecute,
  onEdit,
  onContextMenu,
  onStartSlotDrag,
}) => {
  const iconSrc = assetUrl(resolvedIconAbsPath);
  const iconBoxSize = Math.round(cellSize * 0.48);

  if (!item) {
    return (
      <button
        type="button"
        data-slot-index={slotIndex}
        className={`tile tile-empty ${editMode ? "tile-empty-edit" : ""} ${
          isDropHover ? "tile-drop-hover" : ""
        }`}
        style={{
          width: cellSize,
          height: cellSize,
          borderRadius,
          touchAction: editMode ? "none" : "pan-y",
        }}
        onClick={() => {
          if (editMode || !locked) onEdit(slotIndex);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onEdit(slotIndex);
        }}
        title="파일/바로가기를 끌어다 놓거나 눌러서 추가"
      >
        <Plus size={20} className="empty-plus" />
      </button>
    );
  }

  const buttonStyle = theme.buttonStyle ?? "solid";
  const hasCustomBg = item.bgColor !== null || item.bgOpacity !== null;
  const tileStyle: React.CSSProperties = {
    width: cellSize,
    height: cellSize,
    borderRadius,
    touchAction: editMode ? "none" : "pan-y",
  };
  if (hasCustomBg || buttonStyle === "solid") {
    tileStyle.backgroundColor = hexToRgba(
      item.bgColor || theme.defaultButtonColor,
      item.bgOpacity ?? theme.defaultButtonOpacity
    );
  }

  const effectiveFontSize =
    theme.autoFontSize !== false
      ? Math.max(10, Math.min(18, Math.round(cellSize * 0.105)))
      : item.fontSize || 13;

  const isWidget = item.action.type === "widget";

  return (
    <button
      type="button"
      data-slot-index={slotIndex}
      className={`tile tile-filled tile-style-${hasCustomBg ? "solid" : buttonStyle} ${
        editMode ? "tile-edit-wiggle" : ""
      } ${isDropHover ? "tile-drop-hover" : ""} ${isDraggingSource ? "tile-dragging-src" : ""}`}
      style={tileStyle}
      onPointerDown={(e) => {
        if (editMode && e.button === 0) {
          onStartSlotDrag(slotIndex, e);
        }
      }}
      onClick={() => {
        if (!editMode) {
          onExecute(item);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(slotIndex, e);
      }}
      title={
        item.action.type === "media" && nowPlaying
          ? `${item.label} — ${nowPlaying.title}${nowPlaying.artist ? ` (${nowPlaying.artist})` : ""}`
          : item.label
      }
    >
      {item.accentColor && (
        <span
          className="tile-accent-bar"
          style={{ backgroundColor: item.accentColor }}
        />
      )}

      {item.action.type === "app" && isRunning && (
        <span
          className={`running-dot ${isForeground ? "running-dot-fg" : ""}`}
          title={isForeground ? "현재 활성 창" : "실행 중"}
        />
      )}

      {item.badge && <span className="corner-badge">{item.badge}</span>}

      {item.action.type === "volume" && volumeState && (
        item.action.target === "mic" ? (
          <span className={`vol-badge ${volumeState.micMuted ? "vol-muted" : ""}`}>
            {volumeState.micMuted ? "MIC OFF" : "MIC ON"}
          </span>
        ) : (
          <span className={`vol-badge ${volumeState.muted ? "vol-muted" : ""}`}>
            {volumeState.muted ? "MUTE" : `${volumeState.level}%`}
          </span>
        )
      )}

      {item.action.type === "discord" && (
        !discordState?.authenticated ? (
          <span className="vol-badge dc-offline">미연결</span>
        ) : item.action.command === "mute" ? (
          <span className={`vol-badge ${discordState.muted ? "vol-muted" : "dc-on"}`}>
            {discordState.muted ? "DC MUTE" : "DC ON"}
          </span>
        ) : item.action.command === "deaf" ? (
          <span className={`vol-badge ${discordState.deaf ? "vol-muted" : "dc-on"}`}>
            {discordState.deaf ? "DEAF" : "HEAR"}
          </span>
        ) : discordState.inVoice ? (
          <span className="vol-badge dc-on">VOICE</span>
        ) : null
      )}

      {isWidget && item.action.type === "widget" ? (
        <div className="widget-box">
          {item.action.kind === "clock" && (
            <>
              <div className="widget-main" style={{ fontSize: Math.round(cellSize * 0.2) }}>
                {clockText.time}
              </div>
              <div className="widget-sub">{clockText.date}</div>
            </>
          )}
          {item.action.kind === "sys_stats" && (() => {
            const metrics =
              item.action.metrics && item.action.metrics.length > 0
                ? item.action.metrics
                : ["cpu_pct", "ram_pct"];
            const tempColor = (t: number | null | undefined) =>
              t === null || t === undefined
                ? "#94A3B8"
                : t >= 80
                ? "#F87171"
                : t >= 65
                ? "#FBBF24"
                : "#38BDF8";

            const rows = metrics.slice(0, 4).map((m) => {
              switch (m) {
                case "cpu_pct":
                  return { k: "CPU", v: systemStats ? `${systemStats.cpuPercent}%` : "--", c: "#34D399" };
                case "cpu_clk":
                  return {
                    k: "C.CLK",
                    v:
                      systemStats?.cpuClockMhz != null
                        ? `${(systemStats.cpuClockMhz / 1000).toFixed(2)}G`
                        : "--",
                    c: "#60A5FA",
                  };
                case "cpu_temp":
                  return {
                    k: "C.TMP",
                    v: systemStats?.cpuTempC != null ? `${systemStats.cpuTempC}°C` : "--",
                    c: tempColor(systemStats?.cpuTempC),
                  };
                case "ram_pct":
                  return { k: "RAM", v: systemStats ? `${systemStats.memPercent}%` : "--", c: "#34D399" };
                case "gpu_pct":
                  return {
                    k: "GPU",
                    v: systemStats?.gpuPercent != null ? `${systemStats.gpuPercent}%` : "--",
                    c: "#A78BFA",
                  };
                case "gpu_temp":
                  return {
                    k: "G.TMP",
                    v: systemStats?.gpuTempC != null ? `${systemStats.gpuTempC}°C` : "--",
                    c: tempColor(systemStats?.gpuTempC),
                  };
                case "gpu_clk":
                  return {
                    k: "G.CLK",
                    v: systemStats?.gpuClockMhz != null ? `${systemStats.gpuClockMhz}M` : "--",
                    c: "#F472B6",
                  };
                case "vram_pct":
                  return {
                    k: "VRAM",
                    v: systemStats?.vramPercent != null ? `${systemStats.vramPercent}%` : "--",
                    c: "#A78BFA",
                  };
                default:
                  return { k: m, v: "--", c: "#94A3B8" };
              }
            });

            const dense = rows.length >= 3;
            return (
              <div className={`widget-stats-list ${dense ? "widget-stats-dense" : ""}`}>
                {rows.map((r, i) => (
                  <div key={i} className="widget-stat-row">
                    <span className="widget-k">{r.k}</span>
                    <span className="widget-v" style={{ color: r.c }}>
                      {r.v}
                    </span>
                  </div>
                ))}
              </div>
            );
          })()}
          {item.action.kind === "now_playing" && (
            <>
              <Music size={Math.round(cellSize * 0.22)} color={nowPlaying?.playing ? "#34D399" : "#94A3B8"} />
              <div className="widget-track">
                {nowPlaying ? nowPlaying.title : "재생 중인 곡 없음"}
              </div>
              {nowPlaying?.artist && <div className="widget-sub">{nowPlaying.artist}</div>}
            </>
          )}
        </div>
      ) : (
        <>
          <div className="tile-icon-wrap" style={{ height: iconBoxSize }}>
            {iconSrc ? (
              <img
                src={iconSrc}
                alt={item.label}
                className="tile-icon-img"
                style={{
                  width: iconBoxSize,
                  height: iconBoxSize,
                  borderRadius: theme.iconRounded !== false ? Math.round(iconBoxSize * 0.22) : 0,
                }}
                draggable={false}
              />
            ) : (
              renderFallbackIcon(item, volumeState, discordState, nowPlaying, Math.round(iconBoxSize * 0.72))
            )}
          </div>

          {item.showLabel && (
            <span
              className="tile-label"
              style={{
                color: item.textColor || "#FFFFFF",
                fontSize: effectiveFontSize,
              }}
            >
              {item.label}
            </span>
          )}

          {item.action.type === "media" && item.action.command === "play_pause" && nowPlaying && (
            <span className="media-mini-title">{nowPlaying.title}</span>
          )}
        </>
      )}
    </button>
  );
});
