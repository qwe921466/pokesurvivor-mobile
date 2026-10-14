const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
function boot(saved=null){
 const data=new Map([['pokesurvivor.mobile.save.tester','{"coins":42,"tickets":{"t1":7,"t10":3},"partner":813}']]);
 if(saved)data.set('ps.lang',saved);
 const calls=[];let reloads=0;
 class Canvas {fillText(s){calls.push(s);}strokeText(s){calls.push(s);}measureText(s){return {width:s.length};}}
 const c={G:{},document:{documentElement:{},title:'PokéSurvivor',createTreeWalker:()=>({nextNode:()=>null})},
 localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},navigator:{language:'en-US'},
 location:{pathname:'/pokesurvivor-mobile/',reload(){reloads++;}},CanvasRenderingContext2D:Canvas,
 confirm:s=>{calls.push(s);return true;},alert:s=>calls.push(s)};
 c.window=c;vm.createContext(c);
 for(const name of ['js/core/i18n.js','js/data/lang-en.js','js/data/lang-zh-hant.js','js/data/pokedex.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),c);
 return {c,data,calls,get reloads(){return reloads;}};
}
test('Chinese is the default, explicit language choices survive reload, and save bytes stay unchanged',()=>{
 const a=boot();assert.equal(a.c.G.I18n.lang,'zh-Hant');assert.equal(a.c.document.documentElement.lang,'zh-Hant');
 const save=a.data.get('pokesurvivor.mobile.save.tester');a.c.G.I18n.set('en');
 assert.equal(a.data.get('ps.lang'),'en');assert.equal(a.reloads,1);assert.equal(a.data.get('pokesurvivor.mobile.save.tester'),save);
 assert.equal(boot('en').c.G.T('Volver'),'Back');assert.equal(boot('es').c.G.T('Volver'),'Volver');
 a.c.G.I18n.set('unsupported');assert.equal(a.reloads,1);
});
test('every existing dictionary entry is covered and keeps the same dynamic placeholders',()=>{
 const catalogs={};const c={G:{I18n:{add:(d,l='en')=>catalogs[l]=d}}};
 for(const name of ['lang-en.js','lang-zh-hant.js'])vm.runInNewContext(fs.readFileSync(path.join(root,'js/data',name),'utf8'),c);
 for(const key of Object.keys(catalogs.en)){
  assert.ok(Object.hasOwn(catalogs['zh-Hant'],key),'Missing: '+key);
  assert.equal((catalogs['zh-Hant'][key].match(/\{x\}/g)||[]).length,(key.match(/\{x\}/g)||[]).length,key);
 }
});
test('all playable Pokémon get Chinese display names without changing their source names or numeric IDs',()=>{
 const {c}=boot();assert.ok(c.G.DEX.length>900);
 for(const mon of c.G.DEX){assert.match(c.G.T(mon.name),/\p{Script=Han}/u,mon.name);assert.equal(c.G.DEX_BY[mon.dex],mon);}
 assert.equal(c.G.DEX_BY[813].name,'Scorbunny');assert.equal(c.G.T('Scorbunny'),'炎兔兒');
 assert.equal(c.G.T('Eternatus'),'無極汰那');assert.equal(c.G.T('Ascuas'),'火花');
});
test('dynamic battle, mission and gacha text translates values once and remains stable when translated again',()=>{
 const {c}=boot(),t=c.G.T;
 assert.equal(t('¡Has conseguido a Scorbunny shiny!'),'獲得異色 炎兔兒！');
 assert.equal(t('Pregunta 2 de 8'),'第 2 題，共 8 題');
 for(const value of ['¡Has conseguido a Scorbunny shiny!','Nivel 20','Nuevo · Ascuas','Scorbunny · 12 DERROTADOS · 8 MONEDAS'])assert.equal(t(t(value)),t(value));
});
test('canvas drawing and measurement use the same Chinese text and player names marked translate=no are skipped',()=>{
 const {c,calls}=boot();const canvas=new c.CanvasRenderingContext2D();canvas.fillText('Scorbunny');assert.equal(calls[0],'炎兔兒');assert.equal(canvas.measureText('Scorbunny').width,3);
 const node={nodeType:3,nodeValue:'Scorbunny',parentElement:{closest:()=>({})}};c.G.I18n.walk(node);assert.equal(node.nodeValue,'Scorbunny');
 node.parentElement.closest=()=>null;c.G.I18n.walk(node);assert.equal(node.nodeValue,'炎兔兒');
});
test('early loading screen and game select the same default and explicit locales',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');const script=html.match(/<script>\s*(\(function \(\) \{[\s\S]*?)<\/script>/)[1];
 for(const lang of [null,'en','es','zh-Hant']){const {c}=boot(lang);const p=[{textContent:''},{textContent:''}];c.document.querySelectorAll=()=>p;vm.runInContext(script,c);assert.equal(c.document.documentElement.lang,c.G.I18n.lang);if(!lang||lang==='zh-Hant')assert.equal(p[1].textContent,'載入中…');}
});
test('level labels, region names, duration units and Chinese number formatting are localized',()=>{
 const {c}=boot();assert.equal(c.G.T('Nv. 12'),'等級 12');assert.equal(c.G.T('Kanto'),'關都');assert.equal(c.G.T('2 h 15 min'),'2 小時 15 分鐘');assert.equal(c.G.T('movimiento ·'),'招式 ·');assert.equal(new Intl.NumberFormat(c.G.I18n.locale).format(999999),'999,999');
});
test('historical changelog headings and details are translated',()=>{
 const {c}=boot();vm.runInContext(fs.readFileSync(path.join(root,'js/data/changelog.js'),'utf8'),c);
 for(const item of c.G.CHANGELOG){const texts=[item.title,...item.new||[],...item.chg||[],...item.fix||[]];for(const text of texts)assert.match(c.G.T(text[0]),/\p{Script=Han}/u,text[0]);}
});
