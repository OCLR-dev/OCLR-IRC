# 開發指南

開發環境、測試與打包操作。開始貢獻前請閱讀 [AGENTS.md](../AGENTS.md)；產品使用方式見 [README](../README.md)，架構與契約見 [文件索引](README.md)。

## 本機開發與執行

需要 Node.js 24+：

```sh
npm ci
npm run dev
```

建立並執行編譯後的版本：

```sh
npm run build
npm start
```

登入使用 osu! **IRC 專用密碼**，不是網站密碼。osu! IRC 目前使用未加密連線。IRC 日誌預設開啟，在安全金鑰服務可用時加密保存七天；「本機日誌」提供開關、範圍檢視／清除及原生對話框匯出（最近 1,000 則）。Linux 仍僅記憶體；無安全服務或寫入失敗不回退明文。IRC 明確登出清除本帳號日誌，退出程式可保留尚未到期日誌。OCLR context 不落盤；本次登入曾啟用網站投影的房間排除本機日誌並清除已存內容，完整逐場歷史驗權待完成。啟用投影時，綁定房間訊息另會傳至網站。本機另保存最小開房防重送紀錄，以及使用者選擇保存的加密 IRC 憑證。

常用驗證與打包命令：

```sh
npm run typecheck
npm test
npm run test:ui
```

介面測試需要桌面顯示環境與本機 loopback 連線；Linux CI 使用 Xvfb。各平台打包命令為 `npm run package:win`、`npm run package:linux`、`npm run package:mac`，輸出於 `release/`；macOS 打包需在 macOS 執行。

## 發布

推送與 `package.json` 版本相符的 `v*` tag，會觸發三平台測試、打包與校驗，通過後發布 GitHub Pre-release。發布要求 macOS Developer ID 簽章與 Apple 公證；也可手動執行不發布的 dry-run。詳見 [Release CI](release-ci.md)。

## 進度與驗證紀錄

- [持續開發紀錄](m1/issue-progress-2026-10-31.md)：逐項修正、驗證與待驗收條件。
- [剩餘工作](desktop-backlog.md)／[MVP 任務](mvp-plan.md)：目前範圍與依賴。
- [README 開發紀錄存檔](development-history.md)：由原 README 移出的歷史進度。

文件調整檢查連結、內容一致性與 `git diff --check` 即可。程式、IPC 或契約修改依 AGENTS.md 執行相關核心及 Electron 驗證；合成結果、真實服務驗證與提交對應的 CI 狀態分別記錄。
