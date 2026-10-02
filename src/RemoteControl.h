#ifndef REMOTE_CONTROL_H
#define REMOTE_CONTROL_H

#include <WebSocketsServer.h>
#include <stdint.h>

#include "Kinematics.h"
#include "Rover.h"

// WebSocketsServer 2.6.1 never clears a client slot's count of missed pongs
// when the slot is reused: newClient() resets the ping timer but not
// pongTimeoutCount, and only a timely pong zeroes it. A heartbeat drop leaves
// the count at the limit, so the next client in that slot -- usually the same
// phone reconnecting -- was dropped at its first late pong, with no second
// chance, while the operator tried to reach a rover to stop it. Nothing public
// clears the count (enableHeartbeat() does not), so this reaches the library's
// protected client table, and does nothing else.
class HeartbeatServer : public WebSocketsServer {
 public:
  explicit HeartbeatServer(uint16_t port) : WebSocketsServer(port) {}

  // Call on WStype_DISCONNECTED: clientDisconnect() raises it after the last
  // miss is counted and before the slot can be reused.
  void forgetMissedPongs(uint8_t client) {
    if (client < WEBSOCKETS_SERVER_CLIENT_MAX) _clients[client].pongTimeoutCount = 0;
  }
};

// The WebSocket link: drive commands in, telemetry out (Protocol.h has the
// format). Network starts it once WiFi is up and calls update() every loop.
// `scheme` is the rover's one control scheme, shared with the gamepad: a
// client may change it, and telemetry reports it.
class RemoteControl {
 public:
  RemoteControl(Rover& rover, kinematics::ControlScheme& scheme);

  // Start serving. Safe to call again after a WiFi reconnect.
  void begin();

  // Serve clients and broadcast telemetry. Call every loop while online.
  void update(uint32_t now);

 private:
  void onEvent(uint8_t client, WStype_t type, uint8_t* payload, size_t length);
  void onCommand(uint8_t client, const uint8_t* payload, size_t length);
  void broadcastTelemetry();

  Rover& rover;
  kinematics::ControlScheme& scheme;
  HeartbeatServer server;
  bool started = false;
  uint32_t lastBroadcastMs = 0;

  // The client whose commands are driving. Losing it is losing control, so
  // it stops the rover; a telemetry-only listener coming and going does not.
  int driver = -1;
};

#endif
