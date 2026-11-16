"""Keep what the rover streams: its telemetry, its log and its metrics.

The rover keeps no history: it has no filesystem, and a push from its loop
to a database would block the loop (AGENTS.md, Invariants). It streams over
the WebSocket link instead, and this keeps the stream on the computer, in
two ways that client/ws.py offers:

- Store: a SQLite database, one table per kind of frame, each row stamped
  with when it arrived and indexed by it, so "the warnings in the last hour"
  or "the free heap over a day" is one query, not a read of every line
  recorded. The whole frame is kept too, as JSON, for keys a column does not
  hold (SQLite's json_extract() reads them). Log lines are kept once: a
  client is sent every line the rover still holds each time it connects.
- Exporter: the latest values in Prometheus's text format at /metrics, for
  Prometheus to scrape like any exporter and keep in its own time-series
  store, and Grafana to graph.

The standard library only, so it runs wherever Python does, and imports
without websockets: client/test_recorder.py tests it on its own.

The frames are src/Protocol.h's: telemetry has "mode"; a log line has
"log", "seq", "t", "src" (whose line it is: USB, PAD, WIFI or ROVER) and
"warn" when it is a warning; metrics have "metrics"; the settings have
"settings", sent as a client connects and each time they change.
The panel's Save writes the same frames as JSON lines, each
{"at": <ms since 1970 when it arrived>, "frame": {...}}, which
Store.import_lines() reads back.
"""

import json
import math
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The telemetry keys for the sonar's five bearings, left to right, and the
# label each has in the exporter.
BEARINGS = (
    ("left", "distanceLeft"),
    ("front_left", "distanceFrontLeft"),
    ("front", "distanceFront"),
    ("front_right", "distanceFrontRight"),
    ("right", "distanceRight"),
)

# A bearing that heard no echo (kinematics::DISTANCE_FAR_CM).
DISTANCE_FAR_CM = 999

# Telemetry older than this reads as a link that has gone quiet: the
# exporter stops reporting the rover's values, so a graph shows a gap rather
# than a flat line. The rover sends a frame every 0.5 s.
STALE_S = 5.0


# Who may drive the rover, and who else writes its log (src/Source.h).
SOURCES = ("USB", "PAD", "WIFI", "ROVER")


def kind_of(frame):
    """"telemetry", "log", "metrics" or "settings" for one of the rover's
    frames, or None for anything else (a firmware update's reply, or not a
    frame at all)."""
    if not isinstance(frame, dict):
        return None
    if isinstance(frame.get("log"), str):
        return "log"
    if isinstance(frame.get("metrics"), dict):
        return "metrics"
    if isinstance(frame.get("settings"), dict):
        return "settings"
    if isinstance(frame.get("mode"), str):
        return "telemetry"
    return None


def _number(value):
    # bool is an int in Python; telemetry's flags are not numbers.
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _flag(value):
    return int(value) if isinstance(value, bool) else None


def _text(value):
    return value if isinstance(value, str) else None


SCHEMA = """
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS telemetry (
  at REAL NOT NULL,             -- when it arrived, seconds since 1970
  mode TEXT, move TEXT, moving INTEGER, temperature REAL,
  motors_ready INTEGER, scheme TEXT, sonar TEXT, aim INTEGER, aim_cm REAL,
  check_step TEXT, pad TEXT, phase TEXT, halt TEXT,
  d_left REAL, d_front_left REAL, d_front REAL, d_front_right REAL, d_right REAL,
  firmware TEXT,
  control TEXT,                 -- who has control: USB, PAD or WIFI; none while no one has
  frame TEXT NOT NULL           -- the whole frame, as JSON
);
CREATE INDEX IF NOT EXISTS telemetry_at ON telemetry (at);
CREATE TABLE IF NOT EXISTS metrics (
  at REAL NOT NULL,
  up_s INTEGER, loop_hz INTEGER, loop_max_ms INTEGER, heap INTEGER,
  heap_min INTEGER, rssi INTEGER, clients INTEGER, pings INTEGER,
  no_echo INTEGER,
  frame TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS metrics_at ON metrics (at);
CREATE TABLE IF NOT EXISTS log (
  at REAL NOT NULL,
  seq INTEGER NOT NULL,         -- numbered from a random start each boot
  t_ms INTEGER NOT NULL,        -- the rover's clock: ms since its boot
  warn INTEGER NOT NULL,
  src TEXT,                     -- whose line: USB, PAD, WIFI or ROVER
  text TEXT NOT NULL,
  UNIQUE (seq, t_ms, text)      -- a line sent again on a reconnect is kept once
);
CREATE INDEX IF NOT EXISTS log_at ON log (at);
CREATE INDEX IF NOT EXISTS log_warn ON log (warn, at);
CREATE INDEX IF NOT EXISTS log_src ON log (src, at);
CREATE TABLE IF NOT EXISTS settings (
  at REAL NOT NULL,
  scheme TEXT, sonar TEXT, aim INTEGER, pad TEXT,
  priority TEXT,                -- the controllers first to last, as "USB,PAD,WIFI"
  checks_at_boot INTEGER,
  frame TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS settings_at ON settings (at);
"""


