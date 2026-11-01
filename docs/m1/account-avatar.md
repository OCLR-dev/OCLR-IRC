# 帳號頭像

成功登入 IRC 後，帳號頁使用免費 HeroUI Avatar 顯示 osu! 頭像。IRC 暱稱中的底線視為空格，大小寫不敏感；全數字暱稱仍按名稱查詢。沒有圖片、下載失敗或圖片無效時顯示原本的名字首字母，尺寸固定，不影響版面。

Main 只讀取 `https://osu.ppy.sh/users/<encoded-name>?key=username` 的公開個人頁，核對頁內目前名稱後，下載相同 user ID 的 `https://a.ppy.sh/<id>` 頭像。依據官方 [個人頁資料格式](https://github.com/ppy/osu-web/blob/master/resources/views/users/show.blade.php) 與 [User.avatar_url](https://osu.ppy.sh/docs/#user)，沒有新增 osu! OAuth／API key，也不傳送 IRC 密碼、OCLR token 或網站 cookie。公開頁格式改變／限制存取時回退快取或字母；這個查詢不提供 UID 身分證明，不改變 IRC／OCLR 帳號配對及操作 gate。

下載在 Main 進行，只允許一次同站 `/users/<numeric-id>` 的個人頁正規轉址，其他轉址拒絕，單次請求最多 8 秒／2 MiB。只接受 PNG、JPEG、GIF、WebP 點陣圖；原生解碼失敗、尺寸超過 2048×2048 或過大結果不使用。轉為最長邊 128 像素的靜態 PNG，GIF 使用靜態影格。renderer 透過限定且驗證 sender 的 snapshot／事件接收圖片 data URL，沒有任意 URL 或檔案介面，CSP 保持不變。頭像使用獨立事件，聊天快照不重複攜帶圖片。

快取在 Electron `userData/avatar-cache`，以正規化暱稱雜湊命名，只含 PNG、格式版本及抓取時間。每張 PNG 最多 256 KiB，最多 20 份；有快取先顯示，未滿 24 小時不發請求。登入或重連後，超過 24 小時才嘗試更新，失敗時可沿用最多 30 天內的有效快取。成功寫入時移除超量及過舊檔案；磁碟失敗仍能在本次登入顯示下載的圖片。公開頭像可跨重啟重用，不包含完整個人頁、登入秘密或私人 OCLR 資料。

登出、失去連線或切帳號即清掉目前顯示並取消下載；登入世代與帳號檢查隔離晚到回覆。磁碟中的公開圖片快取保留，供下次登入使用。

驗證：`tests/avatar-cache.test.ts` 覆蓋來源／名稱、快取重啟、離線與過期、毀損／超量／錯誤格式、儲存失敗與登入世代；完整 Electron smoke 另驗證原生圖片處理、HeroUI 顯示、900×640、離線快取重用、跨帳號字母回退及 IPC sender。測試資料與 HTTP／IRC 均為 synthetic，不操作真實登入帳號。

2026-11-01：Node 24 型別檢查及 212 項核心測試通過；完整 Electron 與三平台驗證見 [PR #79](https://github.com/OCLR-dev/OCLR-IRC/pull/79) 的對應提交／CI 紀錄。另以無登入的 Electron 原生唯讀檢查確認 Lapis 暱稱頁經同站正規轉址後，提供相符名稱／avatar_url，對應頭像回傳 HTTP 200 JPEG；實際轉為 128×128 PNG（30,489 bytes）、寫入隔離暫存快取並離線重建快取實例讀取通過。未操作真實 IRC 登入；不等於房間操作驗收。提示框的合成鍵盤測試等待按鈕啟用及視窗取得焦點，再發送 Tab 並聚焦，避免依賴測試當時的忙碌或滑鼠／鍵盤焦點模式。
