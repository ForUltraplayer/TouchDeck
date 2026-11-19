// @file i18n.rs
// @brief Backend UI language state and Korean / English / Japanese texts.

use std::fmt::Display;
use std::path::Path;
use std::sync::atomic::{AtomicU8, Ordering};
use windows::Win32::Globalization::GetUserDefaultUILanguage;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Ko,
    En,
    Ja,
}

impl Lang {
    pub fn code(self) -> &'static str {
        match self {
            Lang::Ko => "ko",
            Lang::En => "en",
            Lang::Ja => "ja",
        }
    }

    pub fn from_code(code: &str) -> Option<Lang> {
        match code {
            "ko" => Some(Lang::Ko),
            "en" => Some(Lang::En),
            "ja" => Some(Lang::Ja),
            _ => None,
        }
    }

    // Primary language id of a Windows LANGID; anything unsupported is English.
    fn from_langid(langid: u16) -> Lang {
        match langid & 0x3ff {
            0x12 => Lang::Ko,
            0x11 => Lang::Ja,
            _ => Lang::En,
        }
    }
}

// 0 = not set yet (follow Windows), otherwise `Lang as u8 + 1`.
static CURRENT: AtomicU8 = AtomicU8::new(0);

/// Supported language matching the Windows display language of the user.
pub fn system() -> Lang {
    Lang::from_langid(unsafe { GetUserDefaultUILanguage() })
}

/// Language of every user-facing string the backend produces.
pub fn current() -> Lang {
    match CURRENT.load(Ordering::Relaxed) {
        1 => Lang::Ko,
        2 => Lang::En,
        3 => Lang::Ja,
        _ => system(),
    }
}

fn effective(config_language: Option<&str>) -> Lang {
    config_language.and_then(Lang::from_code).unwrap_or_else(system)
}

