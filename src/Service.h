#ifndef SERVICE_H
#define SERVICE_H

#pragma once

#include <WiFi.h>
#include <ArduinoOTA.h>
#include <WebSocketsServer.h>

class Service {
 private:
  const char* ssid = "Arjun";
  const char* password = "Laurie123";
  const char* hostname = "car";
  const bool isStaticIp = true;

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