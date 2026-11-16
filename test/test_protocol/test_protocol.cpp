#include <ArduinoJson.h>
#include <stdio.h>
#include <string.h>
#include <unity.h>

#include <string>

#include "../support/Vectors.h"
#include "Protocol.h"
#include "Tuning.h"

// The JSON wire format. Clients in client/ and extras/joystick/ depend on
// these key names and defaults.

void setUp(void) {}
void tearDown(void) {}

namespace {

// 32 hex digits, made up: a digest or nonce of the right shape.
const char HEX32[] = "0123456789abcdef0123456789abcdef";

// Parsed into one document that lasts until the next call: an update
// message's strings point into it.
JsonDocument parsed;

protocol::Message message(const char* json) {
  TEST_ASSERT_FALSE(deserializeJson(parsed, json));
  return protocol::readMessage(parsed.as<JsonVariantConst>());
}

// A malformed message degrades to STOP, speed 0 -- releasing the motors --
// not to whatever as<int>() would have produced for a missing field.
void assertDefaultsToStop(const char* json) {
  const protocol::Message m = message(json);
  TEST_ASSERT_EQUAL_INT_MESSAGE(protocol::Message::DRIVE, m.kind, json);
  TEST_ASSERT_EQUAL_INT_MESSAGE(STOP, m.command.move, json);
  TEST_ASSERT_EQUAL_INT_MESSAGE(0, m.command.speed, json);
  TEST_ASSERT_EQUAL_INT_MESSAGE(tuning::DEFAULT_MOVE_DURATION_MS, m.command.durationMs, json);
}

// The frames' distance keys, in Explorer's bearing order, left to right.
const char* const DISTANCE_KEYS[Explorer::BEARING_COUNT] = {
    "distanceLeft", "distanceFrontLeft", "distanceFront", "distanceFrontRight", "distanceRight"};

// The names the vector frames use, decoded by the test's own tables and never
// through the firmware's (moveName(), protocol::schemeName()): a round trip
// through the code under test would pass a name it had swapped. Any other
// name fails the test.
Rover::Mode modeNamed(const char* name) {
  if (strcmp(name, "AUTONOMOUS") == 0) return Rover::MODE_AUTONOMOUS;
  TEST_ASSERT_EQUAL_STRING("MANUAL", name);
  return Rover::MODE_MANUAL;
}

MoveCode moveNamed(const char* name) {
  if (strcmp(name, "MOVE_FORWARD") == 0) return MOVE_FORWARD;
  TEST_ASSERT_EQUAL_STRING("STOP", name);
  return STOP;
}

kinematics::ControlScheme schemeNamed(const char* name) {
  if (strcmp(name, "ADVANCED") == 0) return kinematics::SCHEME_ADVANCED;
  TEST_ASSERT_EQUAL_STRING("NORMAL", name);
  return kinematics::SCHEME_NORMAL;
}

Explorer::SonarMode sonarNamed(const char* name) {
  if (strcmp(name, "FRONT") == 0) return Explorer::SONAR_FRONT;
  if (strcmp(name, "AIM") == 0) return Explorer::SONAR_AIM;
  TEST_ASSERT_EQUAL_STRING("SWEEP", name);
  return Explorer::SONAR_SWEEP;
}

// No "control" (or "src" naming the rover) is no controller's.
Source sourceNamed(const char* name) {
  if (name == nullptr) return SOURCE_ROVER;
  if (strcmp(name, "USB") == 0) return SOURCE_USB;
  if (strcmp(name, "PAD") == 0) return SOURCE_PAD;
  if (strcmp(name, "WIFI") == 0) return SOURCE_WIFI;
  TEST_ASSERT_EQUAL_STRING("ROVER", name);
  return SOURCE_ROVER;
}

// No "pad" is a build without one.
PadState padNamed(const char* name) {
  if (name == nullptr) return PAD_ABSENT;
  if (strcmp(name, "OFF") == 0) return PAD_OFF;
  if (strcmp(name, "WAITING") == 0) return PAD_WAITING;
  TEST_ASSERT_EQUAL_STRING("CONNECTED", name);
  return PAD_CONNECTED;
}

// The status a vector frame reports, which writeTelemetry() must turn back
// into that frame.
Rover::Status statusOf(JsonObjectConst frame) {
  Rover::Status status;
  status.mode = modeNamed(frame["mode"]);
  status.move = moveNamed(frame["move"]);
  status.moving = frame["moving"];
  status.phase = frame["phase"];
  status.haltReason = frame["halt"];
  status.hasScan = frame[DISTANCE_KEYS[0]].is<float>();
  for (int i = 0; i < Explorer::BEARING_COUNT; i++) status.scanCm[i] = frame[DISTANCE_KEYS[i]] | 0.0f;
  status.motorsReady = frame["motorsReady"];
  status.sonar = sonarNamed(frame["sonar"]);
  status.aimDeg = frame["aim"] | 0;
  status.hasAimCm = frame["aimCm"].is<float>();
  status.aimCm = frame["aimCm"] | 0.0f;
  status.check = frame["check"];
  status.pings = 0;
  status.silentPings = 0;
  return status;
}

// Everything a vector frame reports.
protocol::Report reportOf(JsonObjectConst frame) {
  protocol::Report report;
  report.status = statusOf(frame);
  report.scheme = schemeNamed(frame["scheme"]);
  report.pad = padNamed(frame["pad"]);
  report.control = sourceNamed(frame["control"]);
  report.temperatureC = frame["temperature"];
  report.firmware = frame["firmware"];
  return report;
}

// writeTelemetry()'s frame for `report`, parsed. Fails the test when nothing
// was written.
JsonDocument written(const protocol::Report& report) {
  char out[protocol::TELEMETRY_MAX_BYTES];
  const size_t length = protocol::writeTelemetry(report, out, sizeof(out));
  TEST_ASSERT_TRUE(length > 0);
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, out, length));
  return doc;
}

