# GitHub Release CI

2026-10-28：新增 `.github/workflows/release.yml`，共用既有三平台 `test-builds.yml` 的 workflow_call，避免 Release 與測試版使用不同打包流程。

## 觸發與輸出

- 推送既有版本 tag `v<package.json version>` 時自動執行；package-lock 版本也必須一致。版本不符立即停止，不代為建立、移動或覆寫 tag。
- GitHub Actions → OCLR IRC release → Run workflow：預設 `dry_run=true`，可從 main 執行完整測試、打包、跨平台成品校驗與彙整，但跳過發布。
- 手動正式執行必須選擇已存在的版本 tag，取消 dry_run；從 main 取消 dry_run 會被驗證拒絕。
- Windows x64 安裝版 EXE／ZIP、Linux x64 tar.gz、macOS arm64 DMG／ZIP、合併 SHA256SUMS.txt 及 build-info.json 成為 GitHub Release assets。直接從 Releases 下載，不受 Actions artifacts 的 30 天保留期限限制。

日常測試包保留 ad-hoc 模式；版本 Release 現已要求 macOS Developer ID 簽章與 Apple 公證（見 [設定及驗證](apple-signing-ci.md)）。發行階段仍統一發布為 **Pre-release、非 Latest**，即使 tag 沒有 `-rc` 後綴也不宣稱正式穩定版。Release 說明保留 Linux 憑證保存與 M1 實機驗收限制。

## 發布保護

1. 三平台 typecheck、核心測試、Electron smoke 與打包必須全數成功。
2. 只下載同一次 workflow run 的三份 App artifacts；逐一比對完整 commit、版本、平台、架構與 SHA-256，缺少、混入或損壞的成品均停止發布。
3. build／validate 僅 contents:read，彙整只另外需要 actions:read；只有最後 publish job 有 contents:write。
4. 發布前再次確認遠端 tag 對應建置 commit，並再次驗證壓縮包 SHA-256。
5. 先建立 draft 並上傳全部 assets，成功後才公開為 Pre-release。既有同名 Release 不覆寫，不使用 `--clobber`。中途失敗可能留下 draft；檢查失敗原因後由維護者處理該 draft，再重跑，不能假報已公開完整版本。
6. 相同 ref 的 Release runs 序列執行，不在上傳途中被新 run 自動取消。

這份 CI 不代表 M1 已驗收，也不自行產生 milestone tag。既有「全部 milestone 驗收通過後自動 tag／push」規則保持；使用者本次新增 Release CI 的授權，使之在合法版本 tag 推送後自動產生 Pre-release。Apple 簽章／公證流程見上述設定文件；正式 Latest 發行仍另行規劃。

## 驗證紀錄

