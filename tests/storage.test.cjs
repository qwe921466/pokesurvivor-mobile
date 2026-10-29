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
  for(const file of ['js/core/util.js','js/data/pokedex.js','js/data/sprites-meta.js','js/data/upgrades.js','js/data/moves.js','js/data/natures.js','js/data/abilities.js','js/data/tms.js','js/core/skins.js','js/core/db.js','js/data/shop.js','js/systems/mons.js','js/systems/gacha.js']) vm.runInContext(fs.readFileSync(path.join(ROOT,file),'utf8'),context);
  context.G.Sprites={hasShiny:d=>!!context.G.SPRITE_META[d]?.sh};
  context.G.Halloween={on:false,SKIN_PRICE:300};
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

test('v3 saves migrate without changing balances or collection; new favorites and starting moves survive export and reload',async()=>{
 const a=boot();await a.G.DB.register('Tester','testpass');a.G.DB.grant(1,'starter');
 let legacy=plain(a.G.DB.save);legacy.v=3;legacy.coins=17;legacy.tickets={t1:2,t10:3};legacy.pupg={1:{hp:3}};
 delete legacy.dfav;delete legacy.pused;delete legacy.pstart;a.data.set(SAVE,JSON.stringify(legacy));
 const b=boot(a.data);assert.equal(await b.G.DB.ready(),true);const s=b.G.DB.save;
 assert.equal(s.v,6);assert.equal(s.coins,17);assert.deepEqual(plain(s.tickets),{t1:2,t10:3});assert.deepEqual(plain(s.owned),legacy.owned);assert.deepEqual(plain(s.pupg),legacy.pupg);
 b.G.DB.setFav(1,true);s.pused[1]=8;s.pstart[1]='vine-whip';s.pupg[1].start=1;b.G.DB.commit();
 const c=boot(a.data);await c.G.DB.ready();const exported=JSON.parse(c.G.DB.exportSave()).save;
 assert.equal(c.G.DB.isFav(1),true);assert.equal(exported.pused[1],8);assert.equal(exported.pstart[1],'vine-whip');assert.equal(exported.pupg[1].start,1);
});
test('refill persists for an existing account, normal gacha spending stays spent, and higher balances are never reduced',async()=>{
 const a=boot();await a.G.DB.register('Tester','testpass');a.G.DB.grant(1,'starter');a.G.DB.save.pupg[1]={hp:3};
 const originalOwned=plain(a.G.DB.save.owned),earned=a.G.DB.save.stats.coinsEarned;
 a.G.DB.refillResources();assert.equal(a.G.DB.save.coins,999999999);assert.deepEqual(plain(a.G.DB.save.tickets),{t1:999999,t10:999999});
 assert.deepEqual(plain(a.G.DB.save.owned),originalOwned);assert.equal(a.G.DB.save.pupg[1].hp,3);assert.equal(a.G.DB.save.stats.coinsEarned,earned);
 a.G.Gacha.pull(a.G.DB.save,1,1,'t1');a.G.Gacha.pull(a.G.DB.save,10,1,'t10');a.G.DB.save.coins-=80;a.G.DB.commit();
 const coins=a.G.DB.save.coins,b=boot(a.data);await b.G.DB.ready();assert.equal(b.G.DB.save.coins,coins);assert.deepEqual(plain(b.G.DB.save.tickets),{t1:999998,t10:999998});
 b.G.DB.refillResources();assert.equal(b.G.DB.save.tickets.t1,999999);b.G.DB.save.coins=1000000500;b.G.DB.save.tickets.t1=1000005;b.G.DB.refillResources();assert.equal(b.G.DB.save.coins,1000000500);assert.equal(b.G.DB.save.tickets.t1,1000005);
});
test('refill refuses guests, stale windows, active battles and unresolved cloud conflicts',async()=>{
 const a=boot();a.G.DB.playAsGuest();assert.throws(()=>a.G.DB.refillResources());await a.G.DB.register('Tester','testpass');
 a.G.Game={state:'playing'};assert.throws(()=>a.G.DB.refillResources());a.G.Game.state='ui';a.G.Cloud={conflict:{}};assert.throws(()=>a.G.DB.refillResources());a.G.Cloud.conflict=null;
 a.events.storage({key:SAVE});assert.throws(()=>a.G.DB.refillResources());assert.equal(a.G.DB.save.coins,999999);
});

