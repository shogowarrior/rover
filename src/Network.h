#ifndef NETWORK_H
#define NETWORK_H

#include <stdint.h>

#include "FirmwareUpdate.h"
#include "RemoteControl.h"
#include "Rover.h"

// The WiFi station link and ArduinoOTA, and the failsafe for losing them.
// Starts RemoteControl once the link is up, and hands both update paths,
// ArduinoOTA and `firmware`, the one OTA password.
class Network {
 public:
  Network(Rover& rover, RemoteControl& remote, FirmwareUpdate& firmware);

  // setup() only: waits up to ~10 s for WiFi, then carries on offline.
  void begin();

  // Every loop: notices the link dropping and returning, retries without
  // waiting, and serves OTA and the WebSocket link while online.
  void update(uint32_t now);

 private:
  bool connect();
  void goOnline(uint32_t now);
  bool updatesOpen(uint32_t now);
  void configureOta();

  Rover& rover;
  RemoteControl& remote;
  FirmwareUpdate& firmware;
  bool online = false;
  bool otaStarted = false;
  uint32_t lastReconnectMs = 0;
  bool onTrial = false;  // the running image is new, and not yet kept
  uint32_t onlineSinceMs = 0;
  bool updatesOpened = false;
};

#endif
