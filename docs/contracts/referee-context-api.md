# OCLR 裁判 context API 資料契約

- 契約草案：1.0.0（尚未發布）；文件版本：0.4；日期：2026-10-27
- 狀態：依 M0 SPEC-01 更新，尚未聯合凍結／實作；所有 `/api/referee/v1` 路徑均為提案
- 基底：`https://oclr.org/api/referee/v1`
- 認證：[OCLR 桌面授權](desktop-authorization.md)發行的 Bearer access token

2026-10-28：0.6.0 桌面新增 `/me/fixtures` 與 PR #409 的只讀 `/fixtures/{id}/panel` 候選 adapter，網站 API 另行開發。本文完整 `/context`、allowedIntents 及操作 gate 尚未實作／聯合凍結，panel 不替代它們。數字 workspace revision／dependencyFingerprint 的 wire mapping 及 JSON Schema 見 [PR409 交接契約](pr409-desktop-read.md)。

## 1. 資料範圍與相容性

此 API 提供「本人被指派場次」與「單場操作快照」。沿用 OCLR 既有正式隊伍、場次、圖池、裁判指派、直播與賽果來源，以服務層共用授權與查詢邏輯。不得從前端頁面抓取私人資料，也不讓桌面直接存取資料庫。

現有 `/api/v1` 是獨立的 saved-read／Developer 契約；其 1.2.0 版本不等同本提案 1.0.0。既有 cookie 管理接口不能直接接受新 Bearer，亦不改變既有 read-only 語意。

### 1.1 通用格式

| 項目 | 契約 |
| --- | --- |
| 成功 envelope | `{ data, meta: { apiVersion, contractVersion, requestId, serverTime } }` |
| 固定版本 | apiVersion 為字串 `1`，contractVersion 為 `1.0.0` |
| 回應 header | X-Request-Id、X-OCLR-Referee-Contract、Cache-Control: no-store |
| 身分 | Authorization: Bearer；不帶 cookie；explicit invalid Bearer 不降級匿名 |
| 時間 | RFC 3339 UTC；timeZone 為 IANA；畫面可並列使用者時區，但不改動來源時間 |
| 識別字 | fixture／round／team／pool／entry ID 為 UUID；edition 使用 slug、nameTemplateId 為 opaque 模板鍵；osu! ID／beatmap ID／room ID 為正整數且不超過 JavaScript safe integer |
| 修訂 | opaque string；客戶端只做相等比對，不解析、不自行累加 |
| null | 明確表示未設定／無資料；不以空字串、0 或預設比賽規則替代 |
| 命名 | 業務資料 camelCase；桌面授權端點的 snake_case 是另一份契約 |
| 未知資料 | 回應新增欄位可忽略；未知 enum／意圖／規則必須停用相關操作並提示更新 |
| 查詢參數 | 未列出的、重複的或格式錯誤的參數一律 400 |

同 major 的新增非必要欄位可提高 minor；破壞性欄位／型別／語意更動需新 major。回應須以執行期 schema 驗證，契約不相容不得悄悄改抓舊端點。正式實作階段由共用 schema 產生 OpenAPI 與契約測試，本輪僅保留 Markdown。

## 2. 授權及投影規則

M0 固定來源映射見 [SPEC-01](../m0/spec-01.md)。現有 importer 的 Admin／Developer assignment 例外、未定案隊伍 409 及部分交易外檢查均不符合本契約；CTX-01 必須新增同一讀取邊界內的本人指派檢查與 tolerant projection，不能直接包裝舊回應。

每次列表、分頁及 context 請求均依序檢查：token、desktop session、scope、有效帳號與裁判能力、本人指派。Admin 使用本 API 也只讀本人指派；未指派場次的管理沿用網站。

- 有裁判能力但無指派：列表為空，不因此授予其他場次。
- 指派遭移除或指定資源不存在：context 回 404，避免暴露他人場次。
- 所有可用裁判能力遭撤銷：回 403；App 清除私人資料與計畫。
- 保留其他 edition 權限但失去本場 edition 能力時，context 也回 404 FIXTURE_NOT_AVAILABLE；只清除受影響場次並重新取得列表。403 REFEREE_ACCESS_REVOKED 僅表示已無任何有效裁判能力，兩者不可混用。
- 回傳本場正式名單及所需工作人員最小身分；不包含報名答案、私人聯絡方式、其他場次、審核內文或完整稽核。
- 指派圖池沿用 `fixtureForReview` 的授權邊界；未指派的未公開圖池不回傳。
- 直播投影需新增本場裁判讀取規則，只提供本場直播員、確認狀態及必要操作提示，不開放完整 streaming workspace。
- OCLR 的 allowedIntents 是資料與角色允許準備的操作；Bancho 是否真的授權仍由 IRC 回覆決定。

