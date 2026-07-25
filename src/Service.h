#ifndef SERVICE_H
#define SERVICE_H

#include <ArduinoOTA.h>
#include <WebSocketsServer.h>
#include <WiFi.h>

#include "config.h"

class Service {
 public:
  void start();
  void handle();
  void sendData();
  void printWifiStatus();

 private:
  const char* ssid = WIFI_SSID;
  const char* password = WIFI_PASSWORD;
  const char* hostname = WIFI_HOSTNAME;
  const bool isStaticIp = WIFI_IS_STATIC_IP;

  // Set once the network services are running. They cannot be started before
  // WiFi is up, and WiFi may not come up until long after setup() -- or ever.
  bool servicesStarted = false;

  unsigned long lastBroadcastMs = 0;
  unsigned long lastReconnectMs = 0;

  bool connectWifi();
  void maintainWifi();
  void startNetworkServices();
  void otaService();
  void wsService();
  void setHostName();
  void setIP();
  static void wsEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length);
};

#endif
