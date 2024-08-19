#include "server.h"

#include <WebSocketsServer.h>

bool isStaticIp = true;

// Static IP configuration
IPAddress local_IP(192, 168, 0, 115);
IPAddress gateway(192, 168, 0, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(8, 8, 8, 8);
IPAddress secondaryDNS(8, 8, 4, 4);

const char* ssid = "Arjun";
const char* password = "Laurie123";
const char* hostname = "car";
WebSocketsServer webSocket = WebSocketsServer(81);

// Function to handle WebSocket events
void webSocketEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.printf("[%u] Disconnected!\n", num);
      break;
    case WStype_CONNECTED: {
      IPAddress ip = webSocket.remoteIP(num);
      Serial.printf("[%u] Connected from %d.%d.%d.%d\n", num, ip[0], ip[1], ip[2], ip[3]);
      webSocket.sendTXT(num, "Hello from ESP32!");
      break;
    }
    case WStype_TEXT:
      Serial.printf("[%u] Received text: %s\n", num, payload);
      // Echo the received message back to the client
      webSocket.sendTXT(num, payload, length);
      break;
  }
}

void setStaticIP() {
  if (isStaticIp) {
    if (!WiFi.config(local_IP, gateway, subnet, primaryDNS, secondaryDNS)) {
      Serial.println("STA Failed to configure");
    }
  }
}

void setHostName() {
  if (!WiFi.setHostname(hostname)) {
    Serial.println("Failed to set hostname");
  }
}

void printWiFiStatus() {
  Serial.printf("Address: %s\n", WiFi.localIP());
  Serial.printf("Hostname: %s\n", WiFi.getHostname());
}

void startOTAService() {
  ArduinoOTA
      .onStart([]() { Serial.println("Starting Flash upgrade..."); })
      .onError([](ota_error_t error) { Serial.printf("Error[%u]: ", error); })
      .onEnd([]() { Serial.println("completed."); })
      .onProgress([](unsigned int progress, unsigned int total) {
        Serial.printf("Progress: %u%%\r", (progress / (total / 100)));
      });
  ArduinoOTA.begin();
}

void startWiFiService() {
  setHostName();
  setStaticIP();
  Serial.printf("Connecting to %s\n", ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("WiFi connected.");
  printWiFiStatus();
}

void serverStart() {
  startWiFiService();
  startOTAService();
}

void serverHandler() {
  webSocket.loop();
  ArduinoOTA.handle();
}