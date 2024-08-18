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
      // Send a welcome message to the client
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
  Serial.println("IP address: ");
  Serial.println(WiFi.localIP());
}

void startOTAService() {
  ArduinoOTA
      .onStart([]() {
        String type;
        if (ArduinoOTA.getCommand() == U_FLASH) {
          type = "sketch";
        } else {  // U_SPIFFS
          type = "filesystem";
        }
        Serial.println("Start updating " + type);
      })
      .onEnd([]() {
        Serial.println("\nEnd");
      })
      .onProgress([](unsigned int progress, unsigned int total) {
        Serial.printf("Progress: %u%%\r", (progress / (total / 100)));
      })
      .onError([](ota_error_t error) {
        Serial.printf("Error[%u]: ", error);
        if (error == OTA_AUTH_ERROR) {
          Serial.println("Auth Failed");
        } else if (error == OTA_BEGIN_ERROR) {
          Serial.println("Begin Failed");
        } else if (error == OTA_CONNECT_ERROR) {
          Serial.println("Connect Failed");
        } else if (error == OTA_RECEIVE_ERROR) {
          Serial.println("Receive Failed");
        } else if (error == OTA_END_ERROR) {
          Serial.println("End Failed");
        }
      });
  ArduinoOTA.begin();
}

void serverStart() {
  Serial.printf("Connecting to %s\n", ssid);
  setHostName();
  setStaticIP();
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("WiFi connected.");
  printWiFiStatus();
  startOTAService();
}

void serverHandler() {
  webSocket.loop();
  ArduinoOTA.handle();
}