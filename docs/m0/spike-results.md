# M0 / SPIKE-01、SPIKE-02 驗證結果

- 日期：2026-10-27；狀態：部分實測完成，M0 出口未通過。
- 環境：[environment.json](evidence/environment.json)。本機 macOS 27.0.1／arm64、Node 26.12.0、npm 11.20.0、Python 3.15.0、Xcode 27.1。
- 隔離實驗：[執行說明](../../spikes/m0/README.md)。沒有產品 App、正式 API、正式資料 migration 或公開發行。

## SPIKE-01：Bancho 與 IRC

| 項目 | 證據分類／結果 | 實際觀察及限制 |
| --- | --- | --- |
| irc.ppy.sh:6667 | live / passed | TCP 連線成功；[報告](evidence/bancho-connectivity.json)的應用層送出量為 0，這一步不代表登入 |
| 指定 MP 122076167 | live public / passed | 公開頁名為 test，觀察時 end_time=null；不保存玩家資料，也不能由此證明 Bancho 權限 |
| 登入 | live / passed | 使用者明確授權的帳號收到 numeric 001；密碼透過 getpass，無原始 transcript |
| 加入房間 | live / partial | 最終觀察到 353／366 含指定 channel；前次亦見 self JOIN。只證明本次 IRC 回覆，不把 NAMES 當完整房間狀態 |
| settings／listrefs | live / inconclusive | 已送出這兩個唯讀指令；最終 30 秒觀察窗口未收到 PRIVMSG，因此沒有設定內容、referee 名單或操作權限證據。不能將 socket 寫入成功當查詢成功 |
| 可信 BanchoBot prefix、設定 grammar | not verified | 無實際 bot 回覆可定案；不能把 probe 的 senderNick 比對當正式可信來源判斷 |
| UTF-8、半行、多行、緩衝界限 | synthetic / passed | 每個 UTF-8 byte 分割位置都測試；[4 項測試輸出](evidence/protocol-tests.txt)。512 bytes 是實驗值，**未證實為 Bancho 上限** |
| 暱稱空格→底線 | source-reviewed | 官方 IRC 文件支持；本次帳號無空格，未實測空格／改名案例 |
| make、map／mods、start／abort、close | not-run | 未獲本次變更操作授權，未送出；亦未邀請或移動任何玩家 |
| #UID、權限錯誤、斷線重連、限流、房名上限 | not-run | 沒有對應真實樣本；不能由官方語法說明推定全部回覆與限制 |

最終去密證據：[bancho-readonly.json](evidence/bancho-readonly.json)。共進行三次短連線：第一次登入但 probe 未辨識到 JOIN，未送查詢；第二次觀察 self JOIN／353／366 並送查詢；第三次加入 1／3 秒查詢排程，仍無 PRIVMSG。沒有強行重送 mutation，也沒有推定無回覆一定是帳號權限或 Bancho 故障。下一輪需核對 IRC channel／MP 對應及 referee 身分，取得設定回覆後才定版解析器。

## SPIKE-02：Electron、授權回呼與保存

| 項目 | 結果 | 證據與限制 |
| --- | --- | --- |
| 版本與鎖檔 | passed | Electron 45.0.0、@electron/packager 20.3.0；`spikes/m0/package-lock.json`。官方穩定版本及 npm metadata 已查核 |
| 宿主 Node 的 callback | passed | 綁 127.0.0.1 隨機埠；錯 state、重複 state、錯 method 拒絕；同 code 只接受一次；S256 公開向量通過 |
| 系統預設瀏覽器 | partial / passed | [報告](evidence/external-browser-macos.json)：本機 HTTP 頁面原生 form POST→303→loopback。未驗正式 OCLR HTTPS 起點、上游 OAuth、CSRF 或其他瀏覽器 |
| Electron Chromium 導覽 | passed | sandbox／contextIsolation、無 nodeIntegration 的隱藏 BrowserWindow 原生 form→303 成功；它不是系統瀏覽器證據，兩者分開記錄 |
| Electron SQLite | passed | 實際 runtime Node 24.22.0、SQLite 3.53.4，`node:sqlite DatabaseSync` 可載入；無額外 native addon rebuild |
| AES-256-GCM + WAL | passed within sample | 密文寫入／讀回、竄改拒絕、不同 AAD 拒絕；DB／WAL／SHM 未含合成明文 marker。未測大量資料、磁碟滿、崩潰一致性或全部 OS 暫存 |
| macOS safeStorage async | passed within environment | 可用、包裝／解包合成資料金鑰成功；同一 App／同一臨時 profile 的下一個 process 可讀回。未驗跨 build 升級、Keychain 拒絕／遺失 |
| macOS arm64 打包 | passed as spike | packager 產生 .app，打包後重跑上述實驗及重啟讀 key 均成功。只有 adhoc/linker-signed、無 TeamIdentifier／公證，不是 D08 公開版或完整安裝升級驗收 |
| Windows／Linux／macOS x64 | not-run | 沒有對應實機驗證；本輪未跨編後冒稱運行成功 |
| Linux secret backend | source-reviewed / unresolved | async 與 sync provider 語意不同，尚不能用 sync backend 名稱證明 async 安全；basic／未知 fallback 不允許私人明文保存 |
| IME、快捷鍵、通知、縮放、休眠 | not-run | 無真實產品 UI／三平台人工操作證據；不以程式合成鍵盤事件替代 |

Runtime 原始摘要（均不含金鑰或聊天）：

- [開發模式](evidence/electron-macos-arm64.json)、[開發模式重啟](evidence/electron-macos-arm64-restart.json)
- [打包模式](evidence/packaged-macos-arm64.json)、[打包模式重啟](evidence/packaged-macos-arm64-restart.json)

實驗期間曾遇到兩個工具問題：官方 Electron 首次下載需數分鐘，下載後實際執行才計入結果；第一版 harness 在關閉最後視窗後過早結束，沒有產出報告，因此不計通過。已加入生命週期保護，並由父程序待子程序退出後清除臨時 profile，重跑結果如上。

## 選型結論與待補資訊

採 Electron 45.0.0＋內建 node:sqlite＋Main 加密後保存作為 **macOS arm64 已驗候選**；同步 SQLite 的大量資料延遲、三平台能力及跨版本資料升級仍須補證據。safeStorage 使用 async 候選介面，Linux 的無安全 provider 行為是明確 gate。

SPEC-01 新增既有欄位映射、Admin 指派限制、未定案隊伍投影及恢復資料清除後的開房不確定狀態，詳見 [SPEC-01](spec-01.md)。需要團隊補充的環境、測試權限、選手／地圖與後端 staging 統一列於 G01–G06；本輪未要求再確認已通過的 D01–D08。

## 查證來源

- [osu! IRC 設定](https://osu.ppy.sh/wiki/en/Community/Internet_Relay_Chat)
- [官方比賽管理指令](https://osu.ppy.sh/wiki/en/osu!_tournament_client/osu!tourney/Tournament_management_commands)
- [Electron 穩定版本](https://releases.electronjs.org/release?channel=stable)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Node SQLite API](https://nodejs.org/api/sqlite.html)；最終能力以本次 Electron 內的實測版本為準
