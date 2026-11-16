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

// Whether `json` is a configuration message keyed `key`: a string there and
// no "move", so a client that only changes a setting never takes control
// from an exploring rover.
bool isSetting(JsonVariantConst json, const char* key) {
  return json[key].is<const char*>() && json["move"].isNull();
}

// The value of `count` choices whose name `name()` gives is `text`, or false.
template <typename T>
bool readName(const char* text, T& value, int count, const char* (*name)(T)) {
  for (int i = 0; i < count; i++) {
    const T candidate = static_cast<T>(i);
    if (strcmp(text, name(candidate)) == 0) {
      value = candidate;
      return true;
    }
  }
  return false;
}

}  // namespace

Message readMessage(JsonVariantConst json) {
  Message message;
  message.kind = Message::DRIVE;
  message.command = readCommand(json);
  message.scheme = kinematics::SCHEME_NORMAL;
  message.sonar = Explorer::SONAR_SWEEP;
  message.hasAim = false;
  message.aimDeg = 0;
  message.padOn = true;
  if (readOtaRequest(json, message.ota)) {
    message.kind = Message::OTA;
    return message;
  }

  if (isSetting(json, "scheme")) {
    message.kind = readName<kinematics::ControlScheme>(json["scheme"], message.scheme, 2, schemeName)
                       ? Message::SET_SCHEME
                       : Message::IGNORE;
  } else if (isSetting(json, "sonar")) {
    message.kind = readName<Explorer::SonarMode>(json["sonar"], message.sonar, 3, sonarName)
                       ? Message::SET_SONAR
                       : Message::IGNORE;
    // A number only; Rover::setSonar() clamps it.
    message.hasAim = json["aim"].is<int>();
    message.aimDeg = json["aim"] | 0;
  } else if (isSetting(json, "pad")) {
    const char* name = json["pad"];
    message.kind = Message::SET_PAD;
    if (strcmp(name, "ON") == 0) {
      message.padOn = true;
    } else if (strcmp(name, "OFF") == 0) {
      message.padOn = false;
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

// SONAR_MODES in extras/joystick/js/protocol.js copies these names, and
// tools/check_protocol.py checks them.
const char* sonarName(Explorer::SonarMode mode) {
  switch (mode) {
    case Explorer::SONAR_FRONT:
      return "FRONT";
    case Explorer::SONAR_AIM:
      return "AIM";
    case Explorer::SONAR_SWEEP:
    default:
      return "SWEEP";
  }
}

// PAD_STATES in extras/joystick/js/protocol.js copies these names, and
// tools/check_protocol.py checks them.
const char* padName(PadState state) {
  switch (state) {
    case PAD_OFF:
      return "OFF";
    case PAD_WAITING:
      return "WAITING";
    case PAD_CONNECTED:
      return "CONNECTED";
    case PAD_ABSENT:
    default:
      return nullptr;
  }
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

size_t writeTelemetry(const Report& report, char* out, size_t capacity) {
  const Rover::Status& status = report.status;
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
  doc["temperature"] = report.temperatureC;
  doc["motorsReady"] = status.motorsReady;
  doc["scheme"] = schemeName(report.scheme);
  doc["firmware"] = report.firmware;
  doc["sonar"] = sonarName(status.sonar);
  if (status.sonar == Explorer::SONAR_AIM) doc["aim"] = status.aimDeg;
  if (status.hasAimCm) doc["aimCm"] = status.aimCm;
  if (status.check != nullptr) doc["check"] = status.check;
  if (padName(report.pad) != nullptr) doc["pad"] = padName(report.pad);
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

size_t writeLogLine(const EventLog::Entry& entry, char* out, size_t capacity) {
  JsonDocument doc;
  // As a pointer: as an array, ArduinoJson would take the whole buffer to be
  // a string literal's.
  doc["log"] = static_cast<const char*>(entry.text);
  doc["seq"] = entry.seq;
  doc["t"] = entry.atMs;
  if (entry.level == EventLog::WARN) doc["warn"] = true;
  if (measureJson(doc) >= capacity) return 0;  // leave room for the terminator
  return serializeJson(doc, out, capacity);
}

size_t writeMetrics(const Metrics& metrics, char* out, size_t capacity) {
  JsonDocument doc;
  JsonObject values = doc["metrics"].to<JsonObject>();
  values["upS"] = metrics.uptimeS;
  values["loopHz"] = metrics.loopHz;
  values["loopMaxMs"] = metrics.loopMaxMs;
  values["heap"] = metrics.heapFree;
  values["heapMin"] = metrics.heapMinFree;
  values["rssi"] = metrics.rssi;
  values["clients"] = metrics.clients;
  values["pings"] = metrics.pings;
  values["noEcho"] = metrics.silentPings;
  if (measureJson(doc) >= capacity) return 0;  // leave room for the terminator
  return serializeJson(doc, out, capacity);
}

}  // namespace protocol
