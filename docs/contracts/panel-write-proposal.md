# 裁判面板寫入候選方案

對應 #16（PANEL-W／PANEL-C），2026-10-30。這是待雙端確認的設計與測試方案，不是已批准契約、可用 API 或上線功能；不新增 scope、HTTP 寫入、IPC 或資料持久化。網站排程仍未承諾。

## 提交邊界

桌面只能提出有限 intent：本場設定草稿、先後手／選禁紀錄、attempt 與 MP 核對關係。具體 payload 與 endpoint 由網站確認後才定版。正式賽果仍回網站提交流程及審核，不從 MP 結果、attempt 或選禁推導發布。

每次提交由 Main 固定登入 subject、fixtureId、session generation、intent、expectedRevision、dependencyFingerprint、idempotencyKey。renderer 不提供 bearer、任意 URL、原始 HTTP 或權限判斷。後端在每次請求及查詢結果時重查本人指派、edition 範圍與獨立寫入 scope；唯讀授權不能提升為寫入。

同一 key 必須綁定 subject、fixture、intent 與完整 payload digest；內容改動必須先解決原操作，再建立新 key。服務端須確認 key 保存期限、請求摘要算法、原子提交／去重及結果查詢契約。沒有結果查詢或明確去重保證時，unknown 只能回網站人工核對，不能宣稱重送安全。

## 桌面狀態

| 狀態 | 證據與允許動作 |
| --- | --- |
| draft | 使用目前可讀快照編輯；提交前刷新依賴與權限，再由人確認差異 |
| submitting | 同場互斥；封存 intent 與 key，不允許編輯已送 payload 或重複提交 |
| unknown | 斷線、逾時、回覆無法驗證或程式退出後缺少結果；只查詢原 key 結果或回站核對 |
| confirmed | 可信回覆同時匹配 subject、fixture、key、payload digest 與新 revision；重新載入正式快照 |

409 不套用本地覆蓋：保留可讀的差異草稿，載入最新狀態後由人重新編輯確認。服務端若明確拒絕且保證未寫入，可回 draft 顯示原因；不把所有 4xx 一概視為未寫入。401／403／撤權清除私人快照與草稿，取消未送工作；已送操作不得因清除 UI 而聲稱未執行。換帳號／換場／logout 使舊回應失效，不能投影到新場次。

持久化未定版前不保存私人草稿。若未來需跨重啟去重，先定義最小非敏感 guard、帳號隔離及安全 provider 政策；不得把 token、完整 context 或 payload 寫入 IRC 日誌。無法確定重啟前結果時保持 unknown，不能恢復自動送出。

revision 只保護網站資料版本，不是 IRC 控制鎖。兩個裝置可能同時控制 Bancho；遠端 lease／主控仲裁另立設計，本方案不增加其權限或保證。

## 可執行契約確定後的合成驗收矩陣

| 情境 | 替身／故障注入 | 必須驗證 |
| --- | --- | --- |
| 正常提交 | 精確 request／response fixture | 一次提交、全綁定匹配、刷新後 confirmed |
| 兩端修改 | 同 revision 並發提交 | 至多一個版本提交成功；另一端 409，不覆蓋或自動重試 |
| 依賴變更 | roster／rules／pool fingerprint 改變 | 舊草稿阻擋；人工核對後重新確認 |
| 成功但回覆遺失 | 服務端提交後斷線 | unknown；查原 key 得到原結果，無第二筆寫入 |
| 重複 key | 同 payload／不同 payload | 同內容返回原結果；不同內容拒絕且不寫入 |
| 逾時但未提交 | 提交前中止 | 不猜測是否成功；結果查詢依契約處理，不換 key 盲重送 |
| 撤權 | 提交前、提交中、結果查詢時撤銷 | 伺服器重查；私人資料清除；已送狀態不假裝 cancelled |
| 舊回應 | 換帳號／換場後回傳 | 不投影、不解鎖新場操作、不洩漏舊身份 |
| key 過期 | 超過服務端保存期限 | 顯示需人工核對，不把查無結果等同未執行 |
| 回覆不完整 | revision／digest／fixture 不匹配 | unknown，不宣稱 confirmed |
| BP／attempt | 多筆資料及 MP 對應 | 只建立核對資料；沒有正式結果發布呼叫 |
| 重啟 | submitting 時退出 | 不重放；恢復方案確定前僅人工核對 |

本文件只定義待實作測試方案，以上案例未作為寫入功能測試執行。啟動實作前需要網站確認 endpoint、schema、獨立 scope、原子版本／冪等語意、查詢結果權限與保存期限，以及雙端排程；目前沒有任何寫入能力因此開放。
