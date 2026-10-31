# 文件索引

產品介紹、下載與快速使用見 [專案 README](../README.md)。

## 開發與進度

| 文件 | 內容 |
| --- | --- |
| [開發指南](development.md) | 本機啟動、測試、打包與發布入口 |
| [持續開發紀錄](m1/issue-progress-2026-10-31.md) | 修正、驗證與待驗收條件 |
| [README 開發紀錄存檔](development-history.md) | 從原 README 移出的開發與修復筆記 |
| [測試版建置](m1/ci-test-builds.md) | CI 產物、下載及驗證方式 |
| [Release CI](release-ci.md) | 發布流程與保護 |
| [Apple 簽章 CI](apple-signing-ci.md) | macOS 簽章、公證與證據 |

## 功能、架構與契約

| 文件 | 內容 |
| --- | --- |
| [專案設計](project-design.md) | 產品範圍、架構與操作流程 |
| [開發代理指引](../AGENTS.md) | 架構邊界、測試與交付規則 |
| [桌面端剩餘工作](desktop-backlog.md) | 缺口設計、依賴、驗收與 GitHub issues |
| [MVP 開發任務](mvp-plan.md) | 任務依賴、進度與尚未完成的驗收條件 |
| [設計決策紀錄](design-review.md) | 已確認決策與設計審查 |
| [建立比賽房間](m1/create-match-room.md) | 開房操作、防重送與限制 |
| [重連與同步](m1/recovery-and-sync.md) | 房間恢復、狀態觀測與過期處理 |
| [玩家槽位](m1/player-slots.md) | 槽位顯示與驗證範圍 |
| [房內快捷操作](m1/manual-mp-controls.md) | 換圖、Mods、計時／倒數、開始／中止與確認流程 |
| [背景執行](m1/background-running.md) | 平台差異、退出與生命週期 |
| [網站 IRC 投影](m1/website-irc-relay.md) | 本機測試、授權、投影及命令確認限制 |
| [OCLR 桌面接入](m1/oclr-read-integration.md) | 已實作的唯讀接入與待聯調項目 |
| [PR409 接入契約與 JSON Schema](contracts/pr409-desktop-read.md) | 提供網站端實作的桌面 API 契約 |
| [網站裁判面板整合設計](referee-panel-integration.md) | 三階段工作區與後續整合規劃 |
| [桌面授權契約](contracts/desktop-authorization.md)／[裁判 context API](contracts/referee-context-api.md) | 完整授權與裁判操作契約設計 |

契約文件中的提案不代表網站已提供對應 API；JSON 範例為合成資料。早期驗證與歷史版本紀錄保留於 `docs/m0/`、`docs/m1/`。

[應用程式設定](m1/app-settings.md) 補充背景執行、介面語言及關於頁的行為。
