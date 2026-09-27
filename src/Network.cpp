#include "Network.h"

#include <ArduinoOTA.h>
#include <WiFi.h>

#include "Features.h"
#include "Tuning.h"
#include "config.h"  // WiFi credentials: gitignored, template in config.example.h

namespace {

// Static IP configuration, used when config.h sets WIFI_IS_STATIC_IP. This
// address is duplicated as `upload_port` for the car_ota environment in
// platformio.ini and as the default host in the clients; change them together.
const IPAddress STATIC_IP(192, 168, 0, 115);
const IPAddress GATEWAY(192, 168, 0, 1);
const IPAddress SUBNET(255, 255, 255, 0);
const IPAddress PRIMARY_DNS(8, 8, 8, 8);
const IPAddress SECONDARY_DNS(8, 8, 4, 4);

}  // namespace

Network::Network(Rover& rover, RemoteControl& remote) : rover(rover), remote(remote) {}

void Network::begin() {
  lastReconnectMs = millis();
  if (connect()) goOnline();
}

void Network::update(uint32_t now) {
  if (WiFi.status() == WL_CONNECTED) {
    if (!online) goOnline();
    ArduinoOTA.handle();
    remote.update(now);
    return;
  }

  if (online) {
    // The link just dropped. No command can reach the rover now -- including
    // STOP -- so it must not carry on with the last one, or keep exploring
    // where nobody can stop it.
    online = false;
    Serial.println("WiFi lost.");
    rover.onLinkLost(now);
  }

  if (static_cast<int32_t>(now - lastReconnectMs) < static_cast<int32_t>(tuning::WIFI_RECONNECT_INTERVAL_MS)) return;
  lastReconnectMs = now;
  WiFi.reconnect();
}

// Attempt to associate, for a bounded time.
//
// This runs during setup() and so is the one place a short delay() is
// tolerable -- nothing is moving yet. It must still be bounded: an earlier
// version looped forever on `WiFi.status() != WL_CONNECTED`, so a wrong
// password meant the board never reached loop() and could not be recovered
// over the air either. Without WiFi the rover carries on offline: it explores
// if it powered on in autonomous mode.
bool Network::connect() {
  if (!WiFi.setHostname(WIFI_HOSTNAME)) Serial.println("Failed to set hostname");
  if (WIFI_IS_STATIC_IP &&
      !WiFi.config(STATIC_IP, GATEWAY, SUBNET, PRIMARY_DNS, SECONDARY_DNS)) {
    Serial.println("STA Failed to configure");
  }
  Serial.printf("Connecting to %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  // Modem sleep holds incoming packets until the next beacon, adding up to a
  // few hundred ms to every command and heartbeat. Bluetooth requires it,
  // so it stays on when the gamepad is compiled in.
  if (!features::GAMEPAD) WiFi.setSleep(false);

  for (int attempt = 0; attempt < tuning::WIFI_CONNECT_ATTEMPTS; attempt++) {
    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("\nWireless connected: %s (%s)\n", WiFi.localIP().toString().c_str(),
                    WiFi.getHostname());
      return true;
    }
    delay(tuning::WIFI_RETRY_DELAY_MS);
    Serial.print(".");
  }

  Serial.println("\nWiFi unavailable; continuing offline.");
  return false;
}

void Network::goOnline() {
  if (!otaStarted) {
    configureOta();
    otaStarted = true;
  }
  remote.begin();
  online = true;
  Serial.println("OTA and WebSocket services up.");
}

void Network::configureOta() {
  // Advertise the configured name over mDNS (rover.local by default) rather
  // than esp32-<mac>. Both setters are ignored once begin() has run.
  ArduinoOTA.setHostname(WIFI_HOSTNAME);
#if defined(OTA_PASSWORD_HASH)
  ArduinoOTA.setPasswordHash(OTA_PASSWORD_HASH);
#elif defined(OTA_PASSWORD)
  ArduinoOTA.setPassword(OTA_PASSWORD);
#endif

  ArduinoOTA
      .onStart([this]() {
        // A firmware write must not race the motors, and it blocks loop()
        // for the whole upload, so keep the loop watchdog fed.
        rover.stop();
        feedLoopWDT();
        Serial.println("Starting Flash upgrade...");
      })
      .onProgress([](unsigned int progress, unsigned int total) {
        feedLoopWDT();
        if (total == 0) return;
        Serial.printf("Progress: %u%%\n", static_cast<unsigned>(static_cast<uint64_t>(progress) * 100 / total));
      })
      .onEnd([]() { Serial.println("completed."); })
      .onError([](ota_error_t error) { Serial.printf("OTA error %u\n", error); });
  ArduinoOTA.begin();
}