test('v4 migrates to the latest save without refills; shop, nature, ability, TMs and second start survive reload and transfer',async()=>{
 const a=boot();await a.G.DB.register('Tester','testpass');a.G.DB.grant(150,'starter');
 const legacy=plain(a.G.DB.save);legacy.v=4;legacy.partner=150;legacy.coins=20000;legacy.tickets={t1:13,t10:2};
 for(const k of ['bag','tms','ptm','pnat','pabil','pstart2'])delete legacy[k];a.data.set(SAVE,JSON.stringify(legacy));
 const b=boot(a.data);await b.G.DB.ready();const s=b.G.DB.save;
 assert.equal(s.v,6);assert.equal(s.created,legacy.created);assert.equal(s.coins,20000);assert.deepEqual(plain(s.tickets),legacy.tickets);
 assert.equal(b.G.Shop.buy('mint').ok,true);assert.equal(s.coins,18500);assert.equal(s.bag.mint,1);
 assert.equal(b.G.Shop.take('mint'),true);b.G.Mons.setNature(150,'adamant');
 assert.equal(b.G.Shop.buy('caph').ok,true);assert.equal(b.G.Shop.take('caph'),true);b.G.Mons.setAbility(150,2);
 const tm=b.G.Shop.dailyTms().find(id=>b.G.Mons.canLearn(150,id));assert.ok(tm);
 const before=s.coins;assert.equal(b.G.Shop.buy('tm:'+tm).ok,true);assert.equal(s.coins,before-b.G.Shop.tmPrice(tm));
 assert.equal(b.G.Mons.teach(150,tm),true);assert.equal(b.G.Mons.teach(150,tm),false);
 s.pstart2[150]=tm;s.pupg[150]={start2:1};b.G.DB.commit();
 const c=boot(a.data);await c.G.DB.ready();
 for(const k of ['bag','tms','ptm','pnat','pabil','pstart2','coins','tickets','pupg'])assert.deepEqual(plain(c.G.DB.save[k]),plain(s[k]),k);
 assert.equal(c.G.Mons.natureOf(150).id,'adamant');assert.equal(c.G.Mons.abilityOf(150).slot,2);
 assert.ok(c.G.Moves.poolFor(c.G.DEX_BY[150]).includes(tm));
 const d=boot();await d.G.DB.register('Other','testpass');d.G.DB.importSave(c.G.DB.exportSave());
 assert.equal(d.G.DB.save.created,legacy.created);assert.deepEqual(plain(d.G.DB.save.ptm),plain(s.ptm));
 assert.equal(d.G.Mons.natureOf(150).id,'adamant');assert.equal(d.G.Mons.abilityOf(150).slot,2);
});
test('hundred pulls charge 100 single tickets or ten ten-pull tickets with ten epic guarantees and persist',async()=>{
 const a=boot();await a.G.DB.register('Tester','testpass');const s=a.G.DB.save;
 for(const use of ['t1','t10']){
  const before=plain(s.tickets),pulls=s.stats.pulls,results=a.G.Gacha.pull(s,100,1,use);
  assert.equal(results.length,100);assert.equal(s.stats.pulls,pulls+100);
  assert.equal(s.tickets.t1,before.t1-(use==='t1'?100:0));assert.equal(s.tickets.t10,before.t10-(use==='t10'?10:0));
  for(let i=0;i<10;i++)assert.ok(results.slice(i*10,i*10+10).some(r=>r.rarity>=4));
 }
 a.G.DB.commit();const b=boot(a.data);await b.G.DB.ready();assert.deepEqual(plain(b.G.DB.save.tickets),plain(s.tickets));assert.deepEqual(plain(b.G.DB.save.owned),plain(s.owned));
 s.tickets={t1:99,t10:9};const before=plain(s);assert.equal(a.G.Gacha.pull(s,100,1,'t10'),null);assert.equal(a.G.Gacha.pull(s,100,1,'t1'),null);assert.deepEqual(plain(s),before);
});
test('a completed regional collection earns the shiny charm without resetting or adding a save flag',async()=>{
 const a=boot();await a.G.DB.register('Tester','testpass');const s=a.G.DB.save;
 assert.equal(a.G.Gacha.shinyRate(s,1),0.01);
 for(const p of a.G.DEX.filter(p=>p.gen===1))a.G.DB.grant(p.dex,'gacha');
 assert.equal(a.G.Gacha.hasIris(s,1),true);assert.equal(a.G.Gacha.shinyRate(s,1),0.02);
 a.G.DB.commit();const b=boot(a.data);await b.G.DB.ready();assert.equal(b.G.Gacha.shinyRate(b.G.DB.save,1),0.02);
});

