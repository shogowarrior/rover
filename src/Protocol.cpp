#include "Protocol.h"

#include <ctype.h>
#include <string.h>

#include "MovePatterns.h"
#include "Tuning.h"

namespace protocol {

namespace {

// A dotted quad, each part 0 to 255, and nothing more. By hand: sscanf()
// would add 28 KB to the firmware.
bool readIpv4(const char* text, unsigned octet[4]) {
  for (int i = 0; i < 4; i++) {
    if (!isdigit(static_cast<unsigned char>(*text))) return false;
    unsigned value = 0;
    for (int digits = 0; isdigit(static_cast<unsigned char>(*text)); digits++, text++) {
      if (digits == 3) return false;
      value = value * 10 + static_cast<unsigned>(*text - '0');
    }
    if (value > 255) return false;
    octet[i] = value;
    if (*text != (i < 3 ? '.' : '\0')) return false;
    if (i < 3) text++;
  }
  return true;
}

// `|` supplies the default when a key is absent or has the wrong type, so a
// malformed message degrades to STOP / speed 0 (which releases the motors)
// rather than to whatever as<int>() would produce.
Command readCommand(JsonVariantConst json) {
  Command command;
  command.move = json["move"] | static_cast<int>(STOP);
  command.speed = json["speed"] | 0;
  command.durationMs = json["duration"] | tuning::DEFAULT_MOVE_DURATION_MS;
  return command;
}

// Reads `json` as part of a firmware update into `request`, and says whether
// it is one. Like a scheme message it is not a command: a client updating
// the rover must not take control of it, or stop it exploring, by sending
// one. FirmwareUpdate stands the rover down itself, once it has checked the
// request.
bool readOtaRequest(JsonVariantConst json, OtaRequest& request) {
  const char* action = json["ota"] | "";
  request.action = strcmp(action, OTA_BEGIN) == 0    ? OtaRequest::BEGIN
                   : strcmp(action, OTA_AUTH) == 0   ? OtaRequest::AUTH
                   : strcmp(action, OTA_CANCEL) == 0 ? OtaRequest::CANCEL
                                                     : OtaRequest::UNKNOWN;
  request.size = json["size"] | static_cast<uint32_t>(0);
  request.md5 = json["md5"] | "";
  request.cnonce = json["cnonce"] | "";
  request.response = json["response"] | "";
  return json["ota"].is<const char*>() && json["move"].isNull();
}

}  // namespace

Message readMessage(JsonVariantConst json) {
  Message message;
  message.kind = Message::DRIVE;
  message.command = readCommand(json);
  message.scheme = kinematics::SCHEME_NORMAL;
  if (readOtaRequest(json, message.ota)) {
    message.kind = Message::OTA;
    return message;
  }

  // A scheme message is configuration, not a command: a client that only
  // switches layouts must not take control from an exploring rover.
  if (json["scheme"].is<const char*>() && json["move"].isNull()) {
    const char* name = json["scheme"];
    if (strcmp(name, schemeName(kinematics::SCHEME_NORMAL)) == 0) {
      message.kind = Message::SET_SCHEME;
      message.scheme = kinematics::SCHEME_NORMAL;
    } else if (strcmp(name, schemeName(kinematics::SCHEME_ADVANCED)) == 0) {
      message.kind = Message::SET_SCHEME;
      message.scheme = kinematics::SCHEME_ADVANCED;
    } else {
      message.kind = Message::IGNORE;
    }
  }
  return message;
}

// SCHEME_NORMAL and SCHEME_ADVANCED in extras/joystick/js/protocol.js copy
// these names, and tools/check_protocol.py checks them.
const char* schemeName(kinematics::ControlScheme scheme) {
  return scheme == kinematics::SCHEME_ADVANCED ? "ADVANCED" : "NORMAL";
}

bool originAllowed(const char* origin) {
  if (strcmp(origin, "null") == 0 || strncmp(origin, "file:", 5) == 0) return true;

  const char* host = strstr(origin, "://");
  if (host == nullptr) return false;
  host += 3;
  // The host, lowercased, without the port; an IPv6 literal only as [::1].
  char name[64];
  size_t length = strcspn(host, ":/");
  if (host[0] == '[') length = strcspn(host, "]") + 1;
  if (length == 0 || length >= sizeof(name)) return false;
  for (size_t i = 0; i < length; i++) name[i] = static_cast<char>(tolower(static_cast<unsigned char>(host[i])));
  name[length] = '\0';

  if (strcmp(name, "localhost") == 0 || strcmp(name, "[::1]") == 0) return true;
  if (strchr(name, '.') == nullptr) return name[0] != '[';
  const size_t local = strlen(".local");
  if (length > local && strcmp(name + length - local, ".local") == 0) return true;

  unsigned octet[4];
  if (!readIpv4(name, octet)) return false;
  const unsigned a = octet[0], b = octet[1];
  return a == 127 || a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) ||
         (a == 169 && b == 254);
}

