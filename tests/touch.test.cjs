const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup(withGame = false) {
  const target = () => {
    const listeners = {};
    return {addEventListener(type, fn) {(listeners[type] ||= []).push(fn);},
      emit(type, data = {}) {for (const fn of listeners[type] || []) fn({cancelable:true, preventDefault(){}, ...data});}};
  };
  const win = target(), doc = target(), viewport = target();
  const canvas = Object.assign(target(), {clientWidth:852, clientHeight:393, width:1278, height:590,
    rect:{left:0, top:0, width:852, height:393}, getBoundingClientRect(){return this.rect;},
    getContext(){return {};}, setPointerCapture(){}, releasePointerCapture(){}});
  const rotate = {classList:{toggle(){}}, innerHTML:'phone'};
  Object.assign(doc, {hidden:false, body:{classList:{add(){}}, appendChild(){}},
    getElementById:id=>id === 'game' ? canvas : rotate,
    createElement:()=>({style:{},remove(){}})});
  const observers = [];
  const context = {console, document:doc, devicePixelRatio:3, innerWidth:852, innerHeight:393,
    visualViewport:viewport, addEventListener:win.addEventListener, performance:{now:()=>1000},
    requestAnimationFrame(){}, getComputedStyle:()=>({paddingTop:'0',paddingRight:'59',paddingBottom:'34',paddingLeft:'59'}),
    ResizeObserver:class {constructor(fn){this.callback=fn;observers.push(this);} observe(el){this.element=el;}},
    G:{Settings:{touch:true,get:()=>1}, Game:{state:'playing'},
      RunUI:{wirePause(){}}, World:{reset(){},setBiome(){},isFree:()=>true},
      Sprites:{Animator:class {},bodyRadius:()=>8}}};
  context.window=context;vm.createContext(context);
  const load = file => vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  load('js/core/touch.js');
  if (withGame) {
    load('js/core/util.js');load('js/core/camera.js');load('js/game.js');context.G.Game.init();
  } else {
    context.G.Touch.init(canvas);context.G.Touch.clearButtons(852,393);
  }
  return {G:context.G,canvas,win,viewport,observers,context};
}
const finger = (clientX,clientY,pointerId=1)=>({clientX,clientY,pointerId,pointerType:'touch'});
const logicalToClient = (canvas,x,y)=>({clientX:canvas.rect.left+x*canvas.rect.width/852,clientY:canvas.rect.top+y*canvas.rect.height/393});

test('bottom HUD hit area follows the displayed canvas offset and unequal CSS scaling',()=>{
  const {G,canvas}=setup();let hits=0;
  canvas.rect={left:37,top:-28,width:1014,height:315};
  G.Touch.addButton(400,305,54,54,()=>hits++);
  canvas.emit('pointerdown',{...finger(0,0),...logicalToClient(canvas,427,332)});
  assert.equal(hits,1);assert.equal(G.Touch.stick,null);
});

test('touchstart fallback uses the same coordinates and does not double-trigger pointerdown',()=>{
  const {G,canvas}=setup();let hits=0;
  canvas.rect={left:59,top:24,width:734,height:460};
  G.Touch.addButton(400,305,54,54,()=>hits++);
  const point=logicalToClient(canvas,427,332);
  canvas.emit('pointerdown',{...finger(0,0),...point});
  canvas.emit('touchstart',{changedTouches:[point]});
  assert.equal(hits,1);
});

test('a second finger can tap a bottom skill while the first finger holds the joystick',()=>{
  const {G,canvas}=setup();let hits=0;
  canvas.rect={left:0,top:0,width:852,height:480};
  canvas.emit('pointerdown',{...finger(0,0),...logicalToClient(canvas,120,350)});
  G.Touch.addButton(400,305,54,54,()=>hits++);
  canvas.emit('touchstart',{changedTouches:[logicalToClient(canvas,427,332)]});
  assert.equal(hits,1);assert.equal(G.Touch.stick.id,1);
  canvas.emit('pointercancel',finger(0,0,2));assert.equal(G.Touch.stick.id,1);
});

