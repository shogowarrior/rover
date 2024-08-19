#ifndef SERVICE_H
#define SERVICE_H

#pragma once

#include <ArduinoOTA.h>
#include <WebSocketsServer.h>
#include <WiFi.h>

class Service {
 private:
  const char* ssid = "Arjun";
  const char* password = "Laurie123";
  const char* hostname = "car";
  const bool isStaticIp = true;
  WebSocketsServer webSocket = WebSocketsServer(81);

  void otaService();
  void wifiService();
  void setHostName();
  void setIP();
  void wsEvent(uint8_t, WStype_t, uint8_t*, size_t);

 public:
  void start();
  void handle();
  void sendData();
  void printWifiStatus();
};

#endif