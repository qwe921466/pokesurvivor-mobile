const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const ROOT = path.join(__dirname,'..');
const SAVE = 'pokesurvivor.mobile.save.tester';
function boot(data = new Map(), fail = () => false) {
  const warnings=[],events={};
  const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>{if(fail()) throw new DOMException('Full','QuotaExceededError');data.set(k,v)},removeItem:k=>data.delete(k)};
  const context={console,TextEncoder,Uint8Array,crypto:webcrypto,structuredClone,Blob,CustomEvent:class {constructor(type,o){this.type=type;this.detail=o?.detail}},localStorage:storage,
    addEventListener:(t,f)=>events[t]=f,document:{addEventListener(){}},G:{},dispatchEvent:e=>warnings.push(e)};
  context.window=context;vm.createContext(context);
  for(const file of ['js/core/util.js','js/data/pokedex.js','js/data/sprites-meta.js','js/data/upgrades.js','js/core/db.js','js/systems/gacha.js']) vm.runInContext(fs.readFileSync(path.join(ROOT,file),'utf8'),context);
  context.G.Sprites={hasShiny:d=>!!context.G.SPRITE_META[d]?.sh};
  return {G:context.G,data,warnings,events};
}
const plain = v=>JSON.parse(JSON.stringify(v));
test('new resources, real gacha deductions and restart preserve results and per-Pokémon upgrades',async()=>{
 const a=boot();await a.G.DB.ready();assert.equal((await a.G.DB.register('Tester','testpass')).ok,true);
 const s=a.G.DB.save;assert.equal(s.coins,999999);assert.deepEqual(plain(s.tickets),{t1:999,t10:999});assert.deepEqual(plain(s.pupg),{});
 const one=a.G.Gacha.pull(s,1,1,'t1');assert.equal(one.length,1);assert.equal(s.tickets.t1,998);
 const ten=a.G.Gacha.pull(s,10,1,'t10');assert.equal(ten.length,10);assert.equal(s.tickets.t10,998);
 assert.equal(s.coins,999999+[...one,...ten].reduce((v,x)=>v+x.refund,0));
 s.pupg[1]={[a.G.Upgrades.ALL?.[0]?.id || Object.keys(a.G.Upgrades.BY)[0]]:1};
 a.G.DB.commit();const before=plain(s);
 const b=boot(a.data);assert.equal(await b.G.DB.ready(),true);assert.equal(b.G.DB.save.coins,before.coins);assert.deepEqual(plain(b.G.DB.save.owned),before.owned);assert.deepEqual(plain(b.G.DB.save.tickets),before.tickets);assert.deepEqual(plain(b.G.DB.save.pupg),before.pupg);
});
test('zero resources stay zero; migration never refills missing currency',async()=>{
 const a=boot();await a.G.DB.register('Tester','testpass');a.G.DB.save.coins=0;a.G.DB.save.tickets={t1:0,t10:0};a.G.DB.commit();
 const b=boot(a.data);await b.G.DB.ready();assert.equal(b.G.DB.save.coins,0);assert.equal(b.G.Gacha.pull(b.G.DB.save,1),null);
 let s=JSON.parse(a.data.get(SAVE));delete s.coins;delete s.tickets;s.v=1;s.pity=4;a.data.set(SAVE,JSON.stringify(s));
 const c=boot(a.data);await c.G.DB.ready();assert.equal(c.G.DB.save.coins,0);assert.deepEqual(plain(c.G.DB.save.tickets),{t1:0,t10:0});assert.equal(c.G.DB.save.pity[1],4);
});
test('export/import contains game progress, not account credentials; invalid import is non-destructive',async()=>{
 const a=boot();await a.G.DB.register('Tester','private-pass');a.G.Gacha.pull(a.G.DB.save,10,1,'t10');a.G.DB.commit();
 a.G.DB.save.token='should-not-export';a.G.DB.save.hash='should-not-export';const text=a.G.DB.exportSave();
 assert.ok(!/private-pass|should-not-export|"salt"|"hash"|"token"/.test(text));
 const b=boot();await b.G.DB.register('Other','other-pass');b.G.DB.importSave(text);assert.equal(b.G.DB.save.tickets.t10,998);assert.equal(b.G.DB.save.name,'Other');
 const current=plain(b.G.DB.save); const negative=JSON.parse(text); negative.save.coins=-1; for(const bad of ['{}','no-json',text.replace('"version": 1','"version": 99'),JSON.stringify(negative)]) {
   if(bad===text) continue;assert.throws(()=>b.G.DB.importSave(bad));assert.deepEqual(plain(b.G.DB.save),current);
 }
 const malicious=JSON.parse(text);malicious.save.owned=JSON.parse('{"__proto__":{"polluted":true}}');assert.throws(()=>b.G.DB.importSave(JSON.stringify(malicious)));assert.equal({}.polluted,undefined);
});
test('quota failure warns and retains last durable save',async()=>{
 let full=false;const a=boot(new Map(),()=>full);await a.G.DB.register('Tester','testpass');const stored=a.data.get(SAVE);
 full=true;a.G.DB.save.coins=3;assert.equal(a.G.DB.commit(),false);assert.equal(a.data.get(SAVE),stored);assert.equal(a.G.DB.storageOk,false);assert.ok(a.warnings.length);assert.equal(JSON.parse(a.G.DB.exportSave()).save.coins,3);
});
test('corrupt primary recovers previous snapshot; corrupt only copy is never reset',async()=>{
 const a=boot();await a.G.DB.register('Tester','testpass');a.G.DB.save.coins=42;a.G.DB.commit();a.data.set(SAVE,'{broken');
 const b=boot(a.data);assert.equal(await b.G.DB.ready(),true);assert.equal(b.G.DB.save.coins,999999);assert.ok(b.warnings.length);assert.equal(a.data.get(SAVE),'{broken');
 a.data.delete(SAVE+'.previous');const c=boot(a.data);assert.equal(await c.G.DB.ready(),false);assert.equal(a.data.get(SAVE),'{broken');
});
test('stale window cannot overwrite another window; local mode has no Firebase handle',async()=>{
 const a=boot();await a.G.DB.register('Tester','testpass');a.events.storage({key:SAVE});a.G.DB.save.coins=2;assert.equal(a.G.DB.commit(),false);assert.equal(JSON.parse(a.data.get(SAVE)).coins,999999);
 assert.equal(a.G.DB.online,false);assert.equal(a.G.DB.fb,null);assert.equal(a.G.DB.mode,'local');
});
