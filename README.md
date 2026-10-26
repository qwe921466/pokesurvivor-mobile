# PokéSurvivor — iPhone 個人版（雲端帳號／同步／排行榜／合作）

此版本從已驗證的 `PokeSurvivor-Cheats` 複製並調整，保留原作遊戲及 UI。原作者：[JPTER78/pokesurvivor](https://github.com/JPTER78/pokesurvivor)。這是個人使用的非官方修改版。

此版本使用 GitHub Pages 靜態託管，本機與部署後皆不會同步到官方伺服器。

## 執行方式與資料位置

- 正式環境只需要 GitHub Pages 提供 HTML、CSS、JavaScript、字型及圖片，不需要 Mac、Python、Node 或任何自建後端持續運作。
- `index.html` 是首頁，直接載入修改過的分檔 JavaScript；沒有 `app.min.js`。`dev.html` 導向同一首頁，避免版本分歧。
- `js/core/db.js` 保留原本本機帳號；`cloud.js`／`cloud-sync.js` 提供獨立雲端帳號與版本式同步。官方 `firebase-config.js` 仍固定為 `null`。
- 官方好友功能停用；本站另提供房間碼合作。原作 `DB.online` 永遠為 false、`DB.fb` 永遠為 null；新的共用排行榜走本站專案。CSP 僅允許本站及 Firebase Auth／Firestore API，不載入遠端 SDK。
- 所有資源使用相對路徑，支援 GitHub Pages 的 `/pokesurvivor-mobile/` 子路徑。


## 雲端帳號與共同排行榜

專案 `pokesurvivor-mobile` 為本站管理者自己的 Firebase Spark 專案，Firestore 位於 `asia-east1`。不連結付費帳單，也不啟用 Analytics、Functions、Storage 或官方後端。

1. 舊手機先登入原本本機帳號，建議匯出一份 JSON。主選單「存檔與備份」→「雲端帳號與同步」→「建立雲端帳號」，填電子郵件、至少 8 字元密碼及排行榜暱稱，勾選帶入目前進度。
2. 原本本機存檔保留。雲端 UID 另有獨立本機副本；登入已有雲端進度的帳號時優先下載，不用本機初始值覆蓋。
3. 電腦開啟相同網址，使用雲端電子郵件與密碼登入。等到「已同步，可以切換裝置」再換裝置；戰鬥中途不支援跨裝置接續。
4. 離線變更先存在本機，連線後以交易檢查 revision。兩台裝置同時改動會顯示衝突，保留兩份備份並讓玩家選擇，不自動合併資源。
5. 共同排行榜顯示所有加入雲端的玩家之最長生存時間前 100 名。新帳號先列為尚無成績；升級後完成的單人戰鬥可上傳。這是玩家端回報的休閒排行榜，有數值界線及身分隔離，不能防止進階玩家修改自己的客戶端。
6. 電子郵件、驗證憑證與完整存檔不公開。只有暱稱、寶可夢、時間、等級、擊殺數與成績時間戳可供已登入玩家讀取。此版雲端帳號刪除由站長處理；原本本機帳號刪除功能維持。

新鍵 `pokesurvivor.mobile.cloud.<uid>` 原子保存同步版本、進度與待上傳操作；`.recovery` 內容保留最近一次衝突的雙份快照。Firebase SDK 自行管理登入持續性，匯出檔只含遊戲欄位。

雲端權限：`cloud/firestore.rules`。私有 `mobileSaves/<uid>` 只允許本人讀寫；`mobileRanks/<uid>` 只有本人可寫，查詢需登入且每次最多 100 筆；其他路徑預設拒絕。Web config 是公開專案識別，不是管理員金鑰。

維護測試使用 Node >=24.12、Java 21：`npm ci --prefix tools/cloud`，再執行 `tools/cloud/node_modules/.bin/firebase emulators:exec --project demo-pokesurvivor --only auth,firestore "node --test tools/cloud/rules.test.mjs && node --test tools/cloud/integration.test.mjs && node --test tools/cloud/rooms.test.mjs"`。正式站點不需要 Node／Java 或本機模擬器。

## 2026-10-26 更新

已整合官方 [`680c3e12`](https://github.com/JPTER78/pokesurvivor/commit/680c3e12c670a0f131ec846c43248372853389b1)（比上次多 24 個提交）：變隱龍商店、薄荷與特性膠囊、每日 8 種招式學習器、性格與特性、第二個初始招式、百連抽及跳過動畫、地區閃耀護符、戰鬥寶玉、阿爾宙斯石板與傷害統計、隊友觀戰、結算傷害明細，以及手機雙搖桿和多人同步修正。抽獎 UI 依官方改為十連／百連；普通券仍可使用。

存檔升為 **v5**，新增 `bag`、`tms`、`ptm`、`pnat`、`pabil`、`pstart2`。舊存檔原有餘額、收藏、創建時間及強化保留，新增欄位從空值開始，沒有自動補滿。匯出／匯入與雲端同步均包含新欄位。**手機、電腦及合作隊友都先更新，再切換裝置或開新房。** 房間協定為 2；新版不加入舊版房間，既有協定 1 房間仍可結束。

保留個人版自動同步、衝突保護、補滿按鈕及既有生存時間排行榜。未接入官方 TURN、帳號、好友、排行榜改版／重置、直播輪詢。阿爾宙斯傷害可在當局及結算查看，尚未加入本站共用排行榜。

## 2026-10-20 更新

已整合官方提交 [`018e986f4c12f414dfa84193ee35b2959b1e325c`](https://github.com/JPTER78/pokesurvivor/commit/018e986f4c12f414dfa84193ee35b2959b1e325c)：38 個新招式、物理／特殊攻防、初始招式選擇、收藏搜尋與最愛、戰鬥傷害統計、手動瞄準、手把與自訂觸控配置，以及官方戰鬥修正。精確來源與整合範圍記錄在 `UPSTREAM.json`。

保留本站繁體中文、iPhone 安全區與觸控座標修正、獨立雲端帳號和交易式存檔同步。未啟用官方資料庫、好友或官方驗證流程；合作模式改走本站房間與玩家直連。排行榜保留原成績；時間驗證上限改為 60 分鐘，以支援新版超過 35 分鐘的戰鬥。

存檔格式升為 v4，新增最愛、出戰次數與初始招式；原有資源與收集會保留。**手機和電腦都先更新再切換裝置**。舊版程式遇到新格式會拒絕寫入，以免遺失新增欄位；請關閉舊遊戲視窗後重新開啟。

## 房間碼合作（2–4 人）

主選單「多人合作」→「建立房間」；朋友登入自己的雲端帳號，輸入 10 位房間碼。連線成功後朋友按「準備」，房主按「開始合作」。每人使用自己的寶可夢與強化，結算收益寫入各自存檔，合作時間不提交到單人排行榜。重新整理後請建立新房；不提供重新整理後中途加入或房主轉移；同一頁面的短暫斷線有 45 秒等待期，每位隊友每局至多自動重新協商一次。

房主裝置需保持遊戲開啟。房主切到背景時隊伍會暫停；房主明確離開或斷線逾 45 秒時，其餘玩家結算已有進度。若作業系統直接關閉某位玩家的頁面，該裝置尚未結算的戰鬥仍可能遺失，與單人模式相同。其他玩家中途離開不阻擋其餘隊友選卡。房間 2 小時到期，之後需重新建立。

`mobile-rooms.js`、`mobile-net.js` 和 `mobile-coop-ui.js` 接替原作社交／網路入口，沿用 `coop.js` 的戰鬥邏輯。`mobileRooms/<randomCode>` 保存最多 4 位玩家的 UID、暱稱、角色、準備狀態與局次；登入後知道房間碼才可讀取，禁止列出房間。`signals/<guestUid>` 只有房主及該訪客可讀寫 SDP，過期或關閉後禁止存取。原始社交檔案保留但不載入。協定不相容的更新應同時提升 `PROTOCOL` 與規則中的版本要求。

戰鬥以 WebRTC 直接傳送，Google STUN 只協助建立連線。沒有付費 TURN、資料庫戰鬥中繼、常駐 Mac 或額外付費服務；每次連線通常只寫入一份 offer 和一份 answer。**部分 Wi-Fi／行動網路無法直連**，請切換網路後由房主按「重試連線」。連線不會無限自動重試，使用量仍受 Spark 免費額度限制。

只把房間碼分享給信任的朋友。房間不是公開目錄；加入後玩家會互相取得遊戲狀態，WebRTC 也可能透露網路 IP。不分享電子郵件、密碼、登入權杖或完整存檔。到期限制是存取控制，不會自動刪除 Firestore 記錄；管理者可按需清理過期房間與其 signals。未設定付費 TTL 或排程服務。

本機瀏覽器驗證：啟動 demo 模擬器，執行 `node tools/cloud/coop-fixtures.mjs` 與 `python3 tools/cloud/serve-coop-test.py`。四個 loopback 網址（8771–8774）使用互相隔離的儲存空間、四個假帳號及 demo 後端；測試工具不會打包到網站。實體 iPhone、主畫面模式與跨行動網路連線需另外實測。

## 補滿資源

主選單「補滿資源」→ 面板內「補滿資源」：金幣補到 **999,999,999**，單抽券與十連抽券各補到 **999,999**。可重複使用，抽獎及購買仍正常扣除；目前數量更高時不會降低。僅對當前登入的本機或雲端帳號操作，不改其他玩家或官方存檔，也不增加統計中的累積賺取金幣。雲端帳號連網後會同步，切換裝置前請確認已同步。訪客、戰鬥中或尚有存檔衝突時不能補滿。

## 新帳號與存檔

每個新建立的本機帳號初始資源為：金幣 **999,999**、單抽券 **999**、十連抽券 **999**。`pupg` 是每隻 Pokémon 的升級資料，維持原作邏輯。

初次選擇夥伴及後續遊玩仍會觸發原作成就獎勵，因此主選單可能已顯示 1,000,099 金幣，抽獎後也可能增加獎勵抽獎券。這是正常獎勵；初始資源只在建立帳號時給予，重新開啟或更新不會補滿。

本機帳號名稱及密碼只用於此瀏覽器，不是官方帳號。專屬 localStorage 鍵：

- `pokesurvivor.mobile.accounts`：本機帳號及密碼雜湊／salt。
- `pokesurvivor.mobile.session`：最後登入的本機帳號。
- `pokesurvivor.mobile.save.<name>`：遊戲進度。
- `pokesurvivor.mobile.save.<name>.previous`：上一份有效進度，主存檔損壞時可復原。

這些鍵不包含版本號，發版不變更或清除。抽獎、購買等沿用原作即時 commit；隱藏頁面／離開頁面額外儲存。儲存失敗會顯示持續警告；第二視窗更新時，舊視窗會停止寫入，避免覆蓋新進度。

可保存帳號、收集、資源、升級、任務及已結算成果。**進行中的戰鬥不支援關閉後從原地續玩。訪客模式不保存。** 清除網站資料、使用無痕模式、儲存空間被系統回收仍可能失去存檔，請保留外部備份。

## 匯出、匯入及換手機

1. 在主選單選「存檔與備份」，按「匯出 JSON 備份」。
2. iPhone 請確認檔案已下載，必要時選「儲存到檔案」。
3. 新手機或另一個瀏覽器先建立新的本機帳號，再開啟同一面板匯入 JSON。
4. 匯入前會列出金幣、兩種抽獎券及 Pokémon 數量，確認後覆蓋目前帳號進度。原進度另留一份自動備份，但仍建議先手動匯出。

匯出只包含遊戲資料與遊戲名稱，不包含密碼、雜湊、salt、登入 session 或權杖。支援本版本格式，大小上限 5 MB；不直接匯入官方雲端帳號資料。

Safari、加入主畫面的 App、本機測試網址及正式 GitHub Pages 網址可能有不同的儲存空間。搬移進度請使用匯出／匯入。建議先加入主畫面，再在主畫面 App 建立正式遊玩帳號。

## iPhone

Safari 開啟發布後的 HTTPS 網址 → 分享 → 加入主畫面 → 如有選項，啟用「作為網頁 App 開啟」→ 從圖示啟動並橫放手機。

保留原作觸控搖桿、攻擊及暫停按鈕；CSS 追加安全區域避讓，Canvas HUD 沿用原作 safe-area 計算。manifest 使用相對 `id`、`start_url`、`scope`、standalone 顯示模式、橫向建議及本機圖示。iOS 不一定接受方向鎖定，請手動橫放。

可在備份面板請求持續保留網站儲存空間；授權由瀏覽器決定，不能取代手動備份。Apple/WebKit 的儲存政策及主畫面資料隔離說明：

- [WebKit Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [WebKit 17.2：加入主畫面只複製 cookies，不複製其他本機儲存](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/)

## 快取與更新

`python3 tools/build.py` 根據 HTML、程式、CSS、manifest、建置腳本及素材內容產生發版雜湊，寫入首頁、`version.json` 與 `sw.js`。重複建置相同內容結果一致。

- JavaScript／CSS URL 帶版本雜湊；Service Worker 安裝時完整快取該版核心檔案。
- 首頁優先詢問網路，離線時回到同一套快取核心檔案；不存在的腳本不會以舊腳本或首頁代替。
- 不強制中斷正在遊玩的其他視窗。更新檢查只提示，回主選單按更新才儲存並重新載入。關閉所有舊遊戲視窗後，等待中的 Service Worker 可完成切換。
- 只清理此站路徑專屬的舊 CacheStorage，不會清除 localStorage 或其他站點快取。
- 素材按需快取。**這不是完整離線素材包**：尚未載入的角色動畫仍需網路。正常連網遊玩與 Mac 是否開機無關。

## 本機開發與驗證

在此資料夾執行：

```sh
python3 tools/build.py
python3 tools/verify.py
node --test tests/*.test.cjs
python3 -m http.server 8765 --bind 127.0.0.1
```

只為本機預覽使用 HTTP 伺服器。可用 `http://127.0.0.1:8765/`；發布後不需要執行這些程式。不要直接用 `file://` 測試 PWA。

`tests/smoke.py` 是 Python Playwright 的完整瀏覽器回歸測試，需已安裝 Playwright／Chromium。可用 `GAME_URL` 指定測試網址、`CHROMIUM_EXECUTABLE` 指定 Chromium。測試只使用獨立臨時瀏覽器 profile，結果位於忽略提交的 `test-results/`。外部請求檢查以 `GAME_URL` 的來源為準。

## GitHub Pages 發布準備

使用 Repository 的 Settings → Pages → Source 選 **GitHub Actions**。推送 `main` 後，`.github/workflows/pages.yml` 會建置、驗證、測試、打包並發布。部署狀態以 GitHub Actions 顯示的結果為準。

發布內容不包含 `test-results/`、個人存檔或測試瀏覽器 profile。

### 搜尋引擎收錄

首頁與 `dev.html` 設有 `noindex, nofollow, noimageindex`，不產生 sitemap。遵守這些指令的搜尋引擎應不收錄遊戲頁面。沒有用 robots.txt 阻止爬取，讓搜尋引擎能讀取 noindex。

這不是登入或存取權限控管：知道網址的人仍可開啟；公開 GitHub Repository 本身也可能被搜尋到。不能保證所有搜尋引擎或爬蟲都遵守，本機存檔留在自己的瀏覽器，雲端存檔只能由本人帳號讀寫。參考 [Google noindex 文件](https://developers.google.com/search/docs/crawling-indexing/block-indexing)。

部署工作流程依據 [GitHub Pages 官方自訂工作流程文件](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。若只需產生靜態檔案資料夾，執行 `python3 tools/package.py <全新目的資料夾>`；腳本拒絕覆寫既有目的地，且不刪除檔案。

## 授權與來源

本次官方更新將程式授權改為 PolyForm Noncommercial 1.0.0；保留 `LICENSE`、`LICENSE-NONCOMMERCIAL.md` 及 Required Notice。之前 MIT 版本的聲明另存 `LICENSE-UPSTREAM-MIT.txt`。SpriteCollab 圖像 CC BY-NC 4.0、Pixelify Sans 字型 OFL；保留 `CREDITS.md` 和 `assets/fonts/OFL.txt`。Pokémon 相關商標與角色屬原權利人。本專案是個人、非商業的 fan game 修改版。

觸控座標依畫布實際位置與顯示比例換算；畫布大小透過 ResizeObserver、visualViewport 與主畫面返回事件同步。`tests/touch.test.cjs` 涵蓋下方技能命中、縮放／位移、多指操作、觸控中斷，以及不觸發 window resize 的尺寸變化。實體 iPhone 的系統手勢與主畫面 App 行為仍需實機驗證。

主畫面／全螢幕模式的戰鬥畫布使用 `100lvh`（舊版回退 `100vh`）填滿視窗，避開 iOS 主畫面模式可能少算動態高度而留下黑邊的情況；一般瀏覽器維持 `100dvh` 以配合工具列。安全區只影響 HUD 控制項邊距，不縮短整張畫布。相關 WebKit 回報：[254868](https://bugs.webkit.org/show_bug.cgi?id=254868)。

## 繁體中文

沒有指定語言時預設繁體中文；已儲存的英文／西班牙文選擇會保留。可在「設定 → 畫面 → 語言」切換。涵蓋主選單、問答、圖鑑、招式、戰鬥提示、道具、抽獎、任務、成就及原作歷史更新。原作歷史公告中的官方後端、排行榜與直播說明不表示本站啟用相同服務。

新增的 `js/data/lang-zh-hant.js` 只翻譯顯示文字，角色編號、招式 ID、帳號名稱與存檔結構不變。中文名稱來源及授權列於 CREDITS.md，不依賴線上翻譯或遠端字型。`tests/i18n.test.cjs` 驗證原字典覆蓋、動態數值欄位、可遊玩寶可夢名稱、Canvas 文字測量、帳號名稱排除、語言切換與存檔保留。
