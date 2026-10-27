# M0 / SPIKE-01、SPIKE-02 驗證結果

- 日期：2026-10-27；狀態：部分實測完成，M0 出口未通過。
- 環境：[environment.json](evidence/environment.json)。本機 macOS 27.0.1／arm64、Node 26.12.0、npm 11.20.0、Python 3.15.0、Xcode 27.1。
- 隔離實驗：[執行說明](../../spikes/m0/README.md)。此段保留最初實驗紀錄；本輪追加使用者授權的 [0.1.0 登入初版](../initial-preview.md)，正式 API、migration 及公開發行仍未完成。

## SPIKE-01：Bancho 與 IRC（已完成本輪唯讀排查）

**結論：先前「沒有回覆」是 probe 未正確分行，不能解讀為 Bancho 沒有送出回覆。** 在使用者新指定的 MP `122076210`，同一份接收 byte stream 經新舊解析器並行比較：新解析器讀到 5 行 PRIVMSG，CRLF-only 舊解析器為 0，結束時仍有 2,186 bytes 滯留。這 5 行全部以 bare LF 結尾；登入／JOIN／NAMES 等則為 CRLF。修正為以 LF 分行、只移除行尾可選 CR，並保留 UTF-8 跨 chunk 解碼與緩衝界限。

| 項目 | 證據分類／結果 | 實際觀察及限制 |
| --- | --- | --- |
| 舊 MP 122076167 | live / unavailable | 本輪 16:13:58 +08:00 開始的診斷收到 403；使用者隨後確認 abandoned 並改指定新房。未繼續向舊房查詢；舊公開頁 end_time=null 的先前快照不代表目前房間仍開放 |
| 新 MP 122076210 | live public / passed | 公開頁名 test1；建立事件與已授權帳號相符。此來源只佐證歷史身分，不獨立證明 IRC 權限 |
| 登入與加入 | live / passed | 001、self JOIN、353／366；新房頻道為 #mp_122076210。NAMES 出現重複 self／+ 前綴，不能當裁判或完整玩家名單 |
| MP／IRC 對應 | live / passed for this room | 在 #mp_122076210 收到 settings 的 History https://osu.ppy.sh/mp/122076210，與請求 MP 完全相符。不是只因字串拼接或 topic 就宣布核對成功 |
| settings | live / passed within observed fields | Team mode: TeamVs、Win condition: ScoreV2、Players: 0；沒有地圖／Mods／slot 回覆，相關值仍未知，不自行補預設 |
| listrefs | live / passed for current account | BanchoBot 在本頻道先回 Match referees:，再以獨立一行列出目前帳號；報告保留 selfListedCandidate=true，不保存姓名。使用者提供的截圖與此時序一致，未將截圖複製入 repository |
| 分行根因 | live differential / reproduced | 28 行 CRLF、56 行 bare LF（含 51 行 QUIT 與 5 行 PRIVMSG）；新 parser 無 parse failure／剩餘 bytes。新房報告中的 legacy counter 直接重播原 CRLF-only buffer 邏輯 |
| 較舊診斷盲點 | corrected | 原報告沒有 bare-LF／剩餘 buffer 計數，不能證明真的沒收到資料。沒有保存當時原始封包，所以不宣稱已重建舊房每次回覆，只確認同一缺陷於新房重現 |
| 可信來源與權限邊界 | partial | 只處理連線內 prefix 的 BanchoBot 並匹配 room／查詢；訊息 body 假冒姓名不算。listrefs 證明當次列名，不保證所有變更權限、永久權限或跨系統 UID |
| 變更／#UID／故障 | not-run | 沒有 make、map、mods、start、abort、close、addref、邀請或移動操作；權限拒絕、重連、限流、房名上限仍待獨立樣本 |

證據：

- [舊房 403 診斷](evidence/bancho-diagnostic-122076167.json)（歷史讀取，使用者改房前執行）
- [新房公開佐證](evidence/mp-122076210-public-check.json)
- [新房實測與新舊解析差異](evidence/bancho-diagnostic-122076210.json)，16:16:29 +08:00 起、45 秒窗口
- [Node 5 項測試](evidence/protocol-tests-lf-fix.txt)、[Python 6 項回歸測試](evidence/bancho-parser-tests.txt)：UTF-8 分段、混合行尾、原缺陷重現、tags／空白、假 bot、去密及緩衝界限

原 [bancho-readonly.json](evidence/bancho-readonly.json) 保留為舊 parser 的歷史輸出；其「無 PRIVMSG」表示未解析到，不是 wire-level 無回覆。新的 read-only probe 增加 framing／command counts／topic／NAMES 去密摘要，仍只送出 settings 與 listrefs，不提供任意指令介面。5／15 秒查詢排程只是實驗選擇，不是已證實的 Bancho 限流契約。

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