上述本人指派範圍及 P0 模式／規則政策已依 D01／D03／D04 確認，見 [設計決策](../design-review.md)。所有身份、指派、規則及資料查詢需在同一受限查詢／交易邊界內核對；已在途請求不構成撤權後的持續存取權。

## 3. 端點與輪詢

| GET 端點 | 必要 scope | 功能 |
| --- | --- | --- |
| `/me/fixtures` | referee:fixtures:read | 本人目前可讀的指派場次摘要 |
| `/fixtures/{fixtureId}/context` | referee:context:read | 單場一致快照與操作規則 |

兩者只讀，不呼叫上游 osu! 更新、不匯入 MP、不產生／發布結果，也不因讀取初始化業務記錄。MVP 無遠端房間寫入或 SSE。

目前場次預設每 15 秒輪詢；失焦可降為 60 秒；背景快照可能自然過期，恢復焦點先重讀。meta 的 pollAfterSeconds 僅限制週期輪詢，不限制使用者手動刷新或 create_lobby／start_game 前的單次重讀；這些請求仍受整體限流及 Retry-After 約束。避免連點產生重讀風暴，同一登入 generation、同一 fixture 的重讀需合併。不要對所有列表場次逐一輪詢完整 context。

提議限制：每 session 120 reads／分鐘，單次查詢 5 秒，context JSON 上限 512 KiB、列表 JSON 上限 256 KiB；由共享／入口層執行限流。這些值須於後端實作前確認，不能假定既有 Developer quota 直接適用。未知端點、HTML 回應或缺少契約標記屬客戶端 INTEGRATION_UNAVAILABLE，不降級抓取網站管理頁。

## 4. 我的場次列表

`GET /me/fixtures?edition=dev-synthetic&view=active&limit=50&cursor=...`

| 參數 | 型別及語意 |
| --- | --- |
| edition | 可選 edition slug，依後端既有驗證規則；不擴張權限 |
| view | active（預設）／all；active 為可運作 edition、非取消且尚無核准結果的 scheduled／in_progress 場次；TBA 仍列入 |
| limit | 1–100，預設 50；下一頁保持相同 |
| cursor | 伺服器發出的 opaque cursor，綁定 subject、篩選、排序及 collectionRevision，5 分鐘有效 |

排序為 scheduledAt 升冪、null 最後、fixture ID 作穩定次序。第一頁回 collectionRevision 與 nextCursor；後續頁使用相同投影版本。相關資料改變時回 409 COLLECTION_CHANGED，客戶端丟棄本輪分頁並從頭開始；最多重啟一次，再提示手動更新，避免無限迴圈。

```json
{
  "data": {
    "items": [
      {
        "fixtureId": "00000000-0000-4000-8000-000000000101",
        "fixtureRevision": "fixture:7",
        "edition": { "slug": "dev-synthetic", "name": "Synthetic OCLR" },
        "round": { "id": "00000000-0000-4000-8000-000000000102", "name": "Example round" },
        "label": "Example A vs Example B",
        "scheduledAt": "2026-10-28T12:00:00Z",
        "timeZone": "Asia/Taipei",
        "status": "scheduled",
        "resultReviewState": null,
        "operational": true,
        "teams": [
          { "slot": "home", "resolution": "resolved", "team": { "id": "00000000-0000-4000-8000-000000000201", "name": "Example A" }, "sourceLabel": null },
          { "slot": "away", "resolution": "resolved", "team": { "id": "00000000-0000-4000-8000-000000000202", "name": "Example B" }, "sourceLabel": null }
        ],
        "streamingState": "confirmed",
        "reviewUrl": "https://oclr.org/admin/tournaments/dev-synthetic/matches/00000000-0000-4000-8000-000000000101"
      }
    ],
    "collectionRevision": "collection:example-1",
    "nextCursor": null
  },
  "meta": {
    "apiVersion": "1",
    "contractVersion": "1.0.0",
    "requestId": "00000000-0000-4000-8000-000000000901",
    "serverTime": "2026-10-27T04:00:00Z"
  }
}
```

status 僅為 scheduled／in_progress／cancelled；resultReviewState 為 null／draft／submitted／approved，兩者不可合併成含糊的 completed。streamingState 為 unassigned／confirmed／needs_confirmation／unavailable；最後一者表示來源尚不可讀，不能推定沒有直播員。teams 固定含 home／away 兩個 slot；尚未解析時 resolution=unresolved、team=null，sourceLabel 為可公開給本人的來源描述。禁止客戶端猜測晉級隊伍；上例為兩隊已解析的情況。

## 5. 單場 context

