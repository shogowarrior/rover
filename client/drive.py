#!/usr/bin/env python3
"""Drive the rover over its WebSocket link and watch telemetry.

    python3 client/drive.py                 # default host
    python3 client/drive.py --host rover.local
    python3 client/drive.py --listen        # telemetry only, no control

After power-on the rover explores on its own. After any other reset -- an OTA
flash, a crash, the watchdog, a brownout -- it starts in manual and waits,
stopped; losing WiFi, or the start of an OTA flash, drops it to manual too.
Any command takes control, a stop included. Press `t` to hand control back and
let the rover explore; if exploration has halted (boxed in, sensor silent),
`t` makes it look again.

Every command carries a duration and the firmware releases the motors when it
runs out, so holding a key (and letting the terminal auto-repeat) is what keeps
the rover moving. The firmware also caps each command at 1.5 s, whatever
duration it asks for, and that cap is the deadman: if this client dies
mid-move, the rover stops within 1.5 s.

Quitting (x, Ctrl-C, Ctrl-D) stops the rover if a move this session sent may
still be running, and otherwise sends nothing, so an exploring rover goes on
exploring: a STOP is a command like any other, and would take control away
from exploration. --listen sends nothing, so it can watch while something else
drives, and closing it does not stop the rover.

Reading single keys needs termios, which Windows lacks. There, and whenever
stdin is not a terminal, this client only listens. termios is imported only
where keys are read, so client/ws.py and client/rover.ipynb can import this
module's constants on any platform.
"""

import argparse
import asyncio
import json
import os
import sys
from contextlib import contextmanager

import websockets

# These integers are the wire protocol. They must match src/MoveCodes.h;
# tools/check_protocol.py checks that they do.
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

# How long each command drives for. The firmware caps every command at 1.5 s
# and that cap is its deadman; this is shorter, so a released key coasts to a
# stop within 0.4 s rather than running on. Once auto-repeat is going, a held
# key re-sends well inside it -- but a terminal waits a while before its first
# repeat, and that wait can outlast 0.4 s, so the first moment of a held key
# may stutter.
MOVE_DURATION_MS = 400

# A command can reach the rover later than it left: WiFi retries, or the
# ESP32's modem sleep (on whenever the gamepad is compiled in) holding a
# frame for a few hundred milliseconds. Quitting treats a move as possibly
# still running for this long past its own duration. Generous on purpose:
# erring long costs at most one STOP to a rover someone handed back to
# exploration within the last second; erring short walks away from wheels
# this session set turning.
ARRIVAL_SLACK_S = 0.5

# The firmware reports a bearing that heard no echo -- nothing within the
# sonar's range -- as this distance (kinematics::DISTANCE_FAR_CM).
DISTANCE_FAR_CM = 999
NO_ECHO = "no echo"

# Shown in place of the move while telemetry says "motorsReady": false. The
# warning says what a reset does: whoever reads it may have hands on the
# wiring, and a power-on or EN reset starts exploring.
NO_MOTORS = "NO MOTORS"
NO_MOTORS_WARNING = """\
  NO MOTORS: the motor shield did not answer when the rover booted, so the
  wheels cannot move. Check its I2C wiring and power, then reset the rover
  with its wheels off the ground: after a power-on or the EN button it
  starts exploring."""

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

END_OF_INPUT = ""  # queued in place of a key when stdin reaches end of file

# x, Ctrl-C, Ctrl-D, and stdin closing. Ctrl-C arrives here as a key rather
# than as SIGINT because raw_terminal() turns the terminal's signal keys off.
QUIT_KEYS = ("x", "\x03", "\x04", END_OF_INPUT)

# Telemetry field for each bearing, left to right as the rover sees them.
BEARINGS = (
    ("L", "distanceLeft"),
    ("FL", "distanceFrontLeft"),
    ("F", "distanceFront"),
    ("FR", "distanceFrontRight"),
    ("R", "distanceRight"),
)

# Telemetry names a move as src/MoveCodes.h does, and a name as long as
# ROTATE_COUNTERCLOCKWISE pushes a row past 80 columns. Rows use these shorter
# words for every move this client, the browser panel and exploration make;
# any other move (a pivot) is shown as sent, and widens its row.
MOVE_WORDS = {
    "STOP": "stop",
    "MOVE_FORWARD": "forward",
    "MOVE_BACKWARD": "backward",
    "MOVE_LEFT": "strafe left",
    "MOVE_RIGHT": "strafe right",
    "MOVE_DIAGONAL45": "forward-right",
    "MOVE_DIAGONAL135": "forward-left",
    "MOVE_DIAGONAL225": "backward-left",
    "MOVE_DIAGONAL315": "backward-right",
    "ROTATE_CLOCKWISE": "rotate cw",
    "ROTATE_COUNTERCLOCKWISE": "rotate ccw",
}