// `value` as JSON text, which pins its type along with its value: ArduinoJson
// finds 0 equal to false, but the panel and drive.py read only a boolean.
std::string jsonText(JsonVariantConst value) {
  std::string text;
  serializeJson(value, text);
  return text;
}

// Every key of `expected`, and no other, in `actual`, each as JSON text.
void assertSameFrame(JsonObjectConst expected, JsonObjectConst actual, const char* name) {
  TEST_ASSERT_EQUAL_INT_MESSAGE(expected.size(), actual.size(), name);
  for (JsonPairConst key : expected) {
    char label[96];
    snprintf(label, sizeof(label), "%s: %s", name, key.key().c_str());
    TEST_ASSERT_EQUAL_STRING_MESSAGE(jsonText(key.value()).c_str(), jsonText(actual[key.key()]).c_str(), label);
  }
}

FirmwareUpdate::Reply replyOf(FirmwareUpdate::Reply::Kind kind) {
  FirmwareUpdate::Reply reply = {};
  reply.kind = kind;
  return reply;
}

// writeOtaReply()'s frame for `reply`, as text.
std::string replyText(const FirmwareUpdate::Reply& reply) {
  char out[protocol::OTA_REPLY_MAX_BYTES];
  const size_t length = protocol::writeOtaReply(reply, out, sizeof(out));
  return std::string(out, length);
}

void assertUpdateMessage(const protocol::Message& m, protocol::OtaRequest::Action action, const char* json) {
  TEST_ASSERT_EQUAL_INT_MESSAGE(protocol::Message::OTA, m.kind, json);
  TEST_ASSERT_EQUAL_INT_MESSAGE(action, m.ota.action, json);
}

}  // namespace

void test_command_fields_are_read(void) {
  const protocol::Message m = message("{\"move\":4,\"speed\":120,\"duration\":400}");
  TEST_ASSERT_EQUAL_INT(protocol::Message::DRIVE, m.kind);
  TEST_ASSERT_EQUAL_INT(MOVE_LEFT, m.command.move);
  TEST_ASSERT_EQUAL_INT(120, m.command.speed);
  TEST_ASSERT_EQUAL_INT(400, m.command.durationMs);
}

void test_missing_fields_default_to_stopping(void) { assertDefaultsToStop("{}"); }

void test_wrongly_typed_fields_default_to_stopping(void) {
  assertDefaultsToStop("{\"move\":\"1\",\"speed\":64.5,\"duration\":\"long\"}");
}

// RemoteControl ignores a message longer than COMMAND_MAX_BYTES unread, so
// the longest a client sends must fit: each field at the longest value the
// rover acts on, spaced as Python's json.dumps writes it (drive.py), and a
// scheme beside the move, which still drives.
void test_longest_command_fits(void) {
  char longest[protocol::COMMAND_MAX_BYTES + 1];
  const int length = snprintf(longest, sizeof(longest),
                              "{\"move\": %d, \"speed\": %d, \"duration\": %d, \"scheme\": \"ADVANCED\"}",
                              MOVE_CODE_COUNT - 1, kinematics::MOTOR_SPEED_MAX, tuning::COMMAND_DURATION_MAX_MS);
  TEST_ASSERT_TRUE(length > 0);
  TEST_ASSERT_TRUE(static_cast<size_t>(length) <= protocol::COMMAND_MAX_BYTES);
  const protocol::Message m = message(longest);
  TEST_ASSERT_EQUAL_INT(protocol::Message::DRIVE, m.kind);
  TEST_ASSERT_EQUAL_INT(tuning::COMMAND_DURATION_MAX_MS, m.command.durationMs);
}

