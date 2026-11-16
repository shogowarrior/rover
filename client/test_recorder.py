"""client/recorder.py against the frames in test/vectors/, as the firmware
writes them.

    python3 -m unittest discover -s client -p 'test_*.py'
"""

import json
import math
import os
import sys
import unittest
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from recorder import LOG_LINES_REMEMBERED, Exporter, Store, kind_of  # noqa: E402

VECTORS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "vectors")


def vectors(name):
    with open(os.path.join(VECTORS, name), encoding="utf-8") as file:
        return json.load(file)


TELEMETRY = vectors("telemetry.json")["frames"]
STREAM = vectors("stream.json")


class KindTest(unittest.TestCase):
    def test_every_vector_frame_has_its_kind(self):
        for name, frame in TELEMETRY.items():
            self.assertEqual("telemetry", kind_of(frame), name)
        for frame in STREAM["log"]:
            self.assertEqual("log", kind_of(frame))
        for frame in STREAM["metrics"]:
            self.assertEqual("metrics", kind_of(frame))
        for frame in STREAM["settings"]:
            self.assertEqual("settings", kind_of(frame))

    def test_anything_else_is_not_a_frame(self):
        for other in (None, [], "text", {}, {"ota": "next", "offset": 0}, {"log": 5}, {"metrics": []},
                      {"settings": "NORMAL"}):
            self.assertIsNone(kind_of(other), other)


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        self.db = self.store.db

    def tearDown(self):
        self.store.close()

    def test_telemetry_is_kept_by_column_and_whole(self):
        for at, frame in enumerate(TELEMETRY.values()):
            self.assertTrue(self.store.add(frame, 1000.0 + at))
        rows = self.db.execute("SELECT COUNT(*) FROM telemetry").fetchone()[0]
        self.assertEqual(len(TELEMETRY), rows)
        aiming = self.db.execute(
            "SELECT mode, sonar, aim, aim_cm, pad, moving, d_front, frame FROM telemetry WHERE sonar = 'AIM' "
            "AND aim_cm IS NOT NULL").fetchone()
        self.assertEqual(("MANUAL", "AIM", -30, 42.0, "CONNECTED", 0), aiming[:6])
        self.assertEqual(200.0, aiming[6])
        self.assertEqual(TELEMETRY["aiming"], json.loads(aiming[7]))
        # A key no column holds is still there to query.
        firmware = self.db.execute(
            "SELECT json_extract(frame, '$.check') FROM telemetry WHERE check_step IS NOT NULL").fetchone()[0]
        self.assertEqual("wheel FL", firmware)
        # Who had control, where telemetry says.
        holders = dict(self.db.execute("SELECT json_extract(frame, '$.check'), control FROM telemetry "
                                       "WHERE control IS NOT NULL AND check_step IS NOT NULL"))
        self.assertEqual({"wheel FL": "USB"}, holders)
        self.assertEqual(
            sum(1 for frame in TELEMETRY.values() if "control" in frame),
            self.db.execute("SELECT COUNT(*) FROM telemetry WHERE control IS NOT NULL").fetchone()[0])

    def test_metrics_are_kept(self):
        for at, frame in enumerate(STREAM["metrics"]):
            self.assertTrue(self.store.add(frame, 2000.0 + at))
        row = self.db.execute("SELECT at, loop_hz, heap, rssi, no_echo FROM metrics ORDER BY at").fetchone()
        values = STREAM["metrics"][0]["metrics"]
        self.assertEqual((2000.0, values["loopHz"], values["heap"], values["rssi"], values["noEcho"]), row)

    # The rover sends every line it holds to each client that connects: a
    # reconnect repeats them, and each is kept once.
    def test_log_lines_are_kept_once(self):
        for frame in STREAM["log"] + STREAM["log"]:
            self.store.add(frame, 3000.0)
        self.assertEqual(len(STREAM["log"]), self.db.execute("SELECT COUNT(*) FROM log").fetchone()[0])
        warnings = [row[0] for row in self.db.execute("SELECT text FROM log WHERE warn ORDER BY rowid")]
        self.assertEqual([f["log"] for f in STREAM["log"] if f.get("warn")], warnings)

    # The log filters by whose line it is.
    def test_log_lines_keep_whose_they_are(self):
        for frame in STREAM["log"]:
            self.store.add(frame, 3000.0)
        for source in ("USB", "PAD", "WIFI", "ROVER"):
            texts = [row[0] for row in self.db.execute("SELECT text FROM log WHERE src = ? ORDER BY rowid", (source,))]
            self.assertEqual([f["log"] for f in STREAM["log"] if f["src"] == source], texts, source)

    def test_settings_are_kept(self):
        for at, frame in enumerate(STREAM["settings"]):
            self.assertTrue(self.store.add(frame, 4000.0 + at))
        rows = list(self.db.execute(
            "SELECT scheme, sonar, aim, pad, priority, checks_at_boot FROM settings ORDER BY at"))
        expected = [(v["scheme"], v["sonar"], v["aim"], v["pad"], ",".join(v["priority"]), int(v["checksAtBoot"]))
                    for v in (frame["settings"] for frame in STREAM["settings"])]
        self.assertEqual(expected, rows)

    # Another boot can reuse a number: only the same number, time and text
    # are the same line.
    def test_a_line_of_another_boot_with_the_same_number_is_kept(self):
        line = dict(STREAM["log"][0])
        self.store.add(line, 1.0)
        line["t"] += 1
        self.store.add(line, 2.0)
        self.assertEqual(2, self.db.execute("SELECT COUNT(*) FROM log").fetchone()[0])

    def test_other_frames_are_not_kept(self):
        self.assertFalse(self.store.add({"ota": "next", "offset": 0}, 1.0))
        self.assertFalse(self.store.add(None, 1.0))
        self.assertFalse(self.store.add({"log": "no number"}, 1.0))
        for table in ("telemetry", "metrics", "log", "settings"):
            self.assertEqual(0, self.db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])

    # The panel's Save: one {"at", "frame"} a line, "at" in ms.
    def test_a_panel_recording_is_imported(self):
        lines = [json.dumps({"at": 1763260000000 + i * 500, "frame": frame})
                 for i, frame in enumerate(list(TELEMETRY.values()) + STREAM["log"] + STREAM["metrics"])]
        lines += ["", "not json", json.dumps({"frame": TELEMETRY["sweeping"]}), json.dumps({"at": 5, "frame": {}})]
        kept, skipped = self.store.import_lines(lines)
        self.assertEqual(len(TELEMETRY) + len(STREAM["log"]) + len(STREAM["metrics"]), kept)
        self.assertEqual(3, skipped)
        first = self.db.execute("SELECT MIN(at) FROM telemetry").fetchone()[0]
        self.assertEqual(1763260000.0, first)


