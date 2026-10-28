# macOS「App 已損毀」：0.4.1 打包修正

2026-10-28：使用者回報下載的 macOS 測試版顯示已損毀。在既有本機 0.4.0 打包產物執行 `codesign --verify --deep --strict`，重現 `code has no resources but signature indicates they must be present`。主 executable 只有 Electron/linker 的 ad-hoc 資訊，未形成有效的完整 App resource seal。先前 CI 只測試開發 Electron 與打包程序成功，未驗證下載成品的簽章與啟動，這是驗收缺漏。

## 修正

- 0.4.1 改用既有 `@electron/packager` API 與其內建 `@electron/osx-sign`，明確以 ad-hoc identity 簽署 nested frameworks／helpers 及整個 App；簽章失敗直接使打包失敗，不降級成警告。
- 固定 bundle ID `org.oclr.ref-tools`。維持既有非 hardened runtime，使用 Electron JIT 所需 entitlement；不增加相機、麥克風等無關授權，不停用 renderer sandbox。
- 打包後執行 strict／deep 簽章驗證。CI 產生 ZIP 後再解壓到臨時目錄，驗證簽章，啟動真正打包的 executable，透過僅測試程序的 localhost DevTools 確認登入畫面與有限 preload IPC 可用、未連線 IRC。
- 驗證通過才上傳 macOS artifact；Release CI 共用同一流程。metadata 明示 ad-hoc、未 notarized，`signed:false` 保留「沒有公開發行身分簽章」語意。

## 仍然存在的 macOS 發行限制

Ad-hoc 簽章只能處理程式完整性，不證明開發者身分，也不等於 Apple 公證。這次本機／CI 的解壓啟動不代表瀏覽器下載附帶 quarantine 的 Gatekeeper 驗收已通過。正式免手動放行的發行仍需要 Developer ID 憑證及 Apple notarization；目前未配置，也不宣稱已完成。

請使用新測試包，不要重複下載原 0.4.0 檔案。若新版是開發者無法驗證的提示，可依 Apple 官方方式在系統設定 → 隱私權與安全性檢查「仍要打開」。若仍顯示「已損毀」，請回報下載的版本／commit 與完整提示，不要關閉全系統 Gatekeeper 或清除整個下載目錄的隔離資訊。更換 bundle ID／簽章可能使原有安全保存重新要求授權；必要時由 App 手動重新登入，不直接操作金鑰鏈內容。

官方說明：[Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)、[Apple：安全開啟 App](https://support.apple.com/102445)。
