#include "Service.h"

#include "common.h"

WebSocketsServer webSocket = WebSocketsServer(81);

// Static IP configuration. Note that this address is duplicated as
// `upload_port` for the car_ota environment in platformio.ini; change both or
// OTA flashing will silently target the wrong host.
IPAddress ip(192, 168, 0, 115);
IPAddress gateway(192, 168, 0, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(8, 8, 8, 8);
IPAddress secondaryDNS(8, 8, 4, 4);

void Service::setIP() {
  if (!isStaticIp) return;
  if (!WiFi.config(ip, gateway, subnet, primaryDNS, secondaryDNS)) {
    Serial.println("STA Failed to configure");
  }
}

void Service::setHostName() {
  if (!WiFi.setHostname(hostname)) {
    Serial.println("Failed to set hostname");
  }
}

void Service::wsEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_TEXT: {
      JsonDocument input;
      // Passing the length keeps the parser inside the frame instead of
      // relying on the payload happening to be NUL-terminated.
      const DeserializationError error = deserializeJson(input, payload, length);
      if (error) {
        Serial.printf("[%u] Bad JSON: %s\n", num, error.c_str());
        return;
      }
      rover.executeMove(input.as<JsonVariantConst>());
      break;
    }

    case WStype_CONNECTED: {
      IPAddress remote = webSocket.remoteIP(num);
      Serial.printf("[%u] Connected from %d.%d.%d.%d\n", num, remote[0], remote[1],
                    remote[2], remote[3]);
      break;
    }

    case WStype_DISCONNECTED:
      // The operator has lost the ability to steer. Anything other than
      // stopping leaves the rover driving on its last instruction.
      Serial.printf("[%u] Disconnected\n", num);
      rover.stop();
      break;

    default:
      break;
  }
}

void Service::otaService() {
  ArduinoOTA.onStart([]() {
        // A firmware write must not race the motors.
        rover.stop();
        Serial.println("Starting Flash upgrade...");
      })
      .onError([](ota_error_t error) { Serial.printf("Error[%u]: ", error); })
      .onEnd([]() { Serial.println("completed."); })
      .onProgress([](unsigned int progress, unsigned int total) {
        if (total == 0) return;  // guard the division below
        Serial.printf("Progress: %u\n", (progress / (total / 100)));
      });
  ArduinoOTA.begin();
}

void Service::wsService() {
  webSocket.begin();
  webSocket.onEvent(Service::wsEvent);
}

// Attempt to associate, for a bounded time.
//
// This runs during setup() and so is the one place a short delay() is
// tolerable -- nothing is moving yet. It must still be bounded: an earlier
// version looped forever on `WiFi.status() != WL_CONNECTED`, so a wrong
// password meant the board never reached loop() and could not be recovered
// over the air either.
bool Service::connectWifi() {
  setHostName();
  setIP();
  Serial.printf("Connecting to %s\n", ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  for (int attempt = 0; attempt < WIFI_CONNECT_ATTEMPTS; attempt++) {
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\nWireless connected.");
      printWifiStatus();
      return true;
    }
    delay(WIFI_RETRY_DELAY_MS);
    Serial.print(".");
  }

  Serial.println("\nWiFi unavailable; continuing offline.");
  return false;
}

// Non-blocking reconnect. Called from handle(), so it may not wait.
void Service::maintainWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!servicesStarted) startNetworkServices();
    return;
  }

  if (servicesStarted) {
    // The link just dropped. No commands can arrive over a dead link, so the
    // rover must not keep acting on the last one it received.
    Serial.println("WiFi lost.");
    rover.stop();
    servicesStarted = false;
  }

  const unsigned long now = millis();
  if (static_cast<long>(now - lastReconnectMs) < WIFI_RECONNECT_INTERVAL_MS) return;
  lastReconnectMs = now;
  WiFi.reconnect();
}

void Service::startNetworkServices() {
  otaService();
  wsService();
  servicesStarted = true;
  Serial.println("OTA and WebSocket services started.");
}

void Service::printWifiStatus() {
  Serial.println(WiFi.localIP());
  Serial.printf("Hostname: %s\n", WiFi.getHostname());
}

/**
 * Send periodic data as a package
 *  - sonar distance
 *  - Moves
 *  - Mode
 *  - Temperature
 * Future:
 *  - Accelerometer
 *  - Location / Wifi strength
 *  - Voltage / Amperage
 */
void Service::sendData() {
  const unsigned long now = millis();
  if (static_cast<long>(now - lastBroadcastMs) < WS_INTERVAL) return;
  lastBroadcastMs = now;
  String payload = rover.getData();  // broadcastTXT takes String&, needs an lvalue
  webSocket.broadcastTXT(payload);
}

void Service::start() {
  lastBroadcastMs = millis();
  lastReconnectMs = millis();
  if (connectWifi()) startNetworkServices();
}

void Service::handle() {
  maintainWifi();
  if (!servicesStarted) return;

  webSocket.loop();
  ArduinoOTA.handle();
  sendData();
}
