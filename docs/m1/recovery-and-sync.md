# 0.4.0：斷線恢復、房間觀測與 IRC 工作區

- 日期：2026-10-28（Asia/Taipei）。TypeScript／Node.js 本機核心；免費 HeroUI，無 Pro。
- 狀態：M1 功能增量，**未通過全部 M1 驗收，不建立 milestone tag**。以下區分本機合成測試、既有真實樣本與待補實機證據。

## 使用方式與連線生命週期

網路中斷、伺服器 ERROR、登入或心跳逾時會保留分頁與當次訊息，但立即清除 joined、History 核對、裁判列名及房間資料，增加每個分頁 epoch。舊 epoch 的操作不可送出。介面顯示重試次數與下次時間，可隨時停止並登出。

- 最多自動重試 5 次，間隔 1／2／4／8／16 秒；連續成功連線 60 秒後重置預算。上限後停止，提供手動重連／重新登入。
- 001 必須指向本帳號才算登入。464、432、433 為終止錯誤，不自動重試；不將登入成功等同房間可用。
- 每 30 秒送一次帶 token 的 PING；15 秒內未收到匹配 PONG 視為失聯。伺服器 PING 立即 PONG。
- Electron `powerMonitor` suspend 暫停連線及排程；resume 重新登入、JOIN，並重取各 MP 分頁 settings／listrefs。模擬事件已測；真實 OS 休眠仍待驗證。
- 僅恢復仍開啟且可恢復的分頁。被 KICK、伺服器拒絕加入或已關閉的分頁不會自動重入。一般頻道重新 JOIN；私訊恢復為本機對話，並不宣稱對方在線。
- 重連不重送聊天或比賽指令。初版仍未開放比賽變更。Renderer reload 保留 Main 連線，登出／關閉視窗清除記憶體紀錄。
- JOIN、PART、一般聊天及查詢共享全連線至少 1 秒間隔；JOIN／PART／恢復查詢經有界分頁排程，手動聊天／查詢在忙碌時拒絕而非偷偷排隊。註冊與 PING／PONG 不受此應用操作節流，以免阻塞協定握手。
- socket 待寫入資料超過 64 KiB 時停止接受該次傳送；沒有無限累積訊息的送出佇列。

## 房間觀測契約

`Room` 新增 `syncState`、`observedAt`、`beatmap`、`mods`、`slots`、`phase`、`kind` 與 `members`。Renderer 不自行從聊天文字推算權限或狀態；Main 只收集當前指定 MP 查詢中的 BanchoBot 回覆。

| 欄位／狀態 | 語意 |
| --- | --- |
| unknown | 尚無本次可用觀測 |
| loading | 正在收集 settings；前次欄位已清除 |
| partial | 缺欄位、逾時、格式不支援、重複 slot／UID、History 不符等；不能推定 NM、空房或一致 |
| complete | 已收集相符 History、模式、地圖、Mods、玩家數及等量唯一 slot／UID；僅代表本次已解析欄位完整 |
| stale | 斷線、觀測超過 10 秒，或收到不能沿用舊觀測的 bot 訊息；保留的值僅供參考 |
| beatmap | `{ id, title }` 或 null；只有明確地圖行才填入 |
| mods | 明確的 mod 字串陣列；None／NoMod／No Mod 為 `[]`，缺資料為 null |
| slots | 最多 16 筆 `{ slot, osuId, username, status, team, host }`；UID 來自 slot URL，與登入帳號的 UID 證明無關 |
| phase | unknown／idle／playing；settings 不推定 idle，僅已辨識事件提供階段觀測 |
| members | NAMES／JOIN／PART／KICK／NICK／QUIT 的頻道暱稱，最多 1,000 個；只供補完，不代表玩家或裁判 |

已辨識的地圖／Mods／玩家異動會讓觀測過期，並合併排入一次唯讀 settings 更新；開始／結束／中止事件只更新階段並標示需重查，不執行比賽操作。未知 bot 行僅使觀測過期，避免未知回覆觸發自動查詢循環。

settings 收集在 `Players` 與所需 slot 數滿足時結束，8 秒逾時保留 partial。缺失欄位不沿用前次值；未知或插入的 bot 行使收集結果不能宣稱完整。listrefs 僅在本次查詢看到標頭後，按目前登入暱稱確認列名；缺少本人或逾時仍為 unknown，不能宣稱無權限。

**complete 並不是 CORE-01 的操作放行條件。** 比賽階段、模式／Mods 政策、OCLR revision、裁判權限與 fresh preflight 尚須由後續操作核心聯合核對。IRC 沒有 query ID，無法證明同一 TCP 連線內的相同文字一定屬於最新查詢；晚到回覆在沒有 collector 時不回填，但重新查詢時的歧義仍須真實樣本與 CORE-01 處理。

