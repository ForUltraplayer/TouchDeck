; @file installer-hooks.nsh
; @brief NSIS hooks: remove the autostart shortcut the app creates when it is uninstalled.

!macro NSIS_HOOK_POSTUNINSTALL
  ; The app itself writes this shortcut, so the uninstaller does not know about it.
  ; An update reinstall must keep it, and only remove it if it targets this install
  ; (leaving a separate portable copy's autostart shortcut untouched).
  ${If} $UpdateMode <> 1
    !insertmacro IsShortcutTarget "$SMSTARTUP\TouchDeck.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      Delete "$SMSTARTUP\TouchDeck.lnk"
    ${EndIf}
  ${EndIf}
!macroend
