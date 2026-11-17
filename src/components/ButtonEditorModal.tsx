import React, { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Image as ImageIcon, RotateCcw, Trash2, X } from "lucide-react";
import { api } from "../api";
import type { ButtonAction, ButtonItem, DeckPage } from "../types";

interface Props {
  slotIndex: number;
  initialItem?: ButtonItem;
  pages: DeckPage[];
  onSave: (slotIndex: number, item: ButtonItem) => void;
  onDelete: (slotIndex: number) => void;
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
  action: {
    type: "app",
    exe: "",
    args: "",
    workDir: "",
    procName: "",
  },
});

export const ButtonEditorModal: React.FC<Props> = ({
  slotIndex,
  initialItem,
  pages,
  onSave,
  onDelete,
  onClose,
}) => {
  const [item, setItem] = useState<ButtonItem>(() =>
    initialItem ? structuredClone(initialItem) : DEFAULT_NEW_ITEM()
  );
  const [busy, setBusy] = useState(false);
  const [hotkeyText, setHotkeyText] = useState(() =>
    initialItem?.action.type === "hotkey" ? initialItem.action.keys.join(" + ") : "Ctrl + Shift + M"
  );

  const setActionType = (type: ButtonAction["type"]) => {
    switch (type) {
      case "app":
        setItem({
          ...item,
          action: { type: "app", exe: "", args: "", workDir: "", procName: "" },
        });
        break;
      case "folder":
        setItem({ ...item, action: { type: "folder", path: "" } });
        break;
      case "url":
        setItem({ ...item, action: { type: "url", url: "https://" } });
        break;
      case "volume":
        setItem({ ...item, action: { type: "volume", command: "up", step: 5 } });
        break;
      case "media":
        setItem({ ...item, action: { type: "media", command: "play_pause" } });
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
      case "page":
        setItem({ ...item, action: { type: "page", pageIndex: 0 } });
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
              <option value="volume">시스템 볼륨 / 음소거</option>
              <option value="media">미디어 제어 (재생/곡 넘김)</option>
              <option value="hotkey">키보드 단축키</option>
              <option value="page">페이지 이동</option>
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
                        action: { ...(item.action as Extract<ButtonAction, { type: "app" }>), args: e.target.value },
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
                        action: { ...(item.action as Extract<ButtonAction, { type: "app" }>), procName: e.target.value },
                      })
                    }
                    placeholder="예: Spotify, claude, Code"
                  />
                </div>
              </div>
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
              <input
                type="text"
                value={item.action.url}
                onChange={(e) =>
                  setItem({ ...item, action: { type: "url", url: e.target.value } })
                }
                placeholder="https://..."
              />
            </div>
          )}

          {item.action.type === "volume" && (
            <div className="field-row two-col">
              <div>
                <label>볼륨 동작</label>
                <select
                  value={item.action.command}
                  onChange={(e) =>
                    setItem({
                      ...item,
                      action: {
                        type: "volume",
                        command: e.target.value as "up" | "down" | "mute",
                        step: (item.action as Extract<ButtonAction, { type: "volume" }>).step || 5,
                      },
                    })
                  }
                >
                  <option value="up">볼륨 올리기 (+)</option>
                  <option value="down">볼륨 내리기 (-)</option>
                  <option value="mute">음소거 토글</option>
                </select>
              </div>
              {item.action.command !== "mute" && (
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

          {item.action.type === "hotkey" && (
            <div className="field-row">
              <label>키 조합 (+ 구분)</label>
              <input
                type="text"
                value={hotkeyText}
                onChange={(e) => setHotkeyText(e.target.value)}
                placeholder="Ctrl + Shift + M"
              />
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
                {item.iconPath ? "사용자/추출 이미지 적용됨" : "기본 벡터 아이콘"}
              </span>
            </div>
          </div>

          <div className="field-row two-col">
            <div>
              <label>글자 크기 (px)</label>
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
        </div>

        <div className="modal-footer">
          {initialItem ? (
            <button
              type="button"
              className="btn-danger"
              onClick={() => onDelete(slotIndex)}
            >
              <Trash2 size={14} /> 삭제
            </button>
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
