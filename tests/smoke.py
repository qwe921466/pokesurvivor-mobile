"""Browser integration test. Requires Python Playwright + Chromium; no user profile."""
from playwright.sync_api import sync_playwright
from pathlib import Path
import json, os, tempfile, time
URL = os.environ.get('GAME_URL', 'http://127.0.0.1:8765/PokeSurvivor-iPhone/')
EXE = os.environ.get('CHROMIUM_EXECUTABLE')
if not EXE:
    candidates = sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
    EXE = str(candidates[0]) if candidates else None
OUT = Path(__file__).resolve().parents[1]/'test-results'
OUT.mkdir(exist_ok=True)
profile=tempfile.mkdtemp(prefix='pokesurvivor-qa-')
report={};errors=[];failed=[];remote=[]
def wait_js(page, expression, timeout=30):
    until=time.monotonic()+timeout
    while time.monotonic()<until:
        if page.evaluate('() => ('+expression+')'): return
        page.wait_for_timeout(50)
    raise AssertionError('Timeout: '+expression)
def boot(page):
    page.goto(URL,wait_until='networkidle')
    wait_js(page, "document.getElementById('boot').classList.contains('hidden')")
    if page.locator('#tap-start').is_visible(): page.locator('#tap-start').click()
def state(page):
    return page.evaluate('JSON.parse(JSON.stringify(G.DB.save))')
def watch(page):
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('response', lambda r: failed.append([r.status,r.url]) if r.status>=400 else None)
    page.on('request', lambda r: remote.append(r.url) if not r.url.startswith(('http://127.0.0.1:8765/','data:','blob:')) else None)
