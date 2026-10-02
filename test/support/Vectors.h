#ifndef TEST_SUPPORT_VECTORS_H
#define TEST_SUPPORT_VECTORS_H

// The shared cases in test/vectors/: one JSON file per contract, so the
// firmware's tests and the panel's (extras/joystick/test/) can check the same
// cases.

#include <ArduinoJson.h>
#include <unity.h>

#include <fstream>
#include <string>

// Reads test/vectors/<name>, failing the test, by path, when the file is
// missing or not JSON. The test runner starts in the project directory.
inline JsonDocument loadVectors(const char* name) {
  const std::string path = std::string("test/vectors/") + name;
  std::ifstream file(path.c_str());
  JsonDocument doc;
  TEST_ASSERT_TRUE_MESSAGE(file.good(), path.c_str());
  TEST_ASSERT_FALSE_MESSAGE(deserializeJson(doc, file), path.c_str());
  return doc;
}

#endif
