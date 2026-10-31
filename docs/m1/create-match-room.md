# 0.5.0：手動新建比賽房間

2026-10-28，使用者要求新增開房按鈕。本次交付 LOBBY-01 的手動開房切片與必要的最小恢復保護；不將完整 CORE／LOG／LOBBY 或 M1／M2 標為完成。

## 使用方式

1. 登入 IRC，在「房間記錄」右上按「＋ 新建比賽房間」。
2. 輸入房名，核對帳號及既有房間，勾選確認需要另開新房間，按「建立並加入」。
3. Main 向 BanchoBot 私訊送出單次 `!mp make <name>`。等待真正回覆後，切換至實際 `#mp_<id>` 並自動 JOIN、settings、listrefs。
4. 「隱藏」只隱藏開房表單，不撤回已送指令；離開分頁仍只送 PART，不會關房。

建立的是公開比賽記錄的 tournament 房間，不提供 makeprivate、其他房內變更或自動套用 OCLR 規則。osu! 文件說明此類房間不因玩家離開而自動關閉，需另行 close；本版尚未提供 close 按鈕。房名 1–50 Unicode 字元是應用程式保守限制，不宣稱已實測 Bancho 上限。

## 核心與 IPC

- 僅增加有限 `createRoom({ name, requestId, reviewed })` IPC；沿用可信 Main frame 檢查，Renderer 無任意 IRC 命令入口，BanchoBot 一般私訊仍禁止輸入。
- `requestId` 是 Main 每次連線提供的單次意圖識別；成功後換新，舊表單、重複提交與舊連線請求會被拒絕。`reviewed: true` 是裁判人工核對聲明，不代表系統已證明沒有既有房間。
- 每連線最多一筆在途開房，共用 JOIN／PART／查詢／聊天的一秒節流。開房前檢查八分頁上限，等待中預留一個位置，包含其他使用者的主動私訊也不能占用預留位置。
- 只接受同一連線、目標為本帳號的 BanchoBot `PRIVMSG`；確認訊息格式為 `Created the tournament match https://osu.ppy.sh/mp/<id> <name>`，ID 必須是正整數且安全，名稱需與送出的房名完全相同。一般使用者、頻道回覆、不同房名、截斷或陌生格式均不能確認成功。
- 確認只證明已回傳房間 ID，不直接設定 binding／referee；settings History 與 listrefs 仍照原機制核對。JOIN 失敗不會回滾已建立房間。
- 15 秒逾時、傳送錯誤、休眠或斷線均視為結果不明，沒有自動重送。未知 Bancho 錯誤先顯示原回覆，保持等待，逾時後鎖定；不猜測限額／權限錯誤等於未開房。
- 逾時後同一連線禁止再次開房，晚到成功回覆只可作為私訊人工查看，不能自動綁房。需核對既有房間、登出再登入；斷線重連後同樣需重新勾選人工核對。新連線的 generation 隔離舊 socket 回覆。

Bancho 不回傳客戶端 operation ID，因此無法保證與其他 IRC 客戶端同時對同帳號、同房名開房的回覆關聯；請勿並行送出此類操作。這也是仍需真實開房樣本及人工核對的原因。

## 最小本機恢復記錄

使用 Electron 內建 `node:sqlite`，不增加套件或 native addon。`userData/room-creation.sqlite` schema version 1 僅保留本安裝最新一筆意圖：operation ID、pending／created、可空 room ID、時間；不存帳號名稱、密碼、房名、指令內容、隊伍／context 或聊天。

在 socket write **之前**同步提交 pending（SQLite FULL synchronous），收到有效確認後記錄實際 room ID。讀取／寫入失敗阻擋開房，完成記錄失敗保留已回傳 ID 並鎖定下一次操作；不以清空或明文聊天降級繞過。transaction 內比對上次 operation ID，避免另一程序覆寫本程序尚未看過的操作。

記錄不隨登出、忘記密碼或關閉分頁刪除。重啟時 pending 只顯示「結果不明」，不重播；即使資料檔不存在或被清除，每次登入仍要求裁判核對既有房間。人工明確另開的下一筆意圖才覆寫上一筆。

初版使用**安裝範圍、手動模式**的保守防重送記錄（以下為初版邊界，2026-10-30 遷移見文末），刻意不假設 nickname 是 osu! UID。尚未實作 LOG-01 的分帳號／場次 journal、加密日誌、7 天清理或 OCLR operation 綁定；後續串接正式場次時需 migration，不能將這份手動記錄當作身分或賽事權威資料。最小 ID／狀態／時間屬設計允許的明文恢復 metadata，私人 payload 不落盤；Linux 系統金鑰不可用仍不允許保存憑證或私人日誌。

## 驗證與限制