class Store:
    """The rover's frames in a SQLite database at `path` (":memory:" for
    none). Each add() commits, so a recording cut short loses nothing it
    acknowledged; the database is in WAL mode, so another program can query
    it while it records."""

    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.executescript(SCHEMA)

    def add(self, frame, at):
        """Keep `frame`, which arrived at `at` (seconds since 1970). Says
        whether it was one of the rover's frames; anything else is ignored."""
        kind = kind_of(frame)
        if kind is None:
            return False
        whole = json.dumps(frame, separators=(",", ":"))
        if kind == "telemetry":
            self.db.execute(
                "INSERT INTO telemetry VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    at,
                    _text(frame.get("mode")),
                    _text(frame.get("move")),
                    _flag(frame.get("moving")),
                    _number(frame.get("temperature")),
                    _flag(frame.get("motorsReady")),
                    _text(frame.get("scheme")),
                    _text(frame.get("sonar")),
                    _number(frame.get("aim")),
                    _number(frame.get("aimCm")),
                    _text(frame.get("check")),
                    _text(frame.get("pad")),
                    _text(frame.get("phase")),
                    _text(frame.get("halt")),
                    *(_number(frame.get(key)) for _, key in BEARINGS),
                    _text(frame.get("firmware")),
                    _text(frame.get("control")),
                    whole,
                ),
            )
        elif kind == "metrics":
            values = frame["metrics"]
            self.db.execute(
                "INSERT INTO metrics VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (
                    at,
                    *(
                        _number(values.get(key))
                        for key in ("upS", "loopHz", "loopMaxMs", "heap", "heapMin", "rssi", "clients", "pings", "noEcho")
                    ),
                    whole,
                ),
            )
        elif kind == "settings":
            values = frame["settings"]
            priority = values.get("priority")
            names = priority if isinstance(priority, list) and all(isinstance(n, str) for n in priority) else None
            self.db.execute(
                "INSERT INTO settings VALUES (?,?,?,?,?,?,?,?)",
                (
                    at,
                    _text(values.get("scheme")),
                    _text(values.get("sonar")),
                    _number(values.get("aim")),
                    _text(values.get("pad")),
                    ",".join(names) if names is not None else None,
                    _flag(values.get("checksAtBoot")),
                    whole,
                ),
            )
        else:
            seq, t_ms = _number(frame.get("seq")), _number(frame.get("t"))
            if seq is None or t_ms is None:
                return False
            self.db.execute(
                "INSERT OR IGNORE INTO log VALUES (?,?,?,?,?,?)",
                (at, seq, t_ms, 1 if frame.get("warn") is True else 0, _text(frame.get("src")), frame["log"]),
            )
        self.db.commit()
        return True

    def import_lines(self, lines):
        """Keep each frame of a recording the panel saved: JSON lines of
        {"at": <ms since 1970>, "frame": {...}}. Returns how many were kept,
        and how many lines were not frames of the rover's (blank lines
        aside)."""
        kept = skipped = 0
        for line in lines:
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                skipped += 1
                continue
            at = _number(entry.get("at")) if isinstance(entry, dict) else None
            if at is not None and self.add(entry.get("frame"), at / 1000.0):
                kept += 1
            else:
                skipped += 1
        return kept, skipped

    def close(self):
        self.db.close()


