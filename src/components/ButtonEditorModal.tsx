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

const DEFAULT_NEW_ITEM = (): ButtonItem => ({
  id: `btn-${Date.now()}`,
  label: "새 버튼",
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
  const [item, setItem] = useState<ButtonItem>(() =>
    initialItem ? structuredClone(initialItem) : DEFAULT_NEW_ITEM()
  );
  const [busy, setBusy] = useState(false);
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
        setItem({ ...item, action: { type: "widget", kind: "clock" } });
        break;
    }
  };

  const handleBrowseApp = async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "실행 파일 / 바로가기", extensions: ["lnk", "exe", "cmd", "bat", "vbs", "url"] }],
    });
    if (!selected || typeof selected !== "string") return;
    setBusy(true);
    try {
      const resolved = await api.inspectDrop(selected);
      if (resolved.kind === "url") {
        setItem((prev) => ({
          ...prev,
          label: prev.label === "새 버튼" ? resolved.label : prev.label,
          iconPath: resolved.iconPath ?? prev.iconPath,
          action: { type: "url", url: resolved.url },
        }));
      } else if (resolved.kind === "folder") {
        setItem((prev) => ({
          ...prev,
          label: prev.label === "새 버튼" ? resolved.label : prev.label,
          iconPath: resolved.iconPath ?? prev.iconPath,
          action: { type: "folder", path: resolved.exe },
        }));
      } else {
        setItem((prev) => ({
          ...prev,
          label: prev.label === "새 버튼" ? resolved.label : prev.label,
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
    } finally {
      setBusy(false);
    }
  };

  const handleBrowseFolder = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (!selected || typeof selected !== "string") return;
    setBusy(true);
    try {
      const resolved = await api.inspectDrop(selected);
      setItem((prev) => ({
        ...prev,
        label: prev.label === "새 버튼" ? resolved.label : prev.label,
        iconPath: resolved.iconPath ?? prev.iconPath,
        action: { type: "folder", path: selected },
      }));
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
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "이미지", extensions: ["png", "jpg", "jpeg", "webp", "ico", "svg"] }],
    });
    if (!selected || typeof selected !== "string") return;
    setBusy(true);
    try {
      const rel = await api.importImage(selected, "icon");
      setItem((prev) => ({ ...prev, iconPath: rel }));
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
          <span>버튼 편집 (칸 #{slotIndex + 1})</span>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="field-row">
            <label>라벨</label>
            <div className="inline-group">
              <input
                type="text"
                value={item.label}
                onChange={(e) => setItem({ ...item, label: e.target.value })}
                placeholder="버튼 이름"
              />
              <label className="check-pill">
                <input
                  type="checkbox"
                  checked={item.showLabel}
                  onChange={(e) => setItem({ ...item, showLabel: e.target.checked })}
                />
                표시
              </label>
            </div>
          </div>

          <div className="field-row">
            <label>동작 유형</label>
            <select
              value={item.action.type}
              onChange={(e) => setActionType(e.target.value as ButtonAction["type"])}
            >
              <option value="app">앱 실행 / 창 복원</option>
              <option value="folder">폴더 열기</option>
              <option value="url">웹 URL 열기</option>
              <option value="volume">볼륨 / 마이크 음소거</option>
              <option value="media">미디어 제어 (재생/곡 넘김)</option>
              <option value="audio_device">오디오 출력 장치 전환</option>
              <option value="discord">Discord 양방향 제어 (음소거/데픈/나가기)</option>
              <option value="hotkey">키보드 단축키</option>
              <option value="multi">멀티 액션 (순차 실행)</option>
              <option value="page">페이지 이동</option>
              <option value="widget">정보 타일 (시계 / CPU·RAM / 재생 곡)</option>
            </select>
          </div>

          {item.action.type === "app" && (
            <>
              <div className="field-row">
                <label>실행 파일</label>
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
                    placeholder="C:\...\app.exe (또는 찾아보기)"
                  />
                  <button type="button" className="btn-secondary" onClick={handleBrowseApp} disabled={busy}>
                    <FolderOpen size={14} /> 찾기
                  </button>
                </div>
              </div>
              <div className="field-row two-col">
                <div>
                  <label>실행 인자</label>
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
                    placeholder='예: --profile-directory="Profile 8"'
                  />
                </div>
                <div>
                  <label>창 추적 프로세스명</label>
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
                    placeholder="예: Spotify, claude, Code"
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
                이미 맨 앞일 때 다시 누르면 최소화 토글
              </label>
            </>
          )}

          {item.action.type === "folder" && (
            <div className="field-row">
              <label>폴더 경로</label>
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
                  <FolderOpen size={14} /> 찾기
                </button>
              </div>
            </div>
          )}

          {item.action.type === "url" && (
            <div className="field-row">
              <label>URL 주소</label>
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
                  title="사이트 파비콘 아이콘 가져오기"
                >
                  <Globe size={14} /> 파비콘
                </button>
              </div>
            </div>
          )}

          {item.action.type === "volume" && (
            <div className="field-row two-col">
              <div>
                <label>대상 / 동작</label>
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
                  <option value="up">스피커 볼륨 올리기 (+)</option>
                  <option value="down">스피커 볼륨 내리기 (-)</option>
                  <option value="mute">스피커 음소거 토글</option>
                  <option value="mic_mute">마이크 음소거 토글</option>
                </select>
              </div>
              {item.action.target !== "mic" && item.action.command !== "mute" && (
                <div>
                  <label>조절 폭 (%)</label>
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
                          step: Number(e.target.value) || 5,
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
              <label>미디어 명령</label>
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
                <option value="play_pause">재생 / 일시정지</option>
                <option value="next">다음 곡</option>
                <option value="prev">이전 곡</option>
                <option value="stop">정지</option>
              </select>
            </div>
          )}

          {item.action.type === "audio_device" && (
            <div className="field-row">
              <label>오디오 출력 장치</label>
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
                <option value="">다음 출력 장치로 순환 전환 (스피커 ↔ 헤드셋)</option>
                {audioDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} {d.isDefault ? "(현재 기본)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {item.action.type === "discord" && (
            <div className="field-row">
              <label>Discord 음성 명령 (설정에서 RPC 연동 필요)</label>
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
                <option value="mute">마이크 음소거 토글</option>
                <option value="deaf">헤드셋 소리 끄기(Deafen) 토글</option>
                <option value="disconnect">음성 채널 나가기</option>
              </select>
            </div>
          )}

          {item.action.type === "hotkey" && (
            <div className="field-row">
              <label>키보드 단축키</label>
              <div className="inline-group">
                <input
                  type="text"
                  value={recordingKey ? "원하는 키 조합을 누르세요..." : hotkeyText}
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
                  {recordingKey ? "대기 중..." : "키 녹화"}
                </button>
              </div>
            </div>
          )}

          {item.action.type === "multi" && (
            <div className="field-row">
              <div className="section-title-row">
                <label>순차 실행 스텝 ({item.action.steps.length})</label>
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
                  <Plus size={13} /> 스텝 추가
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
                      <option value="app">앱</option>
                      <option value="folder">폴더</option>
                      <option value="url">URL</option>
                      <option value="media">미디어</option>
                      <option value="hotkey">단축키</option>
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
                            keys: v.split("+").map((k) => k.trim()).filter(Boolean),
                          };
                        else if (a.type === "media")
                          cur[sIdx].action = { type: "media", command: v as "play_pause" | "next" | "prev" | "stop" };
                        setItem({ ...item, action: { type: "multi", steps: cur } });
                      }}
                      placeholder="경로 / URL / 키"
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
                        cur[sIdx] = { ...cur[sIdx], delayMs: Number(e.target.value) || 0 };
                        setItem({ ...item, action: { type: "multi", steps: cur } });
                      }}
                      title="다음 스텝까지 대기(ms)"
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
              <label>이동할 페이지</label>
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
            <div className="field-row">
              <label>정보 타일 종류</label>
              <select
                value={item.action.kind}
                onChange={(e) =>
                  setItem({
                    ...item,
                    action: {
                      type: "widget",
                      kind: e.target.value as "clock" | "sys_stats" | "now_playing",
                    },
                  })
                }
              >
                <option value="clock">시계 (시간 / 날짜)</option>
                <option value="sys_stats">시스템 리소스 (CPU / RAM)</option>
                <option value="now_playing">현재 재생 중인 곡</option>
              </select>
            </div>
          )}

          <div className="divider" />

          <div className="field-row">
            <label>아이콘 이미지</label>
            <div className="inline-group">
              <button type="button" className="btn-secondary" onClick={handleBrowseIcon} disabled={busy}>
                <ImageIcon size={14} /> 이미지 선택
              </button>
              {item.iconPath && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setItem({ ...item, iconPath: null })}
                >
                  <RotateCcw size={14} /> 기본 아이콘
                </button>
              )}
              <span className="hint-text">
                {item.iconPath ? "이미지 적용됨" : "기본 벡터 아이콘"}
              </span>
            </div>
          </div>

          <div className="field-row two-col">
            <div>
              <label>코너 배지 (구분 태그)</label>
              <input
                type="text"
                maxLength={8}
                value={item.badge ?? ""}
                onChange={(e) =>
                  setItem({ ...item, badge: e.target.value ? e.target.value : null })
                }
                placeholder="예: 회사, 개인, DEV"
              />
            </div>
            <div>
              <label>상단 포인트 컬러</label>
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
                    title="포인트 컬러 제거"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="field-row two-col">
            <div>
              <label>글자 크기 (수동 모드 px)</label>
              <input
                type="number"
                min={9}
                max={28}
                value={item.fontSize}
                onChange={(e) => setItem({ ...item, fontSize: Number(e.target.value) || 13 })}
              />
            </div>
            <div>
              <label>글자 색상</label>
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
              이 버튼만 개별 배경색 / 투명도 사용
            </label>
          </div>

          {useCustomBg && (
            <div className="field-row two-col">
              <div>
                <label>버튼 배경색</label>
                <input
                  type="color"
                  value={item.bgColor || "#333333"}
                  onChange={(e) => setItem({ ...item, bgColor: e.target.value })}
                />
              </div>
              <div>
                <label>버튼 투명도 ({item.bgOpacity ?? 90}%)</label>
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
                <label>다른 페이지로 복제 / 이동</label>
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
                    <Copy size={13} /> 복제
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={transferPageIdx === currentPageIndex}
                    onClick={() => onTransferToPage(slotIndex, transferPageIdx, true)}
                  >
                    이동
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          {initialItem ? (
            <div className="inline-group">
              <button
                type="button"
                className="btn-danger"
                onClick={() => onDelete(slotIndex)}
              >
                <Trash2 size={14} /> 삭제
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onMoveToVault(slotIndex)}
                title="이 버튼을 보관함으로 옮기기"
              >
                <Archive size={14} /> 보관
              </button>
            </div>
          ) : (
            <span />
          )}
          <div className="inline-group">
            <button type="button" className="btn-secondary" onClick={onClose}>
              취소
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              저장
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
