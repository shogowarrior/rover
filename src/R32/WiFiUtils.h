#ifndef WIFI_UTILS_H
#define WIFI_UTILS_H

#include <WiFi.h>
#include <ArduinoOTA.h>

void connectWiFi();
void printWiFiStatus();
void startOTA();

#endif