# Telemetry rows between repeats of the column headings: about a screenful on
# a 24-row terminal, so a heading stays in view as the rows scroll past.
HEADER_EVERY = 20

HELP = """\
  w/s   forward / backward        q/e  rotate ccw / cw
  a/d   strafe left / right       spc  stop
  -/+   speed down / up           t    hand back to autonomous
  ?     this help                 x    quit

  Telemetry is a table, a row per frame: the mode (and the phase while the
  rover explores), the move (or why exploration halted; t makes it look
  again), the distance in cm on each bearing from left to right, and the
  board's temperature. NO MOTORS in place of the move means the motor
  shield did not answer at boot, and the wheels cannot move.
"""


@contextmanager
def raw_terminal():
    """Put stdin in cbreak mode so single keypresses arrive without Enter.

    Yields False, changing nothing, when there are no single keys to read:
    stdin is not a terminal, or the platform has no termios (Windows).
    """
    if not sys.stdin.isatty():
        yield False
        return
    try:
        # POSIX only, imported here so ws.py and the notebook import this anywhere.
        import termios
        import tty
    except ImportError:
        yield False
        return
    fd = sys.stdin.fileno()
    saved = termios.tcgetattr(fd)
    try:
        tty.setcbreak(fd)
        # Turn the signal keys off as well, so Ctrl-C reaches transmit() as
        # the byte \x03 and quits the way `x` does, stopping the rover first.
        # As SIGINT it interrupted whatever the event loop was doing, no STOP
        # was sent, and the rover stopped only because the firmware noticed
        # the socket close. Ctrl-Z and Ctrl-\ lose their meaning here too.
        attrs = termios.tcgetattr(fd)
        attrs[tty.LFLAG] &= ~termios.ISIG
        termios.tcsetattr(fd, termios.TCSANOW, attrs)
        yield True
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, saved)


def out(line: str) -> None:
    # A bare \n is enough. cbreak mode, unlike raw mode, leaves the terminal's
    # output processing on, so the terminal turns \n into \r\n itself; a \r
    # of our own would only end up in the file when stdout is redirected.
    try:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()
    except OSError:
        # The terminal has gone (EIO after a hangup). Carry on regardless: a
        # failed print must not abort the quit path before its STOP is sent.
        pass


async def receive(ws) -> None:
    """Print telemetry as a table, a row per frame, until the link closes."""
    rows = 0
    warned = False  # NO_MOTORS_WARNING printed since motorsReady last read true
    try:
        async for message in ws:
            # Every row says NO MOTORS while the shield is missing; this says
            # once what that means and what to do about it.
            ready = motors_ready(_frame(message))
            if ready is False and not warned:
                out(NO_MOTORS_WARNING)
            if ready is not None:
                warned = not ready

            if rows % HEADER_EVERY == 0:
                out(HEADER)
            out(describe(message))
            rows += 1
    except websockets.ConnectionClosed:
        pass  # closed without a clean handshake; reported below all the same
    out("connection to the rover closed")


def _frame(message):
    """A telemetry frame as a dict, or None if it is not a JSON object."""
    try:
        data = json.loads(message)
    except ValueError:  # not JSON, or a binary frame that is not even text
        return None
    return data if isinstance(data, dict) else None


def motors_ready(data):
    """True or False as a frame from _frame() says in "motorsReady"; None when
    it says nothing, as firmware from before the key existed does. Unknown
    must not read as a missing shield."""
    ready = data.get("motorsReady") if data else None
    return ready if isinstance(ready, bool) else None


def describe(message) -> str:
    """One telemetry frame as one row of the table under HEADER, for example

      STATE          MOVE                  L      FL       F      FR       R  TEMP
      AUTO CRUISE    forward             120      85      40 no echo       8  52.2C
      AUTO HALTED    boxed in             12      15       9      14      11  52.2C
      MANUAL         rotate ccw           30      45 no echo      45      30  53.5C
      MANUAL         NO MOTORS            30      45 no echo      45      30  53.5C

    The phase follows the mode only while the rover explores. Exploration
    stops the wheels when it halts, so a halted rover's move is always a stop,
    and the reason it halted takes the move's place. NO MOTORS takes it in
    turn while the motor shield is missing: no move reaches the wheels then,
    and that is the first thing to fix. The distances show as "-" until every
    bearing has been measured once.
    """
    data = _frame(message)
    if data is None:
        return f"  {message}"

    state = _text(data.get("mode"))
    if state == "AUTONOMOUS":
        state = "AUTO"  # in full, it takes columns the distances need
    phase = data.get("phase")
    if phase is not None:
        state += f" {phase}"

    halt = data.get("halt")
    move = _text(data.get("move"))
    move = _text(halt) if halt else MOVE_WORDS.get(move, move)
    if motors_ready(data) is False:
        move = NO_MOTORS

    temperature = data.get("temperature")
    return _row(
        state,
        move,
        [_distance(data.get(key)) for _, key in BEARINGS],
        f"{temperature:.1f}C" if isinstance(temperature, (int, float)) else "-",
    )


