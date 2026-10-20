/* Independent Firebase project: private saves + public-to-members casual leaderboard. */
G.Cloud = (() => {
  const S = G.CloudSDK, config = G.CLOUD_CONFIG;
  const enabled = !!(config?.projectId && S);
  let auth, fs, engine, uid = null, status = 'local', message = '', timer, initP, inFlight, restored = false;
  const storageKey = id => 'pokesurvivor.mobile.cloud.' + id;
  const validName = n => /^[A-Za-z0-9_]{3,16}$/.test(n);
  function emit(s, text = '') {
    status = s; message = text;
    dispatchEvent(new CustomEvent('mobile-cloud-status'));
    if (G.DB.save && G.UI) G.UI.refreshCoins();
  }
  function errorText(e) {
    if (e?.remote) return '兩台裝置都有新進度，請先選擇要保留的存檔。';
    const c = e?.code || '';
    if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return '電子郵件或密碼錯誤。';
    if (/email-already-in-use/.test(c)) return '這個電子郵件已有帳號，請改用登入。';
    if (/weak-password/.test(c)) return '請使用至少 8 個字元的密碼。';
    if (/invalid-email/.test(c)) return '請輸入有效的電子郵件。';
    if (/too-many-requests|resource-exhausted/.test(c)) return '暫時達到服務額度，請稍後重試；本機進度仍保留。';
    if (/permission-denied/.test(c)) return '雲端權限尚未設定完成，請聯絡管理者；本機進度仍保留。';
    return c ? '暫時無法連線，進度保留在此裝置，請連網後再同步。' : (e?.message || '無法完成同步。');
  }
  async function init() {
    if (!enabled) throw new Error('雲端服務尚未設定完成；本機存檔仍可使用。');
    if (!initP) initP = (async () => {
      const app = S.initializeApp(config, 'personal-mobile'); auth = S.getAuth(app); fs = S.getFirestore(app);
      // Only test copies served on localhost may opt into emulators. Production ignores this flag.
      if (config.emulator && ['localhost','127.0.0.1'].includes(location.hostname)) {
        S.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
        S.connectFirestoreEmulator(fs, '127.0.0.1', 8089);
      }
      await S.setPersistence(auth, S.browserLocalPersistence);
      await auth.authStateReady();
    })();
    return initP;
  }
  function parse(doc) {
    if (!doc.exists()) return null;
    const r = doc.data();
    if (!Number.isInteger(r.revision) || r.revision < 1) throw new Error('雲端存檔版本無效；本機副本已保留。');
    return { revision: r.revision, op: r.op, save: G.DB.validateSave(JSON.parse(r.payload), JSON.parse(r.payload).name) };
  }
  function transport(id) {
    const ref = S.doc(fs, 'mobileSaves', id);
    return {
      get: async () => parse(await S.getDocFromServer(ref)),
      put: async snapshot => S.runTransaction(fs, async tx => {
        const current = parse(await tx.get(ref));
        if (current?.op === snapshot.op) return current;
        if ((current?.revision || 0) !== snapshot.revision) {
          const e = new Error('存檔版本衝突'); e.remote = current; throw e;
        }
        const payload = JSON.stringify(snapshot.save);
        if (new Blob([payload]).size > 700000) throw new Error('存檔超過雲端容量限制，請先匯出備份。');
        const row = { payload, revision: snapshot.revision + 1, op: snapshot.op, updatedAt: S.serverTimestamp() };
        tx.set(ref, row); return { revision: row.revision, op: row.op, save: snapshot.save };
      })
    };
  }
  function activate(id, initial) {
    uid = id;
    engine = G.createCloudSync({
      read: () => { const text = localStorage.getItem(storageKey(id)); return text ? JSON.parse(text) : null; },
      write: value => localStorage.setItem(storageKey(id), JSON.stringify(value)),
      remote: transport(id), id: () => crypto.randomUUID(), validate: s => G.DB.validateSave(s, s.name)
    });
    return engine.load(initial);
  }
  function apply() {
    if (!engine?.state) return;
    const s = engine.state.save;
    G.DB.useCloud(uid, s);
  }
  async function enter(initial) {
    const id = auth.currentUser.uid;
    emit('syncing');
    try { await activate(id, initial); apply(); emit('ok'); await publishRank(); }
    catch (e) {
      if (engine?.state) apply();
      emit(engine?.conflict ? 'conflict' : 'pending', errorText(e));
      if (!engine?.state) throw e;
    }
  }
  async function restore() {
    if (restored || !enabled) return; restored = true;
    try {
      await init();
      // A local account is never silently migrated just because Firebase has a session.
      if (auth.currentUser && (!G.DB.loggedIn || G.DB.cloudUid === auth.currentUser.uid)) {
        await enter(G.DB.newSave(auth.currentUser.displayName || 'Player'));
      } else if (G.DB.cloudUid) { await G.DB.logout(); }
    } catch (e) { emit('pending', errorText(e)); }
  }
  async function authenticate(kind, email, password, name, migrate) {
    try {
      await init();
      if (kind === 'register' && (!validName(name) || password.length < 8)) throw new Error('暱稱需為 3–16 個英文字母、數字或底線；密碼至少 8 個字元。');
      const local = migrate && G.DB.save && !G.DB.guest && !G.DB.cloudUid ? JSON.parse(G.DB.exportSave()).save : null;
      if (kind === 'register') {
        await S.createUserWithEmailAndPassword(auth, email.trim(), password);
        await S.updateProfile(auth.currentUser, { displayName: name });
      } else await S.signInWithEmailAndPassword(auth, email.trim(), password);
      const display = auth.currentUser.displayName || name || 'Player';
      const initial = local || G.DB.newSave(display);
      initial.name = validName(display) ? display : 'Player';
      await enter(initial);
      return { ok: true };
    } catch (e) { return { ok: false, error: errorText(e) }; }
  }
  function capture(save) {
    if (!engine || uid !== G.DB.cloudUid) throw new Error('請先登入雲端帳號。');
    if (engine.edit(save)) { emit(engine.conflict ? 'conflict' : 'pending'); clearTimeout(timer); timer = setTimeout(() => sync(), 700); }
  }
  async function sync(refresh = false) {
    if (!engine || G.DB.isStale) return false;
    if (inFlight) return inFlight;
    const current = engine;
    inFlight = (async () => {
      try {
        emit('syncing');
        const changed = refresh ? await current.refresh() : (await current.sync(), false);
        if (current.conflict) { emit('conflict', '兩台裝置都有新進度，請先選擇要保留的存檔。'); return false; }
        if (G.DB.isStale) return false;
        if (changed) apply();
        emit(current.state.dirty ? 'pending' : 'ok');
        if (current.state.dirty) { clearTimeout(timer); timer = setTimeout(() => sync(), 700); }
        await publishRank();
        if (changed && G.Game?.state === 'ui') G.Flow.afterLogin();
        return true;
      } catch (e) { emit(current.conflict ? 'conflict' : 'pending', errorText(e)); return false; }
      finally { inFlight = null; }
    })();
    return inFlight;
  }
  async function resolve(choice) {
    try { await engine.resolve(choice); apply(); emit(engine.state.dirty ? 'pending' : 'ok'); G.Flow.afterLogin(); return true; }
    catch (e) { emit(engine.conflict ? 'conflict' : 'pending', errorText(e)); return false; }
  }
  async function disconnect() {
    clearTimeout(timer); if (engine) await sync();
    if (auth) await S.signOut(auth);
    uid = null; engine = null; lastRankPublished = ''; emit('local');
  }
  async function resetPassword(email) {
    try { await init(); await S.sendPasswordResetEmail(auth, email.trim()); return { ok:true }; }
    catch (e) { return { ok:false, error:errorText(e) }; }
  }
  const rankKey = () => 'pokesurvivor.mobile.rank.' + uid;
  function completedRun(mark) {
    if (!uid || uid !== G.DB.cloudUid || !Number.isInteger(mark.t) || mark.t < 0 || mark.t > 3600) return;
    try {
      const old = JSON.parse(localStorage.getItem(rankKey()) || 'null');
      if (!old || mark.t > old.time) {
        localStorage.setItem(rankKey(), JSON.stringify({ name:G.DB.user, time:mark.t, level:mark.lv, kills:mark.kills, dex:mark.dex, shiny:!!mark.shiny }));
      }
      publishRank();
    } catch { /* Game progress is already stored independently. */ }
  }
  let rankBusy = false, lastRankPublished = '';
  async function publishRank() {
    if (!uid || rankBusy || !auth?.currentUser || auth.currentUser.uid !== uid) return;
    rankBusy = true;
    try {
      const local = JSON.parse(localStorage.getItem(rankKey()) || 'null');
      const row = local || { name:engine.state.save.name, time:0, level:0, kills:0, dex:0, shiny:false };
      const signature = uid + JSON.stringify(row);
      if (signature === lastRankPublished) return;
      const ref = S.doc(fs, 'mobileRanks', uid);
      await S.runTransaction(fs, async tx => {
        const prev = await tx.get(ref);
        if (!prev.exists() || row.time > prev.data().time) tx.set(ref, { ...row, updatedAt:S.serverTimestamp() });
      });
      lastRankPublished = signature;
    } catch { /* Ranking failure must never block a save. Retained locally for next retry. */ }
    finally { rankBusy = false; }
  }
  async function rankings() {
    await init();
    if (!auth.currentUser || !uid) throw new Error('請先登入雲端帳號。');
    const result = await S.getDocsFromServer(S.query(S.collection(fs,'mobileRanks'), S.orderBy('time','desc'), S.limit(100)));
    return result.docs.map(d => ({ ...d.data(), mine:d.id === uid }));
  }
  async function beforePlay() {
    if (!G.DB.cloudUid) return true;
    if (engine?.conflict) { G.CloudUI.open(); return false; }
    await sync(true);
    if (engine?.conflict) { G.CloudUI.open(); return false; }
    return true; // Offline play is allowed; a later revision conflict requires an explicit choice.
  }
  async function roomSession(refresh = false) {
    await init();
    if (!uid || uid !== G.DB.cloudUid || auth.currentUser?.uid !== uid || G.DB.isStale)
      throw Error('多人合作需要先登入雲端帳號，每位玩家使用不同帳號。');
    if (refresh && !await sync(true)) throw Error('請先完成雲端同步或處理存檔衝突，再加入合作。');
    if (engine?.conflict) throw Error('請先處理雲端存檔衝突。');
    return { S, fs, uid };
  }
  addEventListener('online', () => sync());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && G.DB.cloudUid && G.Game?.state === 'ui') sync(true);
  });
  return { errorText, showMessage(text) { emit(status,text); }, enabled, restore, authenticate, capture, sync, resolve, disconnect, resetPassword, completedRun, rankings, beforePlay, roomSession,
    get status() { return status; }, get message() { return message; }, get conflict() { return engine?.conflict; }, get local() { return engine?.state?.save; },
    get account() { return auth?.currentUser?.email || ''; } };
})();
