#include "RemoteControl.h"

#include "Protocol.h"
#include "Timing.h"
#include "Tuning.h"

namespace {

// Every real client sends well under 100 bytes. Anything bigger is not a
// command, and parsing it would only cost heap.
constexpr size_t MAX_COMMAND_BYTES = 256;

// Ping every client each second and drop one that misses two pongs in a row.
// Browsers and the Python websockets library answer automatically.
//
// This is not just tidiness. A client that vanishes without closing (a phone
// that sleeps, a laptop that roams) still looks connected, and once its send
// buffer fills every telemetry broadcast to it blocks loop() for seconds --
// move deadlines, STOP commands and OTA all stall with it. Dropping it within
// ~2 s keeps its queue short of that. The pong timeout must stay below the
// ping interval, or a fresh ping resets the timer before it can expire. The
// misses are counted per slot, and HeartbeatServer clears them on every
// disconnect so a slot's next client gets the full allowance.
constexpr uint32_t HEARTBEAT_INTERVAL_MS = 1000;
constexpr uint32_t HEARTBEAT_PONG_TIMEOUT_MS = 600;
constexpr uint8_t HEARTBEAT_MISSES_TO_DROP = 2;

constexpr int NO_CLIENT = -1;

}  // namespace

RemoteControl::RemoteControl(Rover& rover, kinematics::ControlScheme& scheme)
    : rover(rover), scheme(scheme), server(tuning::WEBSOCKET_PORT) {}

void RemoteControl::begin() {
  if (started) return;
  server.begin();
  server.onEvent([this](uint8_t client, WStype_t type, uint8_t* payload, size_t length) {
    onEvent(client, type, payload, length);
  });
  server.enableHeartbeat(HEARTBEAT_INTERVAL_MS, HEARTBEAT_PONG_TIMEOUT_MS,
                         HEARTBEAT_MISSES_TO_DROP);
  started = true;
}

void RemoteControl::update(uint32_t now) {
  server.loop();

  if (timing::since(now, lastBroadcastMs) < tuning::TELEMETRY_INTERVAL_MS) return;
  lastBroadcastMs = now;
  if (server.connectedClients() > 0) broadcastTelemetry();
}

void RemoteControl::onEvent(uint8_t client, WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_TEXT:
      onCommand(client, payload, length);
      break;

    case WStype_CONNECTED: {
      const IPAddress remote = server.remoteIP(client);
      Serial.printf("[%u] Connected from %d.%d.%d.%d\n", client, remote[0], remote[1],
                    remote[2], remote[3]);
      break;
    }

    case WStype_DISCONNECTED:
      Serial.printf("[%u] Disconnected\n", client);
      server.forgetMissedPongs(client);  // the slot's next client starts afresh
      if (client == driver) {
        // The operator has lost the ability to steer. Anything other than
        // stopping leaves the rover driving on its last instruction.
        driver = NO_CLIENT;
        rover.stop(millis());
      }
      break;

    default:
      break;
  }
}

void RemoteControl::onCommand(uint8_t client, const uint8_t* payload, size_t length) {
  if (length > MAX_COMMAND_BYTES) {
    Serial.printf("[%u] Ignored a %u-byte message\n", client, static_cast<unsigned>(length));
    return;
  }

  JsonDocument input;
  // Passing the length keeps the parser inside the frame instead of relying
  // on the payload happening to be NUL-terminated.
  const DeserializationError error = deserializeJson(input, payload, length);
  if (error) {
    Serial.printf("[%u] Bad JSON: %s\n", client, error.c_str());
    return;
  }

  const protocol::Message message = protocol::readMessage(input.as<JsonVariantConst>());
  switch (message.kind) {
    case protocol::Message::DRIVE:
      driver = client;
      rover.command(message.command.move, message.command.speed, message.command.durationMs,
                    millis());
      break;
    case protocol::Message::SET_SCHEME:
      scheme = message.scheme;  // takes no control: an exploring rover explores on
      Serial.printf("[%u] Control scheme %s\n", client, protocol::schemeName(scheme));
      break;
    case protocol::Message::IGNORE:
      Serial.printf("[%u] Ignored an unknown control scheme\n", client);
      break;
  }
}

void RemoteControl::broadcastTelemetry() {
  char frame[protocol::TELEMETRY_MAX_BYTES];
  const size_t length = protocol::writeTelemetry(rover.status(), scheme, temperatureRead(), frame, sizeof(frame));
  if (length == 0) {
    // Clients would only see telemetry freeze. Say why once, not every
    // TELEMETRY_INTERVAL_MS.
    static bool reported = false;
    if (!reported) Serial.println("Telemetry outgrew protocol::TELEMETRY_MAX_BYTES: frames that do not fit are not sent.");
    reported = true;
    return;
  }
  server.broadcastTXT(frame, length);
}
