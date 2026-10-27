# M1：0.3.0 多 MP 房間工作區

日期：2026-10-27（Asia/Taipei）。M1 增量，並非完整 milestone 完成，因此不建立 milestone tag。

## 功能與界線

- 同時開啟最多 8 個 MP 房間，各自保留最近 1,000 則當次記憶體訊息、settings／listrefs 觀測、查詢等待狀態、錯誤與逾時計時器。加入新房不會 PART 舊房；再次加入已開啟／正在加入的房間只切換分頁。
- 非目前分頁收到訊息時累計未讀，包含登入暱稱的非系統訊息另標示提及；上限各 999，切入該分頁歸零。這是分頁未讀，不等同失焦／桌面通知或逐條已讀回執。
- 每次 query、chat、select、leave 都攜帶 roomId＋roomEpoch。切分頁不重定向已送出或已捕獲目標的請求；房間被關閉／重新加入後舊 epoch 不再有效。查詢與聊天維持全連線一秒一次的共同節流，不是完整 CORE 操作佇列或所有 IRC 行的排程器。
- 「離開」只送出 PART、取消該分頁查詢、移除本機記錄，不發送 `!mp close`。離開目前頁後切到另一個已開啟房間。送出 PART 後顯示待確認，收到本人 PART 才允許重加同一頻道，避免舊 JOIN／PART 回覆污染新頁；未確認時不自動重送，必要時重新登入。待確認集合超過 32 時中斷連線，維持記憶體有界。
- 回覆按 IRC target 欄位分派，不能用 body 裡出現的 channel 字串選擇房間。背景房 KICK／拒權只使該房失效；ERROR／本人 QUIT、登出及 socket 失敗清除全部連線狀態。
- Renderer reload 保留 Main 的連線、分頁與觀測；程式結束或登出仍清除當次記錄。切換分頁清空未送出的草稿，未實作多頁草稿保存。
- 沿用免費 HeroUI、React Virtuoso 與 Linkify；沒有新增套件、Pro 或 Go。訊息序號的虛擬列表偏移按房間獨立計算，避免跨房間訊息交錯影響列表淘汰與定位。

## 驗證

- `npm run typecheck` 通過。
- `npm test`：14 項通過，涵蓋既有聊天保護、兩房回覆／查詢／未讀隔離、跨房共用節流、舊 epoch 拒絕、重加等待 PART、8 房上限、重複 JOIN 去重及關頁後晚到事件不恢復分頁。
- `npm run test:ui`：Electron 真實 Main／preload／renderer 連接本機合成 IRC；驗證兩房切換、背景提及、切回後訊息可見、房間觀測保留、Renderer reload 不重登、PART 不等於 close、1,000 則虛擬列表及 900×640 視窗。見 [合成驗證紀錄](evidence/ui-smoke-tabs.json)。
- 本輪未向真實 Bancho 傳送聊天、加入或修改房間，沒有使用真實憑證。真實中文 IME、Windows／Linux 與三平台打包仍未驗證；macOS 系統 IMK 診斷不被當作 IME 測試通過證據。

## MVP 狀態與下一步

IRC-03 完成多 MP 分頁、未讀／提及子集；一般 IRC 頻道、私訊與補完仍缺。IRC-01／02 仍缺退避重連與可選安全憑證保存；STATE-01 未完成完整槽位／map／Mods 快照；LOG-01 未交付。M0 與 M1 不因本次增量而標記完成。

網站面板整合設計已獨立推送至 OCLR-website 的 `codex/referee-panel-integration-docs` 分支（文件提交 `55ff770`，未合併 main）；桌面設計提交 `8ec6255`。這只提供契約提案，沒有開放 OCLR API／寫入 scope 或完成 PANEL-R。
