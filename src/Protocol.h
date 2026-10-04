#ifndef PROTOCOL_H
#define PROTOCOL_H

#include <ArduinoJson.h>
#include <stddef.h>

#include "FirmwareUpdate.h"
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

// Read any client message. One carrying "scheme" (and no "move") sets the
// control scheme: it never takes control and never stops the rover, and an
// unknown scheme name is ignored. Everything else is a drive command,
// defaults and all.
Message readMessage(JsonVariantConst json);

// "NORMAL" or "ADVANCED".
const char* schemeName(kinematics::ControlScheme scheme);

// The longest client message RemoteControl reads; a longer frame is ignored
// unread. Every real client sends well under 100 bytes, so anything bigger is
// not a command, and parsing it would only cost heap.
// test_longest_command_fits checks the longest a client sends against this.
constexpr size_t COMMAND_MAX_BYTES = 256;

// A firmware update over the link (FirmwareUpdate.h). A message carrying a
// string "ota" and no "move" is part of one: never a command, so it takes no
// control and stops nothing by itself. These are its actions and replies,
// which OTA_BEGIN and the rest in extras/joystick/js/protocol.js copy, and
// tools/check_protocol.py checks.
constexpr char OTA_BEGIN[] = "begin";    // client: {"ota", "size", "md5"}
constexpr char OTA_AUTH[] = "auth";      // rover: {"ota", "nonce"}; client: {"ota", "cnonce", "response"}
constexpr char OTA_CANCEL[] = "cancel";  // client: {"ota"}
constexpr char OTA_NEXT[] = "next";      // rover: {"ota", "offset"}
constexpr char OTA_DONE[] = "done";      // rover: {"ota"}
constexpr char OTA_FAILED[] = "failed";  // rover: {"ota", "reason"}

// The most image one binary frame carries. Firefox sends a payload over 1000
// bytes as two writes, and WebSockets 2.6.1, under WEBSOCKETS_TCP_TIMEOUT=2
// (platformio.ini), drops a frame whose segments arrive more than 2 ms apart
// and disconnects its client. 1000 bytes and an 8-byte header fit one
// 1436-byte segment. OTA_CHUNK_BYTES in extras/joystick/js/protocol.js may
// not exceed it, and tools/check_protocol.py checks.
constexpr size_t OTA_CHUNK_MAX_BYTES = 1000;

// RemoteControl's buffer for one reply to an update, terminator included. A
// reply that does not fit is not sent, and its client waits for it until its
// own timeout. test_firmware_update writes every reply FirmwareUpdate makes
// into one this size.
constexpr size_t OTA_REPLY_MAX_BYTES = 128;

// Serialise a reply to the client updating the rover into `out`. Returns the
// length written, or 0 for no reply or if it did not fit.
size_t writeOtaReply(const FirmwareUpdate::Reply& reply, char* out, size_t capacity);

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
