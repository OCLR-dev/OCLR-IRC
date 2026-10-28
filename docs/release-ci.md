# GitHub Release CI

2026-10-28：新增 `.github/workflows/release.yml`，共用既有三平台 `test-builds.yml` 的 workflow_call，避免 Release 與測試版使用不同打包流程。

## 觸發與輸出

- 推送既有版本 tag `v<package.json version>` 時自動執行；package-lock 版本也必須一致。版本不符立即停止，不代為建立、移動或覆寫 tag。
- GitHub Actions → Desktop release → Run workflow：預設 `dry_run=true`，可從 main 執行完整測試、打包、跨平台成品校驗與彙整，但跳過發布。
- 手動正式執行必須選擇已存在的版本 tag，取消 dry_run；從 main 取消 dry_run 會被驗證拒絕。
- Windows x64 ZIP、Linux x64 tar.gz、macOS arm64 ZIP、合併 SHA256SUMS.txt 及 build-info.json 成為 GitHub Release assets。直接從 Releases 下載，不受 Actions artifacts 的 30 天保留期限限制。

現階段產物未作公開發行簽章／公證，因此流程統一發布為 **Pre-release、非 Latest**，即使 tag 沒有 `-rc` 後綴也不宣稱正式穩定版。Release 說明保留 Linux 憑證保存與 M1 實機驗收限制。

## 發布保護

1. 三平台 typecheck、核心測試、Electron smoke 與打包必須全數成功。
2. 只下載同一次 workflow run 的三份 App artifacts；逐一比對完整 commit、版本、平台、架構與 SHA-256，缺少、混入或損壞的成品均停止發布。
3. build／validate 僅 contents:read，彙整只另外需要 actions:read；只有最後 publish job 有 contents:write。
4. 發布前再次確認遠端 tag 對應建置 commit，並再次驗證壓縮包 SHA-256。
5. 先建立 draft 並上傳全部 assets，成功後才公開為 Pre-release。既有同名 Release 不覆寫，不使用 `--clobber`。中途失敗可能留下 draft；檢查失敗原因後由維護者處理該 draft，再重跑，不能假報已公開完整版本。
6. 相同 ref 的 Release runs 序列執行，不在上傳途中被新 run 自動取消。

這份 CI 不代表 M1 已驗收，也不自行產生 milestone tag。既有「全部 milestone 驗收通過後自動 tag／push」規則保持；使用者本次新增 Release CI 的授權，使之在合法版本 tag 推送後自動產生 Pre-release。後續簽章、macOS 公證及正式 Latest 發行另行規劃。
