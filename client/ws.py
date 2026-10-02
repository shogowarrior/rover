#!/usr/bin/env python3
"""Minimal telemetry listener -- prints whatever the rover broadcasts.

    python3 client/ws.py [host [port]]

For anything interactive use client/drive.py, which can also send commands.
"""

import asyncio
import sys

import websockets

from drive import DEFAULT_HOST, DEFAULT_PORT


async def listen(host: str, port: int) -> None:
    uri = f"ws://{host}:{port}"
    async with websockets.connect(uri) as websocket:
        print(f"Connected to {uri}")
        try:
            async for message in websocket:
                print(message)
        except websockets.ConnectionClosed:
            print("Connection closed")


if __name__ == "__main__":
    host = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_HOST
    port = int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_PORT
    try:
        asyncio.run(listen(host, port))
    except KeyboardInterrupt:
        pass