test('joystick drawing and movement stay in canvas coordinates at the bottom edge',()=>{
  const {G,canvas}=setup();canvas.rect={left:59,top:20,width:426,height:196.5};
  canvas.emit('pointerdown',{...finger(0,0),...logicalToClient(canvas,120,360)});
  canvas.emit('pointermove',{...finger(0,0),...logicalToClient(canvas,148,360)});
  assert.equal(G.Touch.stick.ox,120);assert.equal(G.Touch.stick.oy,360);
  assert.equal(G.Touch.vector()[0],1);assert.equal(G.Touch.vector()[1],0);
  canvas.emit('pointerup',finger(0,0));assert.equal(G.Touch.vector(),null);
});

test('lost capture releases the joystick so the next touch can move',()=>{
  const {G,canvas}=setup();canvas.emit('pointerdown',finger(120,360));
  canvas.emit('lostpointercapture',finger(120,360));assert.equal(G.Touch.vector(),null);
  canvas.emit('pointerdown',finger(220,360,2));assert.equal(G.Touch.stick.id,2);
});

test('a zero-sized canvas does not create an invalid joystick',()=>{
  const {G,canvas}=setup();canvas.rect.width=0;canvas.rect.height=0;
  canvas.emit('pointerdown',finger(20,20));assert.equal(G.Touch.stick,null);
});

test('CSS-only canvas resize updates rendering without a window resize event',()=>{
  const {G,canvas,observers}=setup(true);
  const observer=observers.find(o=>o.element===canvas);assert.ok(observer,'canvas must be observed');
  canvas.clientHeight=320;observer.callback();
  assert.equal(canvas.height,480);assert.equal(G.Camera.scale,320/420);
});

test('unchanged canvas size does not repeatedly erase HUD hit regions',()=>{
  const {G,canvas,observers}=setup(true);let hits=0;
  G.Touch.addButton(400,305,54,54,()=>hits++);
  observers.find(o=>o.element===canvas).callback();
  canvas.emit('pointerdown',finger(427,332));assert.equal(hits,1);
});

test('visual viewport changes and returning from the home screen remeasure the canvas',()=>{
  const {canvas,viewport,win}=setup(true);
  canvas.clientHeight=350;viewport.emit('resize');assert.equal(canvas.height,525);
  canvas.clientHeight=393;win.emit('pageshow');assert.equal(canvas.height,590);
});

test('fixed joystick follows scaled canvas coordinates and releases on lost capture',()=>{
 const {G,canvas}=setup();G.Settings.get=k=>k==='stickMode'?'fixed':k==='pad'?{stick:[0.14,0.72]}:1;
 canvas.rect={left:59,top:20,width:426,height:196.5};const base=G.Touch.stickBase();
 canvas.emit('pointerdown',{...finger(0,0),...logicalToClient(canvas,base.x,base.y)});
 canvas.emit('pointermove',{...finger(0,0),...logicalToClient(canvas,base.x+28,base.y)});
 assert.equal(G.Touch.stick.fixed,true);assert.equal(G.Touch.stick.ox,base.x);assert.ok(G.Touch.vector()[0]>.99);
 canvas.emit('lostpointercapture',finger(0,0));assert.equal(G.Touch.vector(),null);
});

test('manual aim and movement use separate fingers in the scaled canvas and both reset on suspension',()=>{
 const {G,canvas,win}=setup();G.Settings.get=k=>k==='aimManual'?true:k==='stickMode'?'float':1;
 canvas.rect={left:45,top:20,width:700,height:310};
 const event=(x,y,id)=>({...finger(0,0,id),...logicalToClient(canvas,x,y)});
 canvas.emit('pointerdown',event(180,250,1));canvas.emit('pointermove',event(220,250,1));
 canvas.emit('pointerdown',event(650,220,2));canvas.emit('pointermove',event(650,260,2));
 assert.deepEqual(Array.from(G.Touch.vector()),[1,0]);assert.deepEqual(Array.from(G.Touch.aim()),[0,1]);
 canvas.emit('pointerup',event(650,260,2));assert.equal(G.Touch.aim(),null);assert.ok(G.Touch.vector());
 win.emit('blur');assert.equal(G.Touch.vector(),null);
});
