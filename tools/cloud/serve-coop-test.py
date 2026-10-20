#!/usr/bin/env python3
"""Four isolated browser origins, bound to loopback, using demo Firebase emulators only."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit
import os

ROOT = Path(__file__).resolve().parents[2]
os.chdir(ROOT)

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        body = None
        if path == '/js/core/cloud-config.js':
            body = b'G.CLOUD_CONFIG={projectId:"demo-pokesurvivor",apiKey:"fake-api-key",emulator:true};'
        elif path in ['/', '/index.html']:
            body = (ROOT/'index.html').read_text().replace(
                "connect-src 'self'", "connect-src 'self' http://127.0.0.1:9099 http://127.0.0.1:8089").encode()
        if body is None:
            return super().do_GET()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8' if path in ['/', '/index.html'] else 'text/javascript')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *_):
        pass

servers = [ThreadingHTTPServer(('127.0.0.1', port), Handler) for port in range(8771,8775)]
for server in servers:
    Thread(target=server.serve_forever, daemon=True).start()
print('Co-op test origins: http://127.0.0.1:8771 through :8774 (demo emulators only)', flush=True)
import signal
signal.pause()