// Every frame in test/vectors/telemetry.json, written from the status it
// describes: each key it holds, and no other. Between them the frames pin
// that the distances appear only once every bearing has been measured
// (before that there is nothing true to report), "phase" only while
// exploring and "halt" only when halted, that "firmware" is always there (a
// client sends no update without it), and that the two flags each carry
// their own value, false included, as a boolean: serialised from the wrong
// field, as a constant or as a number, "motorsReady" hides the dead shield it
// exists to report, and telemetry names a move that never reaches the wheels.
void test_telemetry_frames_match_the_vectors(void) {
  const JsonDocument vectors = loadVectors("telemetry.json");
  for (JsonPairConst named : vectors["frames"].as<JsonObjectConst>()) {
    const JsonObjectConst frame = named.value();
    TEST_ASSERT_TRUE_MESSAGE(frame["firmware"].is<const char*>(), named.key().c_str());
    TEST_ASSERT_TRUE_MESSAGE(frame["sonar"].is<const char*>(), named.key().c_str());
    const JsonDocument out = written(reportOf(frame));
    assertSameFrame(frame, out.as<JsonObjectConst>(), named.key().c_str());
  }
}

// The largest frame must fit RemoteControl's buffer, or telemetry silently
// stops in exactly those states. Every field at its longest, whether or not
// the states can occur together: the longest move name, the longest phase and
// halt reason, "false" for both flags, a negative temperature, distances
// with seven significant digits, the running image's MD5, the sonar aiming
// as far right as it goes with a reading, the longest a check's name may be
// (SelfTest::STEP_NAME_MAX, which test_rover holds the checks to), and the
// pad's longest state, and the longest controller holding control.
void test_longest_telemetry_fits(void) {
  Rover::Status status;
  status.mode = Rover::MODE_AUTONOMOUS;
  status.move = STOP;
  for (int code = 0; code < MOVE_CODE_COUNT; code++) {
    const MoveCode move = static_cast<MoveCode>(code);
    if (strlen(moveName(move)) > strlen(moveName(status.move))) status.move = move;
  }
  status.moving = false;
  status.phase = "SIDESTEP";
  status.haltReason = "sensor silent";
  status.hasScan = true;
  for (int i = 0; i < Explorer::BEARING_COUNT; i++) status.scanCm[i] = 399.9999f;
  status.motorsReady = false;
  status.sonar = Explorer::SONAR_AIM;
  status.aimDeg = -tuning::SONAR_AIM_MAX_DEG;
  status.hasAimCm = true;
  status.aimCm = 399.9999f;
  const std::string check(SelfTest::STEP_NAME_MAX, 'x');
  status.check = check.c_str();
  status.pings = 0;
  status.silentPings = 0;

  protocol::Report report;
  report.status = status;
  report.scheme = kinematics::SCHEME_ADVANCED;
  report.pad = PAD_CONNECTED;
  report.control = SOURCE_WIFI;
  report.temperatureC = -12.34568f;
  report.firmware = HEX32;
  const JsonDocument doc = written(report);
  TEST_ASSERT_EQUAL_STRING(moveName(status.move), doc["move"]);
  TEST_ASSERT_EQUAL_STRING(HEX32, doc["firmware"]);
  TEST_ASSERT_EQUAL_STRING(check.c_str(), doc["check"]);
  TEST_ASSERT_EQUAL_STRING("CONNECTED", doc["pad"]);
  TEST_ASSERT_EQUAL_STRING("WIFI", doc["control"]);
}

// The older form: a scheme alone, at the top level.
void test_scheme_message_sets_the_scheme(void) {
  protocol::Message m = message("{\"scheme\":\"ADVANCED\"}");
  TEST_ASSERT_EQUAL_INT(protocol::Message::SETTINGS, m.kind);
  TEST_ASSERT_TRUE(m.settings.hasScheme);
  TEST_ASSERT_EQUAL_INT(kinematics::SCHEME_ADVANCED, m.settings.scheme);
  TEST_ASSERT_FALSE(m.settings.hasSonar || m.settings.hasAim || m.settings.hasPad || m.settings.hasPriority ||
                    m.settings.hasChecksAtBoot);
  m = message("{\"scheme\":\"NORMAL\",\"sonar\":\"AIM\"}");  // only the scheme, in this form
  TEST_ASSERT_EQUAL_INT(protocol::Message::SETTINGS, m.kind);
  TEST_ASSERT_EQUAL_INT(kinematics::SCHEME_NORMAL, m.settings.scheme);
  TEST_ASSERT_FALSE(m.settings.hasSonar);
}

// An unknown scheme changes nothing -- and in particular does not become the
// STOP a malformed drive command would, which would take control.
void test_unknown_scheme_is_ignored(void) {
  TEST_ASSERT_EQUAL_INT(protocol::Message::IGNORE, message("{\"scheme\":\"TURBO\"}").kind);
  TEST_ASSERT_EQUAL_INT(protocol::Message::IGNORE, message("{\"scheme\":\"advanced\"}").kind);
}

