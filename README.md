# OCLR-ref-tools

專注於 osu! Chinese League Rookie（OCLR）賽事的裁判用 IRC 桌面客戶端，規劃使用 Electron，支援 Windows、macOS 與 Linux。

已有 0.3.0 IRC 登入、多 MP 房間分頁、聊天與唯讀查詢版本，使用免費 HeroUI（無 Pro）。完整 MVP、OCLR API 與三平台驗收尚未完成。

## 啟動初版

需要 Node 24+：

```sh
npm ci
npm run build
npm start
```

以 osu! **IRC 專用密碼**登入後，可加入 MP 房間、傳送一般聊天、讀取設定及裁判名單。初版不提供比賽變更指令；訊息僅保留於本次連線，OCLR 登入尚未開放。macOS arm64 App 可用 `npm run package:mac` 建立，詳見 [初版使用說明](docs/initial-preview.md)、[0.2.0 聊天功能](docs/m1/chat-workspace.md)與 [0.3.0 多房間功能及驗證](docs/m1/multi-room-workspace.md)。

## 設計文件

| 文件 | 內容 |
| --- | --- |
| [網站裁判面板整合設計](docs/referee-panel-integration.md) | #312–#317、三階段工作區、讀寫 API／scope、命令執行與分期 |
| [專案設計](docs/project-design.md) | 產品範圍、參考專案、功能清單、Electron 架構、登入與操作流程 |
| [MVP 開發任務](docs/mvp-plan.md) | 工作拆分、依賴、交付物、驗收案例與版本完成條件 |
| [OCLR 桌面授權契約](docs/contracts/desktop-authorization.md) | 系統瀏覽器登入、一次性 code、S256 證明、桌面 session 與撤銷 |
| [裁判 context API 契約](docs/contracts/referee-context-api.md) | 本人指派場次、原子資料快照、規則與權限、版本及錯誤處理 |
| [設計審查與決策紀錄](docs/design-review.md) | 跨文件修訂紀錄、已確認 D01–D08、本機保存政策及影響任務 |

API 路徑、欄位與預設值屬設計提案；文件會區分已查證的 OCLR 能力與待新增功能。契約文件中的 JSON 範例均為合成資料，不可直接用於真實 IRC 操作。

## 授權

本專案自有程式碼與設計文件採用 [MIT License](LICENSE)，SPDX 識別字為 `MIT`。第三方原始碼、字型、圖片與依賴套件各依其原授權；本專案的 MIT 授權不會重新授權這些素材。

## M0 開發驗證

SPEC-00 已盤點；SPIKE-01 已定位 CRLF-only 導致漏讀 bare-LF 回覆，並於新房完成唯讀核對。SPIKE-01／02 其他缺口仍在，SPEC-01 已更新但未凍結；使用者另授權先交付登入初版。

- [SPEC-00：需求與驗證邊界](docs/m0/spec-00.md)
- [SPIKE 實測結果與證據](docs/m0/spike-results.md)
- [SPEC-01：欄位映射與待補資訊](docs/m0/spec-01.md)
- [隔離實驗執行方式](spikes/m0/README.md)
