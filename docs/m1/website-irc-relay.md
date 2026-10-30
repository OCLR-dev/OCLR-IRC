# 網站 IRC 投影與命令傳送

本版接上網站 PR #409 的桌面授權及 IRC relay。IRC 密碼和 socket 僅留在 Electron Main；網站只保存本場投影與命令狀態。OCLR 的 osu! OAuth 是網站身分授權，並不取代 osu! IRC 專用密碼登入。

網站同意頁實際以 `POST /api/desktop/v1/auth/decision` 提交 `request_id` 與 `decision`，受同源檢查與登入 session 保護；本機不呼叫此端點。已授權 session 可在網站 `/desktop/sessions` 撤銷。這是目前實作，取代早期候選契約中尚未實作的 approve/deny 路徑。

## 本機測試

1. `npm ci`，然後 `OCLR_SERVER_ORIGIN=http://localhost:3001 npm run dev`（網站亦須配置相同 APP_URL）。預設正式 origin 為 `https://oclr.org`；環境變數只由 Main 讀取，允許 HTTPS 或明確的 localhost／127.0.0.1 HTTP，不開放 Renderer 任意主機。
2. 在「房間記錄」以本人 IRC 專用密碼登入，建立或加入 MP 房間，讀取完整設定和裁判名單。開房仍由本機操作。
3. 在「連接 OCLR」選擇透過瀏覽器登入；在網站完成 osu! 登入，核對比對碼並同意四個 scope（原三個只讀 scope 加 `referee:relay`）。
4. 選本人獲派場次，再按「將目前房間投影到網站」。IRC 使用者名稱須與 OCLR 帳號相符（空白與底線正規化），選中房間須有 History ID 觀測及裁判名單證據。
5. 網站執裁頁顯示同一房間的訊息；網站送出命令後，由本機核對房間、最新設定及裁判權限，才送往既有 IRC socket。
6. 在本機停止投影、切換房間或場次、登出或休眠均停用轉送。同步失敗必須重新綁定；不會自動重送任何指令。

## Relay 契約

`POST /api/referee/v1/fixtures/{fixtureId}/relay`，desktop Bearer，`referee:relay`，標準 1.1.0 envelope/header。

- bind：`{action:"bind", roomId, ircUsername}` → `{connectionId,sequence:0,command:null}`。
- sync：`{action:"sync",connectionId,sequence,projection:{status:"connected"|"disconnected",messages:[{id,sender,text,at}]},receipts:[{commandId,status,evidence?}]}`。
- sync 回應：`{connectionId,sequence,command:{id,text,target}|null}`；sequence 嚴格遞增，僅一個同步請求在途。每次投影至多最後100筆、只含綁定房間。
- 每行會移除控制與格式字元，sender 限100字元、text 限1000字元，空行略過；確認證據使用相同清理規則。
- 含密碼、桌面 token、PKCE verifier、PASS／AUTHENTICATE 標記的訊息與確認證據在本機直接略過，不上傳至網站；此檢查在截短前執行，亦核對清理格式字元後的內容。
- disconnect：`{action:"disconnect",connectionId}`。
- receipt 狀態 `sent`、`confirmed`、`failed`、`unknown`；evidence 為 `{sender,target,text}`。`sent` 僅代表 socket 寫入，不是 BanchoBot 已執行。

網站領取命令前標記 sending，本機驗證前標記 consumed；不重送遺失回應的交換、不重複執行同一 command ID。每次僅一個待確認命令，15秒無明確回覆標記 unknown。失去同步不自動恢復命令傳送。

本機會在傳送前讀取失效的設定與裁判名單（最長8秒），仍無法確認則拒絕。只接受 `map/set/invite/addref/timer/start/abort/aborttimer/mods` 的有限語法，禁止 raw IRC、password、close、make 或控制字元。`addref` 的房主限制仍由 Bancho 執行，網站角色不授予該權限。

目前只有含相同 beatmap ID 的後續 BanchoBot `Beatmap changed to:` 回覆，以及明確 abort/aborttimer 回覆會自動標記 confirmed；其他命令的真實回覆仍投影到網站，但不猜測成功。相同房間之外、非 BanchoBot、早於送出的訊息不能確認。地圖回覆作為 BP 確認證據由網站再次核對，不直接發布賽果。

## 驗證範圍

合成 loopback TCP 與假 HTTP 測試覆蓋授權、scope、同房間確認、錯目標、重複命令、斷線、不重送、長度及注入拒絕；它們不是正式 OAuth 或 Bancho 實測。尚需使用者本人完成真實授權和 IRC 房間驗收。

已核對的 Bancho 回覆格式參考 [bancho.js 的 Multiplayer parser](https://github.com/ThePooN/bancho.js/blob/master/lib/Multiplayer/BanchoLobbyRegexes.js)；此來源核對不替代本次真實房間驗收。

### 真實換圖回覆相容性（2026-10-30）

授權測試房的 BanchoBot 回覆為 `Changed beatmap to https://osu.ppy.sh/b/75 Kenji Ninuma - DISCO PRINCE`，後續 settings 確認相同譜面。relay 現同時接受此格式與既有 `Beatmap changed to:` 格式，仍需命令目標 beatmap ID 相符，且通過既有綁定房間、epoch、Bot 來源及訊息時序檢查。測試覆蓋相近錯誤 ID、普通訊息及跨房間隔離；這是解析器及合成整合證據，不是正式網站 BP 寫入驗收。