// Anything else is a drive command, with the usual stop-on-garbage defaults:
// a scheme that is not a string makes no scheme message.
void test_other_messages_drive(void) { assertDefaultsToStop("{\"scheme\":1}"); }

// A message carrying "move" drives even when it also names a scheme.
// Otherwise a client that sent its scheme with every command would have its
// STOPs read as configuration: it could neither stop nor take control.
void test_a_move_with_a_scheme_still_drives(void) {
  const protocol::Message m = message("{\"move\":0,\"speed\":0,\"duration\":0,\"scheme\":\"ADVANCED\"}");
  TEST_ASSERT_EQUAL_INT(protocol::Message::DRIVE, m.kind);
  TEST_ASSERT_EQUAL_INT(STOP, m.command.move);
}

// Truncated JSON would reach every client as garbage. Better to send nothing.
void test_too_small_a_buffer_writes_nothing(void) {
  const JsonDocument vectors = loadVectors("telemetry.json");
  char out[16];
  TEST_ASSERT_EQUAL_UINT(0, protocol::writeTelemetry(reportOf(vectors["frames"]["cruising"]), out, sizeof(out)));
  const EventLog::Entry entry = {7, 100, EventLog::INFO, SOURCE_ROVER, "a line"};
  TEST_ASSERT_EQUAL_UINT(0, protocol::writeLogLine(entry, out, sizeof(out)));
  const protocol::Metrics metrics = {};
  TEST_ASSERT_EQUAL_UINT(0, protocol::writeMetrics(metrics, out, sizeof(out)));
  EventLog log;
  const Settings settings(log, kinematics::SCHEME_NORMAL);
  TEST_ASSERT_EQUAL_UINT(0, protocol::writeSettings(settings, out, sizeof(out)));
}

// --- settings --------------------------------------------------------------

void test_settings_messages_are_read(void) {
  protocol::Message m = message(
      "{\"settings\":{\"scheme\":\"ADVANCED\",\"sonar\":\"AIM\",\"aim\":-30,\"pad\":\"OFF\","
      "\"priority\":[\"WIFI\",\"PAD\",\"USB\"],\"checksAtBoot\":true}}");
  TEST_ASSERT_EQUAL_INT(protocol::Message::SETTINGS, m.kind);
  const Settings::Change& c = m.settings;
  TEST_ASSERT_TRUE(c.hasScheme && c.hasSonar && c.hasAim && c.hasPad && c.hasPriority && c.hasChecksAtBoot);
  TEST_ASSERT_EQUAL_INT(kinematics::SCHEME_ADVANCED, c.scheme);
  TEST_ASSERT_EQUAL_INT(Explorer::SONAR_AIM, c.sonar);
  TEST_ASSERT_EQUAL_INT(-30, c.aimDeg);
  TEST_ASSERT_FALSE(c.padOn);
  TEST_ASSERT_EQUAL_INT(SOURCE_WIFI, c.priority[0]);
  TEST_ASSERT_EQUAL_INT(SOURCE_PAD, c.priority[1]);
  TEST_ASSERT_EQUAL_INT(SOURCE_USB, c.priority[2]);
  TEST_ASSERT_TRUE(c.checksAtBoot);

  // Only what a message holds.
  m = message("{\"settings\":{\"sonar\":\"SWEEP\"}}");
  TEST_ASSERT_EQUAL_INT(protocol::Message::SETTINGS, m.kind);
  TEST_ASSERT_TRUE(m.settings.hasSonar);
  TEST_ASSERT_FALSE(m.settings.hasScheme || m.settings.hasAim || m.settings.hasPad || m.settings.hasPriority ||
                    m.settings.hasChecksAtBoot);
}

// A value the rover does not know leaves its field out, and the rest of the
// message still applies.
void test_unknown_setting_values_are_left_out(void) {
  const protocol::Message m = message(
      "{\"settings\":{\"scheme\":\"TURBO\",\"sonar\":\"front\",\"aim\":12.5,\"pad\":\"on\","
      "\"priority\":[\"USB\",\"PAD\"],\"checksAtBoot\":1,\"colour\":\"red\",\"pad \":\"OFF\"}}");
  TEST_ASSERT_EQUAL_INT(protocol::Message::IGNORE, m.kind);
  const protocol::Message some = message("{\"settings\":{\"sonar\":\"LEFT\",\"pad\":\"OFF\"}}");
  TEST_ASSERT_EQUAL_INT(protocol::Message::SETTINGS, some.kind);
  TEST_ASSERT_FALSE(some.settings.hasSonar);
  TEST_ASSERT_TRUE(some.settings.hasPad);
  TEST_ASSERT_FALSE(some.settings.padOn);
  // A priority naming the rover, an unknown name or a number is no priority.
  const char* const badOrders[] = {"[\"USB\",\"PAD\",\"ROVER\"]", "[\"USB\",\"PAD\",\"wifi\"]",
                                   "[0,1,2]", "\"USB\""};
  for (const char* order : badOrders) {
    char json[96];
    snprintf(json, sizeof(json), "{\"settings\":{\"priority\":%s}}", order);
    TEST_ASSERT_EQUAL_INT_MESSAGE(protocol::Message::IGNORE, message(json).kind, json);
  }
}

