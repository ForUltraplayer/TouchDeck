import React, { useState } from "react";
import {
  Clock,
  Cpu,
  HeadphoneOff,
  Headphones,
  Keyboard,
  Layers,
  Mic,
  MicOff,
  Music,
  PhoneOff,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { assetUrl } from "../api";
import type { ButtonItem } from "../types";

export interface PresetDef {
  category: string;
  item: Omit<ButtonItem, "id">;
}

export const PRESET_BUTTONS: PresetDef[] = [
  {
    category: "오디오 & 볼륨",
    item: {
      label: "볼륨 +",
      showLabel: true,
      fontSize: 13,
      textColor: "#FFFFFF",
      bgColor: null,
      bgOpacity: null,
      iconPath: null,
      action: { type: "volume", command: "up", step: 5, target: "speaker" },
    },
  },
  {
    category: "오디오 & 볼륨",
    item: {
      label: "볼륨 -",
      showLabel: true,
      fontSize: 13,
      textColor: "#FFFFFF",
      bgColor: null,
      bgOpacity: null,
      iconPath: null,
      action: { type: "volume", command: "down", step: 5, target: "speaker" },
    },
  },
  {
    category: "오디오 & 볼륨",
    item: {
      label: "음소거",
      showLabel: true,
      fontSize: 13,
      textColor: "#FFFFFF",
      bgColor: null,
      bgOpacity: null,
      iconPath: null,
      action: { type: "volume", command: "mute", step: 0, target: "speaker" },
    },
  },
  {
    category: "오디오 & 볼륨",
    item: {
      label: "마이크",
      showLabel: true,
      fontSize: 13,
      textColor: "#FFFFFF",
      bgColor: null,
      bgOpacity: null,
      iconPath: null,
      action: { type: "volume", command: "mute", step: 0, target: "mic" },
    },
  },
  {
    category: "오디오 & 볼륨",
    item: {
      label: "출력 전환",
      showLabel: true,
      fontSize: 13,
      textColor: "#FFFFFF",
      bgColor: null,
      bgOpacity: null,
      iconPath: null,
      action: { type: "audio_device", deviceId: null },
    },
  },
  {
    category: "미디어",
    item: {
      label: "재생/정지",
      showLabel: true,
      fontSize: 13,
      textColor: "#FFFFFF",
      bgColor: null,
      bgOpacity: null,
      iconPath: null,
      action: { type: "media", command: "play_pause" },
    },
  },
  {
    category: "미디어",
    item: {
      label: "이전 곡",
      showLabel: true,
      fontSize: 13,
      textColor: "#FFFFFF",
      bgColor: null,
      bgOpacity: null,
      iconPath: null,
      action: { type: "media", command: "prev" },
    },
  },
  {
    category: "미디어",
    item: {
      label: "다음 곡",
      showLabel: true,
      fontSize: 13,
      textColor: "#FFFFFF",
      bgColor: null,
      bgOpacity: null,
      iconPath: null,
      action: { type: "media", command: "next" },
    },
  },
  {
    category: "미디어",
    item: {
      label: "정지",
      showLabel: true,
      fontSize: 13,
      textColor: "#FFFFFF",
      bgColor: null,
      bgOpacity: null,
      iconPath: null,
      action: { type: "media", command: "stop" },
    },
  },
  {
    category: "Discord (양방향)",
    item: {
      label: "DC 마이크",
      showLabel: true,
      fontSize: 13,
      textColor: "#FFFFFF",
      bgColor: null,
      bgOpacity: null,
      iconPath: null,
      action: { type: "discord", command: "mute" },
    },
  },
  {
    category: "Discord (양방향)",
    item: {
      label: "DC 헤드셋",
      showLabel: true,
      fontSize: 13,
      textColor: "#FFFFFF",
      bgColor: null,
      bgOpacity: null,
      iconPath: null,
      action: { type: "discord", command: "deaf" },
    },
  },
  {
    category: "Discord (양방향)",
    item: {
      label: "DC 나가기",
      showLabel: true,
      fontSize: 13,
      textColor: "#FFFFFF",
      bgColor: null,
      bgOpacity: null,
      iconPath: null,
      action: { type: "discord", command: "disconnect" },
    },
  },
  {
    category: "위젯 & 매크로",
    item: {
      label: "시계",
      showLabel: true,
      fontSize: 13,
      textColor: "#FFFFFF",
      bgColor: null,
      bgOpacity: null,
      iconPath: null,
      action: { type: "widget", kind: "clock" },
    },
  },
  {
    category: "위젯 & 매크로",
    item: {
      label: "CPU / RAM",
      showLabel: true,
      fontSize: 13,
      textColor: "#FFFFFF",
      bgColor: null,
      bgOpacity: null,
      iconPath: null,
      action: { type: "widget", kind: "sys_stats" },
    },
  },
  {
    category: "위젯 & 매크로",
    item: {
      label: "현재 곡",
      showLabel: true,
      fontSize: 13,
      textColor: "#FFFFFF",
      bgColor: null,
      bgOpacity: null,
      iconPath: null,
      action: { type: "widget", kind: "now_playing" },
    },
  },
  {
    category: "위젯 & 매크로",
    item: {
      label: "단축키",
      showLabel: true,
      fontSize: 13,
      textColor: "#FFFFFF",
      bgColor: null,
      bgOpacity: null,
      iconPath: null,
      action: { type: "hotkey", keys: ["Ctrl", "Shift", "M"] },
    },
  },
  {
    category: "위젯 & 매크로",
    item: {
      label: "멀티 액션",
      showLabel: true,
      fontSize: 13,
      textColor: "#FFFFFF",
      bgColor: null,
      bgOpacity: null,
      iconPath: null,
      action: { type: "multi", steps: [] },
    },
  },
];

function renderMiniIcon(item: Omit<ButtonItem, "id">, absIcon?: string | null) {
  const src = assetUrl(absIcon);
  if (src) {
    return <img src={src} alt="" className="dock-mini-img" draggable={false} />;
  }
  const a = item.action;
  if (a.type === "volume") {
    if (a.target === "mic") return <Mic size={16} color="#38BDF8" />;
    if (a.command === "mute") return <VolumeX size={16} color="#F87171" />;
    if (a.command === "down") return <Volume1 size={16} color="#A7F3D0" />;
    return <Volume2 size={16} color="#34D399" />;
  }
  if (a.type === "audio_device") return <Headphones size={16} color="#38BDF8" />;
  if (a.type === "media") {
    if (a.command === "next") return <SkipForward size={16} color="#E2E8F0" />;
    if (a.command === "prev") return <SkipBack size={16} color="#E2E8F0" />;
    if (a.command === "stop") return <Square size={16} color="#F87171" />;
    return <Play size={16} color="#A78BFA" />;
  }
  if (a.type === "discord") {
    if (a.command === "mute") return <MicOff size={16} color="#818CF8" />;
    if (a.command === "deaf") return <HeadphoneOff size={16} color="#818CF8" />;
    return <PhoneOff size={16} color="#F87171" />;
  }
  if (a.type === "widget") {
    if (a.kind === "clock") return <Clock size={16} color="#38BDF8" />;
    if (a.kind === "sys_stats") return <Cpu size={16} color="#34D399" />;
    return <Music size={16} color="#A78BFA" />;
  }
  if (a.type === "hotkey") return <Keyboard size={16} color="#FBBF24" />;
  if (a.type === "multi") return <Layers size={16} color="#F472B6" />;
  return <Plus size={16} color="#94A3B8" />;
}

interface Props {
  vault: ButtonItem[];
  assetMap: Record<string, string>;
  isVaultDropHover: boolean;
  onQuickInsert: (item: ButtonItem, removeVaultId?: string) => void;
  onRemoveFromVault: (id: string) => void;
  onStartDockDrag: (item: ButtonItem, removeVaultId: string | null, e: React.PointerEvent) => void;
  onClose: () => void;
}

export const ButtonDock: React.FC<Props> = ({
  vault,
  assetMap,
  isVaultDropHover,
  onQuickInsert,
  onRemoveFromVault,
  onStartDockDrag,
  onClose,
}) => {
  const [tab, setTab] = useState<"presets" | "vault">("presets");
  const categories = Array.from(new Set(PRESET_BUTTONS.map((p) => p.category)));

  return (
    <aside
      className={`dock-panel ${isVaultDropHover ? "dock-drop-hover" : ""}`}
      data-vault-drop="true"
    >
      <div className="dock-header">
        <div className="dock-tabs">
          <button
            type="button"
            className={`dock-tab ${tab === "presets" ? "dock-tab-active" : ""}`}
            onClick={() => setTab("presets")}
          >
            기본 프리셋
          </button>
          <button
            type="button"
            className={`dock-tab ${tab === "vault" ? "dock-tab-active" : ""}`}
            onClick={() => setTab("vault")}
          >
            보관함 ({vault.length})
          </button>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} title="보관함 닫기">
          <X size={14} />
        </button>
      </div>

      <div className="dock-body">
        {tab === "vault" ? (
          <>
            <div className="dock-hint">
              편집 모드에서 버튼을 여기로 끌어다 보관하거나, 보관된 버튼을 그리드로 끌어다 놓으세요.
            </div>
            {vault.length === 0 ? (
              <div className="dock-empty">보관된 버튼이 없습니다.</div>
            ) : (
              <div className="dock-list">
                {vault.map((v) => (
                  <div
                    key={v.id}
                    className="dock-item"
                    onPointerDown={(e) => {
                      if (e.button === 0 && !(e.target as HTMLElement).closest("button")) {
                        onStartDockDrag(v, v.id, e);
                      }
                    }}
                  >
                    <div className="dock-item-left">
                      {renderMiniIcon(v, v.iconPath ? assetMap[v.iconPath] : null)}
                      <span className="dock-item-label">{v.label}</span>
                    </div>
                    <div className="dock-item-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        title="빈 칸에 꺼내기"
                        onClick={() => onQuickInsert(v, v.id)}
                      >
                        <Plus size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="영구 삭제"
                        onClick={() => onRemoveFromVault(v.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="dock-presets">
            <div className="dock-hint">
              원하는 버튼을 그리드로 드래그하거나 + 버튼으로 빈 칸에 바로 추가하세요.
            </div>
            {categories.map((cat) => (
              <div key={cat} className="dock-cat-group">
                <div className="dock-cat-title">{cat}</div>
                <div className="dock-list">
                  {PRESET_BUTTONS.filter((p) => p.category === cat).map((p, idx) => {
                    const createCopy = (): ButtonItem => ({
                      ...structuredClone(p.item),
                      id: `btn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    });
                    return (
                      <div
                        key={`${cat}-${idx}`}
                        className="dock-item"
                        onPointerDown={(e) => {
                          if (e.button === 0 && !(e.target as HTMLElement).closest("button")) {
                            onStartDockDrag(createCopy(), null, e);
                          }
                        }}
                      >
                        <div className="dock-item-left">
                          {renderMiniIcon(p.item, null)}
                          <span className="dock-item-label">{p.item.label}</span>
                        </div>
                        <button
                          type="button"
                          className="icon-btn"
                          title="빈 칸에 추가"
                          onClick={() => onQuickInsert(createCopy())}
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};
