# OCLR-IRC

osu! Chinese League Rookie（OCLR）賽事的裁判用 IRC 桌面客戶端，以 Electron、React 與 TypeScript 開發，使用免費 HeroUI，支援 Windows、macOS 與 Linux。

目前為開發預覽版。IRC 工作區已可使用；OCLR 桌面授權及本機 IRC → 網站投影／命令轉送已接入，正式 OAuth 與 Bancho 房間仍需本人聯調。完整 MVP 與三平台實機驗收尚未完成。

套件與下載產物目前仍沿用 `oclr-ref-tools`／`OCLR-ref-tools` 名稱。

## 已有功能

- **IRC 登入與聊天**：使用 osu! IRC 專用密碼登入，支援多房間、一般頻道、私訊與名稱補完；可選擇保存本機加密登入憑證。
- **建立與加入比賽房間**：開房成功後自動加入並讀取設定及裁判名單；逾時或斷線不自動重送開房命令。
- **房間狀態與玩家槽位**：顯示地圖、Mods、比賽模式，以及 1–16 號槽位的玩家、隊伍、房主和準備狀態；資料不完整或過期時明確標示。
- **房內快捷操作**：換圖、Mods、立即開始與中止比賽；先核對設定與裁判權限，再預覽及確認送出，不自動重送。
- **斷線恢復**：恢復連線與房間唯讀查詢，不重送聊天或開房命令。
- **背景執行**：關窗後保留連線，可從系統匣／Dock／工作列恢復；Linux 保留最小化入口，完整退出請選「退出程式」。
- **OCLR 場次接入層**：已實作系統瀏覽器授權、本人場次、三階段面板與命令預覽／複製；可用性取決於網站端是否提供相應 API。
- **網站 IRC 投影與命令轉送**：將目前房間綁定至本人獲派場次，在網站查看房間訊息並送出支援的 MP 指令；本機核對目標、設定與裁判權限後才傳送。

玩家槽位來自 `!mp settings` 觀測快照，可按「讀取設定」更新；16 個顯示位置不代表房間實際開放容量。房內快捷操作屬手動裁判工作流，送出後需核對 BanchoBot 回覆；啟用網站投影後，可接受綁定場次的網站 MP 指令；未啟用時仍是獨立手動工作區。socket 送出不等於 BanchoBot 確認。

## 開始使用

1. 使用 osu! **IRC 專用密碼**登入，建立或加入比賽房間。
2. 讀取房間設定與裁判名單，核對房間、玩家及 Mods，再使用聊天或房內快捷操作。
3. 如需網站整合，在「連接 OCLR」透過系統瀏覽器授權，選擇本人獲派場次，再按「將目前房間投影到網站」。OCLR 授權與 IRC 登入是兩個獨立連線，IRC 使用者名稱須與 OCLR 帳號相符。
4. 在本機停止投影、切換房間或場次、登出或休眠後，命令轉送會停用；同步失敗須重新綁定，不會自動重送指令。

IRC 密碼與連線由本機管理。啟用投影會把綁定房間的訊息及命令狀態傳至網站；未啟用時可獨立使用 IRC 工作區。詳細授權與命令限制見 [網站 IRC 投影](docs/m1/website-irc-relay.md)。

## 下載測試版