// Settings are never the STOP a malformed command is: it would take control
// from an exploring rover. "settings" that is not an object is ignored (but
// null, which reads as absent); a message with "move" drives, whatever else
// it holds.
void test_settings_never_stop_the_rover(void) {
  const char* const ignored[] = {"{\"settings\":1}", "{\"settings\":\"FRONT\"}", "{\"settings\":[]}",
                                 "{\"settings\":{}}"};
  for (const char* json : ignored) {
    TEST_ASSERT_EQUAL_INT_MESSAGE(protocol::Message::IGNORE, message(json).kind, json);
  }
  const protocol::Message m = message("{\"move\":0,\"speed\":0,\"duration\":0,\"settings\":{\"pad\":\"OFF\"}}");
  TEST_ASSERT_EQUAL_INT(protocol::Message::DRIVE, m.kind);
  TEST_ASSERT_EQUAL_INT(STOP, m.command.move);
}

// Each settings frame in test/vectors/stream.json reads back, as a client's
// message, to settings that write that same frame: the format the rover
// sends is the one it takes, and the one it keeps in flash.
void test_settings_frames_match_the_vectors(void) {
  const JsonDocument vectors = loadVectors("stream.json");
  bool first = true;
  for (JsonObjectConst frame : vectors["settings"].as<JsonArrayConst>()) {
    EventLog log;
    Settings settings(log, kinematics::SCHEME_NORMAL);
    char out[protocol::SETTINGS_MAX_BYTES];
    if (first) {  // the defaults
      const size_t length = protocol::writeSettings(settings, out, sizeof(out));
      JsonDocument doc;
      TEST_ASSERT_FALSE(deserializeJson(doc, out, length));
      assertSameFrame(frame["settings"], doc["settings"].as<JsonObjectConst>(), "defaults");
      first = false;
    }
    std::string text;
    serializeJson(frame, text);
    const protocol::Message m = message(text.c_str());
    TEST_ASSERT_EQUAL_INT(protocol::Message::SETTINGS, m.kind);
    settings.apply(m.settings, SOURCE_WIFI, 0);
    const size_t length = protocol::writeSettings(settings, out, sizeof(out));
    TEST_ASSERT_TRUE(length > 0);
    JsonDocument doc;
    TEST_ASSERT_FALSE(deserializeJson(doc, out, length));
    TEST_ASSERT_EQUAL_INT(1, doc.size());
    assertSameFrame(frame["settings"], doc["settings"].as<JsonObjectConst>(), text.c_str());
  }
}

// The settings frame at its longest fits its buffer; the longest settings
// message a client sends, spaced as json.dumps writes it, fits the
// command's.
void test_settings_fit(void) {
  EventLog log;
  Settings settings(log, kinematics::SCHEME_ADVANCED);
  settings.setSonar(Explorer::SONAR_SWEEP, SOURCE_WIFI, 0);
  settings.setAim(-tuning::SONAR_AIM_MAX_DEG, SOURCE_WIFI, 0);
  settings.setPad(false, SOURCE_WIFI, 0);
  settings.setChecksAtBoot(false, SOURCE_WIFI, 0);
  char out[protocol::SETTINGS_MAX_BYTES];
  TEST_ASSERT_TRUE(protocol::writeSettings(settings, out, sizeof(out)) > 0);

  char longest[protocol::COMMAND_MAX_BYTES + 1];
  const int length = snprintf(longest, sizeof(longest),
                              "{\"settings\": {\"scheme\": \"ADVANCED\", \"sonar\": \"SWEEP\", \"aim\": %d, "
                              "\"pad\": \"OFF\", \"priority\": [\"WIFI\", \"USB\", \"PAD\"], \"checksAtBoot\": false}}",
                              -2147483647 - 1);
  TEST_ASSERT_TRUE(length > 0 && static_cast<size_t>(length) <= protocol::COMMAND_MAX_BYTES);
  TEST_ASSERT_EQUAL_INT(protocol::Message::SETTINGS, message(longest).kind);
}

