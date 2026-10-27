# M0 隔離實驗

僅供 SPEC-00／SPIKE-01／02 的可重跑證據，不是產品 IRC 客戶端或 OCLR 授權實作。結果與缺口見 [M0 報告](../../docs/m0/spike-results.md)。

## 本機合成驗證

在本目錄執行（需要 Node >=22.12；實測宿主 Node 26.12.0）：

```sh
npm ci
npm test
npm run probe
npm run package:mac
node run-probe.cjs "$PWD/out/OCLR-M0-Spike-darwin-arm64/OCLR-M0-Spike.app/Contents/MacOS/OCLR-M0-Spike"
```

`probe` 在 Electron 內依序執行初次／重啟實驗，父程序於結束後刪除臨時 profile／SQLite。可指定 `OCLR_SPIKE_REPORT=/absolute/path/report.json` 保存去密報告；重啟另寫 `report-restart.json`。不要指定正式資料目錄。`out/`、`node_modules/` 不提交；沒有 production build 或簽章設定。

`node external-browser.cjs` 會在 macOS 系統預設瀏覽器開啟一個本機合成頁面，自動送出合成表單至另一個 loopback listener。沒有連線到 OCLR／osu!，頁面可於測試後關閉。正式 HTTPS、真正 OAuth、CSRF 與錯誤／取消完整流程另驗。

`node connectivity.cjs` 只連接 irc.ppy.sh:6667，無帳號／密碼／IRC 指令；須有網路環境。

## 真實 Bancho 唯讀驗證

必須先有帳號及指定測試房的明確授權；不要使用正式比賽中的房間。指令中的 ID／帳號由操作者填入，不可直接使用合成測試值。

```sh
python3 bancho-readonly.py --username YOUR_OSU_USERNAME --room YOUR_TEST_MP_ID --report /absolute/path/report.json
```

專用 IRC 密碼由 `getpass` 在終端隱藏讀入，不接受命令列密碼、不記錄原始 transcript。程式最多觀察 30 秒，登入成功後 JOIN；有 self JOIN 或 366 才排程唯讀 settings／listrefs，回覆只保留去密白名單及協定形狀。沒有 make、map、mods、start、abort、close 或邀請指令。登入／加入／socket 寫入不代表查詢成功，以 report 的實際 observations 判讀。此程式不具 production parser 的完整可信來源、防洪與身分驗證能力。

## 限制

- 合成 IRC collector 的 512-byte cap 不是驗證過的 Bancho 上限；只測傳輸分段，不提供房間 reducer。
- SQLite 只測少量合成 encrypted BLOB、WAL 與 AAD；尚未實作保存設定、7 天清理、撤權刪除、migration 或產品恢復佇列。
- macOS async safeStorage 的兩程序讀回不等於升版或 Linux 安全 provider 已通過。
- 自動化測試不能替代真實 IME、三平台通知／快捷鍵、安裝包升版或賽事演練。