`GET /fixtures/{fixtureId}/context`，不接受 query 或 request body。回傳在同一資料庫一致性快照中組合的資料；不得以數次獨立 HTTP 讀取拼出未標示的混合版本。

### 5.1 頂層欄位

| 欄位 | 型別／必要性 | 語意 |
| --- | --- | --- |
| contextRevision | 必填 string | `ctx_` 加 64 位小寫 SHA-256 hex，涵蓋實際業務投影、版本、viewer 與權限 |
| capturedAt／freshUntil | 必填 timestamp | capturedAt 為一致快照取得時間，freshUntil=capturedAt＋30 秒；meta.serverTime 為回應時間，不會重設快照期限，也不保證期間權限不變 |
| sourceVersions | 必填 object | fixture、assignment、rules、rosters、pool、streaming、lobby 的 revision；無來源為 null |
| viewer | 必填 object | 目前 osuId／username，由後端身分取得 |
| fixture／edition／round | 必填 object | 場次識別、來源時區、階段、狀態、operational 與輪次 |
| rules | object 或 null | 核准的操作規則；缺失時相關 intent 被阻擋 |
| teams | 兩個 team slot | 穩定 team ID、正式名單與 revision；未解析時 slot 為 unresolved，不以假隊伍補足 |
| lobby | 必填 object | 核准房名、隊伍顏色預設與遠端房間參考；模式只以 rules 為準 |
| pool | object 或 null | 本場圖池、明確指令 profile、個人 Mods 檢查政策 |
| officials | 必填 object | 本場裁判及最小直播投影 |
| allowedIntents | 必填 string array | OCLR 允許準備的操作，不包含本地或 Bancho preflight 結果 |
| requiredLocalChecks | 必填 object，key 為 allowedIntents | 每個意圖對應 string array；不同意圖不能套用同一份全域檢查 |
| issues | 必填 array | 缺漏、阻擋與警告；即使為空也回傳 |
| links | 必填 object | 核准的網站入口；只允許固定 OCLR／osu! HTTPS origin |

contextRevision 排除 capturedAt、serverTime、freshUntil、pollAfterSeconds、request ID 等傳輸欄位；相同業務投影不因每次讀取而變更。sourceVersions 不足以代替整體 revision。相關 role、assignment 或影響 allowedIntents 的資料改變也必須使 revision 改變。伺服器使用固定 canonical 業務投影計算 hash；客戶端不自行重算。sourceVersions.lobby 是房名／顏色等設定修訂，即使 binding=null 也可有值；P0 binding 固定為 null，不宣稱已有遠端綁定。

### 5.2 子物件與限制

| 子物件 | 契約 |
| --- | --- |
| edition | slug、name、abbreviation、status、archive、operational；status 為來源字串僅供顯示，是否可操作以 operational 與 allowedIntents 為準 |
| round | id、name、stage：group／knockout／other；stage 只供展示，操作由 rules／operational 決定，不從階段名稱推定賽制進行 |
| fixture | id、label、scheduledAt（可 null）、timeZone、status、resultReviewState（可 null） |
| rules | revision、ruleset、teamMode、scoringMode、playersPerTeam、roomSize、series、noFailPolicy、substitutionPolicy、startPolicy；未設定值為 null |
| rules.series | first_to／fixed_maps；target 或 mapCount 必須依模式明確提供；不得從 BO 字串自行猜測 |
| team | id、name、rosterRevision、roster；名單玩家為 osuId、username、role、eligible；role 為 captain／player，不等同 Bancho referee |
| lobby | roomName（可 null）、nameTemplateId（可 null）、teamColourAssignments（可 null）、binding（可 null）；密碼不放在 context |
| binding | 有來源才回 state=bound／unbound、roomId／mpUrl；null 表示後端尚未提供綁定，不能推定未開房 |
| pool | id、revision、name、entries；每個 entry 有 id、slot、category、position、beatmapId、ruleset、metadata、commandProfile、availability、blockingCodes |
| entry.category | NM／HD／HR／DT／FM／TB；分類是展示用，不自動決定 Mods |
| commandProfile | 明確 roomMods、freeMod、individualModsCheck（not_required／manual）、policyText（可 null）；無法安全產生時整個 profile 為 null |
| metadata | 可 null；若存在含 artist、title、difficulty，其他數值可 null；失去封面／星數不應阻擋已知 ID 的選圖 |
| streaming | state、streamer（osuId／username 或 null）、confirmedFor（時間／時區或 null）；不包含聯絡方式及稽核 actor |

teamColourAssignments 有值時，Team VS 必須正好對應兩個正式 team ID，red／blue 不重複；null 時由裁判在本機明確選擇及核對，不依 home／away 暗中分配。出賽 lineup 與槽位也由裁判從有效 roster 選取，全部 roster 不代表同時出賽。

