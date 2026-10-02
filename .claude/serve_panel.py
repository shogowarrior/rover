"""Serve extras/joystick on 127.0.0.1 for the Claude desktop browser pane.

The panel is a file:// page. The pane renders local files as static
snapshots with no CSS or JS, so it needs the panel over HTTP. Every response
says no-store: python's plain http.server lets the browser keep old copies,
which once made the pane run a fresh sim.js against a stale protocol.js.

    python3 .claude/serve_panel.py [port]     (default 8766)
"""
import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "extras" / "joystick"


class NoStoreHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    handler = functools.partial(NoStoreHandler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
