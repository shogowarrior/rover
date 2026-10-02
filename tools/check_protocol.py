#!/usr/bin/env python3
"""Check that every client agrees with the firmware on the wire protocol.

The firmware defines the protocol once, in src/, but the Python clients and
the browser panel each carry their own copies of parts of it. This checks:

  * the move codes (src/MoveCodes.h) in drive.py and the panel, which
    carries every one of them;
  * the WebSocket port, in drive.py (ws.py imports it) and the panel;
  * the distances the panel colours its scan fan with, and the distance
    telemetry sends for a bearing with no echo;
  * the command timing: no client asks for more than the firmware's cap,
    and the panel re-sends a held move before the last one runs out;
  * the panel's limit on how often a dragged stick changes speed, which is
    the gamepad's rule too (GAMEPAD_SPEED_CHANGE_MS);
  * the angle the panel draws each scan wedge at, against the bearing the
    firmware measures that distance at (ExploreParams, Explorer::angleOf);
  * the names of the telemetry keys the panel and drive.py read, and of the
    command fields they send, against those src/Protocol.cpp writes and
    reads;
  * the control-scheme names the panel sends, against those
    protocol::schemeName() gives (src/Protocol.cpp), the most speed the
    panel lets a command ask for, and the limit the firmware clamps that to
    (MOTOR_SPEED_LIMIT), which the panel's simulator clamps a preview to;
  * the panel's scheme message, against the field readMessage() takes a
    scheme from (and never with a move, which would make it a command), and
    the telemetry key the panel reads the scheme from, against the one
    writeTelemetry() sends it under.

The panel keeps every number and name it mirrors in
extras/joystick/js/protocol.js. Its telemetry reads, its commands and its
scan bearings may be in any of extras/joystick/js/*.js, and are looked for in
all of them.

Nothing at build time notices when a copy drifts, and a drifted copy fails
quietly -- a key that sends the wrong motion, a panel that shows a clear path
where the rover sees an obstacle, a held stick that stutters, a readout that
shows a dash forever because a key was renamed. This script is that check;
CI runs it, and so does the build hook after an edit to any file it reads.

    python3 tools/check_protocol.py

It exits non-zero, naming the file and both values, on any mismatch. It also
fails when something it looks for is missing, so that renaming one cannot
quietly switch its check off: if a client renames a constant, update the
tables below to match.

Not covered: client/ws.py and client/rover.ipynb, which import their numbers
from drive.py; the default host address, which is per-network
configuration every client lets the operator override; and the panel's
simulator's copies in extras/joystick/js/sim.js (the wheel table from
src/MovePatterns.cpp, the sweep timing from ExploreParams, the telemetry
interval and the telemetry keys it writes), which
extras/joystick/test/sim.test.js checks instead, in CI too.

Standard library only; the files are parsed with regular expressions.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MOVE_CODES_H = "src/MoveCodes.h"
TUNING_H = "src/Tuning.h"
KINEMATICS_H = "src/Kinematics.h"
PROTOCOL_CPP = "src/Protocol.cpp"
EXPLORER_H = "src/Explorer.h"
EXPLORER_CPP = "src/Explorer.cpp"
DRIVE_PY = "client/drive.py"
PANEL_PROTOCOL_JS = "extras/joystick/js/protocol.js"
PANEL_SCRIPTS = "extras/joystick/js/*.js"  # a glob: every panel script but joy.js

NUMBER = r"([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)"

# How each language spells a named numeric constant; NAME is filled in per
# lookup. Python and JavaScript are anchored at the start of a line, so a
# commented-out definition never matches; C++ comments are stripped first.
CONSTANT = {
    ".h": r"\bconstexpr\s+[\w:]+(?:\s+[\w:]+)*\s+NAME\s*=\s*" + NUMBER + r"[fFuUlL]*\s*;",
    ".js": r"^\s*const\s+NAME\s*=\s*" + NUMBER + r"\s*;",
    ".py": r"^NAME\s*=\s*" + NUMBER + r"\s*(?:#.*)?$",
}

# The same, for any upper-case name bound to an integer: how the clients
# spell their copies of the move codes.
MOVE_CODE_COPY = {
    ".js": re.compile(r"^\s*const\s+([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*;", re.M),
    ".py": re.compile(r"^([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*(?:#.*)?$", re.M),
}
MOVE_CODE_CLIENTS = (DRIVE_PY, PANEL_PROTOCOL_JS)
# Clients that carry every move code, not only those they send: the panel
# names all eighteen motions (mecanum.js) and sends the pivots under the
# ADVANCED scheme.
COMPLETE_MOVE_CODE_CLIENTS = (PANEL_PROTOCOL_JS,)

# Client constants that must equal a firmware constant:
#   (client file, its name for the constant, firmware file, firmware name, why)
MIRRORS = [
    (PANEL_PROTOCOL_JS, "STOP_CM", TUNING_H, "EXPLORE_STOP_CM",
     "the panel marks a bearing blocked at the distance exploration stops at"),
    (PANEL_PROTOCOL_JS, "GO_CM", TUNING_H, "EXPLORE_GO_CM",
     "the panel marks a bearing clear at the distance exploration starts at"),
    (PANEL_PROTOCOL_JS, "FAR_CM", KINEMATICS_H, "DISTANCE_FAR_CM",
     "telemetry sends this value for a bearing with no echo"),
    (DRIVE_PY, "DISTANCE_FAR_CM", KINEMATICS_H, "DISTANCE_FAR_CM",
     "telemetry sends this value for a bearing with no echo"),
    (PANEL_PROTOCOL_JS, "PORT", TUNING_H, "WEBSOCKET_PORT",
     "the client would connect to a port nothing listens on"),
    (DRIVE_PY, "DEFAULT_PORT", TUNING_H, "WEBSOCKET_PORT",
     "the client would connect to a port nothing listens on"),
    (PANEL_PROTOCOL_JS, "STICK_SEND_MS", TUNING_H, "GAMEPAD_SPEED_CHANGE_MS",
     "a dragged stick changes speed at most this often from the panel as from the gamepad; "
     "each change costs the rover a four-motor rewrite"),
    (PANEL_PROTOCOL_JS, "SPEED_MAX", KINEMATICS_H, "MOTOR_SPEED_MAX",
     "the panel clamps a program's speed to this; the motor driver takes a byte"),
    (PANEL_PROTOCOL_JS, "MOTOR_SPEED_LIMIT", TUNING_H, "MOTOR_SPEED_LIMIT",
     "the simulator clamps a preview's speed to this, as Rover::drive() clamps the rover's; "
     "otherwise a preview drives faster and farther than the rover"),
]

# The panel's name for each control scheme (kinematics::ControlScheme) must be
# the one protocol::schemeName() gives it. The firmware compares the name a
# client sends exactly and ignores one it does not know, so a misspelt copy
# is a scheme toggle that silently does nothing. The constants are named as
# the enumerators are.
SCHEME_CLIENT = PANEL_PROTOCOL_JS
STRING_CONSTANT = r'^\s*const\s+NAME\s*=\s*"([^"\n]*)"\s*;'

# Where each client reads telemetry keys and writes command fields, once its
# comments are removed (a comment that mentions data.foo is not a read). A
# client is one file, or a glob of the files it is made of:
#   reads     patterns for a telemetry key read off the frame, which both
#             clients hold in a variable named `data`;
#   bearings  the table of scan keys the client shows, and a key in it;
#   command   the object literal every command is sent as, and a field in it.
KEY_READERS = {
    PANEL_SCRIPTS: {
        "reads": [
            re.compile(r"(?<![\w.$])data\.([A-Za-z_$][\w$]*)"),
            re.compile(r"(?<![\w.$])data\[\s*[\"'](\w+)[\"']\s*\]"),
        ],
        "bearings": (re.compile(r"^\s*const\s+BEARINGS\s*=\s*\[(.*?)\];", re.M | re.S),
                     re.compile(r"\bkey:\s*[\"'](\w+)[\"']")),
        # link.send({ move, speed, duration: MOVE_DURATION_MS }), or
        # JSON.stringify({ ... }) of the same
        "command": (re.compile(r"\b(?:send|JSON\.stringify)\(\s*\{(.*?)\}\s*\)", re.S),
                    re.compile(r"(?:^|,)\s*[\"']?([A-Za-z_$][\w$]*)[\"']?\s*(?=:|,|$)")),
    },
    DRIVE_PY: {
        "reads": [
            re.compile(r"(?<![\w.])data\.get\(\s*[\"'](\w+)[\"']"),
            re.compile(r"(?<![\w.])data\[\s*[\"'](\w+)[\"']\s*\]"),
        ],
        "bearings": (re.compile(r"^BEARINGS\s*=\s*\((.*?)^\)", re.M | re.S),
                     re.compile(r"\(\s*[\"'][^\"']*[\"']\s*,\s*[\"'](\w+)[\"']\s*\)")),
        # json.dumps({"move": move, "speed": speed, "duration": MOVE_DURATION_MS})
        "command": (re.compile(r"\bjson\.dumps\(\s*\{(.*?)\}\s*\)", re.S),
                    re.compile(r"[\"'](\w+)[\"']\s*:")),
    },
}

# Comments in each client language: whole-line and trailing ones, the latter
# only after whitespace, so the // in "ws://" and the # in f"{x:#x}" survive.
CLIENT_COMMENTS = {
    ".js": (re.compile(r"/\*.*?\*/", re.S), re.compile(r"(?:^|(?<=\s))//[^\n]*", re.M)),
    ".py": (re.compile(r"(?:^|(?<=\s))#[^\n]*", re.M),),
}


class Checker:
    """Reads each file once and collects every problem, rather than stopping at
    the first: one CI run should list everything that has drifted."""

    def __init__(self, root: Path):
        self.root = root
        self.problems: list[str] = []
        self._texts: dict[str, str | None] = {}

    def problem(self, message: str) -> None:
        # A firmware constant several clients mirror is looked up once per
        # client; report it missing once.
        if message not in self.problems:
            self.problems.append(message)

    def text(self, relpath: str) -> str | None:
        """A file's contents, C++ comments removed; None (reported) if missing."""
        if relpath not in self._texts:
            try:
                text = (self.root / relpath).read_text(encoding="utf-8")
            except FileNotFoundError:
                self.problem(f"{relpath}: file not found")
                text = None
            if text is not None and relpath.endswith((".h", ".cpp")):
                text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
                text = re.sub(r"//[^\n]*", "", text)
            self._texts[relpath] = text
        return self._texts[relpath]

    def code(self, relpath: str) -> str | None:
        """A client's contents with its comments removed; None if missing.

        text() keeps client comments, because the constant patterns are
        anchored at the start of a line and a comment never matches them. The
        key patterns are not anchored, so they read this instead.
        """
        text = self.text(relpath)
        if text is None:
            return None
        for comment in CLIENT_COMMENTS[Path(relpath).suffix]:
            text = comment.sub("", text)
        return text

    def files(self, client: str) -> list[str]:
        """The files a client is made of: the one file named, or every file
        its glob matches, in order. A glob that matches nothing is reported."""
        if not any(c in client for c in "*?["):
            return [client]
        found = sorted(path.relative_to(self.root).as_posix() for path in self.root.glob(client))
        if not found:
            self.problem(f"{client}: no files found; if the client moved, update tools/check_protocol.py")
        return found

    def bearing_table(self, client: str) -> tuple[str, str] | None:
        """(file, body) of the client's BEARINGS table, or None (reported)."""
        block = KEY_READERS[client]["bearings"][0]
        for relpath in self.files(client):
            code = self.code(relpath)
            table = block.search(code) if code is not None else None
            if table:
                return relpath, table.group(1)
        self.problem(f"{client}: no BEARINGS table of scan keys found; if it moved, update tools/check_protocol.py")
        return None

    def constant(self, relpath: str, name: str) -> float | None:
        """The value of the constant `name` in the file, or None (reported)."""
        text = self.text(relpath)
        if text is None:
            return None
        match = re.search(CONSTANT[Path(relpath).suffix].replace("NAME", re.escape(name)), text, re.M)
        if match:
            return float(match.group(1))
        self.problem(
            f"{relpath}: no {name} found. If it was renamed or moved, "
            f"update tools/check_protocol.py so the check keeps running."
        )
        return None

    # --- The checks ---------------------------------------------------------

    def enumerators(self, body: str) -> dict[str, int]:
        """The codes in the body of `enum MoveCode`, valued as C++ values them.

        An enumerator written without `= N` is one more than the one before
        it. Reading only the explicit ones would let a code appended as plain
        `NEW_CODE,` escape every check, including a collision with a code
        already in use. MOVE_CODE_COUNT is not a code; it marks the end of the
        range isMoveCode() accepts, so a code placed after it is refused by
        the firmware.
        """
        entries = []  # (name, its `= N` text or None), in declaration order
        for item in (part.strip() for part in body.split(",")):
            if not item:
                continue
            match = re.fullmatch(r"([A-Za-z_]\w*)\s*(?:=\s*(.*))?", item, re.S)
            if not match:
                self.problem(f"{MOVE_CODES_H}: cannot read `{item}` in enum MoveCode")
                return {}
            entries.append(match.groups())

        names = [name for name, _ in entries]
        if "MOVE_CODE_COUNT" in names:
            end = names.index("MOVE_CODE_COUNT")
            if end != len(names) - 1:
                self.problem(
                    f"{MOVE_CODES_H}: {', '.join(names[end + 1:])} comes after MOVE_CODE_COUNT, so "
                    f"isMoveCode() rejects it; append new codes above MOVE_CODE_COUNT"
                )
            entries = entries[:end]

        codes: dict[str, int] = {}
        value = -1
        for name, explicit in entries:
            if explicit is None:
                value += 1
            elif re.fullmatch(r"\d+", explicit.strip()):
                value = int(explicit)
            else:
                self.problem(
                    f"{MOVE_CODES_H}: {name} = {explicit.strip()}; give move codes plain integer "
                    f"values, so tools/check_protocol.py can check them"
                )
                return codes
            codes[name] = value
        return codes

    def move_codes(self) -> int:
        """Every client copy of a move code equals src/MoveCodes.h."""
        text = self.text(MOVE_CODES_H)
        if text is None:
            return 0
        enum = re.search(r"\benum\s+MoveCode\s*\{(.*?)\}", text, re.S)
        codes = self.enumerators(enum.group(1)) if enum else {}
        if not codes:
            self.problem(f"{MOVE_CODES_H}: no `enum MoveCode {{ NAME = N, ... }}` found")
            return 0

        # Two names on one value would make the firmware's own table ambiguous.
        seen: dict[int, str] = {}
        for name, value in codes.items():
            if value in seen:
                self.problem(f"{MOVE_CODES_H}: {name} and {seen[value]} are both {value}; move codes must be unique")
            seen.setdefault(value, name)

        for relpath in MOVE_CODE_CLIENTS:
            text = self.text(relpath)
            if text is None:
                continue
            copies = [(name, int(value)) for name, value in MOVE_CODE_COPY[Path(relpath).suffix].findall(text) if name in codes]
            if not copies:
                self.problem(
                    f"{relpath}: no move-code constants found (NAME = N, named as in {MOVE_CODES_H}). "
                    f"If the client now spells them differently, update tools/check_protocol.py."
                )
            for name, value in copies:
                if value != codes[name]:
                    self.problem(f"{relpath}: {name} = {value}, but {MOVE_CODES_H} has {name} = {codes[name]}")
            if relpath in COMPLETE_MOVE_CODE_CLIENTS:
                have = {name for name, _ in copies}
                for name, value in codes.items():
                    if name not in have:
                        self.problem(f"{relpath}: no {name} (= {value}); the panel carries every move code in "
                                     f"{MOVE_CODES_H}, as `const {name} = {value};`")
        return len(codes)

    def mirrors(self) -> None:
        """Ports, thresholds and sentinels copied from the firmware match it."""
        for client, client_name, firmware, firmware_name, why in MIRRORS:
            theirs = self.constant(client, client_name)
            ours = self.constant(firmware, firmware_name)
            if theirs is not None and ours is not None and theirs != ours:
                self.problem(
                    f"{client}: {client_name} = {show(theirs)}, but {firmware} has "
                    f"{firmware_name} = {show(ours)} -- {why}"
                )

    def timing(self) -> None:
        """Held commands stay alive, and no client asks for more than the cap.

        The firmware cuts every command to COMMAND_DURATION_MAX_MS; that cap
        is the deadman. The panel keeps a command alive by re-sending it every
        REPEAT_MS, which only works while each command lasts longer than the
        gap to the next -- and a duration past the cap is silently cut to it,
        so the client's own arithmetic stops describing what the rover does.
        """
        cap = self.constant(TUNING_H, "COMMAND_DURATION_MAX_MS")
        for client in (PANEL_PROTOCOL_JS, DRIVE_PY):
            duration = self.constant(client, "MOVE_DURATION_MS")
            if cap is not None and duration is not None and duration > cap:
                self.problem(
                    f"{client}: MOVE_DURATION_MS = {show(duration)} exceeds COMMAND_DURATION_MAX_MS = "
                    f"{show(cap)} in {TUNING_H}; the firmware cuts every command to {show(cap)} ms"
                )

        repeat = self.constant(PANEL_PROTOCOL_JS, "REPEAT_MS")
        duration = self.constant(PANEL_PROTOCOL_JS, "MOVE_DURATION_MS")
        if repeat is not None and duration is not None and not repeat < duration:
            self.problem(
                f"{PANEL_PROTOCOL_JS}: REPEAT_MS = {show(repeat)} is not below MOVE_DURATION_MS = "
                f"{show(duration)}; a held stick's command would expire before it is re-sent"
            )

    def firmware_keys(self) -> tuple[set[str], dict[str, str], set[str]]:
        """What src/Protocol.cpp puts on the wire and takes off it.

        Returns the telemetry keys writeTelemetry() sets, the scan keys among
        them with the Explorer bearing each one carries, and the command
        fields readCommand() reads. keys() and bearings() both ask; problem()
        reports anything missing once.
        """
        text = self.text(PROTOCOL_CPP)
        if text is None:
            return set(), {}, set()
        sent = set(re.findall(r'\bdoc\[\s*"(\w+)"\s*\]\s*=', text))
        scan = dict(re.findall(r'\bdoc\[\s*"(\w+)"\s*\]\s*=\s*status\.scanCm\[\s*Explorer::(\w+)\s*\]', text))
        read = set(re.findall(r'\bjson\[\s*"(\w+)"\s*\]', text))
        if not sent:
            self.problem(f'{PROTOCOL_CPP}: no telemetry keys found (doc["key"] = ...). '
                         f"If writeTelemetry() changed shape, update tools/check_protocol.py.")
        if not scan:
            self.problem(f'{PROTOCOL_CPP}: no scan distances found (doc["key"] = status.scanCm[Explorer::BEARING]). '
                         f"If writeTelemetry() changed shape, update tools/check_protocol.py.")
        if not read:
            self.problem(f'{PROTOCOL_CPP}: no command fields found (json["field"]). '
                         f"If readCommand() changed shape, update tools/check_protocol.py.")
        return sent, scan, read

    def keys(self) -> int:
        """Every telemetry key a client reads is one the firmware sends, and
        every command field it sends is one the firmware reads.

        A renamed key fails quietly on both sides: the panel shows a dash
        forever, and a command field the firmware does not read falls back to
        its default (STOP, speed 0, or 750 ms).
        """
        sent, _, read = self.firmware_keys()
        if not sent or not read:
            return 0
        for client, where in KEY_READERS.items():
            texts = {relpath: self.code(relpath) for relpath in self.files(client)}
            texts = {relpath: text for relpath, text in texts.items() if text is not None}
            if not texts:
                continue

            any_reads = False
            any_commands = False
            for relpath, text in texts.items():
                reads = {key for pattern in where["reads"] for key in pattern.findall(text)}
                any_reads = any_reads or bool(reads)
                for name in sorted(reads - sent):
                    self.problem(f'{relpath}: reads telemetry key "{name}", which {PROTOCOL_CPP} never sends')

                literal, field = where["command"]
                commands = literal.findall(text)
                any_commands = any_commands or bool(commands)
                for body in commands:
                    for name in sorted(set(field.findall(body)) - read):
                        self.problem(f'{relpath}: sends command field "{name}", which {PROTOCOL_CPP} never reads')

            table = self.bearing_table(client)
            if table:
                relpath, body = table
                for name in sorted(set(where["bearings"][1].findall(body)) - sent):
                    self.problem(f'{relpath}: BEARINGS shows telemetry key "{name}", which {PROTOCOL_CPP} never sends')
            if not any_reads:
                self.problem(f"{client}: no telemetry reads found (data.key or data[\"key\"]); "
                             f"if the client now spells them differently, update tools/check_protocol.py")
            if not any_commands:
                self.problem(f"{client}: no command object found to check; if the client now builds commands "
                             f"differently, update tools/check_protocol.py")
        return len(sent)

    def bearings(self) -> None:
        """The panel draws each scan wedge at the angle its distance is
        measured at: the key's Explorer bearing (src/Protocol.cpp), that
        bearing's angle (Explorer::angleOf), and ExploreParams' sweep angles.
        Retuning a sweep angle otherwise leaves the panel drawing wedges where
        the rover no longer looks."""
        _, scan, _ = self.firmware_keys()
        params_text = self.text(EXPLORER_H)
        explorer = self.text(EXPLORER_CPP)
        table = self.bearing_table(PANEL_SCRIPTS)
        if not scan or params_text is None or explorer is None or table is None:
            return
        panel, body_of_table = table

        params = {name: int(value) for name, value in re.findall(r"\bint\s+(sweep\w*Deg)\s*=\s*(-?\d+)\s*;", params_text)}
        body = re.search(r"\bExplorer::angleOf\s*\([^)]*\)\s*const\s*\{(.*?)\n\}", explorer, re.S)
        cases = re.findall(r"\bcase\s+(\w+)\s*:\s*return\s+(-?)\s*(?:params\.(\w+)|(\d+))\s*;", body.group(1)) if body else []
        angles: dict[str, int] = {}
        for bearing, minus, param, literal in cases:
            if param and param not in params:
                self.problem(f"{EXPLORER_CPP}: angleOf() returns params.{param}, which is not an int in {EXPLORER_H}")
                continue
            angle = params[param] if param else int(literal)
            angles[bearing] = -angle if minus else angle
        if not angles:
            self.problem(f"{EXPLORER_CPP}: cannot read Explorer::angleOf() (case BEARING: return [-]params.x;); "
                         f"if it changed shape, update tools/check_protocol.py")
            return

        drawn = dict(re.findall(r"\bkey:\s*[\"'](\w+)[\"'][^}]*?\bbearing:\s*(-?\d+)", body_of_table))
        if not drawn:
            self.problem(f"{panel}: cannot read BEARINGS ({{ key: \"...\", ..., bearing: N }}); "
                         f"if it changed shape, update tools/check_protocol.py")
            return
        for name, bearing in sorted(scan.items()):
            if bearing not in angles:
                self.problem(
                    f"{EXPLORER_CPP}: cannot read the angle of {bearing}, which {PROTOCOL_CPP} sends as {name}, in "
                    f"Explorer::angleOf() (expected `case {bearing}: return [-]params.x;`); if it changed shape, "
                    f"update tools/check_protocol.py"
                )
            elif name not in drawn:
                self.problem(f"{panel}: BEARINGS has no wedge for {name}, which telemetry sends")
            elif int(drawn[name]) != angles[bearing]:
                self.problem(
                    f"{panel}: BEARINGS draws {name} at {drawn[name]} degrees, but the rover measures it at "
                    f"{angles[bearing]} ({bearing} in Explorer::angleOf, ExploreParams in {EXPLORER_H})"
                )

    def schemes(self) -> int:
        """The panel names each control scheme as protocol::schemeName() does.

        Reads the two enumerators of kinematics::ControlScheme, then the name
        schemeName() returns for each: `return scheme == X ? "NAME" : "OTHER";`.
        """
        kinematics = self.text(KINEMATICS_H)
        protocol = self.text(PROTOCOL_CPP)
        panel = self.text(SCHEME_CLIENT)
        if kinematics is None or protocol is None or panel is None:
            return 0

        enum = re.search(r"\benum\s+ControlScheme\s*\{(.*?)\}", kinematics, re.S)
        schemes = [item.strip() for item in enum.group(1).split(",") if item.strip()] if enum else []
        if not schemes or not all(re.fullmatch(r"[A-Za-z_]\w*", item) for item in schemes):
            self.problem(f"{KINEMATICS_H}: cannot read `enum ControlScheme {{ A, B }}`; "
                         f"if it changed shape, update tools/check_protocol.py")
            return 0

        body = re.search(r"\bschemeName\s*\([^)]*\)\s*\{(.*?)\n\}", protocol, re.S)
        ternary = re.search(r'\breturn\s+\w+\s*==\s*(?:\w+::)*(\w+)\s*\?\s*"([^"]*)"\s*:\s*"([^"]*)"\s*;',
                            body.group(1)) if body else None
        names: dict[str, str] = {}
        if ternary and len(schemes) == 2:
            which, yes, no = ternary.groups()
            names = {scheme: yes if scheme == which else no for scheme in schemes}
        if set(names) != set(schemes):
            self.problem(f"{PROTOCOL_CPP}: cannot read the name schemeName() gives each of {', '.join(schemes)}; "
                         f"if it changed shape, update tools/check_protocol.py")
            return 0

        for scheme, name in names.items():
            match = re.search(STRING_CONSTANT.replace("NAME", re.escape(scheme)), panel, re.M)
            if not match:
                self.problem(f'{SCHEME_CLIENT}: no {scheme} found (const {scheme} = "{name}";); '
                             f"if it was renamed or moved, update tools/check_protocol.py")
            elif match.group(1) != name:
                self.problem(f'{SCHEME_CLIENT}: {scheme} = "{match.group(1)}", but schemeName() in {PROTOCOL_CPP} '
                             f'names it "{name}" -- the rover ignores a scheme name it does not know')
        return len(names)

    def scheme_wire(self) -> None:
        """The panel changes the scheme as readMessage() expects, and reads it
        from telemetry under the key writeTelemetry() sends it under.

        readMessage() takes a scheme from one string field, and only from a
        message with no move. Anything else is a drive command, defaults and
        all: a scheme message under the wrong field name, or with a move
        beside it, arrives as a STOP that takes control of an exploring rover
        -- the one thing a scheme change must never do. A scheme the panel
        reads under the wrong key leaves its toggle disabled for good.
        """
        protocol = self.text(PROTOCOL_CPP)
        if protocol is None:
            return
        reader = re.search(r"\breadMessage\s*\([^)]*\)\s*\{(.*?)\n\}", protocol, re.S)
        body = reader.group(1) if reader else ""
        fields = set(re.findall(r'\bjson\[\s*"(\w+)"\s*\]\s*\.\s*is\s*<\s*const\s+char\s*\*\s*>\s*\(\s*\)', body))
        absent = set(re.findall(r'\bjson\[\s*"(\w+)"\s*\]\s*\.\s*isNull\s*\(\s*\)', body))
        writer = re.search(r"\bwriteTelemetry\s*\([^)]*\)\s*\{(.*?)\n\}", protocol, re.S)
        keys = set(re.findall(r'\bdoc\[\s*"(\w+)"\s*\]\s*=\s*schemeName\s*\(', writer.group(1) if writer else ""))
        if len(fields) != 1 or not absent:
            self.problem(f'{PROTOCOL_CPP}: cannot read which field readMessage() takes a scheme from '
                         f'(json["field"].is<const char*>() and json["move"].isNull()); '
                         f"if it changed shape, update tools/check_protocol.py")
            return
        if len(keys) != 1:
            self.problem(f'{PROTOCOL_CPP}: cannot read the telemetry key writeTelemetry() sends the scheme under '
                         f'(doc["key"] = schemeName(...)); if it changed shape, update tools/check_protocol.py')
            return
        (field,), (key,) = fields, keys

        where = KEY_READERS[PANEL_SCRIPTS]
        literal, field_name = where["command"]
        messages = 0
        reads: set[str] = set()
        for relpath in self.files(PANEL_SCRIPTS):
            code = self.code(relpath)
            if code is None:
                continue
            reads |= {name for pattern in where["reads"] for name in pattern.findall(code)}
            for body in literal.findall(code):
                sent = set(field_name.findall(body))
                if sent & absent:
                    if field in sent:
                        self.problem(
                            f'{relpath}: sends "{field}" with {", ".join(sorted(sent & absent))} in one message; '
                            f"readMessage() in {PROTOCOL_CPP} reads that as a drive command, which takes control "
                            f"and stops an exploring rover"
                        )
                    continue  # a drive command; keys() checks its fields
                messages += 1
                if field not in sent:
                    self.problem(
                        f'{relpath}: sends {{{", ".join(sorted(sent))}}} with no move, but readMessage() in '
                        f'{PROTOCOL_CPP} takes a scheme only from "{field}"; the rover reads this as a drive '
                        f"command with no move -- a STOP that takes control of an exploring rover"
                    )
                elif sent != {field}:
                    self.problem(
                        f'{relpath}: sends {", ".join(sorted(sent - {field}))} in its scheme message, which '
                        f'readMessage() in {PROTOCOL_CPP} ignores there: send "{field}" alone'
                    )
        if not messages:
            self.problem(f'{PANEL_SCRIPTS}: no scheme message found (send({{ {field}: ... }}) with no move); '
                         f"if the panel now sends it differently, update tools/check_protocol.py")
        if key not in reads:
            self.problem(f'{PANEL_SCRIPTS}: never reads telemetry key "{key}", which writeTelemetry() in '
                         f"{PROTOCOL_CPP} sends the scheme under; the panel's scheme toggle would stay disabled")


def show(value: float) -> str:
    """25.0 -> "25", 0.5 -> "0.5": numbers as the source files write them."""
    return str(int(value)) if value == int(value) else str(value)


def main() -> int:
    checker = Checker(ROOT)
    code_count = checker.move_codes()
    checker.mirrors()
    checker.timing()
    key_count = checker.keys()
    checker.bearings()
    scheme_count = checker.schemes()
    checker.scheme_wire()

    for problem in checker.problems:
        print(problem, file=sys.stderr)
    if checker.problems:
        print(f"check_protocol: FAILED, {len(checker.problems)} problem(s)", file=sys.stderr)
        return 1

    print(
        f"check_protocol: OK -- {code_count} move codes, the port, the panel's thresholds and scan angles, the "
        f"no-echo distance, the speed limit, the command timing and stick rate, {scheme_count} scheme names, the "
        f"scheme message and its telemetry key, and the names of {key_count} telemetry keys and the command fields "
        f"agree across {DRIVE_PY} and {PANEL_SCRIPTS}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
