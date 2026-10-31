# 網站 IRC 投影與命令傳送

本版接上網站 PR #409 的桌面授權及 IRC relay。IRC 密碼和 socket 僅留在 Electron Main；網站只保存本場投影與命令狀態。OCLR 的 osu! OAuth 是網站身分授權，並不取代 osu! IRC 專用密碼登入。

網站同意頁實際以 `POST /api/desktop/v1/auth/decision` 提交 `request_id` 與 `decision`，受同源檢查與登入 session 保護；本機不呼叫此端點。已授權 session 可在網站 `/desktop/sessions` 撤銷。這是目前實作，取代早期候選契約中尚未實作的 approve/deny 路徑。

## 本機測試

1. `npm ci`，然後 `OCLR_SERVER_ORIGIN=http://localhost:3001 npm run dev`（網站亦須配置相同 APP_URL）。預設正式 origin 為 `https://oclr.org`；環境變數只由 Main 讀取，允許 HTTPS 或明確的 localhost／127.0.0.1 HTTP，不開放 Renderer 任意主機。
2. 在「房間記錄」以本人 IRC 專用密碼登入，建立或加入 MP 房間，讀取完整設定和裁判名單。開房仍由本機操作。
3. 在「連接 OCLR」選擇透過瀏覽器登入；在網站完成 osu! 登入，核對比對碼並同意四個 scope（原三個只讀 scope 加 `referee:relay`）。
4. 選本人獲派場次，再按「將目前房間投影到網站」。Main 會自動核對已登入 IRC 與 OCLR 帳號名稱（忽略大小寫、空格與底線等價），不需人工配對勾選；名稱須相符，選中房間須有 History ID 觀測及裁判名單證據。
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

## 2026-10-30 房間成員資格失效回歸

relay 現在要求綁定房間仍為已加入的比賽房間。離開或被移出後，晚到 Bot 訊息不能確認指令；同步回覆等待期間失去成員資格，也不能送出回覆中的新指令。既有等待結果保持 unknown，投影停止，不自動重送。

合成驗證：型別檢查、150 項核心測試與完整 Electron smoke 通過，新增離房後晚到確認及 HTTP 在途離房兩個回歸案例。

真實驗證另列：指定房 #mp_122090006 的重新加入於本地時間 20:28:36 逾時，網站顯示未連線。本輪未送出換圖、Mods、timer、start 或 abort，不能據此宣稱跨端回執或真實單次執行驗收通過；#2 保持未完成。

## 新建空房的逐指令檢查

2026-10-30 真實 Test1／#mp_122090631 的 settings 只包含房名、History、模式與 Players: 0。網站換圖排隊後原本會失敗且不送線，因為 relayReady／relaySend 未將已驗證命令傳入既有 Main 證據檢查。現在轉送與手動操作沿用同一逐指令要求：換圖不依賴舊地圖／Mods、timer／aborttimer 不依賴地圖／Mods、明確替換 Mods 不依賴舊 Mods；start 維持完整觀測要求。送線前仍重新驗證，不因準備檢查成功而跳過房間、世代、裁判或 freshness。

合成驗證：152 項核心測試、typecheck 與完整 Electron smoke 通過；新增真實 IrcSession＋本機模擬 IRC 測試，核對空房指令各送一次、非法指令及資料不足的 start 被拒絕、送出不把省略資料變成已知。

## 2026-10-31：獨立開房接收狀態

本次使用者明確要求網站直接開房，新增 relay bind `roomId: 0` 作為僅開房的內部接收狀態（不是 IRC 房號），不需先有 MP 房間。桌面仍須正式授權、本人場次、fresh panel、已核對的帳號配對、online IRC、無已知／未知既有開房結果，並在本機明確啟用連線。網站一次只排一筆 `!mp make <1–200字房名>`，目標固定 BanchoBot；其他命令在此狀態拒絕。一般房間 relay 繼續禁止 make。這取代本文舊版一律禁止 make 的限制，並非完整 context 自動執裁。

Main 使用原有 createRoom 的送前持久化、節流、可信 BanchoBot 回覆與 JOIN 流程，消耗 command ID 後不重送。已建立的房間立即排除 IRC journal；只有加入、History 與 listrefs 核對完成，才在下一筆 sync 帶正整數 `roomId`，將同一接收連線轉為房間投影。網站只允許原 roomId 0 且有已派送 make 的連線進行這項轉換；既有房間不能切換為另一房號。開房 receipt 保守標記 unknown，實際房間由本機與投影核對，不捏造 Bancho 回覆證據。

此修改需網站與桌面一起更新；不部署、不進行真實 Bancho 操作。契約相容修復保留 unknown enum、身份及權限拒絕；不以 cookie 替代桌面 token。

## 網頁喚起桌面程式（2026-10-31）

網站執裁頁可透過 `oclr-irc://connect?fixture=<UUID>` 喚起 OCLR IRC；此 URI 僅帶場次 UUID，無 token、密碼、命令、網站主機或房號。不信任來源網站，也不因收到連結自動登入或啟用 relay。Main 嚴格解析完整 URI，拒絕額外／重複參數、控制字元、encoded payload、片段與未知路徑；不回顯無效原文。