前往 [Desktop test builds](https://github.com/OCLR-dev/OCLR-IRC/actions/workflows/test-builds.yml)，選擇所需提交且已成功的執行紀錄，登入 GitHub 後從 **Artifacts** 下載對應平台的 `OCLR-ref-tools-*` 檔案。Artifacts 保留 30 天，過期後需重新打包。

| 平台 | CI 打包架構 |
| --- | --- |
| Windows | x64 |
| Linux | x64 |
| macOS | arm64（Apple Silicon） |

一般 CI 的 macOS 包使用 ad-hoc 簽章，**未經 Apple 公證**。需要 Developer ID 簽章與公證版本時，維護者可手動執行工作流程並啟用 `sign_macos`；下載前應核對該次建置的簽章資訊。設定及驗證方式見 [Apple 簽章 CI](docs/apple-signing-ci.md)。

## 本機開發與執行

需要 Node.js 24+：

```sh
npm ci
npm run dev
```

建立並執行編譯後的版本：

```sh
npm run build
npm start
```

登入使用 osu! **IRC 專用密碼**，不是網站密碼。osu! IRC 目前使用未加密連線。桌面端的聊天與 OCLR 私人資料僅保留於記憶體（啟用網站投影時，綁定房間訊息另會傳至網站）；本機另保存最小開房防重送紀錄，以及使用者選擇保存的加密 IRC 憑證。

常用驗證與打包命令：

```sh
npm run typecheck
npm test
npm run test:ui
```

介面測試需要桌面顯示環境與本機 loopback 連線；Linux CI 使用 Xvfb。各平台打包命令為 `npm run package:win`、`npm run package:linux`、`npm run package:mac`，輸出於 `release/`；macOS 打包需在 macOS 執行。

## 目前限制

- 完整 MVP、正式 OAuth／Bancho 聯調與三平台實機驗收尚未完成；合成測試不代表真實服務驗收。
- 完整加密本機日誌、圖池操作計畫與自動核對仍屬待辦，詳見 [桌面端剩餘工作](docs/desktop-backlog.md)。
- 命令已送出不等於已執行；只有支援且相符的 BanchoBot 回覆可自動確認，其餘結果仍須人工核對。未知結果不自動重送。

## 發布流程

推送與 `package.json` 版本相符的 `v*` tag，會觸發三平台測試、打包與校驗，通過後發布 GitHub Pre-release。發布要求 macOS Developer ID 簽章與 Apple 公證；也可手動執行不發布的 dry-run。詳見 [Release CI](docs/release-ci.md)。

## 文件

| 文件 | 內容 |
| --- | --- |
| [專案設計](docs/project-design.md) | 產品範圍、架構與操作流程 |
| [開發代理指引](AGENTS.md) | 架構邊界、測試與交付規則 |
| [桌面端剩餘工作](docs/desktop-backlog.md) | 缺口設計、依賴、驗收與 GitHub issues |
| [MVP 開發任務](docs/mvp-plan.md) | 任務依賴、進度與尚未完成的驗收條件 |
| [設計決策紀錄](docs/design-review.md) | 已確認決策與設計審查 |
| [建立比賽房間](docs/m1/create-match-room.md) | 開房操作、防重送與限制 |
| [重連與同步](docs/m1/recovery-and-sync.md) | 房間恢復、狀態觀測與過期處理 |
| [玩家槽位](docs/m1/player-slots.md) | 槽位顯示與驗證範圍 |
| [房內快捷操作](docs/m1/manual-mp-controls.md) | 換圖、Mods、開始／中止與確認流程 |
| [背景執行](docs/m1/background-running.md) | 平台差異、退出與生命週期 |
| [網站 IRC 投影](docs/m1/website-irc-relay.md) | 本機測試、授權、投影及命令確認限制 |
| [OCLR 桌面接入](docs/m1/oclr-read-integration.md) | 已實作的唯讀接入與待聯調項目 |
| [PR409 接入契約與 JSON Schema](docs/contracts/pr409-desktop-read.md) | 提供網站端實作的桌面 API 契約 |
| [網站裁判面板整合設計](docs/referee-panel-integration.md) | 三階段工作區與後續整合規劃 |
| [桌面授權契約](docs/contracts/desktop-authorization.md)／[裁判 context API](docs/contracts/referee-context-api.md) | 完整授權與裁判操作契約設計 |

契約文件中的提案不代表網站已提供對應 API；JSON 範例為合成資料。早期驗證與歷史版本紀錄保留於 `docs/m0/`、`docs/m1/`。

## 授權

本專案自有程式碼與設計文件採用 [MIT License](LICENSE)。第三方程式碼與依賴依各自授權，詳見 [第三方聲明](THIRD_PARTY_NOTICES.md)。
