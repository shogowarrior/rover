#include "Service.h"

#include "common.h"

unsigned long previousMillis = millis();
WebSocketsServer webSocket = WebSocketsServer(81);

// Static IP configuration
IPAddress ip(192, 168, 0, 115);
IPAddress gateway(192, 168, 0, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(8, 8, 8, 8);
IPAddress secondaryDNS(8, 8, 4, 4);

void Service::setIP() {
  if (isStaticIp) {
    if (!WiFi.config(ip, gateway, subnet, primaryDNS, secondaryDNS)) {
      Serial.println("STA Failed to configure");
    }
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
      deserializeJson(input, payload);
      rover.executeMove(input);
      break;
    }
    case WStype_CONNECTED: {
      IPAddress ip = webSocket.remoteIP(num);
      Serial.printf("[%u] Connected from %d.%d.%d.%d\n", num, ip[0], ip[1], ip[2], ip[3]);
      break;
    }
    case WStype_DISCONNECTED:
      break;
  }
}

void Service::otaService() {
  ArduinoOTA
      .onStart([]() { Serial.println("Starting Flash upgrade..."); })
      .onError([](ota_error_t error) { Serial.printf("Error[%u]: ", error); })
      .onEnd([]() { Serial.println("completed."); })
      .onProgress([](unsigned int progress, unsigned int total) {
        Serial.printf("Progress: %u%%\r", (progress / (total / 100)));
      });
  ArduinoOTA.begin();
}

void Service::wifiService() {
  setHostName();
  setIP();
  Serial.printf("Connecting to %s\n", ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWireless connected.");
  printWifiStatus();
}

void Service::wsService() {
  webSocket.begin();
  webSocket.onEvent(Service::wsEvent);
}

void Service::printWifiStatus() {
  Serial.println(WiFi.localIP());
  Serial.printf("Hostname: %s\n", WiFi.getHostname());
}

/**
 * Send periodic data as a package
 *  - sonar distance
 *  - Moves
 *  - Location
 *  - Wifi Strength
 * Future:
 *  - Accelerometer
 *  - Temparature
 *  - Voltage / Amperage
 */
void Service::sendData() {
  unsigned long currentMillis = millis();
  if (currentMillis - previousMillis >= WS_INTERVAL) {
    previousMillis = currentMillis;
    String roverData = rover.getData();
    webSocket.broadcastTXT(roverData);
  }
}

void Service::start() {
  wifiService();
  otaService();
  wsService();
}

void Service::handle() {
  webSocket.loop();
  ArduinoOTA.handle();
  sendData();
}