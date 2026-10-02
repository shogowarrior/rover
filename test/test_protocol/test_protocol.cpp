#include <ArduinoJson.h>
#include <string.h>
#include <unity.h>

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

protocol::Command parse(const char* json) {
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, json));
  return protocol::readCommand(doc.as<JsonVariantConst>());
}

Rover::Status sampleStatus() {
  Rover::Status status;
  status.mode = Rover::MODE_AUTONOMOUS;
  status.move = MOVE_FORWARD;
  status.moving = true;
  status.phase = "CRUISE";
  status.haltReason = nullptr;
  status.hasScan = true;
  for (int i = 0; i < Explorer::BEARING_COUNT; i++) status.scanCm[i] = 100.0f + i;
  status.motorsReady = true;
  return status;
}

}  // namespace

void test_command_fields_are_read(void) {
  const protocol::Command command = parse("{\"move\":4,\"speed\":120,\"duration\":400}");
  TEST_ASSERT_EQUAL_INT(MOVE_LEFT, command.move);
  TEST_ASSERT_EQUAL_INT(120, command.speed);
  TEST_ASSERT_EQUAL_INT(400, command.durationMs);
}

// A malformed message degrades to STOP, speed 0 -- releasing the motors --
// not to whatever as<int>() would have produced for a missing field.
void test_missing_fields_default_to_stopping(void) {
  const protocol::Command command = parse("{}");
  TEST_ASSERT_EQUAL_INT(STOP, command.move);
  TEST_ASSERT_EQUAL_INT(0, command.speed);
  TEST_ASSERT_EQUAL_INT(tuning::DEFAULT_MOVE_DURATION_MS, command.durationMs);
}

void test_wrongly_typed_fields_default_to_stopping(void) {
  const protocol::Command command = parse("{\"move\":\"1\",\"speed\":64.5,\"duration\":\"long\"}");
  TEST_ASSERT_EQUAL_INT(STOP, command.move);
  TEST_ASSERT_EQUAL_INT(0, command.speed);
  TEST_ASSERT_EQUAL_INT(tuning::DEFAULT_MOVE_DURATION_MS, command.durationMs);
}

void test_telemetry_carries_every_key_clients_read(void) {
  char out[protocol::TELEMETRY_MAX_BYTES];
  const size_t length = protocol::writeTelemetry(sampleStatus(), kinematics::SCHEME_ADVANCED, 41.5f, out, sizeof(out));
  TEST_ASSERT_TRUE(length > 0);

  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, out, length));
  TEST_ASSERT_EQUAL_STRING("AUTONOMOUS", doc["mode"]);
  TEST_ASSERT_EQUAL_STRING("MOVE_FORWARD", doc["move"]);
  TEST_ASSERT_TRUE(doc["moving"].as<bool>());
  TEST_ASSERT_TRUE(doc["motorsReady"].as<bool>());
  TEST_ASSERT_EQUAL_STRING("ADVANCED", doc["scheme"]);
  TEST_ASSERT_EQUAL_FLOAT(41.5f, doc["temperature"].as<float>());
  TEST_ASSERT_EQUAL_STRING("CRUISE", doc["phase"]);
  TEST_ASSERT_FALSE(doc["halt"].is<const char*>());
  TEST_ASSERT_EQUAL_FLOAT(100.0f, doc["distanceLeft"].as<float>());
  TEST_ASSERT_EQUAL_FLOAT(101.0f, doc["distanceFrontLeft"].as<float>());
  TEST_ASSERT_EQUAL_FLOAT(102.0f, doc["distanceFront"].as<float>());
  TEST_ASSERT_EQUAL_FLOAT(103.0f, doc["distanceFrontRight"].as<float>());
  TEST_ASSERT_EQUAL_FLOAT(104.0f, doc["distanceRight"].as<float>());
}

// Until every bearing has been measured there is nothing true to report.
void test_distances_are_omitted_until_scanned(void) {
  Rover::Status status = sampleStatus();
  status.hasScan = false;
  status.mode = Rover::MODE_MANUAL;
  status.phase = nullptr;
  char out[protocol::TELEMETRY_MAX_BYTES];
  const size_t length = protocol::writeTelemetry(status, kinematics::SCHEME_NORMAL, 40.0f, out, sizeof(out));
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, out, length));
  TEST_ASSERT_EQUAL_STRING("MANUAL", doc["mode"]);
  TEST_ASSERT_FALSE(doc["distanceFront"].is<float>());
  TEST_ASSERT_FALSE(doc["phase"].is<const char*>());
}

void test_halt_reason_is_reported(void) {
  Rover::Status status = sampleStatus();
  status.phase = "HALTED";
  status.haltReason = "boxed in";
  char out[protocol::TELEMETRY_MAX_BYTES];
  const size_t length = protocol::writeTelemetry(status, kinematics::SCHEME_NORMAL, 40.0f, out, sizeof(out));
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, out, length));
  TEST_ASSERT_EQUAL_STRING("boxed in", doc["halt"]);
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

  char out[protocol::TELEMETRY_MAX_BYTES];
  const size_t length = protocol::writeTelemetry(status, kinematics::SCHEME_ADVANCED, -12.34568f, out, sizeof(out));
  TEST_ASSERT_TRUE(length > 0);
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, out, length));
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

// Anything else is a drive command, with the usual stop-on-garbage defaults,
// including a scheme that is not a string.
void test_other_messages_drive(void) {
  protocol::Message m = message("{\"move\":1,\"speed\":90,\"duration\":300}");
  TEST_ASSERT_EQUAL_INT(protocol::Message::DRIVE, m.kind);
  TEST_ASSERT_EQUAL_INT(MOVE_FORWARD, m.command.move);
  TEST_ASSERT_EQUAL_INT(90, m.command.speed);
  m = message("{\"scheme\":1}");
  TEST_ASSERT_EQUAL_INT(protocol::Message::DRIVE, m.kind);
  TEST_ASSERT_EQUAL_INT(STOP, m.command.move);
}

// Truncated JSON would reach every client as garbage. Better to send nothing.
void test_too_small_a_buffer_writes_nothing(void) {
  char out[16];
  TEST_ASSERT_EQUAL_UINT(0, protocol::writeTelemetry(sampleStatus(), kinematics::SCHEME_NORMAL, 40.0f, out, sizeof(out)));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_command_fields_are_read);
  RUN_TEST(test_missing_fields_default_to_stopping);
  RUN_TEST(test_wrongly_typed_fields_default_to_stopping);
  RUN_TEST(test_telemetry_carries_every_key_clients_read);
  RUN_TEST(test_distances_are_omitted_until_scanned);
  RUN_TEST(test_halt_reason_is_reported);
  RUN_TEST(test_longest_telemetry_fits);
  RUN_TEST(test_too_small_a_buffer_writes_nothing);
  RUN_TEST(test_scheme_message_sets_the_scheme);
  RUN_TEST(test_unknown_scheme_is_ignored);
  RUN_TEST(test_other_messages_drive);
  return UNITY_END();
}
