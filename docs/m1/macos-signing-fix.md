# macOS「App 已損毀」：0.4.1 打包修正

> 已追加 Developer ID 簽章與 Apple 公證，請優先使用 [已公證下載與結果](../apple-signing-ci.md#實際驗證結果2026-10-28)。本文保留前一階段 ad-hoc 修正紀錄。

2026-10-28：使用者回報下載的 macOS 測試版顯示已損毀。在既有本機 0.4.0 打包產物執行 `codesign --verify --deep --strict`，重現 `code has no resources but signature indicates they must be present`。主 executable 只有 Electron/linker 的 ad-hoc 資訊，未形成有效的完整 App resource seal。另已下載先前提供的 CI 成品 `0.4.0-macos-arm64-1c0cc7f`，SHA-256 校驗通過，但解壓後重現相同簽章錯誤，確認並非下載內容與校驗碼不符。先前 CI 只測試開發 Electron 與打包程序成功，未驗證下載成品的簽章與啟動，這是驗收缺漏。

## 修正

- 0.4.1 改用既有 `@electron/packager` API 與其內建 `@electron/osx-sign`，明確以 ad-hoc identity 簽署 nested frameworks／helpers 及整個 App；簽章失敗直接使打包失敗，不降級成警告。
- 固定 bundle ID `org.oclr.ref-tools`。維持既有非 hardened runtime，使用 Electron JIT 所需 entitlement；不增加相機、麥克風等無關授權，不停用 renderer sandbox。
- 打包後執行 strict／deep 簽章驗證。CI 產生 ZIP 後再解壓到臨時目錄，驗證簽章，啟動真正打包的 executable，透過僅測試程序的 localhost DevTools 確認登入畫面與有限 preload IPC 可用、未連線 IRC。
- 驗證通過才上傳 macOS artifact；Release CI 共用同一流程。metadata 明示 ad-hoc、未 notarized，`signed:false` 保留「沒有公開發行身分簽章」語意。

## 仍然存在的 macOS 發行限制

Ad-hoc 簽章只能處理程式完整性，不證明開發者身分，也不等於 Apple 公證。這次本機／CI 的解壓啟動不代表瀏覽器下載附帶 quarantine 的 Gatekeeper 驗收已通過。正式免手動放行的發行仍需要 Developer ID 憑證及 Apple notarization；目前未配置，也不宣稱已完成。

請使用新測試包，不要重複下載原 0.4.0 檔案。若新版是開發者無法驗證的提示，可依 Apple 官方方式在系統設定 → 隱私權與安全性檢查「仍要打開」。若仍顯示「已損毀」，請回報下載的版本／commit 與完整提示，不要關閉全系統 Gatekeeper 或清除整個下載目錄的隔離資訊。更換 bundle ID／簽章可能使原有安全保存重新要求授權；必要時由 App 手動重新登入，不直接操作金鑰鏈內容。

官方說明：[Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)、[Apple：安全開啟 App](https://support.apple.com/102445)。

本機 0.4.1 實測：完整 App strict／deep 簽章驗證通過；ZIP 解壓後再次驗證通過；真正打包 executable 可進入離線登入畫面，preload IPC 可用。沒有使用 IRC 憑證或操作真實房間。

## 修正版下載與 CI 結果

[下載 0.4.1 macOS Apple Silicon arm64](https://github.com/OCLR-dev/OCLR-ref-tools/actions/runs/40617344257/artifacts/12784994680)（約 130 MB，登入 GitHub 後下載；先解外層 ZIP，再解內層 ZIP）。來源 commit `9c05a921123cdf31191578449a0cb4ad7b18ae57`。

[CI run 40617344257](https://github.com/OCLR-dev/OCLR-ref-tools/actions/runs/40617344257) 的 macOS job 已成功，包含 28 項核心測試、Electron smoke、完整 App 簽章、ZIP 解壓後 strict／deep 驗證及真正 executable 啟動檢查；[QA artifact](https://github.com/OCLR-dev/OCLR-ref-tools/actions/runs/40617344257/artifacts/12785637185) 內有 `mac-archive-verification.json`。未以此宣稱 Apple 公證或 Gatekeeper 下載端已驗收。
