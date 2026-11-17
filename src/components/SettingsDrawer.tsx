import React, { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, Image as ImageIcon, Plus, Trash2, X } from "lucide-react";
import { api } from "../api";
import type { DeckConfig, DiscordState, EnvInfo } from "../types";

interface Props {
  config: DeckConfig;
  currentPageIndex: number;
  discordState: DiscordState | null;
  onChange: (next: DeckConfig) => void;
  onSwitchPage: (idx: number) => void;
  onReloadFromDisk: () => void;
  onClose: () => void;
}

export const SettingsDrawer: React.FC<Props> = ({
  config,
  currentPageIndex,
  discordState,
  onChange,
  onSwitchPage,
  onReloadFromDisk,
  onClose,
}) => {
  const [envInfo, setEnvInfo] = useState<EnvInfo | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>("");
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
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "배경 이미지", extensions: ["png", "jpg", "jpeg", "webp"] }],
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
  };

  const handleAddPage = () => {
    const nextIdx = config.pages.length;
    const nextPages = [
      ...config.pages,
      { id: `page-${Date.now()}`, name: `페이지 ${nextIdx + 1}`, slots: {} },
    ];
    onChange({ ...config, pages: nextPages });
    onSwitchPage(nextIdx);
  };

  const handleDeletePage = (idx: number) => {
    if (config.pages.length <= 1) return;
    const nextPages = config.pages.filter((_, i) => i !== idx);
    onChange({ ...config, pages: nextPages });
    if (currentPageIndex >= nextPages.length) {
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
      const count = await api.importLaunchersJson(selected);
      setStatusMsg(`버튼 ${count}개를 불러왔습니다.`);
      onReloadFromDisk();
    } catch (e) {
      setStatusMsg(`가져오기 실패: ${String(e)}`);
    }
  };

  const handleToggleAutostart = async (checked: boolean) => {
    try {
      const res = await api.setAutostart(checked);
      setEnvInfo((prev) => (prev ? { ...prev, autostart: res } : prev));
    } catch (e) {
      setStatusMsg(`자동 시작 설정 실패: ${String(e)}`);
    }
  };

  const handleEnablePortable = async () => {
    try {
      const p = await api.enablePortableMode();
      setStatusMsg(`포터블 폴더 활성화됨: ${p}`);
      const info = await api.getEnvInfo();
      setEnvInfo(info);
    } catch (e) {
      setStatusMsg(`포터블 전환 실패: ${String(e)}`);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card settings-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>TouchDeck 설정 및 테마</span>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="section-title">그리드 레이아웃</div>
          <div className="field-row two-col">
            <div>
              <label>가로 칸 수 ({config.grid.columns})</label>
              <input
                type="range"
                min={2}
                max={10}
                value={config.grid.columns}
                onChange={(e) => updateGrid({ columns: Number(e.target.value) })}
              />
            </div>
            <div>
              <label>세로 줄 수 ({config.grid.rows})</label>
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
              <label>칸 크기 ({config.grid.cellSize}px)</label>
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
              <label>간격 ({config.grid.gap}px)</label>
              <input
                type="range"
                min={4}
                max={24}
                value={config.grid.gap}
                onChange={(e) => updateGrid({ gap: Number(e.target.value) })}
              />
            </div>
            <div>
              <label>모서리 ({config.grid.borderRadius}px)</label>
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
          <div className="section-title">전체 배경 & 테마</div>

          <div className="field-row two-col">
            <div>
              <label>배경 방식</label>
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
                <option value="solid">단색 + 투명도</option>
                <option value="gradient">그라데이션</option>
                <option value="image">배경 이미지 테마</option>
              </select>
            </div>
            <div>
              <label>글꼴</label>
              <input
                type="text"
                value={config.theme.fontFamily}
                onChange={(e) => updateTheme({ fontFamily: e.target.value })}
                placeholder="Pretendard"
              />
            </div>
          </div>

          <div className="field-row">
            <label>버튼 스타일 (배경 이미지 사용 시 글래스/투명 추천)</label>
            <div className="segmented-group">
              {(
                [
                  ["solid", "솔리드"],
                  ["glass", "반투명 글래스"],
                  ["transparent", "투명 + 그림자"],
                ] as const
              ).map(([val, text]) => (
                <button
                  key={val}
                  type="button"
                  className={`seg-btn ${
                    (config.theme.buttonStyle ?? "solid") === val ? "seg-btn-active" : ""
                  }`}
                  onClick={() => updateTheme({ buttonStyle: val })}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>

          {config.theme.backgroundType !== "image" ? (
            <div className="field-row two-col">
              <div>
                <label>배경색</label>
                <input
                  type="color"
                  value={config.theme.backgroundColor}
                  onChange={(e) => updateTheme({ backgroundColor: e.target.value })}
                />
              </div>
              <div>
                <label>패널 투명도 ({config.theme.backgroundOpacity}%)</label>
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
              <label>배경 이미지 투명도 ({config.theme.backgroundOpacity}%)</label>
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
              <label>그라데이션 끝 색상</label>
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
                <label>테마 배경 이미지</label>
                <div className="inline-group">
                  <button type="button" className="btn-secondary" onClick={handlePickBgImage}>
                    <ImageIcon size={14} /> 이미지 선택
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
                      제거
                    </button>
                  )}
                </div>
              </div>
              <div className="field-row two-col">
                <div>
                  <label>이미지 블러 ({config.theme.backgroundBlur}px)</label>
                  <input
                    type="range"
                    min={0}
                    max={24}
                    value={config.theme.backgroundBlur}
                    onChange={(e) => updateTheme({ backgroundBlur: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label>어둡기 오버레이 ({config.theme.backgroundDim}%)</label>
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
                <label>기본 버튼 색</label>
                <input
                  type="color"
                  value={config.theme.defaultButtonColor}
                  onChange={(e) => updateTheme({ defaultButtonColor: e.target.value })}
                />
              </div>
              <div>
                <label>기본 버튼 투명도 ({config.theme.defaultButtonOpacity}%)</label>
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
            <span className="section-title">페이지 관리</span>
            <button type="button" className="btn-secondary" onClick={handleAddPage}>
              <Plus size={14} /> 페이지 추가
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
                  title="페이지 삭제"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="divider" />
          <div className="section-title">Discord 양방향 RPC 연동</div>
          <div className="hint-text">
            상태:{" "}
            {discordState?.authenticated
              ? "양방향 동기화 연결됨 (실시간 반영 중)"
              : discordState?.pipeConnected
              ? "Discord 앱 연결됨 (승인 대기)"
              : "미연결"}
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
                  setStatusMsg("Discord 앱에 뜨는 '승인(Authorize)' 창을 확인해 주세요.");
                } catch (e) {
                  setStatusMsg(`Discord 연결 오류: ${String(e)}`);
                }
              }}
            >
              Discord 승인 / 연결
            </button>
            {discordState?.authenticated && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => api.disconnectDiscord().catch(() => {})}
              >
                연결 해제
              </button>
            )}
          </div>
          <div className="hint-text">
            * Discord Developer Portal → New Application → OAuth2 Redirects에 <code>http://localhost</code> 추가 후 ID/Secret 입력
          </div>

          <div className="divider" />
          <div className="section-title">창 동작 & 외관 옵션</div>
          <div className="check-grid">
            <label className="check-pill">
              <input
                type="checkbox"
                checked={config.theme.autoFontSize !== false}
                onChange={(e) => updateTheme({ autoFontSize: e.target.checked })}
              />
              칸 크기 비례 글자 크기
            </label>
            <label className="check-pill">
              <input
                type="checkbox"
                checked={config.theme.iconRounded !== false}
                onChange={(e) => updateTheme({ iconRounded: e.target.checked })}
              />
              아이콘 둥근 모서리
            </label>
            <label className="check-pill">
              <input
                type="checkbox"
                checked={config.window.alwaysOnTop}
                onChange={(e) => updateWindow({ alwaysOnTop: e.target.checked })}
              />
              항상 위에 고정
            </label>
            <label className="check-pill">
              <input
                type="checkbox"
                checked={config.window.desktopLayer}
                onChange={(e) => updateWindow({ desktopLayer: e.target.checked })}
              />
              바탕화면 보기(Win+D) 유지
            </label>
            <label className="check-pill">
              <input
                type="checkbox"
                checked={config.window.locked}
                onChange={(e) => updateWindow({ locked: e.target.checked })}
              />
              위치/편집 잠금
            </label>
            <label className="check-pill">
              <input
                type="checkbox"
                checked={envInfo?.autostart ?? false}
                onChange={(e) => handleToggleAutostart(e.target.checked)}
              />
              Windows 시작 시 실행
            </label>
          </div>

          <div className="inline-group" style={{ marginTop: 10, flexWrap: "wrap" }}>
            <button type="button" className="btn-secondary" onClick={() => api.openDataFolder()}>
              <FolderOpen size={14} /> 데이터 폴더 열기
            </button>
            {!envInfo?.isPortable && (
              <button type="button" className="btn-secondary" onClick={handleEnablePortable}>
                포터블 모드 전환 (exe 옆 data/)
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={handleImportLaunchers}>
              <Download size={14} /> launchers.json 가져오기
            </button>
          </div>

          {envInfo && (
            <div className="hint-text" style={{ marginTop: 8 }}>
              저장 경로: {envInfo.dataDir} {envInfo.isPortable ? "(포터블)" : ""}
            </div>
          )}
          {statusMsg && <div className="status-banner">{statusMsg}</div>}
        </div>

        <div className="modal-footer">
          <span />
          <button type="button" className="btn-primary" onClick={onClose}>
            완료
          </button>
        </div>
      </div>
    </div>
  );
};
