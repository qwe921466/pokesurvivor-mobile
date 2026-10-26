/* ============ news-ui.js — "Novedades" ============
 * Botón en la barra de arriba que abre la lista de cambios del juego
 * (js/data/changelog.js). Lleva un punto mientras haya algo que no has visto.
 */
G.NewsUI = (() => {
  const $ = G.UI.$;
  const KEY = 'ps.news.seen';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const latest = () => (G.CHANGELOG[0] || {}).d || '';
  function seen() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }

  function init() {
    const b = $('btn-news');
    b.innerHTML = G.Icons.html('book', 18) + ' <span>Novedades</span><i class="dot"></i>';
    b.onclick = open;
    $('news-close').onclick = close;
    refresh();
  }
  function refresh() { $('btn-news').classList.toggle('new', seen() < latest()); }

  function fmt(d) {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString(G.I18n.lang === 'zh-Hant' ? 'zh-TW' : G.I18n.lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function open() {
    const en = G.I18n.lang === 'en' ? 1 : 0;
    const text = pair => G.I18n.lang === 'zh-Hant' ? G.T(pair[0]) : pair[en];
    // Cada texto ya va en su idioma: translate="no" para que no lo toque i18n.
    const PARTS = [['new', ['Nuevo', 'New']], ['chg', ['Cambios', 'Changes']], ['fix', ['Arreglos', 'Fixes']]];
    $('news-body').innerHTML = (G.I18n.lang === 'zh-Hant' ? '<p class="note" translate="no">已整合官方截至 2026/10/26 的遊戲更新。本站保留獨立雲端存檔、補滿資源及房間碼多人合作。以下含原作歷史公告；官方帳號、好友、直播、排行榜改版與重置不套用於本站，既有紀錄保留。</p>' : '') + G.CHANGELOG.map(v =>
      `<div class="news-day" translate="no"><h3>${esc(v.title ? text(v.title) : '')}<small>${fmt(v.d)}</small></h3>` +
      PARTS.filter(([k]) => v[k] && v[k].length).map(([k, lbl]) =>
        `<div class="news-part"><span class="news-tag ${k}">${esc(text(lbl))}</span><ul>${v[k].map(t => `<li>${esc(text(t))}</li>`).join('')}</ul></div>`).join('') +
      '</div>').join('');
    $('news-body').scrollTop = 0;
    $('scr-news').classList.remove('hidden');
    try { localStorage.setItem(KEY, latest()); } catch (e) { /* nada */ }
    refresh();
  }
  function close() { $('scr-news').classList.add('hidden'); }

  return { init, open, close };
})();