// The names the wire uses, which the panel and drive.py copy.
void test_setting_names(void) {
  TEST_ASSERT_EQUAL_STRING("SWEEP", protocol::sonarName(Explorer::SONAR_SWEEP));
  TEST_ASSERT_EQUAL_STRING("FRONT", protocol::sonarName(Explorer::SONAR_FRONT));
  TEST_ASSERT_EQUAL_STRING("AIM", protocol::sonarName(Explorer::SONAR_AIM));
  TEST_ASSERT_NULL(protocol::padName(PAD_ABSENT));
  TEST_ASSERT_EQUAL_STRING("OFF", protocol::padName(PAD_OFF));
  TEST_ASSERT_EQUAL_STRING("WAITING", protocol::padName(PAD_WAITING));
  TEST_ASSERT_EQUAL_STRING("CONNECTED", protocol::padName(PAD_CONNECTED));
  TEST_ASSERT_EQUAL_STRING("USB", sourceName(SOURCE_USB));
  TEST_ASSERT_EQUAL_STRING("PAD", sourceName(SOURCE_PAD));
  TEST_ASSERT_EQUAL_STRING("WIFI", sourceName(SOURCE_WIFI));
  TEST_ASSERT_EQUAL_STRING("ROVER", sourceName(SOURCE_ROVER));
}

// --- the log and the metrics --------------------------------------------------

// Each frame in test/vectors/stream.json, written from the values it holds.
void test_log_lines_match_the_vectors(void) {
  const JsonDocument vectors = loadVectors("stream.json");
  for (JsonObjectConst frame : vectors["log"].as<JsonArrayConst>()) {
    EventLog::Entry entry;
    entry.seq = frame["seq"];
    entry.atMs = frame["t"];
    entry.level = frame["warn"] | false ? EventLog::WARN : EventLog::INFO;
    entry.source = sourceNamed(frame["src"]);
    snprintf(entry.text, sizeof(entry.text), "%s", frame["log"].as<const char*>());
    char out[protocol::LOG_LINE_MAX_BYTES];
    const size_t length = protocol::writeLogLine(entry, out, sizeof(out));
    TEST_ASSERT_TRUE(length > 0);
    JsonDocument doc;
    TEST_ASSERT_FALSE(deserializeJson(doc, out, length));
    assertSameFrame(frame, doc.as<JsonObjectConst>(), entry.text);
  }
}

void test_metrics_match_the_vectors(void) {
  const JsonDocument vectors = loadVectors("stream.json");
  for (JsonObjectConst frame : vectors["metrics"].as<JsonArrayConst>()) {
    const JsonObjectConst values = frame["metrics"];
    protocol::Metrics metrics;
    metrics.uptimeS = values["upS"];
    metrics.loopHz = values["loopHz"];
    metrics.loopMaxMs = values["loopMaxMs"];
    metrics.heapFree = values["heap"];
    metrics.heapMinFree = values["heapMin"];
    metrics.rssi = values["rssi"];
    metrics.clients = values["clients"];
    metrics.pings = values["pings"];
    metrics.silentPings = values["noEcho"];
    char out[protocol::METRICS_MAX_BYTES];
    const size_t length = protocol::writeMetrics(metrics, out, sizeof(out));
    TEST_ASSERT_TRUE(length > 0);
    JsonDocument doc;
    TEST_ASSERT_FALSE(deserializeJson(doc, out, length));
    TEST_ASSERT_EQUAL_INT(1, doc.size());
    assertSameFrame(values, doc["metrics"].as<JsonObjectConst>(), "metrics");
  }
}

// The longest line, every character one JSON escapes, at the largest
// numbers and a warning, fits RemoteControl's buffer: a line that did not
// would never reach a client.
void test_longest_log_line_fits(void) {
  EventLog::Entry entry;
  entry.seq = 4294967295u;
  entry.atMs = 4294967295u;
  entry.level = EventLog::WARN;
  entry.source = SOURCE_ROVER;
  memset(entry.text, '"', sizeof(entry.text) - 1);
  entry.text[sizeof(entry.text) - 1] = '\0';
  char out[protocol::LOG_LINE_MAX_BYTES];
  TEST_ASSERT_TRUE(protocol::writeLogLine(entry, out, sizeof(out)) > 0);
}

void test_longest_metrics_fit(void) {
  protocol::Metrics metrics;
  metrics.uptimeS = metrics.loopHz = metrics.loopMaxMs = metrics.heapFree = metrics.heapMinFree = 4294967295u;
  metrics.pings = metrics.silentPings = 4294967295u;
  metrics.rssi = -2147483647 - 1;
  metrics.clients = -2147483647 - 1;
  char out[protocol::METRICS_MAX_BYTES];
  TEST_ASSERT_TRUE(protocol::writeMetrics(metrics, out, sizeof(out)) > 0);
}