class Exporter:
    """The latest of the rover's values for Prometheus, at /metrics.

    Gauges for what telemetry and the metrics last said, counters for the
    sonar's pings (which restart from 0 when the rover does, as Prometheus
    expects of a counter) and for the log lines seen since this started, by
    level and by whose line it is. rover_up says whether the link is up and
    telemetry fresh; while it is 0 nothing else about the rover is
    reported."""

    def __init__(self, clock=time.time):
        self.clock = clock
        self.lock = threading.Lock()
        self.connected = False
        self.telemetry = None
        self.telemetry_at = 0.0
        self.metrics = None
        self.settings = None
        self.lines = {}  # (level, source): lines seen

    def set_connected(self, connected):
        with self.lock:
            self.connected = connected

    def add(self, frame, at):
        kind = kind_of(frame)
        with self.lock:
            if kind == "telemetry":
                self.telemetry, self.telemetry_at = frame, at
            elif kind == "metrics":
                self.metrics = frame["metrics"]
            elif kind == "settings":
                self.settings = frame["settings"]
            elif kind == "log":
                source = frame.get("src")
                key = ("warn" if frame.get("warn") is True else "info", source if source in SOURCES else "ROVER")
                self.lines[key] = self.lines.get(key, 0) + 1

    def exposition(self):
        """The text Prometheus scrapes."""
        with self.lock:
            fresh = self.connected and self.telemetry is not None and self.clock() - self.telemetry_at < STALE_S
            telemetry, metrics, settings, lines = self.telemetry, self.metrics, self.settings, dict(self.lines)
        out = []

        def metric(name, kind, help_text, samples):
            samples = [(labels, value) for labels, value in samples if value is not None]
            if not samples:
                return
            out.append(f"# HELP {name} {help_text}")
            out.append(f"# TYPE {name} {kind}")
            for labels, value in samples:
                out.append(f"{name}{labels} {_sample(value)}")

        metric("rover_up", "gauge", "1 while the link to the rover is up and its telemetry fresh.", [("", int(fresh))])
        metric("rover_log_lines_total", "counter", "Lines of the rover's log seen since this exporter started.",
               [(f'{{level="{level}",source="{source}"}}', lines.get((level, source), 0))
                for level in ("info", "warn") for source in SOURCES])
        if not fresh:
            return "\n".join(out) + "\n"

        t = telemetry
        metric("rover_autonomous", "gauge", "1 while the rover explores on its own.",
               [("", int(t.get("mode") == "AUTONOMOUS"))])
        metric("rover_moving", "gauge", "1 while the wheels are driven.", [("", _flag(t.get("moving")))])
        metric("rover_motors_ready", "gauge", "0 when the motor shield did not answer at boot.",
               [("", _flag(t.get("motorsReady")))])
        metric("rover_temperature_celsius", "gauge", "The ESP32's own temperature.",
               [("", _number(t.get("temperature")))])
        metric("rover_distance_cm", "gauge", "The sonar at each bearing; NaN where no echo came back.",
               [(f'{{bearing="{label}"}}', _distance(t.get(key))) for label, key in BEARINGS])
        holder = t.get("control")
        metric("rover_control", "gauge", "1 for the controller that has control, 0 for the others.",
               [(f'{{source="{source}"}}', int(holder == source)) for source in SOURCES[:3]])
        if t.get("sonar") == "AIM":
            metric("rover_sonar_aim_degrees", "gauge", "Where manual mode aims the sonar, positive left.",
                   [("", _number(t.get("aim")))])
            metric("rover_sonar_aim_cm", "gauge", "The sonar's reading where it aims.",
                   [("", _distance(t.get("aimCm")))])
        if metrics:
            m = metrics
            metric("rover_uptime_seconds", "gauge", "Time since the rover booted.", [("", _number(m.get("upS")))])
            metric("rover_loop_hz", "gauge", "Passes of the rover's loop a second.", [("", _number(m.get("loopHz")))])
            metric("rover_loop_max_seconds", "gauge", "The longest pass of the loop in the last interval.",
                   [("", _scaled(m.get("loopMaxMs"), 0.001))])
            metric("rover_heap_free_bytes", "gauge", "Free heap.", [("", _number(m.get("heap")))])
            metric("rover_heap_min_free_bytes", "gauge", "The least free heap since boot.",
                   [("", _number(m.get("heapMin")))])
            metric("rover_wifi_rssi_dbm", "gauge", "The WiFi signal the rover hears.", [("", _number(m.get("rssi")))])
            metric("rover_clients", "gauge", "WebSocket clients connected to the rover.",
                   [("", _number(m.get("clients")))])
            metric("rover_sonar_pings_total", "counter", "Sonar pings since the rover booted.",
                   [("", _number(m.get("pings")))])
            metric("rover_sonar_silent_pings_total", "counter", "Sonar pings since boot that heard no echo.",
                   [("", _number(m.get("noEcho")))])
        if settings:
            priority = settings.get("priority")
            labels = {
                "scheme": settings.get("scheme"),
                "sonar": settings.get("sonar"),
                "pad": settings.get("pad"),
                "priority": ",".join(priority) if isinstance(priority, list) else None,
            }
            text = ",".join(f'{key}="{_label(value)}"' for key, value in labels.items() if isinstance(value, str))
            metric("rover_settings_info", "gauge", "The rover's settings, as labels.", [(f"{{{text}}}", 1)])
            metric("rover_checks_at_boot", "gauge", "1 when the rover checks its shield and sonar at boot.",
                   [("", _flag(settings.get("checksAtBoot")))])
        return "\n".join(out) + "\n"

    def serve(self, host, port):
        """Serve /metrics from a thread of its own, until the program ends.
        Returns the server, whose server_address says the port it took."""
        exporter = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802 -- http.server's name
                if self.path.split("?")[0] != "/metrics":
                    self.send_error(404, "Only /metrics here")
                    return
                body = exporter.exposition().encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):  # each scrape is not news
                pass

        server = ThreadingHTTPServer((host, port), Handler)
        server.daemon_threads = True
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return server


def _distance(value):
    value = _number(value)
    if value is None:
        return None
    return math.nan if value >= DISTANCE_FAR_CM else value


def _scaled(value, factor):
    value = _number(value)
    return None if value is None else value * factor


def _label(value):
    # Prometheus's text format escapes these three in a label's value.
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _sample(value):
    if isinstance(value, float) and math.isnan(value):
        return "NaN"
    return repr(value) if isinstance(value, float) else str(value)
