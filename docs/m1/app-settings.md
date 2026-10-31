# 應用程式設定與本地化

2026-10-31 使用者指定的桌面增量。設定入口位於左側底部齒輪，使用免費 HeroUI Checkbox、Select 與 Tabs；沒有新增框架。

## 行為

- 「一般」提供「關閉視窗後在背景執行」。預設開啟以延續原本關窗保留連線的行為；取消後關閉視窗會經過完整退出流程並清理本次 IRC／OCLR session。開啟時仍使用原生系統匣／Dock，Linux 保留工作列最小化入口。
- 移除側欄的轉入背景／退出按鈕及系統匣自訂退出項目。作業系統原生結束操作仍可用，不攔截確認後的關機／登出。
- 語言提供 `system`、`zh-Hans`、`zh-Hant`、`en`，預設跟隨系統。依系統偏好語言順序選第一個支援的語言；中文按 script／region 判斷繁簡，其他未支援語言退回英文。啟動與視窗回到前景時重新讀取系統語言；手動選擇優先。
- 切換立即更新介面、HTML lang、應用程式狀態／錯誤、時間格式、系統匣入口與日誌匯出標題。由 i18next 處理靜態詞庫及插值，不重載 renderer，不重連或重送 IRC。
- 聊天原文、非系統訊息 sender、玩家／隊伍／場次／圖池自訂名稱、譜面 metadata、表單技術值與 IRC 指令保持原樣。常用訊息模板的標籤會翻譯，插入的既有聊天模板原文不改動。
- 「關於」提供 OCLR IRC 名稱、實際套件版本、平台、MIT 授權與第三方聲明入口。Main 只開啟固定 repository／LICENSE／THIRD_PARTY_NOTICES 連結，不接受任意 URL。

## 保存與架構

Main 使用有版本且限制大小的 `preferences.json`，僅保存背景開關及語言。寫入先驗證完整有限結構，再暫存並 rename；失敗不發佈新設定。損毀／舊 schema 退回預設，不碰其他恢復記錄。Preload 只提供型別化 snapshot、update、事件訂閱及固定關於連結；所有 IPC 驗證可信 sender／frame。

`src/shared/locales/messages.ts` 保存應用程式自有文字的繁中來源、簡中及英文詞庫；新增或修改文字需同步三種語言與插值。OpenCC 只用於開發時產生靜態簡中草稿，沒有執行期轉換器或遠端翻譯服務。`tests/localization.test.ts` 檢查完整性、插值、動態狀態與外部內容邊界。

## 合成驗證

- 核心：偏好重讀、損毀／超大／無效資料、儲存失敗、系統語言與中文 script／region、詞庫完整性與插值。
- `background-smoke.cjs`：勾選時關窗仍維持 IRC 心跳、喚回單一視窗；取消後關窗完整退出及清理。
- `settings-smoke.cjs`：實際 HeroUI 四種語言選擇、跟隨系統於回到前景更新、關於固定連結、IPC 拒絕無效輸入／來源、900×640、字面聊天／身份／譜面及草稿保留、切換不送 IRC 命令、renderer reload 與下一個原生程序重讀偏好。
- 完整桌面回歸含原本七組及兩階段設定測試。2026-10-31 本機 typecheck、161 項核心、完整九階段桌面回歸與執行階段 audit（0 漏洞）通過，見 [合成紀錄](evidence/settings-smoke.json)；三平台結果仍以對應提交 CI 為準。

實機系統語言變更、IME、讀屏軟體、Linux 各桌面系統匣可見性與 OS 登出／關機仍需實機驗收；合成偏好測試不解除既有 gate。

## 參考

[i18next 設定](https://www.i18next.com/overview/configuration-options)、[React i18next](https://react.i18next.com/latest/usetranslation-hook)、[Electron 系統語言](https://www.electronjs.org/docs/latest/api/app#appgetpreferredsystemlanguages)、[視窗關閉事件](https://www.electronjs.org/docs/latest/api/browser-window#event-close)。
