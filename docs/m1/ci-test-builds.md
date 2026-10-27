# 三平台 CI 測試版：0.4.0

- 日期：2026-10-28（Asia/Taipei）。
- 建置來源：`1c0cc7f438f97cef6c785ab12ca7229e93fa195e`。
- [GitHub Actions run 40589612459](https://github.com/OCLR-dev/OCLR-ref-tools/actions/runs/40589612459)：三個 jobs 均為 success。
- 工作流程：[test-builds.yml](../../.github/workflows/test-builds.yml)。

## 下載

登入 GitHub 後下載對應 Artifact，先解開 GitHub 外層 ZIP，再解開內層 App 壓縮包。每個 Artifact 附 `SHA256SUMS.txt` 與 `build-info.json`，App 目錄內亦附來源資訊及測試說明。保留整個 App 目錄，不要只複製執行檔。

| 平台 | 下載 | Artifact 大小（約） | 內層格式 |
| --- | --- | --- | --- |
| Windows x64 | [下載測試版](https://github.com/OCLR-dev/OCLR-ref-tools/actions/runs/40589612459/artifacts/12773835889) | 167 MB | ZIP |
| Linux x64 | [下載測試版](https://github.com/OCLR-dev/OCLR-ref-tools/actions/runs/40589612459/artifacts/12774375246) | 134 MB | tar.gz；保留可執行權限 |
| macOS Apple Silicon arm64 | [下載測試版](https://github.com/OCLR-dev/OCLR-ref-tools/actions/runs/40589612459/artifacts/12771464991) | 130 MB | ZIP；保留 bundle 資料 |

Artifacts 保留 30 天，過期後可手動 Run workflow 重建。此為未作公開發行簽章／公證的內部測試版，沒有發布 GitHub Release，也沒有建立 M1 完成 tag。

## 已驗證與限制

三平台各自通過 Node 24 安裝鎖定依賴、TypeScript 檢查、26 項核心測試、合成 Electron UI smoke、原生打包、壓縮與上傳。Runner 為 Windows Server 2022 x64、Ubuntu 22.04 x64、macOS 15 arm64。CI 的啟動／UI 測試執行建置後程式，打包後的下載成品仍由實機驗收確認。

Linux 的 UI smoke 在 D-Bus session＋Xvfb 執行，僅測試程序停用硬體加速；產品不因此關閉 GPU 或 renderer sandbox。Windows／macOS 額外通過合成加密 adapter 的憑證生命週期測試；Linux 仍只驗證保存停用，不代表 Linux provider 已驗收。

第一次執行曾發現 Linux 虛擬顯示擷取失敗，以及 macOS 連結測試錯選另一個可見連結；已修正 CI 顯示環境與測試定位，未跳過 UI 驗證。成功 run 以全部三平台重新測試後的結果為準。

此為 hosted runner 證據，不能代替真實中文 IME、實際睡眠／喚醒、OS 金鑰鏈與升版、真實 Bancho 格式／權限與私訊互通驗收。既有 smoke JSON 的固定限制文字屬歷史描述；本次平台覆蓋以各報告的 platform／arch 和本 run jobs 為準，實機驗收仍未完成。

請依 [實機驗收清單](platform-acceptance.md) 回報，附上 `build-info.json` 的 commit。測試結果與下載連結不構成 M1 完成宣告。
