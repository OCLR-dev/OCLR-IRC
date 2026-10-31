# OCLR-ref-tools MVP 開發任務與驗收

- 文件版本：0.4（M0 驗證與條件式契約基線）；日期：2026-10-27
- 狀態：SPEC-00 已盤點、SPIKE-01／02 部分實測、SPEC-01 已更新未凍結；使用者另授權登入／唯讀初版；正式 API、migration 與部署未開始
- 關聯：[專案設計](project-design.md)、[桌面授權](contracts/desktop-authorization.md)、[context API](contracts/referee-context-api.md)、[審查及已確認決策](design-review.md)

## 1. MVP 完成定義

一名主控裁判能在三平台使用同一工作流程，登入 IRC 與 OCLR，選擇本人指派場次，綁定或建立房間，完成設定、邀請／分隊／槽位、圖池切換與比賽控制，保存遮蔽紀錄並返回 OCLR 賽果審核。

P0 自動操作支援 osu! standard、Head To Head 1v1／Team VS、Score V2；其他模式顯示資料並保留手動 IRC。正式演練只用經指定的測試場次與房間，合成 UID、地圖及範例 payload 不可送入真實 Bancho。

### 1.1 包含與後續範圍

| P0 必須完成 | P1 另行規劃 |
| --- | --- |
| 單一主控、單一目前 OCLR 場次，多 IRC 分頁 | 多裁判控制鎖、跨裝置交接、遠端房間綁定 |
| OCLR 瀏覽器授權、短效 token、refresh、撤銷 | 重啟後記住 OCLR 登入、自訂協定 callback |
| 本人場次列表、完整 context、15 秒輪詢 | SSE、跨場次監看 |
| 基本開房、設定、邀請、分隊、選圖、計時與開始 | Pick／Ban、擲骰、TB 流程、複合規則助手 |
| 常用訊息、應用內快捷鍵、預設加密本機日誌、保存開關／刪除與匯出、MP 連結 | OBS 輸出、進階搜尋、診斷回放 |
| OCLR 審核頁入口 | 在桌面進行 MP 匯入與裁判提交 |

正式比分與發布繼續由 OCLR 原有審核流程負責。沒有真實桌面授權與 context 整合時，即使手動 IRC 可用，也不能標記整個 MVP 完成。

## 2. 責任與估算方式

- D：桌面工程；B：OCLR 後端／網站工程；Q：測試與裁判演練，可由團隊兼任。
- S：約 0.5–1 人日；M：約 1–2 人日；L：約 2–3 人日；XL：約 4–6 人日；屬初估，不是排程承諾。多人共同負責一列時為該任務合計工作量，不分別重複計算。
- 以表列量級逐項加總，桌面主責、後端主責、共同規格與驗收發行分開估算；這四類不可把並行工作量直接相加當作日曆天。各功能任務已包含自身必要單元／契約驗證，QA-01 是整合故障與實際演練。
- 以 1 位 D、1 位可配合的 B 及共享 Q 為假設，完整整合測試版本暫抓 8–12 週；6–8 週僅可作範圍較小里程碑的目標。真實 OAuth、三平台加密儲存與重大 Bancho 差異可能延長；D08 已確認先交付內部測試版，公開簽章／更新另行規劃。
- 本輪交付含 M0 隔離實驗與證據；SPEC-01 聯合定版仍待進行。不得將文件存在視為後端已上線。

| 工作類別 | 任務數 | 表列人日區間 |
| --- | --- | --- |
| 桌面主責（D） | 20 | 28–49 |
| OCLR 後端主責（B） | 6 | 10–16 |
| 共同規格定版（D＋B） | 2 | 2–4 |
| 整合驗收及發行 | 2 | 6–9 |
| 合計工作量 | 30 | 46–78（可部分並行，非日曆天） |

## 3. 工作拆分

### 3.1 定版與技術驗證

| ID | 負責／量級 | 依賴 | 工作與交付物 | 驗收條件 |
| --- | --- | --- | --- | --- |
| SPEC-00 | D＋B／M | 無 | 確認需求邊界、待驗證假設與合成資料，納入已確認 D01–D08 與 D06 保存配套 | 已完成需求／假設盤點，見 M0 SPEC-00；產品政策已確認，技術缺口不宣稱已通過 |
| SPIKE-01 | D／L | SPEC-00 | 在指定測試房蒐集登入、settings、map／mods、start／abort、make／close、權限錯誤與重連樣本 | 確認可信 sender、訊息邊界、可觀測狀態、MP／頻道 ID、UID 證據可用性、#UID 行為及房名限制；未知項列出 |
| SPIKE-02 | D／L | SPEC-00 | 三平台 callback 頂層導覽、SQLite driver、系統憑證儲存、日誌加密與 WAL／暫存去明文、IME／快捷鍵及打包驗證 | 產生選型記錄；loopback 不對外綁定；安全儲存不可用時不保存秘密 |
| SPEC-01 | D＋B／M | SPEC-00、SPIKE-01、SPIKE-02 | 依實測審閱兩份契約、欄位來源、預設期限、角色與 null 語意，依已確認產品決策與儲存實測定版 | 欄位標明既有／新增／缺漏；意圖檢查、模式、隱私、期限與錯誤碼一致；未定案不得當成實作事實 |

