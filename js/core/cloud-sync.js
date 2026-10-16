/* Durable revision-based sync. Never merge currency with Math.max or overwrite on a clock comparison. */
G.createCloudSync = ({ read, write, remote, id, validate = x => x }) => {
  let state = read(), conflict = null, busy = null, generation = 0;
  const clone = x => JSON.parse(JSON.stringify(x));
  const canonical = s => { const v = clone(s); delete v.updated; return JSON.stringify(v); };
  function store(next) { write(next); state = next; }
  function edit(save) {
    save = validate(clone(save));
    if (!state) throw new Error('尚未載入雲端帳號。');
    if (canonical(state.save) === canonical(save)) return false;
    generation++;
    store({ ...state, save, dirty: true, op: id() });
    return true;
  }
  function adopt(row) {
    const save = validate(clone(row.save));
    store({ ...(state?.recovery ? { recovery: state.recovery } : {}), revision: row.revision, save, dirty: false, op: row.op });
    conflict = null;
  }
  async function load(initial) {
    const row = await remote.get();
    if (state?.dirty) { await sync(); return; }
    if (row) adopt(row);
    else if (state) throw new Error('雲端存檔不存在；本機副本已保留，請先匯出備份。');
    else {
      store({ revision: 0, save: validate(clone(initial)), dirty: true, op: id() });
      await sync();
    }
  }
  async function sync() {
    if (busy) return busy;
    if (!state || !state.dirty || conflict) return;
    const snapshot = clone(state), n = generation;
    busy = (async () => {
      try {
        const result = await remote.put(snapshot);
        // The write may have reached the server before a lost acknowledgement.
        if (n === generation) adopt(result);
        else store({ ...state, revision: result.revision });
      } catch (e) {
        if (e.remote) { validate(e.remote.save); conflict = clone(e.remote); }
        throw e;
      } finally { busy = null; }
    })();
    return busy;
  }
  async function refresh() {
    await sync();
    if (conflict || state?.dirty) return false;
    const row = await remote.get();
    if (!row) throw new Error('找不到雲端存檔；本機副本已保留。');
    if (state.dirty) {
      if (row.revision !== state.revision && row.op !== state.op) conflict = clone(row);
      return false;
    }
    if (row.revision !== state.revision) { adopt(row); return true; }
    return false;
  }
  async function resolve(choice) {
    if (!conflict) return;
    if (choice !== 'local' && choice !== 'remote') throw new Error('請選擇要保留的進度。');
    // Keep BOTH sides durably before the explicit choice can replace either one.
    const local = clone(state); delete local.recovery;
    const recovery = { local, remote: clone(conflict) };
    store({ ...state, recovery });
    if (choice === 'remote') { adopt(conflict); store({ ...state, recovery }); }
    else {
      store({ ...state, revision: conflict.revision, op: id(), dirty: true, recovery });
      conflict = null; await sync();
    }
  }
  return { edit, load, sync, refresh, resolve, get state() { return clone(state); }, get conflict() { return conflict && clone(conflict); } };
};
