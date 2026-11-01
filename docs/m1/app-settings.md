# 應用程式設定與本地化

2026-10-31 使用者指定的桌面增量。設定入口位於左側底部齒輪，使用免費 HeroUI Checkbox、Select 與 Tabs；沒有新增框架。

## 行為

- 「一般」提供「啟動時恢復上次 IRC 登入」，預設關閉。開啟時會加密保存目前已成功登入的 IRC 帳號；若仍在登入，需收到相符的成功回覆後才保存。後續成功登入也會安全保存，無須每次另外勾選表單的保存選項。
- 只有開啟選項、憑證可解密且上次成功登入未手動登出時，Main 冷啟動才登入一次。正常退出保留恢復資格；明確登出、忘記憑證、停用選項、解密失敗或終止登入錯誤會取消資格。取消後的晚到解密／保存結果不能復活連線，手動登入優先。Renderer 重載或再次喚回不觸發第二次登入；不還原舊房間、變更指令或 OCLR 授權／投影。
- 安全儲存不可用時不啟用保存、不回退明文。Linux 沿用既有 provider 尚未驗收的停用邊界；若從其他平台帶入已開啟的偏好，本次仍須手動登入，且可取消選項。關閉恢復不會刪除獨立的已保存憑證，刪除使用原本「忘記已保存登入」。
- 「一般」提供「關閉視窗後在背景執行」。預設開啟以延續原本關窗保留連線的行為；取消後關閉視窗會經過完整退出流程並清理本次 IRC／OCLR session。開啟時仍使用原生系統匣／Dock，Linux 保留工作列最小化入口。
- 移除側欄的轉入背景／退出按鈕及系統匣自訂退出項目。作業系統原生結束操作仍可用，不攔截確認後的關機／登出。
- 語言提供 `system`、`zh-Hans`、`zh-Hant`、`en`，預設跟隨系統。依系統偏好語言順序選第一個支援的語言；中文按 script／region 判斷繁簡，其他未支援語言退回英文。啟動與視窗回到前景時重新讀取系統語言；手動選擇優先。
- 切換立即更新介面、HTML lang、應用程式狀態／錯誤、時間格式、系統匣入口與日誌匯出標題。由 i18next 處理靜態詞庫及插值，不重載 renderer，不重連或重送 IRC。
- 聊天原文、非系統訊息 sender、玩家／隊伍／場次／圖池自訂名稱、譜面 metadata、表單技術值與 IRC 指令保持原樣。常用訊息模板的標籤會翻譯，插入的既有聊天模板原文不改動。
- 「關於」提供 OCLR IRC 名稱、實際套件版本、平台、MIT 授權與第三方聲明入口。Main 只開啟固定 repository／LICENSE／THIRD_PARTY_NOTICES 連結，不接受任意 URL。

## 保存與架構

Main 使用有版本且限制大小的 `preferences.json`，schema 2 僅保存背景開關、語言、啟動恢復開關與是否仍可恢復登入的布林狀態，不包含帳號名稱或密碼。舊 schema 1 保留背景／語言並將新選項設為關閉，不能把歷史已保存憑證視為自動登入同意。寫入先驗證完整有限結構，再暫存並 rename；失敗不發佈新設定。損毀／未知 schema 退回預設，不碰其他恢復記錄。Preload 只提供型別化 snapshot、update、事件訂閱及固定關於連結；所有 IPC 驗證可信 sender／frame。

密碼只存在 Main 目前 session 或既有系統加密憑證檔，Main 在成功登入後才將恢復資格標為有效；安全保存失敗不影響目前 IRC 連線，會提示下次手動登入。手動取消先持久化資格失效，再中止目前 session；若資格檔無法寫入，嘗試刪除加密憑證並顯示本機權限錯誤。自動登入沿用原本有界的網路重連，錯誤密碼／毀損憑證不循環觸發冷啟動恢復。

`src/shared/locales/messages.ts` 保存應用程式自有文字的繁中來源、簡中及英文詞庫；新增或修改文字需同步三種語言與插值。OpenCC 只用於開發時產生靜態簡中草稿，沒有執行期轉換器或遠端翻譯服務。`tests/localization.test.ts` 檢查完整性、插值、動態狀態與外部內容邊界。

## 合成驗證

- 核心：偏好重讀、損毀／超大／無效資料、儲存失敗、系統語言與中文 script／region、詞庫完整性與插值。
- `login-restore-smoke.cjs`：真實獨立程序共用合成加密資料，驗證目前登入啟用、登入途中啟用、退出後冷啟動、renderer reload 不重複登入、明確登出後下一程序不登入、取消／忘記／手動登入隔離晚到解密、錯誤密碼、毀損憑證與 provider 不可用。900×640 設定可操作，snapshot／偏好不含密碼，不送房間指令。Windows／macOS 執行 11 個階段；Linux 執行停用入口及帶入舊偏好但無 provider 的兩個階段，不冒稱 Linux 自動保存通過。
- `background-smoke.cjs`：勾選時關窗仍維持 IRC 心跳、喚回單一視窗；取消後關窗完整退出及清理。
- `settings-smoke.cjs`：實際 HeroUI 四種語言選擇、跟隨系統於回到前景更新、關於固定連結、IPC 拒絕無效輸入／來源、900×640、字面聊天／身份／譜面及草稿保留、切換不送 IRC 命令、renderer reload 與下一個原生程序重讀偏好。
- 完整桌面回歸含原本七組及兩階段設定測試。2026-10-31 本機 typecheck、161 項核心、完整九階段桌面回歸與執行階段 audit（0 漏洞）通過，見 [合成紀錄](evidence/settings-smoke.json)；三平台結果仍以對應提交 CI 為準。

實機系統語言變更、IME、讀屏軟體、Linux 各桌面系統匣可見性與 OS 登出／關機仍需實機驗收；合成偏好測試不解除既有 gate。

## 參考

[i18next 設定](https://www.i18next.com/overview/configuration-options)、[React i18next](https://react.i18next.com/latest/usetranslation-hook)、[Electron 系統語言](https://www.electronjs.org/docs/latest/api/app#appgetpreferredsystemlanguages)、[視窗關閉事件](https://www.electronjs.org/docs/latest/api/browser-window#event-close)。
