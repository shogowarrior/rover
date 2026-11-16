"""client/ws.py's usage, as its docstring gives it, with no rover and
without the websockets package: a stand-in takes websockets' place, and
fails any attempt to connect.

    python3 -m unittest discover -s client -p 'test_*.py'
"""

import contextlib
import io
import json
import os
import shlex
import sqlite3
import sys
import tempfile
import types
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

VECTORS = os.path.join(HERE, "..", "test", "vectors")


class Connected(Exception):
    """The stand-in's websockets.connect(): ws.py tried to reach a rover.
    Not a WebSocketException, so listen() does not retry it."""


def stand_in():
    """Enough of the websockets package for drive.py and ws.py to import."""
    module = types.ModuleType("websockets")

    class WebSocketException(Exception):
        pass

    class ConnectionClosed(WebSocketException):
        pass

    def connect(uri, *args, **kwargs):
        raise Connected(uri)

    module.WebSocketException = WebSocketException
    module.ConnectionClosed = ConnectionClosed
    module.connect = connect
    return module


def import_ws():
    """client/ws.py, imported afresh against the stand-in."""
    with mock.patch.dict(sys.modules, {"websockets": stand_in()}):
        for name in ("ws", "drive"):
            sys.modules.pop(name, None)
        import ws  # noqa: PLC0415 -- under the stand-in
        return ws


def examples(doc):
    """(the command's arguments, its comment) for each `python3 client/ws.py`
    line of a usage block, the comment after it or on the line under it."""
    found = []
    for line in doc.splitlines():
        text = line.strip()
        if text.startswith("python3 client/ws.py"):
            command, _, comment = text.partition("  #")
            found.append([shlex.split(command)[2:], comment.strip()])
        elif text.startswith("#") and found and not found[-1][1]:
            found[-1][1] = text.lstrip("# ").strip()
    return [tuple(example) for example in found]


class UsageTest(unittest.TestCase):
    def setUp(self):
        self.ws = import_ws()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.db = os.path.join(directory.name, "rover.db")
        self.recording = os.path.join(directory.name, "rover-log.jsonl")
        with open(os.path.join(VECTORS, "stream.json"), encoding="utf-8") as file:
            self.lines = json.load(file)["log"]
        with open(self.recording, "w", encoding="utf-8") as file:
            for i, frame in enumerate(self.lines):
                file.write(json.dumps({"at": 1763260000000 + i, "frame": frame}) + "\n")

    def run_ws(self, args):
        """ws.py's main() with these arguments, its own files in the
        temporary directory; what it returned."""
        args = [{"rover.db": self.db, "rover-log.jsonl": self.recording}.get(arg, arg) for arg in args]
        with mock.patch.object(sys, "argv", ["ws.py", *args]), contextlib.redirect_stdout(io.StringIO()):
            return self.ws.main()

    def logged(self):
        with contextlib.closing(sqlite3.connect(self.db)) as db:
            return db.execute("SELECT COUNT(*) FROM log").fetchone()[0]

    def test_the_usage_has_an_example_with_no_rover(self):
        self.assertTrue([args for args, comment in examples(self.ws.__doc__) if "no rover" in comment])

    # An example that says it needs no rover must not try to reach one: an
    # import without --no-listen goes on to listen, retrying forever.
    def test_an_example_with_no_rover_never_connects(self):
        for args, comment in examples(self.ws.__doc__):
            if "no rover" not in comment:
                continue
            with self.subTest(args=args):
                try:
                    self.assertEqual(0, self.run_ws(args))
                except Connected:
                    self.fail(f"ws.py {' '.join(args)} connects to a rover, but its usage says: {comment}")
                self.assertEqual(len(self.lines), self.logged())

    def test_an_import_alone_goes_on_to_listen(self):
        with self.assertRaises(Connected):
            self.run_ws(["--db", "rover.db", "--import", "rover-log.jsonl"])
        self.assertEqual(len(self.lines), self.logged())


if __name__ == "__main__":
    unittest.main()