/// Applies the `language` field of a config; `None` or an unknown code follows Windows.
pub fn set_current(config_language: Option<&str>) {
    CURRENT.store(effective(config_language) as u8 + 1, Ordering::Relaxed);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Text {
    // Tray menu
    TrayShow,
    TrayHide,
    TraySettings,
    TrayQuit,
    // Default config
    PageMain,
    PageMedia,
    LabelVolumeDown,
    LabelMute,
    LabelVolumeUp,
    LabelMic,
    LabelSwitchOutput,
    LabelPrevTrack,
    LabelPlayPause,
    LabelNextTrack,
    LabelSystem,
    LabelClock,
    // Config
    ConfigReadFailed,
    ConfigCorruptBackupFailed,
    ImportBackupFailed,
    FileDoesNotExist,
    FileNotFound,
    ConfigCopyFailed,
    AssetCopyFailed,
    ExportOntoLiveConfig,
    InvalidConfigJson,
    ConfigHasNoPages,
    // Actions
    OutputDevice,
    UnknownVolumeCommand,
    UnknownMediaCommand,
    NoActiveOutputDevice,
    AudioDeviceNotFound,
    UnsupportedKey,
    NoValidHotkey,
    // Launch failure reasons
    LaunchFileNotFound,
    LaunchPathNotFound,
    LaunchAccessDenied,
    LaunchNoAssociation,
    LaunchFailed,
    // Discord
    DiscordBridgeNotReady,
    DiscordNotConnected,
    UnknownDiscordCommand,
    DiscordSendFailed,
    DiscordAppNotFound,
    DiscordRpcError,
    OAuthJsonParseFailed,
    OAuthError,
    OAuthNoAccessToken,
    OAuthRefreshFailed,
    // Shortcuts and favicons
    UrlEntryNotFound,
    InvalidDomain,
    FaviconEmpty,
    ImageDecodeFailed,
    FaviconSaveFailed,
    // Updater
    UnsupportedUrl,
    HttpErrorStatus,
    DownloadTooLarge,
    JsonParseFailed,
    ReleaseTagNotFound,
    DownloadUrlNotAllowed,
    ExePathFailed,
    InstallDirNotWritable,
    DownloadedExeInvalid,
    TempFileSaveFailed,
    UpdateScriptFailed,
    UpdaterLaunchFailed,
}

impl Text {
    pub fn in_lang(self, lang: Lang) -> &'static str {
        // [ko, en, ja]
        let all: [&'static str; 3] = match self {
            Text::TrayShow => ["TouchDeck 보이기", "Show TouchDeck", "TouchDeck を表示"],
            Text::TrayHide => ["숨기기", "Hide", "非表示"],
            Text::TraySettings => ["설정 열기", "Open Settings", "設定を開く"],
            Text::TrayQuit => ["종료", "Quit", "終了"],

            Text::PageMain => ["메인", "Main", "メイン"],
            Text::PageMedia => ["미디어", "Media", "メディア"],
            Text::LabelVolumeDown => ["볼륨 -", "Volume -", "音量 -"],
            Text::LabelMute => ["음소거", "Mute", "ミュート"],
            Text::LabelVolumeUp => ["볼륨 +", "Volume +", "音量 +"],
            Text::LabelMic => ["마이크", "Mic", "マイク"],
            Text::LabelSwitchOutput => ["출력 전환", "Switch Output", "出力切替"],
            Text::LabelPrevTrack => ["이전 곡", "Previous", "前の曲"],
            Text::LabelPlayPause => ["재생/정지", "Play/Pause", "再生/停止"],
            Text::LabelNextTrack => ["다음 곡", "Next", "次の曲"],
            Text::LabelSystem => ["시스템", "System", "システム"],
            Text::LabelClock => ["시계", "Clock", "時計"],

            Text::ConfigReadFailed => [
                "설정 파일을 읽을 수 없습니다",
                "Could not read the settings file",
                "設定ファイルを読み込めません",
            ],
            Text::ConfigCorruptBackupFailed => [
                "설정 파일이 손상되었지만 백업을 만들지 못해 초기화하지 않았습니다",
                "The settings file is corrupted, but it was not reset because a backup could not be created",
                "設定ファイルが破損していますが、バックアップを作成できなかったため初期化しませんでした",
            ],
            Text::ImportBackupFailed => [
                "가져오기 전 설정 백업에 실패해 가져오기를 취소했습니다",
                "The import was cancelled because the current settings could not be backed up",
                "現在の設定をバックアップできなかったため、インポートを中止しました",
            ],
            Text::FileDoesNotExist => [
                "파일이 존재하지 않습니다",
                "The file does not exist",
                "ファイルが存在しません",
            ],
            Text::FileNotFound => [
                "파일을 찾을 수 없습니다",
                "File not found",
                "ファイルが見つかりません",
            ],
            Text::ConfigCopyFailed => [
                "config.json 복사 실패",
                "Failed to copy config.json",
                "config.json のコピーに失敗しました",
            ],
            Text::AssetCopyFailed => [
                "에셋 복사 실패",
                "Failed to copy assets",
                "アセットのコピーに失敗しました",
            ],
            Text::ExportOntoLiveConfig => [
                "사용 중인 config.json에는 내보낼 수 없습니다. 다른 위치를 선택해 주세요.",
                "Cannot export over the config.json in use. Please choose another location.",
                "使用中の config.json にはエクスポートできません。別の場所を選択してください。",
            ],
            Text::InvalidConfigJson => [
                "올바른 TouchDeck 설정 JSON이 아닙니다",
                "Not a valid TouchDeck settings JSON",
                "有効な TouchDeck 設定 JSON ではありません",
            ],
            Text::ConfigHasNoPages => [
                "페이지 데이터가 없는 설정 파일입니다.",
                "This settings file contains no page data.",
                "ページデータのない設定ファイルです。",
            ],

            Text::OutputDevice => ["출력 장치", "Output device", "出力デバイス"],
            Text::UnknownVolumeCommand => [
                "알 수 없는 볼륨 명령",
                "Unknown volume command",
                "不明な音量コマンド",
            ],
            Text::UnknownMediaCommand => [
                "알 수 없는 미디어 명령",
                "Unknown media command",
                "不明なメディアコマンド",
            ],
            Text::NoActiveOutputDevice => [
                "활성 오디오 출력 장치가 없습니다.",
                "No active audio output device.",
                "有効なオーディオ出力デバイスがありません。",
            ],
            Text::AudioDeviceNotFound => [
                "지정한 오디오 장치를 찾을 수 없습니다.",
                "The specified audio device was not found.",
                "指定したオーディオデバイスが見つかりません。",
            ],
            Text::UnsupportedKey => [
                "지원하지 않는 키",
                "Unsupported key",
                "サポートされていないキー",
            ],
            Text::NoValidHotkey => [
                "유효한 단축키가 없습니다.",
                "No valid hotkey.",
                "有効なショートカットキーがありません。",
            ],

            Text::LaunchFileNotFound => [
                "파일을 찾을 수 없음",
                "file not found",
                "ファイルが見つかりません",
            ],
            Text::LaunchPathNotFound => [
                "경로를 찾을 수 없음",
                "path not found",
                "パスが見つかりません",
            ],
            Text::LaunchAccessDenied => ["액세스 거부", "access denied", "アクセスが拒否されました"],
            Text::LaunchNoAssociation => [
                "연결된 프로그램 없음",
                "no associated program",
                "関連付けられたプログラムがありません",
            ],
            Text::LaunchFailed => ["실행 실패", "failed to launch", "起動に失敗しました"],

            Text::DiscordBridgeNotReady => [
                "Discord 브리지가 초기화되지 않았습니다.",
                "The Discord bridge is not initialized.",
                "Discord ブリッジが初期化されていません。",
            ],
            Text::DiscordNotConnected => [
                "Discord RPC가 연결되지 않았습니다. 설정에서 승인해 주세요.",
                "Discord RPC is not connected. Please authorize it in Settings.",
                "Discord RPC に接続されていません。設定で認証してください。",
            ],
            Text::UnknownDiscordCommand => [
                "알 수 없는 Discord 명령",
                "Unknown Discord command",
                "不明な Discord コマンド",
            ],
            Text::DiscordSendFailed => [
                "Discord 워커 전송 실패",
                "Failed to send to the Discord worker",
                "Discord ワーカーへの送信に失敗しました",
            ],
            Text::DiscordAppNotFound => [
                "실행 중인 Discord 데스크톱 앱을 찾지 못했습니다.",
                "Could not find a running Discord desktop app.",
                "実行中の Discord デスクトップアプリが見つかりませんでした。",
            ],
            Text::DiscordRpcError => ["Discord RPC 오류", "Discord RPC error", "Discord RPC エラー"],
            Text::OAuthJsonParseFailed => [
                "OAuth JSON 파싱 실패",
                "Failed to parse the OAuth JSON",
                "OAuth JSON の解析に失敗しました",
            ],
            Text::OAuthError => ["OAuth 오류", "OAuth error", "OAuth エラー"],
            Text::OAuthNoAccessToken => [
                "access_token 없음",
                "No access_token",
                "access_token がありません",
            ],
            Text::OAuthRefreshFailed => [
                "refresh 실패",
                "Token refresh failed",
                "トークンの更新に失敗しました",
            ],

            Text::UrlEntryNotFound => [
                "URL= 항목을 찾지 못했습니다.",
                "No URL= entry was found.",
                "URL= の項目が見つかりませんでした。",
            ],
            Text::InvalidDomain => [
                "유효한 도메인이 아닙니다.",
                "Not a valid domain.",
                "有効なドメインではありません。",
            ],
            Text::FaviconEmpty => [
                "파비콘 응답이 비어 있습니다.",
                "The favicon response was empty.",
                "ファビコンの応答が空です。",
            ],
            Text::ImageDecodeFailed => [
                "이미지 디코드 실패",
                "Failed to decode the image",
                "画像のデコードに失敗しました",
            ],
            Text::FaviconSaveFailed => [
                "파비콘 저장 실패",
                "Failed to save the favicon",
                "ファビコンの保存に失敗しました",
            ],

            Text::UnsupportedUrl => ["지원하지 않는 URL", "Unsupported URL", "サポートされていない URL"],
            Text::HttpErrorStatus => [
                "HTTP 오류 상태 코드",
                "HTTP error status code",
                "HTTP エラーステータスコード",
            ],
            Text::DownloadTooLarge => [
                "다운로드 크기가 제한을 초과했습니다.",
                "The download exceeds the size limit.",
                "ダウンロードサイズが上限を超えました。",
            ],
            Text::JsonParseFailed => [
                "JSON 파싱 실패",
                "Failed to parse JSON",
                "JSON の解析に失敗しました",
            ],
            Text::ReleaseTagNotFound => [
                "릴리즈 태그 정보를 찾지 못했습니다.",
                "Release tag information was not found.",
                "リリースタグ情報が見つかりませんでした。",
            ],
            Text::DownloadUrlNotAllowed => [
                "허용되지 않은 다운로드 주소입니다. 릴리즈 페이지에서 직접 다운로드해 주세요.",
                "This download URL is not allowed. Please download it from the releases page.",
                "許可されていないダウンロード URL です。リリースページから直接ダウンロードしてください。",
            ],
            Text::ExePathFailed => [
                "실행 경로 확인 실패",
                "Could not determine the executable path",
                "実行ファイルのパスを確認できませんでした",
            ],
            Text::InstallDirNotWritable => [
                "설치 폴더에 쓰기 권한이 없어 자동 교체할 수 없습니다. 릴리즈 페이지에서 직접 다운로드해 주세요.",
                "The install folder is not writable, so the app cannot be replaced automatically. Please download it from the releases page.",
                "インストールフォルダーに書き込み権限がないため、自動で置き換えできません。リリースページから直接ダウンロードしてください。",
            ],
            Text::DownloadedExeInvalid => [
                "다운로드된 실행 파일이 올바르지 않습니다.",
                "The downloaded executable is not valid.",
                "ダウンロードした実行ファイルが正しくありません。",
            ],
            Text::TempFileSaveFailed => [
                "임시 파일 저장 실패",
                "Failed to save the temporary file",
                "一時ファイルの保存に失敗しました",
            ],
            Text::UpdateScriptFailed => [
                "업데이트 스크립트 실패",
                "Failed to write the update script",
                "更新スクリプトの作成に失敗しました",
            ],
            Text::UpdaterLaunchFailed => [
                "업데이터 실행 실패",
                "Failed to start the updater",
                "アップデーターの起動に失敗しました",
            ],
        };
        all[lang as usize]
    }
}

