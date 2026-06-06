!macro recreateShortcutWithAppIcon linkPath
  Delete "${linkPath}"
  CreateShortCut "${linkPath}" "$appExe" "" "$INSTDIR\resources\assets\icons\flow-shuttle-icon.ico" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "${linkPath}" "${APP_ID}"
!macroend

!macro customInstall
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    !insertmacro recreateShortcutWithAppIcon $newStartMenuLink
  !endif

  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    ${ifNot} ${isNoDesktopShortcut}
      !insertmacro recreateShortcutWithAppIcon $newDesktopLink
    ${endIf}
  !endif

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
