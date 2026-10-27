# M1 Windows／Linux 實機驗收

2026-10-28：使用者確認兩平台可測，並由使用者操作回報。尚未收到 OS／架構／IME 資訊或實測結果，不能記為通過。基線為 0.4.0；每次回報附 `git rev-parse HEAD`，不要只填版本號。

## 準備與打包

各自在 Windows／Linux 的本機圖形桌面操作，使用 Node 24+、npm、Git。Linux 請以一般使用者執行，不以 root 或 `--no-sandbox` 規避 Electron sandbox。架構由當地 Node 的 `process.arch` 決定，先確認與預期一致。以下為原生平台打包指令，尚未在該平台實測，不宣稱已產生可下載安裝包。

```sh
git clone https://github.com/OCLR-dev/OCLR-ref-tools.git
cd OCLR-ref-tools
git rev-parse HEAD
node --version
node -p "process.platform + ' / ' + process.arch"
npm ci
npm run typecheck
npm test
npm run test:ui
```

已有 clone 則在乾淨工作目錄 `git pull --ff-only`。執行失敗請先回報階段與錯誤，不需要清除個人設定或關閉安全機制。

Windows 接著執行：

```sh
npm run package:win
```

開啟 `release/OCLR-ref-tools-win32-<arch>/OCLR-ref-tools.exe`。

Linux 接著執行：

```sh
npm run package:linux
```

開啟 `release/OCLR-ref-tools-linux-<arch>/OCLR-ref-tools`。這是未簽章的內部測試目錄，不是安裝器；保留整個目錄。若系統阻擋啟動，記錄提示回報，不要求停用系統保護。

`test:ui` 使用本機合成 IRC／加密 adapter，不使用真實憑證；產生 `artifacts/ui-smoke-recovery.json`，Windows 另有 `artifacts/credential-smoke.json`。Linux 的憑證 smoke 僅檢查保存停用，不宣稱保存生命週期通過。請分平台回傳結果，避免覆寫既有 macOS 證據。

## 實機操作清單

真實 IRC 密碼只在本機 App 輸入。使用當下仍開放、允許測試的房間，不沿用過去的 MP 編號。房間僅執行 settings／listrefs；一般聊天／私訊的對象與測試文字須由操作者確認允許。此清單不要求 make／map／mods／start／abort／close。

| ID | 操作 | 預期 |
| --- | --- | --- |
| P01 | 啟動打包 App、縮到 900×640，測試系統常用縮放 | 登入／房間介面可用，輸入框與頁尾可見；無裁切或遮擋 |
| P02 | 登入後加入允許的 MP，查詢設定與裁判名單 | 001 後顯示連線；History 對應 MP；缺地圖／Mods 顯示 partial，缺裁判證據維持 unknown |
| P03 | 使用真實中文 IME 組字、選字、Enter 確認，測試 Tab | 組字／選字不送出訊息；完成組字後才可明確傳送；非組字時 Tab 可補完暱稱 |
| P04 | 在允許對象傳送一則一般文字、切換兩個對話，接收提及與私訊 | 路由與未讀正確；背景私訊不搶選擇；無 HTML 執行；BanchoBot 私訊不能傳送 |
| P05 | 暫時中斷本機網路並恢復 | 失聯偵測可能需要心跳時間；顯示重連，恢復 JOIN／settings／listrefs；原聊天不重送，舊身分／資料不沿用 |
| P06 | 實際系統睡眠後喚醒 | 暫停後恢復連線並重新核對；沒有操作重送。記錄睡眠方式與時長 |
| P07 | 連線中重新載入視窗（若可用） | Main 連線與分頁保留，不重送登入；無法觸發則填未測 |
| P08 | Windows 勾選記住登入，成功後關閉 App／重新開啟，用已保存登入；再忘記 | 系統安全保存可用才允許；重啟可登入；忘記後不可再使用已保存帳號；不要回傳憑證檔 |
| P09 | Linux 檢查保存選項、一般登入及重連 | 本版本保存停用、原因可見，仍可用記憶體登入／重連；這不算 Linux 金鑰鏈通過 |
| P10 | 登出或停止重連後等待，再關閉／開啟 App | 不在背景重新登入；當次聊天記錄清除；已選保存與忘記的行為分開核對 |

真實地圖／Mods／slot 的完整快照需另有合法測試房樣本。若現有房沒有這些欄位，填「未測」，不可為了取得樣本而自行變更賽事。跨版本升級與 Linux provider 仍為獨立待驗收項。

## 回報模板（每個平台一份）

```text
平台與完整 OS 版本：
CPU 架構／node process.arch：
Linux 桌面環境與 X11／Wayland（Windows 填不適用）：
中文輸入法名稱／版本：
系統縮放比例：
Git commit／App 版本：
Node／npm 版本：
typecheck／npm test／test:ui／package：通過、失敗或未測
P01～P10：逐項通過、失敗、未測或不適用；附理由
失敗操作、預期、實際結果：
可重現頻率：
```

可回傳合成 smoke JSON 與去密錯誤文字。真實聊天室截圖／樣本先去識別，不提供 IRC 密碼、token、憑證檔或完整私人聊天。收到回報後再逐項更新 [M1 驗收紀錄](recovery-and-sync.md)，全部必要驗收通過才建立 milestone tag。