SPIKE-01 若無法可靠取得特定狀態，正式規格使用 unknown／人工檢查，不能以猜測補齊。D05 已確認採登入暱稱匹配及裁判核對，並明示不等於 UID 證明；後續若變更為嚴格 UID 證明，需在 SPEC-01 增補可靠來源與任務估算，不讓未存在的身份服務隱性卡住 MVP。mismatched／unavailable 一律阻擋 OCLR 衍生變更，手動模式另有標示。

本輪狀態（2026-10-27）：

| 任務 | 狀態 | 證據／未完成條件 |
| --- | --- | --- |
| SPEC-00 | 本輪盤點完成 | [需求、假設與操作邊界](m0/spec-00.md) |
| SPIKE-01 | partial | 新房已核對 History／listrefs，定位並修正 LF 漏讀；mutation／拒權／重連／UID 等仍缺證據 |
| SPIKE-02 | partial | macOS arm64 callback、SQLite／加密／same-build key restart、實驗打包通過；其餘平台／IME／升版未測 |
| SPEC-01 | 已更新，未聯合凍結 | [來源映射、選型與 G01–G06](m0/spec-01.md)；M0 出口仍未通過 |

完整結果見 [SPIKE 報告](m0/spike-results.md)。產品任務的依賴不因本輪有 commit 就視為滿足。使用者隨後明確授權先完成登入介面，並確認免費 HeroUI／不引入 Pro；DESK-01、IRC-01／02／03、STATE-01 的有限子集已有初版，均不標為完整完成，範圍及測試見 [初版說明](initial-preview.md)。

0.2.0 增量：IRC-03 新增單一房間一般聊天、虛擬列表及連結；IRC-01 新增聊天／查詢共用節流及批次推送；STATE-01 新增 KICK／PART／ERROR 失效處理。只使用合成伺服器驗證，三項均仍為 partial，M1 未全部完成。桌面維持 TypeScript，伺服器 API 採 Node.js；詳見 [M1 結果與缺口](m1/chat-workspace.md)。

0.3.0 增量：IRC-03 新增最多 8 個 MP 房間分頁及分頁未讀／提及；query 與 chat 均綁定 roomId／epoch，背景查詢與逾時彼此隔離，Renderer reload 保留 Main 狀態。一般頻道、私訊、補完、重連及完整快照仍未完成，M1 保持 partial；見 [多房間驗證](m1/multi-room-workspace.md)。

0.4.0 增量（2026-10-28）：IRC-01 加入有界退避、心跳與休眠恢復，JOIN／PART／查詢／聊天共享節流；IRC-02 加入可選安全保存；IRC-03 加入一般頻道／私訊及 Tab 名稱補完；STATE-01 加入 query-scoped map／mods／slot 觀測、partial／complete／stale 與重連重查。跨平台實機、產品安全儲存矩陣及真實擴充格式仍待驗收，M1 不標完成、不建 tag。見 [本次實作與驗收缺口](m1/recovery-and-sync.md)。

### 3.2 OCLR 後端與網站

| ID | 負責／量級 | 依賴 | 工作與交付物 | 驗收條件 |
| --- | --- | --- | --- | --- |
| OCLR-01 | B／L | SPEC-01 | 補齊／映射房名模板、明確模式、NF／FM、startPolicy 與 revision；提供必要工作人員設定入口及本場直播最小投影 | 管理權限、版本衝突與稽核遵循既有模式；未設定回 null；依 D04 設定介面預選 optional 並由有權工作人員保存；既有缺值不回填，required 仍支援 |
| AUTH-01 | B／L | SPEC-01 | 授權交易、系統瀏覽器頁、網站登入延續、原生表單 approve／deny、S256 與 loopback allowlist | GET 不授權；actor 源自網站 session；頂層 303 callback、CSRF、逾時、錯 redirect、重複批准均正確處理 |
| AUTH-02 | B／L | AUTH-01 | 單次交換、opaque token hash、refresh family、期限與原子輪替 | 併發 exchange 只成功一次；refresh 重用撤銷 family；role／期限每次驗證；秘密不寫入日誌 |
| AUTH-03 | B／M | AUTH-02 | me、revoke、網站本人 desktop session 列表與撤銷 | 只能管理本人；網站登出與 desktop 期限行為符合契約；離線撤銷不可假報成功 |
| CTX-01 | B／L | SPEC-01、OCLR-01、AUTH-02 | 共用裁判授權服務；列表、cursor、context 原子查詢與最小投影 | 只讀本人指派；Admin 亦受限制；不存在與非本人場次不洩漏；改期直播及未公開圖池邊界正確 |
| CTX-02 | B／M | CTX-01 | context revision、逐意圖 requiredLocalChecks、allowedIntents／issues、capturedAt、錯誤及限制、schema／OpenAPI | server 不推定目前地圖；null、unknown、不可運作場次及超限有確定行為；read 無上游刷新或業務寫入 |

