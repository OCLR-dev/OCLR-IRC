# 2026-10-31 IRC 現存 issue 持續開發

基線 main `a4de2905da47ff0cfaf3661ce7e013779500ed2c`。本輪只修改 IRC repository，不操作真實帳號或房間，不部署網站。

## 本輪修正

| Issue | 修正與驗證範圍 |
| --- | --- |
| #10／#15 | main 的 [Linux run 41075991727](https://github.com/OCLR-dev/OCLR-IRC/actions/runs/41075991727) 在圖池計畫已 observed 後立即預覽 Start，仍可能碰到全連線節流。測試改等待實際可預覽條件，只重試明確節流錯誤，其他錯誤立即失敗；生產節流不變。 |
| #40 | 同來源 stale→fresh 不清空自訂房名或核對；stale 期間阻擋 submit。真正來源、帳號或場次變更仍作廢。Electron 延遲 HTTP 回覆回歸驗證 stale 提交不產生 make。 |
| #9 | 已核對 HeadToHead 依 UID／槽位核對手動陣容，移位計畫不產生 team；分隊模式仍要求隊色，未知模式不可執行。Main／合成 IRC 及 UI 覆蓋單次送出、讀回與原確認限制。 |
| #10 | relay 與手動入口共用重複／互斥 Mods 檢查；非法組合不能進入操作追蹤或寫線，回傳 failed，不重試相同 command ID。 |

型別檢查與 157 項核心測試通過。完整 Electron smoke 另驗證新流程與 900×640 聊天輸入；最終結果與三平台 CI 以關聯 PR／issue 留言的確切提交紀錄為準。全部新增案例為 synthetic，不替代真實服務或實機驗收。

## 其餘未完成條件

| Issues | 仍需取得的條件 |
| --- | --- |
| #2 | 網站換圖回執修正已由網站 PR #576 合併；仍需操作者部署後以新請求驗證。Mods／timer／start 的完整語義確認與玩家狀態不能由 socket 寫入替代。 |
| #3／#15 | Windows／Linux 真實 IME、安全 provider、工作列／系統匣、休眠及升級／復原。CI 成品啟動不等於實機驗收。 |
| #5 | 已有空房、換圖、Hidden、倒數與 start／abort 真實樣本；仍缺 Freemod／個人 Mods、容量及完整玩家狀態等可靠樣本。缺行保持 unknown。 |
| #6 | OCLR 歷史逐場重新驗權契約與撤權清理接線；真實 OS provider／跨版本復原。IRC-only 加密日誌不得當正式場次歷史。 |
| #8 | 容量、lock、password、close 的可靠真實效果與權限樣本；既有真實授權不含這些變更，不自行擴大。 |
| #9 | 批次邀請的可關聯回覆樣本、真實 #UID、正式 roster 與換人政策。邀請成功與到場保持不同狀態。 |
| #10 | 正式 context 圖池／revision 產品接線與個人 Mods 真實核對。 |
| #11 | 至少一名真實玩家的 Playing／完成事件及跨端時間驗收；空房開賽證據不替代。 |
| #12 | 真實輸入法、螢幕閱讀器與跨平台鍵盤驗收。 |
| #13 | 已有真實授權／本人場次／配對與投影證據；撤權、403、refresh／到期仍需正式聯調。 |
| #14／#40 | 正式完整 context／allowedIntents／requiredLocalChecks、生命周期及隱私 hook。最新檢視的網站 Git tree 仍僅列 fixtures／panel／relay，不能把唯讀 panel 當完整 context；這不是部署版本聲明。 |
| #16 | 寫入 scope、版本衝突、冪等結果查詢的雙端契約與排程；現有候選設計不代表可直接啟用寫入。 |

#4 保持總追蹤，沒有因局部修正或合成通過關閉以上需要外部條件的 issue，也不發布 milestone tag。
