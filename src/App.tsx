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
import type {
  ButtonItem,
  DeckConfig,
  NowPlayingInfo,
  RunningStatus,
  SystemStats,
  VolumeState,
} from "./types";

const HEADER_H = 34;
const FOOTER_H = 38;
const PAD_X = 14;
const PAD_Y = 10;

function formatClock(): { time: string; date: string } {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const week = ["일", "월", "화", "수", "목", "금", "토"][now.getDay()];
  return { time: `${hh}:${mm}`, date: `${month}/${day} (${week})` };
}

export const App: React.FC = () => {
  const [config, setConfig] = useState<DeckConfig | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dropHoverSlot, setDropHoverSlot] = useState<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [dragSwap, setDragSwap] = useState<{
    fromSlot: number;
    overSlot: number | null;
    clientX: number;
    clientY: number;
  } | null>(null);
  const [assetMap, setAssetMap] = useState<Record<string, string>>({});
  const [volumeState, setVolumeState] = useState<VolumeState | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlayingInfo | null>(null);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [runningStatus, setRunningStatus] = useState<RunningStatus | null>(null);
  const [clockText, setClockText] = useState(formatClock);
  const [toast, setToast] = useState<string | null>(null);

  const swipeRef = useRef<{ startX: number; startY: number; swiping: boolean } | null>(null);
  const suppressClickUntilRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevModalOpenRef = useRef(false);
  const userHiddenRef = useRef(false);
  const slotDragPendingRef = useRef<{
    fromSlot: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const configRef = useRef<DeckConfig | null>(null);
  configRef.current = config;
  const pageIndexRef = useRef(pageIndex);
  pageIndexRef.current = pageIndex;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2400);
  }, []);

  const reloadConfig = useCallback(async () => {
    const loaded = await api.getConfig();
    setConfig(loaded);
  }, []);

  // Initial config load
  useEffect(() => {
    reloadConfig().catch((e) => showToast(`설정 로드 오류: ${String(e)}`));
  }, [reloadConfig, showToast]);

  // Listen tray events
  useEffect(() => {
    const u1 = listen("open-settings", () => {
      userHiddenRef.current = false;
      setSettingsOpen(true);
    });
    const u2 = listen("tray-show", () => {
      userHiddenRef.current = false;
    });
    const u3 = listen("tray-hide", () => {
      userHiddenRef.current = true;
    });
    return () => {
      u1.then((fn) => fn());
      u2.then((fn) => fn());
      u3.then((fn) => fn());
    };
  }, []);

  // Poll live status (volume, running processes, SMTC, CPU/RAM, clock)
  useEffect(() => {
    const poll = () => {
      const cur = configRef.current;
      if (!cur) return;
      const page = cur.pages[pageIndexRef.current] ?? cur.pages[0];
      if (!page) return;
      const items = Object.values(page.slots);

      const procs: string[] = [];
      let needMedia = false;
      let needStats = false;
      let needVol = false;

      for (const b of items) {
        if (b.action.type === "app") {
          const pn = b.action.procName || b.action.exe.split(/[\\/]/).pop()?.replace(/\.exe$/i, "") || "";
          if (pn) procs.push(pn);
        } else if (b.action.type === "volume") {
          needVol = true;
        } else if (b.action.type === "media") {
          needMedia = true;
        } else if (b.action.type === "widget") {
          if (b.action.kind === "now_playing") needMedia = true;
          if (b.action.kind === "sys_stats") needStats = true;
        }
      }

      if (needVol) api.getVolumeState().then(setVolumeState).catch(() => {});
      if (procs.length > 0) api.getRunningStatus(procs).then(setRunningStatus).catch(() => {});
      if (needMedia) api.getNowPlaying().then(setNowPlaying).catch(() => {});
      if (needStats) api.getSystemStats().then(setSystemStats).catch(() => {});
      setClockText(formatClock());
    };

    poll();
    const timer = setInterval(poll, 2500);
    return () => clearInterval(timer);
  }, [pageIndex, config?.pages]);

  // Win+D defense when desktopLayer is enabled
  useEffect(() => {
    if (!config?.window.desktopLayer) return;
    const timer = setInterval(() => {
      if (!userHiddenRef.current) {
        api.ensureDesktopVisible().catch(() => {});
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [config?.window.desktopLayer]);

  // Toggle WS_EX_NOACTIVATE so touching buttons doesn't steal focus from active apps
  const modalOpen = settingsOpen || editingSlot !== null;
  useEffect(() => {
    if (!config) return;
    const wantNoActivate = !modalOpen && !editMode;
    api.setNoActivate(wantNoActivate).catch(() => {});
  }, [config !== null, modalOpen, editMode]);

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

  // Apply window position (with multi-monitor clamp) and alwaysOnTop once on initial load
  const initialWindowAppliedRef = useRef(false);
  useEffect(() => {
    if (!config || initialWindowAppliedRef.current) return;
    initialWindowAppliedRef.current = true;
    const win = getCurrentWindow();
    const { columns, rows, cellSize, gap } = config.grid;
    const gridW = columns * cellSize + Math.max(0, columns - 1) * gap + PAD_X * 2;
    const gridH = rows * cellSize + Math.max(0, rows - 1) * gap + HEADER_H + FOOTER_H + PAD_Y * 2;
    if (config.window.x !== null && config.window.y !== null) {
      api
        .clampWindowPos(config.window.x, config.window.y, gridW, gridH)
        .then(([cx, cy]) => win.setPosition(new PhysicalPosition(cx, cy)))
        .catch(() => {});
    }
    win.setAlwaysOnTop(config.window.alwaysOnTop).catch(() => {});
  }, [config]);

  // Sync window size dynamically with grid size.
  // Never resize while settings/editor modal is open so sliders do not jitter under the cursor.
  const gridCols = config?.grid.columns;
  const gridRows = config?.grid.rows;
  const gridCellSize = config?.grid.cellSize;
  const gridGap = config?.grid.gap;

  useEffect(() => {
    if (
      gridCols === undefined ||
      gridRows === undefined ||
      gridCellSize === undefined ||
      gridGap === undefined
    ) {
      return;
    }
    const wasOpen = prevModalOpenRef.current;
    prevModalOpenRef.current = modalOpen;

    if (modalOpen && wasOpen) {
      return;
    }

    const gridW = gridCols * gridCellSize + Math.max(0, gridCols - 1) * gridGap + PAD_X * 2;
    const gridH =
      gridRows * gridCellSize + Math.max(0, gridRows - 1) * gridGap + HEADER_H + FOOTER_H + PAD_Y * 2;
    const w = modalOpen ? Math.max(gridW, 600) : gridW;
    const h = modalOpen ? Math.max(gridH, 680) : gridH;
    getCurrentWindow().setSize(new LogicalSize(w, h)).catch(() => {});
  }, [gridCols, gridRows, gridCellSize, gridGap, modalOpen]);

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

  const persistConfig = useCallback(
    (next: DeckConfig) => {
      setConfig(next);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        api.saveConfig(next).catch((e) => showToast(`저장 실패: ${String(e)}`));
      }, 220);
    },
    [showToast]
  );

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
                const curStyle = cur.theme.buttonStyle ?? "solid";
                persistConfig({
                  ...cur,
                  theme: {
                    ...cur.theme,
                    backgroundType: "image",
                    backgroundImage: rel,
                    buttonStyle: curStyle === "solid" ? "glass" : curStyle,
                    backgroundBlur: cur.theme.backgroundBlur === 8 ? 2 : cur.theme.backgroundBlur,
                    backgroundDim: cur.theme.backgroundDim === 35 ? 20 : cur.theme.backgroundDim,
                  },
                });
                showToast("배경 이미지 테마가 적용되었습니다.");
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
              badge: null,
              accentColor: null,
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
                      toggleMinimize: false,
                    },
            };
            nextSlots[String(targetSlot)] = newBtn;
            showToast(`등록됨: ${newBtn.label}`);
            targetSlot = null;
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
    if (Date.now() < suppressClickUntilRef.current) return;
    if (item.action.type === "page") {
      if (config && item.action.pageIndex >= 0 && item.action.pageIndex < config.pages.length) {
        setPageIndex(item.action.pageIndex);
      }
      return;
    }
    if (item.action.type === "widget") {
      return;
    }
    try {
      const res = await api.executeAction(item.action);
      if (res.volume) {
        setVolumeState(res.volume);
      }
      if (res.message) {
        showToast(res.message);
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

  const handleTransferToPage = (slotIdx: number, targetPageIdx: number, move: boolean) => {
    if (!config || !currentPage || targetPageIdx === pageIndex) return;
    const srcItem = currentPage.slots[String(slotIdx)];
    const targetPage = config.pages[targetPageIdx];
    if (!srcItem || !targetPage) return;

    const totalSlots = config.grid.columns * config.grid.rows;
    let freeSlot: number | null = null;
    for (let i = 0; i < totalSlots; i++) {
      if (!targetPage.slots[String(i)]) {
        freeSlot = i;
        break;
      }
    }
    if (freeSlot === null) {
      showToast(`"${targetPage.name}" 페이지에 빈 칸이 없습니다.`);
      return;
    }

    const copied: ButtonItem = {
      ...structuredClone(srcItem),
      id: move ? srcItem.id : `btn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    };

    const nextPages = config.pages.map((p, idx) => {
      if (idx === targetPageIdx) {
        return { ...p, slots: { ...p.slots, [String(freeSlot)]: copied } };
      }
      if (move && idx === pageIndex) {
        const nextSlots = { ...p.slots };
        delete nextSlots[String(slotIdx)];
        return { ...p, slots: nextSlots };
      }
      return p;
    });

    persistConfig({ ...config, pages: nextPages });
    setEditingSlot(null);
    showToast(`${targetPage.name} 페이지로 ${move ? "이동" : "복제"}되었습니다.`);
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
      if (p) {
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
        return;
      }

      const s = swipeRef.current;
      if (s) {
        const dx = e.clientX - s.startX;
        const dy = e.clientY - s.startY;
        if (!s.swiping && Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.15) {
          s.swiping = true;
        }
        if (s.swiping) {
          setSwipeOffset(Math.max(-90, Math.min(90, dx * 0.45)));
        }
      }
    };

    const onUp = (e: PointerEvent) => {
      const p = slotDragPendingRef.current;
      if (p) {
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
        return;
      }

      const s = swipeRef.current;
      if (s) {
        swipeRef.current = null;
        const dx = e.clientX - s.startX;
        setSwipeOffset(0);
        if (s.swiping && Math.abs(dx) >= 42) {
          suppressClickUntilRef.current = Date.now() + 260;
          const total = configRef.current?.pages.length ?? 1;
          const curIdx = pageIndexRef.current;
          if (dx < 0 && curIdx < total - 1) {
            setPageIndex(curIdx + 1);
          } else if (dx > 0 && curIdx > 0) {
            setPageIndex(curIdx - 1);
          }
        }
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
    if (theme.backgroundType === "image" && theme.backgroundImage) {
      return { backgroundColor: "transparent" };
    }
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

  const runningSet = new Set(
    (runningStatus?.running ?? []).map((s) => s.toLowerCase().replace(/\.exe$/i, ""))
  );
  const fgProc = (runningStatus?.foregroundProc ?? "").toLowerCase();

  return (
    <div
      className="deck-shell"
      style={{
        fontFamily: `"${config.theme.fontFamily}", "Pretendard", "Segoe UI", sans-serif`,
        ...panelBgStyle,
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
          onPointerDown={() => {
            if (!config.window.locked) {
              api.setNoActivate(false).catch(() => {});
              setTimeout(() => {
                if (!modalOpen && !editMode) {
                  api.setNoActivate(true).catch(() => {});
                }
              }, 1500);
            }
          }}
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
            onClick={() => {
              userHiddenRef.current = true;
              getCurrentWindow().hide();
            }}
            title="트레이로 숨기기"
          >
            <Minus size={14} />
          </button>
        </div>
      </header>

      {/* Grid */}
      <main
        className={`deck-grid ${swipeOffset === 0 ? "deck-grid-snap" : ""}`}
        style={{
          gridTemplateColumns: `repeat(${config.grid.columns}, ${config.grid.cellSize}px)`,
          gridTemplateRows: `repeat(${config.grid.rows}, ${config.grid.cellSize}px)`,
          gap: config.grid.gap,
          padding: `${PAD_Y}px ${PAD_X}px`,
          touchAction: editMode ? "none" : "pan-y",
          transform: swipeOffset !== 0 ? `translateX(${swipeOffset}px)` : undefined,
        }}
        onPointerDown={(e) => {
          if (editMode || e.button !== 0 || modalOpen) return;
          swipeRef.current = { startX: e.clientX, startY: e.clientY, swiping: false };
        }}
      >
        {Array.from({ length: totalSlots }, (_, idx) => {
          const item = currentPage.slots[String(idx)];
          const resolvedIcon = item?.iconPath ? assetMap[item.iconPath] : undefined;
          let procKey = "";
          if (item?.action.type === "app") {
            procKey = (
              item.action.procName ||
              item.action.exe.split(/[\\/]/).pop()?.replace(/\.exe$/i, "") ||
              ""
            ).toLowerCase();
          }
          const isRunning = procKey !== "" && runningSet.has(procKey);
          const isForeground = procKey !== "" && fgProc === procKey;

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
              locked={config.window.locked}
              isDropHover={dropHoverSlot === idx || (dragSwap !== null && dragSwap.overSlot === idx)}
              isDraggingSource={dragSwap !== null && dragSwap.fromSlot === idx}
              isRunning={isRunning}
              isForeground={isForeground}
              volumeState={volumeState}
              nowPlaying={nowPlaying}
              systemStats={systemStats}
              clockText={clockText}
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
          currentPageIndex={pageIndex}
          initialItem={currentPage.slots[String(editingSlot)]}
          pages={config.pages}
          onSave={handleSaveSlot}
          onDelete={handleDeleteSlot}
          onTransferToPage={handleTransferToPage}
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