test('v5 saves gain empty costume fields without resetting progress; candy purchases, outfit choices and event pity survive transfer',async()=>{
 const a=boot();await a.G.DB.register('Tester','testpass');a.G.DB.grant(94,'starter');a.G.DB.grant(25,'gacha');
 const legacy=plain(a.G.DB.save);legacy.v=5;legacy.coins=91;legacy.tickets={t1:17,t10:2};legacy.pupg={94:{hp:2}};
 delete legacy.skins;delete legacy.pskin;a.data.set(SAVE,JSON.stringify(legacy));
 const b=boot(a.data);assert.equal(await b.G.DB.ready(),true);const s=b.G.DB.save;
 assert.equal(s.v,6);assert.equal(s.created,legacy.created);assert.equal(s.coins,91);assert.deepEqual(plain(s.tickets),legacy.tickets);
 assert.deepEqual(plain(s.owned),legacy.owned);assert.deepEqual(plain(s.pupg),legacy.pupg);
 assert.deepEqual(plain(s.skins),{});assert.deepEqual(plain(s.pskin),{});
 s.bag.candy=620;
 assert.equal(b.G.Shop.buySkin('bruja-gengar').ok,false);assert.equal(s.bag.candy,620);
 assert.equal(b.G.Shop.buy('candy').ok,false);assert.equal(s.coins,91);
 b.G.Halloween.on=true;
 assert.equal(b.G.Shop.buySkin('bruja-gengar').ok,true);assert.equal(s.bag.candy,320);assert.equal(b.G.Skins.worn(s,94),'bruja-gengar');
 assert.equal(b.G.Shop.buySkin('bruja-gengar').ok,false);assert.equal(s.bag.candy,320);
 assert.equal(b.G.Shop.buySkin('bruja-pikachu').ok,true);assert.equal(s.bag.candy,20);
 assert.equal(b.G.Shop.buySkin('bruja-umbreon').ok,false);assert.equal(s.bag.candy,20);
 b.G.Skins.wear(s,25,'');s.pity[1]=12;s.pity[10]=69;
 const result=b.G.Gacha.pull(s,1,10,'t1');assert.equal(result.length,1);assert.equal(result[0].rarity,5);
 assert.equal(s.pity[10],0);assert.equal(s.pity[1],12);assert.equal(s.tickets.t1,16);
 b.G.DB.commit();const c=boot(a.data);assert.equal(await c.G.DB.ready(),true);
 for(const k of ['skins','pskin','bag','pity','tickets','owned','pupg'])assert.deepEqual(plain(c.G.DB.save[k]),plain(s[k]),k);
 assert.equal(c.G.Halloween.on,false);assert.equal(c.G.Skins.worn(c.G.DB.save,94),'bruja-gengar');assert.equal(c.G.Skins.worn(c.G.DB.save,25),'');
 const d=boot();await d.G.DB.register('Other','testpass');d.G.DB.importSave(c.G.DB.exportSave());
 for(const k of ['skins','pskin','bag','pity','tickets','owned','pupg'])assert.deepEqual(plain(d.G.DB.save[k]),plain(s[k]),k);
 const before=plain(d.G.DB.save);assert.equal(d.G.Gacha.pull(d.G.DB.save,1,10,'t1'),null);assert.deepEqual(plain(d.G.DB.save),before);
});

test('costume imports remove unknown, unowned or mismatched selections and reject malformed or future saves without replacing progress',async()=>{
 const a=boot();await a.G.DB.register('Tester','testpass');const data=JSON.parse(a.G.DB.exportSave());
 data.save.skins={'bruja-gengar':12345,'bruja-pikachu':-1,'unknown-costume':12345};
 data.save.pskin={94:['bruja-gengar',12346],25:['bruja-gengar',12346],197:['bruja-umbreon',12346],999999:['',12346],1:['',12346]};
 a.G.DB.importSave(JSON.stringify(data));assert.deepEqual(plain(a.G.DB.save.skins),{'bruja-gengar':12345});
 assert.deepEqual(plain(a.G.DB.save.pskin),{94:['bruja-gengar',12346],1:['',12346]});
 const current=plain(a.G.DB.save);
 for(const malformed of [{skins:[]},{pskin:[]},{v:7}]) {
  const bad=JSON.parse(a.G.DB.exportSave());Object.assign(bad.save,malformed);
  assert.throws(()=>a.G.DB.importSave(JSON.stringify(bad)));assert.deepEqual(plain(a.G.DB.save),current);
 }
});
