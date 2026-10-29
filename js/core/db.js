/* Local-only persistence; adapted from JPTER78 db.js (MIT).
 * Stable storage namespace: never put a release/build number in these keys.
 * Cloud identity/sync is optional and isolated in cloud.js; original backend stays disabled.
 */
G.DB = (() => {
  const PREFIX = 'pokesurvivor.mobile.';
  const K_ACC = PREFIX + 'accounts', K_SES = PREFIX + 'session', K_SAVE = PREFIX + 'save.';
  // v6 prevents older cloud clients from dropping Halloween costumes and selections.
  const VERSION = 6, START_COINS = 999999;
  const REFILL = Object.freeze({ coins: 999999999, t1: 999999, t10: 999999 });
  const VALID = /^[A-Za-z0-9_ñÑáéíóúÁÉÍÓÚ]{3,16}$/;
  let user = null, key = null, save = null, guest = false, storageOk = true, stale = false;
  const listeners = new Set(), leaveHooks = [];
  function notify(message) {
    window.dispatchEvent(new CustomEvent('mobile-storage-warning', { detail: message }));
  }
  function read(k) {
    const raw = localStorage.getItem(k);
    if (raw === null) return null;
    return JSON.parse(raw); // A corrupt save must never silently become a new save.
  }
  function write(k, value) {
    try { localStorage.setItem(k, JSON.stringify(value)); storageOk = true; return true; }
    catch { storageOk = false; notify('無法儲存進度。請立即匯出備份，並確認儲存空間與瀏覽器設定。'); return false; }
  }
  function newSave(name) {
    return {
      v: VERSION,
      name,
      created: Date.now(),
      updated: Date.now(),    // última modificación (para fusionar)
      coins: START_COINS,
      owned: {},              // dex -> { at, from: 'starter'|'gacha'|'wild' }
      shiny: {},              // dex -> { at, from } — variantes shiny conseguidas
      partner: null,          // dex del Pokémon con el que juegas
      partnerShiny: false,    // jugar con su versión shiny (si la tienes)
      starter: null,          // dex que te tocó en el test
      personality: null,      // { trait, scores }
      upgrades: {},           // (antiguo) mejoras de la cuenta; ahora van por Pokémon
      pupg: {},               // dex -> { id -> nivel }: mejoras de cada Pokémon
      dfav: {},               // collection favorites: signed timestamp
      pused: {},              // completed runs with each Pokémon
      pstart: {},             // selected starting move for each Pokémon
      pstart2: {},            // second starting move
      bag: {}, tms: {}, ptm: {}, pnat: {}, pabil: {},
      skins: {},             // purchased costume id -> timestamp (permanent)
      pskin: {},             // dex -> [costume id or '', timestamp]
      tickets: { t1: 999, t10: 999 },   // tickets del gacha (x1 y x10)
      pity: {},               // generación del banner -> tiradas sin ★5
      legends: {},            // dex -> fecha: legendarios vencidos en grietas
      arenas: {},             // tipo -> fecha: arenas de grieta ganadas
      itemsFound: {},         // id -> fecha: objetos equipables encontrados
      evoMoves: {},           // id -> fecha: movimientos evolucionados alguna vez
      ach: {},                // id -> fecha: logros conseguidos
      missions: {},           // misiones del día / semana (systems/progress.js)
      profile: { favs: [], title: '' },   // perfil público: 3 favoritos y título
      stats: { runs: 0, bestTime: 0, bestLevel: 0, totalKills: 0, pulls: 0, coinsEarned: 0, shinies: 0,
               bossesTotal: 0, riftWins: 0, evolutions: 0, missionsDone: 0, groupRuns: 0, bestGroupTime: 0 }
    };
  }

  /** Rellena campos que falten en partidas de versiones anteriores. */
  function migrate(s, name) {
    const base = newSave(name || s.name);
    // Migration never refills existing currency or tickets.
    base.coins = 0; base.tickets = { t1: 0, t10: 0 };
    for (const k in base) if (s[k] == null) s[k] = base[k];
    for (const k in base.stats) if (s.stats[k] == null) s.stats[k] = base.stats[k];
    // v1 -> v2: había un único banner (Kanto) con el pity como número.
    if (typeof s.pity === 'number') s.pity = { 1: s.pity };
    // v2 -> v3: las mejoras eran de la cuenta; pasan al compañero de entonces.
    if (!s.pupgDone) {
      if (s.partner && Object.values(s.upgrades || {}).some(v => v > 0)) {
        s.pupg[s.partner] = Object.assign({}, s.upgrades);
      }
      s.pupgDone = true;
    }
    s.tickets = Object.assign({ t1: 0, t10: 0 }, s.tickets);
    sanitize(s);
    s.v = VERSION;
    return s;
  }

  /**
   * Quita lo imposible de una partida editada a mano (la copia del navegador
   * se puede tocar): números negativos o raros, mejoras por encima del
   * máximo y Pokémon que no existen. Esta edición sólo usa almacenamiento local.
   */
  function sanitize(s) {
    const n = v => (Number.isFinite(+v) && +v > 0 ? Math.floor(+v) : 0);
    s.coins = n(s.coins);
    s.tickets.t1 = n(s.tickets.t1);
    s.tickets.t10 = n(s.tickets.t10);
    if (G.DEX_BY) for (const coll of ['owned', 'shiny', 'dfav', 'pused', 'pstart']) {
      for (const d of Object.keys(s[coll] || {})) if (!G.DEX_BY[d]) delete s[coll][d];
    }
    for (const coll of ['dfav', 'pused']) {
      if (!s[coll] || typeof s[coll] !== 'object' || Array.isArray(s[coll])) s[coll] = {};
      for (const d of Object.keys(s[coll])) {
        if (!Number.isSafeInteger(s[coll][d]) || (coll === 'pused' && s[coll][d] < 0)) delete s[coll][d];
      }
    }
    for (const k of ['pstart', 'pstart2']) {
      if (!obj(s[k])) s[k] = {};
      for (const d of Object.keys(s[k])) {
        if (typeof s[k][d] !== 'string' || (G.DEX_BY && !G.DEX_BY[d]) || (G.Moves && !G.Moves.BY_ID[s[k][d]])) delete s[k][d];
      }
    }
    // Mochila y MT: cuántas de cada cosa que exista (tope 999).
    for (const [k, ok] of [['bag', id => !G.Shop || G.Shop.ITEMS[id]], ['tms', id => !G.Moves || G.Moves.BY_ID[id]]]) {
      if (!obj(s[k])) s[k] = {};
      for (const id of Object.keys(s[k])) {
        s[k][id] = Math.min(999, n(s[k][id]));
        if (!s[k][id] || !ok(id)) delete s[k][id];
      }
    }
    // MT aprendidas: movimientos que existen, sin repetir.
    if (!obj(s.ptm)) s.ptm = {};
    for (const d of Object.keys(s.ptm)) {
      const l = Array.isArray(s.ptm[d]) ? s.ptm[d] : [];
      s.ptm[d] = [...new Set(l.filter(id => typeof id === 'string' && (!G.Moves || G.Moves.BY_ID[id])))];
      if (!s.ptm[d].length || (G.DEX_BY && !G.DEX_BY[d])) delete s.ptm[d];
    }
    // Naturaleza y habilidad elegidas: [valor, fecha].
    for (const [k, ok] of [['pnat', v => typeof v === 'string' && (!G.NATURE_BY || G.NATURE_BY[v])], ['pabil', v => v === 0 || v === 1 || v === 2]]) {
      if (!obj(s[k])) s[k] = {};
      for (const d of Object.keys(s[k])) {
        const e = s[k][d];
        if (!Array.isArray(e) || !ok(e[0]) || (G.DEX_BY && !G.DEX_BY[d])) delete s[k][d];
        else s[k][d] = [e[0], n(e[1])];
      }
    }
    // Costumes persist after Halloween; only owned costumes for the matching Pokémon can be worn.
    if (!obj(s.skins)) s.skins = {};
    for (const id of Object.keys(s.skins)) {
      if ((G.Skins && !Object.hasOwn(G.Skins.SKINS, id)) || !Number.isSafeInteger(s.skins[id]) || s.skins[id] <= 0) delete s.skins[id];
    }
    if (!obj(s.pskin)) s.pskin = {};
    for (const d of Object.keys(s.pskin)) {
      const e = s.pskin[d], id = Array.isArray(e) ? e[0] : null;
      if (typeof id !== 'string' || (G.DEX_BY && !G.DEX_BY[d]) || !Number.isSafeInteger(e[1]) || e[1] < 0 ||
          (id && (!Object.hasOwn(s.skins, id) || (G.Skins && (!Object.hasOwn(G.Skins.SKINS, id) || G.Skins.SKINS[id].dex !== +d))))) delete s.pskin[d];
      else s.pskin[d] = [id, e[1]];
    }
    // Atajos: 4 huecos con un movimiento que exista (o null), sin repetir.
    if (s.pbind && typeof s.pbind === 'object') {
      for (const d of Object.keys(s.pbind)) {
        const l = Array.isArray(s.pbind[d]) ? s.pbind[d].slice(0, 4) : [];
        const seen = new Set();
        s.pbind[d] = [0, 1, 2, 3].map(i => {
          const id = l[i];
          if (typeof id !== 'string' || (G.Moves && !G.Moves.BY_ID[id]) || seen.has(id)) return null;
          seen.add(id); return id;
        });
      }
    } else s.pbind = {};
    // Veto: listas de movimientos que existen, sin repetir, como mucho 3.
    if (s.pban && typeof s.pban === 'object') {
      for (const d of Object.keys(s.pban)) {
        const l = Array.isArray(s.pban[d]) ? s.pban[d] : [];
        s.pban[d] = [...new Set(l.filter(id => typeof id === 'string' && (!G.Moves || G.Moves.BY_ID[id])))].slice(0, 3);
      }
    } else s.pban = {};
    if (G.Upgrades) for (const d of Object.keys(s.pupg || {})) {
      const u = s.pupg[d];
      if (!u || typeof u !== 'object') { delete s.pupg[d]; continue; }
      for (const id of Object.keys(u)) {
        if (!G.Upgrades.BY[id]) delete u[id];
        else u[id] = Math.min(G.Upgrades.BY[id].max, n(u[id]));
      }
    }
  }

  async function hash(pass, salt) {
    const text = salt + ':' + pass;
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    }
    return 'f' + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
  }

  function randomSalt() {
    const a = new Uint8Array(12);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < a.length; i++) a[i] = Math.random() * 256;
    return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  function validTree(value, depth = 0) {
    if (depth > 12) throw new Error('存檔結構過深。');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('存檔數字無效。');
    if (value && typeof value === 'object') {
      for (const k of Object.keys(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(k)) throw new Error('存檔欄位無效。');
        validTree(value[k], depth + 1);
      }
    }
  }
  function validateSave(input, name) {
    validTree(input);
    if (!obj(input) || !Number.isInteger(input.v) || input.v < 1 || input.v > VERSION) throw new Error('不支援此存檔版本。');
    if (!obj(input.owned) || !obj(input.stats)) throw new Error('存檔缺少遊戲資料。');
    for (const k of ['coins', 'created', 'updated']) {
      if (input[k] != null && (!Number.isSafeInteger(input[k]) || input[k] < 0)) throw new Error('存檔數字無效：' + k);
    }
    const sample = newSave(name);
    const result = {};
    // Export/import only game fields, never account hashes, salts, tokens or sessions.
    for (const k of [...Object.keys(sample), 'pupgDone', 'pbind', 'pban']) {
      if (Object.hasOwn(input, k)) result[k] = structuredClone(input[k]);
    }
    for (const k of Object.keys(sample).filter(k => obj(sample[k]))) {
      if (result[k] != null && !obj(result[k]) && !(k === 'pity' && typeof result[k] === 'number')) throw new Error('存檔欄位格式無效：' + k);
    }
    for (const [k, v] of Object.entries(result.stats || {})) {
      if (!Number.isFinite(v) || v < 0) throw new Error('統計欄位無效：' + k);
    }
    for (const v of Object.values(result.tickets || {})) if (!Number.isSafeInteger(v) || v < 0) throw new Error('抽獎券數量無效。');
    for (const k of ['partner','starter']) {
      if (result[k] != null && (!Number.isInteger(result[k]) || !G.DEX_BY[result[k]])) throw new Error('未知的 Pokémon。');
    }
    if (result.partner != null && !result.owned[result.partner]) throw new Error('存檔缺少夥伴 Pokémon。');
    if (result.profile && (!Array.isArray(result.profile.favs) || typeof result.profile.title !== 'string')) throw new Error('個人檔案無效。');
    if (result.personality != null && !obj(result.personality)) throw new Error('性格資料無效。');
    result.name = name; // Use the validated local account name, never imported HTML.
    return migrate(result, name);
  }
  function load(k, name) {
    try {
      const s = read(K_SAVE + k);
      if (!s) throw new Error('找不到存檔');
      return validateSave(s, name);
    } catch {
      // Retain the damaged primary data; recovery is read-only until a later commit.
      const backup = read(K_SAVE + k + '.previous');
      if (!backup) throw new Error('存檔無法讀取；原始資料已保留。請匯入備份，或使用另一個本機帳號。');
      const recovered = validateSave(backup, name);
      notify('主存檔損毀，已載入上一份自動備份。請立即匯出確認。');
      return recovered;
    }
  }
  function begin(k, name, s) {
    key = k; user = name; save = s; guest = false; stale = false;
    write(K_SES, k);
  }
  let readyP;
  function ready() {
    if (!readyP) readyP = Promise.resolve().then(() => {
      try {
        const k = read(K_SES), accs = read(K_ACC) || {};
        if (!k || !Object.hasOwn(accs, k)) return false;
        begin(k, accs[k].name, load(k, accs[k].name)); return true;
      } catch (e) { storageOk = false; notify(e.message); return false; }
    });
    return readyP;
  }
  async function register(name, pass) {
    name = (name || '').trim();
    if (!VALID.test(name)) return { ok: false, error: '名稱需為 3–16 個英文字母、數字或底線。' };
    if (typeof pass !== 'string' || pass.length < 4 || pass.length > 64) return { ok: false, error: '本機密碼需為 4–64 個字元。' };
    try {
      const accs = read(K_ACC) || {}, k = name.toLowerCase();
      if (Object.hasOwn(accs, k)) return { ok: false, error: '此本機名稱已存在。' };
      const salt = randomSalt(), s = newSave(name);
      // A failed registration must not replace an existing/orphaned save.
      if (localStorage.getItem(K_SAVE + k) !== null) throw new Error('此名稱已有存檔，請使用另一個名稱。');
      accs[k] = { name, salt, hash: await hash(pass, salt), created: Date.now() };
      if (!write(K_SAVE + k, s) || !write(K_ACC, accs)) throw new Error('無法建立本機存檔。');
      begin(k, name, s); return { ok: true, isNew: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  async function login(name, pass) {
    try {
      const k = (name || '').trim().toLowerCase(), accs = read(K_ACC) || {};
      const a = Object.hasOwn(accs, k) && accs[k];
      if (!a || a.hash !== await hash(pass || '', a.salt)) return { ok: false, error: '本機帳號或密碼錯誤。' };
      begin(k, a.name, load(k, a.name)); return { ok: true, isNew: !save.partner };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  function useCloud(id, next) {
    const k = "@cloud:" + id, s = validateSave(next, next.name);
    const accs = read(K_ACC) || {};
    accs[k] = { name:s.name, cloud:true };
    if (!write(K_ACC, accs) || !write(K_SAVE + k, s)) throw new Error("無法保存雲端存檔的本機副本。");
    begin(k, s.name, s);
  }
  function persist(next) {
    if (!key || guest || stale) return false;
    try {
      const old = localStorage.getItem(K_SAVE + key);
      // Keep one valid previous revision. Never rotate corrupted data over a good backup.
      if (old) {
        try { validateSave(JSON.parse(old), user); localStorage.setItem(K_SAVE + key + '.previous', old); }
        catch (e) { if (e.name === 'QuotaExceededError' || e.name === 'SecurityError') throw e; }
      }
      if (key.startsWith("@cloud:")) G.Cloud.capture(validateSave(next, user));
      if (!write(K_SAVE + key, next)) return false;
      listeners.forEach(fn => fn('local')); return true;
    } catch { storageOk = false; notify('存檔空間不足或無法寫入。請立即匯出備份。'); return false; }
  }
  function commit() {
    if (!save || !key || guest || stale) return false;
    save.updated = Date.now();
    return persist(save);
  }
  function exportSave() {
    if (!save) throw new Error('請先建立或登入本機帳號。');
    return JSON.stringify({ format: 'pokesurvivor-mobile', version: 1, exportedAt: new Date().toISOString(), save: validateSave(save, user) }, null, 2);
  }
  function previewImport(text) {
    if (typeof text !== 'string' || new Blob([text]).size > 5 * 1024 * 1024) throw new Error('備份檔上限為 5 MB。');
    const data = JSON.parse(text);
    if (data.format !== 'pokesurvivor-mobile' || data.version !== 1) throw new Error('請選擇此版本匯出的 JSON 備份檔。');
    const s = validateSave(data.save, user || 'Preview');
    return { coins: s.coins, tickets: s.tickets, pokemon: Object.keys(s.owned).length, updated: s.updated };
  }
  function importSave(text) {
    if (!key || guest || stale) throw new Error('請先登入本機帳號；訪客或舊分頁無法匯入。');
    previewImport(text);
    const next = validateSave(JSON.parse(text).save, user);
    next.updated = Date.now();
    if (!persist(next)) throw new Error('匯入未完成；目前進度仍保留在記憶體，請先匯出。');
    save = next; return true;
  }
  function playAsGuest() {
    user = 'Invitado'; key = null; guest = true; save = newSave(user);
    try { localStorage.removeItem(K_SES); } catch { /* Guest never persists. */ }
    return { ok: true, isNew: true };
  }
  async function logout() {
    for (const fn of leaveHooks) { try { await fn('logout'); } catch {} }
    if (!guest) commit();
    if (key?.startsWith("@cloud:")) await G.Cloud.disconnect();
    try { localStorage.removeItem(K_SES); } catch {}
    user = key = save = null; guest = false;
  }
  async function deleteAccount(pass) {
    if (key?.startsWith("@cloud:")) return { ok:false, error:"雲端帳號刪除請聯絡網站管理者；登出不會刪除進度。" };
    if (!key || guest || stale) return { ok: false, error: '沒有可刪除的本機帳號。' };
    try {
      const accs = read(K_ACC) || {}, a = accs[key];
      if (!a || a.hash !== await hash(pass || '', a.salt)) return { ok: false, error: '本機密碼錯誤。' };
      delete accs[key];
      if (!write(K_ACC, accs)) return { ok: false, error: '無法刪除本機帳號。' };
      localStorage.removeItem(K_SAVE + key);
      localStorage.removeItem(K_SAVE + key + '.previous');
      localStorage.removeItem(K_SES);
      user = key = save = null; return { ok: true };
    } catch { return { ok: false, error: '無法刪除本機帳號。' }; }
  }
  function owns(dex) { return !!(save && save.owned[dex]); }
  function grant(dex, from) { if (!owns(dex)) save.owned[dex] = { at: Date.now(), from }; }
  function ownsShiny(dex) { return !!(save && save.shiny[dex]); }
  function grantShiny(dex, from) { grant(dex, from); if (ownsShiny(dex)) return false; save.shiny[dex] = { at: Date.now(), from }; return true; }
  function upgradesOf(dex) { if (!save) return {}; return save.pupg[dex] || (save.pupg[dex] = {}); }
  function isFav(dex) { return !!(save && save.dfav && save.dfav[dex] > 0); }
  function setFav(dex, on) {
    if (!save || !G.DEX_BY[dex]) return;
    save.dfav[dex] = on ? Date.now() : -Date.now(); commit();
  }
  function refillResources() {
    if (!save || !key || guest) throw new Error('請先登入本機或雲端帳號，再補滿資源。');
    if (stale) throw new Error('這個視窗的存檔已過期，請重新載入。');
    if (G.Game?.state && !['ui', 'over'].includes(G.Game.state)) throw new Error('請先結束戰鬥，再補滿資源。');
    if (G.Cloud?.conflict) throw new Error('請先解決雲端存檔衝突，再補滿資源。');
    // Top up only. Never reduce earned currency, reset collection, or replay on boot.
    save.coins = Math.max(save.coins, REFILL.coins);
    save.tickets.t1 = Math.max(save.tickets.t1, REFILL.t1);
    save.tickets.t10 = Math.max(save.tickets.t10, REFILL.t10);
    if (!commit()) throw new Error('資源尚未成功儲存，請匯出備份並確認儲存空間。');
    return { coins: save.coins, ...save.tickets };
  }
  function setName(n) { if (VALID.test(n) && save) { save.name = n; commit(); } }
  // Block stale-tab writes so two open windows cannot silently roll back progress.
  addEventListener('storage', e => {
    if (key && [K_SAVE + key, K_SES, K_ACC].includes(e.key)) {
      stale = true;
      window.dispatchEvent(new CustomEvent('mobile-save-conflict'));
    }
  });
  addEventListener('pagehide', () => commit());
  document.addEventListener('visibilitychange', () => { if (document.hidden) commit(); });
  const unavailable = async () => ({ ok: false, error: '本機版停用線上帳號功能。' });
  return { ready, register, login, playAsGuest, logout, deleteAccount, commit, exportSave, previewImport, importSave,
    owns, grant, ownsShiny, grantShiny, upgradesOf, isFav, setFav, refillResources, REFILL, setName, useCloud, validateSave, newSave,
    get isStale() { return stale; },
    get cloudUid() { return key?.startsWith("@cloud:") ? key.slice(7) : null; },
    loginWithGoogle: unavailable, linkGoogle: unavailable, flush: async () => commit(),
    onSync(fn) { listeners.add(fn); }, onLeave(fn) { leaveHooks.push(fn); },
    get fb() { return null; }, get online() { return false; }, get nameAccount() { return !!key; }, get hasGoogle() { return false; },
    get mode() { return key?.startsWith('@cloud:') ? 'personal-cloud' : 'local'; }, get localReason() { return 'standalone'; }, get syncState() { return !storageOk ? 'offline' : key?.startsWith('@cloud:') ? (G.Cloud?.status || 'pending') : 'local'; },
    get user() { return user; }, get guest() { return guest; }, get save() { return save; }, get loggedIn() { return !!save; },
    get storageOk() { return storageOk; }, START_COINS
  };
})();
