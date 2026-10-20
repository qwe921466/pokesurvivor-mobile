/* Room-code UI using the original panels and sprites. */
(() => {
  const $=G.UI.$;
  let busy=false;
  async function action(fn) {
    if(busy)return;busy=true;
    try {const r=await fn();if(r?.ok===false)G.UI.toast(r.error,4500);}
    catch(e){G.UI.toast(G.Cloud.errorText(e),4500);}
    finally{busy=false;if(G.UI.isOpen('scr-lobby'))render();}
  }
  function open() {
    if(!G.DB.cloudUid){G.UI.toast('請先在「雲端帳號」登入，每位玩家使用不同帳號。',4000);G.CloudUI.open();return;}
    if(G.Social.room){lobbyOpen();return;}
    G.UI.show('scr-friends',true);
  }
  function lobbyOpen(){if(!G.Social.room){open();return;}G.UI.show('scr-lobby',true);render();}
  function render() {
    const room=G.Social.room;if(!room)return;
    const mine=room.members.find(m=>m.uid===G.Social.uid);
    $('lobby-code').textContent=room.id;
    $('lobby-sub').textContent=room.isHost?'你是房主。把房間碼傳給朋友，等所有人準備好即可開始。':'連線成功後按「準備」，等待房主開局。';
    const box=$('lobby-members');box.replaceChildren();
    for(let i=0;i<4;i++){
      const m=room.members[i],card=document.createElement('div');card.className='lob-card'+(m?'':' empty');
      if(!m){card.textContent='等待加入';box.appendChild(card);continue;}
      card.style.setProperty('--pc',G.Coop.COLORS[i]);
      card.appendChild(G.UI.spriteCanvas(m.dex,120,96,{scale:2,shiny:m.shiny}));
      const name=document.createElement('b');name.textContent=m.name;name.translate=false;card.appendChild(name);
      const text=document.createElement('span');text.className='conn';
      const mode=G.Net.mode(room.isHost?m.uid:room.host);
      text.textContent=m.uid===room.host?'房主':m.uid===G.Social.uid?(m.ready?'你已準備':'你'):mode==='direct'?(m.ready?'已準備':'等待準備'):mode==='failed'?'連線失敗':'連線中…';
      card.appendChild(text);box.appendChild(card);
    }
    const others=room.members.filter(m=>m.uid!==room.host),direct=room.isHost?others.every(m=>G.Net.mode(m.uid)==='direct'):G.Net.mode(room.host)==='direct';
    const failed=G.Net.peers().some(u=>G.Net.mode(u)==='failed');
    $('lobby-start').textContent=room.isHost?'開始合作（'+room.members.length+'/4）':mine?.ready?'取消準備':'準備';
    $('lobby-start').disabled=busy||room.state!=='lobby'||!direct||(room.isHost&&(!others.length||others.some(m=>!m.ready)));
    $('lobby-retry').classList.toggle('hidden',!room.isHost||!failed||room.state!=='lobby');
    $('lobby-note').textContent=failed?'目前網路無法直接連線。可請房主按「重試連線」，或切換 Wi-Fi／行動網路再試。'
      :room.state==='playing'?'等待本局結束。'
      :!direct?'正在建立玩家間連線（最多約 25 秒）…'
      :'房主需保持遊戲開啟；切到背景會暫停隊伍。房主離線則結束本局，已取得的進度仍會保存。';
  }
  function init(){
    $('fr-create').onclick=()=>action(()=>G.Social.createRoom());
    $('fr-add').onsubmit=e=>{e.preventDefault();action(()=>G.Social.joinRoom($('fr-name').value));};
    $('lobby-menu').onclick=()=>action(async()=>{
      if(!G.Social.room.isHost)await G.Social.ready(false);
      G.MenuUI.open();
    });
    $('lobby-leave').onclick=()=>action(async()=>{await G.Social.leaveRoom();G.MenuUI.open();});
    $('lobby-copy').onclick=()=>action(async()=>{
      try{await navigator.clipboard.writeText(G.Social.room.id);G.UI.toast('房間碼已複製');}
      catch{G.UI.toast('房間碼：'+G.Social.room.id,5000);}
    });
    $('lobby-start').onclick=()=>action(()=>{
      const r=G.Social.room;return r.isHost?G.Social.begin():G.Social.ready(!r.members.find(m=>m.uid===G.Social.uid).ready);
    });
    $('lobby-retry').onclick=()=>G.Net.retry();
    G.Social.on(what=>{
      if(what==='room'&&G.UI.isOpen('scr-friends'))lobbyOpen();
      if(what==='room-closed'){
        G.UI.toast('房間已關閉或到期。需要再玩時請建立新房。',3500);
        if(G.UI.isOpen('scr-lobby'))G.MenuUI.open();
      }
      if(G.UI.isOpen('scr-lobby'))render();
    });
    G.Net.onPeer(()=>{if(G.UI.isOpen('scr-lobby'))render();});
  }
  G.FriendsUI={open};
  G.LobbyUI={open:lobbyOpen,close(){G.UI.hide('scr-lobby');},render};
  G.NickUI={skipped:true,open:()=>G.CloudUI.open()};
  G.InvitePop={refresh(){}};
  G.SocialUI={init};
})();
