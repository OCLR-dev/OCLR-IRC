# 桌面端剩餘工作設計與 GitHub 追蹤

日期：2026-10-30。盤點基線：`61f7ed4`（package 0.7.0），以程式、既有文件與測試範圍核對。此文件僅設計與拆任務，沒有新增功能實作。

「本地端」指 Electron 桌面程式的 Main／Preload／Renderer／本機儲存與交付，不新增 localhost HTTP 管理服務；現有 loopback 僅供授權 callback。網站 API 仍由另一邊開發。

## 已有能力與缺口判讀

| 已有能力／程式證據 | 尚缺部分 |
| --- | --- |
| `src/main/irc.ts` 登入、心跳、重連、多頻道及查詢；`settings.ts` 槽位快照 | 欄位級觀測、真實變體定版、完整 operation 結果核對 |
| `src/shared/mp-command.ts`、`mp-controls.tsx` 的 map／mods／start／abort | timer／倒數／取消、房間設定、選手、圖池計畫及自動核對 |
| `creation-store.ts` 最小開房 guard；`credential-store.ts` 加密登入憑證 | D06 預設加密日誌、歷史驗權、清理與分帳號恢復 migration |
| `src/main/oclr.ts`、`oclr.tsx` 的授權與唯讀 panel | 真實服務聯調、帳號配對、完整 context 與衍生執行；後端缺口屬外部依賴 |
| `background.ts`、CI 打包／簽章／release workflows | 真實 IME／provider／工作列／OS 生命週期與手動升級驗收 |

既有測試通過不等於真實服務／實機驗收；已完成切片不重建 issue 要求重寫。精確版本與歷史證據仍以各功能文件為準。

## 共用設計契約（提案，尚未實作）

- `RoomTarget = {roomId, roomEpoch, connectionGeneration}`，由 Main 發行／核對；重連、PART、切帳號使舊目標失效。
- `Observation<T> = {value, knowledge, observedAt, source, queryId, connectionGeneration, roomEpoch}`；unknown 不轉換成空值已確認。
- `OperationPlan = {operationId, source: manual|oclr, target, intent, preconditions, steps, planRevision, expiresAt}`。未建立房間的 make 以帳號／generation／create intent 綁定，取得實際 MP 後才建立 RoomTarget，不能使用假 roomId。
- `OperationStatus = queued|sending|awaiting|succeeded|failed|unknown|cancelled`；`evidence = {kind, observedAt, source, matchedFields}`。狀態效果符合不代表能證明由本客戶端造成，證據不足保持 unknown。
- 候選有限 IPC：`operations.preview(intent,target)`、`operations.execute(previewId,confirmed)`、`operations.cancel(operationId)`、`operations.snapshot()`／`onState`；型別名稱可實作時調整。驗證、序列化、限流、取消與去密均在 Main，不新增任意原始指令或檔案代理。
- 本機日誌與最小恢復資料分離。無金鑰時停止私人日誌落盤，但必要 pending guard 不得跳過；OCLR context／token 不落盤。
- 權限／回覆／期限／錯誤語意沿用既有文件。不得為方便先跳過現有 safety gate；L01 新 gate 必須有樣本與測試才替代。

## 優先順序與依賴

P0 表示完成既有 MVP 的必要工作，不表示所有項目當下可開始；P1 是後續便利性或仍待排程範圍。UX 的便利功能先列 P1，但 M2 所需 UX 驗收仍不能省略。

1. L01 與 L02 可並行設計／開發；L11 可立即驗收現有功能。
2. L03 依 L01 與 L02 最小事件／恢復介面；不與 LOG 形成循環依賴。L02 UI／匯出可後續完善，但相應驗收不因此算完成。
3. L04／L06／L07 接入操作核心，L05 接房間／操作能力；L08 使用同一 registry。
4. L09 桌面帳號配對可先用合成案例，真實聯調等網站；L10 等完整 context 與本地流程。
5. L12 只記後續設計，另確認寫入契約與排程；遠端控制鎖、公開自動更新不混入本期。

## 工作設計

### L01 · 房間欄位觀測與 Bancho 真實樣本定版

優先級：P0。對應既有任務：STATE-01／SPIKE-01／SPEC-01。

