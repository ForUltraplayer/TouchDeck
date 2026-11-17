import React from "react";
import {
  AppWindow,
  ArrowRightCircle,
  Folder,
  Globe,
  Keyboard,
  Pause,
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
import type { ButtonItem, ThemeConfig, VolumeState } from "../types";

interface Props {
  slotIndex: number;
  item?: ButtonItem;
  resolvedIconAbsPath?: string;
  theme: ThemeConfig;
  cellSize: number;
  borderRadius: number;
  editMode: boolean;
  isDropHover: boolean;
  isDraggingSource: boolean;
  volumeState: VolumeState | null;
  onExecute: (item: ButtonItem) => void;
  onEdit: (slotIndex: number) => void;
  onStartSlotDrag: (slotIndex: number, e: React.PointerEvent) => void;
}

function renderFallbackIcon(item: ButtonItem, volumeState: VolumeState | null, size: number) {
  const act = item.action;
  switch (act.type) {
    case "folder":
      return <Folder size={size} strokeWidth={1.8} color="#F7C948" />;
    case "url":
      return <Globe size={size} strokeWidth={1.8} color="#60A5FA" />;
    case "volume":
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
    case "media":
      if (act.command === "next") return <SkipForward size={size} strokeWidth={1.8} color="#E2E8F0" />;
      if (act.command === "prev") return <SkipBack size={size} strokeWidth={1.8} color="#E2E8F0" />;
      if (act.command === "stop") return <Square size={size} strokeWidth={1.8} color="#F87171" />;
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
  isDropHover,
  isDraggingSource,
  volumeState,
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
        }}
        onClick={() => {
          if (editMode) onEdit(slotIndex);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onEdit(slotIndex);
        }}
        title="파일/바로가기를 끌어다 놓거나 우클릭하여 추가"
      >
        <Plus size={20} className="empty-plus" />
      </button>
    );
  }

  const bg = hexToRgba(
    item.bgColor || theme.defaultButtonColor,
    item.bgOpacity ?? theme.defaultButtonOpacity
  );

  return (
    <button
      type="button"
      data-slot-index={slotIndex}
      className={`tile tile-filled ${editMode ? "tile-edit-wiggle" : ""} ${
        isDropHover ? "tile-drop-hover" : ""
      } ${isDraggingSource ? "tile-dragging-src" : ""}`}
      style={{
        width: cellSize,
        height: cellSize,
        borderRadius,
        backgroundColor: bg,
        touchAction: editMode ? "none" : "auto",
      }}
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
      title={item.label}
    >
      {item.action.type === "volume" && volumeState && (
        <span className={`vol-badge ${volumeState.muted ? "vol-muted" : ""}`}>
          {volumeState.muted ? "MUTE" : `${volumeState.level}%`}
        </span>
      )}

      <div className="tile-icon-wrap" style={{ height: iconBoxSize }}>
        {iconSrc ? (
          <img
            src={iconSrc}
            alt={item.label}
            className="tile-icon-img"
            style={{ width: iconBoxSize, height: iconBoxSize }}
            draggable={false}
          />
        ) : (
          renderFallbackIcon(item, volumeState, Math.round(iconBoxSize * 0.72))
        )}
      </div>

      {item.showLabel && (
        <span
          className="tile-label"
          style={{
            color: item.textColor || "#FFFFFF",
            fontSize: item.fontSize || 13,
          }}
        >
          {item.label}
        </span>
      )}
    </button>
  );
};