冷啟動 argv、macOS `open-url`、Windows／Linux `second-instance` 共用同一解析器。新請求顯示在桌面並留記憶體最多 10 分鐘。登入 IRC 後按「繼續連接」，必要時開始既有 PKCE 瀏覽器授權，再重新讀取本人場次（含分頁）與面板。只有被指派且面板有效時才能帶入；使用者仍須核對兩個登入並按既有「連接網站 IRC」。連結不直接開房或送出任何 IRC 命令。重複同場連結不重開授權；更換請求、取消、登出、休眠及身分世代變動隔離舊回應。確認切換時先停止舊 relay，不把新場次接到原投影。

macOS 打包在 Info.plist 註冊 URL scheme（Packager protocols）；Windows 封裝版本首次啟動以 Electron API 註冊。Linux portable 解壓至固定位置後，在該目錄執行 `./install-protocol.sh`（需桌面環境的 xdg-utils，不用 sudo），建立使用者 desktop entry 與 scheme 關聯。移動 Linux 目錄後需重跑安裝。macOS／Linux 開發模式不承諾系統 URL 關聯，請使用封裝成品；網頁保留下載提示，不以計時推定啟動或登入成功。此註冊不處理 PKCE callback，原 loopback state 驗證保持不變。

合成測試使用隔離 profile、fake HTTP／IRC 和注入的 OS 事件；不等同三平台瀏覽器協定提示、真實授權或 Bancho 驗收。

## 2026-10-31：計時／新增裁判回執與未送出診斷

本次使用者確認網站 timer 顯示 unknown 時房間沒有開始倒數。修正 Main 在派送前就設 pending 的錯誤：只有通過所有本機檢查、operation begin 與送前記錄，進入 socket write 邊界才建立待回覆狀態。未送出拒絕為 failed，socket write 的模糊結果仍為 unknown，不重送。

relay 現會先檢查共同操作佇列，未核對的舊操作不再等 8 秒或冒稱已送出；網站可看到「先至本機操作記錄核對」等具體原因。既有 unknown 不會自動清除或重送，需人工核對。addref／invite／set 使用房間層最低觀測，不要求與這些命令無關的 beatmap／Mods；仍需 History、模式、Players／槽位、近期 settings 與本人 listrefs。網站角色不授予 Bancho 房主權限。

新增 timer 與 addref 的有限回覆確認：timer 必須是送出後同房 BanchoBot 的原請求秒數（支援分鐘＋秒），後續不同秒數 tick／Countdown finished 不確認；addref 必須是相同正規化目標名稱的 Added ... to the match referees。Operations 與 relay 共用比對，觀測到對應回覆後解除該筆阻擋；不宣稱可排除外部裁判剛好做同操作。網站仍核對 sender／target／新 message ID／投影證據。

bind 回應可附 receiptReasons:true；只有收到此能力的新桌面才送出 reason，舊網站不收到未知欄位。reason 限 pending_operation、room_checks、local_rejected、bancho_rejected、reply_timeout、invalid_command、target_changed；網站存入既有 recordError 的 relay: 前綴並使用三語言固定文案顯示，不轉傳原始例外、憑證或私人 log。舊客戶端仍可使用原回執。

