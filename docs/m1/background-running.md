# 0.7.0 背景執行

2026-10-29 新增原生背景生命週期，不增加套件。

## 操作

- 左側「轉入背景」或關閉視窗：保留原本視窗、IRC／OCLR session、分頁與本次記憶體訊息。Windows／macOS 有系統匣時隱藏視窗；Linux 一律最小化並保留工作列入口，避免沒有 indicator 的 GNOME／Wayland 桌面無法找回程式。建立系統匣失敗時，其他平台也退回最小化。
- 從系統匣選「開啟 OCLR ref tools」、點擊圖示、macOS Dock 啟用程式，或 Linux 工作列恢復。再次啟動同一安裝會喚回原實例，不另建 IRC 連線。
- 左側或系統匣「退出程式」、macOS Cmd+Q：完整退出，清除本次 IRC 憑證／連線與 OCLR 私人記憶體，銷毀系統匣。已勾選保存的加密 IRC 登入資料仍依原「忘記」規則管理。

隱藏／最小化將 OCLR 標為背景，沿用面板 60 秒／列表 120 秒輪詢與 Main 的 refresh；恢復焦點重讀。IRC 的 Node transport、PING／PONG、重連及有界訊息緩衝不依賴 Renderer 計時器。背景不重送 make 或其他操作。

電腦休眠仍依既有政策處理：IRC 暫停並在喚醒後恢復，OCLR 清資料並需重新授權；背景執行不阻止休眠。未增加開機自啟、常駐服務、系統通知或自動更新。

## 驗證

`npm run typecheck`、49 項核心測試及 Electron UI 回歸；新增 `background-smoke.cjs` 驗證原生 close 不銷毀視窗、背景 IRC PING／PONG、activate／系統匣恢復、單實例事件喚回、退出前清除身分且正常結束程序。OCLR 合成 UI 測試另確認背景與恢復保留 session。

macOS arm64 本機以上檢查已通過；[背景測試證據](evidence/background-smoke.json)為 2026-10-29T14:25:20Z。回歸曾遇既有虛擬訊息列表的 DOM 提示等待逾時，重跑完整 UI 通過，未修改聊天邏輯。Headless Linux 的測試檢查最小化請求及連線保留，不冒充具備視窗管理器的實機驗證。

CI 的原生 Tray 建立不代表實機指示器可見性已驗收；不同 Linux 桌面、Windows 通知區、macOS 選單列、真正 OS 登出／關機仍需實機驗收。單實例喚回測試若採注入 second-instance 事件，僅證明事件處理，不宣稱第二程序鎖已實測。

本次為功能增量，M1／MVP 整體 gate 不變，未建立 milestone tag。

## 依據

[Electron Tray](https://www.electronjs.org/docs/latest/api/tray)、[App 生命週期及單實例](https://www.electronjs.org/docs/latest/api/app)、[BrowserWindow close](https://www.electronjs.org/docs/latest/api/browser-window#event-close)。
