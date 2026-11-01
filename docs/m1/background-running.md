# 0.7.0 背景執行

2026-10-29 新增原生背景生命週期，不增加套件。

## 操作

- 在「設定 → 一般」勾選「關閉視窗後在背景執行」（預設開啟），再關閉視窗：保留原本視窗、IRC／OCLR session、分頁與本次記憶體訊息。Windows／macOS 有系統匣時隱藏視窗；Linux 一律最小化並保留工作列入口，避免沒有 indicator 的 GNOME／Wayland 桌面無法找回程式。建立系統匣失敗時，其他平台也退回最小化。
- 從系統匣選「開啟 OCLR IRC」、點擊圖示、macOS Dock 啟用程式，或 Linux 工作列恢復。再次啟動同一安裝會喚回原實例，不另建 IRC 連線。
- 系統匣右鍵選單在「開啟 OCLR IRC」下方以分隔線區分「退出程式」。退出項目隨設定／系統語言顯示繁中「退出程式」、簡中「退出程序」或英文「Quit」，切換語言後仍可使用。
- 選擇系統匣退出、取消背景執行後關閉視窗，或使用作業系統原生結束操作（例如 macOS Cmd+Q）：完整退出，清除本次 IRC 憑證／連線與 OCLR 私人記憶體，停止網站投影／轉送，銷毀系統匣。系統匣退出在前景、隱藏或最小化時皆可用，不受背景執行開關影響。正常退出保留既有加密憑證、登入恢復資格與未到期加密日誌；刪除仍依原登出／忘記／清除規則。

隱藏／最小化將 OCLR 標為背景，沿用面板 60 秒／列表 120 秒輪詢與 Main 的 refresh；恢復焦點重讀。IRC 的 Node transport、PING／PONG、重連及有界訊息緩衝不依賴 Renderer 計時器。背景不重送 make 或其他操作。

電腦休眠仍依既有政策處理：IRC 暫停並在喚醒後恢復，OCLR 清資料並需重新授權；背景執行不阻止休眠。未增加開機自啟、常駐服務、系統通知或自動更新。

側欄原本的「轉入背景／退出程式」按鈕已移除。使用者偏好與語言詳見 [設定頁](app-settings.md)。

## 2026-11-01 系統匣退出（#81）

初始選單與語言更新共用同一份選單建立邏輯；退出呼叫 Main 的 `app.quit()`，沿用 `before-quit` 清理及關窗攔截解除流程。

`background-smoke.cjs` 以七個獨立程序覆蓋前景／隱藏／最小化 × 背景開關，以及取消背景後關窗退出。各程序建立合成 IRC、OCLR 授權、面板及 relay，驗證退出前清除本次身分／私人資料、停止 relay、取消 HTTP 請求及銷毀系統匣／視窗；單次聊天不重送，沒有房內變更命令。測試另涵蓋建構時、系統語言解析、三語切換及回到前景重讀系統語言的選單，保留背景心跳、原視窗恢復及單實例事件喚回檢查。

輸出為 `artifacts/background-smoke-<phase>.json`。合成測試直接呼叫原生選單 callback；三平台實機系統匣可見性及真正右鍵操作仍需依 [#3](https://github.com/OCLR-dev/OCLR-IRC/issues/3)／[L11](../desktop-backlog.md) 另行驗收。

smoke runner 將 Electron 被訊號中止（沒有退出碼）視為失敗並停止後續程序，避免啟動失敗仍連續開啟下一個測試。核心回歸另驗證訊號中止、逾時、非零退出及正常完成四種結果。

2026-11-01 macOS arm64 本機：`npm ci`、型別檢查、216 項核心測試、完整 Electron smoke（含 build、29 個程序）及 `git diff --check` 通過，見 [本次合成證據](evidence/tray-quit-smoke.json)。三平台 CI 以本次提交的實際 run 為準；本機結果不代表實機驗收完成。

## 歷史驗證（2026-10-29）

`npm run typecheck`、49 項核心測試及 Electron UI 回歸；新增 `background-smoke.cjs` 驗證原生 close 不銷毀視窗、背景 IRC PING／PONG、activate／系統匣恢復、單實例事件喚回、退出前清除身分且正常結束程序。OCLR 合成 UI 測試另確認背景與恢復保留 session。

macOS arm64 本機以上檢查已通過；[背景測試證據](evidence/background-smoke.json)為 2026-10-29T14:28:48Z。回歸曾遇既有虛擬訊息列表的 DOM 提示等待逾時，重跑完整 UI 通過，未修改聊天邏輯。Headless Linux 的測試檢查最小化請求及連線保留，不冒充具備視窗管理器的實機驗證。

最終提交 `667ca5e` 的 [三平台 CI 40891914495](https://github.com/OCLR-dev/OCLR-ref-tools/actions/runs/40891914495) 已通過 Windows x64／Linux x64／macOS arm64 的核心、UI（含背景與退出）及原生打包；[CI 證據](evidence/background-ci.json)。本次一般 push CI 的 macOS 採 ad-hoc 簽章，未執行 Developer ID／公證或發布 Release。

CI 的原生 Tray 建立不代表實機指示器可見性已驗收；不同 Linux 桌面、Windows 通知區、macOS 選單列、真正 OS 登出／關機仍需實機驗收。單實例喚回測試若採注入 second-instance 事件，僅證明事件處理，不宣稱第二程序鎖已實測。

本次為功能增量，M1／MVP 整體 gate 不變，未建立 milestone tag。

## 依據

[Electron Tray](https://www.electronjs.org/docs/latest/api/tray)、[App 生命週期及單實例](https://www.electronjs.org/docs/latest/api/app)、[BrowserWindow close](https://www.electronjs.org/docs/latest/api/browser-window#event-close)。