參考回覆格式：[bancho.js parser](https://github.com/ThePooN/bancho.js/blob/master/lib/Multiplayer/BanchoLobbyRegexes.js)。本輪以本機 TCP 模擬空房、操作阻擋與精確回覆，不操作截圖中的真實房間；真實權限或上線後效果需另驗收。

## 2026-10-31：BP 自動通知與 Pick 換圖／Mods（網站 #621）

網站保存 BP 後可排定自動同步：Ban 發送固定格式的 BP 通知；Pick／TB 依序通知、換圖與套用本輪已保存的 Mods／NF；撤回則通知修正。網站以保存事件 UUID 去重及伺服器生成內容，BP 保存與 IRC 結果獨立。網站更新需要 migration 0066；桌面更新以 bind 回應 `bpSync:true` 與 sync 請求 `bpSync:true` 協商能力，舊網站不收到新欄位，舊桌面不接收自動計畫。

Main 僅讓固定 `[OCLR BP #數字]`、操作／圖池編號／隊名與官方譜面連結格式走 `relayNotice`，另核對當前房間 epoch、加入／History／裁判及帳號配對。通知沿用既有 chatText 的命令阻擋、UTF-8 長度與全連線節流，不放寬一般聊天成為命令入口，也不建立一筆會等待 Bancho 效果的 MP 操作。通知 handed-to-local-transport 以 `notified` 回報，不冒稱伺服器已收到或房間已變更。

換圖／Mods 沿用原 MP 驗證、送前消耗 ID、共同操作阻擋及未知結果不重送。網站計畫只在上一筆成功後派送下一筆。新增有限 Mods 回覆比對：`Enabled ... / Disabled all mods, enabled/disabled FreeMod` 必須與原命令的 Mods 集合及 Freemod 完全一致；未知名稱、其他集合、其他房間或舊回覆不能確認。格式參考 [bancho.js 的 BanchoLobbyRegexes](https://github.com/ThePooN/bancho.js/blob/master/lib/Multiplayer/BanchoLobbyRegexes.js)。

合成驗證包含網站隔離 DB 的計畫順序／去重／失敗停步及撤回，桌面 relay 不重送，以及真實 IrcSession 加本機 TCP 模擬 IRC 的通知送線／注入／epoch 邊界。未操作真實房間；此切片不建立 start/abort 自動化，不代表完整 MVP 或三平台實機驗收完成。

## 2026-10-31：開房送出邊界與來源隔離（#2／#6／#40）

網站 make 也以 Main 的送線邊界回呼區分 failed／unknown；名稱、節流、既有在途操作或儲存檢查未通過，回報 failed／local_rejected，不能因另一筆開房處於 awaiting／blocked 就冒稱本筆結果不明。相同 command ID 仍先消耗、不重試；拒絕另一筆請求不覆寫原在途請求的關聯。

Main 提供固定來源的內部 createWebsiteRoom，relay 與候選 FixtureCreation 共用；既有 renderer createRoom 仍固定 manual，不能靠輸入 source 變更來源。網站操作僅記憶體保存，最小 room-creation.sqlite 防重送資料仍在送線前保存。操作記錄初始化失敗會同步鎖定開房，不能留下可再次提交的假狀態。

可信且匹配本次房名的開房回覆在產生第一則房間訊息前觸發 Main 隱私事件；即使停止 relay／清除網站操作上下文，仍排除該房間 IRC-only 日誌。relay 以原 requestId、IRC generation 與來源核對 Main 的完成事件，JOIN／History／listrefs 通過後才轉換投影房號；其他來源、舊世代與另一筆開房不能被誤綁。這不新增完整 context 的生產入口。

網站 make 嘗試送出前亦將本次 IRC 登入的 BanchoBot 私訊列為不保存：逾時或重複的開房回覆會成為一般 Bot 私訊，仍可能包含場次房名，不能因此落盤。排除比對使用 IRC 名稱正規化，大小寫差異不能繞過；其他一般聊天保存不受影響。候選 FixtureCreation 同樣只在送線邊界建立 pending，送前儲存拒絕為 failed，已嘗試傳送才可能 unknown。

換圖確認只解析回覆的實際第一個地圖連結，URL 必須是精確 osu! 譜面路徑；不同地圖的曲名附上目標連結、網址前綴／後綴或其他主機不能確認。現有兩種回覆格式與 Operations 共用此檢查。

合成驗證：179 項核心測試、型別檢查及完整既有 Electron smoke 通過；追加 relay-creation-smoke 使用真實 Main／preload、模擬 HTTP／IRC 與隔離 profile，驗證去重、sent 回執、停止後晚到開房、settings／listrefs、操作記錄不落盤，以及可保存平台的日誌排除與一般日誌正向對照。Linux 仍只驗證 memory_only，不將其算成原生 provider 驗收。真實服務、逐場歷史重新驗權及三平台實機條件仍待完成。

## 自動帳號核對（2026-11-01）

依使用者要求取代人工核對。Main 只在 IRC 已收到成功登入、OCLR 已有授權 subject 時自動比對名稱；沿用 `normalize`，大小寫不敏感、每個空格與底線等價，不折疊多個空格、不移除其他符號或做 Unicode 相似字轉換。相符顯示「帳號名稱相符・已自動核對」並可由使用者連接網站 IRC；未登入／不符仍阻擋。移除配對 checkbox、人工確認 token／reviewed 與 preload／Main 確認 IPC；renderer 不能改寫配對。候選 context 檢查器同步移除 identityReviewed，仍要求有效 session、相同 subject ID 與成功 IRC 登入名稱相符；這不代表候選 context 已接入正式 HTTP／IPC。

原始名稱、IRC／OCLR 登入世代或 OCLR subject ID 任一變更，Main 都停止舊 relay。即使新登入同名而自動配對，延遲 bind／sync 仍不能附著新 session，也不自動重啟投影或重送指令。房間／裁判檢查及其他房內操作確認不變。這是兩個成功登入名稱的比對，不宣稱 IRC 穩定 UID 證明，沒有新增外部身分查詢或網站變更。

合成驗證：核心覆蓋空格／底線／大小寫、未登入、不符／近似名稱、世代及 subject 變更、晚到 bind／sync 不送出；Electron 使用實際 Main／preload／renderer 及本機 IRC，驗證無人工 checkbox／確認 bridge、重新登入自動比對及網站開房流程。真實 OAuth／Bancho、改名服務行為與跨平台實機驗收仍分開追蹤，不能由合成結果宣稱完成 #13。

本機驗證：Node.js 24.22.2 型別檢查、196 項核心／契約測試與完整 11 組 Electron synthetic smoke 通過（含 900×640、relay 開房與逐人邀請）。本輪未操作真實 OAuth／Bancho，也未更新既有 Release 下載包。