size_t writeOtaReply(const FirmwareUpdate::Reply& reply, char* out, size_t capacity) {
  JsonDocument doc;
  switch (reply.kind) {
    case FirmwareUpdate::Reply::NONE:
      return 0;
    case FirmwareUpdate::Reply::AUTH:
      doc["ota"] = OTA_AUTH;
      // As a pointer: as an array, ArduinoJson would take all 32 characters
      // to be a string literal's, by address.
      doc["nonce"] = static_cast<const char*>(reply.nonce);
      break;
    case FirmwareUpdate::Reply::NEXT:
      doc["ota"] = OTA_NEXT;
      doc["offset"] = reply.offset;
      break;
    case FirmwareUpdate::Reply::DONE:
      doc["ota"] = OTA_DONE;
      break;
    case FirmwareUpdate::Reply::FAILED:
      doc["ota"] = OTA_FAILED;
      doc["reason"] = reply.reason;
      break;
  }
  if (measureJson(doc) >= capacity) return 0;  // leave room for the terminator
  return serializeJson(doc, out, capacity);
}

size_t writeTelemetry(const Rover::Status& status, kinematics::ControlScheme scheme,
                      float temperatureC, const char* firmware, char* out, size_t capacity) {
  // Built fresh each time from typed state: a long-lived JsonDocument used as
  // a state store is what let stale distances and move names leak into
  // telemetry before.
  JsonDocument doc;
  // MODE_AUTONOMOUS and MODE_MANUAL in extras/joystick/js/protocol.js, and
  // MODE_AUTONOMOUS in client/drive.py, copy these names, and
  // tools/check_protocol.py checks them.
  doc["mode"] = status.mode == Rover::MODE_AUTONOMOUS ? "AUTONOMOUS" : "MANUAL";
  doc["move"] = moveName(status.move);
  doc["moving"] = status.moving;
  doc["temperature"] = temperatureC;
  doc["motorsReady"] = status.motorsReady;
  doc["scheme"] = schemeName(scheme);
  doc["firmware"] = firmware;
  if (status.phase != nullptr) doc["phase"] = status.phase;
  if (status.haltReason != nullptr) doc["halt"] = status.haltReason;

  if (status.hasScan) {
    doc["distanceLeft"] = status.scanCm[Explorer::LEFT];
    doc["distanceFrontLeft"] = status.scanCm[Explorer::FRONT_LEFT];
    doc["distanceFront"] = status.scanCm[Explorer::FRONT];
    doc["distanceFrontRight"] = status.scanCm[Explorer::FRONT_RIGHT];
    doc["distanceRight"] = status.scanCm[Explorer::RIGHT];
  }

  if (measureJson(doc) >= capacity) return 0;  // leave room for the terminator
  return serializeJson(doc, out, capacity);
}

}  // namespace protocol
