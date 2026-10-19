; Lyrique's Windows installer: one privacy screen, then a per-user install (no admin rights).

; Always install for the current user: skips the "just me / everyone" screen.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; Inserted just before the license page: turn that page into the privacy notice.
!macro customWelcomePage
  !define MUI_PAGE_HEADER_TEXT "Your privacy"
  !define MUI_PAGE_HEADER_SUBTEXT "What Lyrique sends, and where."
  !define MUI_LICENSEPAGE_TEXT_TOP "Please read how Lyrique uses the internet."
  !define MUI_LICENSEPAGE_TEXT_BOTTOM "Click Continue to install Lyrique for your account. No administrator rights are needed."
  !define MUI_LICENSEPAGE_BUTTON "Continue"
!macroend