class ExporterTest(unittest.TestCase):
    def setUp(self):
        self.now = 100.0
        self.exporter = Exporter(clock=lambda: self.now)

    @staticmethod
    def parse(exposition):
        """{series with its labels: value} from Prometheus's text format."""
        out = {}
        for line in exposition.splitlines():
            if line and not line.startswith("#"):
                name, value = line.rsplit(" ", 1)
                out[name] = value
        return out

    def samples(self):
        return self.parse(self.exporter.exposition())

    def test_fresh_telemetry_and_metrics_are_exported(self):
        self.exporter.set_connected(True)
        self.exporter.add(TELEMETRY["deadShield"], 99.0)
        self.exporter.add(STREAM["metrics"][0], 99.5)
        self.exporter.add(STREAM["log"][1], 99.6)
        samples = self.samples()
        self.assertEqual("1", samples["rover_up"])
        self.assertEqual("0", samples["rover_motors_ready"])
        self.assertEqual("1", samples["rover_moving"])
        self.assertEqual("-3.5", samples["rover_temperature_celsius"])
        self.assertEqual("NaN", samples['rover_distance_cm{bearing="left"}'])
        self.assertEqual("50", samples['rover_distance_cm{bearing="front_left"}'])
        self.assertEqual("412", samples["rover_loop_hz"])
        self.assertEqual("0.038", samples["rover_loop_max_seconds"])
        self.assertEqual("1", samples['rover_log_lines_total{level="warn",source="ROVER"}'])
        self.assertEqual("0", samples['rover_log_lines_total{level="warn",source="USB"}'])
        self.assertEqual("1", samples['rover_control{source="WIFI"}'])
        self.assertEqual("0", samples['rover_control{source="PAD"}'])
        self.assertNotIn("rover_sonar_aim_degrees", samples)
        self.assertNotIn("rover_checks_at_boot", samples)

    def test_settings_are_exported_as_labels(self):
        self.exporter.set_connected(True)
        self.exporter.add(TELEMETRY["sweeping"], 99.0)
        self.exporter.add(STREAM["settings"][1], 99.1)
        samples = self.samples()
        self.assertEqual(
            "1", samples['rover_settings_info{scheme="ADVANCED",sonar="AIM",pad="OFF",priority="WIFI,USB,PAD"}'])
        self.assertEqual("1", samples["rover_checks_at_boot"])
        # No one has control: each controller reads 0.
        self.assertEqual({"0"}, {value for name, value in samples.items() if name.startswith("rover_control{")})

    def test_aim_only_while_aiming(self):
        self.exporter.set_connected(True)
        self.exporter.add(TELEMETRY["aiming"], 99.0)
        samples = self.samples()
        self.assertEqual("-30", samples["rover_sonar_aim_degrees"])
        self.assertEqual("42", samples["rover_sonar_aim_cm"])

    # A graph of a lost link should show a gap, not the last value forever.
    def test_a_quiet_or_lost_link_reports_only_that(self):
        self.exporter.set_connected(True)
        self.exporter.add(TELEMETRY["sweeping"], 99.0)
        self.now = 99.0 + 6
        samples = self.samples()
        self.assertEqual("0", samples["rover_up"])
        self.assertNotIn("rover_temperature_celsius", samples)
        self.now = 100.0
        self.exporter.add(TELEMETRY["sweeping"], 99.9)
        self.exporter.set_connected(False)
        self.assertEqual("0", self.samples()["rover_up"])

    def log_counts(self):
        return {name: value for name, value in self.samples().items() if name.startswith("rover_log_lines_total{")}

    @staticmethod
    def expected_log_counts(lines):
        counts = {}
        for frame in lines:
            name = (f'rover_log_lines_total{{level="{"warn" if frame.get("warn") else "info"}",'
                    f'source="{frame["src"]}"}}')
            counts[name] = counts.get(name, 0) + 1
        return counts

    # The rover sends every line it still holds to a client each time it
    # connects: ws.py reconnecting must not count them again.
    def test_a_line_sent_again_on_a_reconnect_is_counted_once(self):
        self.exporter.set_connected(True)
        for frame in STREAM["log"]:
            self.exporter.add(frame, 99.0)
        self.exporter.set_connected(False)
        self.exporter.set_connected(True)
        for frame in STREAM["log"]:
            self.exporter.add(frame, 99.5)
        counts = self.log_counts()
        expected = self.expected_log_counts(STREAM["log"])
        for name, value in counts.items():
            self.assertEqual(str(expected.get(name, 0)), value, name)
        self.assertEqual(len(STREAM["log"]), sum(int(value) for value in counts.values()))

    # Another boot can reuse a number: only the same number, time and text
    # are the same line, as the Store has it.
    def test_a_line_of_another_boot_with_the_same_number_is_counted(self):
        line = dict(STREAM["log"][0])
        self.exporter.add(line, 1.0)
        line["t"] += 1
        self.exporter.add(line, 2.0)
        self.assertEqual("2", self.log_counts()['rover_log_lines_total{level="info",source="ROVER"}'])

    # As the Store keeps none of them.
    def test_a_line_without_a_number_and_a_time_is_not_counted(self):
        for broken in ({"log": "no number", "t": 5, "src": "USB"}, {"log": "no time", "seq": 5, "src": "USB"},
                       {"log": "a text number", "seq": "5", "t": 5, "src": "USB"},
                       {"log": "a flag for a time", "seq": 5, "t": True, "src": "USB"}):
            self.exporter.add(broken, 99.0)
        self.assertEqual({"0"}, set(self.log_counts().values()))

    # What it remembers to count each line once is bounded: a line it has
    # long forgotten counts again, one still among the latest does not.
    def test_it_remembers_only_the_latest_lines(self):
        first = {"log": "the first", "seq": 0, "t": 0, "src": "USB"}
        self.exporter.add(first, 1.0)
        for seq in range(1, LOG_LINES_REMEMBERED):
            self.exporter.add({"log": f"line {seq}", "seq": seq, "t": seq, "src": "PAD"}, 1.0)
        self.exporter.add(first, 2.0)  # still among the latest
        info = 'rover_log_lines_total{level="info",source="USB"}'
        self.assertEqual("1", self.log_counts()[info])
        self.exporter.add({"log": "one more", "seq": LOG_LINES_REMEMBERED, "t": 0, "src": "PAD"}, 3.0)
        self.exporter.add(first, 4.0)  # forgotten
        self.assertEqual("2", self.log_counts()[info])
        self.assertEqual(LOG_LINES_REMEMBERED, len(self.exporter.counted))
        self.assertEqual(len(self.exporter.counted), len(self.exporter.counted_order))

    def test_every_sample_is_a_number_prometheus_reads(self):
        self.exporter.set_connected(True)
        for frame in list(TELEMETRY.values()) + STREAM["metrics"] + STREAM["log"] + STREAM["settings"]:
            self.exporter.add(frame, 99.0)
            for value in self.samples().values():
                self.assertTrue(value == "NaN" or not math.isnan(float(value)))

    def test_it_serves_metrics_over_http(self):
        self.exporter.set_connected(True)
        self.exporter.add(TELEMETRY["sweeping"], 99.5)
        server = self.exporter.serve("127.0.0.1", 0)
        try:
            port = server.server_address[1]
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/metrics", timeout=5) as response:
                self.assertTrue(response.headers["Content-Type"].startswith("text/plain"))
                self.assertIn("rover_up 1", response.read().decode("utf-8"))
        finally:
            server.shutdown()
            server.server_close()


