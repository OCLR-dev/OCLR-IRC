# M1：0.2.0 房間聊天工作區

日期：2026-10-27（Asia/Taipei）。本輪為獨立 IRC 的下一個可用增量，M1 與完整 MVP 仍未全部完成。

## 已交付

- 單一 MP 房間的一般聊天；Enter 送出，組字期間 Enter 不送出。貼上換行／控制字元及以 `!`、`/`、`／` 起頭的指令由 Main 拒絕；不提供任意 IRC 或比賽變更入口。
- 每筆聊天攜帶固定 `roomId` 與 Main 產生的 `roomEpoch`。即使重新加入相同 MP，舊頁面請求也不能送出；切房清空草稿。
- 聊天與 settings／listrefs 共用每秒一次的手動節流；查詢等待期間拒絕聊天。不排隊、不重播；不把本機 `socket.write` 當送達證明，聊天列標示「未確認送達」。這不是 CORE-01 完整操作佇列。
- 出站整行含 `PRIVMSG target :` 至多 510 UTF-8 bytes，再附 CRLF；長度上限是保守工程防護值，不宣稱已實測 Bancho 的所有邊界。
- React Virtuoso 虛擬列表，記憶體保留最近 1,000 則。查看歷史時不自動跳到末尾，可按「回到最新訊息」。超出保留上限的歷史會被淘汰。
- Linkify 辨識網頁網址，文字維持 React 跳脫。Main 只開啟目前保留訊息內的 HTTP／HTTPS 連結，拒絕登入資訊、自訂協定、檔案與任意 URL；不自動抓取連結預覽。點擊後由系統瀏覽器開啟。
- KICK／本人 PART／QUIT、房間錯誤使本地加入、綁定與裁判觀測失效；停止待查詢，禁止繼續發送。伺服器 ERROR 中斷登入狀態。未觀察到關閉事件時不假定仍有權限，查詢逾時也不證明房間已關閉。
- 同一 TCP chunk 的解析更新合併為一次 snapshot；Main→renderer 每 32ms 最多一次推送，取傳送當下最新狀態，不保留登出前快照。

## 元件與架構選擇

| 元件 | 版本／授權 | 使用範圍 |
| --- | --- | --- |
| React Virtuoso | 4.18.19／MIT | 免費 `Virtuoso`，不使用商業 Message List 套件 |
| linkify-react、linkifyjs | 4.4.0／MIT | renderer 連結顯示與 Main 來源核對 |
| HeroUI | 3.2.6／MIT | 沿用免費表單及按鈕；無 Pro |

依使用者最後確認，桌面核心維持 TypeScript／Node.js；Go 草稿已移除，沒有新增程序或 Go 工具鏈。OCLR 伺服器 API 後續以 Node.js 開發，仍在 OCLR repository 維護身分與賽事權威資料。

參考：[Virtuoso 官方原始碼與 API](https://github.com/petyosi/react-virtuoso)、[Linkify React 文件](https://linkify.js.org/docs/linkify-react.html)。套件版本與授權取已安裝 npm metadata，依 package-lock.json 鎖定；沒有複製自製虛擬列表或網址 parser。

## 驗證

- `npm run typecheck`：通過。
- `npm test`：12 項通過；包含既有登入／LF／權限、UTF-8 邊界、注入、目標 epoch、查詢共用節流、KICK／PART、1,200 則輸入只保留 1,000 則與批次推送，以及安全連結。
- `npm run test:ui`：真實 Electron Main／preload／renderer，僅連接本機合成 IRC。涵蓋聊天、未確認提示、指令阻擋、連結與 HTML 跳脫、1,000 則列表 DOM 少於 100 列、查看歷史／返回最新、900×640 原生視窗輸入區可見及 KICK 禁用操作。[結果](evidence/ui-smoke-chat.json)
- 合成 composition event 只驗證防誤觸程式路徑，不能代替真實中文 IME。尚未進行 Windows／Linux、真實帳號聊天或三平台效能基準。
- 本輪未使用任何真實憑證、未向真實房間傳送聊天或比賽指令；畫面及測試內容全部為合成資料。

## 後續

IRC-03 仍缺多頻道／私訊、補完、未讀與提及；IRC-01／02 仍缺退避重連及可選憑證保存；STATE-01 尚未完成槽位／地圖／Mods 全快照。D06 預設加密保存需求不變，但此版仍只存記憶體，LOG-01 不標完成。OCLR OAuth／context、操作佇列與比賽變更依原有 gate 推進。