streaming 的 state 必須與內容一致：unassigned／unavailable 時 streamer 與 confirmedFor 都是 null；confirmed 必須有 streamer，且 confirmedFor 的時間／時區與本場目前值相符。needs_confirmation 必須有 streamer，可保留舊 confirmedFor 或 null；scheduledAt=null 時不得聲稱已確認目前賽程。referees 依 osuId 去重並包含目前仍被指派的 viewer；它不是 Bancho 權限證明。

數值界限提案：roomSize 1–16；Team VS 的兩隊出賽人數合計不得超過 roomSize；roster 每隊至多 64 人、圖池至多 256 項、裁判身分至多 50 人、issues 至多 64 項。超限回 413，不能截斷名單後仍聲稱完整。OCLR 指派名單不等同 Bancho addref 名單，後者另受 Bancho 上限與房間建立者權限限制。

P0 自動操作支援矩陣為 osu! standard、Head To Head／Team VS、Score V2；其他規則可讀取並以 UNSUPPORTED_RULES 阻擋自動設定及開始，保留手動 IRC。後續擴充需新增驗收樣本。

明確型別及映射補充：

| 欄位 | 型別／合法值 | 行為 |
| --- | --- | --- |
| rules.ruleset、entry.ruleset | osu／taiko／fruits／mania，規則未設定可 null | 對應 mp playmode 0／1／2／3；P0 自動操作只支援 osu |
| rules.teamMode | head_to_head／tag_coop／team_vs／tag_team_vs 或 null | 對應 mp teammode 0／1／2／3；P0 僅 0、2 |
| rules.scoringMode | score／accuracy／combo／score_v2 或 null | 對應 mp scoremode 0／1／2／3；P0 僅 3 |
| rules.playersPerTeam | 1–16 的整數或 null | 不從 roster 長度或 roomSize 推定；需要時未設定即阻擋 Start |
| rules.noFailPolicy | required／optional／forbidden 或 null | commandProfile 必須符合政策，null 不得被當成 optional |
| rules.substitutionPolicy | prohibited／roster_only_between_games 或 null | 其他核准政策需新支援；null 阻擋自動換人，不自行裁定資格 |
| rules.startPolicy | null 或含 streamingRequirement 的物件 | streamingRequirement=required／optional；明確設定後才可判斷直播是否為 Start 前置條件，不能缺值時默認 optional |
| rules.series | null，或含 kind、target、mapCount 的物件 | first_to：target 為正整數、mapCount=null；fixed_maps：反之；不適用數值也必須明確為 null |
| team slot | slot=home／away、resolution=resolved／unresolved、team、sourceLabel | resolved 必須有 team；unresolved 必須 team=null 且提供 sourceLabel |
| roster[].eligible | boolean | 此值來自目前核准名單狀態；不可由客户端依暱稱自行判定 |
| commandProfile.roomMods | 無重複縮寫的 string array | None／Freemod 不放進陣列；無房間 Mods 使用空陣列；不支援縮寫阻擋該 entry |
| commandProfile.freeMod | boolean | 與 roomMods 分開；例如 NF＋FreeMod 來自明確 profile，不從 FM 分類推定 |
| entry.availability | selectable／blocked | selectable 必須有可驗證 profile 且 blockingCodes 為空；blocked 不能觸發切圖 |
| metadata.lengthSeconds／stars | 非負 number 或 null | 展示資料，不參與來源規則或 UID 判定 |
| lobby.binding | null 或含 state、roomId、mpUrl 的物件 | bound 必須有正整數 roomId 及對應 canonical osu! MP URL；unbound 兩值皆 null |

所有表列 object 欄位均為必要鍵，除非明寫可選；尚無值使用 null，集合為空使用空陣列。ctx 中的 ruleset、teamMode 等操作 enum 出現未知值時，相關自動操作必須阻擋；edition.status 這類明訂的展示字串不作 enum 判斷。任何用於 IRC 行的字串均禁止 CR、LF、NUL，並在客戶端再次檢查 UTF-8 位元組長度；房名超出 Bancho 經 SPIKE-01 確認的限制時阻擋，不悄悄截斷。

requiredLocalChecks 的 key 必須與 allowedIntents 完全相同；blocked intent 沒有 key。客戶端將後端要求與以下固定最小集合取聯集，後端不能少列以略過保護；未知檢查條件阻擋該 intent。全部 OCLR 衍生變更都需有效桌面 session、未過期 context 與 identity_match；身份語意以專案設計 D05 為準。