既有真實空房樣本僅證明 History／模式／Players: 0／listrefs。新增地圖、Mods、slot、事件與重連驗證使用合成伺服器，不能改記為真實 Bancho 已驗收。

## 一般頻道、私訊及補完

加入欄可切換比賽房間、一般頻道（如 #osu）或私訊。三者共用最多 8 分頁、每頁 1,000 則記憶體訊息、未讀／提及與固定目標保護。MP 的正整數 `id` 是 MP ID；非 MP 對話的負整數 `id` 僅是本機分頁識別，禁止拿去作 OCLR room binding。

- 收到私訊會在容量內開啟背景分頁，不搶走目前選擇；開啟私訊不等於對方在線，401 使該對話停用傳送。
- 一般頻道及私訊沒有 settings／listrefs 按鈕能力。BanchoBot 私訊唯讀，避免不帶 `!mp` 的文字被解讀為指令。
- Tab 以目前輸入末尾片段補完第一個排序匹配的暱稱，來源為 NAMES、已觀測 slot 與聊天 sender；IME 組字時不補完、不送出。
- 只接受一般文字，原有指令／控制字元／UTF-8 長度限制及外部連結限制保留。

## 可選安全保存（IRC-02）

預設不記住登入。勾選後只在收到成功 001 時，將帳號與 IRC 密碼整體經 Electron 45 的 async safeStorage 加密，再以暫存檔替換固定 `userData/irc-credentials.enc`；不建立明文副本，不把密碼回傳 renderer。讀取時驗證大小、解密並重新驗證欄位，依 `shouldReEncrypt` 重加密。

- macOS／Windows 只有 async encryption available 才允許保存；Linux async provider 的安全保證未驗證，暫時 fail closed，仍可使用記憶體登入。
- 保存失敗不假報成功；可見錯誤並維持已建立的 IRC 連線。已保存登入不可解密時，使用者可忘記後重新輸入。
- 不勾選的新登入會先刪除舊保存。登出保留已明確選擇的加密憑證；「忘記已保存登入」刪除固定檔案與暫存檔。兩種操作在介面分開說明。
- 檔案操作序列化，後續忘記不會被較早的寫入覆蓋。非同步讀取登入有 generation，取消／登出後不得重新登入。
- 記憶體密碼留供本次重連，直到登出；JavaScript 字串無法保證底層抹除。保存憑證與 D06 聊天日誌是不同功能，LOG-01 預設加密日誌仍未實作。
- 產品保存生命週期測試使用合成加密 adapter，不代表 Windows／Linux 金鑰鏈實測；macOS 既有 SPIKE safeStorage 證據也不等於新版本的跨版本升級驗收。

## 驗證及 M1 出口

本輪 `npm run typecheck` 通過，`npm test` **26／26 通過**，`npm run test:ui` 的聊天／恢復與憑證兩個 Electron smoke 全部通過；桌面測試使用真實 Main／sandboxed Preload／renderer，以本機假 IRC 替代網路。合成 UI 結果保存於 [evidence/ui-smoke-recovery.json](evidence/ui-smoke-recovery.json)。另有 [合成憑證 IPC 生命週期結果](evidence/credential-smoke.json)，涵蓋錯密碼不保存、延遲解密遇登出取消、忘記、不可用 provider、保存失敗及損壞檔案。已目視檢查登入、重連、恢復及私訊畫面，900×640 重連時輸入框與頁尾保持可見。`npm run package:mac` 已產生 macOS arm64 0.4.0 內部測試 App（未簽章／公證）。本輪未連線真實 Bancho，未使用使用者憑證或操作真實比賽。

| 任務 | 本次結果 | M1 尚需證據 |
| --- | --- | --- |
| DESK-01 | 有限 IPC、重載、重連介面與 sandbox 桌面 smoke | Windows／Linux 實機與真實 OS 休眠／IME |
| IRC-01 | 有界重連、心跳、共享節流、取消與舊 epoch 隔離 | 真實 Bancho 多房重連及實際網路中斷 |
| IRC-02 | 可選加密保存、登入失敗停止、取消非同步讀取 | 產品 OS 金鑰鏈／重啟／升級矩陣；Linux provider |
| IRC-03 | 一般頻道／私訊、名稱補完、分頁及原有聊天功能 | 真實頻道／私訊互通、三平台 IME |
| STATE-01 | query-scoped 完整／部分觀測、逾時及過期狀態 | 真實有玩家 map／mods／slot／事件樣本、格式與權限錯誤覆蓋 |

上述缺口保留為驗收工作，沒有用合成資料代替真實證據，也不將 M0／SPEC-01 的未凍結基線改成完成。全部 M1 驗收通過後，依既定規則建立 annotated `v<package version>` 並推送；本次 0.4.0 僅提交及推送程式／文件。