def _row(state: str, move: str, readings: list, temperature: str) -> str:
    # Fixed widths keep each value under its heading as its neighbours change.
    # They fit the longest common value in each column -- "AUTO SIDESTEP",
    # "backward-right", "no echo" -- and still keep the row to 79 columns: on
    # an 80-column terminal a wider row wraps, and every frame takes two lines.
    ranges = " ".join(reading.rjust(len(NO_ECHO)) for reading in readings)
    return f"  {state:<13}  {move:<14}  {ranges}  {temperature}"


HEADER = _row("STATE", "MOVE", [label for label, _ in BEARINGS], "TEMP")


def _distance(value) -> str:
    if isinstance(value, (int, float)):
        return NO_ECHO if value >= DISTANCE_FAR_CM else f"{value:.0f}"
    return _text(value)


def _text(value) -> str:
    return "-" if value is None else str(value)


async def transmit(ws) -> None:
    """Translate keypresses into commands until the operator quits."""
    loop = asyncio.get_running_loop()
    fd = sys.stdin.fileno()
    keys: asyncio.Queue = asyncio.Queue()

    def on_stdin() -> None:
        # os.read, not sys.stdin.read(1). The text wrapper pulls every byte
        # waiting on the fd into its own buffer and returns one character; the
        # rest sat there, invisible to add_reader because the fd was now
        # empty, until the next keystroke. A space typed after a burst of
        # auto-repeated moves -- a STOP -- waited for another key to be sent.
        try:
            data = os.read(fd, 64)
        except OSError:  # EIO: the terminal has hung up
            data = b""
        if not data:
            # At end of file the fd stays readable forever; stop watching it.
            loop.remove_reader(fd)
            keys.put_nowait(END_OF_INPUT)
            return
        # Every key this client acts on is ASCII, and no byte of a multi-byte
        # UTF-8 character is, so decoding byte for byte cannot turn one into
        # a command.
        for char in data.decode("latin-1"):
            keys.put_nowait(char)

    loop.add_reader(fd, on_stdin)
    speed = 64
    # Until when (on the loop's clock) a move this session sent may still have
    # the wheels turning: its duration, plus ARRIVAL_SLACK_S. Quitting sends
    # STOP only before then, because a STOP would also knock an exploring
    # rover out of autonomous mode. A flag set by any motion and never
    # expiring sent that STOP long after the move had run out -- to a rover
    # the panel or the gamepad had since handed back to exploration.
    driving_until = 0.0

    try:
        while True:
            key = await keys.get()

            if key in QUIT_KEYS:
                if loop.time() < driving_until:
                    # Never walk away leaving the rover under power.
                    await send(ws, STOP, 0)
                    out("stopped, disconnecting")
                else:
                    out("disconnecting")
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
            sent_speed = 0 if move == STOP else speed
            await send(ws, move, sent_speed)
            # Stop, autonomous and a move at speed 0 all release the motors.
            if move in (STOP, RESUME_AUTONOMOUS) or sent_speed == 0:
                driving_until = 0.0
            else:
                driving_until = loop.time() + MOVE_DURATION_MS / 1000 + ARRIVAL_SLACK_S
            out(f"-> {label}")
    finally:
        loop.remove_reader(fd)


async def send(ws, move: int, speed: int) -> None:
    await ws.send(
        json.dumps({"move": move, "speed": speed, "duration": MOVE_DURATION_MS})
    )


async def session(ws) -> None:
    """Run the keyboard and the telemetry side by side until either ends."""
    receiver = asyncio.create_task(receive(ws))
    sender = asyncio.create_task(transmit(ws))
    try:
        # Waiting on the keyboard alone left a session whose link had closed
        # -- an OTA flash reboots the rover -- looking alive until the next
        # key died with ConnectionClosed.
        done, _ = await asyncio.wait({receiver, sender}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        receiver.cancel()
        sender.cancel()
    for task in done:
        task.result()  # re-raise whatever ended it abnormally


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
                    out("cannot read single keys here (stdin is not a terminal, "
                        "or there is no termios); listening only")
                    await receive(ws)
                    return 0

                await session(ws)
            return 0
    except websockets.ConnectionClosed:
        # A key was being sent as the link went down.
        out("connection to the rover closed")
        return 0
    except (OSError, asyncio.TimeoutError) as exc:
        # asyncio.TimeoutError is the library's open timeout: nothing answered
        # at that address. It is an OSError only from Python 3.11, and before
        # that a powered-off rover ended this client with a traceback.
        out(f"could not reach {uri}: {str(exc) or 'timed out'}")
        return 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
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
