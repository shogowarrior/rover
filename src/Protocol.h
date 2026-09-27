#ifndef PROTOCOL_H
#define PROTOCOL_H

#include <ArduinoJson.h>
#include <stddef.h>

#include "Rover.h"

// The WebSocket JSON wire format, in both directions, in one place.
//
// ArduinoJson is header-only and builds on the host, so this is tested there
// too (test/test_protocol). Clients: client/drive.py, client/ws.py,
// client/rover.ipynb and extras/joystick/control.js.
//
//   client -> rover   {"move": <MoveCode>, "speed": 0..255, "duration": ms}
//   rover -> clients  {"mode", "move", "moving", "temperature", "phase"?,
//                      "halt"?, "distanceLeft"?, "distanceFrontLeft"?,
//                      "distanceFront"?, "distanceFrontRight"?, "distanceRight"?}
//
// "phase" and "halt" appear only while exploring; the distances appear once
// every bearing has been measured. A distance of 999 means no echo.
namespace protocol {

struct Command {
  int move;
  int speed;
  int durationMs;
};

// Read a drive command. `|` supplies the default when a key is absent or has
// the wrong type, so a malformed message degrades to STOP / speed 0 (which
// releases the motors) rather than to whatever as<int>() would produce.
Command readCommand(JsonVariantConst json);

// Serialise telemetry into `out`. Returns the length written, or 0 if it did
// not fit (never a truncated, invalid document).
size_t writeTelemetry(const Rover::Status& status, float temperatureC, char* out,
                      size_t capacity);

}  // namespace protocol

#endif
