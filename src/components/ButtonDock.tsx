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
import { useI18n, type TKey } from "../i18n";
import type { ButtonItem } from "../types";

// Templates: category and label are translation keys, resolved when shown or inserted
export interface PresetDef {
  category: TKey;
  labelKey: TKey;
  item: Omit<ButtonItem, "id" | "label">;
}

export const PRESET_BUTTONS: PresetDef[] = [
  {
    category: "preset.cat.audio",
    labelKey: "preset.volUp",
    item: {
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
    category: "preset.cat.audio",
    labelKey: "preset.volDown",
    item: {
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
    category: "preset.cat.audio",
    labelKey: "preset.mute",
    item: {
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
    category: "preset.cat.audio",
    labelKey: "preset.mic",
    item: {
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
    category: "preset.cat.audio",
    labelKey: "preset.outputSwitch",
    item: {
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
    category: "preset.cat.media",
    labelKey: "preset.playPause",
    item: {
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
    category: "preset.cat.media",
    labelKey: "media.prev",
    item: {
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
    category: "preset.cat.media",
    labelKey: "media.next",
    item: {
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
    category: "preset.cat.media",
    labelKey: "media.stop",
    item: {
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
    category: "preset.cat.discord",
    labelKey: "preset.dcMic",
    item: {
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
    category: "preset.cat.discord",
    labelKey: "preset.dcHeadset",
    item: {
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
    category: "preset.cat.discord",
    labelKey: "preset.dcLeave",
    item: {
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
    category: "preset.cat.widget",
    labelKey: "preset.clock",
    item: {
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
    category: "preset.cat.widget",
    labelKey: "preset.cpuRam",
    item: {
      showLabel: true,
      fontSize: 13,
      textColor: "#FFFFFF",
      bgColor: null,
      bgOpacity: null,
      iconPath: null,
      action: { type: "widget", kind: "sys_stats", metrics: ["cpu_pct", "cpu_clk", "ram_pct"] },
    },
  },
  {
    category: "preset.cat.widget",
    labelKey: "preset.gpu",
    item: {
      showLabel: true,
      fontSize: 13,
      textColor: "#FFFFFF",
      bgColor: null,
      bgOpacity: null,
      iconPath: null,
      action: {
        type: "widget",
        kind: "sys_stats",
        metrics: ["gpu_pct", "gpu_temp", "gpu_clk", "vram_pct"],
      },
    },
  },
  {
    category: "preset.cat.widget",
    labelKey: "preset.nowPlaying",
    item: {
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
    category: "preset.cat.widget",
    labelKey: "editor.stepHotkey",
    item: {
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
    category: "preset.cat.widget",
    labelKey: "preset.multi",
    item: {
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

function renderMiniIcon(item: Pick<ButtonItem, "action">, absIcon?: string | null) {
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
  const { t } = useI18n();
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
            {t("dock.presets")}
          </button>
          <button
            type="button"
            className={`dock-tab ${tab === "vault" ? "dock-tab-active" : ""}`}
            onClick={() => setTab("vault")}
          >
            {t("dock.vault", { count: vault.length })}
          </button>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} title={t("dock.close")}>
          <X size={14} />
        </button>
      </div>

      <div className="dock-body">
        {tab === "vault" ? (
          <>
            <div className="dock-hint">
              {t("dock.vaultHint")}
            </div>
            {vault.length === 0 ? (
              <div className="dock-empty">{t("dock.vaultEmpty")}</div>
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
                        title={t("dock.takeOut")}
                        onClick={() => onQuickInsert(v, v.id)}
                      >
                        <Plus size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title={t("dock.deleteForever")}
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
              {t("dock.presetHint")}
            </div>
            {categories.map((cat) => (
              <div key={cat} className="dock-cat-group">
                <div className="dock-cat-title">{t(cat)}</div>
                <div className="dock-list">
                  {PRESET_BUTTONS.filter((p) => p.category === cat).map((p, idx) => {
                    // The label is fixed in the language active at the moment of insertion
                    const createCopy = (): ButtonItem => ({
                      ...structuredClone(p.item),
                      label: t(p.labelKey),
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
                          <span className="dock-item-label">{t(p.labelKey)}</span>
                        </div>
                        <button
                          type="button"
                          className="icon-btn"
                          title={t("dock.addToFree")}
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
