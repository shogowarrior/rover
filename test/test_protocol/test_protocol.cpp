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
  char out[384];
  const size_t length = protocol::writeTelemetry(sampleStatus(), 41.5f, out, sizeof(out));
  TEST_ASSERT_TRUE(length > 0);

  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, out, length));
  TEST_ASSERT_EQUAL_STRING("AUTONOMOUS", doc["mode"]);
  TEST_ASSERT_EQUAL_STRING("MOVE_FORWARD", doc["move"]);
  TEST_ASSERT_TRUE(doc["moving"].as<bool>());
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
  char out[384];
  const size_t length = protocol::writeTelemetry(status, 40.0f, out, sizeof(out));
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
  char out[384];
  const size_t length = protocol::writeTelemetry(status, 40.0f, out, sizeof(out));
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, out, length));
  TEST_ASSERT_EQUAL_STRING("boxed in", doc["halt"]);
}

// Truncated JSON would reach every client as garbage. Better to send nothing.
void test_too_small_a_buffer_writes_nothing(void) {
  char out[16];
  TEST_ASSERT_EQUAL_UINT(0, protocol::writeTelemetry(sampleStatus(), 40.0f, out, sizeof(out)));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_command_fields_are_read);
  RUN_TEST(test_missing_fields_default_to_stopping);
  RUN_TEST(test_wrongly_typed_fields_default_to_stopping);
  RUN_TEST(test_telemetry_carries_every_key_clients_read);
  RUN_TEST(test_distances_are_omitted_until_scanned);
  RUN_TEST(test_halt_reason_is_reported);
  RUN_TEST(test_too_small_a_buffer_writes_nothing);
  return UNITY_END();
}
