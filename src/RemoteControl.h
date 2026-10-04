#ifndef REMOTE_CONTROL_H
#define REMOTE_CONTROL_H

#include <WebSocketsServer.h>
#include <stdint.h>

#include "FirmwareUpdate.h"
#include "Kinematics.h"
#include "Protocol.h"
#include "Rover.h"

// WebSocketsServer 2.6.1 never clears a client slot's count of missed pongs
// when the slot is reused: newClient() resets the ping timer but not
// pongTimeoutCount, and only a timely pong zeroes it. The library also
// charges every new client one miss 600 ms after accept, before its first
// ping. So any disconnect with a miss counted (a heartbeat drop leaves two)
// doomed the slot's next client -- usually the same phone reconnecting, as a
// new client takes the lowest free slot -- to be dropped about 0.6 s after
// connecting, every time, whatever its link, and the count kept climbing
// until reboot, while the operator tried to reach a rover to stop it.
// Nothing public clears the count (enableHeartbeat() does not), so this
// reaches the library's protected client table.
//
// It also refuses the handshake of a browser page from anywhere but a file,
// this computer or the local network (protocol::originAllowed()): the
// library checks no Origin, so any web page the operator had open could
// drive the rover or replace its firmware.
class HeartbeatServer : public WebSocketsServer {
 public:
  explicit HeartbeatServer(uint16_t port) : WebSocketsServer(port) {}

  // Call on WStype_DISCONNECTED: clientDisconnect() raises it after the last
  // miss is counted and before the slot can be reused. And on
  // WStype_CONNECTED (RemoteControl.cpp says why).
  void forgetMissedPongs(uint8_t client) {
    if (client < WEBSOCKETS_SERVER_CLIENT_MAX) _clients[client].pongTimeoutCount = 0;
  }

 protected:
  // The library asks this of every handshake header but its own; false
  // refuses the connection.
  bool execHttpHeaderValidation(String headerName, String headerValue) override {
    return !headerName.equalsIgnoreCase("Origin") || protocol::originAllowed(headerValue.c_str());
  }
};

// The WebSocket link: drive commands in, telemetry out, and firmware updates
// (Protocol.h has the format). Network starts it once WiFi is up and calls
// update() every loop. `scheme` is the rover's one control scheme, shared
// with the gamepad: a client may change it, and telemetry reports it.
class RemoteControl {
 public:
  RemoteControl(Rover& rover, kinematics::ControlScheme& scheme, FirmwareUpdate& firmware);

  // Start serving. Safe to call again after a WiFi reconnect.
  void begin();

  // Serve clients and broadcast telemetry, and move a firmware update on,
  // restarting into the new image once it is due. Call every loop while
  // online.
  void update(uint32_t now);

 private:
  void onEvent(uint8_t client, WStype_t type, uint8_t* payload, size_t length);
  void onCommand(uint8_t client, const uint8_t* payload, size_t length);
  void onUpdateRequest(uint8_t client, const protocol::OtaRequest& request);
  void send(const FirmwareUpdate::Reply& reply);
  void broadcastTelemetry();

  Rover& rover;
  kinematics::ControlScheme& scheme;
  FirmwareUpdate& firmware;
  HeartbeatServer server;
  bool started = false;
  uint32_t lastBroadcastMs = 0;

  static constexpr int NO_CLIENT = -1;

  // The client whose commands are driving. Losing it is losing control, so
  // it stops the rover; a telemetry-only listener coming and going does not.
  int driver = NO_CLIENT;
};

#endif
