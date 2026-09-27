#ifndef NETWORK_H
#define NETWORK_H

#include <stdint.h>

#include "RemoteControl.h"
#include "Rover.h"

// The WiFi station link and ArduinoOTA, and the failsafe for losing them.
// Starts RemoteControl once the link is up.
class Network {
 public:
  Network(Rover& rover, RemoteControl& remote);

  // setup() only: waits up to ~10 s for WiFi, then carries on offline.
  void begin();

  // Every loop: notices the link dropping and returning, retries without
  // waiting, and serves OTA and the WebSocket link while online.
  void update(uint32_t now);

 private:
  bool connect();
  void goOnline();
  void configureOta();

  Rover& rover;
  RemoteControl& remote;
  bool online = false;
  bool otaStarted = false;
  uint32_t lastReconnectMs = 0;
};

#endif
