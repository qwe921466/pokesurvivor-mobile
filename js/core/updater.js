/* User-initiated update only. Save keys are independent of the release hash. */
G.Updater = (() => {
  const mine = document.querySelector('meta[name="mobile-build"]')?.content;
  let pending = false, button;
  async function check() {
    if (!mine || pending) return;
    try {
      const r = await fetch('./version.json', { cache: 'no-store' });
      if (!r.ok || (await r.json()).v === mine) return;
      pending = true;
      button = document.createElement('button'); button.className = 'btn gold mobile-update'; button.setAttribute('translate','no');
      button.textContent = '有新版本 · 儲存後更新';
      button.onclick = async () => {
        if (G.Game.state !== 'ui' || !G.UI.isOpen('scr-menu') || !document.getElementById('mobile-backup').classList.contains('hidden')) {
          G.UI.toast('請先回到主選單再更新。', 4000); return;
        }
        if (!G.DB.guest && !G.DB.commit()) { G.UI.toast('無法儲存，請先匯出備份。', 5000); return; }
        // No skipWaiting: other active windows keep their own complete cached release.
        location.reload();
      };
      document.body.appendChild(button);
    } catch { /* Offline: continue with the complete cached release. */ }
  }
  function init() {
    if (!mine) return;
    setInterval(check, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setTimeout(check, 30000);
  }
  return { init, check, get pending() { return pending; }, get version() { return mine; } };
})();
