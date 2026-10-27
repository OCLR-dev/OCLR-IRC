# M0 / SPEC-00：驗證邊界與輸入

- 日期：2026-10-27；狀態：本輪需求／假設盤點完成，非 MVP 完成。
- 設計輸入：0.3 版四份設計文件、[已確認 D01–D08](../design-review.md)。
- 交付範圍：可重跑的隔離實驗、證據、來源映射與 SPEC-01 更新；不建立產品 UI、正式 API 或 migration。

## 已確定的邊界

1. P0 為 standard、Head To Head 1v1／Team VS、Score V2；單 IRC 帳號／單主控／單目前 OCLR 場次。
2. OCLR session 與 IRC 分開；暱稱匹配加人工核對不是 UID 證明，Admin 仍限本人指派。
3. 本機日誌保存預設開啟，需去密、加密、帳號隔離及清理；token 與完整私人 context 不持久化。
4. 先交付三平台內測；本機 macOS 成功不能代表 Windows、Linux 或公開簽章發行完成。
5. 前一輪「不要寫程式」已由本輪開始 MVP／M0 的指示更新。本輪程式僅置於 `spikes/m0`；不將實驗當作正式產品模組。

## 實驗資料與操作範圍

| 類型 | 輸入 | 限制 |
| --- | --- | --- |
| 合成協定 | Example、#mp_900000001、中文／emoji、RFC S256 公開向量 | 只在記憶體測試，不送入 Bancho |
| 合成授權 | 本機隨機 state、固定 SYNTHETIC_CODE、兩個 127.0.0.1 隨機埠 | 沒有 osu!／OCLR 登入、沒有真實 token；不是正式 auth server |
| 合成保存 | 隨機 AES 金鑰、合成私人字串、臨時 SQLite／profile | 不寫真實聊天或憑證；不輸出金鑰 |
| 真實指定房間 | [MP 122076167](https://osu.ppy.sh/mp/122076167) | 使用者指定；後續明確授權僅登入、加入、settings／listrefs，不執行 map／mods、make、start／abort、close |
| OCLR 來源 | 最新公開 main `14ab070450afb4b81b28eb075386428eab94e31f` | 僅靜態來源查核，不等於網站部署或真實裁判授權驗證 |

密碼只以互動式隱藏輸入交給本次 probe，不放入參數、環境檔、報告或原始聊天。已觀察回覆只保留白名單去密摘要；不保存隊員、裁判姓名或原始封包。

## 假設與所需證據

| ID | 假設／未知 | 實驗與通過條件 |
| --- | --- | --- |
| H01 | Bancho 回覆可提供足夠確認狀態 | 真實登入／JOIN／settings／listrefs，另需變更、錯誤、斷線樣本；缺項維持 unknown |
| H02 | 暱稱與 #UID 可安全映射 | 暱稱正規化依官方文件；UID 證明與 #UID 變更指令須另有實測，不能以數字樣本推定 |
| H03 | 系統瀏覽器能回到 loopback | 合成外部瀏覽器 POST→303→callback；正式 HTTPS 起點及三平台另驗 |
| H04 | 選定 Electron 可用 SQLite | 在 Electron 內載入 driver，WAL 寫入／讀回與打包後重驗；宿主 Node 成功不算 |
| H05 | 私人日誌不以明文落盤 | 加密後才 bind SQL；掃描合成 marker、竄改與不同帳號 AAD 拒絕；不是全機鑑識保證 |
| H06 | OS 金鑰保護可用且可跨版本讀回 | safeStorage 能力與 round-trip，另需重啟／升級／拒絕／Linux 無 backend 實測 |
| H07 | OCLR 欄位能映射到契約 | 逐欄列出既有、需投影、需新增；Admin 例外、null 與一致性須獨立核對 |
| H08 | 三平台 UI／IME／打包一致 | 真實 Windows、macOS x64／arm64、Linux 環境；本輪無環境者明列未測 |

## 判定方式

- `passed`：指定程式在記錄環境跑過，且有斷言或明確回覆。
- `source-reviewed`：官方文件／固定提交支持，沒有執行證據。
- `partial`：只驗證局部；例如 HTTP origin 不證明 HTTPS OAuth，密文 round-trip 不證明升版 Keychain 身分。
- `blocked / not-run`：缺帳號權限、場景、測試平台或技術前置；不轉換成通過。

本輪結果見 [SPIKE 報告](spike-results.md)；契約收斂與 M0 出口條件見 [SPEC-01](spec-01.md)。