授權持久化、hash、唯一約束、到期清理與領域新增欄位應透過 OCLR repository 的 migration 工作流實作，使用獨立測試資料庫；不在桌面 repository 建立第二套正式資料庫或複製競賽權威邏輯。

### 3.3 Electron 與 IRC 底座

| ID | 負責／量級 | 依賴 | 工作與交付物 | 驗收條件 |
| --- | --- | --- | --- | --- |
| DESK-01 | D／M | SPEC-01 | Electron／TypeScript／React 專案、Main／Preload／Renderer、IPC、三欄工作區 | context isolation／sandbox／CSP；無任意 socket／IPC、URL 或檔案代理；Renderer reload 不終止核心 |
| IRC-01 | D／L | DESK-01、SPIKE-01 | TCP transport、行緩衝、UTF-8／長度驗證、PING／PONG、關閉及退避 | 半行、多行、混合 CRLF／bare LF、Unicode、斷線與心跳測試通過；全連線共享節流 |
| IRC-02 | D／M | IRC-01、SPIKE-02 | 帳號正規化、IRC 專用密碼、登入錯誤、可選安全保存 | 伺服器確認才顯示已登入；密碼錯誤不重連風暴；PASS 永不入日誌 |
| IRC-03 | D／M | IRC-02 | 頻道／私訊、補完、未讀、提及、連結、歷史與分頁 | 使用者文字不能執行 HTML；不因切分頁改變已排定房間 |
| STATE-01 | D／L | IRC-03、SPIKE-01 | Bancho parser、事件模型、房間 reducer、settings 快照重建 | 只信任指定來源；settings History 核對 MP／channel，分行 listrefs 以查詢範圍收集；partial 保留 unknown，NAMES 不代表玩家或裁判權限 |

### 3.4 操作核心與裁判功能

| ID | 負責／量級 | 依賴 | 工作與交付物 | 驗收條件 |
| --- | --- | --- | --- | --- |
| CORE-01 | D／L | STATE-01、SPEC-01、LOG-01 | 操作計畫、逐意圖前置條件、固定 room ID、回覆匹配、每房間序列化及全連線節流 | queued／sending／awaiting／success／failure／unknown 可區分；開房送出前保存最小 pending 記錄；無重複排入；恢復記錄被清除後 recovery_uncertain 未解除不得開房 |
| CORE-02 | D／M | CORE-01 | 部分失敗、取消、超時與重連恢復 | 在途不明先核對；不自動重送 make／start／abort；已完成步驟不假裝回滾 |
| MANUAL-01 | D／M | CORE-02、IRC-03 | 手動 slash／!mp 指令閘道、共用佇列、緊急控制優先序與模式標示 | 手動變更先停止衝突計畫；不能繞過節流或注入多行；不把傳出 echo 視為成功 |
| LOBBY-01 | D／M | CORE-02 | 綁定現有房、開房、房名、模式／槽位／密碼／鎖房、房間權限資訊 | 等待實際 room ID 再初始化；重連／本機重啟不重開；無 addref 權限不顯示成功 |
| PLAYER-01 | D／M | LOBBY-01 | 正式名單對照、批次邀請、選擇 lineup、顏色及槽位、必要的換人政策人工核對 | 使用 OCLR roster 穩定 UID；#UID 傳送行為仍待 SPIKE-01 實測，未驗不放行；bench 不自動上場；邀請不等於到場；不默認 home=red；不宣稱能自動判定熱身或換人時機 |
| MAP-01 | D／M | CORE-02 | 圖池槽位 UI、beatmap ID、完整 room Mods／FM profile、差異與人工政策檢查 | 切圖與 Mods 都確認才完成；NF 不硬編碼；未知 FM 政策阻擋，metadata 缺失不誤判 ID |
| CONTROL-01 | D／M | PLAYER-01、MAP-01 | timer／start／aborttimer／abort、目前比賽階段與防誤觸 | 一般 timer 與開始倒數分開；Start 需完成規則與本地檢查；取消不回報成已開始 |
| UX-01 | D／M | CONTROL-01、MANUAL-01 | 常用訊息、應用內快捷鍵、指令搜尋、兩種身分狀態與失敗提示 | IME 組字與輸入欄不誤觸操作；危險按鈕顯示目標與影響 |
| LOG-01 | D／XL | DESK-01、IRC-03、SPEC-01、SPIKE-02 | 中立事件記錄介面、migration、最小恢復記錄；預設加密本機日誌、7 天清理、開關／刪除／匯出與重啟鎖定 | 依專案 §4.2 隔離及先去密；不存 context；無金鑰不回退明文；關閉清日誌不清防重送記錄；必要 pending 寫入失敗阻擋開房 |

