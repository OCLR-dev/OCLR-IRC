# M0 / SPEC-01：條件式契約基線

- 日期：2026-10-27；狀態：已依本輪證據更新，**尚未聯合凍結**。
- D01–D08 維持已確認。兩份 API 的 `1.0.0` 仍是未發布草案，不宣稱端點已上線。
- 依據：[SPEC-00](spec-00.md)、[SPIKE 結果](spike-results.md)、[授權契約](../contracts/desktop-authorization.md)、[context 契約](../contracts/referee-context-api.md)。

## 1. OCLR 欄位與來源映射

查核公開 main `14ab070450afb4b81b28eb075386428eab94e31f`。本機另一 checkout 是 `84c4f58`，本輪不修改該目錄；結論以公開 main 的臨時副本為準。

| 契約欄位／能力 | 現有來源 | SPEC-01 判定與工作 |
| --- | --- | --- |
| viewer、osuId、username | 既有 OCLR 身分／osu! OAuth | 沿用後端身分；另建桌面 session，不把網站 cookie 交桌面 |
| fixture、round、teams、pool、result | `fixtureForReview` 領域查詢 | 共用領域來源，不能原樣包裝輸出；CTX-01 需專用投影 |
| rules.ruleset | `round.scoringRules.mode` | osu→osu 等顯式映射；來源 null 則 null |
| rules.teamMode | `teamType` | head-to-head→head_to_head，team-vs→team_vs；未知不可猜 |
| rules.scoringMode | `scoringType` | scorev2→score_v2；score→score（不在 P0 自動操作範圍） |
| rules.playersPerTeam／series | `playersPerTeam`、series.type／wins／count | first_to→target，fixed_maps→mapCount；另一值明確 null |
| substitutionPolicy | `allowSubstitutions` 只有 boolean | false 可映射 prohibited；true 不證明只能局間／正式 roster，需核准操作政策，未有則 null |
| roomSize／roomName／nameTemplateId | 查核模型沒有專用操作設定 | OCLR-01 新增已核准來源，不能依隊數或 roster 長度默認 |
| noFailPolicy／startPolicy | 查核模型沒有同等欄位 | OCLR-01 新增；直播介面預選 optional 但須明確保存，既有 null 不回填 |
| commandProfile | pool 有 category、fmMode、fmRestrictions | 不足以自動得到完整 Mods／FM／Force Mod profile；OCLR-01 新增明確 profile，文字不作規則解析 |
| rosterRevision／eligible／pool entry ID／metadata | 正式隊伍、圖池領域另有資料，舊 importer 投影只取部分 | CTX-01 顯式讀取及版本映射；禁止用目前 importer response 的省略欄位推定有效 |
| officials.streaming | streaming task／confirmedScheduledAt／confirmedTimeZone | 新增本場裁判最小投影；不能直接開放 streaming workspace |
| assignment／sourceVersions／contextRevision | fixtureReferees、來源版本與資料 | 專用 revision 及一致快照仍待實作，不以 updatedAt 單欄假冒所有來源版本 |
| desktop auth／Bearer scopes | main 未找到本提案的兩組 API 路徑 | AUTH-01／02／03 全部待新增；沒有生產環境交換／撤銷證據 |

### 必須避免的相容性錯誤

1. **Admin 與 Developer 例外**：現有 importer 查詢允許 Admin／部分 Developer 越過 assignment。桌面 API 必須在同一交易內無條件核對本人指派，包括 Admin；不能只呼叫舊服務即視為 D03 完成。
2. **未定案隊伍**：舊服務遇到缺正式隊伍／名單會回 409；新契約要求 200＋unresolved／issues。CTX-01 需讀取相同領域來源的專用 tolerant projection，不能把舊錯誤硬改 200 並補假資料。
3. **讀取一致性**：舊服務部分權限檢查在查詢交易外。新 API 的 role、assignment 與所有快照來源需在受控讀取邊界驗證，不能聲稱整體原子性已由既有服務保證。
4. **競賽計分不等於房間設定**：aggregation、allowShortHanded、failedScorePolicy、tiedMapPolicy 是官方賽果領域設定；不由桌面產生官方結果。P0 Start 仍要求完整已核准 lineup，少人出賽改走明示手動流程；不要因省略這些欄位就假設 OCLR 不支援它們。若日後要自動處理少人出賽，需擴充契約及案例。

## 2. 授權與保存收斂

