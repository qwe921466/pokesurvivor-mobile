(function () {
    var s = null; try { s = localStorage.getItem('ps.lang'); } catch (e) {}
    var l = ['es', 'en', 'zh-Hant'].indexOf(s) >= 0 ? s : (/\/en(\/|$)/.test(location.pathname) ? 'en' : 'zh-Hant');
    document.documentElement.lang = l;
    if (l === 'en') {
      var p = document.querySelectorAll('#boot p');
      p[0].textContent = 'A Pokémon survival game, free in your browser and on mobile.';
      p[1].textContent = 'Loading…';
    } else if (l === 'zh-Hant') {
      var p = document.querySelectorAll('#boot p');
      p[0].textContent = '可在瀏覽器與手機遊玩的寶可夢生存遊戲。';
      p[1].textContent = '載入中…';
    }
  })();