# Where client/recorder.py keeps each key of the rover's frames: the Store's
# column, and the Exporter's series (None where it exports none), a series
# being its name, or its name and a label. A label naming the frame's value
# is said by the series' being 1. tools/check_protocol.py checks that
# recorder.py reads each key under the name the firmware writes it; this
# checks that what it reads lands where it is kept.
TELEMETRY_KEPT = {
    "mode": ("mode", ("rover_autonomous", None)),
    "move": ("move", None),
    "moving": ("moving", ("rover_moving", None)),
    "temperature": ("temperature", ("rover_temperature_celsius", None)),
    "motorsReady": ("motors_ready", ("rover_motors_ready", None)),
    "scheme": ("scheme", None),
    "firmware": ("firmware", None),
    "sonar": ("sonar", None),
    "aim": ("aim", ("rover_sonar_aim_degrees", None)),
    "aimCm": ("aim_cm", ("rover_sonar_aim_cm", None)),
    "check": ("check_step", None),
    "pad": ("pad", None),
    "control": ("control", ("rover_control", 'source="{value}"')),
    "phase": ("phase", None),
    "halt": ("halt", None),
    "distanceLeft": ("d_left", ("rover_distance_cm", 'bearing="left"')),
    "distanceFrontLeft": ("d_front_left", ("rover_distance_cm", 'bearing="front_left"')),
    "distanceFront": ("d_front", ("rover_distance_cm", 'bearing="front"')),
    "distanceFrontRight": ("d_front_right", ("rover_distance_cm", 'bearing="front_right"')),
    "distanceRight": ("d_right", ("rover_distance_cm", 'bearing="right"')),
}
METRICS_KEPT = {
    "upS": ("up_s", ("rover_uptime_seconds", None)),
    "loopHz": ("loop_hz", ("rover_loop_hz", None)),
    "loopMaxMs": ("loop_max_ms", ("rover_loop_max_seconds", None)),
    "heap": ("heap", ("rover_heap_free_bytes", None)),
    "heapMin": ("heap_min", ("rover_heap_min_free_bytes", None)),
    "rssi": ("rssi", ("rover_wifi_rssi_dbm", None)),
    "clients": ("clients", ("rover_clients", None)),
    "pings": ("pings", ("rover_sonar_pings_total", None)),
    "noEcho": ("no_echo", ("rover_sonar_silent_pings_total", None)),
}
SETTINGS_KEPT = {
    "scheme": ("scheme", ("rover_settings_info", 'scheme="{value}"')),
    "sonar": ("sonar", ("rover_settings_info", 'sonar="{value}"')),
    "aim": ("aim", None),
    "pad": ("pad", ("rover_settings_info", 'pad="{value}"')),
    "priority": ("priority", ("rover_settings_info", 'priority="{value}"')),
    "checksAtBoot": ("checks_at_boot", ("rover_checks_at_boot", None)),
}


