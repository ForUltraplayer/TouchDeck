import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../api";
import type { DeckConfig } from "../types";

export interface ShellRect {
  width: number;
  height: number;
  tx: number;
  ty: number;
  animate: boolean;
}

export type ModalSnapshot = { kind: "settings" } | { kind: "editor"; slot: number };

interface LayoutSnapshot {
  dockOpen: boolean;
  modalOpen: boolean;
  gridW: number;
  gridH: number;
  winW: number;
  winH: number;
}

interface UseDeckWindowLayoutParams {
  config: DeckConfig | null;
  configRef: React.MutableRefObject<DeckConfig | null>;
  setConfig: React.Dispatch<React.SetStateAction<DeckConfig | null>>;
  dockOpen: boolean;
  settingsOpen: boolean;
  editingSlot: number | null;
  headerH: number;
  footerH: number;
  padX: number;
  padY: number;
  dockW: number;
}

const MIN_MODAL_W = 600;
const MIN_MODAL_H = 680;
const ANIM_MS = 230;
const PROGRAMMATIC_MOVE_GRACE_MS = 1500;
const MONITOR_RECOVERY_INTERVAL_MS = 2000;
const MONITOR_RECOVERY_MAX_ATTEMPTS = 15;

function afterTwoFrames(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

/**
 * Coordinates monitor-clamped OS window sizing, right-edge dock flipping,
 * and flicker-free CSS stage transitions for dock & modal open/close.
 */
export function useDeckWindowLayout({
  config,
  configRef,
  setConfig,
  dockOpen,
  settingsOpen,
  editingSlot,
  headerH,
  footerH,
  padX,
  padY,
  dockW,
}: UseDeckWindowLayoutParams) {
  const [dockMounted, setDockMounted] = useState(false);
  const [dockExpanded, setDockExpanded] = useState(false);
  const [dockOnLeft, setDockOnLeft] = useState(false);
  const [closingModal, setClosingModal] = useState<ModalSnapshot | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [shellRect, setShellRect] = useState<ShellRect | null>(null);

  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animSeqRef = useRef(0);
  const prevLayoutRef = useRef<LayoutSnapshot | null>(null);
  const activeModalRef = useRef<ModalSnapshot | null>(null);
  const homePosRef = useRef<{ x: number; y: number } | null>(null);
  const lastWinPosRef = useRef<{ x: number; y: number } | null>(null);
  const programmaticMoveUntilRef = useRef(0);
  const activeDockPhysWRef = useRef(0);
  const modalOpenRef = useRef(false);
  const shellRectRef = useRef(shellRect);
  shellRectRef.current = shellRect;

  const stopMonitorRecovery = useCallback(() => {
    if (recoveryTimerRef.current) {
      clearInterval(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
  }, []);

  const modalOpen = settingsOpen || editingSlot !== null;
  modalOpenRef.current = modalOpen;
  if (settingsOpen) {
    activeModalRef.current = { kind: "settings" };
  } else if (editingSlot !== null) {
    activeModalRef.current = { kind: "editor", slot: editingSlot };
  }

  const syncHomeFromConfig = useCallback((loaded: DeckConfig) => {
    homePosRef.current =
      loaded.window.x !== null && loaded.window.y !== null
        ? { x: loaded.window.x, y: loaded.window.y }
        : null;
  }, []);

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

    const gridW = gridCols * gridCellSize + Math.max(0, gridCols - 1) * gridGap + padX * 2;
    const gridH =
      gridRows * gridCellSize + Math.max(0, gridRows - 1) * gridGap + headerH + footerH + padY * 2;
    const extraDockW = dockOpen ? dockW : 0;
    const curWinW = modalOpen ? Math.max(gridW + extraDockW, MIN_MODAL_W) : gridW + extraDockW;
    const curWinH = modalOpen ? Math.max(gridH, MIN_MODAL_H) : gridH;
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

    const queryBounds = async (
      dockDeltaW: number,
      targetW: number,
      targetH: number,
      apply: boolean
    ) => {
      if (apply) {
        programmaticMoveUntilRef.current = Date.now() + PROGRAMMATIC_MOVE_GRACE_MS;
      }
      const res = await api.syncWindowBounds(
        anchorX,
        anchorY,
        gridW,
        gridH,
        dockDeltaW,
        targetW,
        targetH,
        apply
      );
      if (animSeqRef.current !== seq) return null;
      if (apply) {
        lastWinPosRef.current = { x: res.x, y: res.y };
        activeDockPhysWRef.current = res.dockPhysW;
      }
      return res;
    };

    const run = async () => {
      if (!prev) {
        const res = await queryBounds(0, gridW, gridH, true);
        if (!res) return;
        if (res.recentered && anchorX !== null && anchorY !== null) {
          // Secondary monitor may still be waking up at boot: preserve saved anchor and retry briefly.
          stopMonitorRecovery();
          let attempts = 0;
          recoveryTimerRef.current = setInterval(async () => {
            attempts += 1;
            if (attempts > MONITOR_RECOVERY_MAX_ATTEMPTS || modalOpenRef.current) {
              if (attempts > MONITOR_RECOVERY_MAX_ATTEMPTS) stopMonitorRecovery();
              return;
            }
            const curHome = homePosRef.current;
            if (!curHome) {
              stopMonitorRecovery();
              return;
            }
            const probe = await api
              .syncWindowBounds(curHome.x, curHome.y, gridW, gridH, 0, gridW, gridH, false)
              .catch(() => null);
            if (probe && !probe.recentered) {
              stopMonitorRecovery();
              await queryBounds(0, gridW, gridH, true);
            }
          }, MONITOR_RECOVERY_INTERVAL_MS);
        } else {
          stopMonitorRecovery();
          homePosRef.current = { x: res.x, y: res.y };
        }
        return;
      }

      if (modalOpen && !prev.modalOpen) {
        const targetW = Math.max(gridW + extraDockW, MIN_MODAL_W);
        const targetH = Math.max(gridH, MIN_MODAL_H);
        const plan = await queryBounds(extraDockW, targetW, targetH, false);
        if (!plan) return;

        const midShell = shellRectRef.current;
        const curPos = lastWinPosRef.current ?? { x: plan.baseX, y: plan.baseY };
        const startW = midShell ? midShell.width : prev.dockOpen ? prev.gridW + dockW : prev.gridW;
        const startH = midShell ? midShell.height : prev.gridH;
        const startTx = (curPos.x - plan.x) / plan.scale + (midShell ? midShell.tx : 0);
        const startTy = (curPos.y - plan.y) / plan.scale + (midShell ? midShell.ty : 0);

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

        const res = await queryBounds(extraDockW, targetW, targetH, true);
        if (!res) return;

        afterTwoFrames(() => {
          if (animSeqRef.current !== seq) return;
          setShellRect({ width: targetW, height: targetH, tx: 0, ty: 0, animate: true });
          setModalVisible(true);
        });
        return;
      }

      if (!modalOpen && prev.modalOpen) {
        const targetW = gridW + extraDockW;
        const targetH = gridH;
        const snapshot = activeModalRef.current;
        const plan = await queryBounds(extraDockW, targetW, targetH, false);
        if (!plan) return;

        const curPos = lastWinPosRef.current ?? { x: plan.x, y: plan.y };
        const growsPastModal = targetW > prev.winW || targetH > prev.winH;

        if (growsPastModal) {
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
              tx: (curPos.x - plan.x) / plan.scale,
              ty: (curPos.y - plan.y) / plan.scale,
              animate: false,
            });
          });

          const grown = await queryBounds(extraDockW, targetW, targetH, true);
          if (!grown) return;

          afterTwoFrames(() => {
            if (animSeqRef.current !== seq) return;
            setModalVisible(false);
            setShellRect({ width: targetW, height: targetH, tx: 0, ty: 0, animate: true });
          });

          animTimerRef.current = setTimeout(() => {
            if (animSeqRef.current !== seq) return;
            activeModalRef.current = null;
            setClosingModal(null);
            if (!dockOpen) setDockMounted(false);
            setShellRect(null);
            if (!dockOpen) homePosRef.current = { x: grown.x, y: grown.y };
          }, ANIM_MS + 10);
          return;
        }

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
          setShellRect({
            width: targetW,
            height: targetH,
            tx: (plan.x - curPos.x) / plan.scale,
            ty: (plan.y - curPos.y) / plan.scale,
            animate: true,
          });
        });

        animTimerRef.current = setTimeout(async () => {
          if (animSeqRef.current !== seq) return;
          activeModalRef.current = null;
          flushSync(() => {
            setClosingModal(null);
            if (!dockOpen) setDockMounted(false);
            setShellRect(null);
          });
          const res = await queryBounds(extraDockW, targetW, targetH, true);
          if (res && !dockOpen) {
            homePosRef.current = { x: res.x, y: res.y };
          }
        }, ANIM_MS);
        return;
      }

      if (dockOpen && !prev.dockOpen) {
        const plan = await queryBounds(dockW, gridW + dockW, gridH, false);
        if (!plan) return;

        flushSync(() => {
          setShellRect(null);
          setDockOnLeft(plan.dockOnLeft);
          setDockMounted(true);
          setDockExpanded(false);
        });

        const res = await queryBounds(dockW, gridW + dockW, gridH, true);
        if (!res) return;

        afterTwoFrames(() => {
          if (animSeqRef.current !== seq) return;
          setDockExpanded(true);
        });
        return;
      }

      if (!dockOpen && prev.dockOpen) {
        setDockExpanded(false);
        animTimerRef.current = setTimeout(async () => {
          if (animSeqRef.current !== seq) return;
          flushSync(() => {
            setDockMounted(false);
            setShellRect(null);
          });
          const res = await queryBounds(0, gridW, gridH, true);
          if (res) {
            homePosRef.current = { x: res.x, y: res.y };
          }
        }, ANIM_MS);
        return;
      }

      const res = await queryBounds(extraDockW, gridW + extraDockW, gridH, true);
      if (!res) return;
      setDockOnLeft(res.dockOnLeft);
      if (!dockOpen && !res.recentered) {
        homePosRef.current = { x: res.x, y: res.y };
      }
    };

    run().catch(() => {});
  }, [gridCols, gridRows, gridCellSize, gridGap, modalOpen, dockOpen, headerH, footerH, padX, padY, dockW, stopMonitorRecovery]);

  // Save window position only on genuine manual drags (never during locked/modal/programmatic shifts)
  useEffect(() => {
    const win = getCurrentWindow();
    const unlistenPromise = win.onMoved(({ payload }) => {
      const cur = configRef.current;
      const lastTarget = lastWinPosRef.current;
      const matchesApplied =
        lastTarget !== null &&
        Math.abs(payload.x - lastTarget.x) <= 2 &&
        Math.abs(payload.y - lastTarget.y) <= 2;
      if (
        !cur ||
        cur.window.locked ||
        modalOpenRef.current ||
        activeModalRef.current !== null ||
        matchesApplied ||
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
        stopMonitorRecovery();
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
      }, 300);
    });
    return () => {
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
      stopMonitorRecovery();
      unlistenPromise.then((fn) => fn());
    };
  }, [configRef, setConfig, stopMonitorRecovery]);

  const renderedModal: ModalSnapshot | null =
    editingSlot !== null
      ? { kind: "editor", slot: editingSlot }
      : settingsOpen
      ? { kind: "settings" }
      : closingModal;

  return {
    dockMounted,
    dockExpanded,
    dockOnLeft,
    modalVisible,
    shellRect,
    renderedModal,
    modalOpen,
    syncHomeFromConfig,
  };
}