| 意圖 | 固定本地檢查（除共通條件） |
| --- | --- |
| create_lobby | no_local_lobby_reference：沒有 bound／pending／unknown 本機記錄，且 recovery_uncertain 已經裁判核對解除；資料清除不能推定從未開房；操作前另成功重讀 context |
| configure_lobby | room_binding、room_permission、room_snapshot |
| invite_players | room_binding、room_permission；目標須為有效本場 roster，與目前地圖無關 |
| place_players | room_binding、room_permission、room_snapshot、lineup_selected；Team VS 另要 team_colours_verified |
| select_map | room_binding、room_permission、room_snapshot；entry 必須 selectable、profile 完整，執行後另驗 map／Mods |
| start_game | room_binding、room_permission、room_snapshot、lineup_selected、map_and_mods_verified；操作前另成功重讀 context |
| manage_timer | room_binding、room_permission；不要求 lineup、目前地圖或隊伍顏色 |
| abort_game／close_lobby | room_binding、room_permission、room_snapshot；明確確認影響，不要求出賽 lineup |

room_binding 是「本機選定且已核對的目標房間」，不是 P1 遠端 binding；至少以目前 channel 的 settings History ID 比對請求 MP，JOIN／NAMES／topic 本身不夠。room_permission 依當次查詢範圍內 listrefs 列名與實際 Bancho 權限核對，不將 creator-only 操作、UID 身分或永久權限一起放行；缺失保持 unknown。room_snapshot 在此指該步派送前 10 秒內完成、未被後續事件判定失效的 Bancho 觀測。serverTime 與 10 秒皆用單調時鐘計算；API 不能代替 Bancho 觀測。無法取得足夠資訊時不自動 Start。

Team VS 的 Start 額外需要 team_colours_verified；Head To Head 的 P0 只支援每隊一名玩家，不做 team 顏色檢查。當前 entry 的 individualModsCheck=manual 時，再加入 individual_mods_verified；policyText 必須是完整且已核准的人工檢查說明，不能當成可自動解析的規則。語意不明則 entry blocked。

P0 不自動辨識熱身／正式局或裁定換人時機。既有 allowSubstitutions=false 可映射 prohibited；true 不足以證明 roster_only_between_games，需額外核准政策。即使 OCLR 官方賽果政策允許少人出賽，P0 衍生 Start 仍要求完整 lineup；少人出賽由明示手動流程處理，不偷偷擴大自動操作。若本機已選 lineup 後再變更出賽人員，place_players 額外加入 substitution_policy_reviewed，由裁判核對已知政策及時機；null／未知政策阻擋該換人計畫，prohibited 不提供衍生換人。單純將相同選手換槽不等同換人。這是人工檢查，不是 P1 的完整換人工作流。

### 5.3 合成完整範例

下例是已核准的 2v2、first-to-1、Score V2 合成單圖系列，圖池確實只有一張，沒有截斷快照。dev-synthetic、所有 UUID／osu! ID／地圖 ID 皆為合成資料；不代表真實比賽或可操作對象。

