const {test}=require('node:test');
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('a guest leaves a lost host during battle, while lobby failures remain retryable',async()=>{
 let callback,leaves=0;
 const controls=new Map();
 const G={UI:{$:id=>{if(!controls.has(id))controls.set(id,{});return controls.get(id);},isOpen:()=>false},
   Social:{room:{isHost:false,state:'lobby',host:'host'},on(){},async leaveRoom(){leaves++;this.room=null;}},
   Net:{onPeer(fn){callback=fn;}}};
 const c={G};vm.createContext(c);vm.runInContext(fs.readFileSync('js/ui/mobile-coop-ui.js','utf8'),c);G.SocialUI.init();
 callback('host','failed');assert.equal(leaves,0);
 G.Social.room.state='playing';G.Coop={active:true};callback('host','failed');assert.equal(leaves,0);
 G.Coop.active=false;callback('host','failed');await Promise.resolve();assert.equal(leaves,1);
 G.Social.room={isHost:true,state:'playing',host:'host'};callback('guest','failed');assert.equal(leaves,1);
});