- macOS arm64 本機 `npm run typecheck`、36 項 `npm test` 及 `npm run test:ui` 通過；Electron 45.0.0 UI 證據時間為 2026-10-28T07:24:25Z。
- 提交 `e13c514` 的 [三平台 CI 40649929282](https://github.com/OCLR-dev/OCLR-ref-tools/actions/runs/40649929282) 全數通過：Windows x64、Linux x64、macOS arm64 均執行型別、36 項核心測試、Electron UI 與原生打包；見 [CI 結果](evidence/creation-ci.json)。這是 runner 上的合成測試，不替代實機 IME 或真實 Bancho 操作。此次為一般 push CI，macOS 採 ad-hoc 簽章，未執行 Developer ID／公證，未發布 Release 或 tag。
- 核心測試涵蓋 Unicode／注入、SQLite 重啟與競爭寫入、送前保存、回覆來源／名稱關聯、單次送出、JOIN 與唯讀同步、逾時／晚到回覆、斷線不重送、讀寫失敗、完成寫入失敗、共享節流與分頁預留。
- 真實 Electron Main／Preload／Renderer 以本機模擬 IRC 驗證按鈕、確認勾選、中文房名、自動切房、舊請求拒絕，以及 900×640 視窗。證據見 [合成 UI 報告](evidence/ui-smoke-creation.json)。
- 未登入真實帳號、未建立真實房間、未執行 close／start／abort。真實 make 回覆格式、限額／權限錯誤、跨平台實機及真正中文 IME 仍需後續驗收；M0 G01、LOG-01 與完整操作核心未解除。

## 參考

- [osu! 官方 tournament commands](https://osu.ppy.sh/wiki/en/osu%21_tournament_client/osu%21tourney/Tournament_management_commands)：make 語意與房間生命週期。
- [bancho.js createLobby 實作](https://github.com/ThePooN/bancho.js/blob/master/lib/BanchoClient.js)：公開來源可見確認回覆的 URL＋房名格式；本次未引入整個套件，也不把第三方 parser 視為真實 Bancho 實測證據。

### JOIN 回覆時序

開房期間若先收到本帳號的 MP JOIN，再收到可信 BanchoBot 的開房確認，Main 會短暫保留最多 8 個頻道名稱；只有與本次開房回覆房號相符的 JOIN 才會用於確認加入。資料僅留記憶體，開房結束、結果未知或斷線即清除，PART／KICK 會撤銷相關觀測。不因 JOIN 推定裁判權限、玩家或設定。

已確認加入時取消尚未送出的重複 JOIN；接續只讀取設定與裁判名單。已送出 JOIN 的同一房間若在逾時後收到自己的 JOIN 或發給本帳號的 366，且沒有離開／被踢／拒絕加入，允許恢復加入狀態並清除逾時錯誤。關閉的分頁不會被延遲回覆重建。這些時序以本機合成測試覆蓋，真實服務驗收另行記錄。

## 2026-10-30：schema 2 分帳號遷移

新開房記錄以正規化 IRC 暱稱的 SHA256 為 key，保存每帳號最新 ID／狀態／房號／時間；這不是 osu! UID 證明或 OCLR 場次記錄。送前 compare-and-set 與完成更新都限定同一帳號。空格／底線及大小寫沿用 IRC 身分比較規則；不同帳號不會看見彼此房號或覆寫待確認記錄。

v1 未記錄帳號，不能將舊房間推定給第一次登入者。交易式 migration 只保留舊 ID／時間作為 legacy unknown 標記，移除舊表的房號；任何尚無自身新記錄的帳號都會看到「無法確認帳號歸屬」並須人工核對。開始新的意圖只更新當前帳號，不替其他帳號解除舊未知狀態。遷移失敗回滾並禁止開房；資料缺失或清除仍沿用每次登入的人工核對要求，不自動 make。

合成測試驗證 v1 created 轉為無房號 unknown、重開、跨帳號隔離、同帳號競爭寫入、錯帳號完成拒絕及失敗回滾。真實跨版本 app 升級與三平台 provider 尚待實機驗收；OCLR 歷史／場次恢復仍未開放。

## 場次開房候選協調器（2026-10-30，#40）

`src/main/fixture-creation.ts` 可在合成環境把已驗證 context 與既有 `IrcSession.createRoom` 接起來：預覽與確認派送前均重讀 context，以原計畫指紋、subject／fixture／IRC generation、一次性 token 和 Main 開房 request ID 核對。create 不要求尚不存在房間的 listrefs；仍必須人工核對既有／未知開房結果，且已有房號時阻擋再次建立。

只有既有 IRC 解析器確認的相符 BanchoBot 回覆才建立來源關係。來源只留記憶體；先呼叫必要的房間隱私 hook，再於目標 JOIN 成功後排入 settings／listrefs。建立房間不代表初始化、房間權限或網站投影成功，也不自動開始 relay。未知／逾時不重送；取消、dispose、換場次或帳號發生於重讀等待期間時不得派送。來源清除後到達的舊房號仍可用最小 pending metadata 交給隱私 hook，不綁到新場次。

此協調器尚未註冊生產 IPC 或 UI；正式接入必須供應已定版 context、目前授權／配對證據及 IRC 日誌排除 hook。不可用 PR409 panel、`operational` 或 renderer boolean 替代完整授權。`tests/fixture-creation.test.ts` 使用真實 IrcSession、本機模擬 IRC 與合成 context，涵蓋送前保存、雙擊、假 bot／錯房名、讀回、未知、儲存失敗、撤銷及晚到來源隔離；不代表真實 Bancho 開房已驗收。

## 2026-10-31：背景刷新保留房名草稿（#40）

場次 panel 在背景重讀期間會暫時標為 stale；同一登入授權續期也會暫時不可用。開房表單現保留同一 subject、fixture、版本、依賴指紋及房名來源的草稿與人工核對；資料尚未恢復 fresh 前禁止送出，不把保留的草稿當有效來源。相同來源恢復 fresh 後不清空自訂房名。來源版本／名稱、身分或場次真正改變時仍清除舊草稿與核對，送出前再次讀取新鮮快照。

Electron 合成回歸在延遲 panel 回覆期間嘗試提交，核對沒有 make 送線，並驗證相同來源恢復、不同來源作廢。這仍是手動房名建議，不替代正式 context 或 #40 的直接場次開房授權。

2026-10-31 開房來源修正：relay 與候選 FixtureCreation 改用 Main-only 的網站來源入口；操作歷史只留記憶體，防重送的最小 SQLite 記錄不變。兩種送前儲存任一步失敗都鎖定開房並明示未送出；進入寫線邊界後的錯誤仍保守 unknown。可信完成事件先隔離日誌再產生房間訊息，停止投影不解除隱私保護。詳見 [網站開房回歸](website-irc-relay.md)。