2026-10-28 以來源 `8c8199e15c816016661e5ca384aa9d8603189f37` 執行 [dry-run 40616217475](https://github.com/OCLR-dev/OCLR-ref-tools/actions/runs/40616217475)，整體 success：validate、Windows／Linux／macOS 三平台 build 及 assemble 均成功，publish 為 skipped。每平台通過 28 項核心／發布契約測試及既有 Electron smoke；三份真實 CI 成品已完成完整 commit／版本／平台／SHA-256 核對，產生 verified-release-assets artifact。

沒有為測試而建立 tag 或 GitHub Release；實際寫入／公開 Release 的步驟尚未在遠端演練，會於下一個合法版本 tag 執行。既有 Desktop test builds 在同一來源提交亦成功。

0.4.1 起 macOS 另外執行完整 ad-hoc 簽章、ZIP 解壓後 strict／deep 驗證與真正打包 App 啟動檢查；沒有 Developer ID／公證的限制仍保留。見 [修正說明](m1/macos-signing-fix.md)。

2026-10-28 Apple CI 整合：Release 預設 sign_macos=true；dry-run 才能選擇略過正式簽章。正式發布缺少公證 macOS 成品時停止，Windows／Linux 仍為未簽章測試版。

Apple 正式簽章實測已於 [dry-run 40620456501](https://github.com/OCLR-dev/OCLR-ref-tools/actions/runs/40620456501) 通過，包含 notarized macOS 與三平台成品校驗；publish 仍為 skipped。完整證據及下載見 [Apple CI 紀錄](apple-signing-ci.md)。

## 2026-10-31 三平台公開版本

使用者本次明確要求發布三平台版本。以目前尚未發布的套件版本 `0.7.0` 準備首個 `v0.7.0` 公開預覽版，這是版本發布授權，不代表 M1／完整 MVP 已驗收，也不覆寫既有版本。

- Release workflow 名稱為 **OCLR IRC release**，維持版本 tag 自動觸發、手動 dry-run、三平台共用打包與正式 macOS 簽章／公證要求。
- 新增發布前遠端檢查：同名 Release 已存在、權限／網路／服務錯誤都停止；只有 API 回覆不存在才繼續，避免重複跑完昂貴的建置後才發現衝突。不修改 GitHub 或 Apple 憑證。
- 版本驗證同時核對 package.json、package-lock 頂層與根套件版本。Release workflow 本身的變更也會觸發三平台 PR／main CI。
- 自動產生中英三平台下載表、校驗碼與建置資訊連結，以及可攜式啟動方式。最後 publish job 提供公開版本網址。
- 實際發布的提交、CI、公證與資產結果以 GitHub Release 及對應 Actions run 為準；準備這份文件本身不代表發布成功。

一般操作：先在 main 完成對應版本與測試，再建立未使用的 `v<version>` tag，核對指向的完整提交，僅推送這個 tag。CI 完成後至 [Releases](https://github.com/OCLR-dev/OCLR-IRC/releases) 下載；不要將同名 tag 移到其他提交。修正已發布版本需增加版本號。

## v0.8.2：原生安裝格式

新增固定版本 electron-builder 26.18.0（MIT）的 NSIS per-user 安裝精靈，沿用 Packager 已驗證的 Windows App，不更換核心打包流程或 appId。禁止安裝完成自動啟動，卸載保留 AppData；保留 oclr-irc 協定註冊與開始功能表入口。Windows CI 在隔離暫存位置實際安裝、核對協定、以空白測試 profile 啟動並讀取精確版本、重新安裝、卸載及確認測試使用者資料仍存在。這是原生 CI 驗證，不宣稱真實使用者升級已驗收。

macOS 以 CI macOS 15 支援的原生 hdiutil 產生 DMG，包含 App、Applications 捷徑及版本／授權資料。保留原 App 簽章；正式 Release 另外對 DMG 簽章、公證與 staple，再唯讀掛載核對內部 App 簽章及實際離線啟動。一般 PR 的 DMG 仍未公證。Apple 只讀驗證遇明確網路錯誤最多重試三次；無效簽章／ticket 立即失敗，不降低正式發布條件、不在此重試公證提交。

每平台 artifact 仍只有一份目錄，Windows／macOS 各含 portable 與 installer；Linux 一份 tar.gz。共五個成品及兩份校驗／建置資訊成為公開 assets。共用白名單依平台、架構、版本、完整 commit 固定檔名，拒絕缺檔、額外檔案、缺少／重複 checksum、安裝包描述不符及任何成品損壞。所有 native installer／archive 驗證通過後才上傳、彙整、發布；已發布 tag 不移動，v0.8.1 保持不變。

本機開發可在 package App、`scripts/archive-test-build.cjs` 後執行 `scripts/create-installers.cjs`；以上共用 GITHUB_SHA 等建置身分。macOS 可本機測試 ad-hoc DMG；Windows 安裝／卸載 smoke 限專用 GitHub runner，避免改動真實使用者的安裝與協定。依賴總 audit 的 16 項 moderate 位於開發工具鏈（glob／minimatch 等，現有 packager 及新 builder 的間接依賴）；未以不相容 major override 或降級工具冒充修復。runtime audit 為 0，高／critical 為 0；工具相容更新仍另追蹤。

本輪本機證據：Node 24.22.2 typecheck、203 項核心／契約、完整 12 組 Electron synthetic、actionlint 與版本 validator 通過。使用明示 synthetic commit 的本機 ad-hoc App／DMG，完成 DMG checksum、唯讀掛載、Applications 連結、內部簽章、精確版本離線啟動與卸載測試映像，以及 portable ZIP 驗證；不宣稱本機 Developer ID／公證。Windows 原生安裝／重新安裝／卸載及正式 macOS／公開發布仍以對應 CI 為準。
