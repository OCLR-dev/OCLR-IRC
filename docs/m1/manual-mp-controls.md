# 手動房內 MP 快捷操作

2026-10-29：增加換圖、Mods、立即開始與中止比賽。這是使用者要求的手動 IRC 操作，不使用 OCLR panel 的命令預覽或將其視為正式 context 授權。

## 使用方式

1. 加入比賽房間，使用「讀取設定」與「裁判名單」取得完整設定和本人裁判資格。
2. 展開右側「房內快捷操作」，選擇操作。換圖輸入 beatmap ID（不是圖組 ID）；Mods 多選，全部不選表示 None。
3. 按「預覽指令」，核對 `#mp_…` 目標與完整命令，勾選確認後送出。
4. 送出只代表已嘗試寫入連線，畫面不宣稱操作成功。核對 BanchoBot 回覆，再讀取設定與裁判名單；若結果不明，不要直接重複執行。

| 操作 | 命令與影響 |
| --- | --- |
| 換圖 | `!mp map <beatmapId>`；不指定或切換遊戲模式 |
| Mods | `!mp mods …`；取代目前全域 Mods。可選 NF、EZ、HD、HR、DT、HT、NC、FL、SD、PF、Freemod，或全部清除為 None |
| 開始 | `!mp start`；立即開始，沒有倒數。人工核對出賽玩家、隊伍、地圖、個人 Mods 與直播準備 |
| 中止 | `!mp abort`；中止進行中的比賽，不是取消倒數，也不關閉房間 |

語法依據：[osu! 官方 Tournament management commands](https://osu.ppy.sh/wiki/en/osu!_tournament_client/osu!tourney/Tournament_management_commands)。尚未加入任意原始指令、開始倒數、aborttimer、移位、邀請、踢人或關房。

## 執行邊界

- Main 僅接受四種結構化 intent；驗證正整數 safe beatmap ID、固定 Mods 清單、去重及互斥組合（EZ／HR、DT／HT／NC、NF／SD／PF）。renderer 不能指定原始 IRC 命令或目標 channel。
- Main 重新核對目前選取的 match room、epoch、在線及 joined 狀態、History 相符、完整且未滿 10 秒的 settings、60 秒內成功查到本人的 listrefs，並共用既有節流。
- 非 abort 操作阻擋已觀測到 playing 的房間；start 阻擋空房。settings 不能完整證明即時遊戲階段，因此未知狀態仍需裁判人工核對，不宣稱自動檢查出賽名單或比賽政策。
- Main 一次只保留一個預覽，綁定房間物件、完整房間快照、隨機 token 和 10 秒單調時鐘期限。執行仍受 settings 較早的到期限制。
- 每次執行嘗試先消耗 token，再驗證與寫入；雙擊、舊 token、錯誤 epoch、未確認、狀態改變或斷線都不能重用。同時建立新預覽會取代舊預覽；切換房間或斷線清除預覽。
- 寫入前將 settings 標為 stale、裁判資格設為 unknown；成功、寫入失敗或未知結果都需重新核對。沒有離線佇列、重連重送、timer 重試或自動重放。
- 命令在既有記憶體聊天中標記「未確認送達」，原始 BanchoBot 回覆照常呈現。尚無操作 ID／可靠回覆關聯，不做成功 ACK 推斷。程式重啟不還原手動意圖；完整持久化操作日誌仍屬 LOG-01 待辦。
- OCLR 原生面板仍只預覽／複製，不開放由 panel 執行。正式 context、allowedIntents、出賽陣容、圖池與直播政策 gate 保留在後續整合工作。

## 驗證範圍

核心測試覆蓋參數注入、互斥 Mods、四種實際 wire 命令、預覽不送出、明確確認、一次性 token、修改的快照、錯誤 epoch、切換、重連不重送、過期、權限、空房、playing 與寫入失敗。

Electron 測試透過真實 Main／sandboxed preload／renderer 和本機模擬 IRC，操作四種表單、確認核取方塊及取消；檢查固定目標、單次送出、失效 gate、偽造 IPC，以及 900×640 下聊天輸入區保持可見。

尚需真實 Bancho mutation 樣本、操作結果對應與 Windows／Linux／macOS 實機驗收。未使用真實帳號或對真實房間送出變更，本增量不代表 M1／M2 完成。

本機驗證結果：`npm run typecheck`、53 項核心測試，以及包含聊天／憑證／OCLR／背景執行／MP 操作的完整 `npm run test:ui` 均通過。已檢視 900×640 確認畫面（`artifacts/mp-confirm-synthetic.png`）。合成介面證據見 [mp-smoke.json](evidence/mp-smoke.json)。初次測試發現觀測瞬間 stale 狀態及 renderer 更新時序的等待不穩定，測試改為可持續觀測的失效事件及等待明確按鈕狀態後，完整回歸通過。
