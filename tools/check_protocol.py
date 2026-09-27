#!/usr/bin/env python3
"""Check that every client agrees with the firmware on the wire protocol.

The firmware defines the protocol once, in src/, but the Python clients and
the browser panel each carry their own copies of its numbers: the move codes,
the WebSocket port, the distances the panel colours its scan fan with, the
distance telemetry sends for a bearing with no echo, and the timing that
keeps a held command alive. Nothing at build time notices
when a copy drifts, and a drifted copy fails quietly -- a key that sends the
wrong motion, a panel that shows a clear path where the rover sees an
obstacle, a held stick that stutters. This script is that check; CI runs it.

    python3 tools/check_protocol.py

It exits non-zero, naming the file and both values, on any mismatch. It also
fails when a constant it looks for is missing, so that renaming one cannot
quietly switch its check off: if a client renames a constant, update the
tables below to match.

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
DRIVE_PY = "client/drive.py"
WS_PY = "client/ws.py"
PANEL_JS = "extras/joystick/control.js"

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
MOVE_CODE_CLIENTS = (DRIVE_PY, PANEL_JS)

# Client constants that must equal a firmware constant:
#   (client file, its name for the constant, firmware file, firmware name, why)
# A tuple of names accepts any one of them.
MIRRORS = [
    (PANEL_JS, "STOP_CM", TUNING_H, "EXPLORE_STOP_CM",
     "the panel marks a bearing blocked at the distance exploration stops at"),
    (PANEL_JS, "GO_CM", TUNING_H, "EXPLORE_GO_CM",
     "the panel marks a bearing clear at the distance exploration starts at"),
    (PANEL_JS, "FAR_CM", KINEMATICS_H, "DISTANCE_FAR_CM",
     "telemetry sends this value for a bearing with no echo"),
    (DRIVE_PY, "DISTANCE_FAR_CM", KINEMATICS_H, "DISTANCE_FAR_CM",
     "telemetry sends this value for a bearing with no echo"),
    (PANEL_JS, "PORT", TUNING_H, "WEBSOCKET_PORT",
     "the client would connect to a port nothing listens on"),
    (DRIVE_PY, ("PORT", "DEFAULT_PORT"), TUNING_H, "WEBSOCKET_PORT",
     "the client would connect to a port nothing listens on"),
    (WS_PY, ("PORT", "DEFAULT_PORT"), TUNING_H, "WEBSOCKET_PORT",
     "the client would connect to a port nothing listens on"),
]


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
            if text is not None and relpath.endswith(".h"):
                text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
                text = re.sub(r"//[^\n]*", "", text)
            self._texts[relpath] = text
        return self._texts[relpath]

    def constant(self, relpath: str, names: str | tuple[str, ...]) -> tuple[str, float] | None:
        """(name, value) of the first of `names` defined in the file, or None."""
        names = (names,) if isinstance(names, str) else names
        text = self.text(relpath)
        if text is None:
            return None
        spelling = CONSTANT[Path(relpath).suffix]
        for name in names:
            match = re.search(spelling.replace("NAME", re.escape(name)), text, re.M)
            if match:
                return name, float(match.group(1))
        self.problem(
            f"{relpath}: no {' or '.join(names)} found. If it was renamed or moved, "
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
        return len(codes)

    def mirrors(self) -> None:
        """Ports, thresholds and sentinels copied from the firmware match it."""
        for client, client_names, firmware, firmware_name, why in MIRRORS:
            theirs = self.constant(client, client_names)
            ours = self.constant(firmware, firmware_name)
            if theirs and ours and theirs[1] != ours[1]:
                self.problem(
                    f"{client}: {theirs[0]} = {show(theirs[1])}, but {firmware} has "
                    f"{firmware_name} = {show(ours[1])} -- {why}"
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
        for client in (PANEL_JS, DRIVE_PY):
            duration = self.constant(client, "MOVE_DURATION_MS")
            if cap and duration and duration[1] > cap[1]:
                self.problem(
                    f"{client}: MOVE_DURATION_MS = {show(duration[1])} exceeds COMMAND_DURATION_MAX_MS = "
                    f"{show(cap[1])} in {TUNING_H}; the firmware cuts every command to {show(cap[1])} ms"
                )

        repeat = self.constant(PANEL_JS, "REPEAT_MS")
        duration = self.constant(PANEL_JS, "MOVE_DURATION_MS")
        if repeat and duration and not repeat[1] < duration[1]:
            self.problem(
                f"{PANEL_JS}: REPEAT_MS = {show(repeat[1])} is not below MOVE_DURATION_MS = "
                f"{show(duration[1])}; a held stick's command would expire before it is re-sent"
            )


def show(value: float) -> str:
    """25.0 -> "25", 0.5 -> "0.5": numbers as the source files write them."""
    return str(int(value)) if value == int(value) else str(value)


def main() -> int:
    checker = Checker(ROOT)
    code_count = checker.move_codes()
    checker.mirrors()
    checker.timing()

    for problem in checker.problems:
        print(problem, file=sys.stderr)
    if checker.problems:
        print(f"check_protocol: FAILED, {len(checker.problems)} problem(s)", file=sys.stderr)
        return 1

    print(
        f"check_protocol: OK -- {code_count} move codes, the port, the panel's thresholds, the no-echo distance and "
        f"the command timing agree across {DRIVE_PY}, {WS_PY} and {PANEL_JS}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
