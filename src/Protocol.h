#ifndef PROTOCOL_H
#define PROTOCOL_H

#include <ArduinoJson.h>
#include <stddef.h>

#include "EventLog.h"
#include "FirmwareUpdate.h"
#include "GamepadSession.h"
#include "Kinematics.h"
#include "Rover.h"
#include "Settings.h"
#include "Source.h"

// The WebSocket JSON wire format, in both directions, in one place.
//
// ArduinoJson is header-only and builds on the host, so this is tested there
// too (test/test_protocol). Clients: client/drive.py, client/ws.py,
// client/rover.ipynb and the panel's extras/joystick/js/. A WebSocket client
// sends each message as a text frame; the serial console takes the same
// messages, one to a line (SerialControl), all but a firmware update's.
//
//   client -> rover   {"move": <MoveCode>, "speed": 0..255, "duration": ms}
//                     {"settings": {"scheme"?, "sonar"?, "aim"?, "pad"?,
//                      "priority"?, "checksAtBoot"?}}, any of them
//                     {"scheme": "NORMAL" | "ADVANCED"}, the older form
//                     {"ota": "begin", "size": bytes, "md5": hex}
//                     {"ota": "auth", "cnonce": hex, "response": hex}
//                     {"ota": "cancel"}
//                     binary frames: the image, from the offset "next" names
//   rover -> clients  {"mode", "move", "moving", "temperature", "motorsReady",
//                      "scheme", "firmware", "sonar", "aim"?, "aimCm"?,
//                      "check"?, "pad"?, "control"?, "phase"?, "halt"?,
//                      "distanceLeft"?, "distanceFrontLeft"?, "distanceFront"?,
//                      "distanceFrontRight"?, "distanceRight"?}
//                     {"settings": {"scheme", "sonar", "aim", "pad",
//                      "priority", "checksAtBoot"}}, every setting
//                     {"log": text, "seq", "t", "src", "warn"?}, one EventLog line
//                     {"metrics": {"upS", "loopHz", "loopMaxMs", "heap",
//                      "heapMin", "rssi", "clients", "pings", "noEcho"}}
//   rover -> the client updating it
//                     {"ota": "auth", "nonce"}, {"ota": "next", "offset"},
//                     {"ota": "done"} or {"ota": "failed", "reason"}
//
// "phase" and "halt" appear only while exploring; the distances appear once
// every bearing has been measured. A distance of 999 means no echo.
// "motorsReady" is false when the motor shield did not answer at boot, which
// otherwise looks like a rover that reports moves but never moves. "scheme"
// is the control scheme every controller shares (kinematics::ControlScheme).
// "firmware" is the running image's MD5. It also says the rover takes
// updates over the link: older firmware reads an "ota" message as a STOP
// that takes control, so a client sends none without it.
//
// "sonar" is where manual mode points the sonar (Settings::sonar()), with
// "aim" while that is AIM, and "aimCm" in manual mode once a reading at that
// angle is in. "check" names the check under way (SelfTest.h). "pad" is the
// gamepad, "OFF", "WAITING" or "CONNECTED", sent only by a build with one.
// Like "sonar", "pad" from an older rover is simply absent. "control" names
// the controller holding control ("USB", "PAD" or "WIFI", Control.h), while
// one does.
//
// A frame with "settings" holds every setting (Settings.h): "scheme",
// "sonar", "aim" in degrees, "pad" ("ON" or "OFF"), "priority" (the three
// controllers, first first) and "checksAtBoot". Sent to a client that has
// just connected, and to every client as they change. A client changes them
// with the same shape, holding only what it changes; a value the rover does
// not know is ignored, and the rest of the message still applies. The
// rover keeps its settings in flash in this same shape.
//
// A frame with "log" is a line of the rover's EventLog, not telemetry: "seq"
// numbers it (a client drops a number it already holds), "t" is the rover's
// clock in ms, "src" says whose line it is ("USB", "PAD", "WIFI" or
// "ROVER", Source.h), and "warn" is true for a warning. A client that has
// just connected is sent every line still held first. A frame with
// "metrics" says how the rover itself is doing, every
// tuning::METRICS_INTERVAL_MS. None of these has "mode", and a client tells
// them from telemetry by their key.
namespace protocol {

struct Command {
  int move;
  int speed;
  int durationMs;
};

// A firmware update's message; FirmwareUpdate.h has the rules. The strings
// point into the parsed document, so they last as long as it does. A field
// absent or of the wrong type reads as 0 or "", which FirmwareUpdate refuses.
struct OtaRequest {
  enum Action { BEGIN, AUTH, CANCEL, UNKNOWN };
  Action action;
  uint32_t size;         // BEGIN: the image's length in bytes
  const char* md5;       // BEGIN: the image's MD5, 32 hex digits
  const char* cnonce;    // AUTH: the client's nonce, 32 hex digits
  const char* response;  // AUTH: md5hex(md5hex(password):nonce:cnonce)
};

// What one client message asks for.
struct Message {
  enum Kind {
    DRIVE,     // a drive command: `command`
    SETTINGS,  // a change of setting: `settings`
    IGNORE,    // configuration naming no value we know
    OTA,       // part of a firmware update: `ota`
  };
  Kind kind;
  Command command;
  Settings::Change settings;
  OtaRequest ota;
};

// Read any client message, from any controller. One carrying a string "ota"
// (and no "move") is part of a firmware update; one carrying an object
// "settings", or a string "scheme" (and no "move"), is configuration. None
// of those takes control or stops the rover by itself, and an unknown
// action or value changes nothing. Everything else is a drive command,
// defaults and all.
Message readMessage(JsonVariantConst json);

// "NORMAL" or "ADVANCED".
const char* schemeName(kinematics::ControlScheme scheme);
// "SWEEP", "FRONT" or "AIM".
const char* sonarName(Explorer::SonarMode mode);
// "OFF", "WAITING" or "CONNECTED"; nullptr for PAD_ABSENT, which is not sent.
const char* padName(PadState state);

// Whether a browser page from `origin`, the Origin header of its WebSocket
// handshake, may connect: a page opened from a file ("null", or "file://"
// in some browsers), or one served from this computer or the local network
// (localhost, 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, a name ending
// ".local", or one with no dot). That keeps an ordinary web page the
// operator has open from reaching ws://<rover>:81 to drive the rover. Not a
// determined one: a sandboxed frame's Origin is "null" too, which is why
// updates over the link need a password (features::LINK_UPDATE_NEEDS_PASSWORD).
// Clients that are not browsers send no Origin, and are let in.
bool originAllowed(const char* origin);

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
// case against this, about 430 bytes today: a new key must keep it inside.
// It is on the loop task's stack while a frame is written, as are the
// lines and metrics below, one at a time.
constexpr size_t TELEMETRY_MAX_BYTES = 512;

// Everything a telemetry frame reports.
struct Report {
  Rover::Status status;
  kinematics::ControlScheme scheme;
  PadState pad;
  Source control;  // who holds control (Control::holder()); SOURCE_ROVER for no one
  float temperatureC;
  const char* firmware;  // the running image's MD5
};

// Serialise telemetry into `out`. Returns the length written, or 0 if it did
// not fit (never a truncated, invalid document).
size_t writeTelemetry(const Report& report, char* out, size_t capacity);

// RemoteControl's buffer for one log line's frame, terminator included. An
// EventLog line is at most EventLog::TEXT_MAX - 1 ASCII characters, which
// JSON escapes to at most twice that, quotes and backslashes being the only
// ones that need it; test_longest_log_line_fits checks the worst case.
constexpr size_t LOG_LINE_MAX_BYTES = 256;

// Serialise one EventLog line into `out`. Returns the length written, or 0
// if it did not fit.
size_t writeLogLine(const EventLog::Entry& entry, char* out, size_t capacity);

// RemoteControl's buffer for the settings frame, and main.cpp's for the
// copy in flash, terminator included; test_settings_fit checks the worst
// case.
constexpr size_t SETTINGS_MAX_BYTES = 192;

// Serialise every setting into `out`, as {"settings": {...}}. Returns the
// length written, or 0 if it did not fit.
size_t writeSettings(const Settings& settings, char* out, size_t capacity);

// How the rover itself is doing, for a client to watch over time.
struct Metrics {
  uint32_t uptimeS;
  uint32_t loopHz;       // passes of loop() a second, over the last interval
  uint32_t loopMaxMs;    // the longest gap between two passes in it
  uint32_t heapFree;     // bytes
  uint32_t heapMinFree;  // the least free since boot
  int rssi;              // the WiFi signal, dBm
  int clients;           // connected WebSocket clients
  uint32_t pings;        // sonar pings since boot...
  uint32_t silentPings;  // ...and those that heard no echo
};

// RemoteControl's buffer for one metrics frame, terminator included;
// test_longest_metrics_fit checks the worst case.
constexpr size_t METRICS_MAX_BYTES = 256;

// Serialise metrics into `out`. Returns the length written, or 0 if it did
// not fit.
size_t writeMetrics(const Metrics& metrics, char* out, size_t capacity);

}  // namespace protocol

#endif