// An update's messages, each field as the client wrote it. None is a drive
// command: each would otherwise be a STOP that takes control of the rover,
// and stops it exploring, from a client that only meant to update it.
void test_update_messages_are_read(void) {
  const char begin[] = "{\"ota\":\"begin\",\"size\":1900000,\"md5\":\"0123456789abcdef0123456789abcdef\"}";
  protocol::Message m = message(begin);
  assertUpdateMessage(m, protocol::OtaRequest::BEGIN, begin);
  TEST_ASSERT_EQUAL_UINT32(1900000, m.ota.size);
  TEST_ASSERT_EQUAL_STRING(HEX32, m.ota.md5);

  const char auth[] =
      "{\"ota\":\"auth\",\"cnonce\":\"00000000000000000000000000000001\","
      "\"response\":\"fedcba9876543210fedcba9876543210\"}";
  m = message(auth);
  assertUpdateMessage(m, protocol::OtaRequest::AUTH, auth);
  TEST_ASSERT_EQUAL_STRING("00000000000000000000000000000001", m.ota.cnonce);
  TEST_ASSERT_EQUAL_STRING("fedcba9876543210fedcba9876543210", m.ota.response);

  assertUpdateMessage(message("{\"ota\":\"cancel\"}"), protocol::OtaRequest::CANCEL, "cancel");
}

// A field absent or of the wrong type reads as one FirmwareUpdate refuses,
// size 0 or "", and never as a null pointer it would read through. A size
// that is negative, fractional or past 32 bits is no size.
void test_update_fields_default_to_refusals(void) {
  const char* const malformed[] = {
      "{\"ota\":\"begin\"}",
      "{\"ota\":\"begin\",\"size\":\"1000\",\"md5\":5}",
      "{\"ota\":\"begin\",\"size\":-1,\"md5\":null}",
      "{\"ota\":\"begin\",\"size\":1.5}",
      "{\"ota\":\"begin\",\"size\":4294967296}",
      "{\"ota\":\"auth\",\"cnonce\":[],\"response\":{}}",
  };
  for (const char* json : malformed) {
    const protocol::Message m = message(json);
    TEST_ASSERT_EQUAL_INT_MESSAGE(protocol::Message::OTA, m.kind, json);
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(0, m.ota.size, json);
    TEST_ASSERT_EQUAL_STRING_MESSAGE("", m.ota.md5, json);
    TEST_ASSERT_EQUAL_STRING_MESSAGE("", m.ota.cnonce, json);
    TEST_ASSERT_EQUAL_STRING_MESSAGE("", m.ota.response, json);
  }
}

// The rover's own replies, a misspelt action, an empty one: none is an
// action the rover takes, and RemoteControl ignores them -- they are not the
// STOP a malformed command is.
void test_unknown_update_actions_change_nothing(void) {
  const char* const unknown[] = {"{\"ota\":\"next\",\"offset\":0}", "{\"ota\":\"BEGIN\"}", "{\"ota\":\"\"}"};
  for (const char* json : unknown) assertUpdateMessage(message(json), protocol::OtaRequest::UNKNOWN, json);
}

// "ota" makes an update message only as a string and without "move", as
// "scheme" makes a scheme message: otherwise the message drives. An update
// message naming a scheme as well is an update message, and sets no scheme.
void test_update_messages_need_a_string_and_no_move(void) {
  assertDefaultsToStop("{\"ota\":1}");
  const protocol::Message moving = message("{\"move\":1,\"speed\":10,\"duration\":100,\"ota\":\"cancel\"}");
  TEST_ASSERT_EQUAL_INT(protocol::Message::DRIVE, moving.kind);
  TEST_ASSERT_EQUAL_INT(MOVE_FORWARD, moving.command.move);
  assertUpdateMessage(message("{\"ota\":\"cancel\",\"scheme\":\"ADVANCED\"}"), protocol::OtaRequest::CANCEL,
                      "with a scheme");
}

// The longest update messages a client sends fit, as the longest command
// must: every field at its longest, spaced as json.dumps writes it.
void test_longest_update_messages_fit(void) {
  char longest[protocol::COMMAND_MAX_BYTES + 1];
  int length = snprintf(longest, sizeof(longest), "{\"ota\": \"%s\", \"size\": %u, \"md5\": \"%s\"}",
                        protocol::OTA_BEGIN, 4294967295u, HEX32);
  TEST_ASSERT_TRUE(length > 0 && static_cast<size_t>(length) <= protocol::COMMAND_MAX_BYTES);
  protocol::Message m = message(longest);
  assertUpdateMessage(m, protocol::OtaRequest::BEGIN, longest);
  TEST_ASSERT_EQUAL_UINT32(4294967295u, m.ota.size);

  length = snprintf(longest, sizeof(longest), "{\"ota\": \"%s\", \"cnonce\": \"%s\", \"response\": \"%s\"}",
                    protocol::OTA_AUTH, HEX32, HEX32);
  TEST_ASSERT_TRUE(length > 0 && static_cast<size_t>(length) <= protocol::COMMAND_MAX_BYTES);
  assertUpdateMessage(message(longest), protocol::OtaRequest::AUTH, longest);
}