- 維持 public client、S256、系統瀏覽器、127.0.0.1 隨機埠及先綁 listener；本機驗證不能代替正式 OCLR HTTPS→loopback、CSRF、上游 OAuth、撤銷與 refresh 競態驗收。
- 實驗候選 Electron 45.0.0；套件鎖定只代表可重跑，不等於三平台選型已通過。
- macOS arm64 已驗證 Electron 內建 `node:sqlite`，避免額外 native addon ABI 重建；若其他平台 runtime 不可用，另驗 better-sqlite3＋Electron rebuild，不以宿主 Node 測試替代。
- 日誌使用每帳號資料金鑰＋AES-256-GCM 的候選方案；AAD 綁帳號／場次／schema，nonce 每筆隨機且不得重用。SQLite 僅接收加密 payload；可索引的 ID／時間屬明確最小欄位，不能把名稱或完整指令放進明文索引。
- Electron 45 的同步 safeStorage API 已標示 deprecated；候選改用 async。**Linux async 的 provider 保證仍待驗證**，不能僅用同步 `getSelectedStorageBackend()` 的結果證明 async provider 安全；無可靠證據時暫停私人落盤並顯示實際狀態。
- 未簽內測 app 的 Keychain 跨 build 身分／升級存取可能不同。D08 不要求先公開發行，但 D06 的升級可讀性仍需測試；無金鑰不明文降級、不自動刪除以冒充恢復成功。
- 恢復記錄到期／登出清除後不能當作「從未開房」：啟動／登入建立 recovery_uncertain 狀態，重新核對已存在房間或由裁判明確確認沒有既有房間後才解除開房阻擋。只測資料庫 pending 寫入不足以保證跨清理防重複。

### 2.1 SPIKE-01 分行、房間與權限核對更新

- 入站 TCP 依 LF 分行，若前一字元是 CR 才移除；CRLF 與 bare LF 可混用。不能等待 CRLF 才送入 parser；UTF-8 要跨 chunk 保留。出站維持 CRLF，拒絕輸入中 CR／LF／NUL。限制是防護值，未視為 Bancho 協定上限。
- IRC parser 先解析可選 tags／prefix、command、middle／trailing parameters，不能將訊息 body 的 BanchoBot 文字當 sender。無法解析的內容保持 unknown，不猜測設定。
- 122076167 已 abandoned，本輪收到 403；403 要將該房標為不可用、取消該房待送唯讀查詢。不能將先前 353／366 或公開 end_time=null 視為持續可用。
- 122076210 ↔ #mp_122076210 已由該頻道 settings 回傳的 History URL 核對。P0 room_binding 至少比對目前 channel、請求的 MP ID、當次回覆 History ID；切房／重連後重新核對，topic／房名／加入成功本身不夠。
- listrefs 本次是 header 與獨立姓名行，需在同一連線／房間／查詢範圍收集。當前帳號正規化匹配只表示「本次列於 referee 名單」，不是 UID 證明；沒有列名或回覆不完整時保持 unknown，而非直接宣判無權。
- 標準房間權限與 creator-only addref／removeref 分開；本次唯讀查詢不證明開賽、關房或加裁判已獲授權。未知權限不能因 NAMES 的 +／@、公開建立事件或一次查詢成功而放行變更。
- settings 實測回覆 Players: 0，但沒有 Beatmap／Active mods；缺欄位不得重用舊值或默認 NM。初版只顯示觀察到的欄位，完整 room_snapshot gate 仍待 STATE-01。

### 2.2 使用者追加的登入初版範圍

使用者在本輪明確要求完成可登入介面，並確認只用免費 HeroUI、不用 Pro。因此在 M0 尚未全面通過時，允許先交付 **IRC 登入與唯讀房間預覽**；這是明確的分段授權，不等於取消全部 M0 gate。詳細交付與驗證見 [初版說明](../initial-preview.md)。

React 19.3.1、HeroUI／styles 3.2.6、Tailwind 4.3.3、electron-vite 6.0.0；產品 root 與 M0 實驗各有鎖檔。登入、取消、登出、固定 Bancho 連線及 settings／listrefs 可用；未實作 OCLR OAuth、完整 IRC 聊天輸入／多頻道、變更指令佇列、重連或持久日誌。D06 預設保存政策仍屬 MVP 要求，初版明示「本次記錄僅記憶體」，不提供虛假的保存開關。

## 3. 仍需補充的資訊與證據

| ID | 缺口 | 提供者／下一步 | 未完成時限制 |
| --- | --- | --- | --- |
| G01 | make、map／mods、start／abort、close、權限錯誤與重連的真實回覆 | 裁判指定可變更測試房、操作範圍、測試選手／地圖；工程再錄去密樣本 | 唯讀 LF framing／History／listrefs 已有樣本；變更 grammar、權限錯誤、上限及節流仍不定版 |
| G02 | #UID 邀請／移槽／分隊行為及可靠身分來源 | 指定測試選手及允許操作；保留 D05 暱稱＋人工核對 | 不宣稱 UID 配對已驗證，不自動操作未驗證指令 |
| G03 | Windows x64、Linux x64、macOS x64 實機／runner | 團隊提供可執行桌面與系統 secret store 的環境 | 不標記三平台 callback、加密或打包成功 |
| G04 | 真正中文 IME、Cmd／Ctrl、縮放與通知 | 三平台人工操作紀錄；目前無產品工作區 | 合成 keyboard event 不算 IME 驗證 |
| G05 | OCLR 測試部署、測試裁判／Admin 指派、規則維護入口 | OCLR 後端提供 staging 與測試資料，執行 AUTH／CTX 工作 | 不能完成真實 OAuth／角色／撤權／完整 context 驗收 |
| G06 | 金鑰遺失、拒絕、升級、跨平台重啟及 Linux fallback | macOS same-build 跨程序已過，SPIKE-02 補充升版及其他平台報告 | SQLite round-trip 不能代表 LOG-01／AC-21／22 完成 |

