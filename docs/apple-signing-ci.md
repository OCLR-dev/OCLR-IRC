# Apple Developer ID 簽章與公證 CI

2026-10-28：`macos-signing` Environment 已建立，限制來源為 main 分支與 v* tag。已確認使用者設定了下面五個 secrets 與一個 variable；存在不代表內容已通過 Apple 驗證，結果以實際 CI 為準。

## GitHub 設定

[Environment 設定入口](https://github.com/OCLR-dev/OCLR-ref-tools/settings/environments)。所有私鑰／密碼只放 Environment secrets，不貼到 issue、聊天或 repository。

| 類型 | 名稱 | 內容 |
| --- | --- | --- |
| Secret | MAC_CERTIFICATE_P12_BASE64 | 含 Developer ID Application 憑證與私鑰的 .p12，Base64 編碼 |
| Secret | MAC_CERTIFICATE_PASSWORD | 匯出 .p12 時的密碼 |
| Secret | APPLE_API_PRIVATE_KEY | App Store Connect Team API Key 的 .p8 原始 PEM 全文 |
| Secret | APPLE_API_KEY_ID | 該 Team Key 的 Key ID |
| Secret | APPLE_API_ISSUER_ID | Team Key 的 Issuer UUID |
| Variable | MAC_TEAM_ID | Developer ID 憑證所屬的 10 碼 Apple Team ID |

首次建立資料：在 Mac「鑰匙圈存取 → 憑證輔助程式 → 從憑證授權要求憑證」產生 CSR；於 Apple Developer 建立 Developer ID Application 憑證並上傳 CSR；在同一台 Mac 安裝下載的 .cer，再由「我的憑證」將附有私鑰的身分匯出成加密 .p12。將 .p12 經 Base64 編碼後放入第一個 secret，匯出密碼放第二個。

App Store Connect → 使用者與存取權限 → 整合 → App Store Connect API → Team Keys，依 Electron notarize 指引建立 App Manager Team Key，記下 Key ID／Issuer ID 並下載一次性的 .p8。`.p8` 填原始文字，包含 BEGIN／END 行，不再 Base64。Apple Team ID 在開發者會員資料中取得，與 Issuer UUID 不同。

官方步驟：[Developer ID 憑證](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)、[建立 CSR](https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request)、[Electron notarize 的 API Key 指引](https://github.com/electron/notarize#usage-with-app-store-connect-api-key)。

## 執行方式

- **Signed macOS build**：從 main 手動執行，建立單一 macOS arm64 正式簽章／公證測試包，不建立 tag 或 GitHub Release。
- **Desktop test builds**：一般 push／PR 保留 ad-hoc 測試模式；手動勾選 `sign_macos` 可改用簽章 macOS job。PR 不會取得簽章 Environment。
- **Desktop release**：預設 `dry_run=true`、`sign_macos=true`。完整簽章、公證、三平台建置與成品彙整通過後跳過 publish，供發布前演練。只有 dry-run 可取消 sign_macos。
- **版本 tag 發布**：必須有 Developer ID signed 且 notarized 的 macOS 成品，缺憑證、公證失敗或未滿足條件都停止，不自動降級成 ad-hoc 發布。Pre-release／非 Latest 及 M1 驗收規則保持。

核心建置步驟共用 `.github/actions/desktop-build`，signed macOS job 使用獨立 Environment。Windows x64、Linux x64 不因 Apple 簽章變更發行身分。

## 簽章、公證與下載驗證

1. 核心測試／UI smoke 通過後才在 runner 暫存目錄寫入 .p12／.p8，建立獨立 keychain，匯入私鑰並匹配唯一有效 Developer ID Application／Team ID。
2. `notarytool store-credentials` 預先驗證 Team API Key，將憑證存至暫存 keychain；刪除原始暫存 .p12／.p8。程式不輸出含密碼的 security 命令列。
3. Packager 使用同一憑證由內而外簽署 framework／helper／App，啟用 Hardened Runtime 與 timestamp，僅加入 Electron V8 所需 JIT entitlement。
4. 透過 `@electron/notarize` 提交 Apple、公證 Accepted 後 staple。再檢查 codesign strict／deep、Developer ID Authority／Team ID／runtime、stapler validate 與 spctl assess。
5. 最終 ZIP 產生後重新解壓，再驗證 ticket／Gatekeeper；在臨時副本加上 quarantine 屬性並再次 assess，不關閉系統 Gatekeeper。啟動真正打包 executable，確認離線登入畫面與 IPC 可用。
6. 所有檢查成功才上傳成品；metadata 標記 signed、developer-id、notarized 與 Team ID。Release assembler 校驗三平台完整 commit、版本、架構及 SHA-256，拒收 ad-hoc macOS 發布包。
7. 成功或失敗均清理暫存 keychain／原始憑證、還原 keychain search list；不將 signing 目錄加入 artifacts。Runner 強制中止時仍依託 GitHub-hosted VM 的隔離與銷毀。

Apple 公證可能排隊；簽章 job 上限為 90 分鐘，逾時不宣稱通過或上傳已公證成品。首次公證與瀏覽器實際下載／開啟仍需核對，不能只憑 secrets 存在或合成測試宣稱 Apple 已接受。

## 實際驗證結果（2026-10-28）

[Release dry-run 40620456501](https://github.com/OCLR-dev/OCLR-ref-tools/actions/runs/40620456501)，來源 `722fda57b86f451cd4569566d7ca2431e7f88b08`，整體 success：版本檢查、Windows／Linux、signed macOS、三平台成品彙整均成功；publish 正確 skipped，沒有建立 tag 或 GitHub Release。

macOS 已完成 Developer ID 憑證與 Team API credentials 驗證、Hardened Runtime 簽章、Apple 公證與 staple。打包 App、ZIP 解壓 App、加上 quarantine 的解壓副本，其 Gatekeeper assess 均為 `accepted`，來源為 `Notarized Developer ID`。解壓後真正 executable 可進入離線登入畫面，暫存憑證 cleanup 成功。三平台各自通過 29 項核心／契約測試及合成 UI smoke。

**[下載已簽章及公證的 macOS 0.4.1 arm64](https://github.com/OCLR-dev/OCLR-ref-tools/actions/runs/40620456501/artifacts/12787157011)**（約 132 MB）。登入 GitHub 後下載，先解開外層 ZIP，再解內層 ZIP。內附 SHA256SUMS.txt、build-info.json，標記 developer-id／signed／notarized。

[QA artifact](https://github.com/OCLR-dev/OCLR-ref-tools/actions/runs/40620456501/artifacts/12787720693) 包含 mac-archive-verification.json。Actions 下載保留 30 天；未來合法版本 tag 發布後，GitHub Release assets 依 Release 流程保存。

首次執行發現 reusable workflow 雖宣告 environment，仍需由呼叫端逐層傳遞具名 secrets；已依 [GitHub 官方說明](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows#using-inputs-and-secrets-in-a-reusable-workflow) 修正。失敗的第一次 run 未匯入私鑰，也未產生簽章成品；以上結果來自修正後的完整重跑。

本次證據確立 CI 的簽章、公證、staple、Gatekeeper 與啟動檢查；使用者瀏覽器下載後的首次開啟、真實 IME／休眠／IRC 與其餘 M1 實機驗收仍依原清單進行。

0.8.2 起正式發布亦產生 DMG：既有 App 公證後，以相同 Developer ID 簽署 DMG，notarytool 單次提交並等待 Accepted，再 staple／validate；DMG 與掛載後 App 均驗證，原 ZIP 保留。只有明確 Apple 傳輸錯誤的只讀 validate／assess 可有限重試，無效簽章不重試也不放行。實際成功仍以版本對應 run 為準。
