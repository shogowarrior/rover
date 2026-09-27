#ifndef REMOTE_CONTROL_H
#define REMOTE_CONTROL_H

#include <WebSocketsServer.h>
#include <stdint.h>

#include "Kinematics.h"
#include "Rover.h"

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
  WebSocketsServer server;
  bool started = false;
  uint32_t lastBroadcastMs = 0;

  // The client whose commands are driving. Losing it is losing control, so
  // it stops the rover; a telemetry-only listener coming and going does not.
  int driver = -1;
};

#endif
