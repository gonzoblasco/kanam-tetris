#!/usr/bin/env python3
"""Serve the game with caching disabled.

`python3 -m http.server` sends no Cache-Control header, so Safari applies
heuristic caching to ES modules and can keep running an old build after an
edit (seen during v0.5: a stale render.js served alpha 0.10 after the file
on disk said 0.30). This server sends `no-store` so a reload always
reflects the working tree.

Usage: python3 serve.py [port]   (default 8000)
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # keep the console quiet: the game is the feedback


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(NoCacheHandler, directory=".")
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"kanam-tetris en http://localhost:{port} (sin cache)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