**現況與缺口**：現有 SettingsCollector 已解析 History、地圖、Mods、玩家與槽位，但 complete 要求所有欄位齊備；缺少地圖或 Mods 的回覆均為 partial，可能讓空房初始化也被阻擋。比賽階段與個人 Mods 仍缺完整觀測。

**設計**：建立欄位級 Observation<T>：value、knowledge（known／unknown／invalid）、observedAt、connectionGeneration、roomEpoch、source/queryId；維持原始可信來源檢查。槽位、容量、全域／個人 Mods、phase、timer 各有獨立新鮮度。操作用 requiredObservations 判斷，不再把單一 complete 當所有動作唯一 gate；變更前以去密真實樣本證明哪些欄位可以缺省，缺行不得直接推定 None、空槽或 idle。

**依賴**：無；是操作核心的先行工作。

**驗收**：

- [ ] 建立空房、有圖無 Mods、Freemod、Playing、分行／晚到／重複槽位與假 Bot fixtures，標示來源及允許使用範圍。
- [ ] 驗證有界只讀 preflight 的 query 範圍與過期規則；換圖／初始化不依賴已知舊地圖，Start 仍要求其必要觀測。
- [ ] 沒有樣本可證明的缺省格式保留 unknown，SPEC-01 明列未凍結欄位；真實測試不超出指定房間與操作授權。

### L02 · 預設加密本機日誌、帳號隔離與恢復記錄 migration

優先級：P0。對應既有任務：LOG-01／SPIKE-02。

**現況與缺口**：已實作可選加密 IRC 憑證和安裝範圍單筆開房 SQLite guard；尚無 D06 預設保存的加密聊天／操作日誌、歷史檢視、七天清理或正式分帳號／場次恢復 migration。

**設計**：沿用 node:sqlite 與系統安全金鑰能力；每帳號金鑰包裝後保護，事件先去密、在 Main 加密再落盤，候選 AES-256-GCM＋帳號／場次／schema AAD。偏好預設開啟，實際狀態分 saving／memory_only／failed；無安全 provider 不回退明文。日誌保留自產生日起七天，啟動／讀取／每小時清理。關閉刪完整日誌但保留最小防重送記錄。舊安裝級開房紀錄只能轉成未確定歸屬、待人工核對，不捏造 osu UID。

**依賴**：無；先定中立事件及恢復介面，再供 L03 使用。

**驗收**：

- [ ] Windows／macOS／Linux 驗證安全 provider，含 Linux 無 keyring；掃描 DB、WAL、journal、暫存與匯出不含秘密或非預期明文。
- [ ] 測試跨帳號隔離、每場 OCLR 重新驗權、登出／撤權清理與晚到寫入 generation；不以歷史資料還原 context。
- [ ] 支援開關、依帳號／場次刪除、明確選取範圍的去密匯出；匯出透過 Main 原生對話框，不開任意路徑代理。
- [ ] migration 可重入且失敗安全；pending 保存失敗阻擋開房，刪除記錄後仍 recovery_uncertain；完整政策沿用 project-design §4.2。

### L03 · 共用操作佇列、結果核對與未知結果恢復

優先級：P0。對應既有任務：CORE-01／02／MANUAL-01。

**現況與缺口**：已有全連線節流、開房防重送，以及 map／mods／start／abort 一次性預覽。房內命令目前只記錄未確認送達，尚無完整逐步計畫、回覆關聯與持久化操作狀態。

**設計**：在 Main 統一 OperationPlan：operationId、來源 manual／oclr、固定 RoomTarget、connectionGeneration、preconditions、steps、deadline、planRevision；保留 queued／sending／awaiting／succeeded／failed／unknown／cancelled。每房間只一個寫入在途，全連線共用限流；取消僅移除尚未送出步驟。透過可信回覆與後續狀態核對 expectedEffect，記錄 evidence；Bancho 無 operationId，若無法歸因即 unknown，不聲稱 exactly-once。緊急 abort 先停止未送出的衝突步驟，再做最小目標／權限檢查；不得繞過節流或取消已到伺服器的操作。

**依賴**：L01 欄位觀測＋L02 最小恢復與事件介面；不得反向要求 L02 依賴完整佇列。

**驗收**：

