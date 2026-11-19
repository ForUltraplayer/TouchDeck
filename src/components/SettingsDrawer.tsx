import React, { useEffect, useState } from "react";
import {
  confirm as confirmDialog,
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, Image as ImageIcon, Plus, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { api } from "../api";
import { toLanguage, useI18n } from "../i18n";
import type { DeckConfig, DiscordState, EnvInfo, UpdateInfo } from "../types";

interface Props {
  config: DeckConfig;
  currentPageIndex: number;
  discordState: DiscordState | null;
  updateInfo: UpdateInfo | null;
  onUpdateInfo: (info: UpdateInfo | null) => void;
  onChange: (next: DeckConfig) => void;
  onSwitchPage: (idx: number) => void;
  onReloadFromDisk: () => void;
  onClose: () => void;
}

export const SettingsDrawer: React.FC<Props> = ({
  config,
  currentPageIndex,
  discordState,
  updateInfo,
  onUpdateInfo,
  onChange,
  onSwitchPage,
  onReloadFromDisk,
  onClose,
}) => {
  const { t } = useI18n();
  const [envInfo, setEnvInfo] = useState<EnvInfo | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [updating, setUpdating] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [dcClientId, setDcClientId] = useState(config.discord?.clientId ?? "");
  const [dcClientSecret, setDcClientSecret] = useState(config.discord?.clientSecret ?? "");

  useEffect(() => {
    api.getEnvInfo().then(setEnvInfo).catch(() => {});
  }, []);

  const updateGrid = (patch: Partial<DeckConfig["grid"]>) => {
    onChange({ ...config, grid: { ...config.grid, ...patch } });
  };

  const updateTheme = (patch: Partial<DeckConfig["theme"]>) => {
    onChange({ ...config, theme: { ...config.theme, ...patch } });
  };

  const updateWindow = (patch: Partial<DeckConfig["window"]>) => {
    onChange({ ...config, window: { ...config.window, ...patch } });
  };

  const handlePickBgImage = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: t("settings.filterBg"), extensions: ["png", "jpg", "jpeg", "webp"] }],
      });
      if (!selected || typeof selected !== "string") return;
      const rel = await api.importImage(selected, "bg");
      const curStyle = config.theme.buttonStyle ?? "solid";
      updateTheme({
        backgroundType: "image",
        backgroundImage: rel,
        buttonStyle: curStyle === "solid" ? "glass" : curStyle,
        backgroundBlur: config.theme.backgroundBlur === 8 ? 2 : config.theme.backgroundBlur,
        backgroundDim: config.theme.backgroundDim === 35 ? 20 : config.theme.backgroundDim,
      });
    } catch (e) {
      setStatusMsg(t("settings.bgFailed", { error: String(e) }));
    }
  };

  const handleAddPage = () => {
    const nextIdx = config.pages.length;
    const nextPages = [
      ...config.pages,
      { id: `page-${Date.now()}`, name: t("settings.pageName", { n: nextIdx + 1 }), slots: {} },
    ];
    onChange({ ...config, pages: nextPages });
    onSwitchPage(nextIdx);
  };

  const handleDeletePage = async (idx: number) => {
    if (config.pages.length <= 1) return;
    try {
      const confirmed = await confirmDialog(
        t("settings.deletePageConfirm", {
          name: config.pages[idx].name,
          count: Object.keys(config.pages[idx].slots).length,
        }),
        {
          title: t("settings.deletePage"),
          kind: "warning",
          okLabel: t("common.ok"),
          cancelLabel: t("common.cancel"),
        }
      );
      if (!confirmed) return;
    } catch (e) {
      setStatusMsg(t("settings.deletePageConfirmFailed", { error: String(e) }));
      return;
    }
    const remapPageAction = (item: DeckConfig["pages"][number]["slots"][string]) => {
      if (item.action.type !== "page") return item;
      const pi = item.action.pageIndex;
      const nextPi = pi === idx ? Math.min(idx, config.pages.length - 2) : pi > idx ? pi - 1 : pi;
      return nextPi === pi ? item : { ...item, action: { type: "page" as const, pageIndex: nextPi } };
    };
    const nextPages = config.pages
      .filter((_, i) => i !== idx)
      .map((p) => {
        const nextSlots: typeof p.slots = {};
        for (const [k, v] of Object.entries(p.slots)) {
          nextSlots[k] = remapPageAction(v);
        }
        return { ...p, slots: nextSlots };
      });
    const nextVault = config.vault?.map(remapPageAction);
    onChange({ ...config, pages: nextPages, ...(nextVault ? { vault: nextVault } : {}) });
    if (idx < currentPageIndex) {
      onSwitchPage(Math.max(0, currentPageIndex - 1));
    } else if (currentPageIndex >= nextPages.length) {
      onSwitchPage(nextPages.length - 1);
    }
  };

  const handleRenamePage = (idx: number, name: string) => {
    const nextPages = config.pages.map((p, i) => (i === idx ? { ...p, name } : p));
    onChange({ ...config, pages: nextPages });
  };

  const handleImportLaunchers = async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "launchers.json", extensions: ["json"] }],
    });
    if (!selected || typeof selected !== "string") return;
    try {
      const confirmed = await confirmDialog(
        t("settings.importLaunchersConfirm"),
        {
          title: t("settings.importLaunchers"),
          kind: "warning",
          okLabel: t("common.ok"),
          cancelLabel: t("common.cancel"),
        }
      );
      if (!confirmed) return;
      const count = await api.importLaunchersJson(selected);
      setStatusMsg(t("settings.launchersImported", { count }));
      onReloadFromDisk();
    } catch (e) {
      setStatusMsg(t("settings.importFailed", { error: String(e) }));
    }
  };

  const handleExportConfig = async () => {
    const selected = await saveDialog({
      defaultPath: "touchdeck-backup.json",
      filters: [{ name: t("settings.filterBackup"), extensions: ["json"] }],
    });
    if (!selected) return;
    try {
      await api.exportConfigFile(selected, config);
      setStatusMsg(t("settings.backupSaved", { path: selected }));
    } catch (e) {
      setStatusMsg(t("settings.backupFailed", { error: String(e) }));
    }
  };

  const handleImportConfig = async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: t("settings.filterBackup"), extensions: ["json"] }],
    });
    if (!selected || typeof selected !== "string") return;
    try {
      const confirmed = await confirmDialog(
        t("settings.importConfigConfirm"),
        {
          title: t("settings.importConfigTitle"),
          kind: "warning",
          okLabel: t("common.ok"),
          cancelLabel: t("common.cancel"),
        }
      );
      if (!confirmed) return;
      const restored = await api.importConfigFile(selected);
      if (currentPageIndex >= restored.pages.length) {
        onSwitchPage(0);
      }
      setStatusMsg(t("settings.restored"));
      onReloadFromDisk();
    } catch (e) {
      setStatusMsg(t("settings.restoreFailed", { error: String(e) }));
    }
  };

  const handleToggleAutostart = async (checked: boolean) => {
    try {
      const res = await api.setAutostart(checked);
      setEnvInfo((prev) => (prev ? { ...prev, autostart: res } : prev));
    } catch (e) {
      setStatusMsg(t("settings.autostartFailed", { error: String(e) }));
    }
  };

  const handleEnablePortable = async () => {
    try {
      const p = await api.enablePortableMode();
      setStatusMsg(t("settings.portableEnabled", { path: p }));
      const info = await api.getEnvInfo();
      setEnvInfo(info);
    } catch (e) {
      setStatusMsg(t("settings.portableFailed", { error: String(e) }));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card settings-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t("settings.title")}</span>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="field-row">
            <label>{t("settings.language")}</label>
            <select
              value={config.language ?? ""}
              onChange={(e) =>
                onChange({
                  ...config,
                  language: e.target.value ? toLanguage(e.target.value) : null,
                })
              }
            >
              <option value="">{t("settings.languageAuto")}</option>
              <option value="ko">한국어</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
            </select>
          </div>

          <div className="divider" />
          <div className="section-title">{t("settings.grid")}</div>
          <div className="field-row two-col">
            <div>
              <label>{t("settings.columns", { value: config.grid.columns })}</label>
              <input
                type="range"
                min={2}
                max={10}
                value={config.grid.columns}
                onChange={(e) => updateGrid({ columns: Number(e.target.value) })}
              />
            </div>
            <div>
              <label>{t("settings.rows", { value: config.grid.rows })}</label>
              <input
                type="range"
                min={1}
                max={8}
                value={config.grid.rows}
                onChange={(e) => updateGrid({ rows: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="field-row three-col">
            <div>
              <label>{t("settings.cellSize", { value: config.grid.cellSize })}</label>
              <input
                type="range"
                min={76}
                max={180}
                step={2}
                value={config.grid.cellSize}
                onChange={(e) => updateGrid({ cellSize: Number(e.target.value) })}
              />
            </div>
            <div>
              <label>{t("settings.gap", { value: config.grid.gap })}</label>
              <input
                type="range"
                min={4}
                max={24}
                value={config.grid.gap}
                onChange={(e) => updateGrid({ gap: Number(e.target.value) })}
              />
            </div>
            <div>
              <label>{t("settings.radius", { value: config.grid.borderRadius })}</label>
              <input
                type="range"
                min={0}
                max={32}
                value={config.grid.borderRadius}
                onChange={(e) => updateGrid({ borderRadius: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="divider" />
          <div className="section-title">{t("settings.theme")}</div>

          <div className="field-row two-col">
            <div>
              <label>{t("settings.bgType")}</label>
              <select
                value={config.theme.backgroundType}
                onChange={(e) => {
                  const nextType = e.target.value as DeckConfig["theme"]["backgroundType"];
                  const patch: Partial<DeckConfig["theme"]> = { backgroundType: nextType };
                  if (nextType === "image" && (config.theme.buttonStyle ?? "solid") === "solid") {
                    patch.buttonStyle = "glass";
                  }
                  updateTheme(patch);
                }}
              >
                <option value="solid">{t("settings.bgSolid")}</option>
                <option value="gradient">{t("settings.bgGradient")}</option>
                <option value="image">{t("settings.bgImage")}</option>
              </select>
            </div>
            <div>
              <label>{t("settings.font")}</label>
              <input
                type="text"
                value={config.theme.fontFamily}
                onChange={(e) => updateTheme({ fontFamily: e.target.value })}
                placeholder="Pretendard"
              />
            </div>
          </div>

          <div className="field-row">
            <label>{t("settings.buttonStyle")}</label>
            <div className="segmented-group">
              {(
                [
                  ["solid", "settings.styleSolid"],
                  ["glass", "settings.styleGlass"],
                  ["transparent", "settings.styleTransparent"],
                ] as const
              ).map(([val, textKey]) => (
                <button
                  key={val}
                  type="button"
                  className={`seg-btn ${
                    (config.theme.buttonStyle ?? "solid") === val ? "seg-btn-active" : ""
                  }`}
                  onClick={() => updateTheme({ buttonStyle: val })}
                >
                  {t(textKey)}
                </button>
              ))}
            </div>
          </div>

          {config.theme.backgroundType !== "image" ? (
            <div className="field-row two-col">
              <div>
                <label>{t("settings.bgColor")}</label>
                <input
                  type="color"
                  value={config.theme.backgroundColor}
                  onChange={(e) => updateTheme({ backgroundColor: e.target.value })}
                />
              </div>
              <div>
                <label>{t("settings.panelOpacity", { value: config.theme.backgroundOpacity })}</label>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={config.theme.backgroundOpacity}
                  onChange={(e) => updateTheme({ backgroundOpacity: Number(e.target.value) })}
                />
              </div>
            </div>
          ) : (
            <div className="field-row">
              <label>{t("settings.imageOpacity", { value: config.theme.backgroundOpacity })}</label>
              <input
                type="range"
                min={10}
                max={100}
                value={config.theme.backgroundOpacity}
                onChange={(e) => updateTheme({ backgroundOpacity: Number(e.target.value) })}
              />
            </div>
          )}

          {config.theme.backgroundType === "gradient" && (
            <div className="field-row">
              <label>{t("settings.gradientEnd")}</label>
              <input
                type="color"
                value={config.theme.gradientEndColor}
                onChange={(e) => updateTheme({ gradientEndColor: e.target.value })}
              />
            </div>
          )}

          {config.theme.backgroundType === "image" && (
            <>
              <div className="field-row">
                <label>{t("settings.themeImage")}</label>
                <div className="inline-group">
                  <button type="button" className="btn-secondary" onClick={handlePickBgImage}>
                    <ImageIcon size={14} /> {t("common.pickImage")}
                  </button>
                  {config.theme.backgroundImage && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() =>
                        updateTheme({
                          backgroundType: "solid",
                          backgroundImage: null,
                          buttonStyle: "solid",
                        })
                      }
                    >
                      {t("settings.remove")}
                    </button>
                  )}
                </div>
              </div>
              <div className="field-row two-col">
                <div>
                  <label>{t("settings.blur", { value: config.theme.backgroundBlur })}</label>
                  <input
                    type="range"
                    min={0}
                    max={24}
                    value={config.theme.backgroundBlur}
                    onChange={(e) => updateTheme({ backgroundBlur: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label>{t("settings.dim", { value: config.theme.backgroundDim })}</label>
                  <input
                    type="range"
                    min={0}
                    max={85}
                    value={config.theme.backgroundDim}
                    onChange={(e) => updateTheme({ backgroundDim: Number(e.target.value) })}
                  />
                </div>
              </div>
            </>
          )}

          {(config.theme.buttonStyle ?? "solid") === "solid" && (
            <div className="field-row two-col">
              <div>
                <label>{t("settings.defaultButtonColor")}</label>
                <input
                  type="color"
                  value={config.theme.defaultButtonColor}
                  onChange={(e) => updateTheme({ defaultButtonColor: e.target.value })}
                />
              </div>
              <div>
                <label>
                  {t("settings.defaultButtonOpacity", { value: config.theme.defaultButtonOpacity })}
                </label>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={config.theme.defaultButtonOpacity}
                  onChange={(e) => updateTheme({ defaultButtonOpacity: Number(e.target.value) })}
                />
              </div>
            </div>
          )}

          <div className="divider" />
          <div className="section-title-row">
            <span className="section-title">{t("settings.pages")}</span>
            <button type="button" className="btn-secondary" onClick={handleAddPage}>
              <Plus size={14} /> {t("settings.addPage")}
            </button>
          </div>
          <div className="page-list">
            {config.pages.map((p, idx) => (
              <div key={p.id} className="page-list-row">
                <span className="page-num">{idx + 1}</span>
                <input
                  type="text"
                  value={p.name}
                  onChange={(e) => handleRenamePage(idx, e.target.value)}
                />
                <button
                  type="button"
                  className="icon-btn"
                  disabled={config.pages.length <= 1}
                  onClick={() => handleDeletePage(idx)}
                  title={t("settings.deletePage")}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="divider" />
          <div className="section-title">{t("settings.discord")}</div>
          <div className="hint-text">
            {t("settings.discordStatus")}{" "}
            {t(
              discordState?.authenticated
                ? "settings.discordSynced"
                : discordState?.pipeConnected
                ? "settings.discordPending"
                : "settings.discordNone"
            )}
            {discordState?.lastError ? ` · ${discordState.lastError}` : ""}
          </div>
          <div className="field-row two-col">
            <div>
              <label>Application Client ID</label>
              <input
                type="text"
                value={dcClientId}
                onChange={(e) => setDcClientId(e.target.value)}
                placeholder="Discord Developer Portal Client ID"
              />
            </div>
            <div>
              <label>Client Secret</label>
              <input
                type="text"
                value={dcClientSecret}
                onChange={(e) => setDcClientSecret(e.target.value)}
                placeholder="OAuth2 Client Secret"
              />
            </div>
          </div>
          <div className="inline-group">
            <button
              type="button"
              className="btn-primary"
              disabled={!dcClientId.trim() || !dcClientSecret.trim()}
              onClick={async () => {
                try {
                  await api.authorizeDiscord(dcClientId.trim(), dcClientSecret.trim());
                  setStatusMsg(t("settings.discordAuthPrompt"));
                } catch (e) {
                  setStatusMsg(t("settings.discordError", { error: String(e) }));
                }
              }}
            >
              {t("settings.discordAuthorize")}
            </button>
            {discordState?.authenticated && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => api.disconnectDiscord().catch(() => {})}
              >
                {t("settings.discordDisconnect")}
              </button>
            )}
          </div>
          <div className="hint-text">
            {t("settings.discordHint")
              .split("{url}")
              .map((part, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <code>http://localhost</code>}
                  {part}
                </React.Fragment>
              ))}
          </div>

          <div className="divider" />
          <div className="section-title">{t("settings.window")}</div>
          <div className="check-grid">
            <label className="check-pill">
              <input
                type="checkbox"
                checked={config.theme.autoFontSize !== false}
                onChange={(e) => updateTheme({ autoFontSize: e.target.checked })}
              />
              {t("settings.autoFont")}
            </label>
            <label className="check-pill">
              <input
                type="checkbox"
                checked={config.theme.iconRounded !== false}
                onChange={(e) => updateTheme({ iconRounded: e.target.checked })}
              />
              {t("settings.iconRounded")}
            </label>
            <label className="check-pill">
              <input
                type="checkbox"
                checked={config.window.alwaysOnTop}
                onChange={(e) => updateWindow({ alwaysOnTop: e.target.checked })}
              />
              {t("settings.alwaysOnTop")}
            </label>
            <label className="check-pill">
              <input
                type="checkbox"
                checked={config.window.desktopLayer}
                onChange={(e) => updateWindow({ desktopLayer: e.target.checked })}
              />
              {t("settings.desktopLayer")}
            </label>
            <label className="check-pill">
              <input
                type="checkbox"
                checked={config.window.locked}
                onChange={(e) => updateWindow({ locked: e.target.checked })}
              />
              {t("common.lock")}
            </label>
            <label className="check-pill">
              <input
                type="checkbox"
                checked={envInfo?.autostart ?? false}
                onChange={(e) => handleToggleAutostart(e.target.checked)}
              />
              {t("settings.autostart")}
            </label>
          </div>

          <div className="inline-group" style={{ marginTop: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                api
                  .openDataFolder()
                  .catch((e) => setStatusMsg(t("settings.openDataFailed", { error: String(e) })))
              }
            >
              <FolderOpen size={14} /> {t("settings.openData")}
            </button>
            {!envInfo?.isPortable && (
              <button type="button" className="btn-secondary" onClick={handleEnablePortable}>
                {t("settings.portableSwitch")}
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={handleExportConfig}>
              <Upload size={14} /> {t("settings.exportConfig")}
            </button>
            <button type="button" className="btn-secondary" onClick={handleImportConfig}>
              <Download size={14} /> {t("settings.importConfig")}
            </button>
            <button type="button" className="btn-secondary" onClick={handleImportLaunchers}>
              <Download size={14} /> {t("settings.importLaunchers")}
            </button>
          </div>

          {envInfo && (
            <div className="hint-text" style={{ marginTop: 8 }}>
              {t("settings.dataPath", { path: envInfo.dataDir })}{" "}
              {envInfo.isPortable ? t("settings.portableTag") : ""}
            </div>
          )}

          <div className="divider" />
          <div className="section-title">{t("settings.update")}</div>
          <div className="inline-group" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
            <label className="check-pill">
              <input
                type="checkbox"
                checked={config.autoCheckUpdate !== false}
                onChange={(e) => onChange({ ...config, autoCheckUpdate: e.target.checked })}
              />
              {t("settings.autoCheck")}
            </label>
            <button
              type="button"
              className="btn-secondary"
              disabled={checkingUpdate || updating}
              onClick={async () => {
                setCheckingUpdate(true);
                try {
                  const info = await api.checkUpdate();
                  onUpdateInfo(info);
                  setStatusMsg(
                    info.hasUpdate
                      ? t("settings.updateAvailable", {
                          latest: info.latestVersion,
                          current: info.currentVersion,
                        })
                      : t("settings.upToDate", { current: info.currentVersion })
                  );
                } catch (e) {
                  setStatusMsg(t("settings.checkFailed", { error: String(e) }));
                } finally {
                  setCheckingUpdate(false);
                }
              }}
            >
              <RefreshCw size={13} /> {t(checkingUpdate ? "settings.checking" : "settings.checkNow")}
            </button>
          </div>
          {updateInfo?.hasUpdate && (
            <div className="update-box">
              <div className="inline-group" style={{ justifyContent: "space-between" }}>
                <strong>
                  {t("settings.newRelease", {
                    latest: updateInfo.latestVersion,
                    current: updateInfo.currentVersion,
                  })}
                </strong>
                {updateInfo.downloadUrl ? (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={updating}
                    onClick={async () => {
                      setUpdating(true);
                      setStatusMsg(t("settings.updating"));
                      try {
                        await api.applyUpdate(updateInfo.downloadUrl!);
                      } catch (e) {
                        setUpdating(false);
                        setStatusMsg(t("settings.updateFailed", { error: String(e) }));
                      }
                    }}
                  >
                    {t(updating ? "settings.applying" : "settings.autoUpdate")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() =>
                      api.executeAction({ type: "url", url: updateInfo.releaseUrl }).catch(() => {})
                    }
                  >
                    {t("settings.openRelease")}
                  </button>
                )}
              </div>
              {updateInfo.notes && <div className="hint-text">{updateInfo.notes.slice(0, 220)}</div>}
            </div>
          )}

          {statusMsg && <div className="status-banner">{statusMsg}</div>}
        </div>

        <div className="modal-footer">
          <span />
          <button type="button" className="btn-primary" onClick={onClose}>
            {t("common.done")}
          </button>
        </div>
      </div>
    </div>
  );
};
