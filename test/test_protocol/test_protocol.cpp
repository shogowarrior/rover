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

protocol::Message message(const char* json) {
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, json));
  return protocol::readMessage(doc.as<JsonVariantConst>());
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
  return status;
}

// writeTelemetry()'s frame for `status`, parsed. Fails the test when nothing
// was written.
JsonDocument written(const Rover::Status& status, kinematics::ControlScheme scheme, float temperatureC) {
  char out[protocol::TELEMETRY_MAX_BYTES];
  const size_t length = protocol::writeTelemetry(status, scheme, temperatureC, out, sizeof(out));
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

// Every frame in test/vectors/telemetry.json, written from the status it
// describes: each key it holds, and no other. Between them the frames pin
// that the distances appear only once every bearing has been measured
// (before that there is nothing true to report), "phase" only while
// exploring and "halt" only when halted, and that the two flags each carry
// their own value, false included, as a boolean: serialised from the wrong
// field, as a constant or as a number, "motorsReady" hides the dead shield it
// exists to report, and telemetry names a move that never reaches the wheels.
void test_telemetry_frames_match_the_vectors(void) {
  const JsonDocument vectors = loadVectors("telemetry.json");
  for (JsonPairConst named : vectors["frames"].as<JsonObjectConst>()) {
    const JsonObjectConst frame = named.value();
    const JsonDocument out = written(statusOf(frame), schemeNamed(frame["scheme"]), frame["temperature"]);
    TEST_ASSERT_EQUAL_INT_MESSAGE(frame.size(), out.size(), named.key().c_str());
    for (JsonPairConst key : frame) {
      char label[64];
      snprintf(label, sizeof(label), "%s: %s", named.key().c_str(), key.key().c_str());
      TEST_ASSERT_EQUAL_STRING_MESSAGE(jsonText(key.value()).c_str(), jsonText(out[key.key()]).c_str(), label);
    }
  }
}

// The largest frame must fit RemoteControl's buffer, or telemetry silently
// stops in exactly those states. Every field at its longest, whether or not
// the states can occur together: the longest move name, the longest phase and
// halt reason, "false" for both flags, a negative temperature and distances
// with seven significant digits.
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

  const JsonDocument doc = written(status, kinematics::SCHEME_ADVANCED, -12.34568f);
  TEST_ASSERT_EQUAL_STRING(moveName(status.move), doc["move"]);
}

void test_scheme_message_sets_the_scheme(void) {
  protocol::Message m = message("{\"scheme\":\"ADVANCED\"}");
  TEST_ASSERT_EQUAL_INT(protocol::Message::SET_SCHEME, m.kind);
  TEST_ASSERT_EQUAL_INT(kinematics::SCHEME_ADVANCED, m.scheme);
  m = message("{\"scheme\":\"NORMAL\"}");
  TEST_ASSERT_EQUAL_INT(protocol::Message::SET_SCHEME, m.kind);
  TEST_ASSERT_EQUAL_INT(kinematics::SCHEME_NORMAL, m.scheme);
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
  TEST_ASSERT_EQUAL_UINT(0, protocol::writeTelemetry(statusOf(vectors["frames"]["cruising"]), kinematics::SCHEME_NORMAL,
                                                     40.0f, out, sizeof(out)));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_command_fields_are_read);
  RUN_TEST(test_missing_fields_default_to_stopping);
  RUN_TEST(test_wrongly_typed_fields_default_to_stopping);
  RUN_TEST(test_telemetry_frames_match_the_vectors);
  RUN_TEST(test_longest_telemetry_fits);
  RUN_TEST(test_too_small_a_buffer_writes_nothing);
  RUN_TEST(test_scheme_message_sets_the_scheme);
  RUN_TEST(test_unknown_scheme_is_ignored);
  RUN_TEST(test_other_messages_drive);
  RUN_TEST(test_a_move_with_a_scheme_still_drives);
  return UNITY_END();
}