- [ ] 四種現有快捷操作與 make 接上同一意圖層；沒有 raw IRC bridge，解析手動命令只接受 allowlist。
- [ ] 測試雙擊、跨房間、預覽失效、只有第一步成功、寫入錯誤、晚回覆、外部裁判變更與假 echo；已完成步驟不假回滾。
- [ ] 崩潰／重連後 pending 轉 unknown，只允許只讀重查及人工核對；不自動重放 make／map／mods／start／abort。
- [ ] 操作狀態 IPC 可訂閱與讀取，取消 token 在 Main 失效；錯誤提示區分未送出與已送出結果不明。

### L04 · 補齊房間設定、初始化與關房流程

優先級：P0。對應既有任務：LOBBY-01。

**現況與缺口**：目前可手動開房／加入與離開頻道；尚無改名、遊戲模式／計分／容量、密碼、鎖房、房主與明確關房流程。

**設計**：新增 typed intents：rename、configure（規則／計分／容量）、setPassword、lock／unlock、host／clearhost、close。初始化產生逐步差異預覽並停止於首個失敗／unknown；不宣稱整批原子成功。close 顯示確切 MP、影響與不可等同 PART 的確認。密碼採專用敏感參數通道，只在送出時使用，命令預覽與記錄遮罩。遠端房間綁定／跨裝置鎖不屬本期。

**依賴**：L03；初期可在合成資料設計，實際寫入須通過 L01／L02 gate。

**驗收**：

- [ ] 確認每種新命令的官方語法與指定房間去密樣本，未知權限不能當成功；不自動 addref。
- [ ] 空房初始化可用，不需先有地圖才更改無關設定；依 L01 的逐意圖欄位需求判定。
- [ ] 部分初始化／關房斷線不重送；日誌、IPC 狀態、截圖不含房間密碼，PART 不變成 close。

### L05 · 選手邀請、lineup、隊伍與槽位管理

優先級：P0。對應既有任務：PLAYER-01。

**現況與缺口**：已有 16 槽觀測面板與成員補完；尚無邀請、移位、分隊、lineup 與正式名單差異檢查。

**設計**：分離 PlayerObservation、RosterEntry、LineupSelection；以穩定 UID 配對，名稱只供顯示／協助核對。手動模式允許明確輸入並標示 manual，不能偽裝正式 roster。支援單筆／批次 invite、move、team 和明確確認的 kick；ban 等擴大處分另議。批次按共用佇列逐筆核對；不默認 home=red，不把 bench 自動選入。

**依賴**：L03＋L04；OCLR 正式名單使用另依 L09／L10 的已驗證 context。

**驗收**：

- [ ] 邀請成功與玩家到場為不同狀態；未知／重複 UID、非名單、錯隊、缺人、位置衝突均可見。
- [ ] 手動與正式 lineup 分離；換人政策不明時阻擋整合換人計畫，不自動推定熱身階段。
- [ ] #UID 傳送能力先取得指定測試樣本；未驗證時保留 blocked 或明確人工名稱核對，不猜測替代身分。

### L06 · 圖池槽位、Mods profile 與逐步套用驗證

優先級：P0。對應既有任務：MAP-01。

**現況與缺口**：目前已有手填 beatmap ID 與全域 Mods 多選；尚無圖池工作流、Freemod 個人規則、map＋mods 連續步驟及一致性驗證。

**設計**：新增 MapSelection 與完整 CommandProfile，區分 roomMods、freemod、individualModsPolicy、ruleset 與 profileRevision。先以合成／明確手動資料驗證，不用正式 OCLR 名義保存私人圖池。計畫先換圖並核對 beatmap，再套 Mods 並核對；任一步 unknown 停止，不能跳過剩餘步驟顯示完成。NF 由 profile 決定，不硬編碼。metadata 失敗不改變有效 beatmap ID 判定。

**依賴**：L03；正式 OCLR 圖池另依 L10。

**驗收**：

- [ ] 一般圖、FM、強制 Mods、互斥 Mods、未知 policy、map 成功而 mods 失敗有完整案例。
- [ ] 只有地圖與必要 Mods 均已核對才可滿足 Start gate；個人 Mods 無可靠觀測時採已核准人工確認，版本改變即作廢。
- [ ] OCLR entry 不可選只阻擋該 entry；單一壞 FM 不誤鎖其他有效地圖。

### L07 · 一般計時、開始倒數、取消倒數與比賽階段

優先級：P0。對應既有任務：CONTROL-01。

