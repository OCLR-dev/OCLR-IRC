# GitHub Release CI

2026-10-28：新增 `.github/workflows/release.yml`，共用既有三平台 `test-builds.yml` 的 workflow_call，避免 Release 與測試版使用不同打包流程。

## 觸發與輸出

- 推送既有版本 tag `v<package.json version>` 時自動執行；package-lock 版本也必須一致。版本不符立即停止，不代為建立、移動或覆寫 tag。
- GitHub Actions → Desktop release → Run workflow：預設 `dry_run=true`，可從 main 執行完整測試、打包、跨平台成品校驗與彙整，但跳過發布。
- 手動正式執行必須選擇已存在的版本 tag，取消 dry_run；從 main 取消 dry_run 會被驗證拒絕。
- Windows x64 ZIP、Linux x64 tar.gz、macOS arm64 ZIP、合併 SHA256SUMS.txt 及 build-info.json 成為 GitHub Release assets。直接從 Releases 下載，不受 Actions artifacts 的 30 天保留期限限制。

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