```json
{
  "data": {
    "contextRevision": "ctx_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "capturedAt": "2026-10-27T04:00:00Z",
    "freshUntil": "2026-10-27T04:00:30Z",
    "sourceVersions": {
      "fixture": "fixture:7",
      "assignment": "assignment:2",
      "rules": "rules:3",
      "rosters": "rosters:5",
      "pool": "pool:4",
      "streaming": "streaming:2",
      "lobby": "lobby:1"
    },
    "viewer": { "osuId": 900000001, "username": "Example Referee" },
    "edition": {
      "slug": "dev-synthetic",
      "name": "Synthetic OCLR",
      "abbreviation": "OCLR TEST",
      "status": "active",
      "archive": false,
      "operational": true
    },
    "round": {
      "id": "00000000-0000-4000-8000-000000000102",
      "name": "Example round",
      "stage": "knockout"
    },
    "fixture": {
      "id": "00000000-0000-4000-8000-000000000101",
      "label": "Example A vs Example B",
      "scheduledAt": "2026-10-28T12:00:00Z",
      "timeZone": "Asia/Taipei",
      "status": "scheduled",
      "resultReviewState": null
    },
    "rules": {
      "revision": "rules:3",
      "ruleset": "osu",
      "teamMode": "team_vs",
      "scoringMode": "score_v2",
      "playersPerTeam": 2,
      "roomSize": 4,
      "series": { "kind": "first_to", "target": 1, "mapCount": null },
      "noFailPolicy": "required",
      "substitutionPolicy": "roster_only_between_games",
      "startPolicy": { "streamingRequirement": "optional" }
    },
    "teams": [
      {
        "slot": "home",
        "resolution": "resolved",
        "team": {
          "id": "00000000-0000-4000-8000-000000000201",
          "name": "Example A",
          "rosterRevision": "roster-a:3",
          "roster": [
            { "osuId": 900000011, "username": "Example A1", "role": "captain", "eligible": true },
            { "osuId": 900000012, "username": "Example A2", "role": "player", "eligible": true }
          ]
        },
        "sourceLabel": null
      },
      {
        "slot": "away",
        "resolution": "resolved",
        "team": {
          "id": "00000000-0000-4000-8000-000000000202",
          "name": "Example B",
          "rosterRevision": "roster-b:2",
          "roster": [
            { "osuId": 900000021, "username": "Example B1", "role": "captain", "eligible": true },
            { "osuId": 900000022, "username": "Example B2", "role": "player", "eligible": true }
          ]
        },
        "sourceLabel": null
      }
    ],
    "lobby": {
      "roomName": "OCLR TEST: (Example A) vs (Example B)",
      "nameTemplateId": "oclr-standard:1",
      "teamColourAssignments": [
        { "teamId": "00000000-0000-4000-8000-000000000201", "colour": "red" },
        { "teamId": "00000000-0000-4000-8000-000000000202", "colour": "blue" }
      ],
      "binding": null
    },
    "pool": {
      "id": "00000000-0000-4000-8000-000000000301",
      "revision": "pool:4",
      "name": "Example pool",
      "entries": [
        {
          "id": "00000000-0000-4000-8000-000000000302",
          "slot": "HD1",
          "category": "HD",
          "position": 1,
          "beatmapId": 900000101,
          "ruleset": "osu",
          "metadata": { "artist": "Example artist", "title": "Example song", "difficulty": "Example difficulty", "lengthSeconds": 180, "stars": 5.2 },
          "commandProfile": {
            "roomMods": ["NF", "HD"],
            "freeMod": false,
            "individualModsCheck": "not_required",
            "policyText": null
          },
          "availability": "selectable",
          "blockingCodes": []
        }
      ]
    },
    "officials": {
      "referees": [{ "osuId": 900000001, "username": "Example Referee" }],
      "streaming": {
        "state": "confirmed",
        "streamer": { "osuId": 900000031, "username": "Example Streamer" },
        "confirmedFor": { "scheduledAt": "2026-10-28T12:00:00Z", "timeZone": "Asia/Taipei" }
      }
    },
    "allowedIntents": [
      "create_lobby", "configure_lobby", "invite_players", "place_players",
      "select_map", "start_game", "manage_timer", "abort_game", "close_lobby"
    ],
    "requiredLocalChecks": {
      "create_lobby": ["identity_match", "no_local_lobby_reference"],
      "configure_lobby": ["identity_match", "room_binding", "room_permission", "room_snapshot"],
      "invite_players": ["identity_match", "room_binding", "room_permission"],
      "place_players": ["identity_match", "room_binding", "room_permission", "room_snapshot", "lineup_selected", "team_colours_verified"],
      "select_map": ["identity_match", "room_binding", "room_permission", "room_snapshot"],
      "start_game": ["identity_match", "room_binding", "room_permission", "room_snapshot", "lineup_selected", "team_colours_verified", "map_and_mods_verified"],
      "manage_timer": ["identity_match", "room_binding", "room_permission"],
      "abort_game": ["identity_match", "room_binding", "room_permission", "room_snapshot"],
      "close_lobby": ["identity_match", "room_binding", "room_permission", "room_snapshot"]
    },
    "issues": [],
    "links": {
      "fixtureUrl": "https://oclr.org/tournaments/dev-synthetic/schedule",
      "reviewUrl": "https://oclr.org/admin/tournaments/dev-synthetic/matches/00000000-0000-4000-8000-000000000101"
    }
  },
  "meta": {
    "apiVersion": "1",
    "contractVersion": "1.0.0",
    "requestId": "00000000-0000-4000-8000-000000000902",
    "serverTime": "2026-10-27T04:00:00Z",
    "pollAfterSeconds": 15
  }
}
```

### 5.4 未完成資料與 intent

授權正確但資料不完整時，回 200、保留已知欄位與 issues；服務失敗／無法保證快照一致時回 503，不拼出貌似完整的 context。

issue 格式為 `{ code, severity, path, affectedIntents, message }`。severity 為 blocking／warning；path 使用 JSON Pointer，message 是說明，不作邏輯判斷。存在 blocking issue 時，受影響 intent 不得出現在 allowedIntents。未知 code 且含目前 intent 時，採阻擋處理。

