# OCLR-ref-tools 開發指引

本文件適用於整個 repository，供後續開發代理使用。使用者當次明確指示優先；先核對程式與文件現況，不把歷史規劃或測試樣本當成已上線能力。

## 專案方向

- OCLR 賽事裁判用 Electron 桌面 IRC 客戶端，維持 Windows、macOS、Linux 一致的操作體驗。
- 桌面本機核心保留 TypeScript／Node.js；已取消 Go 遷移，不自行更換為 Go 或 Rust。
- UI 使用 React 與免費 HeroUI，不引入 HeroUI Pro。優先重用既有元件與合適的 JS 套件，避免重造現有功能；新增依賴需檢查授權、維護情況與 Electron 相容性，更新 lockfile。
- 自有程式碼及文件採 MIT；保留第三方授權與 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- 對使用者與產品介面預設使用繁體中文。說明應區分已實作、合成驗證、真實服務驗證與尚待驗收。

## 先讀哪些文件

- [README.md](README.md)：現有功能、啟動與下載方式。
- [專案設計](docs/project-design.md)、[決策紀錄](docs/design-review.md)：架構、D01–D08 與產品邊界。
- [桌面端剩餘工作](docs/desktop-backlog.md)：現況差距、設計依賴與 GitHub issues。
- [MVP 任務](docs/mvp-plan.md)：依賴、partial 狀態、里程碑驗收。
- 涉及特定功能時，再讀 `docs/m1/` 對應文件；早期實驗與證據保留於 `docs/m0/`、`spikes/m0/`，不能當成目前正式實作。
- OCLR 接入先讀 [PR409 桌面契約](docs/contracts/pr409-desktop-read.md)；完整 [授權契約](docs/contracts/desktop-authorization.md) 與 [context API](docs/contracts/referee-context-api.md) 包含尚未完成的後端及執行設計。

## 程式分工

| 位置 | 職責 |
| --- | --- |
| `src/main/` | IRC transport／session、狀態解析、操作驗證、OCLR 授權與 HTTP、本機憑證、視窗生命週期 |
| `src/preload/` | 有限且具型別的 IPC bridge |
| `src/shared/` | 共用型別、資料契約、純函式命令生成 |
| `src/renderer/` | React／HeroUI 介面；登入密碼僅短暫用於表單提交，不保存核心 session、socket 或 OAuth token |
| `tests/` | Node 核心與契約測試、合成 fixtures |
| `scripts/` | Electron smoke、契約匯出、打包與發布驗證 |
| `.github/` | 三平台 CI、macOS 簽章公證與 Release 流程 |
| `docs/` | 設計、任務、功能說明與可去密的驗證證據 |

- 核心連線與狀態留在 Main；renderer reload、切頁與關窗進入背景不應終止 session。
- 保持 context isolation、renderer sandbox、CSP 及可信 IPC sender／origin 檢查。不得提供任意 socket、shell、檔案、URL 或原始 IRC 代理。
- IPC 輸入在 Main 重新驗證，不依賴 UI disabled 狀態、TypeScript 型別或 renderer 提供的命令文字作為安全邊界。
- 沿用現有程式風格，避免無關重構。不要手改 `out/` 等建置產物。

## IRC 與房內操作

- 保留 CRLF／bare LF、分段資料、UTF-8 長度、心跳及全連線節流處理。
- MP ID、`#mp_<id>` 與 settings History 必須相符。IRC NAMES 不代表玩家槽位、到場或裁判資格；listrefs 需限定在對應查詢與可信來源。
- 不將 unknown／partial／stale 轉成已確認。玩家槽位來自 settings 快照，固定 16 個顯示位置不代表開放容量。
- 一般聊天不能成為任意命令入口。房內變更使用結構化 intent，由 Main 固定目標與生成命令。
- 手動快捷操作目前包含 map、mods、立即 start、abort。遵守 [快捷操作邊界](docs/m1/manual-mp-controls.md)：房間 epoch、近期設定與裁判資格、一次性預覽、目標及影響確認、互斥 Mods 檢查。
- 保留開始前的人工核對；不得把未知比賽階段、個人 Mods、陣容或直播政策宣稱為自動驗證完成。
- 送出 echo／socket write 不等於 Bancho 已執行。未知結果保持 unknown／未確認，不自動重送變更指令，不在重連後重放聊天或操作。
- 開房保留送前最小持久化防重送記錄及未知結果鎖定，詳見 [開房流程](docs/m1/create-match-room.md)。離開分頁是 PART，不是 `!mp close`。
- 開發測試預設用本機模擬 IRC；只有使用者明確指定真實帳號、房間與操作範圍時才進行真實操作。歷史唯讀授權不能延伸為 start／abort／close 等變更授權。

## OCLR 接入與私人資料

