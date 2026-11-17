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

export const ButtonTile: React.FC<Props> = ({
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
        onEdit(slotIndex);
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
          {item.action.kind === "sys_stats" && (
            <>
              <div className="widget-stat-row">
                <span className="widget-k">CPU</span>
                <span className="widget-v">{systemStats ? `${systemStats.cpuPercent}%` : "--"}</span>
              </div>
              <div className="widget-stat-row">
                <span className="widget-k">RAM</span>
                <span className="widget-v">{systemStats ? `${systemStats.memPercent}%` : "--"}</span>
              </div>
            </>
          )}
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
};
