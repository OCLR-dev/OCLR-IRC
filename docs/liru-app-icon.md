# Liru 應用圖標

依使用者要求，以 [Liru 官方角色設定](https://oclr.org/wiki/liru)的 v1.2.1 運動服主設計改編。設計者為 JerrYamada，原參考圖及本次改編圖採 CC BY 4.0；隨包署名位於 [resources/icons/LICENSE.txt](../resources/icons/LICENSE.txt)，亦列入第三方聲明。應用原始碼維持 MIT。

圖像使用內建 imagegen 生成，採頭肩構圖、紫色圓角底和大面積色塊。保留薰衣草紫髮、紫瞳、呆毛尖端嫩芽、角色右側（畫面左側）單馬尾、角色左側紅藍交叉髮夾，以及運動外套／白 T 恤。不水平翻轉，不使用 osu! 標誌或屆數。依使用者後續要求，主圖底部的對話徽章加入 OCLR 官方字標的配色／輪廓與 IRC 字樣；字標參考 [官網 SVG](https://oclr.org/branding/oclr-wordmark-dark.svg)，保留 OCL 淺色漸層、鮮紫 R 與四角星的識別。

使用者已認可系統匣圖案，故單色模板與 Windows／Linux 彩色 `tray-color.png` 保留無字樣版本，不隨主圖徽章修改。系統匣單色版以嫩芽、呆毛及側馬尾保留輪廓。

## 資產與使用

`resources/icons/icon.png` 為 1024×1024 透明圓角主圖；32、128、256 px PNG 供尺寸檢視、介面與 Linux 桌面入口使用。ICO 包含 16、24、32、48、64、128、256 px，供 Windows 執行檔與 NSIS 安裝／卸載程式使用。ICNS 包含標準及 Retina 圖層，供 macOS App bundle 使用。macOS 選單列使用 `trayTemplate.png`／`trayTemplate@2x.png` 的 16／32 px 黑色透明模板，讓系統適配明暗模式；其他平台使用獨立 `tray-color.png`。

Main 從隨包 `resources/icons` 載入視窗及系統匣資產；開發模式亦設定 macOS Dock 圖標，封裝模式沿用 bundle 的 ICNS。Renderer 靜態匯入 256 px PNG，供側欄及關於頁使用，不開放任何外部圖片來源或新 IPC。側欄預設 40×40；視窗至少 1440×800 時增至 64×64，1920×800 時增至 80×80，並放大 OCLR／IRC 文字。尺寸依可用視窗空間調整，高像素密度螢幕使用同一高解析度資產；關於頁維持 40×40，900×640 小視窗保留緊湊側欄。

修改主圖後，在有顯示環境的 checkout 執行 `npx electron scripts/generate-icons.cjs [master.png]`，會從主圖重新產生 PNG、ICO、ICNS，並由可編輯 `tray-template.svg` 產生模板。這只是本機格式轉換，不重新呼叫圖像生成服務，不新增套件。常規建置直接使用已提交資產。圖像資產變更會觸發三平台 CI。

驗證涵蓋圖檔解碼與透明角落、900×640 側欄／關於頁、聊天輸入區、模板 Retina，以及封裝內圖檔／macOS bundle／Windows EXE 資源與實際封裝畫面的載入；不將合成驗證當成所有實機工作列／選單列的目視驗收。

## 生成與後續修改提示

內建 imagegen；初稿參考上述官方主設定及表情圖，產生單張新構圖，透明背景。初稿提示如下：

```text
Use case: logo-brand. Asset type: production desktop application icon for OCLR IRC, one square 1024x1024 image.
Input images: Image 1 is the official Liru main character design reference sheet, Image 2 is the official expression reference sheet. Use these solely as identity and palette references; create an original icon composition, do not reproduce a reference sheet.
Primary request: design a polished memorable mascot app icon featuring Liru (莉露), OCLR's adult university-student mascot. A very clear front-facing head and small shoulder portrait, cheerful confident gentle open-mouth smile and bright lavender eyes. Simplify into clean anime chibi mascot icon art: bold dark-purple contour, broad readable color shapes, restrained cel shading, no fine noisy strands.
Identity invariants: lavender hair #DED1F8 with #8D88C1 shadows, violet eyes #806DC1, soft ivory face #FEF5F6. ONE high side ponytail on HER right (viewer's LEFT), with pale lavender-white hair tie. ONE curled ahoge centered at the top, with a small two-leaf green sprout #A4C264 growing from its TIP. Red #E8556A and blue #4C7BE5 crossed hairpins on HER left (viewer's RIGHT). A small crop of lavender sports jacket and plain white T shirt at bottom. Preserve this side orientation, do not mirror. No headphones, no hat, no extra accessories.
Composition/backdrop: a deep plum-purple rounded-square icon tile, centered with transparent exterior corners, subtle lavender rim and quiet tonal depth. Portrait fills the tile; head and sprout entirely visible with comfortable inset, ponytail fits inside the left edge. Large face reads immediately at 32px. Strong silhouette. Not a full body. No hands, no scenery, no props, no speech bubbles. No text, letters, numbers, watermark, osu! mark or other logos. One icon only, no presentation sheet or device mockup. Actual transparent background outside the rounded tile.
```

後續先為主圖加入 `IRC` 對話徽章，再按使用者要求加入 OCLR 字標。最終編輯使用內建 imagegen，輸入為帶 IRC 徽章的角色圖與從官網 SVG 等比轉出的透明字標參考，提示如下：

```text
Use case: compositing / logo-brand. Asset type: final desktop app icon for OCLR IRC.
Input 1 is the edit target: the Liru purple rounded-square portrait icon with an IRC speech badge at the bottom. Input 2 is a supporting insert: the OFFICIAL OCLR logo/wordmark (transparent).
Preserve Input 1's character portrait exactly: face, expression, lavender hair, single side ponytail on viewer's LEFT, red-blue crossed hairpins on viewer's RIGHT, sprout, curled ahoge, purple tile, lavender rim and transparency. Do not mirror, restyle or redraw the character.
Change ONLY the badge along the bottom. Expand that existing speech badge horizontally across roughly 80-85% of the icon width; keep it compact vertically at the lower shoulders/chest, clear of the chin and face. It should be one integrated dark ink-purple rounded speech plaque with a fine lavender rim and one small speech tail. Place the COMPLETE official OCLR logo from Input 2 on its left, at its original proportions and with its recognizable geometric italic OCLR letter outlines, pink-to-lavender OCL gradient, vivid pink-violet R and four-point star over the R. Treat this as an inserted official logo, not ordinary retyped text. Keep the star, do not crop, recolor, distort, add ornaments to, or reinterpret the logo. On the right of the same badge, retain the text "IRC" in crisp bold white sans-serif capitals. OCLR logo and IRC should form one balanced horizontal lockup, well separated by negative space, without an extra divider or other icons. Align the lettering baselines. Keep both legible at small app-icon sizes; mascot remains the visual focus.
Exact visible lettering: "OCLR" logo plus "IRC". No other text, marks or objects. Preserve all other artwork and transparent outside corners. One finished app icon, not variants or a device mockup.
```

## 本機驗證（2026-11-03）

Node.js 24.22.2：型別檢查、216 項核心測試、30 階段完整 Electron smoke 通過；執行期 audit 0 項漏洞。原生圖片解碼、ICO 七種尺寸與 ICNS／Retina、透明角落均通過；Windows PE 圖示程式庫可解析全部 ICO frames。新增 1440×900／1920×1080 的 2x 像素密度品牌區，以及 1440×700 回復緊湊尺寸的幾何驗證；900×640 的側欄、關於頁與聊天輸入區通過。macOS App 為本機 ad-hoc 測試包，不宣稱公開簽章／公證或所有實機工作列驗收。三平台 CI 結果以對應 PR 的實際 run 為準。
