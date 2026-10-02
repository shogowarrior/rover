#ifndef PROTOCOL_H
#define PROTOCOL_H

#include <ArduinoJson.h>
#include <stddef.h>

#include "Kinematics.h"
#include "Rover.h"

// The WebSocket JSON wire format, in both directions, in one place.
//
// ArduinoJson is header-only and builds on the host, so this is tested there
// too (test/test_protocol). Clients: client/drive.py, client/ws.py,
// client/rover.ipynb and the panel's extras/joystick/js/.
//
//   client -> rover   {"move": <MoveCode>, "speed": 0..255, "duration": ms}
//                     {"scheme": "NORMAL" | "ADVANCED"}
//   rover -> clients  {"mode", "move", "moving", "temperature", "motorsReady",
//                      "scheme", "phase"?, "halt"?, "distanceLeft"?,
//                      "distanceFrontLeft"?, "distanceFront"?,
//                      "distanceFrontRight"?, "distanceRight"?}
//
// "phase" and "halt" appear only while exploring; the distances appear once
// every bearing has been measured. A distance of 999 means no echo.
// "motorsReady" is false when the motor shield did not answer at boot, which
// otherwise looks like a rover that reports moves but never moves. "scheme"
// is the control scheme every controller shares (kinematics::ControlScheme).
namespace protocol {

struct Command {
  int move;
  int speed;
  int durationMs;
};

// What one client message asks for.
struct Message {
  enum Kind {
    DRIVE,       // a drive command: `command`
    SET_SCHEME,  // choose the control scheme: `scheme`
    IGNORE,      // a scheme message naming no scheme we know
  };
  Kind kind;
  Command command;
  kinematics::ControlScheme scheme;
};

// Read a drive command. `|` supplies the default when a key is absent or has
// the wrong type, so a malformed message degrades to STOP / speed 0 (which
// releases the motors) rather than to whatever as<int>() would produce.
Command readCommand(JsonVariantConst json);

// Read any client message. One carrying "scheme" (and no "move") sets the
// control scheme: it never takes control and never stops the rover, and an
// unknown scheme name is ignored. Everything else is a drive command,
// defaults and all.
Message readMessage(JsonVariantConst json);

// "NORMAL" or "ADVANCED".
const char* schemeName(kinematics::ControlScheme scheme);

// RemoteControl's buffer for one telemetry frame, terminator included. A frame
// that does not fit is not sent at all, so telemetry would freeze in exactly
// the states that outgrow it. test_longest_telemetry_fits checks the worst
// case against this, about 315 bytes today: a new key must keep it inside.
constexpr size_t TELEMETRY_MAX_BYTES = 384;

// Serialise telemetry into `out`. Returns the length written, or 0 if it did
// not fit (never a truncated, invalid document).
size_t writeTelemetry(const Rover::Status& status, kinematics::ControlScheme scheme,
                      float temperatureC, char* out, size_t capacity);

}  // namespace protocol

#endif
