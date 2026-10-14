# PokéSurvivor — iPhone 本機存檔版

此版本從已驗證的 `PokeSurvivor-Cheats` 複製並調整，保留原作遊戲及 UI。原作者：[JPTER78/pokesurvivor](https://github.com/JPTER78/pokesurvivor)。這是個人使用的非官方單人修改版。

此版本使用 GitHub Pages 靜態託管，本機與部署後皆不會同步到官方伺服器。

## 執行方式與資料位置

- 正式環境只需要 GitHub Pages 提供 HTML、CSS、JavaScript、字型及圖片，不需要 Mac、Python、Node 或任何自建後端持續運作。
- `index.html` 是首頁，直接載入修改過的分檔 JavaScript；沒有 `app.min.js`。`dev.html` 導向同一首頁，避免版本分歧。
- `js/core/db.js` 只有本機資料層，沒有 Firebase SDK 或雲端登入／同步程式碼；`firebase-config.js` 固定為 `null`。
- 好友、多人連線與排行榜已停用。沿用部分原作網路模組中的共用功能（例如任務日期），但 `DB.online` 永遠為 false、`DB.fb` 永遠為 null。CSP 額外限制連線只能到網站自己的來源。
- 所有資源使用相對路徑，支援 GitHub Pages 的 `/pokesurvivor-mobile/` 子路徑。

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
node --test tests/storage.test.cjs
python3 -m http.server 8765 --bind 127.0.0.1
```

只為本機預覽使用 HTTP 伺服器。可用 `http://127.0.0.1:8765/`；發布後不需要執行這些程式。不要直接用 `file://` 測試 PWA。

`tests/smoke.py` 是 Python Playwright 的完整瀏覽器回歸測試，需已安裝 Playwright／Chromium。可用 `GAME_URL` 指定測試網址、`CHROMIUM_EXECUTABLE` 指定 Chromium。測試只使用獨立臨時瀏覽器 profile，結果位於忽略提交的 `test-results/`。當測試網址不使用預設連接埠時，需同步調整外部請求檢查的允許來源。

## GitHub Pages 發布準備

使用 Repository 的 Settings → Pages → Source 選 **GitHub Actions**。推送 `main` 後，`.github/workflows/pages.yml` 會建置、驗證、測試、打包並發布。部署狀態以 GitHub Actions 顯示的結果為準。

發布內容不包含 `test-results/`、個人存檔或測試瀏覽器 profile。

### 搜尋引擎收錄

首頁與 `dev.html` 設有 `noindex, nofollow, noimageindex`，不產生 sitemap。遵守這些指令的搜尋引擎應不收錄遊戲頁面。沒有用 robots.txt 阻止爬取，讓搜尋引擎能讀取 noindex。

這不是登入或存取權限控管：知道網址的人仍可開啟；公開 GitHub Repository 本身也可能被搜尋到。不能保證所有搜尋引擎或爬蟲都遵守，遊戲存檔仍只在自己的瀏覽器。參考 [Google noindex 文件](https://developers.google.com/search/docs/crawling-indexing/block-indexing)。

部署工作流程依據 [GitHub Pages 官方自訂工作流程文件](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。若只需產生靜態檔案資料夾，執行 `python3 tools/package.py <全新目的資料夾>`；腳本拒絕覆寫既有目的地，且不刪除檔案。

## 授權與來源

原作程式 MIT、SpriteCollab 圖像 CC BY-NC 4.0、Pixelify Sans 字型 OFL；保留原有 `LICENSE`、`CREDITS.md` 和 `assets/fonts/OFL.txt`。Pokémon 相關商標與角色屬原權利人。本專案是個人、非商業的 fan game 修改版。