/// `text` in the current language.
pub fn t(text: Text) -> &'static str {
    text.in_lang(current())
}

/// `text` in the current language followed by a value or technical detail.
pub fn detail(text: Text, detail: impl Display) -> String {
    format!("{}: {detail}", t(text))
}

pub fn launch_failed(target: &str, reason: Text, code: isize) -> String {
    let lang = current();
    let reason = reason.in_lang(lang);
    match lang {
        Lang::Ko => format!("{target} ({reason}, 코드 {code})"),
        Lang::En => format!("{target} ({reason}, code {code})"),
        Lang::Ja => format!("{target} ({reason}、コード {code})"),
    }
}

pub fn config_reset_notice(backup: &Path) -> String {
    let backup = backup.display();
    match current() {
        Lang::Ko => format!(
            "설정 파일이 손상되어 기본값으로 초기화했습니다. 기존 파일은 {backup} 에 백업했습니다. 복구하려면 앱을 종료한 뒤 그 파일을 고쳐 config.json으로 되돌리세요."
        ),
        Lang::En => format!(
            "The settings file was corrupted and has been reset to defaults. The previous file was backed up to {backup}. To restore it, quit the app, fix that file and rename it back to config.json."
        ),
        Lang::Ja => format!(
            "設定ファイルが破損していたため、既定値に初期化しました。元のファイルは {backup} にバックアップしました。復元するには、アプリを終了してからそのファイルを修正し、config.json に戻してください。"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn langid_maps_to_supported_language() {
        assert_eq!(Lang::from_langid(0x0412), Lang::Ko);
        assert_eq!(Lang::from_langid(0x0411), Lang::Ja);
        assert_eq!(Lang::from_langid(0x0409), Lang::En);
        assert_eq!(Lang::from_langid(0x0407), Lang::En);
    }

    #[test]
    fn config_language_overrides_system_language() {
        assert_eq!(effective(Some("ko")), Lang::Ko);
        assert_eq!(effective(Some("en")), Lang::En);
        assert_eq!(effective(Some("ja")), Lang::Ja);
        assert_eq!(effective(None), system());
        assert_eq!(effective(Some("fr")), system());
    }

    #[test]
    fn language_codes_round_trip() {
        for lang in [Lang::Ko, Lang::En, Lang::Ja] {
            assert_eq!(Lang::from_code(lang.code()), Some(lang));
        }
        assert_eq!(Text::TrayQuit.in_lang(Lang::Ko), "종료");
        assert_eq!(Text::TrayQuit.in_lang(Lang::En), "Quit");
        assert_eq!(Text::TrayQuit.in_lang(Lang::Ja), "終了");
    }
}
