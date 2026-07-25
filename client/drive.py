#!/usr/bin/env python3
"""Drive the rover over its WebSocket link and watch telemetry.

    python3 client/drive.py                 # default host
    python3 client/drive.py --host rover.local
    python3 client/drive.py --listen        # telemetry only, no control

The rover starts in autonomous mode. The first command sent takes control and
holds it -- press `t` to hand it back.

Commands carry a short duration and the firmware releases the motors when it
expires, so holding a key (and letting the terminal auto-repeat) is what keeps
the rover moving. It also runs a deadman: if nothing arrives for ~1.5 s it
stops on its own, which is what protects you if this client dies mid-move.
"""

import argparse
import asyncio
import json
import sys
import termios
import tty
from contextlib import contextmanager

import websockets

# These integers are the wire protocol. They must match src/MoveCodes.h.
STOP = 0
MOVE_FORWARD = 1
MOVE_BACKWARD = 2
MOVE_RIGHT = 3
MOVE_LEFT = 4
ROTATE_CLOCKWISE = 17
ROTATE_COUNTERCLOCKWISE = 18
RESUME_AUTONOMOUS = 19

DEFAULT_HOST = "192.168.0.115"
DEFAULT_PORT = 81

# Shorter than the firmware's 1.5 s deadman, so a released key coasts to a stop
# rather than running on.
MOVE_DURATION_MS = 400

KEYS = {
    "w": (MOVE_FORWARD, "forward"),
    "s": (MOVE_BACKWARD, "backward"),
    "a": (MOVE_LEFT, "strafe left"),
    "d": (MOVE_RIGHT, "strafe right"),
    "q": (ROTATE_COUNTERCLOCKWISE, "rotate ccw"),
    "e": (ROTATE_CLOCKWISE, "rotate cw"),
    " ": (STOP, "stop"),
    "t": (RESUME_AUTONOMOUS, "autonomous"),
}

HELP = """\
  w/s   forward / backward        q/e  rotate ccw / cw
  a/d   strafe left / right       spc  stop
  -/+   speed down / up           t    hand back to autonomous
  ?     this help                 x    quit
"""


@contextmanager
def raw_terminal():
    """Put stdin in raw mode so single keypresses arrive without Enter."""
    if not sys.stdin.isatty():
        yield False
        return
    fd = sys.stdin.fileno()
    saved = termios.tcgetattr(fd)
    try:
        tty.setcbreak(fd)
        yield True
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, saved)


def out(line: str) -> None:
    # Raw mode does not translate \n, so carriage returns must be explicit.
    sys.stdout.write(line + "\r\n")
    sys.stdout.flush()


async def receive(ws) -> None:
    """Print telemetry frames until the link closes."""
    try:
        async for message in ws:
            try:
                data = json.loads(message)
            except json.JSONDecodeError:
                out(f"  {message}")
                continue
            out(
                "  mode={mode:<10} move={move:<14} "
                "L={distanceLeft:>6} F={distanceFront:>6} R={distanceRight:>6}  "
                "{temperature}C".format(
                    mode=data.get("mode", "?"),
                    move=data.get("move", "?"),
                    distanceLeft=_fmt(data.get("distanceLeft")),
                    distanceFront=_fmt(data.get("distanceFront")),
                    distanceRight=_fmt(data.get("distanceRight")),
                    temperature=_fmt(data.get("temperature")),
                )
            )
    except websockets.ConnectionClosed:
        out("connection closed by rover")


def _fmt(value) -> str:
    if value is None:
        return "-"
    if isinstance(value, float):
        return f"{value:.1f}"
    return str(value)


async def transmit(ws) -> None:
    """Translate keypresses into commands until the operator quits."""
    loop = asyncio.get_running_loop()
    keys: asyncio.Queue = asyncio.Queue()

    def on_stdin() -> None:
        char = sys.stdin.read(1)
        if char:
            keys.put_nowait(char)

    loop.add_reader(sys.stdin.fileno(), on_stdin)
    speed = 64

    try:
        while True:
            key = await keys.get()

            if key in ("x", "\x03", "\x04"):  # x, Ctrl-C, Ctrl-D
                # Never walk away leaving the rover under power.
                await send(ws, STOP, 0)
                out("stopped, disconnecting")
                return

            if key == "?":
                out(HELP)
                continue

            if key in ("-", "_"):
                speed = max(0, speed - 16)
                out(f"speed {speed}")
                continue

            if key in ("+", "="):
                speed = min(255, speed + 16)
                out(f"speed {speed}")
                continue

            entry = KEYS.get(key)
            if entry is None:
                continue

            move, label = entry
            await send(ws, move, 0 if move == STOP else speed)
            out(f"-> {label}")
    finally:
        loop.remove_reader(sys.stdin.fileno())


async def send(ws, move: int, speed: int) -> None:
    await ws.send(
        json.dumps({"move": move, "speed": speed, "duration": MOVE_DURATION_MS})
    )


async def main(host: str, port: int, listen_only: bool) -> int:
    uri = f"ws://{host}:{port}"
    out(f"connecting to {uri} ...")

    try:
        async with websockets.connect(uri) as ws:
            out("connected" + ("  (listen only)" if listen_only else ""))
            if listen_only:
                await receive(ws)
                return 0

            out(HELP)
            with raw_terminal() as interactive:
                if not interactive:
                    out("stdin is not a tty; falling back to listen-only")
                    await receive(ws)
                    return 0

                receiver = asyncio.create_task(receive(ws))
                try:
                    await transmit(ws)
                finally:
                    receiver.cancel()
            return 0
    except OSError as exc:
        out(f"could not reach {uri}: {exc}")
        return 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument(
        "--listen", action="store_true", help="print telemetry without sending commands"
    )
    args = parser.parse_args()

    try:
        sys.exit(asyncio.run(main(args.host, args.port, args.listen)))
    except KeyboardInterrupt:
        sys.exit(130)
