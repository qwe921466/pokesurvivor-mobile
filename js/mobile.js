/* Personal edition controls. Original game screens and combat remain intact. */
(() => {
  const $ = id => document.getElementById(id);
  let warning = '';
  const panel = document.createElement('section');
  panel.id = 'mobile-backup'; panel.className = 'scr dim hidden'; panel.setAttribute('translate', 'no');
  panel.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="backup-title" style="width:min(620px,100%)">
    <h2 id="backup-title">存檔與備份</h2><button class="btn gold mobile-cloud-open" type="button">雲端帳號與同步</button>
    <p class="note">Pokémon、抽獎券、金幣、升級及已結算成果會保存在此裝置；雲端帳號會在連網時同步。切換裝置前請確認「已同步」。關閉後不會補滿初始資源。進行中的戰鬥不支援關閉後從原地繼續。</p>
    <p id="mobile-save-info" class="sub"></p>
    <button class="btn gold" id="mobile-refill" type="button">補滿資源</button>
    <p class="note">金幣補到 999,999,999；單抽券、十連券各補到 999,999。可重複使用，購買與抽獎仍正常扣除。既有資源高於此數量時不會減少。</p>
    <div class="row"><button class="btn gold" id="mobile-export">匯出 JSON 備份</button><button class="btn" id="mobile-import">匯入備份</button></div>
    <input id="mobile-import-file" type="file" accept=".json,application/json" hidden>
    <p id="mobile-backup-status" class="note" role="status" aria-live="polite"></p>
    <h3>在 iPhone 上使用</h3>
    <p class="note">用 Safari 開啟正式 HTTPS 網址 → 分享 → 加入主畫面（如有選項，啟用「作為網頁 App 開啟」）→ 從圖示開啟，將手機橫放。Safari 與主畫面 App 的本機存檔可能分開；雲端帳號可登入同一帳號同步，本機帳號請先匯出再匯入。</p>
    <p class="note">下載備份時可使用「儲存到檔案」。換手機可登入同一雲端帳號，或建立本機帳號後匯入 JSON 備份。備份沒有密碼或登入權杖。</p>
    <p class="note">請避免無痕模式。清除網站資料或系統回收儲存空間會影響本機存檔，請定期另存備份。快取只涵蓋核心程式及已載入素材；首次或尚未載入的內容需要網路。</p>
    <button class="btn" id="mobile-persist">請求持續保留網站資料</button>
    <button class="btn ghost" id="mobile-backup-close">關閉</button>
  </div>`;
  document.body.appendChild(panel);
  panel.querySelector('.mobile-cloud-open').onclick = () => { panel.classList.add('hidden'); G.CloudUI.open(); };
  const alert = document.createElement('div');
  alert.id = 'mobile-storage-alert'; alert.className = 'hidden'; alert.setAttribute('translate','no');
  alert.innerHTML = '<span></span> <button class="btn small">匯出備份</button>';
  document.body.appendChild(alert);
  function open() {
    panel.classList.remove('hidden');
    const s = G.DB.save;
    $('mobile-save-info').textContent = s ? `${G.DB.guest ? '訪客（不會存檔）' : (G.DB.cloudUid ? '雲端帳號 ' : '本機帳號 ') + G.DB.user} · 金幣 ${s.coins.toLocaleString()} · 單抽券 ${s.tickets.t1} · 十連券 ${s.tickets.t10}` : '請先建立本機帳號；匯入會覆蓋目前登入帳號的進度。';
    $('mobile-export').disabled = !s;
    $('mobile-import').disabled = !s || G.DB.guest;
    $('mobile-refill').disabled = !s || G.DB.guest || G.DB.isStale;
    $('mobile-backup-status').textContent = warning;
  }
  document.querySelectorAll('.mobile-backup-open').forEach(b => b.onclick = open);
  alert.querySelector('button').onclick = open;
  $('mobile-backup-close').onclick = () => panel.classList.add('hidden');
  $('mobile-refill').onclick = async () => {
    const btn = $('mobile-refill'); btn.disabled = true;
    try {
      const account = G.DB.cloudUid || G.DB.user;
      if (G.DB.cloudUid) await G.Cloud.sync(true);
      if (account !== (G.DB.cloudUid || G.DB.user)) throw new Error('帳號已切換，請重新開啟此面板。');
      G.DB.refillResources();
      G.UI.refreshCoins();
      if (G.DB.cloudUid) await G.Cloud.sync();
      open();
      $('mobile-backup-status').textContent = G.DB.cloudUid && G.Cloud.status !== 'ok'
        ? '資源已補滿並保存在此裝置，雲端尚待同步；請等到「已同步」再換裝置。'
        : '資源已補滿並儲存。';
    } catch (e) { $('mobile-backup-status').textContent = e.message; }
    finally { btn.disabled = !G.DB.save || G.DB.guest || G.DB.isStale; }
  };
  $('mobile-export').onclick = () => {
    try {
      const text = G.DB.exportSave();
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `pokesurvivor-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      $('mobile-backup-status').textContent = '已產生備份。請在下載項目／檔案 App 確認 JSON 檔案已保存。';
    } catch (e) { $('mobile-backup-status').textContent = e.message; }
  };
  $('mobile-import').onclick = () => $('mobile-import-file').click();
  $('mobile-import-file').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('備份檔上限為 5 MB。');
      const text = await file.text(), p = G.DB.previewImport(text);
      const yes = confirm(`匯入到本機帳號 ${G.DB.user}？\n金幣 ${p.coins}／單抽券 ${p.tickets.t1}／十連券 ${p.tickets.t10}／Pokémon ${p.pokemon}\n\n這會覆蓋此帳號的目前進度，並保留一份上一版自動備份。建議先手動匯出。`);
      if (!yes) return;
      G.DB.importSave(text);
      location.reload();
    } catch (e) { $('mobile-backup-status').textContent = e.message; }
    finally { e.target.value = ''; }
  };
  $('mobile-persist').onclick = async () => {
    try {
      const ok = navigator.storage && navigator.storage.persist && await navigator.storage.persist();
      $('mobile-backup-status').textContent = ok ? '瀏覽器已允許持續保留；仍請定期匯出備份。' : '瀏覽器未授予或不支援持續保留。可從主畫面開啟再試，並定期匯出。';
    } catch { $('mobile-backup-status').textContent = '無法請求；請定期匯出備份。'; }
  };
  addEventListener('mobile-storage-warning', e => {
    warning = e.detail;
    alert.querySelector('span').textContent = warning;
    alert.classList.remove('hidden');
  });
  addEventListener('mobile-save-conflict', () => {
    G.DB.commit(); // Stale writes are rejected by DB.
    const lock = document.createElement('section'); lock.className = 'scr dim mobile-conflict'; lock.setAttribute('translate','no');
    lock.innerHTML = '<div class="box"><h2>另一個視窗已更新存檔</h2><p>此視窗已停止寫入，避免覆蓋新進度。請重新載入後繼續。</p><button class="btn gold">載入最新存檔</button></div>';
    lock.querySelector('button').onclick = () => location.reload(); document.body.appendChild(lock);
  });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).catch(() => {
      // Online play and local saves do not depend on service worker installation.
      warning = '離線快取未能啟用；連網遊玩及本機存檔仍可使用。';
    }));
  }
})();