**現況與缺口**：目前僅提供立即 start 與 abort；尚無 timer、延遲 start、aborttimer 或可靠的計時與 phase 模型。

**設計**：分離普通 timer、start countdown、playing 狀態，剩餘時間可本機估算但標示觀測來源與新鮮度，不能以倒數歸零當作已開賽。開始倒數與取消用明確 intent；cancel pending plan 不等於送 aborttimer，aborttimer 不等於 abort。手動 Start 保留人工核對；正式 Start 執行 requiredLocalChecks 聯集並重讀 context。

**依賴**：L03；整合 Start 的玩家與地圖檢查另依 L05＋L06＋L10。

**驗收**：

- [ ] 測試倒數中改圖／改 lineup、外部 start、取消回覆遺失、休眠／重連、正在打圖時 abort；不能把取消顯示成開始成功。
- [ ] 倒數長度有界且參數拒絕注入；重連只讀恢復，不重建倒數或再次 start。
- [ ] 倒數 UI 與聊天輸入在小視窗及 IME 下無誤觸；Start 不在單純 Enter 或 focus 改變時觸發。

### L08 · 常用訊息、指令搜尋與安全鍵盤操作

優先級：P1。對應既有任務：UX-01／MANUAL-01。

**現況與缺口**：已有聊天、補完、未讀及快捷面板；缺少裁判常用訊息、指令搜尋、跨平台快捷鍵與集中操作結果視圖。

**設計**：建立共用 command registry（標籤、intent schema、風險、可用條件）；搜尋結果呼叫既有預覽，不開 raw IRC escape hatch。快捷鍵只定位或開預覽，危險命令仍要確認；輸入框與 IME composition 時不觸發。常用訊息採有限 placeholders，插入草稿後人工送出，預設不持久保存場次／私人內容。

**依賴**：L03；可先設計純 UI，送出需共用操作 gate。

**驗收**：

- [ ] Windows／Linux Ctrl 與 macOS Cmd、composition、焦點與螢幕閱讀器標籤均驗證；不註冊全系統危險熱鍵。
- [ ] 歷史操作／錯誤／pending／unknown 可查，搜尋與按鈕共用相同 gate；模板不允許多行命令注入。
- [ ] 不引入 HeroUI Pro；新依賴先評估與現有 HeroUI／React 元件重用。

### L09 · OCLR 真實唯讀聯調與 IRC 帳號配對

優先級：P0。對應既有任務：INT-01／02／PAIR-01／PANEL-R。

**現況與缺口**：桌面已有瀏覽器／PKCE 登入、記憶體 token、本人場次與 panel 合成測試；仍缺正式服務驗證與 D05 IRC／OCLR 配對。這是本地盤點，未重新斷言網站當日是否已部署端點。

**設計**：與網站維護者核對部署版本和 read scopes，不修改網站 repository。加入 identity state：unknown／nickname_matched／mismatch，綁定 IRC login generation、OCLR subject 與人工核對；nickname_matched 不標成 UID 證明。配對不符時唯讀仍可依權限使用，但停用衍生變更。正式聯調驗證帳號、指派、撤權、refresh、期限與 loopback；不以 cookie 或新 host 開關繞過。

**依賴**：網站提供 AUTH 與本人 fixtures／panel 正式契約；L02 用於關聯歷史驗權。

**驗收**：

- [ ] 記錄可用正式 endpoint、contractVersion 與測試環境；網站缺口只列 external blocker，桌面可先做 fixtures。
- [ ] 改名、空格／底線、登出切帳號、晚到回覆、同名但未人工核對均有測試，確認綁定變更即失效。
- [ ] 本人指派限制包含 Admin，403／撤權清私人資料；IRC 登入與 OCLR 登入互不冒充。

### L10 · 完整 context adapter、MP 綁定與 OCLR 衍生執行

優先級：P0。對應既有任務：INT-03／PANEL-X。

**現況與缺口**：PR409 panel 能顯示與複製命令，但尚無完整 context、requiredLocalChecks、正式 MP 綁定與 OCLR 命令執行。不能把現有手動 shortcut 視為這項已完成。