| 條件 | code | 受影響操作 |
| --- | --- | --- |
| 核准規則缺失 | RULES_NOT_CONFIGURED | configure_lobby、select_map、start_game |
| 已有規則物件但必要操作欄位缺失 | REQUIRED_RULE_FIELD_MISSING | 依欄位阻擋：roomSize／teamMode／scoringMode 影響設定及 Start，playersPerTeam 影響 Start，noFailPolicy 影響選圖及 Start |
| 不支援遊戲／模式 | UNSUPPORTED_RULES | configure_lobby、select_map、start_game |
| 隊伍尚未解析或正式名單不可用 | ROSTER_NOT_FINALIZED | create_lobby、invite_players、place_players、start_game |
| 無核准房名 | LOBBY_NAME_NOT_CONFIGURED | create_lobby |
| 已有遠端綁定（P1 才可能出現） | LOBBY_ALREADY_BOUND | create_lobby；應核對既有房間，不自動再開 |
| 圖池未綁定／無可選地圖 | MAPPOOL_NOT_ASSIGNED／NO_SELECTABLE_MAP | select_map、start_game |
| FM／Force Mod 規則不明 | UNKNOWN_MOD_POLICY | 相關 entry blocked；單一壞 entry 不移除全場 start_game，由本地對目前地圖檢查；全池無可選項時另套 NO_SELECTABLE_MAP |
| 已取消、封存或已有核准結果 | FIXTURE_NOT_OPERATIONAL | 所有變更房間的 intent；保留唯讀及 OCLR 連結 |
| 開賽前置政策未設定 | START_POLICY_NOT_CONFIGURED | start_game |
| 直播未指派／改期未再確認／來源不可用 | STREAM_UNASSIGNED／STREAM_RECONFIRMATION_REQUIRED／STREAM_UNAVAILABLE | startPolicy.streamingRequirement=required 時 blocking 並移除 start_game，optional 時 warning |

「當前地圖」屬本機／Bancho 狀態，伺服器不會猜它；select_map 可在圖池仍有可選項目時保留，特定 entry 的 blockingCodes 由客戶端強制執行，Start 再檢查目前選中 entry 的政策。

streaming.state=unavailable 只表示受支援來源尚未提供可確認的最小投影，sourceVersions.streaming=null；不能用它吞掉資料庫查詢失敗，後者必須回 503。startPolicy 本身不明仍阻擋 Start。D04 已確認直播採 optional：設定介面預選此值，由有權的 OCLR 工作人員明確保存才生效；既有缺值不自動回填，仍阻擋 Start。明確保存的 required 仍依本表處理；合成範例不設定任何真實賽事政策。

rules.series 缺失時保留 null，影響系列賽流程及暫記比分；若不影響已核准的單圖房間設定，可只警告。所有 noFailPolicy、individual Mods 及 substitutionPolicy 的不明值不得被解讀為允許。需要人工核對的已知政策則產生本地確認項，綁定 contextRevision、地圖與本局，切圖／換人後失效。

## 6. 客戶端同步、前置檢查與保留期限

1. 新 context 完整驗證後一次替換舊快照，不逐欄混合；viewer 必須等於本次登入 subject，並匹配請求的 fixture ID 及 generation，否則丟棄並停用整合。
2. revision 改變時作廢未送出計畫、地圖政策確認與 lineup 核對；已在途步驟結果保留，後續停止重算。
3. 所有衍生變更在派送前確保 context 尚在 freshUntil 內；create_lobby／start_game 每次操作前另成功重讀。失敗或版本改變時回到預覽；初始化／切圖可用仍新鮮的快照。
4. 檢查目前 OCLR／IRC 身分、Bancho 觀測狀態、目標 room ID、正式 roster、lineup、顏色、地圖及 Mods。所需狀態未知時不自動開始。
5. 斷線或資料過期：顯示 stale，停用 OCLR 衍生計畫；私人快照硬清除期限為 capturedAt＋5 分鐘，失敗重試不延長。已在途 IRC 結果可觀測，但不再派送後續步驟。
6. ACCESS_TOKEN_EXPIRED 更新期間暫停衍生操作；SESSION_REVOKED／SESSION_EXPIRED／INVALID_ACCESS_TOKEN 或全域 REFEREE_ACCESS_REVOKED 清除該 OCLR subject 的全部私人快照、關聯日誌、恢復記錄及待寫緩衝（不含無 OCLR 關聯的獨立 IRC 歷史）；單場 404 只清受影響場次。INSUFFICIENT_SCOPE 停用該整合，不使用 cookie 或 Developer fallback。上述撤權清理不等待保留期限。
7. 登出、App 結束均清除 Main／Renderer 的私人 context。禁止落盤完整 API 回應或複製未公開圖池／名單／工作人員投影。D06 已確認預設保存加密 IRC 聊天及去密操作事件，事件可含名稱／地圖，但不得以日誌形式批次保存 context；另允許最小恢復記錄，範圍依專案 §4.2。App 結束可保留未到期日誌，登出／撤權須清受影響日誌、恢復記錄及待寫緩衝；重啟後同 subject 且本場 context GET 成功才解鎖關聯歷史。記錄不是離線 context，不可還原權限或自動重送。手動匯出檔無法於撤權後追回。
8. 取消／登出／帳號或場次切換時推進 generation，忽略所有舊回應；HTTP abort 只是最佳努力，不能單靠取消請求防止私人資料回填。