在後端完成前，PLAYER-01／MAP-01 可用隔離的合成資料及手動輸入驗證；此時標明 demo／manual，不能聲稱已完成 OCLR 連線。

### 3.5 端到端整合與交付

2026-10-29：0.7.0 新增關窗保留 session／背景輪詢、系統匣恢復、Linux 工作列 fallback、單實例喚回及明確退出清理；見 [背景執行](m1/background-running.md)。屬 DESK-01／IRC 生命週期增量，無開機自啟或新保存政策，M1 實機 gate 與 OCLR 正式聯調缺口仍保留。

2026-10-28 增量：使用者另要求手動新建房間按鈕，0.5.0 先交付 LOBBY-01 的 make 切片，連同 CORE-01／02 必需的單次意圖、送前持久化、節流、未知鎖定與重連不重送。新增安裝範圍最小 SQLite metadata，不包含私人日誌或 OCLR 綁定；詳細界線與證據見 [手動開房](m1/create-match-room.md)。CORE-01／02、LOG-01、LOBBY-01 **均保持 partial**，完整依賴未完成；尚需真實 make 樣本、正式分帳號／場次 migration、加密日誌、房內設定與權限等驗收。此功能版不代表 M1／M2 完成，不建立 milestone tag。

2026-10-28 PR #409 增量：使用者指定只做桌面接入，網站 API 另行開發。0.6.0 交付 Main 的外部瀏覽器／PKCE／loopback／記憶體 token、single-flight refresh、本人場次／panel adapter、原生三階段視圖、共享 builder 預覽／複製及隱私清理。AUTH-03、INT-01／02 與 PANEL-R 均為 **partial（桌面合成驗證）**；後端 AUTH／CTX、正式 API 聯調與跨平台實機未通過，不把 panel wrapper 當完整操作 context。未開放 INT-03 的 IRC 執行、PANEL-W／C、結果寫入或 LOG-01。交接見 [候選契約](contracts/pr409-desktop-read.md)。

| ID | 負責／量級 | 依賴 | 工作與交付物 | 驗收條件 |
| --- | --- | --- | --- | --- |
| INT-01 | D／M | DESK-01、IRC-02、AUTH-03、LOG-01 | 系統瀏覽器授權、loopback、記憶體 token、single-flight refresh、登出與 generation | 三平台完成；callback 不回顯秘密；網路不明不重播 refresh；舊回應不回填；IRC 連線獨立維持；OCLR 登出／失效清關聯日誌與緩衝 |
| INT-02 | D／M | INT-01、CTX-02 | 我的場次、完整快照驗證、cursor、輪詢、revision 差異及撤權 | 新資料原子替換；409 分頁重啟有界；429 退避；過期與撤權清除策略符合契約；歷史日誌逐場重新驗權才解鎖 |
| PAIR-01 | D／M | INT-01、IRC-02、SPEC-01 | 實作 D05 定版的帳號配對與改名／未知狀態，綁定登入 generation | 不把 nickname_matched 標成 UID 證明；不符時阻擋全部 OCLR 衍生變更，手動模式仍明確可用 |
| INT-03 | D／M | INT-02、PAIR-01、UX-01、LOG-01 | context 映射計畫、逐意圖檢查聯集、重要操作前重讀、MP／審核頁入口 | 開房不需 room_permission；Head To Head 不需顏色；Start 檢查目前 entry；切場次拒絕舊回應；無 fallback |
| QA-01 | D＋B＋Q／XL | INT-03 | 整合故障、日誌檢查、三平台及指定測試場次全流程演練 | 本文件第 5 節案例通過；分開記錄合成與真實環境證據 |
| RELEASE-01 | D＋Q／L | QA-01、SPIKE-02 | 依 D08 交付三平台內測 CI、安裝包、手動升版 migration 及回歸；列出後續公開簽章／公證與自動更新清單 | 內測包明示簽章狀態且可手動升級；公開版另外驗證簽章／公證及自動更新；比賽中不強制重啟，私人資料未進產物 |

## 4. 里程碑與進入條件