def save_report():
    (OUT/'browser-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
with sync_playwright() as p:
    options=dict(headless=True,executable_path=EXE,viewport={'width':852,'height':393},is_mobile=True,has_touch=True,device_scale_factor=2)
    context=p.chromium.launch_persistent_context(profile,**options)
    page=context.pages[0];watch(page)
    try:
        boot(page)
        page.locator('[data-tab="register"]').click()
        page.locator('#f-user').fill('MobileQA')
        page.locator('#f-pass').fill('temporary-test-pass')
        page.locator('#btn-auth').click()
        wait_js(page, 'G.DB.loggedIn')
        s=state(page);assert s['coins']==999999 and s['tickets']=={'t1':999,'t10':999};report['initial_resources']={'coins':s['coins'],'tickets':s['tickets']}
        for _ in range(page.evaluate('G.PERSONALITY_TEST.length')): page.locator('#test-a button').first.click()
        page.locator('#res-ok').click()
        page.wait_for_selector('#scr-menu:not(.hidden)')
        assert page.locator('#scr-menu .mobile-backup-open').is_visible()
        assert page.locator('[data-go="friends"]').is_disabled() and page.locator('[data-go="rank"]').is_disabled()
        page.wait_for_timeout(400)
        page.screenshot(path=str(OUT/'landscape-menu.png'))
        page.locator('[data-go="gacha"]').click()
        page.locator('#pull-1').click()
        wait_js(page, 'G.DB.save.tickets.t1===998')
        report['after_single_pull_t1']=state(page)['tickets']['t1']
        page.locator('#pull-close').wait_for(state='visible',timeout=30000);page.locator('#pull-close').click()
        page.locator('#pull-10b').click()
        wait_js(page, 'G.DB.save.tickets.t10===998')
        page.locator('#pull-close').wait_for(state='visible',timeout=30000)
        s=state(page);assert s['stats']['pulls']==11
        report['after_gacha']={'coins':s['coins'],'tickets':s['tickets'],'pulls':s['stats']['pulls'],'owned':len(s['owned'])}
        page.screenshot(path=str(OUT/'gacha-results.png'))
        before={k:s[k] for k in ['coins','tickets','owned','shiny','pity','pupg','partner']}
        page.reload(wait_until='networkidle')
        if page.locator('#tap-start').is_visible():page.locator('#tap-start').click()
        page.wait_for_selector('#scr-menu:not(.hidden)')
        assert {k:state(page)[k] for k in before}==before
        report['refresh_preserves_progress']=True
        page.locator('#scr-menu .mobile-backup-open').click()
        with page.expect_download() as event:page.locator('#mobile-export').click()
        download=event.value;backup=OUT/'qa-backup.json';download.save_as(str(backup))
        text=backup.read_text();j=json.loads(text);assert j['save']['tickets']==before['tickets']
        assert all(x not in text for x in ['temporary-test-pass','"hash"','"salt"','"token"'])
        report['export_download_without_credentials']=True
        page.screenshot(path=str(OUT/'backup-panel.png'))
        page.locator('#mobile-backup-close').click()
        page.locator('[data-go="play"]').click()
        wait_js(page, "G.Game.state==='playing'")
        # Dispatch a touch pointer gesture through the actual canvas handlers.
        start=page.evaluate('({x:G.Game.player.x,y:G.Game.player.y})')
        page.locator('#game').dispatch_event('pointerdown',{'pointerId':7,'pointerType':'touch','clientX':220,'clientY':280,'bubbles':True})
        page.locator('#game').dispatch_event('pointermove',{'pointerId':7,'pointerType':'touch','clientX':285,'clientY':280,'bubbles':True})
        page.wait_for_timeout(700)
        page.locator('#game').dispatch_event('pointerup',{'pointerId':7,'pointerType':'touch','clientX':285,'clientY':280,'bubbles':True})
        end=page.evaluate('({x:G.Game.player.x,y:G.Game.player.y})');assert end!=start
        report['touch_gesture_moves_player']=True
        page.screenshot(path=str(OUT/'landscape-game.png'))
        page.set_viewport_size({'width':393,'height':852})
        wait_js(page, "!document.getElementById('rotate').classList.contains('hidden')")
        assert page.evaluate('G.Game.state')=='paused';report['portrait_pauses_and_requests_rotation']=True
        page.set_viewport_size({'width':852,'height':393});page.locator('#btn-quit').click()
        wait_js(page, "G.Game.state==='over'")
        page.locator('#btn-again').click()
        # Restore exported progress via the actual file-picker change handler.
        page.locator('#scr-menu .mobile-backup-open').click()
        page.once('dialog',lambda d:d.accept())
        page.locator('#mobile-import-file').set_input_files(str(backup))
        page.wait_for_event('load')
        wait_js(page, "G.DB.loggedIn && document.getElementById('boot').classList.contains('hidden')")
        if page.locator('#tap-start').is_visible():page.locator('#tap-start').click()
        page.wait_for_selector('#scr-menu:not(.hidden)')
        assert {k:state(page)[k] for k in before}==before;report['file_import_restores_progress']=True
        # Confirm the service worker controls this exact Pages-style subpath.
        page.evaluate('navigator.serviceWorker.ready.then(r=>r.active.state)')
        wait_js(page, '!!navigator.serviceWorker.controller')
        report['service_worker_scope']=page.evaluate('navigator.serviceWorker.ready.then(r=>r.scope)')
        # Browser process restart using the same isolated on-disk profile.
        context.close();context=p.chromium.launch_persistent_context(profile,**options);page=context.pages[0];watch(page);boot(page)
        page.wait_for_selector('#scr-menu:not(.hidden)');assert {k:state(page)[k] for k in before}==before
        report['browser_process_restart_preserves_progress']=True
        # Offline shell and previously used sprites are a limited bonus, not full offline coverage.
        context.set_offline(True);page.reload(wait_until='load');wait_js(page, 'G.DB.loggedIn')
        report['cached_shell_opens_offline']=True
        context.set_offline(False)
        report['console_errors']=errors;report['http_errors']=failed;report['external_requests']=remote
        assert not errors and not failed and not remote
        report['result']='PASS';save_report();print(json.dumps(report,ensure_ascii=False),flush=True)
    except Exception as e:
        report['result']='FAIL';report['failure']=str(e);report['console_errors']=errors;report['http_errors']=failed;report['external_requests']=remote
        page.screenshot(path=str(OUT/'failure.png'));save_report();print(json.dumps(report,ensure_ascii=False),flush=True);raise
    finally:context.close()