新鮮度以 freshUntil－serverTime 的差值配合本機單調時鐘計算，保守扣除請求往返時間；硬清除期限同樣依 capturedAt＋5 分鐘與 serverTime 換算，不能因使用者修改系統日期而延長。回應抵達時已超過期限即為 stale。

freshUntil 不是 server-side reservation，也不保證讀取與 IRC 操作原子化。D07 已確認 MVP 單主控且沒有中央操作鎖；若其他裁判或玩家修改房間，工具應更新觀測並提示衝突，不能宣稱獨占控制。

## 7. 錯誤契約

錯誤格式沿用桌面授權的 error envelope；message 不回傳例外、查詢、私人資料或其他人的存在。

| HTTP | code | 行為 |
| --- | --- | --- |
| 400 | INVALID_QUERY／INVALID_CURSOR | 修正請求，不重試 |
| 401 | ACCESS_TOKEN_EXPIRED | single-flight refresh 一次，重試原 GET |
| 401 | INVALID_ACCESS_TOKEN／SESSION_REVOKED／SESSION_EXPIRED | 停用、清理私人資料、重新登入 |
| 403 | INSUFFICIENT_SCOPE | 不降級到 cookie／Developer；重新授權或提示版本問題 |
| 403 | REFEREE_ACCESS_REVOKED | 已無任何有效裁判能力，清理全部私人資料 |
| 404 | FIXTURE_NOT_AVAILABLE | 不存在、跨 edition 或非本人指派；移除本機場次快照 |
| 409 | COLLECTION_CHANGED | 丟棄分頁，重新讀取第一頁 |
| 413 | CONTEXT_TOO_LARGE／RESPONSE_TOO_LARGE | context／列表超限，不接受部分資料，提示後端調整 |
| 426 | CLIENT_UPGRADE_REQUIRED | 保留唯讀錯誤頁，停用衍生操作 |
| 429 | RATE_LIMITED | Retry-After＋退避，避免重試風暴 |
| 503 | SOURCE_UNAVAILABLE／SERVICE_UNAVAILABLE | 標示 stale，禁止用快照冒充最新 |

## 8. P1 擴充邊界

- SSE 僅傳送 fixture ID、context revision 與事件序號，通知重讀；重新連線先完整 GET，再使用新事件位置。
- 遠端房間綁定使用獨立 write scope、expectedRevision 與 idempotency key；不能以 context GET 產生寫入。
- 如需防止同場重複開房，先建立後端操作協調／租約契約，再宣稱多主控安全。MVP 本機防連點只能處理單一客戶端。
- 賽果匯入及提交繼續使用既有正式審核領域服務；不接受客戶端直接傳 winner／官方比分作為權威結果。

## 9. 契約驗收及來源

必驗：匿名／錯 scope／角色撤銷／移除指派／Admin 非本人場次、未知規則、null 資料、圖池修訂、混合來源版本、改期後直播重確認、分頁變更、超限不截斷、未知 enum、完整私人 context 不落盤、D06 加密事件範圍／重啟驗權／撤權清理、正式比分不由客戶端產生。

- [OCLR 場次與 fixtureForReview](https://github.com/OCLR-dev/OCLR-website/blob/d34378ef7b9a300a2baf1aaf61ff92c77a0b11e3/src/lib/fixtures.ts)
- [OCLR saved-read 契約](https://github.com/OCLR-dev/OCLR-website/blob/d34378ef7b9a300a2baf1aaf61ff92c77a0b11e3/docs/read-api.md)
- [OCLR 圖池模型](https://github.com/OCLR-dev/OCLR-website/blob/d34378ef7b9a300a2baf1aaf61ff92c77a0b11e3/src/lib/mappool-model.ts)
- [OCLR 直播任務](https://github.com/OCLR-dev/OCLR-website/blob/d34378ef7b9a300a2baf1aaf61ff92c77a0b11e3/docs/streaming.md)
- [OCLR 正式賽果流程](https://github.com/OCLR-dev/OCLR-website/blob/d34378ef7b9a300a2baf1aaf61ff92c77a0b11e3/docs/competition-operations.md)
- [MVP 任務](../mvp-plan.md)