| 里程碑 | 完成範圍 | 進入下一階段的條件 |
| --- | --- | --- |
| M0：契約定版與技術基線 | SPEC-00 → SPIKE-01／02 → SPEC-01 | 已確認產品決策及來源缺口、配對證據、callback、依賴與支援矩陣已記錄 |
| M1：獨立 IRC 可用 | DESK-01、IRC-01／02／03、STATE-01 | 登入、聊天、同步與斷線恢復可驗證 |
| M2：手動裁判工作流 | CORE、MANUAL、LOBBY、PLAYER、MAP、CONTROL、UX、LOG | 用隔離資料完成全程；不會重送危險指令 |
| M3：OCLR 整合 | OCLR、AUTH、CTX、PAIR、INT 全部 | 本人場次、真實登入、revision 與撤權演練完成 |
| M4：小範圍測試版本 | QA-01、RELEASE-01 | 三平台安裝與升級、故障案例及裁判演練記錄可審閱 |

後端 AUTH 與資料來源建置可和 M1／M2 並行；INT-03 依賴完整兩側契約，不以合成 API 取代正式整合驗收。

## 5. 必要驗收案例

| ID | 情境 | 預期結果 | 主要任務 |
| --- | --- | --- | --- |
| AC-01 | IRC 密碼錯誤、空格／底線帳號 | 顯示正確類型錯誤、不無限重試；秘密不入日誌 | IRC-02 |
| AC-02 | OAuth 拒絕、逾時、錯 state、錯 verifier、重複 callback／exchange | 無未經同意或重複發行；重新登入路徑清楚 | AUTH-01／02、INT-01 |
| AC-03 | access 到期、同時多個 GET、refresh 回應遺失／重用 | 單次更新；不反覆用舊 refresh；撤銷 family／重新登入可理解 | AUTH-02、INT-01 |
| AC-04 | 網站登出、桌面登出、網站撤銷、離線登出 | 各自符合契約；離線不宣稱遠端已撤銷 | AUTH-03、INT-01 |
| AC-05 | 無指派、移除指派、撤銷角色、Admin 讀非本人場次 | 不洩漏資料；清理快照及待送操作；不降級 cookie | CTX-01、INT-02 |
| AC-06 | 規則為 null、未知模式、未知 Mods／FM、未解析隊伍 | 對應 intent／entry 阻擋，已知資料仍正確呈現 | CTX-02、MAP-01、INT-03 |
| AC-07 | 連點開房／Start、寫入後斷線、切換房間分頁 | 不自動重播；目標固定；結果不明顯示 unknown | CORE-01／02、LOBBY-01 |
| AC-08 | 初始化或切圖只有前半成功 | 後續停止；顯示已完成／失敗步驟，狀態不假報一致 | CORE-02、MAP-01 |
| AC-09 | 選手未到、非名單玩家、bench、顏色／槽位不同、換人政策不明 | 差異可見；邀請與到場分開；不推定 lineup 或換人時機，不明政策不放行換人計畫 | PLAYER-01、CONTROL-01 |
| AC-10 | 預覽後 OCLR 改圖池／規則／名單／直播時間 | revision 更新、預覽與政策確認作廢；改期提示直播重確認 | CTX-02、INT-03 |
| AC-11 | 列表跨頁資料改變、429、API 超時、未知契約版本 | 分頁重啟有界、遵守 Retry-After、stale 禁止衍生操作 | INT-02 |
| AC-12 | IRC 重連、電腦休眠、Renderer reload | 重取房間狀態；不重啟比賽；Renderer reload 不斷核心連線 | IRC-01、CORE-02、DESK-01 |
| AC-13 | 假 BanchoBot 訊息、HTML／控制字元、過長文字或房名 | 不改權威狀態、不執行 HTML、不注入額外 IRC 行 | STATE-01、IRC-01、UX-01 |
| AC-14 | 日誌、錯誤、明確匯出、資料庫與打包產物 | 無秘密／完整 context／私人明文暫存；預設加密保存聊天及去密操作；隔離、刪除及匯出範圍符合專案 §4.2 | LOG-01、QA-01 |
| AC-15 | 三平台 IME、Cmd／Ctrl、縮放、通知、安裝升級 | 主要互動一致、無輸入誤觸；比賽中更新不強制重啟 | UX-01、RELEASE-01 |
| AC-16 | 完成指定測試場次並回到 OCLR 審核 | MP 來源及操作紀錄可核對；未自動產生或發布正式賽果 | QA-01 |
| AC-17 | 手動指令與快捷計畫競爭、應急 abort、假 echo | 共用佇列、停止衝突後續步驟；手動不冒充 OCLR 已核對操作 | MANUAL-01、CORE-02 |
| AC-18 | 開房無既有 room、Head To Head、單張壞 FM 地圖 | 開房檢查可滿足；Head To Head 無顏色要求；其他可選圖不被單一壞 entry 全域阻擋 | CTX-02、INT-03 |
| AC-19 | startPolicy 缺失／required／optional；15／60 秒輪詢及 Start 連點重讀 | 缺值不猜測；依明確直播政策；最小輪詢不阻擋 preflight，連點只合併一次讀取 | OCLR-01、CTX-02、INT-03 |
| AC-20 | 登出／切帳號／切場次後舊 API 回應抵達；開房送達後 App 崩潰 | 舊 generation 無法回填；pending／unknown 需人工核對；清理後 recovery_uncertain 仍阻擋自動再開；不還原已撤權資料 | LOG-01、INT-01／02／03 |
| AC-21 | 初次啟動、關閉保存、7 天到期、手動刪除、Linux 無安全金鑰、寫入失敗 | 預設偏好開啟且實際保存狀態可見；關閉清既有日誌但保留最小防重送記錄；到期清理；無金鑰不落明文；pending 寫入失敗不開房 | SPIKE-02、LOG-01、CORE-01 |
| AC-22 | 重啟讀歷史、跨帳號、單場撤權／全域撤權、離線登出與晚到寫入 | 同帳號重新登入，OCLR 日誌逐場驗權後才展示；無權立即清受影響日誌／恢復記錄／緩衝；離線不假報遠端撤銷；舊 generation 不重新落盤 | LOG-01、INT-01／02／03 |

