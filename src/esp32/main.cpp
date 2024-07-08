#include <ArduinoJson.h>
#include <Ps3Controller.h>
#include <SPI.h>

#include "common/commands.h"
// #include "WiFiUtils.h"

JsonDocument currentDoc;
inline HardwareSerial &usbSerial = Serial;
HardwareSerial espSerial(2);  // Serial1
unsigned long previousMillis = 0;

void onConnect() {
  usbSerial.println("connected!");
}

float calculateAngle(int x, int y) {
  float angle = atan2(y, -x) * 180 / PI;
  if (angle < 0) {
    angle += 360;
  }
  return angle;
}

int calculateSpeed(int x, int y, int speed) {
  float magnitude = sqrt(x * x + y * y);
  return map(magnitude, 0, 127, 0, speed);
}

void controlMecanum() {
  JsonDocument doc;

  // Left joystick control
  int lx = Ps3.data.analog.stick.lx;
  int ly = Ps3.data.analog.stick.ly;

  // Right joystick control
  int rx = Ps3.data.analog.stick.rx;
  int ry = Ps3.data.analog.stick.ry;

  // Trigger control
  int l2 = Ps3.data.analog.button.l2;
  int r2 = Ps3.data.analog.button.r2;

  // Left joystick handling
  if ((abs(lx) > DEADZONE_THRESHOLD || abs(ly) > DEADZONE_THRESHOLD)) {
    doc["speed"] = calculateSpeed(lx, ly, LIMIT_SPEED);
    float angle = calculateAngle(lx, ly);

    if (angle >= 337.5 || angle < 22.5) {
      doc["command"] = MOVE_RIGHT;
    } else if (angle >= 22.5 && angle < 67.5) {
      doc["command"] = MOVE_DIAGONAL45;
    } else if (angle >= 67.5 && angle < 112.5) {
      doc["command"] = MOVE_FORWARD;
    } else if (angle >= 112.5 && angle < 157.5) {
      doc["command"] = MOVE_DIAGONAL135;
    } else if (angle >= 157.5 && angle < 202.5) {
      doc["command"] = MOVE_LEFT;
    } else if (angle >= 202.5 && angle < 247.5) {
      doc["command"] = MOVE_DIAGONAL225;
    } else if (angle >= 247.5 && angle < 292.5) {
      doc["command"] = MOVE_BACKWARD;
    } else if (angle >= 292.5 && angle < 337.5) {
      doc["command"] = MOVE_DIAGONAL315;
    }
  }
  // Right joystick handling for rotation
  else if (abs(rx) > DEADZONE_THRESHOLD || abs(ry) > DEADZONE_THRESHOLD) {
    doc["speed"] = calculateSpeed(rx, ry, LIMIT_SPEED);
    float angle = calculateAngle(rx, ry);

    if (angle >= 180 && angle < 270) {
      doc["command"] = ROTATE_COUNTERCLOCKWISE;
    } else {
      doc["command"] = ROTATE_CLOCKWISE;
    }
  }
  else if (abs(l2)> DEADZONE_THRESHOLD) {
    doc["speed"] = calculateSpeed(l2, LIMIT_SPEED);
    doc["command"] = ROTATE_COUNTERCLOCKWISE;
  }
  else if(abs(r2) > DEADZONE_THRESHOLD) {
    doc["speed"] = calculateSpeed(r2, LIMIT_SPEED);
    doc["command"] = ROTATE_CLOCKWISE;
  }
  // Default to STOP if no other command is set
  else {
    doc["speed"] = 0;
    doc["command"] = STOP;
  }

  unsigned long currentMillis = millis();
  if (currentMillis - previousMillis >= CONTROL_INTERVAL) {
    previousMillis = currentMillis;
    if (currentDoc != doc) {
      currentDoc = doc;
      serializeJson(currentDoc, espSerial);
    }
  }
}

void setup() {
  usbSerial.begin(HW_SERIAL_SPEED);
  espSerial.begin(SW_SERIAL_SPEED);

  Ps3.attach(controlMecanum);
  Ps3.attachOnConnect(onConnect);
  Ps3.begin(MAC_ADDRESS);
  usbSerial.println("Ready.");

  // connectWiFi();
  // startWebServer();
}

void loop() {
}
