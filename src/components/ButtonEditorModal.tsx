import React, { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Archive,
  Copy,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../api";
import { LANGUAGES, translate, useI18n, type TKey } from "../i18n";
import type {
  AudioDeviceInfo,
  ButtonAction,
  ButtonItem,
  DeckPage,
  MultiStep,
} from "../types";

interface Props {
  slotIndex: number;
  currentPageIndex: number;
  initialItem?: ButtonItem;
  pages: DeckPage[];
  onSave: (slotIndex: number, item: ButtonItem) => void;
  onDelete: (slotIndex: number) => void;
  onMoveToVault: (slotIndex: number) => void;
  onTransferToPage: (slotIndex: number, targetPageIdx: number, move: boolean) => void;
  onClose: () => void;
}

const DEFAULT_NEW_ITEM = (label: string): ButtonItem => ({
  id: `btn-${Date.now()}`,
  label,
  showLabel: true,
  fontSize: 13,
  textColor: "#FFFFFF",
  bgColor: null,
  bgOpacity: null,
  iconPath: null,
  badge: null,
  accentColor: null,
  action: {
    type: "app",
    exe: "",
    args: "",
    workDir: "",
    procName: "",
    toggleMinimize: false,
  },
});

const ACCENT_PRESETS = ["#38BDF8", "#34D399", "#FBBF24", "#F472B6", "#A78BFA", "#F87171"];

// A label still counts as untouched if it is the default of any language, so it survives a language switch
const isDefaultLabel = (label: string) =>
  LANGUAGES.some((l) => translate(l, "editor.newButton") === label);

function keyEventToTokens(e: React.KeyboardEvent): string[] | null {
  const ignore = ["Control", "Shift", "Alt", "Meta"];
  if (ignore.includes(e.key)) return null;

  const tokens: string[] = [];
  if (e.ctrlKey) tokens.push("Ctrl");
  if (e.shiftKey) tokens.push("Shift");
  if (e.altKey) tokens.push("Alt");
  if (e.metaKey) tokens.push("Win");

  let main = e.key;
  if (main === " ") main = "Space";
  else if (main === "Escape") main = "Esc";
  else if (main === "ArrowUp") main = "Up";
  else if (main === "ArrowDown") main = "Down";
  else if (main === "ArrowLeft") main = "Left";
  else if (main === "ArrowRight") main = "Right";
  else if (main.length === 1) main = main.toUpperCase();

  tokens.push(main);
  return tokens;
}

export const ButtonEditorModal: React.FC<Props> = ({
  slotIndex,
  currentPageIndex,
  initialItem,
  pages,
  onSave,
  onDelete,
  onMoveToVault,
  onTransferToPage,
  onClose,
}) => {
  const { t } = useI18n();
  const [item, setItem] = useState<ButtonItem>(() =>
    initialItem ? structuredClone(initialItem) : DEFAULT_NEW_ITEM(t("editor.newButton"))
  );
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [recordingKey, setRecordingKey] = useState(false);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceInfo[]>([]);
  const [transferPageIdx, setTransferPageIdx] = useState(currentPageIndex);
  const [hotkeyText, setHotkeyText] = useState(() =>
    initialItem?.action.type === "hotkey" ? initialItem.action.keys.join(" + ") : "Ctrl + Shift + M"
  );

  useEffect(() => {
    if (item.action.type === "audio_device") {
      api.listAudioDevices().then(setAudioDevices).catch(() => {});
    }
  }, [item.action.type]);

  const setActionType = (type: ButtonAction["type"]) => {
    switch (type) {
      case "app":
        setItem({
          ...item,
          action: {
            type: "app",
            exe: "",
            args: "",
            workDir: "",
            procName: "",
            toggleMinimize: false,
          },
        });
        break;
      case "folder":
        setItem({ ...item, action: { type: "folder", path: "" } });
        break;
      case "url":
        setItem({ ...item, action: { type: "url", url: "https://" } });
        break;
      case "volume":
        setItem({
          ...item,
          action: { type: "volume", command: "up", step: 5, target: "speaker" },
        });
        break;
      case "media":
        setItem({ ...item, action: { type: "media", command: "play_pause" } });
        break;
      case "audio_device":
        setItem({ ...item, action: { type: "audio_device", deviceId: null } });
        break;
      case "hotkey":
        setItem({
          ...item,
          action: {
            type: "hotkey",
            keys: hotkeyText
              .split("+")
              .map((s) => s.trim())
              .filter(Boolean),
          },
        });
        break;
      case "multi":
        setItem({
          ...item,
          action: {
            type: "multi",
            steps: [{ action: { type: "url", url: "https://" }, delayMs: 200 }],
          },
        });
        break;
      case "page":
        setItem({ ...item, action: { type: "page", pageIndex: 0 } });
        break;
      case "discord":
        setItem({ ...item, action: { type: "discord", command: "mute" } });
        break;
      case "widget":
        setItem({
          ...item,
          action: { type: "widget", kind: "clock", metrics: ["cpu_pct", "ram_pct"] },
        });
        break;
    }
  };

  const handleBrowseApp = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: t("editor.filterApp"), extensions: ["lnk", "exe", "cmd", "bat", "vbs", "url"] }],
      });
      if (!selected || typeof selected !== "string") return;
      setBusy(true);
      const resolved = await api.inspectDrop(selected);
      if (resolved.kind === "url") {
        setItem((prev) => ({
          ...prev,
          label: isDefaultLabel(prev.label) ? resolved.label : prev.label,
          iconPath: resolved.iconPath ?? prev.iconPath,
          action: { type: "url", url: resolved.url },
        }));
      } else if (resolved.kind === "folder") {
        setItem((prev) => ({
          ...prev,
          label: isDefaultLabel(prev.label) ? resolved.label : prev.label,
          iconPath: resolved.iconPath ?? prev.iconPath,
          action: { type: "folder", path: resolved.exe },
        }));
      } else {
        setItem((prev) => ({
          ...prev,
          label: isDefaultLabel(prev.label) ? resolved.label : prev.label,
          iconPath: resolved.iconPath ?? prev.iconPath,
          action: {
            type: "app",
            exe: resolved.exe,
            args: resolved.args,
            workDir: resolved.workDir,
            procName: resolved.procName,
            toggleMinimize: false,
          },
        }));
      }
      setErrorMsg("");
    } catch (e) {
      setErrorMsg(t("editor.fileReadFailed", { error: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const handleBrowseFolder = async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (!selected || typeof selected !== "string") return;
      setBusy(true);
      const resolved = await api.inspectDrop(selected);
      setItem((prev) => ({
        ...prev,
        label: isDefaultLabel(prev.label) ? resolved.label : prev.label,
        iconPath: resolved.iconPath ?? prev.iconPath,
        action: { type: "folder", path: selected },
      }));
      setErrorMsg("");
    } catch (e) {
      setErrorMsg(t("editor.folderReadFailed", { error: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const handleFetchFavicon = async () => {
    if (item.action.type !== "url") return;
    setBusy(true);
    try {
      const rel = await api.fetchFavicon(item.action.url);
      setItem((prev) => ({ ...prev, iconPath: rel }));
    } catch {
      // keep existing icon
    } finally {
      setBusy(false);
    }
  };

  const handleBrowseIcon = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: t("editor.filterImage"), extensions: ["png", "jpg", "jpeg", "webp", "ico", "svg"] }],
      });
      if (!selected || typeof selected !== "string") return;
      setBusy(true);
      const rel = await api.importImage(selected, "icon");
      setItem((prev) => ({ ...prev, iconPath: rel }));
      setErrorMsg("");
    } catch (e) {
      setErrorMsg(t("editor.iconImportFailed", { error: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let finalItem = item;
    if (item.action.type === "hotkey") {
      finalItem = {
        ...item,
        action: {
          type: "hotkey",
          keys: hotkeyText
            .split("+")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      };
    } else if (item.action.type === "multi") {
      finalItem = {
        ...item,
        action: {
          type: "multi",
          steps: item.action.steps.map((st) =>
            st.action.type === "hotkey"
              ? {
                  ...st,
                  action: {
                    type: "hotkey",
                    keys: st.action.keys.map((k) => k.trim()).filter(Boolean),
                  },
                }
              : st
          ),
        },
      };
    }
    onSave(slotIndex, finalItem);
  };

  const useCustomBg = item.bgColor !== null || item.bgOpacity !== null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="modal-header">
          <span>{t("editor.title", { n: slotIndex + 1 })}</span>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="field-row">
            <label>{t("editor.label")}</label>
            <div className="inline-group">
              <input
                type="text"
                value={item.label}
                onChange={(e) => setItem({ ...item, label: e.target.value })}
                placeholder={t("editor.labelPlaceholder")}
              />
              <label className="check-pill">
                <input
                  type="checkbox"
                  checked={item.showLabel}
                  onChange={(e) => setItem({ ...item, showLabel: e.target.checked })}
                />
                {t("editor.showLabel")}
              </label>
            </div>
          </div>

          <div className="field-row">
            <label>{t("editor.actionType")}</label>
            <select
              value={item.action.type}
              onChange={(e) => setActionType(e.target.value as ButtonAction["type"])}
            >
              <option value="app">{t("type.app")}</option>
              <option value="folder">{t("type.folder")}</option>
              <option value="url">{t("type.url")}</option>
              <option value="volume">{t("type.volume")}</option>
              <option value="media">{t("type.media")}</option>
              <option value="audio_device">{t("type.audioDevice")}</option>
              <option value="discord">{t("type.discord")}</option>
              <option value="hotkey">{t("type.hotkey")}</option>
              <option value="multi">{t("type.multi")}</option>
              <option value="page">{t("type.page")}</option>
              <option value="widget">{t("type.widget")}</option>
            </select>
          </div>

          {item.action.type === "app" && (
            <>
              <div className="field-row">
                <label>{t("editor.exe")}</label>
                <div className="inline-group">
                  <input
                    type="text"
                    value={item.action.exe}
                    onChange={(e) =>
                      setItem({
                        ...item,
                        action: { ...item.action, type: "app", exe: e.target.value },
                      })
                    }
                    placeholder={t("editor.exePlaceholder")}
                  />
                  <button type="button" className="btn-secondary" onClick={handleBrowseApp} disabled={busy}>
                    <FolderOpen size={14} /> {t("editor.browse")}
                  </button>
                </div>
              </div>
              <div className="field-row two-col">
                <div>
                  <label>{t("editor.args")}</label>
                  <input
                    type="text"
                    value={item.action.args ?? ""}
                    onChange={(e) =>
                      setItem({
                        ...item,
                        action: {
                          ...(item.action as Extract<ButtonAction, { type: "app" }>),
                          args: e.target.value,
                        },
                      })
                    }
                    placeholder={t("editor.argsPlaceholder")}
                  />
                </div>
                <div>
                  <label>{t("editor.procName")}</label>
                  <input
                    type="text"
                    value={item.action.procName ?? ""}
                    onChange={(e) =>
                      setItem({
                        ...item,
                        action: {
                          ...(item.action as Extract<ButtonAction, { type: "app" }>),
                          procName: e.target.value,
                        },
                      })
                    }
                    placeholder={t("editor.procPlaceholder")}
                  />
                </div>
              </div>
              <label className="check-pill">
                <input
                  type="checkbox"
                  checked={item.action.toggleMinimize ?? false}
                  onChange={(e) =>
                    setItem({
                      ...item,
                      action: {
                        ...(item.action as Extract<ButtonAction, { type: "app" }>),
                        toggleMinimize: e.target.checked,
                      },
                    })
                  }
                />
                {t("editor.toggleMinimize")}
              </label>
            </>
          )}

          {item.action.type === "folder" && (
            <div className="field-row">
              <label>{t("editor.folderPath")}</label>
              <div className="inline-group">
                <input
                  type="text"
                  value={item.action.path}
                  onChange={(e) =>
                    setItem({ ...item, action: { type: "folder", path: e.target.value } })
                  }
                  placeholder="X:\work"
                />
                <button type="button" className="btn-secondary" onClick={handleBrowseFolder} disabled={busy}>
                  <FolderOpen size={14} /> {t("editor.browse")}
                </button>
              </div>
            </div>
          )}

          {item.action.type === "url" && (
            <div className="field-row">
              <label>{t("editor.url")}</label>
              <div className="inline-group">
                <input
                  type="text"
                  value={item.action.url}
                  onChange={(e) =>
                    setItem({ ...item, action: { type: "url", url: e.target.value } })
                  }
                  placeholder="https://..."
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleFetchFavicon}
                  disabled={busy}
                  title={t("editor.faviconTitle")}
                >
                  <Globe size={14} /> {t("editor.favicon")}
                </button>
              </div>
            </div>
          )}

          {item.action.type === "volume" && (
            <div className="field-row two-col">
              <div>
                <label>{t("editor.volTarget")}</label>
                <select
                  value={
                    item.action.target === "mic"
                      ? "mic_mute"
                      : item.action.command
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "mic_mute") {
                      setItem({
                        ...item,
                        action: { type: "volume", command: "mute", step: 0, target: "mic" },
                      });
                    } else {
                      setItem({
                        ...item,
                        action: {
                          type: "volume",
                          command: v as "up" | "down" | "mute",
                          step: (item.action as Extract<ButtonAction, { type: "volume" }>).step || 5,
                          target: "speaker",
                        },
                      });
                    }
                  }}
                >
                  <option value="up">{t("editor.volUp")}</option>
                  <option value="down">{t("editor.volDown")}</option>
                  <option value="mute">{t("editor.volMute")}</option>
                  <option value="mic_mute">{t("editor.micMute")}</option>
                </select>
              </div>
              {item.action.target !== "mic" && item.action.command !== "mute" && (
                <div>
                  <label>{t("editor.volStep")}</label>
                  <input
                    type="number"
                    min={1}
                    max={25}
                    value={item.action.step}
                    onChange={(e) =>
                      setItem({
                        ...item,
                        action: {
                          type: "volume",
                          command: (item.action as Extract<ButtonAction, { type: "volume" }>).command,
                          step: Math.min(25, Math.max(1, Math.round(Number(e.target.value)) || 5)),
                          target: "speaker",
                        },
                      })
                    }
                  />
                </div>
              )}
            </div>
          )}

          {item.action.type === "media" && (
            <div className="field-row">
              <label>{t("editor.mediaCommand")}</label>
              <select
                value={item.action.command}
                onChange={(e) =>
                  setItem({
                    ...item,
                    action: {
                      type: "media",
                      command: e.target.value as "play_pause" | "next" | "prev" | "stop",
                    },
                  })
                }
              >
                <option value="play_pause">{t("media.playPause")}</option>
                <option value="next">{t("media.next")}</option>
                <option value="prev">{t("media.prev")}</option>
                <option value="stop">{t("media.stop")}</option>
              </select>
            </div>
          )}

          {item.action.type === "audio_device" && (
            <div className="field-row">
              <label>{t("editor.audioDevice")}</label>
              <select
                value={item.action.deviceId ?? ""}
                onChange={(e) =>
                  setItem({
                    ...item,
                    action: {
                      type: "audio_device",
                      deviceId: e.target.value ? e.target.value : null,
                    },
                  })
                }
              >
                <option value="">{t("editor.audioCycle")}</option>
                {audioDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} {d.isDefault ? t("editor.audioDefault") : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {item.action.type === "discord" && (
            <div className="field-row">
              <label>{t("editor.discordCommand")}</label>
              <select
                value={item.action.command}
                onChange={(e) =>
                  setItem({
                    ...item,
                    action: {
                      type: "discord",
                      command: e.target.value as "mute" | "deaf" | "disconnect",
                    },
                  })
                }
              >
                <option value="mute">{t("editor.micMute")}</option>
                <option value="deaf">{t("editor.discordDeaf")}</option>
                <option value="disconnect">{t("editor.discordDisconnect")}</option>
              </select>
            </div>
          )}

          {item.action.type === "hotkey" && (
            <div className="field-row">
              <label>{t("type.hotkey")}</label>
              <div className="inline-group">
                <input
                  type="text"
                  value={recordingKey ? t("editor.hotkeyPrompt") : hotkeyText}
                  readOnly={recordingKey}
                  onChange={(e) => setHotkeyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (!recordingKey) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const tokens = keyEventToTokens(e);
                    if (tokens) {
                      setHotkeyText(tokens.join(" + "));
                      setRecordingKey(false);
                    }
                  }}
                  placeholder="Ctrl + Shift + M"
                />
                <button
                  type="button"
                  className={recordingKey ? "btn-primary" : "btn-secondary"}
                  onClick={() => setRecordingKey((v) => !v)}
                >
                  {t(recordingKey ? "editor.hotkeyWaiting" : "editor.hotkeyRecord")}
                </button>
              </div>
            </div>
          )}

          {item.action.type === "multi" && (
            <div className="field-row">
              <div className="section-title-row">
                <label>{t("editor.steps", { count: item.action.steps.length })}</label>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    const cur = (item.action as Extract<ButtonAction, { type: "multi" }>).steps;
                    const next: MultiStep[] = [
                      ...cur,
                      { action: { type: "app", exe: "", args: "", workDir: "", procName: "" }, delayMs: 200 },
                    ];
                    setItem({ ...item, action: { type: "multi", steps: next } });
                  }}
                >
                  <Plus size={13} /> {t("editor.addStep")}
                </button>
              </div>
              <div className="multi-list">
                {item.action.steps.map((st, sIdx) => (
                  <div key={sIdx} className="multi-row">
                    <select
                      value={st.action.type}
                      onChange={(e) => {
                        const t = e.target.value as ButtonAction["type"];
                        const cur = [...(item.action as Extract<ButtonAction, { type: "multi" }>).steps];
                        const newAct: ButtonAction =
                          t === "folder"
                            ? { type: "folder", path: "" }
                            : t === "url"
                            ? { type: "url", url: "https://" }
                            : t === "hotkey"
                            ? { type: "hotkey", keys: ["Ctrl", "C"] }
                            : t === "media"
                            ? { type: "media", command: "play_pause" }
                            : { type: "app", exe: "", args: "", workDir: "", procName: "" };
                        cur[sIdx] = { ...cur[sIdx], action: newAct };
                        setItem({ ...item, action: { type: "multi", steps: cur } });
                      }}
                    >
                      <option value="app">{t("editor.stepApp")}</option>
                      <option value="folder">{t("editor.stepFolder")}</option>
                      <option value="url">URL</option>
                      <option value="media">{t("editor.stepMedia")}</option>
                      <option value="hotkey">{t("editor.stepHotkey")}</option>
                    </select>
                    <input
                      type="text"
                      value={
                        st.action.type === "app"
                          ? st.action.exe
                          : st.action.type === "folder"
                          ? st.action.path
                          : st.action.type === "url"
                          ? st.action.url
                          : st.action.type === "hotkey"
                          ? st.action.keys.join("+")
                          : st.action.type === "media"
                          ? st.action.command
                          : ""
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        const cur = [...(item.action as Extract<ButtonAction, { type: "multi" }>).steps];
                        const a = cur[sIdx].action;
                        if (a.type === "app") cur[sIdx].action = { ...a, exe: v };
                        else if (a.type === "folder") cur[sIdx].action = { type: "folder", path: v };
                        else if (a.type === "url") cur[sIdx].action = { type: "url", url: v };
                        else if (a.type === "hotkey")
                          cur[sIdx].action = {
                            type: "hotkey",
                            keys: v.split("+").map((k) => k.trim()),
                          };
                        else if (a.type === "media")
                          cur[sIdx].action = { type: "media", command: v as "play_pause" | "next" | "prev" | "stop" };
                        setItem({ ...item, action: { type: "multi", steps: cur } });
                      }}
                      placeholder={t("editor.stepPlaceholder")}
                    />
                    <input
                      type="number"
                      style={{ width: 68 }}
                      min={0}
                      max={10000}
                      step={100}
                      value={st.delayMs}
                      onChange={(e) => {
                        const cur = [...(item.action as Extract<ButtonAction, { type: "multi" }>).steps];
                        cur[sIdx] = {
                          ...cur[sIdx],
                          delayMs: Math.min(10000, Math.max(0, Math.round(Number(e.target.value)) || 0)),
                        };
                        setItem({ ...item, action: { type: "multi", steps: cur } });
                      }}
                      title={t("editor.stepDelay")}
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => {
                        const cur = (item.action as Extract<ButtonAction, { type: "multi" }>).steps.filter(
                          (_, i) => i !== sIdx
                        );
                        setItem({ ...item, action: { type: "multi", steps: cur } });
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {item.action.type === "page" && (
            <div className="field-row">
              <label>{t("editor.targetPage")}</label>
              <select
                value={item.action.pageIndex}
                onChange={(e) =>
                  setItem({
                    ...item,
                    action: { type: "page", pageIndex: Number(e.target.value) },
                  })
                }
              >
                {pages.map((p, idx) => (
                  <option key={p.id} value={idx}>
                    {idx + 1}. {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {item.action.type === "widget" && (
            <>
              <div className="field-row">
                <label>{t("editor.widgetKind")}</label>
                <select
                  value={item.action.kind}
                  onChange={(e) => {
                    const nextKind = e.target.value as "clock" | "sys_stats" | "now_playing";
                    const curMetrics = (item.action as Extract<ButtonAction, { type: "widget" }>).metrics;
                    setItem({
                      ...item,
                      action: {
                        type: "widget",
                        kind: nextKind,
                        metrics:
                          nextKind === "sys_stats"
                            ? curMetrics && curMetrics.length > 0
                              ? curMetrics
                              : ["cpu_pct", "ram_pct"]
                            : curMetrics,
                      },
                    });
                  }}
                >
                  <option value="clock">{t("editor.widgetClock")}</option>
                  <option value="sys_stats">{t("editor.widgetSysStats")}</option>
                  <option value="now_playing">{t("editor.widgetNowPlaying")}</option>
                </select>
              </div>
              {item.action.kind === "sys_stats" && (() => {
                const selected =
                  item.action.metrics && item.action.metrics.length > 0
                    ? item.action.metrics
                    : ["cpu_pct", "ram_pct"];
                const opts: [string, TKey][] = [
                  ["cpu_pct", "metric.cpuPct"],
                  ["cpu_clk", "metric.cpuClk"],
                  ["cpu_temp", "metric.cpuTemp"],
                  ["ram_pct", "metric.ramPct"],
                  ["gpu_pct", "metric.gpuPct"],
                  ["gpu_temp", "metric.gpuTemp"],
                  ["gpu_clk", "metric.gpuClk"],
                  ["vram_pct", "metric.vramPct"],
                ];
                return (
                  <div className="field-row">
                    <label>{t("editor.metrics")}</label>
                    <div className="metric-grid">
                      {opts.map(([key, labelKey]) => {
                        const checked = selected.includes(key);
                        return (
                          <label key={key} className="check-pill">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!checked && selected.length >= 4}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...selected, key]
                                  : selected.filter((k) => k !== key);
                                setItem({
                                  ...item,
                                  action: {
                                    type: "widget",
                                    kind: "sys_stats",
                                    metrics: next.length > 0 ? next : ["cpu_pct"],
                                  },
                                });
                              }}
                            />
                            {t(labelKey)}
                          </label>
                        );
                      })}
                    </div>
                    {selected.includes("cpu_temp") && (
                      <div className="hint-text">
                        {t("editor.cpuTempHint")}
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )}

          <div className="divider" />

          <div className="field-row">
            <label>{t("editor.icon")}</label>
            <div className="inline-group">
              <button type="button" className="btn-secondary" onClick={handleBrowseIcon} disabled={busy}>
                <ImageIcon size={14} /> {t("common.pickImage")}
              </button>
              {item.iconPath && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setItem({ ...item, iconPath: null })}
                >
                  <RotateCcw size={14} /> {t("editor.defaultIcon")}
                </button>
              )}
              <span className="hint-text">
                {t(item.iconPath ? "editor.iconApplied" : "editor.iconDefault")}
              </span>
            </div>
          </div>

          <div className="field-row two-col">
            <div>
              <label>{t("editor.badge")}</label>
              <input
                type="text"
                maxLength={8}
                value={item.badge ?? ""}
                onChange={(e) =>
                  setItem({ ...item, badge: e.target.value ? e.target.value : null })
                }
                placeholder={t("editor.badgePlaceholder")}
              />
            </div>
            <div>
              <label>{t("editor.accent")}</label>
              <div className="accent-row">
                {ACCENT_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`accent-dot ${item.accentColor === c ? "accent-dot-active" : ""}`}
                    style={{ backgroundColor: c }}
                    onClick={() =>
                      setItem({ ...item, accentColor: item.accentColor === c ? null : c })
                    }
                  />
                ))}
                {item.accentColor && (
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setItem({ ...item, accentColor: null })}
                    title={t("editor.accentClear")}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="field-row two-col">
            <div>
              <label>{t("editor.fontSize")}</label>
              <input
                type="number"
                min={9}
                max={28}
                value={item.fontSize}
                onChange={(e) =>
                  setItem({
                    ...item,
                    // Lower bound waits for blur so two-digit sizes can still be typed
                    fontSize: Math.min(28, Math.max(1, Math.round(Number(e.target.value)) || 13)),
                  })
                }
                onBlur={() => setItem((prev) => ({ ...prev, fontSize: Math.max(9, prev.fontSize) }))}
              />
            </div>
            <div>
              <label>{t("editor.textColor")}</label>
              <input
                type="color"
                value={item.textColor}
                onChange={(e) => setItem({ ...item, textColor: e.target.value })}
              />
            </div>
          </div>

          <div className="field-row">
            <label className="check-pill">
              <input
                type="checkbox"
                checked={useCustomBg}
                onChange={(e) => {
                  if (e.target.checked) {
                    setItem({ ...item, bgColor: "#3B4252", bgOpacity: 90 });
                  } else {
                    setItem({ ...item, bgColor: null, bgOpacity: null });
                  }
                }}
              />
              {t("editor.customBg")}
            </label>
          </div>

          {useCustomBg && (
            <div className="field-row two-col">
              <div>
                <label>{t("editor.bgColor")}</label>
                <input
                  type="color"
                  value={item.bgColor || "#333333"}
                  onChange={(e) => setItem({ ...item, bgColor: e.target.value })}
                />
              </div>
              <div>
                <label>{t("editor.bgOpacity", { value: item.bgOpacity ?? 90 })}</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={item.bgOpacity ?? 90}
                  onChange={(e) => setItem({ ...item, bgOpacity: Number(e.target.value) })}
                />
              </div>
            </div>
          )}

          {initialItem && pages.length > 1 && (
            <>
              <div className="divider" />
              <div className="field-row">
                <label>{t("editor.transfer")}</label>
                <div className="inline-group">
                  <select
                    value={transferPageIdx}
                    onChange={(e) => setTransferPageIdx(Number(e.target.value))}
                  >
                    {pages.map((p, idx) => (
                      <option key={p.id} value={idx}>
                        {idx + 1}. {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={transferPageIdx === currentPageIndex}
                    onClick={() => onTransferToPage(slotIndex, transferPageIdx, false)}
                  >
                    <Copy size={13} /> {t("common.duplicate")}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={transferPageIdx === currentPageIndex}
                    onClick={() => onTransferToPage(slotIndex, transferPageIdx, true)}
                  >
                    {t("common.move")}
                  </button>
                </div>
              </div>
            </>
          )}

          {errorMsg && <div className="status-banner">{errorMsg}</div>}
        </div>

        <div className="modal-footer">
          {initialItem ? (
            <div className="inline-group">
              <button
                type="button"
                className="btn-danger"
                onClick={() => onDelete(slotIndex)}
              >
                <Trash2 size={14} /> {t("common.delete")}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onMoveToVault(slotIndex)}
                title={t("editor.vaultTitle")}
              >
                <Archive size={14} /> {t("editor.vault")}
              </button>
            </div>
          ) : (
            <span />
          )}
          <div className="inline-group">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {t("common.save")}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
