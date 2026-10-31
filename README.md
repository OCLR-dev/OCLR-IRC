# OCLR IRC

**osu! Chinese League Rookie（OCLR）**賽事的裁判用 IRC 桌面客戶端，支援 Windows、macOS 與 Linux。

目前為開發預覽版，完整 MVP 與三平台實機驗收尚未完成。

## 下載

- [GitHub Releases](https://github.com/OCLR-dev/OCLR-IRC/releases)：已發布的預覽版、校驗碼與建置資訊。
- [Desktop test builds](https://github.com/OCLR-dev/OCLR-IRC/actions/workflows/test-builds.yml)：指定提交的測試包；需登入 GitHub，Artifacts 保留 30 天。

提供 Windows x64、Linux x64 與 macOS Apple Silicon arm64。一般 CI 的 macOS 測試包未經 Apple 公證；請以各次下載附帶的簽章與建置資訊為準。

## 主要功能

- **IRC 工作區**：登入、聊天、多房間、一般頻道、私訊與名稱補完。
- **房間與裁判工具**：建立／加入房間、玩家槽位、房間設定、換圖、Mods、計時與開始／中止操作。
- **OCLR 網站整合**：瀏覽器授權、本人獲派場次、網站開房、房間訊息投影與有限指令轉送。
- **[房內場次工具](docs/m1/compact-fixture-tools.md)**：同步本輪圖池與兩隊名單；逐人預覽、核對名稱後發送邀請，送出不代表到場。
- **BP 自動同步**：配合新版網站，接收已保存的 Ban／Pick 通知，逐步換圖及設定 Mods；兩端需更新並重新連接。
- **設定與恢復**：簡體中文、繁體中文、英文或跟隨系統；可選背景執行、加密憑證保存與本機日誌，斷線後不重送操作。

## 開始使用

1. 使用 osu! **IRC 專用密碼**登入，並建立或加入比賽房間；這不是 osu! 網站密碼。
2. 讀取房間設定與裁判名單，核對房間、玩家及 Mods 後操作。
3. 連接 OCLR 網站時，透過瀏覽器授權，選擇本人獲派場次，帳號名稱自動核對相符後按「連接網站 IRC」。授權與 IRC 登入是兩個獨立連線。
4. 也可從網站執裁頁按「開啟 OCLR IRC」帶入場次，或按房間旁的「重新加入房間」切回並加入；需使用新版封裝程式。Linux 解壓後，先執行成品內的 `install-protocol.sh`。

啟用網站連接後可接收網站開房或房內指令。停止投影、切換房間／場次、登出或休眠會停用轉送；同步失敗需重新連接。詳細操作見 [網站 IRC 投影](docs/m1/website-irc-relay.md)。

## 使用須知

- 「已送出」不代表 Bancho 已執行。結果未知或有待核對操作時，先查看房間回覆與「操作記錄」，不要直接重送。
- IRC 使用未加密連線；憑證與連線由本機管理。網站投影會傳送綁定房間的訊息與指令狀態。
- 本機日誌在安全儲存可用時加密保存七天；Linux 仍僅記憶體，儲存失敗不回退明文。網站關聯房間排除一般本機日誌。
- 側欄齒輪可設定語言及背景執行。開啟背景執行時關窗保留連線，取消後關窗即退出。

## 開發與文件

本專案採 Electron、React 與 TypeScript，使用免費 HeroUI。

- [開發指南](docs/development.md)：本機執行、測試、打包與發布。
- [文件索引](docs/README.md)：功能說明、架構、契約及開發進度。
- [已知限制與剩餘工作](docs/desktop-backlog.md)：尚待完成與驗收的項目。

## 授權

自有程式碼採 [MIT License](LICENSE)。第三方依賴與授權見 [第三方聲明](THIRD_PARTY_NOTICES.md)。
