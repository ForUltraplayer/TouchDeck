import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Lock,
  Minus,
  Package,
  Pencil,
  Play,
  Settings,
  Trash2,
  Unlock,
} from "lucide-react";
import { api, assetUrl, hexToRgba } from "./api";
import { ButtonDock } from "./components/ButtonDock";
import { ButtonEditorModal } from "./components/ButtonEditorModal";
import { ButtonTile } from "./components/ButtonTile";
import { SettingsDrawer } from "./components/SettingsDrawer";
import type {
  ButtonItem,
  DeckConfig,
  DiscordConfig,
  DiscordState,
  NowPlayingInfo,
  RunningStatus,
  SystemStats,
  UpdateInfo,
  VolumeState,
} from "./types";

const HEADER_H = 34;
const FOOTER_H = 38;
const PAD_X = 14;
const PAD_Y = 10;
const DOCK_W = 256;

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
  const [dockOpen, setDockOpen] = useState(false);
  const [dockMounted, setDockMounted] = useState(false);
  const [dockExpanded, setDockExpanded] = useState(false);
  const [dockOnLeft, setDockOnLeft] = useState(false);
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ slotIndex: number; x: number; y: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [closingModal, setClosingModal] = useState<
    { kind: "settings" } | { kind: "editor"; slot: number } | null
  >(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [shellRect, setShellRect] = useState<{
    width: number;
    height: number;
    tx: number;
    ty: number;
    animate: boolean;
  } | null>(null);
  const [dropHoverSlot, setDropHoverSlot] = useState<number | null>(null);
  const [vaultHover, setVaultHover] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [dragSwap, setDragSwap] = useState<{
    fromSlot: number | null;
    label: string;
    overSlot: number | null;
    clientX: number;
    clientY: number;
  } | null>(null);
  const [assetMap, setAssetMap] = useState<Record<string, string>>({});
  const [volumeState, setVolumeState] = useState<VolumeState | null>(null);
  const [discordState, setDiscordState] = useState<DiscordState | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlayingInfo | null>(null);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [runningStatus, setRunningStatus] = useState<RunningStatus | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [clockText, setClockText] = useState(formatClock);
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const swipeRef = useRef<{ startX: number; startY: number; swiping: boolean } | null>(null);
  const suppressClickUntilRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragNoActivateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animSeqRef = useRef(0);
  const prevLayoutRef = useRef<{
    dockOpen: boolean;
    modalOpen: boolean;
    gridW: number;
    gridH: number;
    winW: number;
    winH: number;
  } | null>(null);
  const activeModalRef = useRef<{ kind: "settings" } | { kind: "editor"; slot: number } | null>(null);
  const userHiddenRef = useRef(false);
  const homePosRef = useRef<{ x: number; y: number } | null>(null);
  const lastWinPosRef = useRef<{ x: number; y: number } | null>(null);
  const programmaticMoveUntilRef = useRef(0);
  const activeDockPhysWRef = useRef(0);
  const statsInFlightRef = useRef(false);
  const wantNoActivateRef = useRef(true);
  const modalOpenRef = useRef(false);
  const shellRectRef = useRef(shellRect);
  shellRectRef.current = shellRect;
  const slotDragPendingRef = useRef<{
    fromSlot: number;
    label: string;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const dockDragPendingRef = useRef<{
    item: ButtonItem;
    removeVaultId: string | null;
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
    setLoadError(null);
    homePosRef.current =
      loaded.window.x !== null && loaded.window.y !== null
        ? { x: loaded.window.x, y: loaded.window.y }
        : null;
    setConfig(loaded);
  }, []);

  // Initial config and Discord state load
  useEffect(() => {
    reloadConfig().catch((e) => {
      const msg = `설정 로드 오류: ${String(e)}`;
      setLoadError(msg);
      showToast(msg);
    });
    api.getDiscordState().then(setDiscordState).catch(() => {});
  }, [reloadConfig, showToast]);

  // Auto-check GitHub releases once on startup
  const checkedUpdateRef = useRef(false);
  useEffect(() => {
    if (!config || checkedUpdateRef.current) return;
    checkedUpdateRef.current = true;
    if (config.autoCheckUpdate === false) return;
    const timer = setTimeout(() => {
      api
        .checkUpdate()
        .then((info) => {
          setUpdateInfo(info);
        })
        .catch(() => {});
    }, 3500);
    return () => clearTimeout(timer);
  }, [config]);

  // Listen tray and Discord push events
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
    const u4 = listen<DiscordState>("discord-state", (e) => {
      setDiscordState(e.payload);
    });
    const u5 = listen<DiscordConfig>("discord-config-updated", (e) => {
      setConfig((prev) => (prev ? { ...prev, discord: e.payload } : prev));
    });
    return () => {
      u1.then((fn) => fn());
      u2.then((fn) => fn());
      u3.then((fn) => fn());
      u4.then((fn) => fn());
      u5.then((fn) => fn());
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
      let needTemp = false;
      let needVol = false;

      for (const b of items) {
        if (b.action.type === "app") {
          const pn =
            b.action.procName || b.action.exe.split(/[\\/]/).pop()?.replace(/\.exe$/i, "") || "";
          if (pn) procs.push(pn);
        } else if (b.action.type === "volume") {
          needVol = true;
        } else if (b.action.type === "media") {
          needMedia = true;
        } else if (b.action.type === "widget") {
          if (b.action.kind === "now_playing") needMedia = true;
          if (b.action.kind === "sys_stats") {
            needStats = true;
            if (b.action.metrics?.includes("cpu_temp")) needTemp = true;
          }
        }
      }

      const uniqProcs = procs.length > 1 ? Array.from(new Set(procs)) : procs;

      if (needVol) {
        api
          .getVolumeState()
          .then((next) =>
            setVolumeState((prev) =>
              prev &&
              prev.level === next.level &&
              prev.muted === next.muted &&
              prev.micMuted === next.micMuted
                ? prev
                : next
            )
          )
          .catch(() => {});
      }
      if (uniqProcs.length > 0) {
        api
          .getRunningStatus(uniqProcs)
          .then((next) =>
            setRunningStatus((prev) =>
              prev &&
              prev.foregroundProc === next.foregroundProc &&
              prev.running.length === next.running.length &&
              prev.running.every((v, i) => v === next.running[i])
                ? prev
                : next
            )
          )
          .catch(() => {});
      }
      if (needMedia) {
        api
          .getNowPlaying()
          .then((next) =>
            setNowPlaying((prev) => {
              if (!prev && !next) return prev;
              if (
                prev &&
                next &&
                prev.title === next.title &&
                prev.artist === next.artist &&
                prev.playing === next.playing
              ) {
                return prev;
              }
              return next;
            })
          )
          .catch(() => {});
      }
      if (needStats && !statsInFlightRef.current) {
        statsInFlightRef.current = true;
        api
          .getSystemStats(needTemp)
          .then((next) =>
            setSystemStats((prev) =>
              prev &&
              prev.cpuPercent === next.cpuPercent &&
              prev.memPercent === next.memPercent &&
              prev.cpuClockMhz === next.cpuClockMhz &&
              prev.cpuTempC === next.cpuTempC &&
              prev.gpuPercent === next.gpuPercent &&
              prev.gpuTempC === next.gpuTempC &&
              prev.gpuClockMhz === next.gpuClockMhz &&
              prev.vramPercent === next.vramPercent
                ? prev
                : next
            )
          )
          .catch(() => {})
          .finally(() => {
            statsInFlightRef.current = false;
          });
      }
      const nextClk = formatClock();
      setClockText((prev) =>
        prev.time === nextClk.time && prev.date === nextClk.date ? prev : nextClk
      );
    };

    poll();
    const timer = setInterval(poll, 2500);
    return () => clearInterval(timer);
  }, [pageIndex, config?.pages]);

  // Win+D defense handled natively on a Rust background thread (zero JS IPC polling)
  useEffect(() => {
    if (!config) return;
    api.setDesktopLayer(config.window.desktopLayer, config.window.alwaysOnTop).catch(() => {});
  }, [config !== null, config?.window.desktopLayer, config?.window.alwaysOnTop]);

  // Toggle WS_EX_NOACTIVATE so touching buttons doesn't steal focus from active apps
  const modalOpen = settingsOpen || editingSlot !== null;
  modalOpenRef.current = modalOpen;
  if (settingsOpen) {
    activeModalRef.current = { kind: "settings" };
  } else if (editingSlot !== null) {
    activeModalRef.current = { kind: "editor", slot: editingSlot };
  }
  const wantNoActivate = !modalOpen && !editMode && !dockOpen;
  wantNoActivateRef.current = wantNoActivate;
  useEffect(() => {
    if (!config) return;
    if (!wantNoActivate && dragNoActivateTimerRef.current) {
      clearTimeout(dragNoActivateTimerRef.current);
      dragNoActivateTimerRef.current = null;
    }
    api.setNoActivate(wantNoActivate).catch(() => {});
  }, [config !== null, wantNoActivate]);

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
    for (const v of config.vault ?? []) {
      if (v.iconPath) rels.add(v.iconPath);
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

  // Smoothly synchronize window bounds & CSS stage transitions without WebView2 resize flicker.
  // When placed near right/bottom screen edges, expanding pushes left/up inside work area
  // without overwriting the user's resting corner position, then glides back on close.
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

    const gridW = gridCols * gridCellSize + Math.max(0, gridCols - 1) * gridGap + PAD_X * 2;
    const gridH =
      gridRows * gridCellSize + Math.max(0, gridRows - 1) * gridGap + HEADER_H + FOOTER_H + PAD_Y * 2;
    const extraDockW = dockOpen ? DOCK_W : 0;
    const curWinW = modalOpen ? Math.max(gridW + extraDockW, 600) : gridW + extraDockW;
    const curWinH = modalOpen ? Math.max(gridH, 680) : gridH;
    const prev = prevLayoutRef.current;

    // Never resize while settings/editor modal stays open so sliders do not jitter under the cursor.
    if (modalOpen && prev?.modalOpen) {
      return;
    }

    prevLayoutRef.current = { dockOpen, modalOpen, gridW, gridH, winW: curWinW, winH: curWinH };

    if (animTimerRef.current) {
      clearTimeout(animTimerRef.current);
      animTimerRef.current = null;
    }
    if (moveTimerRef.current) {
      clearTimeout(moveTimerRef.current);
      moveTimerRef.current = null;
    }

    const seq = ++animSeqRef.current;
    const anchorX = homePosRef.current?.x ?? null;
    const anchorY = homePosRef.current?.y ?? null;

    const markProgrammaticMove = () => {
      programmaticMoveUntilRef.current = Date.now() + 700;
    };

    const run = async () => {
      if (!prev) {
        markProgrammaticMove();
        const res = await api.syncWindowBounds(
          anchorX,
          anchorY,
          gridW,
          gridH,
          0,
          gridW,
          gridH,
          true
        );
        if (animSeqRef.current !== seq) return;
        lastWinPosRef.current = { x: res.x, y: res.y };
        homePosRef.current = { x: res.x, y: res.y };
        activeDockPhysWRef.current = 0;
        return;
      }

      // Opening modal (settings or button editor)
      if (modalOpen && !prev.modalOpen) {
        const targetW = Math.max(gridW + extraDockW, 600);
        const targetH = Math.max(gridH, 680);
        const plan = await api.syncWindowBounds(
          anchorX,
          anchorY,
          gridW,
          gridH,
          extraDockW,
          targetW,
          targetH,
          false
        );
        if (animSeqRef.current !== seq) return;

        const midShell = shellRectRef.current;
        const curPos = lastWinPosRef.current ?? { x: plan.baseX, y: plan.baseY };
        const startW = midShell ? midShell.width : prev.dockOpen ? prev.gridW + DOCK_W : prev.gridW;
        const startH = midShell ? midShell.height : prev.gridH;
        const startTx =
          (curPos.x - plan.x) / plan.scale + (midShell ? midShell.tx : 0);
        const startTy =
          (curPos.y - plan.y) / plan.scale + (midShell ? midShell.ty : 0);

        flushSync(() => {
          setClosingModal(null);
          setDockOnLeft(plan.dockOnLeft);
          if (dockOpen) {
            setDockMounted(true);
            setDockExpanded(true);
          }
          setModalVisible(false);
          setShellRect({ width: startW, height: startH, tx: startTx, ty: startTy, animate: false });
        });

        markProgrammaticMove();
        const res = await api.syncWindowBounds(
          anchorX,
          anchorY,
          gridW,
          gridH,
          extraDockW,
          targetW,
          targetH,
          true
        );
        if (animSeqRef.current !== seq) return;
        lastWinPosRef.current = { x: res.x, y: res.y };
        activeDockPhysWRef.current = res.dockPhysW;

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (animSeqRef.current !== seq) return;
            setShellRect({ width: targetW, height: targetH, tx: 0, ty: 0, animate: true });
            setModalVisible(true);
          });
        });
        return;
      }

      // Closing modal (back to dock or resting grid)
      if (!modalOpen && prev.modalOpen) {
        const targetW = gridW + extraDockW;
        const targetH = gridH;
        const snapshot = activeModalRef.current;
        const plan = await api.syncWindowBounds(
          anchorX,
          anchorY,
          gridW,
          gridH,
          extraDockW,
          targetW,
          targetH,
          false
        );
        if (animSeqRef.current !== seq) return;

        const growsPastModal = targetW > prev.winW || targetH > prev.winH;
        if (growsPastModal) {
          // If grid was enlarged past modal window bounds, expand OS window first so the grid never clips
          const curPos = lastWinPosRef.current ?? { x: plan.x, y: plan.y };
          const startTx = (curPos.x - plan.x) / plan.scale;
          const startTy = (curPos.y - plan.y) / plan.scale;

          flushSync(() => {
            if (snapshot) setClosingModal(snapshot);
            setDockOnLeft(plan.dockOnLeft);
            if (dockOpen) {
              setDockMounted(true);
              setDockExpanded(true);
            } else {
              setDockExpanded(false);
            }
            setModalVisible(true);
            setShellRect({
              width: prev.winW,
              height: prev.winH,
              tx: startTx,
              ty: startTy,
              animate: false,
            });
          });

          markProgrammaticMove();
          const grown = await api.syncWindowBounds(
            anchorX,
            anchorY,
            gridW,
            gridH,
            extraDockW,
            targetW,
            targetH,
            true
          );
          if (animSeqRef.current !== seq) return;
          lastWinPosRef.current = { x: grown.x, y: grown.y };
          activeDockPhysWRef.current = grown.dockPhysW;

          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (animSeqRef.current !== seq) return;
              setModalVisible(false);
              setShellRect({ width: targetW, height: targetH, tx: 0, ty: 0, animate: true });
            });
          });

          animTimerRef.current = setTimeout(() => {
            if (animSeqRef.current !== seq) return;
            activeModalRef.current = null;
            setClosingModal(null);
            if (!dockOpen) setDockMounted(false);
            setShellRect(null);
            if (!dockOpen) {
              homePosRef.current = { x: grown.x, y: grown.y };
            }
          }, 240);
          return;
        }

        const curPos = lastWinPosRef.current ?? { x: plan.x, y: plan.y };
        const closeTx = (plan.x - curPos.x) / plan.scale;
        const closeTy = (plan.y - curPos.y) / plan.scale;

        flushSync(() => {
          if (snapshot) setClosingModal(snapshot);
          setDockOnLeft(plan.dockOnLeft);
          if (dockOpen) {
            setDockMounted(true);
            setDockExpanded(true);
          } else {
            setDockExpanded(false);
          }
          setModalVisible(false);
          setShellRect({ width: targetW, height: targetH, tx: closeTx, ty: closeTy, animate: true });
        });

        animTimerRef.current = setTimeout(async () => {
          if (animSeqRef.current !== seq) return;
          activeModalRef.current = null;
          flushSync(() => {
            setClosingModal(null);
            if (!dockOpen) setDockMounted(false);
            setShellRect(null);
          });
          markProgrammaticMove();
          const res = await api.syncWindowBounds(
            anchorX,
            anchorY,
            gridW,
            gridH,
            extraDockW,
            targetW,
            targetH,
            true
          );
          if (animSeqRef.current !== seq) return;
          lastWinPosRef.current = { x: res.x, y: res.y };
          activeDockPhysWRef.current = res.dockPhysW;
          if (!dockOpen) {
            homePosRef.current = { x: res.x, y: res.y };
          }
        }, 230);
        return;
      }

      // Opening dock (without modal)
      if (dockOpen && !prev.dockOpen) {
        const plan = await api.syncWindowBounds(
          anchorX,
          anchorY,
          gridW,
          gridH,
          DOCK_W,
          gridW + DOCK_W,
          gridH,
          false
        );
        if (animSeqRef.current !== seq) return;

        flushSync(() => {
          setShellRect(null);
          setDockOnLeft(plan.dockOnLeft);
          setDockMounted(true);
          setDockExpanded(false);
        });

        markProgrammaticMove();
        const res = await api.syncWindowBounds(
          anchorX,
          anchorY,
          gridW,
          gridH,
          DOCK_W,
          gridW + DOCK_W,
          gridH,
          true
        );
        if (animSeqRef.current !== seq) return;
        lastWinPosRef.current = { x: res.x, y: res.y };
        activeDockPhysWRef.current = res.dockPhysW;

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (animSeqRef.current !== seq) return;
            setDockExpanded(true);
          });
        });
        return;
      }

      // Closing dock (without modal)
      if (!dockOpen && prev.dockOpen) {
        setDockExpanded(false);
        animTimerRef.current = setTimeout(async () => {
          if (animSeqRef.current !== seq) return;
          flushSync(() => {
            setDockMounted(false);
            setShellRect(null);
          });
          markProgrammaticMove();
          const res = await api.syncWindowBounds(
            anchorX,
            anchorY,
            gridW,
            gridH,
            0,
            gridW,
            gridH,
            true
          );
          if (animSeqRef.current !== seq) return;
          lastWinPosRef.current = { x: res.x, y: res.y };
          activeDockPhysWRef.current = 0;
          homePosRef.current = { x: res.x, y: res.y };
        }, 230);
        return;
      }

      // Grid layout changed directly while modal is closed
      markProgrammaticMove();
      const res = await api.syncWindowBounds(
        anchorX,
        anchorY,
        gridW,
        gridH,
        extraDockW,
        gridW + extraDockW,
        gridH,
        true
      );
      if (animSeqRef.current !== seq) return;
      lastWinPosRef.current = { x: res.x, y: res.y };
      activeDockPhysWRef.current = res.dockPhysW;
      setDockOnLeft(res.dockOnLeft);
      if (!dockOpen) {
        homePosRef.current = { x: res.x, y: res.y };
      }
    };

    run().catch(() => {});
  }, [gridCols, gridRows, gridCellSize, gridGap, modalOpen, dockOpen]);

  // Sync alwaysOnTop changes
  useEffect(() => {
    if (!config) return;
    getCurrentWindow().setAlwaysOnTop(config.window.alwaysOnTop).catch(() => {});
  }, [config?.window.alwaysOnTop]);

  // Save window position only on genuine manual drags (never during locked/modal/programmatic shifts)
  useEffect(() => {
    const win = getCurrentWindow();
    const unlistenPromise = win.onMoved(({ payload }) => {
      const cur = configRef.current;
      if (
        !cur ||
        cur.window.locked ||
        modalOpenRef.current ||
        activeModalRef.current !== null ||
        Date.now() < programmaticMoveUntilRef.current
      ) {
        return;
      }
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
      moveTimerRef.current = setTimeout(() => {
        const latest = configRef.current;
        if (
          !latest ||
          latest.window.locked ||
          modalOpenRef.current ||
          activeModalRef.current !== null ||
          Date.now() < programmaticMoveUntilRef.current
        ) {
          return;
        }
        lastWinPosRef.current = { x: payload.x, y: payload.y };
        const anchorX = payload.x + activeDockPhysWRef.current;
        const anchorY = payload.y;
        homePosRef.current = { x: anchorX, y: anchorY };
        const next: DeckConfig = {
          ...latest,
          window: { ...latest.window, x: anchorX, y: anchorY },
        };
        setConfig(next);
        api.saveConfig(next).catch(() => {});
      }, 400);
    });
    return () => {
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
      if (dragNoActivateTimerRef.current) clearTimeout(dragNoActivateTimerRef.current);
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

  const isOverVaultDrop = useCallback((cx: number, cy: number): boolean => {
    const el = document.querySelector<HTMLElement>('[data-vault-drop="true"]');
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom;
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
        const initCfg = configRef.current;
        if (!initCfg) return;
        if (initCfg.window.locked) {
          showToast("잠금 상태입니다. 잠금을 해제한 뒤 드롭하세요.");
          return;
        }

        const dropPageIdx = pageIndexRef.current;
        let targetSlot = findSlotAtPhysicalPos(payload.position.x, payload.position.y);
        const addedEntries: Array<{ slot: number | null; item: ButtonItem }> = [];
        const iconUpdates: Array<{ slot: number; iconPath: string }> = [];
        let bgRel: string | null = null;

        for (const droppedPath of payload.paths) {
          try {
            const resolved = await api.inspectDrop(droppedPath);
            const curAfter = configRef.current;
            const curPageAfter = curAfter?.pages[dropPageIdx];
            if (resolved.kind === "image") {
              if (targetSlot !== null && curPageAfter?.slots[String(targetSlot)]) {
                const rel = await api.importImage(droppedPath, "icon");
                iconUpdates.push({ slot: targetSlot, iconPath: rel });
                showToast(`아이콘 이미지 변경: ${curPageAfter.slots[String(targetSlot)].label}`);
              } else {
                bgRel = await api.importImage(droppedPath, "bg");
                showToast("배경 이미지 테마가 적용되었습니다.");
                break;
              }
              continue;
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
            addedEntries.push({ slot: targetSlot, item: newBtn });
            showToast(`등록됨: ${newBtn.label}`);
            targetSlot = null;
          } catch (e) {
            showToast(`등록 실패: ${String(e)}`);
          }
        }

        const cur = configRef.current;
        if (!cur) return;
        if (bgRel) {
          const curStyle = cur.theme.buttonStyle ?? "solid";
          persistConfig({
            ...cur,
            theme: {
              ...cur.theme,
              backgroundType: "image",
              backgroundImage: bgRel,
              buttonStyle: curStyle === "solid" ? "glass" : curStyle,
              backgroundBlur: cur.theme.backgroundBlur === 8 ? 2 : cur.theme.backgroundBlur,
              backgroundDim: cur.theme.backgroundDim === 35 ? 20 : cur.theme.backgroundDim,
            },
          });
          return;
        }
        if (iconUpdates.length === 0 && addedEntries.length === 0) return;

        const curPage = cur.pages[dropPageIdx];
        if (!curPage) return;
        const totalSlots = cur.grid.columns * cur.grid.rows;
        const nextSlots = { ...curPage.slots };

        for (const upd of iconUpdates) {
          if (nextSlots[String(upd.slot)]) {
            nextSlots[String(upd.slot)] = {
              ...nextSlots[String(upd.slot)],
              iconPath: upd.iconPath,
            };
          }
        }
        for (const entry of addedEntries) {
          let slotToUse = entry.slot;
          if (slotToUse === null) {
            for (let i = 0; i < totalSlots; i++) {
              if (!nextSlots[String(i)]) {
                slotToUse = i;
                break;
              }
            }
          }
          if (slotToUse === null) {
            showToast("현재 페이지에 빈 칸이 없습니다.");
            break;
          }
          nextSlots[String(slotToUse)] = entry.item;
        }

        const nextPages = cur.pages.map((p, idx) =>
          idx === dropPageIdx ? { ...p, slots: nextSlots } : p
        );
        persistConfig({ ...cur, pages: nextPages });
      }
    });

    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [findSlotAtPhysicalPos, persistConfig, showToast]);

  const currentPage = config?.pages[pageIndex] ?? config?.pages[0];

  const volInFlightRef = useRef(false);
  const pendingVolDeltaRef = useRef(0);

  const flushVolumeDelta = useCallback(async () => {
    if (volInFlightRef.current) return;
    const delta = pendingVolDeltaRef.current;
    if (delta === 0) return;
    pendingVolDeltaRef.current = 0;
    volInFlightRef.current = true;
    try {
      const res = await api.executeAction({
        type: "volume",
        command: delta > 0 ? "up" : "down",
        step: Math.min(25, Math.abs(delta)),
        target: "speaker",
      });
      if (res.volume) {
        setVolumeState(res.volume);
      }
    } catch {
      // Ignore transient errors during rapid wheel or hold adjustments
    } finally {
      volInFlightRef.current = false;
      if (pendingVolDeltaRef.current !== 0) {
        void flushVolumeDelta();
      }
    }
  }, []);

  const handleVolumeStep = useCallback(
    (command: "up" | "down", step: number) => {
      pendingVolDeltaRef.current += command === "up" ? step : -step;
      void flushVolumeDelta();
    },
    [flushVolumeDelta]
  );

  const handleExecute = useCallback(
    async (item: ButtonItem) => {
      if (Date.now() < suppressClickUntilRef.current) return;
      if (item.action.type === "page") {
        const cur = configRef.current;
        if (cur && item.action.pageIndex >= 0 && item.action.pageIndex < cur.pages.length) {
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
    },
    [showToast]
  );

  const handleEditSlot = useCallback((slotIdx: number) => {
    setEditingSlot(slotIdx);
  }, []);

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

  const handleDuplicateSlot = (slotIdx: number) => {
    if (!config || !currentPage) return;
    const src = currentPage.slots[String(slotIdx)];
    if (!src) return;
    const total = config.grid.columns * config.grid.rows;
    let freeSlot: number | null = null;
    for (let i = 0; i < total; i++) {
      if (!currentPage.slots[String(i)]) {
        freeSlot = i;
        break;
      }
    }
    if (freeSlot === null) {
      showToast("현재 페이지에 빈 칸이 없습니다.");
      return;
    }
    const copyItem: ButtonItem = {
      ...structuredClone(src),
      id: `btn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    };
    const nextSlots = { ...currentPage.slots, [String(freeSlot)]: copyItem };
    const nextPages = config.pages.map((p, idx) =>
      idx === pageIndex ? { ...p, slots: nextSlots } : p
    );
    persistConfig({ ...config, pages: nextPages });
    showToast(`"${src.label}" 복제됨`);
  };

  const handleOpenContextMenu = useCallback((slotIdx: number, e: React.MouseEvent) => {
    const menuW = 176;
    const menuH = 204;
    const x = Math.max(8, Math.min(e.clientX, window.innerWidth - menuW - 8));
    const y = Math.max(8, Math.min(e.clientY, window.innerHeight - menuH - 8));
    setContextMenu({ slotIndex: slotIdx, x, y });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const onPointerDown = (ev: PointerEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target?.closest(".tile-context-menu")) return;
      setContextMenu(null);
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setContextMenu(null);
    };
    const onBlur = () => setContextMenu(null);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [contextMenu]);

  useEffect(() => {
    setContextMenu(null);
  }, [pageIndex, modalOpen]);

  const handleMoveToVault = (slotIdx: number) => {
    const cur = configRef.current;
    if (!cur) return;
    const curP = cur.pages[pageIndexRef.current];
    if (!curP) return;
    const target = curP.slots[String(slotIdx)];
    if (!target) return;

    const nextSlots = { ...curP.slots };
    delete nextSlots[String(slotIdx)];
    const nextPages = cur.pages.map((p, idx) =>
      idx === pageIndexRef.current ? { ...p, slots: nextSlots } : p
    );
    const nextVault = [...(cur.vault ?? []), target];
    persistConfig({ ...cur, pages: nextPages, vault: nextVault });
    setEditingSlot(null);
    setDockOpen(true);
    showToast(`"${target.label}" 버튼을 보관함에 넣었습니다.`);
  };

  const handleRemoveFromVault = (id: string) => {
    if (!config) return;
    const nextVault = (config.vault ?? []).filter((v) => v.id !== id);
    persistConfig({ ...config, vault: nextVault });
  };

  const placeDockItemAtSlot = (item: ButtonItem, targetSlot: number, removeVaultId: string | null) => {
    const cur = configRef.current;
    if (!cur) return;
    const curP = cur.pages[pageIndexRef.current];
    if (!curP) return;

    const nextSlots = { ...curP.slots };
    const displaced = nextSlots[String(targetSlot)];
    nextSlots[String(targetSlot)] = item;

    let nextVault = cur.vault ?? [];
    if (removeVaultId) {
      nextVault = nextVault.filter((v) => v.id !== removeVaultId);
    }
    if (displaced) {
      nextVault = [...nextVault, displaced];
    }

    const nextPages = cur.pages.map((p, idx) =>
      idx === pageIndexRef.current ? { ...p, slots: nextSlots } : p
    );
    persistConfig({ ...cur, pages: nextPages, vault: nextVault });
    showToast(
      displaced
        ? `"${item.label}" 배치됨 (기존 "${displaced.label}" 보관함 이동)`
        : `"${item.label}" 추가됨`
    );
  };

  const handleQuickInsertFromDock = (item: ButtonItem, removeVaultId?: string) => {
    if (!config || !currentPage) return;
    const total = config.grid.columns * config.grid.rows;
    let freeSlot: number | null = null;
    for (let i = 0; i < total; i++) {
      if (!currentPage.slots[String(i)]) {
        freeSlot = i;
        break;
      }
    }
    if (freeSlot === null) {
      showToast("현재 페이지에 빈 칸이 없습니다.");
      return;
    }
    placeDockItemAtSlot(item, freeSlot, removeVaultId ?? null);
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
  const handleMoveToVaultRef = useRef(handleMoveToVault);
  handleMoveToVaultRef.current = handleMoveToVault;
  const placeDockItemRef = useRef(placeDockItemAtSlot);
  placeDockItemRef.current = placeDockItemAtSlot;

  const handleStartSlotDrag = useCallback((slotIdx: number, e: React.PointerEvent) => {
    const curP = configRef.current?.pages[pageIndexRef.current];
    const lbl = curP?.slots[String(slotIdx)]?.label ?? "";
    slotDragPendingRef.current = {
      fromSlot: slotIdx,
      label: lbl,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
  }, []);

  const handleStartDockDrag = useCallback(
    (item: ButtonItem, removeVaultId: string | null, e: React.PointerEvent) => {
      dockDragPendingRef.current = {
        item,
        removeVaultId,
        startX: e.clientX,
        startY: e.clientY,
        active: false,
      };
    },
    []
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = slotDragPendingRef.current;
      if (p) {
        const dist = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
        if (!p.active && dist >= 8) {
          p.active = true;
        }
        if (p.active) {
          const overVault = isOverVaultDrop(e.clientX, e.clientY);
          setVaultHover(overVault);
          const overSlot = overVault ? null : findSlotAtClientPos(e.clientX, e.clientY);
          setDragSwap({
            fromSlot: p.fromSlot,
            label: p.label,
            overSlot,
            clientX: e.clientX,
            clientY: e.clientY,
          });
        }
        return;
      }

      const d = dockDragPendingRef.current;
      if (d) {
        const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
        if (!d.active && dist >= 8) {
          d.active = true;
        }
        if (d.active) {
          const overSlot = findSlotAtClientPos(e.clientX, e.clientY);
          setDragSwap({
            fromSlot: null,
            label: d.item.label,
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
        setVaultHover(false);

        if (p.active) {
          if (isOverVaultDrop(e.clientX, e.clientY)) {
            handleMoveToVaultRef.current(p.fromSlot);
            return;
          }
          const overSlot = findSlotAtClientPos(e.clientX, e.clientY);
          if (overSlot !== null && overSlot !== p.fromSlot) {
            handleSwapSlotRef.current(p.fromSlot, overSlot);
          }
        } else {
          setEditingSlot(p.fromSlot);
        }
        return;
      }

      const d = dockDragPendingRef.current;
      if (d) {
        dockDragPendingRef.current = null;
        setDragSwap(null);
        if (d.active) {
          const overSlot = findSlotAtClientPos(e.clientX, e.clientY);
          if (overSlot !== null) {
            placeDockItemRef.current(d.item, overSlot, d.removeVaultId);
          }
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

    const onCancel = () => {
      slotDragPendingRef.current = null;
      dockDragPendingRef.current = null;
      swipeRef.current = null;
      setDragSwap(null);
      setVaultHover(false);
      setSwipeOffset(0);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [findSlotAtClientPos, isOverVaultDrop]);

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
    return (
      <div className="loading-shell" style={{ flexDirection: "column", gap: 10, padding: 16 }}>
        <span>{loadError ?? "TouchDeck 불러오는 중..."}</span>
        {loadError && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() =>
                reloadConfig().catch((e) => setLoadError(`설정 로드 오류: ${String(e)}`))
              }
            >
              다시 시도
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => getCurrentWindow().hide()}
            >
              숨기기
            </button>
          </div>
        )}
      </div>
    );
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

  const gridW =
    config.grid.columns * config.grid.cellSize +
    Math.max(0, config.grid.columns - 1) * config.grid.gap +
    PAD_X * 2;
  const gridH =
    config.grid.rows * config.grid.cellSize +
    Math.max(0, config.grid.rows - 1) * config.grid.gap +
    HEADER_H +
    FOOTER_H +
    PAD_Y * 2;
  const renderedModal =
    editingSlot !== null
      ? ({ kind: "editor", slot: editingSlot } as const)
      : settingsOpen
      ? ({ kind: "settings" } as const)
      : closingModal;
  const stageAlignRight = !shellRect && dockOnLeft;

  return (
    <div className={`deck-stage ${stageAlignRight ? "deck-stage-right" : ""}`}>
      <div
        className={`deck-shell ${shellRect?.animate ? "deck-shell-animate" : ""}`}
        style={{
          fontFamily: `"${config.theme.fontFamily}", "Pretendard", "Segoe UI", sans-serif`,
          ...(shellRect
            ? {
                width: shellRect.width,
                height: shellRect.height,
                transform: `translate3d(${shellRect.tx}px, ${shellRect.ty}px, 0)`,
              }
            : {
                width: "auto",
                height: gridH,
              }),
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
              if (dragNoActivateTimerRef.current) {
                clearTimeout(dragNoActivateTimerRef.current);
              }
              dragNoActivateTimerRef.current = setTimeout(() => {
                dragNoActivateTimerRef.current = null;
                if (wantNoActivateRef.current) {
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
          {updateInfo?.hasUpdate && (
            <button
              type="button"
              className="update-pill"
              onClick={() => setSettingsOpen(true)}
              title={`새 버전 v${updateInfo.latestVersion} 업데이트 가능`}
            >
              v{updateInfo.latestVersion} 업데이트
            </button>
          )}
          <button
            type="button"
            className={`hdr-btn ${dockOpen ? "hdr-btn-active" : ""}`}
            onClick={() => setDockOpen((v) => !v)}
            title="버튼 보관함 / 기본 프리셋 서랍"
          >
            <Package size={14} />
          </button>
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
              api.setUserHidden(true).catch(() => {});
              getCurrentWindow().hide();
            }}
            title="트레이로 숨기기"
          >
            <Minus size={14} />
          </button>
        </div>
      </header>

      <div className={`deck-workspace ${dockOnLeft ? "deck-workspace-dock-left" : ""}`}>
        <div
          className="deck-main-col"
          style={shellRect ? undefined : { width: gridW, flexShrink: 0, flex: "none" }}
        >
          {/* Grid */}
          <main
            className={`deck-grid ${swipeOffset === 0 ? "deck-grid-snap" : ""}`}
            style={{
              gridTemplateColumns: `repeat(${config.grid.columns}, ${config.grid.cellSize}px)`,
              gridTemplateRows: `repeat(${config.grid.rows}, ${config.grid.cellSize}px)`,
              gap: config.grid.gap,
              padding: `${PAD_Y}px ${PAD_X}px`,
              touchAction: "none",
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
                  isDropHover={
                    dropHoverSlot === idx || (dragSwap !== null && dragSwap.overSlot === idx)
                  }
                  isDraggingSource={dragSwap !== null && dragSwap.fromSlot === idx}
                  isRunning={isRunning}
                  isForeground={isForeground}
                  volumeState={volumeState}
                  discordState={discordState}
                  nowPlaying={nowPlaying}
                  systemStats={systemStats}
                  clockText={clockText}
                  onExecute={handleExecute}
                  onVolumeStep={handleVolumeStep}
                  onEdit={handleEditSlot}
                  onContextMenu={handleOpenContextMenu}
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
        </div>

        {dockMounted && (
          <div className={`dock-slot ${dockExpanded ? "dock-slot-open" : ""}`}>
            <ButtonDock
              vault={config.vault ?? []}
              assetMap={assetMap}
              isVaultDropHover={vaultHover}
              onQuickInsert={handleQuickInsertFromDock}
              onRemoveFromVault={handleRemoveFromVault}
              onStartDockDrag={handleStartDockDrag}
              onClose={() => setDockOpen(false)}
            />
          </div>
        )}
      </div>

      {contextMenu && currentPage.slots[String(contextMenu.slotIndex)] && (() => {
        const ctxSlot = contextMenu.slotIndex;
        const ctxItem = currentPage.slots[String(ctxSlot)];
        return (
          <div
            className="tile-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {ctxItem.action.type !== "widget" && (
              <button
                type="button"
                className="ctx-menu-item"
                onClick={() => {
                  setContextMenu(null);
                  handleExecute(ctxItem);
                }}
              >
                <Play size={13} /> 실행
              </button>
            )}
            <button
              type="button"
              className="ctx-menu-item"
              onClick={() => {
                setContextMenu(null);
                setEditingSlot(ctxSlot);
              }}
            >
              <Pencil size={13} /> 편집
            </button>
            <button
              type="button"
              className="ctx-menu-item"
              onClick={() => {
                setContextMenu(null);
                handleDuplicateSlot(ctxSlot);
              }}
            >
              <Copy size={13} /> 복제
            </button>
            <button
              type="button"
              className="ctx-menu-item"
              onClick={() => {
                setContextMenu(null);
                handleMoveToVault(ctxSlot);
              }}
            >
              <Package size={13} /> 보관함으로 이동
            </button>
            <div className="ctx-menu-sep" />
            <button
              type="button"
              className="ctx-menu-item ctx-menu-item-danger"
              onClick={() => {
                setContextMenu(null);
                handleDeleteSlot(ctxSlot);
              }}
            >
              <Trash2 size={13} /> 삭제
            </button>
          </div>
        );
      })()}

      {toast && <div className="toast-pill">{toast}</div>}

      {dragSwap && (
        <div
          className="drag-ghost"
          style={{
            left: dragSwap.clientX,
            top: dragSwap.clientY,
          }}
        >
          {dragSwap.label}
        </div>
      )}

      {renderedModal && (
        <div className={`modal-layer ${modalVisible ? "modal-layer-visible" : ""}`}>
          {renderedModal.kind === "editor" ? (
            <ButtonEditorModal
              key={`${pageIndex}-${renderedModal.slot}`}
              slotIndex={renderedModal.slot}
              currentPageIndex={pageIndex}
              initialItem={currentPage.slots[String(renderedModal.slot)]}
              pages={config.pages}
              onSave={handleSaveSlot}
              onDelete={handleDeleteSlot}
              onMoveToVault={handleMoveToVault}
              onTransferToPage={handleTransferToPage}
              onClose={() => setEditingSlot(null)}
            />
          ) : (
            <SettingsDrawer
              config={config}
              currentPageIndex={pageIndex}
              discordState={discordState}
              updateInfo={updateInfo}
              onUpdateInfo={setUpdateInfo}
              onChange={persistConfig}
              onSwitchPage={setPageIndex}
              onReloadFromDisk={reloadConfig}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </div>
      )}
    </div>
    </div>
  );
};

export default App;
