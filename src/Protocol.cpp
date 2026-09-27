#include "Protocol.h"

#include <string.h>

#include "MovePatterns.h"
#include "Tuning.h"

namespace protocol {

Command readCommand(JsonVariantConst json) {
  Command command;
  command.move = json["move"] | static_cast<int>(STOP);
  command.speed = json["speed"] | 0;
  command.durationMs = json["duration"] | tuning::DEFAULT_MOVE_DURATION_MS;
  return command;
}

Message readMessage(JsonVariantConst json) {
  Message message;
  message.kind = Message::DRIVE;
  message.command = readCommand(json);
  message.scheme = kinematics::SCHEME_NORMAL;

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

const char* schemeName(kinematics::ControlScheme scheme) {
  return scheme == kinematics::SCHEME_ADVANCED ? "ADVANCED" : "NORMAL";
}

size_t writeTelemetry(const Rover::Status& status, kinematics::ControlScheme scheme,
                      float temperatureC, char* out, size_t capacity) {
  // Built fresh each time from typed state: a long-lived JsonDocument used as
  // a state store is what let stale distances and move names leak into
  // telemetry before.
  JsonDocument doc;
  doc["mode"] = status.mode == Rover::MODE_AUTONOMOUS ? "AUTONOMOUS" : "MANUAL";
  doc["move"] = moveName(status.move);
  doc["moving"] = status.moving;
  doc["temperature"] = temperatureC;
  doc["motorsReady"] = status.motorsReady;
  doc["scheme"] = schemeName(scheme);
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
