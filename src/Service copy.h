#ifndef SERVICE_H
#define SERVICE_H

#pragma once

#include "config.h"
#include <WiFi.h>
#include <ArduinoOTA.h>
#include <WebSocketsServer.h>

class Service {
 private:
 const char* ssid = WIFI_SSID;
 const char* password = WIFI_PASSWORD;
 const char* hostname = WIFI_HOSTNAME;
 const bool isStaticIp = WIFI_IS_STATIC_IP;

  void otaService();
  void wifiService();
  void wsService();
  void setHostName();
  void setIP();
  static void wsEvent(uint8_t, WStype_t, uint8_t*, size_t);

 public:
  void start();
  void handle();
  void sendData();
  void printWifiStatus();
};

#endif