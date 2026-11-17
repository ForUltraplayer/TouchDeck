import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ChevronLeft,
  ChevronRight,
  Lock,
  Minus,
  Pencil,
  Settings,
  Unlock,
} from "lucide-react";
import { api, assetUrl, hexToRgba } from "./api";
import { ButtonEditorModal } from "./components/ButtonEditorModal";
import { ButtonTile } from "./components/ButtonTile";
import { SettingsDrawer } from "./components/SettingsDrawer";
import type { ButtonItem, DeckConfig, VolumeState } from "./types";

const HEADER_H = 34;
const FOOTER_H = 38;
const PAD_X = 14;
const PAD_Y = 10;

export const App: React.FC = () => {
  const [config, setConfig] = useState<DeckConfig | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dropHoverSlot, setDropHoverSlot] = useState<number | null>(null);
  const [dragSwap, setDragSwap] = useState<{
    fromSlot: number;
    overSlot: number | null;
    clientX: number;
    clientY: number;
  } | null>(null);
  const [assetMap, setAssetMap] = useState<Record<string, string>>({});
  const [volumeState, setVolumeState] = useState<VolumeState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const slotDragPendingRef = useRef<{
    fromSlot: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const configRef = useRef<DeckConfig | null>(null);
  configRef.current = config;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2400);
  }, []);

  const reloadConfig = useCallback(async () => {
    const loaded = await api.getConfig();
    setConfig(loaded);
  }, []);

  // Load initial config and volume state
  useEffect(() => {
    reloadConfig().catch((e) => showToast(`설정 로드 오류: ${String(e)}`));
    api.getVolumeState().then(setVolumeState).catch(() => {});
    const timer = setInterval(() => {
      api.getVolumeState().then(setVolumeState).catch(() => {});
    }, 3500);
    return () => clearInterval(timer);
  }, [reloadConfig, showToast]);

  // Listen tray "open-settings" event
  useEffect(() => {
    const unlisten = listen("open-settings", () => {
      setSettingsOpen(true);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Resolve relative asset paths -> absolute paths for convertFileSrc
  useEffect(() => {
    if (!config) return;
    const rels = new Set<string>();
    if (config.theme.backgroundImage) rels.add(config.theme.backgroundImage);
    for (const p of config.pages) {
      for (const b of Object.values(p.slots)) {
        if (b.iconPath) rels.add(b.iconPath);
      }
    }
    const missing = Array.from(rels).filter((r) => !(r in assetMap));
    if (missing.length === 0) return;

    Promise.all(
      missing.map(async (rel) => {
        try {
          const abs = await api.resolveAsset(rel);
          return [rel, abs] as const;
        } catch {
          return [rel, ""] as const;
        }
      })
    ).then((pairs) => {
      setAssetMap((prev) => {
        const next = { ...prev };
        for (const [k, v] of pairs) {
          if (v) next[k] = v;
        }
        return next;
      });
    });
  }, [config, assetMap]);

  // Apply window position and alwaysOnTop once on initial load
  const initialWindowAppliedRef = useRef(false);
  useEffect(() => {
    if (!config || initialWindowAppliedRef.current) return;
    initialWindowAppliedRef.current = true;
    const win = getCurrentWindow();
    if (config.window.x !== null && config.window.y !== null) {
      win.setPosition(new PhysicalPosition(config.window.x, config.window.y)).catch(() => {});
    }
    win.setAlwaysOnTop(config.window.alwaysOnTop).catch(() => {});
  }, [config]);

  // Sync window size dynamically with grid size (and expand temporarily when modals open)
  useEffect(() => {
    if (!config) return;
    const { columns, rows, cellSize, gap } = config.grid;
    const gridW = columns * cellSize + Math.max(0, columns - 1) * gap + PAD_X * 2;
    const gridH =
      rows * cellSize + Math.max(0, rows - 1) * gap + HEADER_H + FOOTER_H + PAD_Y * 2;
    const needModalSpace = settingsOpen || editingSlot !== null;
    const w = needModalSpace ? Math.max(gridW, 560) : gridW;
    const h = needModalSpace ? Math.max(gridH, 640) : gridH;
    getCurrentWindow().setSize(new LogicalSize(w, h)).catch(() => {});
  }, [config?.grid, settingsOpen, editingSlot]);

  // Sync alwaysOnTop changes
  useEffect(() => {
    if (!config) return;
    getCurrentWindow().setAlwaysOnTop(config.window.alwaysOnTop).catch(() => {});
  }, [config?.window.alwaysOnTop]);

  // Save window position when moved
  useEffect(() => {
    const win = getCurrentWindow();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unlistenPromise = win.onMoved(({ payload }) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const cur = configRef.current;
        if (!cur) return;
        const next: DeckConfig = {
          ...cur,
          window: { ...cur.window, x: payload.x, y: payload.y },
        };
        setConfig(next);
        api.saveConfig(next).catch(() => {});
      }, 400);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  const persistConfig = useCallback((next: DeckConfig) => {
    setConfig(next);
    api.saveConfig(next).catch((e) => showToast(`저장 실패: ${String(e)}`));
  }, [showToast]);

  // Find slot index under CSS client position
  const findSlotAtClientPos = useCallback((cx: number, cy: number): number | null => {
    const tiles = document.querySelectorAll<HTMLElement>("[data-slot-index]");
    for (const el of tiles) {
      const rect = el.getBoundingClientRect();
      if (cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom) {
        const idx = Number(el.dataset.slotIndex);
        if (!Number.isNaN(idx)) return idx;
      }
    }
    return null;
  }, []);

  // Find slot index under physical position from Tauri drag-drop
  const findSlotAtPhysicalPos = useCallback(
    (physX: number, physY: number): number | null => {
      const dpr = window.devicePixelRatio || 1;
      return findSlotAtClientPos(physX / dpr, physY / dpr);
    },
    [findSlotAtClientPos]
  );

  // Tauri native drag-and-drop (.lnk, .exe, folder, .url, image)
  useEffect(() => {
    const webview = getCurrentWebview();
    const unlistenPromise = webview.onDragDropEvent(async (event) => {
      const payload = event.payload;
      if (payload.type === "leave") {
        setDropHoverSlot(null);
        return;
      }
      if (payload.type === "over" || payload.type === "enter") {
        const slot = findSlotAtPhysicalPos(payload.position.x, payload.position.y);
        setDropHoverSlot(slot);
        return;
      }
      if (payload.type === "drop") {
        setDropHoverSlot(null);
        const cur = configRef.current;
        if (!cur) return;
        if (cur.window.locked) {
          showToast("잠금 상태입니다. 잠금을 해제한 뒤 드롭하세요.");
          return;
        }

        const totalSlots = cur.grid.columns * cur.grid.rows;
        let targetSlot = findSlotAtPhysicalPos(payload.position.x, payload.position.y);
        const curPage = cur.pages[pageIndex];
        if (!curPage) return;

        const nextSlots = { ...curPage.slots };
        for (const droppedPath of payload.paths) {
          try {
            const resolved = await api.inspectDrop(droppedPath);
            if (resolved.kind === "image") {
              if (targetSlot !== null && nextSlots[String(targetSlot)]) {
                const rel = await api.importImage(droppedPath, "icon");
                nextSlots[String(targetSlot)] = {
                  ...nextSlots[String(targetSlot)],
                  iconPath: rel,
                };
                showToast(`아이콘 이미지 변경: ${nextSlots[String(targetSlot)].label}`);
              } else {
                const rel = await api.importImage(droppedPath, "bg");
                persistConfig({
                  ...cur,
                  theme: { ...cur.theme, backgroundType: "image", backgroundImage: rel },
                });
                showToast("패널 배경 이미지가 적용되었습니다.");
                return;
              }
              continue;
            }

            if (targetSlot === null) {
              for (let i = 0; i < totalSlots; i++) {
                if (!nextSlots[String(i)]) {
                  targetSlot = i;
                  break;
                }
              }
            }
            if (targetSlot === null) {
              showToast("현재 페이지에 빈 칸이 없습니다.");
              break;
            }

            const newBtn: ButtonItem = {
              id: `btn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              label: resolved.label,
              showLabel: true,
              fontSize: 13,
              textColor: "#FFFFFF",
              bgColor: null,
              bgOpacity: null,
              iconPath: resolved.iconPath,
              action:
                resolved.kind === "folder"
                  ? { type: "folder", path: resolved.exe }
                  : resolved.kind === "url"
                  ? { type: "url", url: resolved.url }
                  : {
                      type: "app",
                      exe: resolved.exe,
                      args: resolved.args,
                      workDir: resolved.workDir,
                      procName: resolved.procName,
                    },
            };
            nextSlots[String(targetSlot)] = newBtn;
            showToast(`등록됨: ${newBtn.label}`);
            targetSlot = null; // next file picks next empty slot
          } catch (e) {
            showToast(`등록 실패: ${String(e)}`);
          }
        }

        const nextPages = cur.pages.map((p, idx) =>
          idx === pageIndex ? { ...p, slots: nextSlots } : p
        );
        persistConfig({ ...cur, pages: nextPages });
      }
    });

    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [findSlotAtPhysicalPos, pageIndex, persistConfig, showToast]);

  const currentPage = config?.pages[pageIndex] ?? config?.pages[0];

  const handleExecute = async (item: ButtonItem) => {
    if (item.action.type === "page") {
      if (config && item.action.pageIndex >= 0 && item.action.pageIndex < config.pages.length) {
        setPageIndex(item.action.pageIndex);
      }
      return;
    }
    try {
      const res = await api.executeAction(item.action);
      if (res.volume) {
        setVolumeState(res.volume);
      }
    } catch (e) {
      showToast(`실행 오류: ${String(e)}`);
    }
  };

  const handleSaveSlot = (slotIdx: number, item: ButtonItem) => {
    if (!config || !currentPage) return;
    const nextSlots = { ...currentPage.slots, [String(slotIdx)]: item };
    const nextPages = config.pages.map((p, idx) =>
      idx === pageIndex ? { ...p, slots: nextSlots } : p
    );
    persistConfig({ ...config, pages: nextPages });
    setEditingSlot(null);
  };

  const handleDeleteSlot = (slotIdx: number) => {
    if (!config || !currentPage) return;
    const nextSlots = { ...currentPage.slots };
    delete nextSlots[String(slotIdx)];
    const nextPages = config.pages.map((p, idx) =>
      idx === pageIndex ? { ...p, slots: nextSlots } : p
    );
    persistConfig({ ...config, pages: nextPages });
    setEditingSlot(null);
  };

  const handleSwapSlot = (fromSlot: number, toSlot: number) => {
    if (!config || !currentPage || fromSlot === toSlot) return;
    const nextSlots = { ...currentPage.slots };
    const fromItem = nextSlots[String(fromSlot)];
    const toItem = nextSlots[String(toSlot)];
    if (fromItem) nextSlots[String(toSlot)] = fromItem;
    else delete nextSlots[String(toSlot)];
    if (toItem) nextSlots[String(fromSlot)] = toItem;
    else delete nextSlots[String(fromSlot)];

    const nextPages = config.pages.map((p, idx) =>
      idx === pageIndex ? { ...p, slots: nextSlots } : p
    );
    persistConfig({ ...config, pages: nextPages });
  };

  const handleSwapSlotRef = useRef(handleSwapSlot);
  handleSwapSlotRef.current = handleSwapSlot;

  const handleStartSlotDrag = useCallback((slotIdx: number, e: React.PointerEvent) => {
    slotDragPendingRef.current = {
      fromSlot: slotIdx,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = slotDragPendingRef.current;
      if (!p) return;
      const dist = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
      if (!p.active && dist >= 8) {
        p.active = true;
      }
      if (p.active) {
        const overSlot = findSlotAtClientPos(e.clientX, e.clientY);
        setDragSwap({
          fromSlot: p.fromSlot,
          overSlot,
          clientX: e.clientX,
          clientY: e.clientY,
        });
      }
    };

    const onUp = (e: PointerEvent) => {
      const p = slotDragPendingRef.current;
      if (!p) return;
      slotDragPendingRef.current = null;
      setDragSwap(null);

      if (p.active) {
        const overSlot = findSlotAtClientPos(e.clientX, e.clientY);
        if (overSlot !== null && overSlot !== p.fromSlot) {
          handleSwapSlotRef.current(p.fromSlot, overSlot);
        }
      } else {
        setEditingSlot(p.fromSlot);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [findSlotAtClientPos]);

  const panelBgStyle = useMemo<React.CSSProperties>(() => {
    if (!config) return {};
    const { theme } = config;
    if (theme.backgroundType === "gradient") {
      return {
        background: `linear-gradient(155deg, ${hexToRgba(
          theme.backgroundColor,
          theme.backgroundOpacity
        )}, ${hexToRgba(theme.gradientEndColor, theme.backgroundOpacity)})`,
      };
    }
    return {
      backgroundColor: hexToRgba(theme.backgroundColor, theme.backgroundOpacity),
    };
  }, [config]);

  if (!config || !currentPage) {
    return <div className="loading-shell">TouchDeck 불러오는 중...</div>;
  }

  const totalSlots = config.grid.columns * config.grid.rows;
  const bgImgUrl =
    config.theme.backgroundType === "image" && config.theme.backgroundImage
      ? assetUrl(assetMap[config.theme.backgroundImage])
      : null;

  return (
    <div
      className="deck-shell"
      style={{
        fontFamily: `"${config.theme.fontFamily}", "Pretendard", "Segoe UI", sans-serif`,
        ...panelBgStyle,
      }}
      onPointerDown={(e) => {
        if (editMode) return;
        swipeStartRef.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        if (editMode || !swipeStartRef.current) return;
        const dx = e.clientX - swipeStartRef.current.x;
        const dy = e.clientY - swipeStartRef.current.y;
        swipeStartRef.current = null;
        if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          if (dx < 0 && pageIndex < config.pages.length - 1) {
            setPageIndex((i) => i + 1);
          } else if (dx > 0 && pageIndex > 0) {
            setPageIndex((i) => i - 1);
          }
        }
      }}
    >
      {bgImgUrl && (
        <>
          <div
            className="deck-bg-image"
            style={{
              backgroundImage: `url("${bgImgUrl}")`,
              filter: `blur(${config.theme.backgroundBlur}px)`,
              opacity: config.theme.backgroundOpacity / 100,
            }}
          />
          <div
            className="deck-bg-dim"
            style={{
              backgroundColor: `rgba(0, 0, 0, ${config.theme.backgroundDim / 100})`,
            }}
          />
        </>
      )}

      {/* Top slim bar */}
      <header className={`deck-header ${config.window.locked ? "deck-header-locked" : ""}`}>
        <div
          className="drag-handle"
          data-tauri-drag-region={!config.window.locked ? true : undefined}
        >
          <span className="brand-dot" />
          <span className="brand-title">{currentPage.name}</span>
          {editMode && <span className="edit-pill">편집 중</span>}
        </div>

        <div className="header-actions">
          {!config.window.locked && (
            <button
              type="button"
              className={`hdr-btn ${editMode ? "hdr-btn-active" : ""}`}
              onClick={() => setEditMode((v) => !v)}
              title="편집 모드 (버튼 추가/드래그 이동)"
            >
              <Pencil size={14} />
            </button>
          )}
          <button
            type="button"
            className={`hdr-btn ${config.window.locked ? "hdr-btn-active" : ""}`}
            onClick={() => {
              const nextLocked = !config.window.locked;
              if (nextLocked) setEditMode(false);
              persistConfig({
                ...config,
                window: { ...config.window, locked: nextLocked },
              });
            }}
            title={config.window.locked ? "잠금 해제" : "위치/편집 잠금"}
          >
            {config.window.locked ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
          <button
            type="button"
            className="hdr-btn"
            onClick={() => setSettingsOpen(true)}
            title="설정 및 테마"
          >
            <Settings size={14} />
          </button>
          <button
            type="button"
            className="hdr-btn"
            onClick={() => getCurrentWindow().hide()}
            title="트레이로 숨기기"
          >
            <Minus size={14} />
          </button>
        </div>
      </header>

      {/* Grid */}
      <main
        className="deck-grid"
        style={{
          gridTemplateColumns: `repeat(${config.grid.columns}, ${config.grid.cellSize}px)`,
          gridTemplateRows: `repeat(${config.grid.rows}, ${config.grid.cellSize}px)`,
          gap: config.grid.gap,
          padding: `${PAD_Y}px ${PAD_X}px`,
        }}
      >
        {Array.from({ length: totalSlots }, (_, idx) => {
          const item = currentPage.slots[String(idx)];
          const resolvedIcon = item?.iconPath ? assetMap[item.iconPath] : undefined;
          return (
            <ButtonTile
              key={idx}
              slotIndex={idx}
              item={item}
              resolvedIconAbsPath={resolvedIcon}
              theme={config.theme}
              cellSize={config.grid.cellSize}
              borderRadius={config.grid.borderRadius}
              editMode={editMode}
              isDropHover={dropHoverSlot === idx || (dragSwap !== null && dragSwap.overSlot === idx)}
              isDraggingSource={dragSwap !== null && dragSwap.fromSlot === idx}
              volumeState={volumeState}
              onExecute={handleExecute}
              onEdit={(s) => setEditingSlot(s)}
              onStartSlotDrag={handleStartSlotDrag}
            />
          );
        })}
      </main>

      {/* Page Switcher Footer */}
      <footer className="deck-footer">
        <button
          type="button"
          className="page-arrow"
          disabled={pageIndex <= 0}
          onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
          title="이전 페이지"
        >
          <ChevronLeft size={16} />
        </button>

        <div className="page-dots">
          {config.pages.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              className={`page-tab ${idx === pageIndex ? "page-tab-active" : ""}`}
              onClick={() => setPageIndex(idx)}
            >
              {p.name}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="page-arrow"
          disabled={pageIndex >= config.pages.length - 1}
          onClick={() => setPageIndex((i) => Math.min(config.pages.length - 1, i + 1))}
          title="다음 페이지"
        >
          <ChevronRight size={16} />
        </button>
      </footer>

      {toast && <div className="toast-pill">{toast}</div>}

      {dragSwap && currentPage.slots[String(dragSwap.fromSlot)] && (
        <div
          className="drag-ghost"
          style={{
            left: dragSwap.clientX,
            top: dragSwap.clientY,
          }}
        >
          {currentPage.slots[String(dragSwap.fromSlot)].label}
        </div>
      )}

      {editingSlot !== null && (
        <ButtonEditorModal
          slotIndex={editingSlot}
          initialItem={currentPage.slots[String(editingSlot)]}
          pages={config.pages}
          onSave={handleSaveSlot}
          onDelete={handleDeleteSlot}
          onClose={() => setEditingSlot(null)}
        />
      )}

      {settingsOpen && (
        <SettingsDrawer
          config={config}
          currentPageIndex={pageIndex}
          onChange={persistConfig}
          onSwitchPage={setPageIndex}
          onReloadFromDisk={reloadConfig}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
};

export default App;
