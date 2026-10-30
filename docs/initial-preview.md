# 0.1.0 初版：IRC 登入與唯讀房間

> 本文件保留 0.1.0 歷史交付範圍；現行 0.4.0 的重連及可選憑證保存以 [最新說明](m1/recovery-and-sync.md) 為準。目前 0.2.0 已加入一般聊天、虛擬列表及連結，記憶體上限調為 1,000 則，詳見 [M1 更新](m1/chat-workspace.md)。啟動指令不變。

- 日期：2026-10-27（Asia/Taipei）；狀態：macOS arm64 本機初版，非完整 MVP。
- 使用者在 SPIKE-01 排查途中明確追加「完成可登錄的界面」，並確認免費 HeroUI、不引入 Pro；此範圍是 M0 未全部通過前的分段交付。
- 元件：React 19.3.1、免費 `@heroui/react`／`@heroui/styles` 3.2.6（MIT）、Tailwind CSS 4.3.3；沒有 `@heroui-pro/*`。

## 使用方式

需要 Node 24+；從 repository 根目錄執行：

```sh
npm ci
npm run build
npm start
```

開發模式：`npm run dev`。為維持 `script-src 'self'`，React HMR 暫停用；修改 renderer 後可重新載入視窗。macOS arm64 測試 App 以 `npm run package:mac` 產生於 `release/OCLR IRC-darwin-arm64/OCLR IRC.app`。目前沒有 Developer ID／公證或自動更新，不能作為已簽公開發行版。

1. 填入 osu! 使用者名稱與 **IRC 專用密碼**；空格轉底線。密碼送出後清空欄位，不保存。
2. 只有收到屬於目前帳號的 IRC `001` 才顯示連線成功。等待時可以取消；錯密碼／網路錯誤顯示原因，不自動重試登入。
3. 貼入 MP 編號或 `https://osu.ppy.sh/mp/…`／`community/matches/…` 連結，加入房間。
4. 點「讀取設定」，以回覆 History 核對 MP ID；再點「裁判名單」，核對當前帳號列名。加入頻道本身不等於有權限。
5. 左下方可登出；清除連線、當次訊息與身分，不重播操作。

初版不提供任意訊息／指令輸入，也沒有 make、start、abort、close 或其他比賽變更。UI 只顯示已觀察欄位，無地圖／Mods 回覆時不假定已有完整房間快照。

## 介面及實作範圍

視覺基線：深色平面、單一紫色重點色，左側導覽與中央工作區；帳號頁以表單為主、右側說明連線資訊。訊息列表使用時間戳／sender／內容的緊湊列，不採付費聊天模板。按鈕 hover、連線等待與頁面切換提供短暫回饋，尊重 reduced-motion。

| 模組 | 本次交付 | 尚未完成 |
| --- | --- | --- |
| DESK-01 | Electron Main／sandboxed Preload／React renderer、有限 IPC、固定外部設定頁、CSP、三欄唯讀工作區 | 三平台實機、通知／快捷鍵／IME 全矩陣 |
| IRC-01／02 | 固定 Bancho host、TCP、混合 CRLF／LF、UTF-8 緩衝、PING／PONG、001 登入、逾時／取消／登出／generation、密碼記憶體使用 | 自動退避重連、記住密碼／OS 安全保存 |
| IRC-03／STATE-01 | 單一房間訊息、設定的 History／模式／玩家數、分行 listrefs、錯誤房間提示 | 多頻道／私訊／補完、完整房間 reducer／snapshot、所有指令權限 |
| LOG-01 | 當次記憶體訊息最多 200 則、敏感指令遮蔽 | 預設加密本機保存、7 天清除、匯出、恢復記錄；D06 仍是 MVP 要求，未宣稱完成 |
| OCLR／操作核心 | 明示 OCLR 尚未開放；無變更入口 | OAuth、context、操作佇列／正式賽事功能全部待後續 |

登入密碼必須短暫經表單與有限 IPC 送往 Main，不進入回傳 snapshot 或訊息列；Main 送出 PASS 後清除憑證引用。未宣稱 JavaScript 字串能保證底層記憶體抹除。所有 IRC 訊息以 React 文字節點顯示，拒絕 CR／LF／NUL 注入；原始網路封包不寫日誌。socket／網路／檔案能力不交 renderer，IPC 驗證主視窗／主 frame／來源。

## 驗證與可重跑證據

```sh
npm run typecheck
npm test
npm run test:ui
python3 -B -m unittest discover -s spikes/m0 -p 'test_*.py'
npm --prefix spikes/m0 test
```

- Node 產品測試：7 項，包含混合行尾、輸入注入／主機限制、登入／錯密碼、settings／listrefs、假 bot、403 及取消後晚到回覆。
- Electron UI smoke：真實 Main／Preload／renderer，以程序內的本機假 IRC 取代 transport，完成填表登入、加入、讀設定、裁判核對、登出及密碼清除。沒有 product IPC 測試後門，也不使用真實帳號。[結果](m0/evidence/ui-smoke.json)
- M0 Node 5 項及 Python 6 項回歸：涵蓋 LF 漏讀重現、分段與去密。
- 真實 Bancho 的新房 122076210 已由獨立唯讀 probe 驗證 settings／listrefs，見 [SPIKE-01 報告](m0/spike-results.md)。**不能把 fake-server UI 測試稱為產品 UI 的真實帳號演練**。
- 已檢查本機登入頁及合成工作區截圖；`artifacts/` 保留本機畫面，未提交使用者截圖／真實聊天／憑證。Windows／Linux、跨版本升級與真正中文 IME 尚未驗證。

## 後續界線

M0 仍為 partial；只解除此登入／唯讀初版所需的有限工作，不表示 AUTH／CTX／變更佇列可以略過原有 gate。下一步補三平台驗證、完整 transport／state 及 LOG-01，再開放更完整功能。任何真實房間變更需符合使用者授權與已確認設計。
