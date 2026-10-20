/* Personal cloud account, explicit save conflict resolution, and casual rankings. */
G.CloudUI = (() => {
  const $ = id => document.getElementById(id);
  const panel = document.createElement('section');
  panel.id = 'mobile-cloud'; panel.className = 'scr dim hidden'; panel.setAttribute('translate','no');
  panel.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="cloud-title" style="width:min(620px,100%)">
    <h2 id="cloud-title">雲端帳號與同步</h2>
    <p class="note">手機與電腦使用相同電子郵件登入，就能接續已結算的進度。請等到「已同步」後再換裝置。進行中的戰鬥不會跨裝置接續。</p>
    <p id="cloud-status" class="sub" role="status"></p>
    <div id="cloud-auth">
      <div class="row"><button class="btn" id="cloud-mode-login">登入雲端</button><button class="btn" id="cloud-mode-register">建立雲端帳號</button></div>
      <form id="cloud-form">
        <label for="cloud-email">電子郵件（不公開）</label><input class="field" id="cloud-email" type="email" autocomplete="username" required maxlength="254">
        <div id="cloud-name-row" class="hidden"><label for="cloud-name">排行榜暱稱（3–16 個英文字母、數字或底線，可與他人同名）</label><input class="field" id="cloud-name" maxlength="16" pattern="[A-Za-z0-9_]{3,16}" autocomplete="nickname"></div>
        <label for="cloud-pass">密碼</label><input class="field" id="cloud-pass" type="password" minlength="8" maxlength="128" autocomplete="current-password" required>
        <label id="cloud-migrate-row" class="note hidden"><input id="cloud-migrate" type="checkbox" checked> 將目前本機進度帶入新雲端存檔（保留本機原檔；已有雲端存檔時優先載入雲端）</label>
        <p class="note">帳號與存檔由本站專用 Firebase 專案保存；其他玩家可看見暱稱與排行成績；同房玩家也會看見寶可夢與戰鬥狀態。此修改版排行榜供同版本玩家交流。</p>
        <button class="btn gold" id="cloud-submit" type="submit">登入雲端</button>
        <button class="btn ghost" id="cloud-reset" type="button">寄送密碼重設信</button>
      </form>
    </div>
    <div id="cloud-account" class="hidden"><p id="cloud-email-info" class="note"></p><button class="btn gold" id="cloud-sync">立即同步</button></div>
    <div id="cloud-conflict" class="hidden"><h3>兩台裝置的進度不同</h3><p class="note">不會自動合併金幣與抽獎結果。請先下載兩份備份，再選要繼續的進度；另一份也會保留在這台裝置。</p><p id="cloud-compare" class="note"></p>
      <div class="row wrap"><button class="btn" id="cloud-backup-local">下載此裝置備份</button><button class="btn" id="cloud-backup-remote">下載雲端備份</button></div>
      <div class="row wrap"><button class="btn gold" id="cloud-use-remote">載入雲端進度</button><button class="btn" id="cloud-use-local">以此裝置進度更新雲端</button></div>
    </div>
    <p id="cloud-error" class="err" role="alert"></p><button class="btn ghost" id="cloud-close">關閉</button>
  </div>`;
  document.body.appendChild(panel);
  let mode = 'login', working = false;
  const labels = { local:'本機存檔', ok:'已同步，可以切換裝置', pending:'已存此裝置，尚待上傳', syncing:'同步中…', conflict:'存檔衝突，請選擇要接續的進度' };
  function render() {
    const cloud = !!G.DB.cloudUid;
    $('cloud-status').textContent = G.Cloud.enabled ? (labels[G.Cloud.status] || G.Cloud.status) : '雲端服務尚未設定完成；本機存檔仍可使用。';
    $('cloud-auth').classList.toggle('hidden', cloud);
    $('cloud-account').classList.toggle('hidden', !cloud);
    $('cloud-email-info').textContent = G.Cloud.account;
    $('cloud-conflict').classList.toggle('hidden', !G.Cloud.conflict);
    const describe = s => `金幣 ${s.coins.toLocaleString()}／單抽券 ${s.tickets.t1}／十連券 ${s.tickets.t10}／寶可夢 ${Object.keys(s.owned).length}／場次 ${s.stats.runs}`;
    if (G.Cloud.conflict) $('cloud-compare').textContent = '此裝置：' + describe(G.Cloud.local) + '\n雲端：' + describe(G.Cloud.conflict.save);
    $('cloud-migrate-row').classList.toggle('hidden', !G.DB.save || G.DB.guest || cloud);
    $('cloud-error').textContent = G.Cloud.message;
    for (const id of ['cloud-submit','cloud-reset','cloud-sync','cloud-use-local','cloud-use-remote']) $(id).disabled = working || !G.Cloud.enabled;
  }
  function open() {
    if (G.Game?.state && !['ui','over'].includes(G.Game.state)) { G.UI.toast('請先結束戰鬥，再回主選單管理雲端存檔。',4000); return; }
    $('cloud-name').value = G.DB.user && !G.DB.guest ? G.DB.user : '';
    render(); panel.classList.remove('hidden');
  }
  async function work(fn) {
    if (working) return; working = true; render();
    try { await fn(); } catch (e) { $('cloud-error').textContent = G.Cloud.errorText?.(e) || e.message; }
    finally { working = false; render(); }
  }
  function setMode(value) {
    mode = value; $('cloud-name-row').classList.toggle('hidden', mode !== 'register');
    $('cloud-name').required = mode === 'register';
    $('cloud-pass').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    $('cloud-submit').textContent = mode === 'register' ? '建立雲端帳號' : '登入雲端';
  }
  $('cloud-mode-login').onclick = () => setMode('login');
  $('cloud-mode-register').onclick = () => setMode('register');
  $('cloud-close').onclick = () => panel.classList.add('hidden');
  $('cloud-form').onsubmit = e => {
    e.preventDefault(); work(async () => {
      const r = await G.Cloud.authenticate(mode, $('cloud-email').value, $('cloud-pass').value, $('cloud-name').value.trim(), $('cloud-migrate').checked);
      if (!r.ok) { G.Cloud.showMessage(r.error); return; }
      $('cloud-pass').value = ''; panel.classList.add('hidden'); G.Flow.afterLogin();
      if (G.Cloud.conflict) open();
    });
  };
  $('cloud-reset').onclick = () => work(async () => {
    if (!$('cloud-email').validity.valid || !$('cloud-email').value) { G.Cloud.showMessage('請先填寫電子郵件。'); return; }
    const r = await G.Cloud.resetPassword($('cloud-email').value);
    G.Cloud.showMessage(r.ok ? '若此電子郵件有帳號，將收到密碼重設信，請也查看垃圾郵件。' : r.error);
  });
  $('cloud-sync').onclick = () => work(() => G.Cloud.sync(true));
  for (const choice of ['local','remote']) $('cloud-use-' + choice).onclick = () => work(async () => {
    if (!confirm(choice === 'local' ? '確認以此裝置的進度更新雲端？兩份進度都會先保留備份。' : '確認載入雲端進度？此裝置原進度會先保留備份。')) return;
    if (await G.Cloud.resolve(choice)) panel.classList.add('hidden');
  });
  function download(s, label) {
    const safe = G.DB.validateSave(s,s.name);
    const blob = new Blob([JSON.stringify({format:'pokesurvivor-mobile',version:1,exportedAt:new Date().toISOString(),save:safe},null,2)],{type:'application/json'});
    const a = document.createElement('a'), url = URL.createObjectURL(blob); a.href=url; a.download='pokesurvivor-'+label+'-'+Date.now()+'.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  $('cloud-backup-local').onclick = () => download(G.Cloud.local,'device');
  $('cloud-backup-remote').onclick = () => download(G.Cloud.conflict.save,'cloud');
  addEventListener('mobile-cloud-status', () => { if (!panel.classList.contains('hidden')) render(); });
  document.querySelectorAll('.mobile-cloud-open').forEach(b => b.onclick = open);
  const ranks = document.createElement('section'); ranks.id='mobile-ranks'; ranks.className='scr dim hidden'; ranks.setAttribute('translate','no');
  ranks.innerHTML='<div class="box wide"><h2>共同排行榜</h2><p class="note">本站修改版 · 最長生存時間前 100 名 · 未完成戰鬥顯示為尚無成績。排行採玩家端回報，供休閒交流。</p><p id="mobile-rank-status" role="status"></p><div id="mobile-rank-list"></div><button class="btn ghost" id="mobile-rank-close">返回</button></div>';
  document.body.appendChild(ranks);
  $('mobile-rank-close').onclick=()=>ranks.classList.add('hidden');
  async function openRanking() {
    if (!G.DB.cloudUid) { open(); return; }
    ranks.classList.remove('hidden'); $('mobile-rank-status').textContent='讀取排行榜…'; $('mobile-rank-list').replaceChildren();
    try {
      const rows=await G.Cloud.rankings();
      rows.forEach((r,i)=>{
        const row=document.createElement('div'); row.className='rk-row'+(r.mine?' mine':'');
        const pos=document.createElement('span');pos.className='pos';pos.textContent=String(i+1);row.appendChild(pos);
        const who=document.createElement('span');who.className='who';who.textContent=r.name+(r.mine?'（你）':'');row.appendChild(who);
        const detail=document.createElement('span');detail.className='note';detail.textContent=r.time ? `${G.T(G.DEX_BY[r.dex]?.name||'')} · 等級 ${r.level} · ${r.kills} 擊殺` : '尚無成績';row.appendChild(detail);
        const time=document.createElement('span');time.className='time';time.textContent=G.U.mmss(r.time);row.appendChild(time);$('mobile-rank-list').appendChild(row);
      });
      $('mobile-rank-status').textContent=rows.length?'':'尚無玩家成績。';
    } catch(e) { $('mobile-rank-status').textContent=G.Cloud.errorText(e); }
  }
  return {open,openRanking};
})();