class KeptTest(unittest.TestCase):
    """Every key of every frame in test/vectors/, as the firmware writes it,
    lands in a column that is not NULL, and in its series where the exporter
    reports one. A key the recorder reads under another name than the
    firmware's left its column NULL and dropped its series without a word."""

    def frames(self, kind):
        return {
            "telemetry": [(name, frame, frame) for name, frame in TELEMETRY.items()],
            "metrics": [(f"metrics[{i}]", frame, frame["metrics"]) for i, frame in enumerate(STREAM["metrics"])],
            "settings": [(f"settings[{i}]", frame, frame["settings"]) for i, frame in enumerate(STREAM["settings"])],
        }[kind]

    def test_each_place_is_for_a_key_the_vectors_hold(self):
        for kind, kept in (("telemetry", TELEMETRY_KEPT), ("metrics", METRICS_KEPT), ("settings", SETTINGS_KEPT)):
            held = set().union(*(values for _, _, values in self.frames(kind)))
            self.assertEqual(sorted(held), sorted(kept), f"{kind}: a key in test/vectors/ with no place in "
                             f"this table, or a place for a key no frame there holds")

    def test_every_key_lands_in_its_column(self):
        for kind, kept in (("telemetry", TELEMETRY_KEPT), ("metrics", METRICS_KEPT), ("settings", SETTINGS_KEPT)):
            for name, frame, values in self.frames(kind):
                store = Store(":memory:")
                try:
                    self.assertTrue(store.add(frame, 1.0), name)
                    cursor = store.db.execute(f"SELECT * FROM {kind}")
                    row = dict(zip((column[0] for column in cursor.description), cursor.fetchone()))
                finally:
                    store.close()
                for key in values:
                    self.assertIn(key, kept, f"{name}: {key} has no place in client/recorder.py")
                    column = kept[key][0]
                    self.assertIsNotNone(row[column], f"{name}: {key} left its column {column} NULL")

    def test_every_key_lands_in_its_series(self):
        for kind, kept in (("telemetry", TELEMETRY_KEPT), ("metrics", METRICS_KEPT), ("settings", SETTINGS_KEPT)):
            for name, frame, values in self.frames(kind):
                exporter = Exporter(clock=lambda: 100.0)
                exporter.set_connected(True)
                # Nothing but rover_up is reported without fresh telemetry.
                exporter.add(frame if kind == "telemetry" else TELEMETRY["sweeping"], 99.0)
                exporter.add(frame, 99.0)
                samples = ExporterTest.parse(exporter.exposition())
                for key, value in values.items():
                    self.assertIn(key, kept, f"{name}: {key} has no place in client/recorder.py")
                    series = kept[key][1]
                    if series is None:
                        continue
                    metric, label = series
                    if label is None:
                        self.assertIn(metric, samples, f"{name}: {key} is not exported as {metric}")
                        continue
                    shown = ",".join(value) if isinstance(value, list) else value
                    wanted = label.format(value=shown)
                    found = {series_name: sample for series_name, sample in samples.items()
                             if series_name.startswith(metric + "{") and wanted in series_name}
                    self.assertTrue(found, f"{name}: {key} is not exported as {metric}{{{wanted}}}")
                    if "{value}" in label:
                        self.assertEqual({"1"}, set(found.values()), f"{name}: {metric}{{{wanted}}}")


if __name__ == "__main__":
    unittest.main()
