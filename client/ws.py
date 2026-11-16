#!/usr/bin/env python3
"""Listen to the rover, and keep what it says.

    python3 client/ws.py [host [port]]               # print every frame
    python3 client/ws.py --db rover.db               # and record them in SQLite
    python3 client/ws.py --prometheus 9101           # and serve /metrics
    python3 client/ws.py --db rover.db --import rover-log.jsonl
                                                     # load a panel recording; no rover

It sends nothing, so it never takes control or stops the rover, and it can
listen while the panel, drive.py or the pad drives. It keeps trying to
reconnect whenever the link goes (the rover rebooting, WiFi dropping) until
Ctrl-C.

--db records telemetry, the rover's log, its metrics and its settings in a
SQLite database (client/recorder.py has its tables), each row stamped with
when it arrived. For example, the warnings of the last hour, and what the
pad was refused or did:

    sqlite3 rover.db "SELECT datetime(at, 'unixepoch', 'localtime'), src, text
                      FROM log WHERE warn AND at > unixepoch() - 3600"
    sqlite3 rover.db "SELECT text FROM log WHERE src = 'PAD' ORDER BY at"

--prometheus [HOST:]PORT serves the latest values for Prometheus to scrape
at http://HOST:PORT/metrics (HOST is 127.0.0.1 unless given), so Prometheus
keeps the history and Grafana graphs it.

--import loads a recording the panel saved (Options, Log, Save) into --db,
and then listens on as usual unless --no-listen.

For anything interactive use client/drive.py, which can also send commands.
"""

import argparse
import asyncio
import json
import sys
import time

import websockets

from drive import DEFAULT_HOST, DEFAULT_PORT
from recorder import Exporter, Store, kind_of

RETRY_S = 2.0


def describe(frame, raw: str) -> str:
    """One line for the terminal: a log line readably, with whose line it is
    (USB, PAD, WIFI or ROVER), anything else as sent."""
    if kind_of(frame) == "log":
        t = frame.get("t")
        seconds = f"{t / 1000:10.3f}s" if isinstance(t, (int, float)) else "          -"
        source = frame.get("src") if isinstance(frame.get("src"), str) else "-"
        level = "WARN " if frame.get("warn") is True else ""
        return f"log {seconds}  {source:<5}  {level}{frame['log']}"
    return raw


async def listen(host: str, port: int, keepers, quiet: bool, exporter) -> None:
    uri = f"ws://{host}:{port}"
    while True:
        try:
            async with websockets.connect(uri) as websocket:
                print(f"Connected to {uri}", flush=True)
                if exporter:
                    exporter.set_connected(True)
                async for message in websocket:
                    if isinstance(message, bytes):
                        continue
                    try:
                        frame = json.loads(message)
                    except ValueError:
                        frame = None
                    at = time.time()
                    for keeper in keepers:
                        keeper.add(frame, at)
                    if not quiet:
                        print(describe(frame, message), flush=True)
            print("Connection closed", flush=True)
        except (OSError, asyncio.TimeoutError, websockets.WebSocketException) as error:
            print(f"Cannot reach {uri}: {error}", flush=True)
        if exporter:
            exporter.set_connected(False)
        await asyncio.sleep(RETRY_S)


def endpoint(text: str):
    host, _, port = text.rpartition(":")
    return host or "127.0.0.1", int(port)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("host", nargs="?", default=DEFAULT_HOST)
    parser.add_argument("port", nargs="?", type=int, default=DEFAULT_PORT)
    parser.add_argument("--db", help="record every frame in this SQLite database")
    parser.add_argument("--prometheus", metavar="[HOST:]PORT", type=endpoint,
                        help="serve the latest values for Prometheus at /metrics")
    parser.add_argument("--import", dest="imports", action="append", default=[], metavar="FILE",
                        help="load a recording the panel saved (JSON lines) into --db")
    parser.add_argument("--no-listen", action="store_true", help="only --import; do not connect")
    parser.add_argument("--quiet", action="store_true", help="print nothing per frame")
    args = parser.parse_args()

    if args.imports and not args.db:
        parser.error("--import needs --db")
    store = Store(args.db) if args.db else None
    for path in args.imports:
        with open(path, encoding="utf-8") as lines:
            kept, skipped = store.import_lines(lines)
        print(f"{path}: {kept} frames kept, {skipped} lines skipped")
    if args.no_listen:
        return 0

    keepers = [store] if store else []
    exporter = None
    if args.prometheus:
        exporter = Exporter()
        server = exporter.serve(*args.prometheus)
        host, port = server.server_address[:2]
        print(f"Prometheus metrics at http://{host}:{port}/metrics")
        keepers.append(exporter)
    try:
        asyncio.run(listen(args.host, args.port, keepers, args.quiet, exporter))
    except KeyboardInterrupt:
        pass
    finally:
        if store:
            store.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