每項案例記錄平台／版本／契約版本、合成或真實來源、預期及實際結果。Parser 採真實回覆去識別樣本加合成邊界案例；token、授權及 revision 需驗證交易與併發，不只測 UI 是否能按下按鈕。

## 6. 發布完成條件

- 所有 P0 任務完成且第 5 節必要案例通過，未解風險及不支援狀態有明確介面。
- 三平台核心操作流程與安裝／手動升版經驗證。D08 已選內測，未簽狀態須明示且不可宣稱公開發行完成；後續公開版另外必須完成 Windows／macOS 簽章、macOS 公證與自動更新驗證。
- 真實 OAuth、專用桌面 API、正式角色／指派邊界及測試房全流程具有獨立證據。
- 後端 schema、OpenAPI 與桌面 DTO 對齊，契約變更有版本記錄；無硬編碼真實 token、UID 或房間。
- migration、更新失敗及操作結果不明都有復原路徑，沒有背景重播危險指令。
- 基本使用說明涵蓋三種身分、IRC 明文限制、帳號配對、資料新鮮度與賽果審核入口。
- OCLR 後端部署依其既有工作流另外執行；桌面測試通過不等於後端已部署。

## 7. 設計決策與追蹤

D01–D08 已確認並統一記錄於 [設計決策](design-review.md)。D06 改為預設本機保存，SPIKE-02 由 M 調為 L、LOG-01 由 M 調為 XL，總估算增加 4–5 人日；仍為 30 項任務，新增 AC-21／22 至 22 項驗收。SPEC-01 尚須依技術證據聯合定版，不能把產品確認當成實作完成。

工程選型（SQLite driver、Electron 版本、最低 OS、解析樣本）由 SPIKE-01／02 提供證據後定版；若影響使用者範圍、平台支援或交付日期，回到相應產品決策。不得為讓時程看似完成而省略必要身份、資料或平台驗證。

## 8. Milestone 完成後自動標記與推送

使用者於 2026-10-27 授權：每次完成一個 milestone，執行者自動 commit、建立 annotated Git tag 並 push 分支與該 tag，無須再次詢問。

- 以第 4 節的 milestone 範圍與完成條件為準；功能增量、partial 或版本號調整不等同 milestone 完成。目前 0.2.0 為 M1 部分交付，不補建完成標記。
- 完成必要驗證，更新任務狀態、證據及已知限制後，將標記指向該完成提交。
- Tag 使用 `v<package.json version>`；註解包含 milestone ID、交付摘要及驗證結果。建立前核對本機與遠端名稱；不覆寫或強制移動既有 tag，必要時先調整版本。
- 只推送本次指定 tag，不使用批次 `--tags`。確認遠端分支與 tag 均指向預期提交，於交付回覆提供版本與 tag。
- 原里程碑 tag 授權不包含後端部署或公開簽章發行。2026-10-28 使用者另行要求 Release CI，已新增符合版本 tag 的三平台自動 Pre-release 流程，見 [Release CI](release-ci.md)；不因此放寬 milestone 完成條件或提前建 tag。


## 9. 裁判面板整合設計追蹤

[網站裁判面板整合草案](referee-panel-integration.md) 記錄 #312–#317 與桌面的 PANEL-R／X／W／C 子階段、讀取快照、新增寫入 scope、版本／冪等及正式結果邊界。這些是設計追蹤，未新增已承諾 P0 任務或改變 M0–M4 完成條件；寫入／BP 排程及正式契約仍待定。

### 2026-10-29 玩家槽位顯示增量

- 已將既有 settings 玩家資料整理為 16 槽面板，包含隊伍、房主、Ready 計數與未知／過期提示。
- 詳見 [玩家槽位](m1/player-slots.md)；沿用唯讀同步，不新增房內操作權限。M1 尚未完成的實機驗收條件維持不變。

