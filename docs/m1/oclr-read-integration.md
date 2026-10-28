# 0.6.0 OCLR 裁判面板只讀接入

2026-10-28，依使用者要求聯動 [網站 PR #409](https://github.com/OCLR-dev/OCLR-website/pull/409)，並明確限定**只做桌面端，網站 API 由另一邊開發**。網站 PR 當時仍為 draft、IRC mock，桌面不依賴其模擬傳送器。

## 使用方式

在左側選「OCLR 場次」，按「透過瀏覽器登入 OCLR」。網站端提供桌面授權後，可在系統瀏覽器確認帳號、只讀權限與比對碼，回到 App 選擇本人指派場次。

- 賽前：保存房名、規則、房間人數、設定中的直播員、正式名單及指令預覽。
- BP：保存圖池、獨立先 Ban／先 Pick、選圖與 Mods／計時／控制指令預覽；點圖不記錄選禁。
- 賽後：保存執裁事件的暫記比分、attempt 與重賽歷史，開啟網站既有 MP review。
- 複製只代表系統剪貼簿成功；不送 IRC、不保存 Ban／Pick、不匯入／提交賽果。讀取網站面板與原有手動 IRC 房間分開。

**正式網站授權與 API 尚未提供／聯合驗收。** 若端點回 HTML、未知版本或缺契約標記，畫面會明示接入不可用；既有 IRC 功能仍可用。不提供可誤認成正式資料的內建 mock 登入或任意 token 輸入框。

## 實作

Main-only OCLR session、固定 HTTPS origin、S256／一次性 loopback、token 記憶體管理、single-flight refresh、GET 有界重試、分頁、輪詢、stale／清除、有限 IPC 與 Main 剪貼簿複製。沒有 cookie／Developer fallback 或遠端 iframe。

從 PR head `1abbab1ddd981025249af727d748e70e23b9096b` 固定重用 MIT 的命令 builder、事件 projection 與 scoring schema；新增 Zod 4.6.7。Renderer 僅使用型別及簡單空狀態，不載入驗證器／網站規則模組。原始碼與授權見 [pinned modules](../../src/shared/oclr-website/README.md)。

網站須實作的 wire shape、scope 與 header 見 [PR409 交接契約](../contracts/pr409-desktop-read.md)與 [JSON Schema](../contracts/oclr-desktop-read.schema.json)。panel 是只讀 workspace wrapper，不是完整操作 context。0.6.0 尚未實作 OCLR／IRC UID 配對、OCLR 衍生執行、遠端 mutation 或 D06 加密日誌。

## 驗證狀態

macOS arm64 已通過 `npm run contracts:oclr`、`npm run typecheck`、49 項 `npm test`、完整 `npm run test:ui` 與 `npm audit --omit=dev`（0 漏洞）。[合成 OCLR UI 證據](evidence/oclr-smoke.json)時間為 2026-10-28T14:19:41Z；三平台 CI 另依實際 run 記錄，不把本機測試視為其他 OS 已過。

提交 `82a3c88` 的 [CI 40705413035](https://github.com/OCLR-dev/OCLR-ref-tools/actions/runs/40705413035) 已通過 Windows x64、Linux x64、macOS arm64 的核心測試、Electron UI 及原生打包；[CI 證據](evidence/oclr-read-ci.json)。這是合成 API 驗證，不替代真實網站聯調或實機 IME。本次一般 push 的 macOS 為 ad-hoc 簽章，Developer ID／公證 job 未執行；沒有發布 Release 或 milestone tag。

合成測試將真實 Electron Main／Preload／Renderer、真實本機 HTTP callback，與假 HTTPS API／瀏覽器同意／IRC 分開。沒有使用真實帳號、建立正式授權交易、讀取私人場次或變更真實比賽。

測試涵蓋 callback 來源／重放／取消、PKCE、token 不進 Renderer、refresh 競態及不明不重送、不同 viewer／fixture／generation、過期及撤權清理、cursor 有界重開、429、超限／HTML／未知契約、共用 builder、原生三階段介面、複製、900×640、Renderer reload 與獨立 IRC 連線。

真實 OAuth／HTTPS→loopback、網站聯調、三平台實機／中文 IME、正式 metadata 及完整執裁流程均仍需驗收。不因本次候選 adapter 宣稱 M0／M1／M2 或 PANEL-R 全部完成。
