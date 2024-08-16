#include "WiFiUtils.h"
#include "mecanum/controller.h"
#include "mecanum/commands.h"
// #include <Ultrasonic.h>

unsigned long previousMillis = 0;

void printStatus() {
  unsigned long currentMillis = millis();

  if (currentMillis - previousMillis >= LOG_INTERVAL) {
    previousMillis = currentMillis;
    Serial.println("Ping...");
  }
}

void setup() {
  Serial.begin(HW_SERIAL_SPEED);
  connectWiFi();
  startOTA();
  // startWebServer();

  // ultrasonic.setTimeout(40000UL);
  attachController();
}

void loop() {
  ArduinoOTA.handle();
  // printStatus();

  // Ultrasonic ultrasonic(13, 12);
  // usbSerial.print("Distance in CM: ");
  // usbSerial.println(ultrasonic.read());
  // delay(1000);
}
