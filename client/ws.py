#!/usr/bin/env python3
"""Minimal telemetry listener -- prints whatever the rover broadcasts.

    python3 client/ws.py [host]

For anything interactive use client/drive.py, which can also send commands.
"""

import asyncio
import sys

import websockets

DEFAULT_HOST = "192.168.0.115"
PORT = 81


async def listen(host: str) -> None:
    uri = f"ws://{host}:{PORT}"
    async with websockets.connect(uri) as websocket:
        print(f"Connected to {uri}")
        try:
            async for message in websocket:
                print(message)
        except websockets.ConnectionClosed:
            print("Connection closed")


if __name__ == "__main__":
    host = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_HOST
    try:
        # asyncio.run() replaces get_event_loop().run_until_complete(), which is
        # deprecated and raises on Python 3.12+ when no loop is already running.
        asyncio.run(listen(host))
    except KeyboardInterrupt:
        pass
