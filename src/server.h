#ifndef WIFI_UTILS_H
#define WIFI_UTILS_H

#include <WiFi.h>
#include <ArduinoOTA.h>

void serverStart();
void printWiFiStatus();
void serverHandler();

#endif