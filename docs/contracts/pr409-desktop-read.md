# PR #409 桌面只讀接入交接契約

- 文件版本：0.1；日期：2026-10-28（Asia/Taipei）；桌面版本：0.6.0。
- **候選契約，尚未由網站端實作／部署或聯合凍結。** 本次使用者明確指定只做桌面端，網站 API 由另一邊開發。未修改 OCLR-website、推送其分支、合併 PR 或部署。
- 來源：[OCLR-website PR #409](https://github.com/OCLR-dev/OCLR-website/pull/409)，固定 head `1abbab1ddd981025249af727d748e70e23b9096b`。當次查閱為 draft／未合併；網站 IRC 是 mock，不能接到正式桌面傳送器。
- 本文件將先前尚未發布的 panel 提案具體化為 **1.1.0 workspace-read 候選**；既有 `/context` 1.0.0 操作草案不改形狀，也不宣稱已實作。

## 桌面已完成的範圍

Main 管理 OCLR 登入、scope、token、HTTP、一次性 loopback、輪詢與私人資料生命週期；Renderer 只取得白名單化的已驗證投影。使用免費 HeroUI 原生呈現本人場次及賽前／BP／賽後分頁；指令在 Main 用網站共用 builder 產生，依 ID 與目前版本的 previewId 複製。

沒有 cookie／Developer token fallback，沒有遠端 iframe 或遠端頁面 IPC，也不從網頁擷取資料。沒有執裁業務 mutation、Ban／Pick 保存、MP 匯入或 OCLR 衍生 IRC 傳送；既有手動 IRC 工作區獨立存在。**接入層通過合成測試不代表已可登入正式網站。**

## 網站端需提供的最小端點

固定 origin `https://oclr.org`，不接受 Renderer 自訂主機或 URL。所有 GET 不觸發 provider 更新或業務寫入，不為讀取初始化 referee session。

| 方法／路徑 | 認證與語意 |
| --- | --- |
| `POST /api/desktop/v1/auth/requests` | 無 Bearer；建立短效授權交易，201；device_name 固定 `OCLR ref tools`，不收集主機名稱 |
| `GET /desktop/authorize?request_id=<UUID>` | 系統瀏覽器，網站登入＋明確同意／拒絕；延續既有 osu! OAuth |
| `POST /api/desktop/v1/auth/exchange` | 單次 code＋S256 verifier＋相同 redirect；200；**不重試遺失回應** |
| `POST /api/desktop/v1/auth/refresh` | client_id＋目前 refresh_token；輪替 token pair；200 |
| `POST /api/desktop/v1/auth/revoke` | client_id＋refresh_token；成功／未知 token 均 204；不可改用網站 cookie |
| `GET /api/referee/v1/me/fixtures?view=active&limit=50[&cursor=...]` | desktop access Bearer；本人指派場次；回應 shape 沿用 context 草案 §4 |
| `GET /api/referee/v1/fixtures/{fixtureId}/panel` | desktop access Bearer；本人該場一致保存快照；**不接受 query** |

client_id 固定 `oclr-ref-tools`。0.6.0 明確請求三個只讀 scope：`referee:fixtures:read`、`referee:context:read`、`referee:panel:read`，缺一即拒絕登入；不申請 panel:write 或 reconciliation:write。第三個 scope 是本次新增的明確同意事項，舊 client 的兩個 scope 不受影響；refresh 不得擴權。

瀏覽器 approve／deny 與桌面 session 管理仍依 [原授權草案](desktop-authorization.md)；它們是網站服務，桌面不代送網站同源表單。網站端需提供撤銷舊裝置的使用者入口；桌面本版未假設一個尚未定義的管理頁 URL。

### Header、envelope 與大小

- 請求 `Accept: application/json`，POST 加 `Content-Type: application/json`。不傳 Cookie，redirect 禁止跟隨，單次請求 5 秒 timeout。
- 成功 `{ data, meta: { apiVersion: "1", contractVersion, requestId, serverTime, pollAfterSeconds? } }`。
- JSON 成功回應需 `Cache-Control: no-store`、`X-Request-Id: <相同 meta.requestId>`、`X-OCLR-Desktop-Contract` 或 `X-OCLR-Referee-Contract`，值等於 meta.contractVersion。
- 授權與 fixtures 支援同 major 1 的相容回應；panel 要求 minor 至少 1。本文候選值統一 `1.1.0`。不能以既有 saved-read `/api/v1` 版本號或 HTML 登入頁冒充。
- 錯誤沿用 `{ error: { code, message, requestId, retryable } }`；桌面依 code，顯示本地固定說明，**不直接展示伺服器 message／例外**。錯誤 JSON 也需 no-store；revoke 的 204 可無 JSON／契約 header。
- 授權回應 32 KiB、fixtures 單頁 256 KiB、panel 512 KiB；串流實際大小與 Content-Length 均受限。過大、未知必要 enum、錯 shape／身分／資源、缺契約標記皆不接受為有效面板。

## 授權規格對齊

request／exchange／refresh JSON 欄位沿用 [授權草案 §5](desktop-authorization.md#5-端點契約)。完整執行期 schema 見 [oclr-contracts.ts](../../src/shared/oclr-contracts.ts)；後端可直接對照 [產生的 JSON Schema](oclr-desktop-read.schema.json)，用 `npm run contracts:oclr` 重生。

- state、verifier 各用 32 隨機 bytes 的 43 字元 base64url。challenge 為 SHA256 ASCII verifier 的 base64url；只用 S256。
- App 先 bind `127.0.0.1:0`，使用 1024–65535 port、固定 `/oclr/callback`。reject 錯 Host、非 GET、錯 state、重複／額外 query、錯 code、重放；錯 state 不消耗合法交易。callback 回應無外部資源、no-store/no-referrer，不回顯秘密。
- authorization_url 必須是相同 origin 的 `/desktop/authorize?request_id=<相同 UUID>`；不接受任意回應 URL。
- approve 的頂層表單 303 到已保存 loopback，僅帶 code＋state；deny 帶 error=access_denied＋state。不讓 fetch/XHR 跟隨到 loopback。
- token 為 `oclr_desk_at_`／`oclr_desk_rt_` 加 43 字元 base64url；code 本身 43 字元、無前綴。subject 為 `{ osuId: 正 safe-integer, username }`。
- access 最長 600 秒並截於 session 絕對到期；refresh 閒置最長 2 小時；session 最長 12 小時。回應期限皆 UTC，expires_in 與實際 access 期限一致。前後端時鐘用 meta.serverTime 的差值及本機 monotonic deadline，不依使用者系統日期延長。
- refresh 前後 session_id、subject.osuId、session_expires_at 固定，refresh_token 必須換新；全部併發讀取共用 single-flight。每個 GET 遇 ACCESS_TOKEN_EXPIRED 最多 refresh／重試一次，舊 access generation 不額外旋轉。
- timeout／5xx／斷線的不明 exchange／refresh 不重送；清登入資料，重新授權。明確 429 必須發生在消耗 token 前，桌面依 Retry-After 延後，不自行重開瀏覽器；跨登出仍保留 origin backoff。

## 本人場次與桌面權限

沿用 [context 草案 §4](referee-context-api.md#4-我的場次列表)，不包裝 PR 的 cookie Admin API。列表 UUID、revision、edition、round、兩隊 slot、時間／時區、status、review state、operational、streamingState、reviewUrl、collectionRevision、nextCursor 均驗證。

後端每次列表、cursor 及 panel 讀取都重新驗 token、session、三個 scope 中該端點必要者、有效裁判資格及**本人指派**。Admin 使用桌面同樣限本人場次；PR `assertRefereeAccess` 對 Admin／Developer 的網站例外不能直接沿用到此 Bearer API。

列表 cursor 綁 subject／篩選／revision，變更回 409 COLLECTION_CHANGED。桌面單頁最多 100、累計最多 500，cursor 自動重開最多一次，拒絕重複 fixture；不是把截斷列表當完整。重讀第一頁仍有 cursor 時，不能僅因當前場次不在第一頁就判定撤權，繼續由該場 panel 的後端驗權決定。

reviewUrl 必須精確對應 `https://oclr.org/admin/tournaments/{edition.slug}/matches/{fixtureId}`；Main 僅接受現有列表場次的 ID，沒有任意 URL 打開代理。正式 review 頁另由瀏覽器網站登入驗權。

## Panel 1.1.0 的 wire shape

成功 envelope 的 data 固定為 `viewer`、`edition`、`capturedAt`、`freshUntil`、`workspace`；meta 為前述共同 metadata，contractVersion 候選 `1.1.0`。`workspace` 是完整物件，不是 HTML、字串或第二個任意 JSON envelope。

**完整可解析合成樣本**見 [oclr-panel.json](../../tests/fixtures/oclr-panel.json)／[oclr-fixtures.json](../../tests/fixtures/oclr-fixtures.json)，來源生成器為 [tests/fixtures/oclr.ts](../../tests/fixtures/oclr.ts)，不是正式場次或憑證。

| workspace 欄位 | 對應／桌面語意 |
| --- | --- |
| fixture／round／teams | 保留 PR UUID 及已保存名稱、captain、members；只投影本場最小身分，不回報名答案、聯絡方式等 |
| defaultSettings／session.settings | 原 PR refereeSettings，session 為 null 時使用明確的 defaultSettings；不是捏造比賽政策 |
| maps | id、beatmapId、category、position、metadata；桌面只需 metadata 的 title／artist／difficulty／stars／duration，其餘新增欄位剝除 |
| rules／series | 原 PR scoringRules，null 就是未知；支援的命令預覽範圍仍為 osu! standard／Score V2，H2H 限 1v1 |
| policy／policyRevision | 原 PR finite steps、commands、maxReplaysPerMap；未知必要語意不默認規則 |
| session | 原 PR數字 revision、先 Ban／先 Pick、settings、dependencyFingerprint、basis；尚未建立為 null |
| events | 完整、有序、連續 ordinal，session.revision 等於事件數；最多 2000 筆並受整份 512 KiB 限制，超限需後端明確錯誤，不能默默截斷必要歷史 |
| projection | PR 可原樣提供。桌面不採信／轉發此 raw 欄位；以相同 pinned `projectReferee` 對已驗證 events＋basis 產生只讀顯示 |
| dependencyFingerprint | PR SHA256 hex；與數字 session.revision、policyRevision 分開，不換成舊草案 opaque contextRevision |
| readiness | 純文字顯示，不以文字判定自動執裁；session 依賴 fingerprint 不同即停用複製 |
| canRecord／canConfigure | 網站業務能力，不代表 Bancho 裁判／建立者權限，也不啟用桌面寫入 |

後端以同一 repeatable-read、一致授權邊界產生 wrapper 與 workspace；viewer 必須等於此次 Bearer subject。桌面再次比對 viewer、選中 fixture UUID、edition slug 及 round UUID。freshUntil 不超過 capturedAt＋30 秒；過期仍可顯示 stale，但不能複製。

這份 panel **不含完整操作 context、allowedIntents、requiredLocalChecks 或 room binding**。不能用它放行 OCLR 衍生 make／start／map／mods；後續執行功能仍需 context 草案與 CORE／STATE／LOG／身份配對及 Bancho 實測 gate。

目前 PR 沒有正式直播指派投影，桌面僅顯示設定中的 streamerUsername，**不稱作已確認直播員**。若網站要提供實際直播員／確認狀態，需新增受本人場次授權的欄位契約，不能從這個輸入文字推定。

## 輪詢、錯誤與資料清理

- 選中 panel 前景 15 秒／背景 60 秒，fixtures 前景 60 秒／背景 120 秒；panel 遵守 pollAfterSeconds，全部遵守 Retry-After。恢復焦點重讀。同一資源 single-flight，切帳號／場次 generation 拒絕晚到資料。
- 新 panel 完整驗證後一次替換，重產 previewId；改選地圖也重產。複製只接受當前 previewId＋已生成 commandId，不接受 raw command。過期、刷新授權、依賴變動、超長／控制字元、缺政策時禁用相應複製。
- 私人 panel 於 capturedAt＋5 分鐘硬清除；列表也有限保留。失敗不延長期限，timer 延遲時 IPC 仍檢查 monotonic deadline。資料與 token 永不落盤，不從歷史重建權限。
- 401 SESSION_REVOKED／SESSION_EXPIRED／INVALID_ACCESS_TOKEN、403 REFEREE_ACCESS_REVOKED／INSUFFICIENT_SCOPE 清全部 OCLR 私人資料；404 FIXTURE_NOT_AVAILABLE 只移除該場。未知 endpoint 的 404／HTML／未知契約顯示接入不可用，不冒充撤權或抓管理頁。
- logout 立即清本機，再 best-effort revoke；失敗明示遠端未確認。App 完整退出只清本機；0.7.0 關閉視窗改為背景執行，保留 session，仍受原到期／撤權與清除期限限制。為防不同 OS 的休眠時鐘行為延長快照，**本版休眠會清 OCLR 資料並嘗試撤銷，喚醒後重新授權**；IRC 仍依既有流程恢復。
- 手動複製已寫入系統剪貼簿的文字，無法在撤權後追回；本版不讀取既有剪貼簿，不任意覆寫使用者其後的內容。

## 網站端驗收及交接缺口

1. 實作上述 desktop session／S256／CSRF／一次性碼／refresh family；真實 OAuth 起點、HTTPS→loopback、approve／deny、撤銷與跨平台需聯調，合成 callback 不替代它們。
2. 回應 schema／header／scope 對齊，提供 staging 與合成指派場次；不索取生產 token、IRC 密碼或資料庫 dump。
3. Admin 非本人場次、Developer-only、撤權／移除指派、cursor 變更、過大歷史及未知規則，皆有後端拒絕與不洩漏測試；GET 無副作用。
4. 確認 1.1.0 候選是否採納，或提供最終 schema 再調整桌面 adapter。不能把本文件當成 PR #409 已存在這些端點的證據。
5. PANEL-W／C、遠端寫入、完整 context 與 IRC 執行仍是後續工作；本次不擴大其 milestone，不建立完成 tag。

本機驗證與交付狀態見 [0.6.0 桌面接入說明](../m1/oclr-read-integration.md)。

## 2026-10-30：同 Mod Ban 相容補充

網站來源 [`bbf03005`](https://github.com/OCLR-dev/OCLR-website/commit/bbf0300555fb80a78a6a16e4ceee9c6a5a329bea)
的 policy 相容新增 `banCategoryRules: { allowRepeats, repeatExceptions }`。
本分支同步 pinned model 與生成 JSON Schema；嚴格 parser 必須保留該欄位，不能忽略後宣稱允許操作。
欄位缺省維持舊的允許重複 Ban 語意；設為禁止時只計同隊有效 Ban，例外可選 NM/HD/HR/DT/FM。
撤回的 Ban 與 Pick 不計入；對手可 Ban 同 Mod，但任何設定均不可 Ban TB 或重用已選圖譜。
這是 desktop panel 1.1.0 的可選資料延伸，不與網站 saved-read 1.7.0 版本號混用。
網站保存與 IRC 真實執行邊界保持不變。

驗證：Node 24 typecheck、148 項核心／契約測試通過，包含新欄位解析、舊 panel、TB 例外拒絕、重複 HD／TB Ban 驗證。
沒有 UI／preload 改動，未進行 Electron 實機或真實 OAuth／Bancho 聯調；尚未合併或發布。
