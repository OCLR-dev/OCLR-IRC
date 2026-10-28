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

這是**安裝範圍、手動模式**的保守防重送記錄，刻意不假設 nickname 是 osu! UID。尚未實作 LOG-01 的分帳號／場次 journal、加密日誌、7 天清理或 OCLR operation 綁定；後續串接正式場次時需 migration，不能將這份手動記錄當作身分或賽事權威資料。最小 ID／狀態／時間屬設計允許的明文恢復 metadata，私人 payload 不落盤；Linux 系統金鑰不可用仍不允許保存憑證或私人日誌。

## 驗證與限制

- macOS arm64 本機 `npm run typecheck`、36 項 `npm test` 及 `npm run test:ui` 通過；Electron 45.0.0 UI 證據時間為 2026-10-28T07:24:25Z。
- 核心測試涵蓋 Unicode／注入、SQLite 重啟與競爭寫入、送前保存、回覆來源／名稱關聯、單次送出、JOIN 與唯讀同步、逾時／晚到回覆、斷線不重送、讀寫失敗、完成寫入失敗、共享節流與分頁預留。
- 真實 Electron Main／Preload／Renderer 以本機模擬 IRC 驗證按鈕、確認勾選、中文房名、自動切房、舊請求拒絕，以及 900×640 視窗。證據見 [合成 UI 報告](evidence/ui-smoke-creation.json)。
- 未登入真實帳號、未建立真實房間、未執行 close／start／abort。真實 make 回覆格式、限額／權限錯誤、跨平台實機及真正中文 IME 仍需後續驗收；M0 G01、LOG-01 與完整操作核心未解除。

## 參考

- [osu! 官方 tournament commands](https://osu.ppy.sh/wiki/en/osu%21_tournament_client/osu%21tourney/Tournament_management_commands)：make 語意與房間生命週期。
- [bancho.js createLobby 實作](https://github.com/ThePooN/bancho.js/blob/master/lib/BanchoClient.js)：公開來源可見確認回覆的 URL＋房名格式；本次未引入整個套件，也不把第三方 parser 視為真實 Bancho 實測證據。