## 4. M0 出口與任務狀態

- SPEC-00：本輪盤點完成；不代表後端已批准實作細節。
- SPIKE-01／02：依結果表逐項判定，缺失證據保持 partial／not-run。
- SPEC-01：本輪已更新來源映射、候選選型及風險；前後端聯合定版與所有必要技術證據未齊，**M0 未整體完成；僅依 §2.2 的使用者追加授權交付登入／唯讀預覽，其他依賴不自動解除**。
- 下輪優先補 G01／G03／G06，OCLR 團隊確認 G05 與欄位新增方案；本輪分段範圍已記錄於 §2.2，不把缺測項改標完成。

## 來源

- [固定提交的 fixtureForReview](https://github.com/OCLR-dev/OCLR-website/blob/14ab070450afb4b81b28eb075386428eab94e31f/src/lib/fixtures.ts)
- [固定提交的 scoringRulesSchema](https://github.com/OCLR-dev/OCLR-website/blob/14ab070450afb4b81b28eb075386428eab94e31f/src/lib/competition-model.ts)
- [固定提交的 streaming](https://github.com/OCLR-dev/OCLR-website/blob/14ab070450afb4b81b28eb075386428eab94e31f/src/lib/streaming.ts)
- [固定提交的 mappool-model](https://github.com/OCLR-dev/OCLR-website/blob/14ab070450afb4b81b28eb075386428eab94e31f/src/lib/mappool-model.ts)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Electron native module ABI](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)


### 後續 M1 增量（2026-10-27）

使用者確認保留 TypeScript／Node.js 本機核心，取消 Go 遷移；伺服器 API 採 Node.js。0.2.0 加入一般聊天、免費虛擬列表與連結、roomEpoch 防錯房及離房狀態失效，詳見 [M1 交付](../m1/chat-workspace.md)。比賽變更、完整佇列、OCLR API 與 D06 保存仍未完成，既有 API 契約與 gate 不變；M0 歷史證據不因本次增量改為已通過。

### M1 重連與房間同步增量（2026-10-28）

0.4.0 採 TypeScript transport，最多 5 次退避重連及 suspend／resume 恢復；房間 epoch 更新後重新 JOIN、settings、listrefs，絕不恢復聊天或 mutation。新增 query-scoped 地圖／Mods／slot collector；10 秒後觀測過期，缺值保持 unknown／partial。`complete` 只是已解析欄位完整，不代表 OCLR／CORE 操作可放行。一般對話使用負數本機識別，不可與正數 MP ID 混用。

可選 IRC 憑證使用 Electron async safeStorage；Linux provider 未證實時停用保存。這不實作 D06 日誌，也不解除 SPIKE-02 的跨平台／升級驗收。真實 Bancho 擴充快照、私訊及重連樣本仍不足；本輪新增證據為合成測試，G01–G06 與 API 聯合凍結狀態不變。詳見 [0.4.0 實作、資料語意與出口](../m1/recovery-and-sync.md)。

### 手動開房增量（2026-10-28）

使用者追加要求「增加新建比賽房間的按鈕」，0.5.0 交付有限手動 `!mp make` 流程：明確確認另開意圖、送前 SQLite 最小 pending 記錄、同連線單次操作、共享節流、可信 BanchoBot 私訊及精確名稱匹配，取得真實 ID 後 JOIN／settings／listrefs。逾時／斷線／重啟不重送，未知結果先人工核對；本機資料缺失也不取消登入後的人工確認。

本次 SQLite 記錄為安裝範圍的手動模式 metadata，無帳號 UID／fixture 綁定，不儲存房名、指令或聊天；不宣稱已完成正式 LOG-01 的分帳號 journal 或加密日誌。完整 CORE／LOBBY 與 OCLR gate 不變。回覆 grammar 參考公開實作並以合成資料驗證，**尚無真實 make 樣本**，G01 保持未完成。範圍、恢復語意及後續 migration 見 [手動開房交付](../m1/create-match-room.md)。

### PR #409 只讀接入增量（2026-10-28）

依使用者追加要求，0.6.0 完成桌面側授權／HTTP／原生只讀面板 adapter，網站 API 由另一邊開發，未修改網站專案。以 PR head `1abbab1ddd981025249af727d748e70e23b9096b` 的數字 revision、dependencyFingerprint、saved workspace 及共用 builder／事件投影為依據，另提出 panel 1.1.0 wrapper。它不是既有完整操作 context，不提供 OCLR 衍生執行或業務寫入。

AUTH-03／INT-01／INT-02 僅桌面功能部分完成；真實 OAuth、正式 HTTPS、網站 session／schema、本人指派後端與撤權聯調缺口 G05 仍未解除。新增只讀 panel scope 需網站端明確同意，舊兩 scope client 不擴權。詳細 wire shape／生成 JSON Schema／合成樣本見 [PR409 交接](../contracts/pr409-desktop-read.md)。M0 及正式 API 仍未聯合凍結。