// Each reply, key for key and type for type, as the client reads it.
void test_update_replies_are_written(void) {
  FirmwareUpdate::Reply reply = replyOf(FirmwareUpdate::Reply::AUTH);
  memcpy(reply.nonce, HEX32, sizeof(HEX32));
  TEST_ASSERT_EQUAL_STRING("{\"ota\":\"auth\",\"nonce\":\"0123456789abcdef0123456789abcdef\"}",
                           replyText(reply).c_str());

  reply = replyOf(FirmwareUpdate::Reply::NEXT);
  reply.offset = 4294967295u;
  TEST_ASSERT_EQUAL_STRING("{\"ota\":\"next\",\"offset\":4294967295}", replyText(reply).c_str());

  TEST_ASSERT_EQUAL_STRING("{\"ota\":\"done\"}", replyText(replyOf(FirmwareUpdate::Reply::DONE)).c_str());

  reply = replyOf(FirmwareUpdate::Reply::FAILED);
  reply.reason = "Cancelled.";
  TEST_ASSERT_EQUAL_STRING("{\"ota\":\"failed\",\"reason\":\"Cancelled.\"}", replyText(reply).c_str());
}

// No reply sends nothing, and one that does not fit is not sent truncated.
void test_update_replies_write_nothing_rather_than_too_little(void) {
  TEST_ASSERT_EQUAL_STRING("", replyText(replyOf(FirmwareUpdate::Reply::NONE)).c_str());
  char out[14];  // {"ota":"done"} without its terminator
  TEST_ASSERT_EQUAL_UINT(0, protocol::writeOtaReply(replyOf(FirmwareUpdate::Reply::DONE), out, sizeof(out)));
}

// A page opened from a file, or served from this computer or the local
// network, may connect; any other web page may not.
void test_local_origins_are_allowed(void) {
  const char* allowed[] = {
      "null", "file://", "http://localhost:8766", "http://LOCALHOST", "http://[::1]:8000",
      "http://127.0.0.1:8000", "http://10.0.0.5", "http://172.16.0.1", "http://172.31.255.255:80",
      "http://192.168.0.20:8000", "https://192.168.1.1", "http://169.254.3.4", "http://laptop:8000",
      "http://rover.local", "http://My-Mac.Local:8000",
  };
  for (size_t i = 0; i < sizeof(allowed) / sizeof(allowed[0]); i++) {
    TEST_ASSERT_TRUE_MESSAGE(protocol::originAllowed(allowed[i]), allowed[i]);
  }
}

void test_other_origins_are_refused(void) {
  const char* refused[] = {
      "https://example.com", "http://192.168.0.20.example.com", "http://172.32.0.1", "http://172.15.0.1",
      "http://11.0.0.1", "http://8.8.8.8", "http://192.169.0.1", "http://[fe80::1]",
      "http://example.local.com", "https://claude.ai", "", "localhost", "http://",
      "http://256.168.0.1", "http://10.0.0", "http://10.0.0.1.2", "http://0010.0.0.1", "http://10..0.1",
  };
  for (size_t i = 0; i < sizeof(refused) / sizeof(refused[0]); i++) {
    TEST_ASSERT_FALSE_MESSAGE(protocol::originAllowed(refused[i]), refused[i]);
  }
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_command_fields_are_read);
  RUN_TEST(test_missing_fields_default_to_stopping);
  RUN_TEST(test_wrongly_typed_fields_default_to_stopping);
  RUN_TEST(test_longest_command_fits);
  RUN_TEST(test_telemetry_frames_match_the_vectors);
  RUN_TEST(test_longest_telemetry_fits);
  RUN_TEST(test_too_small_a_buffer_writes_nothing);
  RUN_TEST(test_scheme_message_sets_the_scheme);
  RUN_TEST(test_unknown_scheme_is_ignored);
  RUN_TEST(test_other_messages_drive);
  RUN_TEST(test_a_move_with_a_scheme_still_drives);
  RUN_TEST(test_settings_messages_are_read);
  RUN_TEST(test_unknown_setting_values_are_left_out);
  RUN_TEST(test_settings_never_stop_the_rover);
  RUN_TEST(test_settings_frames_match_the_vectors);
  RUN_TEST(test_settings_fit);
  RUN_TEST(test_setting_names);
  RUN_TEST(test_log_lines_match_the_vectors);
  RUN_TEST(test_metrics_match_the_vectors);
  RUN_TEST(test_longest_log_line_fits);
  RUN_TEST(test_longest_metrics_fit);
  RUN_TEST(test_update_messages_are_read);
  RUN_TEST(test_update_fields_default_to_refusals);
  RUN_TEST(test_unknown_update_actions_change_nothing);
  RUN_TEST(test_update_messages_need_a_string_and_no_move);
  RUN_TEST(test_longest_update_messages_fit);
  RUN_TEST(test_update_replies_are_written);
  RUN_TEST(test_update_replies_write_nothing_rather_than_too_little);
  RUN_TEST(test_local_origins_are_allowed);
  RUN_TEST(test_other_origins_are_refused);
  return UNITY_END();
}