- 目前範圍是桌面端；OCLR-website API 由另一邊開發。除非另有明確要求，不修改網站 repository、部署網站或擴大後端工作。
- 桌面 OCLR 授權與 IRC 登入是兩個獨立 session。保留系統瀏覽器、PKCE、loopback state 驗證、Main 記憶體 token、single-flight refresh 與舊回應隔離。
- 不以網站 cookie、mock 登入或放寬 schema 冒充正式 API 已可用；測試替身只從測試端注入，不新增生產環境任意 API host 開關。
- PR409 panel 是唯讀投影與命令預覽／複製，不能替代完整 context、allowedIntents、帳號配對、圖池及出賽政策。手動 IRC 快捷操作不代表 OCLR 衍生執行已開放。
- `src/shared/oclr-website/` 為固定來源的共享程式；更新時核對來源版本、相容性與授權，不引入網站 DB／cookie／伺服器依賴。契約變更同步相關 fixtures、測試及 schema 匯出。
- PASS、IRC 密碼、OAuth code／verifier／token、Apple 憑證或私鑰不得進入日誌、截圖、提交或 CI 產物。不要重用聊天歷史中的秘密。
- IRC 日誌預設開啟，安全 provider 可用時加密保存七天；Linux 仍僅記憶體。OCLR context 與本登入曾投影的房間不寫入 IRC-only 日誌，逐場歷史重新驗權未完成前不得放行。另有可選加密 IRC 憑證與最小開房記錄；開房恢復 schema 2 已按 IRC 暱稱雜湊隔離，舊版無歸屬記錄只保留未知結果，不顯示房號或指派給登入者。完整 LOG-01（OCLR 歷史／場次恢復／實機 provider）仍未完成，不得回退明文。

## 視窗與平台行為

- 關窗保留連線；完整退出才清理 session。Linux 保留工作列最小化入口，避免系統匣不可見時無法恢復。
- 保留單實例喚回、休眠恢復及取消系統關機時不提前登出等行為，詳見 [背景執行](docs/m1/background-running.md)。
- UI 改動檢查至少 900×640：聊天輸入區可見、側欄可捲動、長名稱不破版。IME 組字不可誤觸送出或危險操作。

## 開發與驗證

使用 Node.js 24+、npm 與 repository 的 lockfile；工具／依賴確切版本以 `package.json` 為準。

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run test:ui
```

- 核心、IPC、契約或操作變更執行型別檢查及相關核心測試；UI、preload、視窗或生命週期變更另執行完整 Electron smoke。
- `test:ui` 會先 build。測試需要本機 loopback；Electron 需要顯示環境，Linux CI 使用 Xvfb／D-Bus。環境無法執行時如實記錄，不降低驗證條件或把未執行算通過。
- 測試應涵蓋權限、狀態失效、目標隔離、注入、斷線與不重送等實際行為；不要只複製實作邏輯。等待明確狀態，避免依賴瞬間事件或固定延遲判定成功。
- 純文件修改檢查連結與 `git diff --check` 即可，不需無關重跑所有測試。
- 契約匯出：`npm run contracts:oclr`；打包：`npm run package:win`、`npm run package:linux`、`npm run package:mac`。macOS 打包需 macOS。
- 合成證據明示 synthetic；需要保存時放到對應 `docs/`，不要提交私人 session 或整批臨時 `artifacts/`、`release/`。CI 不代替真實 IME、實機系統匣、真實 Bancho 或正式 OCLR 聯調驗收。

## 交付、Git 與 CI

- 開工先檢查 Git 狀態，保留使用者未提交的工作；只提交本次範圍。若需新分支，預設 `codex/` 前綴；不擅自重寫歷史或 force push。
- 依既有交付偏好，完成工作與適當測試後 commit 並 push；使用者當次另有指示時從其指示。最終說明功能、測試結果、仍有的限制與提交識別。
- 功能或契約變更同步 README、相關設計／驗證文件及 MVP 任務狀態。文件不足以證明功能完成，進度必須有實作與證據支持。
- 使用者已授權 milestone 完整驗收通過後自動 tag 並 push；單項功能完成不等於 milestone 完成。有未完成的必要驗收時保持 partial，不為了發布而標記完成。
- 建立版本 tag 前核對 `package.json`、lockfile、介面版本與 [Release CI](docs/release-ci.md)。`v*` tag 會觸發公開 GitHub Pre-release，不把它當作普通進度標籤。
- 三平台建置與簽章設定以 workflows 為準。一般 macOS CI 為 ad-hoc，不能稱為 Developer ID 已簽章／Apple 已公證；正式簽章流程見 [Apple CI](docs/apple-signing-ci.md)。
- 不在功能開發中修改／輸出 GitHub 或 Apple secrets，不把歷史簽章成功套用到新產物。下載與驗證結果需對應確切提交及 workflow run。