### 2026-10-29 手動 MP 操作增量

- 依使用者要求加入換圖、Mods、立即開始與中止；完成 Main 固定命令生成、裁判／房間快照 gate、一次性預覽確認與不重送。
- 詳見 [手動 MP 快捷操作](m1/manual-mp-controls.md)。MAP／CONTROL 與 CORE 手動切片已實作；任意指令、倒數、正式 OCLR 執行、完整日誌及真實操作回覆驗收仍未完成，相關任務保持 partial，不建立 milestone tag。

### 2026-10-30 桌面端剩餘工作設計

[桌面 backlog](desktop-backlog.md) 以 `61f7ed4` 盤點已完成切片與 L01–L12 剩餘工作，分開實作缺口、真實驗收、外部 API 依賴及後續面板寫入。此輪只記錄設計與 GitHub issues，沒有變更 D01–D08、完成狀態或 M0–M4 的驗收門檻。CORE／LOG 的新拆分先定中立事件與最小恢復介面，避免相互等待。

2026-10-30：UX-01 增加房內指令搜尋、只開啟搜尋的 Cmd/Ctrl+K，以及只插入草稿的常用訊息。IME 組字／輸入欄快捷鍵防誤觸已以合成測試驗證；真實輸入法、輔助技術及跨平台實機仍待驗收，UX-01 保持 partial。

2026-10-30：PAIR-01 新增綁定雙方登入世代及 subject 的人工核對；IRC 名稱相符不當作 UID 證明，失效即停止 relay，唯讀場次仍可用。INT-01／02 正式服務與跨平台實機仍待驗收，保持 partial。

2026-10-30：L11／DESK-01 的 CI 成品驗證擴展至 Windows／Linux，核對壓縮包與 build identity，解壓後隔離離線啟動。跨版本及真實桌面使用驗收保持 partial。

2026-10-30：LOG-01 手動開房 schema 2 遷移已實作，按 IRC 暱稱雜湊分帳號；舊版無歸屬記錄只保留未知結果、不顯示房號。合成 migration／隔離／失敗回滾不代替實機升版；OCLR 場次歷史與完整 LOG-01 仍 partial。

2026-10-30：CORE-01／02、MAP-01 增加 Main 手動 map→mods 多步計畫、逐步讀回、取消／未知／斷線停止、FM 人工規則確認與 UI。原始命令不由 renderer 提供；兩步共用最小防重送記錄。正式圖池／完整 ruleset／真實 FM 與其他房間計畫仍 partial，繼續以合成資料開發。

### 房間設定合成進度（2026-10-30，#8）

已加入 Main 驗證的改名、隊伍／計分／容量、鎖定槽位、房主、密碼及關房預覽。密碼只於確認送出時傳入 Main，預覽與記錄遮罩；關房需輸入完整頻道名稱，離開分頁仍是 PART。所有變更固定房間與 epoch，過期或觀測變動後失效，送出不等於執行成功。合成測試涵蓋各命令、單次確認、秘密隔離及無地圖設定；真實 Bancho 回覆、逐步初始化仍待完成，L04 保持 partial。

### 手動陣容合成進度（2026-10-30，#9）

玩家槽位提供手動 UID 名單、逐人出賽／隊伍／槽位選擇與差異核對。替補不會自動出賽；名稱只供顯示，依 UID 比對。觀測過期不推定到場或缺席。此名單僅目前房間記憶體使用，不是正式 OCLR roster，也不會發送邀請或換人命令。核心與 Electron 合成測試涵蓋相關狀態；正式名單、批次邀請／換人及真實 #UID 行為仍待完成，L05 保持 partial。

### 單筆玩家操作合成進度（2026-10-30，#9）

手動快捷操作新增 invite／move／team／kick。預覽固定 UID、房間及 epoch，移位／分隊／移出只能選擇已核對的房內玩家；邀請不得重複邀請已到場玩家。所有操作另要求輸入預覽姓名人工核對身份，槽位衝突與非分隊模式受到 Main 阻擋。送出不代表成功或到場，未知結果不重送。尚未取得真實 #UID 樣本；批次佇列、正式 roster／換人政策仍保持 partial。

### 逐步房間與陣容計畫（2026-10-30，#7／#8／#9）

房名與隊伍／計分模式可預覽差異後逐步套用；容量不包含在此計畫，仍使用獨立設定及人工核對。手動陣容可產生移位後分隊的計畫，必須逐人輸入觀測姓名及確認換人政策；未知玩家、缺漏、重複槽位、佔位循環均阻擋。每步以新的 settings／listrefs 及固定連線／房間 epoch 核對，外部結構變更、錯誤、逾時或斷線停止後續步驟；不回滾已觀測效果、不重送未知操作。計畫記錄仍使用最小恢復資料，重啟不重播。

