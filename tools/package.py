#!/usr/bin/env python3
"""Prepare only the reviewed public runtime. Refuse an existing destination."""
from pathlib import Path
import shutil, sys
root = Path(__file__).resolve().parents[1]
destination = Path(sys.argv[1]).resolve()
if destination.exists(): raise SystemExit('Destination exists: choose a NEW path; nothing was overwritten.')
destination.mkdir(parents=True)
for directory in ['assets','css','js']:
    shutil.copytree(root/directory, destination/directory, ignore=shutil.ignore_patterns('.DS_Store'))
for name in ['index.html','dev.html','manifest.webmanifest','sw.js','version.json','favicon.ico','.nojekyll','LICENSE','CREDITS.md']:
    shutil.copy2(root/name, destination/name)
print('Packaged static site:',destination)
