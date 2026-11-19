import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useDeckWindowLayout } from "./hooks/useDeckWindowLayout";
import { createI18n, I18nProvider } from "./i18n";
import type {
  ButtonItem,
  DeckConfig,
  DiscordConfig,
  DiscordState,
  Language,
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

function formatClock(language: Language): { time: string; date: string } {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const week = new Intl.DateTimeFormat(language, { weekday: "short" }).format(now);
  return { time: `${hh}:${mm}`, date: `${month}/${day} (${week})` };
}

export const App: React.FC<{ systemLanguage: Language }> = ({ systemLanguage }) => {
  const [config, setConfig] = useState<DeckConfig | null>(null);
  // Follows Windows until the config is loaded or while it has no explicit choice
  const language = config?.language ?? systemLanguage;
  const i18n = useMemo(() => createI18n(language), [language]);
  const { t } = i18n;
  // Long-lived callbacks read the translator from a ref so a language change never re-creates them
  const tRef = useRef(t);
  tRef.current = t;
  const [pageIndex, setPageIndex] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ slotIndex: number; x: number; y: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [clockText, setClockText] = useState(() => formatClock(language));
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const swipeRef = useRef<{ startX: number; startY: number; swiping: boolean } | null>(null);
  const suppressClickUntilRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragNoActivateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef(false);
  const saveDirtyRef = useRef(false);
  const userHiddenRef = useRef(false);
  const pollNowRef = useRef(() => {});
  const statsInFlightRef = useRef(false);
  const volPollInFlightRef = useRef(false);
  const runningInFlightRef = useRef(false);
  const mediaInFlightRef = useRef(false);
  const requestedAssetsRef = useRef(new Set<string>());
  const wantNoActivateRef = useRef(true);
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

  const showToast = useCallback((msg: string, durationMs = 2400) => {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), durationMs);
  }, []);

  // Single save path: one request at a time, always writing the latest config
  const flushSave = useCallback(async () => {
    const latest = configRef.current;
    if (saveInFlightRef.current || !saveDirtyRef.current || !latest) return;
    saveDirtyRef.current = false;
    saveInFlightRef.current = true;
    try {
      await api.saveConfig(latest);
    } catch (e) {
      showToast(tRef.current("toast.saveFailed", { error: String(e) }));
    } finally {
      saveInFlightRef.current = false;
      // Changed while saving and no debounce timer left to pick it up
      if (saveDirtyRef.current && !saveTimerRef.current) {
        void flushSave();
      }
    }
  }, [showToast]);

  const persistConfig = useCallback(
    (next: DeckConfig) => {
      configRef.current = next;
      setConfig(next);
      saveDirtyRef.current = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void flushSave();
      }, 220);
    },
    [flushSave]
  );

  const {
    dockMounted,
    dockExpanded,
    dockOnLeft,
    modalVisible,
    shellRect,
    renderedModal,
    modalOpen,
    syncHomeFromConfig,
  } = useDeckWindowLayout({
    config,
    configRef,
    persistConfig,
    dockOpen,
    settingsOpen,
    editingSlot,
    headerH: HEADER_H,
    footerH: FOOTER_H,
    padX: PAD_X,
    padY: PAD_Y,
    dockW: DOCK_W,
  });

  const reloadConfig = useCallback(async () => {
    const loaded = await api.getConfig();
    setLoadError(null);
    syncHomeFromConfig(loaded);
    setConfig(loaded);
    api
      .takeConfigNotice()
      .then((notice) => {
        // Long enough to read the backup path
        if (notice) showToast(notice, 20000);
      })
      .catch(() => {});
  }, [syncHomeFromConfig, showToast]);

  // Initial config and Discord state load
  useEffect(() => {
    reloadConfig().catch((e) => {
      setLoadError(String(e));
      showToast(tRef.current("app.configLoadError", { error: String(e) }));
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
      pollNowRef.current();
    });
    const u2 = listen("tray-show", () => {
      userHiddenRef.current = false;
      pollNowRef.current();
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
      // Nothing to refresh while the window sits hidden in the tray
      if (userHiddenRef.current || document.hidden) return;
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

      if (needVol && !volPollInFlightRef.current) {
        volPollInFlightRef.current = true;
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
          .catch(() => {})
          .finally(() => {
            volPollInFlightRef.current = false;
          });
      }
      if (uniqProcs.length > 0 && !runningInFlightRef.current) {
        runningInFlightRef.current = true;
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
          .catch(() => {})
          .finally(() => {
            runningInFlightRef.current = false;
          });
      }
      if (needMedia && !mediaInFlightRef.current) {
        mediaInFlightRef.current = true;
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
          .catch(() => {})
          .finally(() => {
            mediaInFlightRef.current = false;
          });
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
      const nextClk = formatClock(language);
      setClockText((prev) =>
        prev.time === nextClk.time && prev.date === nextClk.date ? prev : nextClk
      );
    };

    pollNowRef.current = poll;
    poll();
    const timer = setInterval(poll, 2500);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [pageIndex, config?.pages, language]);

  // Selects language-specific glyph fallbacks for CJK text
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // Win+D defense handled natively on a Rust background thread (zero JS IPC polling)
  useEffect(() => {
    if (!config) return;
    api.setDesktopLayer(config.window.desktopLayer, config.window.alwaysOnTop).catch(() => {});
  }, [config !== null, config?.window.desktopLayer, config?.window.alwaysOnTop]);

  // Toggle WS_EX_NOACTIVATE so touching buttons doesn't steal focus from active apps
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

  useEffect(() => {
    return () => {
      if (dragNoActivateTimerRef.current) {
        clearTimeout(dragNoActivateTimerRef.current);
      }
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
    for (const v of config.vault ?? []) {
      if (v.iconPath) rels.add(v.iconPath);
    }
    // Each path is requested once, so a failed resolve is never retried in a loop
    const missing = Array.from(rels).filter((r) => !requestedAssetsRef.current.has(r));
    if (missing.length === 0) return;
    missing.forEach((r) => requestedAssetsRef.current.add(r));

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
      const resolved = pairs.filter(([, abs]) => abs);
      if (resolved.length > 0) {
        setAssetMap((prev) => ({ ...prev, ...Object.fromEntries(resolved) }));
      }
    });
  }, [config]);

  // Sync alwaysOnTop changes
  useEffect(() => {
    if (!config) return;
    getCurrentWindow().setAlwaysOnTop(config.window.alwaysOnTop).catch(() => {});
  }, [config?.window.alwaysOnTop]);

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
          showToast(tRef.current("toast.lockedDrop"));
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
                showToast(
                  tRef.current("toast.iconChanged", {
                    label: curPageAfter.slots[String(targetSlot)].label,
                  })
                );
              } else if (!bgRel) {
                bgRel = await api.importImage(droppedPath, "bg");
                showToast(tRef.current("toast.bgApplied"));
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
            showToast(tRef.current("toast.registered", { label: newBtn.label }));
            targetSlot = null;
          } catch (e) {
            showToast(tRef.current("toast.registerFailed", { error: String(e) }));
          }
        }

        const cur = configRef.current;
        if (!cur) return;
        const curStyle = cur.theme.buttonStyle ?? "solid";
        const nextTheme: DeckConfig["theme"] = bgRel
          ? {
              ...cur.theme,
              backgroundType: "image",
              backgroundImage: bgRel,
              buttonStyle: curStyle === "solid" ? "glass" : curStyle,
              backgroundBlur: cur.theme.backgroundBlur === 8 ? 2 : cur.theme.backgroundBlur,
              backgroundDim: cur.theme.backgroundDim === 35 ? 20 : cur.theme.backgroundDim,
            }
          : cur.theme;

        const curPage = cur.pages[dropPageIdx];
        if (!curPage || (iconUpdates.length === 0 && addedEntries.length === 0)) {
          if (bgRel) persistConfig({ ...cur, theme: nextTheme });
          return;
        }
        const totalSlots = cur.grid.columns * cur.grid.rows;
        const nextSlots = { ...curPage.slots };
        let nextVault = cur.vault ?? [];

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
            showToast(tRef.current("toast.noFreeSlot"));
            break;
          }
          // A drop onto an occupied tile moves the old button to the vault
          const displaced = nextSlots[String(slotToUse)];
          if (displaced) {
            nextVault = [...nextVault, displaced];
            showToast(
              tRef.current("toast.placedDisplaced", {
                label: entry.item.label,
                displaced: displaced.label,
              })
            );
          }
          nextSlots[String(slotToUse)] = entry.item;
        }

        const nextPages = cur.pages.map((p, idx) =>
          idx === dropPageIdx ? { ...p, slots: nextSlots } : p
        );
        persistConfig({ ...cur, theme: nextTheme, pages: nextPages, vault: nextVault });
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
        showToast(tRef.current("toast.execError", { error: String(e) }));
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
      showToast(t("toast.noFreeSlot"));
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
    showToast(t("toast.duplicated", { label: src.label }));
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
    showToast(tRef.current("toast.movedToVault", { label: target.label }));
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
        ? tRef.current("toast.placedDisplaced", { label: item.label, displaced: displaced.label })
        : tRef.current("toast.added", { label: item.label })
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
      showToast(t("toast.noFreeSlot"));
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
      showToast(t("toast.pageFull", { page: targetPage.name }));
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
    showToast(t(move ? "toast.movedToPage" : "toast.copiedToPage", { page: targetPage.name }));
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
        <span>
          {loadError === null ? t("app.loading") : t("app.configLoadError", { error: loadError })}
        </span>
        {loadError && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() =>
                reloadConfig().catch((e) => setLoadError(String(e)))
              }
            >
              {t("app.retry")}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => getCurrentWindow().hide()}
            >
              {t("app.hide")}
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
  const stageAlignRight = !shellRect && dockOnLeft;

  return (
    <I18nProvider value={i18n}>
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
          {editMode && <span className="edit-pill">{t("header.editing")}</span>}
        </div>

        <div className="header-actions">
          {updateInfo?.hasUpdate && (
            <button
              type="button"
              className="update-pill"
              onClick={() => setSettingsOpen(true)}
              title={t("header.updateTitle", { version: updateInfo.latestVersion })}
            >
              {t("header.update", { version: updateInfo.latestVersion })}
            </button>
          )}
          <button
            type="button"
            className={`hdr-btn ${dockOpen ? "hdr-btn-active" : ""}`}
            onClick={() => setDockOpen((v) => !v)}
            title={t("header.dock")}
          >
            <Package size={14} />
          </button>
          {!config.window.locked && (
            <button
              type="button"
              className={`hdr-btn ${editMode ? "hdr-btn-active" : ""}`}
              onClick={() => setEditMode((v) => !v)}
              title={t("header.editMode")}
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
            title={t(config.window.locked ? "header.unlock" : "common.lock")}
          >
            {config.window.locked ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
          <button
            type="button"
            className="hdr-btn"
            onClick={() => setSettingsOpen(true)}
            title={t("header.settings")}
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
            title={t("header.hideToTray")}
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
              title={t("footer.prevPage")}
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
              title={t("footer.nextPage")}
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
                <Play size={13} /> {t("menu.run")}
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
              <Pencil size={13} /> {t("menu.edit")}
            </button>
            <button
              type="button"
              className="ctx-menu-item"
              onClick={() => {
                setContextMenu(null);
                handleDuplicateSlot(ctxSlot);
              }}
            >
              <Copy size={13} /> {t("common.duplicate")}
            </button>
            <button
              type="button"
              className="ctx-menu-item"
              onClick={() => {
                setContextMenu(null);
                handleMoveToVault(ctxSlot);
              }}
            >
              <Package size={13} /> {t("menu.moveToVault")}
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
              <Trash2 size={13} /> {t("common.delete")}
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
    </I18nProvider>
  );
};

export default App;
