#!/usr/bin/env python3
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import json, re, subprocess
root=Path(__file__).resolve().parents[1]
class Links(HTMLParser):
    def handle_starttag(self,tag,attrs):
        for name,value in attrs:
            if name not in ['src','href'] or not value or value.startswith(('#','mailto:','https:','data:','blob:')): continue
            assert not value.startswith('/'), 'Root-relative path: '+value
            assert (root/unquote(urlsplit(value).path)).exists(), 'Missing local asset: '+value
parser=Links(); parser.feed((root/'index.html').read_text())
html=(root/'index.html').read_text()
assert '<meta name="robots" content="noindex, nofollow, noimageindex">' in html
assert 'noindex, nofollow, noimageindex' in (root/'dev.html').read_text()
assert not (root/'sitemap.xml').exists()
assert 'app.min.js' not in html
assert not (root/'js/app.min.js').exists()
assert not (root/'CNAME').exists()
assert 'pokesurvivor.com' not in html
assert 'connect-src \'self\'' in html
assert (root/'js/core/firebase-config.js').read_text().strip().endswith('G.FIREBASE_CONFIG = null;')
assert 'firebase' not in (root/'js/core/db.js').read_text().lower()
version=json.loads((root/'version.json').read_text())['v']
assert f'content="{version}"' in html
for path in root.glob('js/**/*.js'): subprocess.run(['node','--check',str(path)],check=True,capture_output=True)
subprocess.run(['node','--check',str(root/'sw.js')],check=True,capture_output=True)
for css in root.glob('css/*.css'):
    for path in re.findall(r'url\([\'\"]?([^\)\'\"]+)',css.read_text()):
        if path.startswith('data:'): continue
        assert (css.parent/path).exists(), 'Missing CSS asset: '+path
manifest=json.loads((root/'manifest.webmanifest').read_text())
assert manifest['scope']=='./' and manifest['start_url']=='./' and manifest['id']=='./'
for icon in manifest['icons']: assert (root/icon['src']).exists()
assert max(p.stat().st_size for p in root.rglob('*') if p.is_file()) < 100*1024*1024
print('PASS: JS syntax, relative resources, local-only database, manifest, no official bundle/domain, file sizes.')
