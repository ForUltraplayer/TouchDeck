; @file installer-hooks.nsh
; @brief NSIS hooks: remove the autostart shortcut the app creates when it is uninstalled.

!macro NSIS_HOOK_POSTUNINSTALL
  ; The app itself writes this shortcut, so the uninstaller does not know about it.
  ; An update reinstall must keep it.
  ${If} $UpdateMode <> 1
    Delete "$SMSTARTUP\TouchDeck.lnk"
  ${EndIf}
!macroend
