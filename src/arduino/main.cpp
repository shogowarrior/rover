#include <ArduinoJson.h>
#include <HardwareSerial.h>
#include <SoftwareSerial.h>

#include "mecanum/MecanumRobot.h"

MecanumRobot robot;
inline HardwareSerial& usbSerial = Serial;
SoftwareSerial espSerial(SW_UART_RX_PIN, SW_UART_TX_PIN);

unsigned long previousPrintMillis = 0;
void printStatus() {
  unsigned long currentMillis = millis();

  if (currentMillis - previousPrintMillis >= LOG_INTERVAL) {
    previousPrintMillis = currentMillis;
    usbSerial.println("USB: Alive and kicking!!");
  }
}
/';'
JsonDocument getJsonData() {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, espSerial);
  if (error) {
    // Serial.println("COMMAND: " + String(doc["command"].as<int>()));
    // Serial.println("SPEED: " + String(doc["speed"].as<int>()));
    Serial.println("deserializeJson() failed: " + String(error.c_str()));
  }
  return doc;
}

void setup() {
  usbSerial.begin(HW_SERIAL_SPEED);
  espSerial.begin(SW_SERIAL_SPEED);
  robot.initRobot();
}

void loop() {
  printStatus();

  // Check if data is available to read from Serial
  if (espSerial.available() >= 20) {
    JsonDocument command = getJsonData();
    serializeJsonPretty(command, usbSerial);

    robot.executeCommand(command);
  }
}
