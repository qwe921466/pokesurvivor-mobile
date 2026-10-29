// Fechas del evento de Halloween: del 30-10 al 2-11 (hora de España). El 2-11 se
// añadió el 27-10-2026; el 3-11 a las 00:00 vuelve todo a la normalidad.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const G = {};
  const ctx = vm.createContext({ G, Intl, Date, performance, setInterval: () => 0, URLSearchParams, console });
  const f = 'js/systems/halloween.js';
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  return G.Halloween;
}

test('isOn: del 30-10 al 2-11 en hora de España', () => {
  const H = load();
  // (En España, octubre y noviembre de 2026: UTC+1 desde el 25-10.)
  assert.equal(H.isOn(new Date('2026-10-29T22:59:00Z')), false);   // 29-10, 23:59
  assert.equal(H.isOn(new Date('2026-10-29T23:00:00Z')), true);    // 30-10, 00:00
  assert.equal(H.isOn(new Date('2026-11-01T12:00:00Z')), true);
  assert.equal(H.isOn(new Date('2026-11-02T22:59:00Z')), true);    // 2-11, 23:59
  assert.equal(H.isOn(new Date('2026-11-02T23:00:00Z')), false);   // 3-11, 00:00
  assert.equal(H.isOn(new Date('2027-11-02T12:00:00Z')), true);    // cualquier año
});

test('countdown: cuánto falta y cuánto queda, con el 2-11 incluido', () => {
  const H = load();
  const end = Date.parse('2026-11-02T23:00:00Z');
  const during = Date.parse('2026-11-02T20:00:00Z');
  assert.deepEqual({ ...H.countdown(during) }, { on: true, ms: end - during });
  const before = Date.parse('2026-10-27T18:00:00Z');
  assert.deepEqual({ ...H.countdown(before) }, { on: false, ms: Date.parse('2026-10-29T23:00:00Z') - before });
  assert.equal(H.countdown(end), null);
});

function clocked({ header = null, query = '', hostname = 'qwe921466.github.io' } = {}) {
  let tick = 0, deviceNow = Date.parse('2026-10-31T12:00:00Z');
  class DeviceDate extends Date { static now() { return deviceNow; } }
  const G = {}, requests = [], timers = [], storage = new Map();
  const ctx = vm.createContext({
    G, Intl, Date: DeviceDate, URLSearchParams, console,
    performance: { now: () => tick },
    location: { protocol: 'https:', hostname, search: query },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (!header) throw new Error('Offline');
      return { headers: { get: key => key === 'date' ? header : null } };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/systems/halloween.js'), 'utf8'), ctx);
  return {
    H: G.Halloween, requests,
    settled: () => new Promise(resolve => setImmediate(resolve)),
    changeDeviceClock: value => { deviceNow = value; },
    advance: ms => { tick += ms; timers.filter(t => t.ms === 10000).forEach(t => t.fn()); }
  };
}

test('offline launch does not activate Halloween from the device date or a public query flag', async () => {
  const r = clocked({ query: '?halloween=1' });
  await r.settled();
  assert.equal(r.H.on, false);
  assert.equal(r.H.countdown(), null);
  r.H.runStart();
  assert.equal(r.H.takeCandy(1800), false);
});

test('Halloween uses this site HTTP date and monotonic elapsed time, not device clock changes', async () => {
  const r = clocked({ header: 'Mon, 02 Nov 2026 22:59:50 GMT' });
  await r.settled();
  assert.equal(r.H.on, true);
  assert.equal(r.requests.length, 1);
  assert.match(r.requests[0].url, /^version\.json\?/);
  assert.equal(r.requests[0].options.method, 'HEAD');
  assert.equal(r.requests[0].options.cache, 'no-store');
  r.changeDeviceClock(Date.parse('2035-05-01T00:00:00Z'));
  assert.equal(r.H.on, true);
  const changes = [];
  r.H.onChange(on => changes.push(on));
  r.H.runStart();
  r.advance(12000);
  assert.equal(r.H.on, false);
  assert.deepEqual(changes, [false]);
  assert.equal(r.H.inRun, true, 'a battle started during the event retains its map and rewards');
  r.H.runEnd();
  assert.equal(r.H.inRun, false);
});

test('the host activity choice controls a whole co-op run and candy resets for each run', () => {
  const H = load();
  H.runStart(true);
  assert.equal(H.inRun, true);
  assert.equal(H.takeCandy(47), false);
  assert.equal(H.takeCandy(48), true);
  assert.equal(H.takeCandy(48), false, 'one candy per earned time interval');
  H.runEnd();
  H.runStart(true);
  assert.equal(H.takeCandy(48), true);
  H.runStart(false);
  assert.equal(H.inRun, false);
  assert.equal(H.takeCandy(1800), false);
});
