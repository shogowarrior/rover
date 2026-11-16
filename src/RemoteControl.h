#ifndef REMOTE_CONTROL_H
#define REMOTE_CONTROL_H

#include <WebSocketsServer.h>
#include <stdint.h>

#include "EventLog.h"
#include "FirmwareUpdate.h"
#include "Gamepad.h"
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
// this computer or the local network (protocol::originAllowed(), which says
// what that does not stop): the library checks no Origin, so any web page
// the operator had open could drive the rover.
class HeartbeatServer : public WebSocketsServer {
 public:
  explicit HeartbeatServer(uint16_t port) : WebSocketsServer(port) {}

  // Call on WStype_DISCONNECTED and on WStype_CONNECTED. The disconnect
  // clears the count before the slot can be reused, but when frame handling
  // drops a client, the library still runs that slot's heartbeat check in
  // the same pass, which can count a miss after the clear; the connect
  // clears that too (RemoteControl.cpp).
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

// The WebSocket link: drive commands and settings in; telemetry, the
// EventLog's lines and the rover's metrics out; and firmware updates
// (Protocol.h has the format). Network starts it once WiFi is up and calls
// update() every loop. `scheme` is the rover's one control scheme, shared
// with the gamepad: a client may change it, and telemetry reports it.
//
// Each client is sent every log line, from the oldest still held when it
// connected, one at a time and paced so that a backlog never holds the
// loop; one that falls a whole ring behind loses the lines in between, and
// sees the gap in their numbers.
class RemoteControl {
 public:
  RemoteControl(Rover& rover, kinematics::ControlScheme& scheme, FirmwareUpdate& firmware, Gamepad& gamepad,
                EventLog& log);

  // Start serving. Safe to call again after a WiFi reconnect.
  void begin();

  // Serve clients; send telemetry, new log lines and metrics; and move a
  // firmware update on, restarting into the new image once it is due. Call
  // every loop while online, with loop()'s `now`: the gaps between calls
  // are the loop's timing, for the metrics.
  void update(uint32_t now);

 private:
  void onEvent(uint8_t client, WStype_t type, uint8_t* payload, size_t length);
  void onCommand(uint8_t client, const uint8_t* payload, size_t length);
  void onUpdateRequest(uint8_t client, const protocol::OtaRequest& request);
  void send(const FirmwareUpdate::Reply& reply);
  void broadcastTelemetry();
  void sendLogLines(uint32_t now);
  void broadcastMetrics(uint32_t now);
  // Log that `client` sent something ignored, once per connection, so a
  // client that sends nothing else cannot flood the log.
  void noteIgnored(uint8_t client, const char* what);

  Rover& rover;
  kinematics::ControlScheme& scheme;
  FirmwareUpdate& firmware;
  Gamepad& gamepad;
  EventLog& log;
  HeartbeatServer server;
  bool started = false;
  uint32_t lastBroadcastMs = 0;

  // Per client slot: connected, the number of the next log line it needs
  // and when it was sent the last, and whether something it sent was
  // ignored already this connection.
  bool connected[WEBSOCKETS_SERVER_CLIENT_MAX] = {};
  uint32_t nextLine[WEBSOCKETS_SERVER_CLIENT_MAX] = {};
  uint32_t lastLineMs[WEBSOCKETS_SERVER_CLIENT_MAX] = {};
  bool ignoredOnce[WEBSOCKETS_SERVER_CLIENT_MAX] = {};

  // The loop's timing since the last metrics.
  uint32_t lastUpdateMs = 0;
  uint32_t passes = 0;
  uint32_t longestPassMs = 0;
  uint32_t lastMetricsMs = 0;

  static constexpr int NO_CLIENT = -1;

  // The client whose commands are driving. Losing it is losing control, so
  // it stops the rover; a telemetry-only listener coming and going does not.
  int driver = NO_CLIENT;
};

#endif
