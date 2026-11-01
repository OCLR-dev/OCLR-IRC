; Per-user URI registration is required before the first app launch.
; Only remove our own command, preserving a handler installed by another copy.
!macro customInstall
  WriteRegStr HKCU "Software\Classes\oclr-irc" "" "URL:OCLR IRC"
  WriteRegStr HKCU "Software\Classes\oclr-irc" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\oclr-irc\DefaultIcon" "" '"$INSTDIR\OCLR IRC.exe",0'
  WriteRegStr HKCU "Software\Classes\oclr-irc\shell\open\command" "" '"$INSTDIR\OCLR IRC.exe" "%1"'
!macroend

!macro customUnInstall
  Push $0
  ReadRegStr $0 HKCU "Software\Classes\oclr-irc\shell\open\command" ""
  StrCmp $0 '"$INSTDIR\OCLR IRC.exe" "%1"' 0 +2
  DeleteRegKey HKCU "Software\Classes\oclr-irc"
  Pop $0
!macroend