### 手動圖池（2026-10-30，#10）

連續換圖介面可保存／選擇最多 200 個手動槽位，含地圖、room Mods、Freemod 及人工個人規則。Main 在記憶體驗證並管理版本；登出清除，不以 OCLR 圖池名義落盤。單項無效只阻擋該項，其他有效槽位可用。更新圖池會使舊預覽失效，停止尚未送出的圖池步驟，並要求重新套用後才通過相關 Start 核對。正式 OCLR entry 授權與遊戲 ruleset 切換仍待契約／觀測能力。

### Context 候選合成驗證（2026-10-30，#14）

已新增獨立 context schema、Main 純檢查器與注入式唯讀 reader：身分／場次隔離、逐意圖最低檢查、Start 圖／Mods／lineup／政策、人工確認指紋、single-flight、429、過期與撤權清除均有合成測試。尚未接入生產 IPC／HTTP 或衍生執行；正式契約、綁定控制器、#40 場次開房及真實聯調仍待完成。詳見 context 契約末節及 candidate JSON Schema。

### 指令導航補齊（2026-10-30，#12）

有限搜尋 registry 已涵蓋圖池、房間設定、初始化、玩家及陣容表單。搜尋只展開並聚焦既有表單，不呼叫變更 IPC；Cmd／Ctrl+K 與 Escape 保留 composition 保護。新增合成驗證確認全部面板定位、不送指令及小視窗聊天輸入區可見，真實 IME／螢幕閱讀器仍另驗。

### 場次開房候選控制器（2026-10-30，#40）

已用合成 context 與真實 IrcSession 驗證開房預覽、派送前重讀、一次性提交、可信回覆來源追蹤、JOIN 後唯讀查詢、逾時不重送及晚到房間隱私處理。正式 context／授權與日誌 hook 未接入前不註冊產品 IPC／UI，不以既有 panel 直接放行。詳見開房流程文件。

2026-10-30 #40 原因顯示補強：唯讀 panel 分別顯示已取消、賽果已核准、未開放操作與缺少規則；Main 仍拒絕複製指令。合成測試逐案驗證原因及拒絕效果，不代表正式 context 開房流程已接通。

2026-10-30 #16：補充 [面板寫入候選方案](contracts/panel-write-proposal.md)，涵蓋 revision／冪等、unknown、撤權及雙端衝突測試矩陣。僅設計；PANEL-W／C 仍待正式契約與排程，不啟用寫入。最新逐項合成證據及外部／實機阻礙見 [backlog 更新](desktop-backlog.md)。

房間三欄介面更新：加入／新建移入 HeroUI Modal，右側工具改為全高獨立欄及 HeroUI Tabs，支援收合與寬視窗調整寬度。900×640 合成檢查涵蓋輸入框可見、工具欄上下邊界、獨立捲動、分頁及無水平溢出；不取代實機 IME 驗收。

OCLR 房名帶入：新建房間表單訂閱已選場次的唯讀 panel，優先使用 session settings，否則 default settings；只取新鮮、相符場次且符合房名長度／控制字元限制的名稱。來源變更／登出清除舊名稱與確認；同一來源暫時過期時保留草稿並阻擋送出，恢復 fresh 後再可用；送出前再比對快照。仍為人工確認的手動開房，不取代 #40 的正式 context 流程，也不自動初始化或投影。

2026-10-30 規則契約補充：同步網站 #560 同 Mod Ban 控制與 TB 不可 Ban 的共享模型和 JSON Schema；typecheck 與 148 項合成核心／契約測試通過。UI／preload 未改，真實服務／三平台驗收仍按既有未完成項追蹤，不代表 milestone 完成。


2026-10-31 持續開發：修正 #10 圖池觀測完成與全連線節流的測試競態；#40 開房草稿在同來源背景刷新時保留但不可送出；#9 HeadToHead 手動陣容按 UID／槽位核對且計畫只移位；#10 relay 與手動操作共用重複／互斥 Mods 檢查。157 項核心合成測試通過，UI／CI 與未完成驗收以 [本輪紀錄](m1/issue-progress-2026-10-31.md) 及 PR 實際結果為準。沒有宣告完整 milestone 或新增正式 context 能力。

2026-10-31：追加網站直接 make 接收狀態，沿用本機開房防重送，並在房間驗證後轉入投影；不代表完整 context 自動執裁或 MVP 驗收完成。詳見 website-irc-relay.md。

2026-10-31 設定頁增量：側欄齒輪提供背景執行開關、zh-Hans／zh-Hant／en／跟隨系統與關於分頁，移除自訂退出入口。Main 保存有限偏好並驗證 IPC，關閉行為依偏好處理；語言不改動聊天、身份、譜面或命令，合成驗證與限制見 [設定頁](m1/app-settings.md)。不代表跨平台實機或完整 MVP gate 完成。
