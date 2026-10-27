# OCLR-ref-tools

專注於 osu! Chinese League Rookie（OCLR）賽事的裁判用 IRC 桌面客戶端，規劃使用 Electron，支援 Windows、macOS 與 Linux。

目前處於方案設計階段，尚未建立應用程式或實作 API。

## 設計文件

| 文件 | 內容 |
| --- | --- |
| [專案設計](docs/project-design.md) | 產品範圍、參考專案、功能清單、Electron 架構、登入與操作流程 |
| [MVP 開發任務](docs/mvp-plan.md) | 工作拆分、依賴、交付物、驗收案例與版本完成條件 |
| [OCLR 桌面授權契約](docs/contracts/desktop-authorization.md) | 系統瀏覽器登入、一次性 code、S256 證明、桌面 session 與撤銷 |
| [裁判 context API 契約](docs/contracts/referee-context-api.md) | 本人指派場次、原子資料快照、規則與權限、版本及錯誤處理 |
| [設計審查與決策紀錄](docs/design-review.md) | 跨文件修訂紀錄、已確認 D01–D08、本機保存政策及影響任務 |

API 路徑、欄位與預設值屬設計提案；文件會區分已查證的 OCLR 能力與待新增功能。所有 JSON 範例均為合成資料，不可直接用於真實 IRC 操作。

## 授權

本專案自有程式碼與設計文件採用 [MIT License](LICENSE)，SPDX 識別字為 `MIT`。第三方原始碼、字型、圖片與依賴套件各依其原授權；本專案的 MIT 授權不會重新授權這些素材。