**設計**：新增與 panel 分離的 ContextSnapshot adapter，保留 fixtureRevision、contextRevision、capturedAt、expiresAt、allowedIntents、requiredLocalChecks 與 blocking issues；由 Main 純檢查器產生 plan fingerprint（身分／fixture／房間／圖池／lineup／policy revision）。MP 綁定限本機單主控，驗證 History 和場次來源；重要操作前合併單次重讀，再交給 L03，不從 renderer 複製字串執行。

**依賴**：L01–L07、L09；網站 CTX 契約／資料來源定版。

**驗收**：

- [ ] Start 核對目前選圖、Mods、lineup、Team VS 顏色及明確 startPolicy；Head To Head 1v1 不要求隊色；缺值不猜。
- [ ] 規則／圖池／名單／直播變更作廢預覽與人工確認；single-flight preflight、429、過期及換場次不送舊計畫。
- [ ] create 不要求不存在房間的權限；不做遠端綁定／分散式鎖／賽果發布；P0 僅單主控並明示外部客戶端競爭限制。

### L11 · 完成三平台實機驗收與內測升級／復原流程

優先級：P0。對應既有任務：QA-01／RELEASE-01／SPEC-01。

**現況與缺口**：已有三平台測試打包、Release CI 與 macOS 簽章／公證流程；缺實機 IME、安全儲存、系統匣、實際第二程序啟動、真實 Bancho 與 OCLR 全流程證據。CI 成功不代表這些都完成。

**設計**：建立驗收矩陣：OS 版本、架構、輸入法、safe-storage provider、顯示／工作列環境、commit／artifact SHA／簽章及資料 migration 版本。測試關窗、休眠、真正雙程序、取消關機、無系統匣環境、手動升級、升級失敗與資料復原；最低 OS 依實測和相依支援資料另定，不臆定。內測採手動升級，對局中不強制重啟。

**依賴**：可立即驗收已交付功能；完整 M2／M3 驗收依相應 L01–L10 完成。

**驗收**：

- [ ] Windows／Linux 由使用者操作回報；沒有實機資料時保持 pending，不用注入事件冒充。
- [ ] 測試版對應相同提交並驗證 checksums；ad-hoc／Developer ID＋公證分開記錄。
- [ ] 完成適用 AC-01–22 後才更新 milestone；公開 Windows 簽章／自動更新仍屬後續，不擴大 D08 內測範圍。

### L12 · 裁判面板寫入與核對回站的桌面方案

優先級：P1／後續。對應既有任務：PANEL-W／PANEL-C。

**現況與缺口**：桌面已有三階段唯讀畫面；尚無本場設定、先後手／選禁紀錄、attempt 與 MP 核對關係的雙端共用寫入。

**設計**：僅記錄後續設計：寫入 intent 必須附 expectedRevision、dependencyFingerprint、idempotencyKey，重新檢查本人指派與 scope。409 顯示伺服器最新狀態供人工重整，逾時不新建 key 盲重送。同步狀態分 draft／submitting／unknown／confirmed；MP 資料是可核對來源，不產生或發布正式結果。獨立 scope 與 API 由網站另行開發，本 issue 不代表授權立即實作後端。

**依賴**：L09＋L10；網站額外寫入 scope／版本／冪等契約，排程未承諾。

**驗收**：

- [ ] 先取得雙端契約與排程確認，版本衝突、兩端同時修改、請求成功但回覆遺失、撤權有測試方案。
- [ ] BP／attempt 對應不得直接替代正式賽果；保留回網站審核與提交流程。
- [ ] 不以寫入 revision 代替 IRC 控制鎖；多裝置主控與遠端 lease 另立設計，不混入 P0。

## 驗收與不變決策

- D01–D08 不變：TypeScript 核心、免費 HeroUI、單主控、內測手動升級、預設加密本機日誌、nickname 配對不當 UID 證明。
- 這次只新增文件及 issues，不建立新里程碑完成宣告、tag、Release 或功能碼。
- 真實房間測試需指定帳號、房間與可操作範圍；歷史 settings／listrefs 授權不能延伸到 mutation。
- 需補充的外部證據：正式 API 與契約版本、授權測試房及 mutation 去密樣本、Windows／Linux OS／架構／IME／provider、實機回報。工程命名與內部模組拆分不需要重新確認 D01–D08。

## GitHub issues

建立後在此記錄對應連結；以 issue 的實際進度與驗收證據更新，不由本清單推定完成。
