#include <ArduinoJson.h>
#include <Ps3Controller.h>

#include "MecanumRobot.h"
#include "commands.h"

MecanumRobot robot;
JsonDocument currDoc;

void onConnect() {
  Serial.println("PS3 controller connected!");
  robot.initRobot();
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

// Left joystick handling
void getLeftJoyStick(JsonArray array) {
  int lx = Ps3.data.analog.stick.lx;
  int ly = Ps3.data.analog.stick.ly;

  if ((abs(lx) > DEADZONE_THRESHOLD || abs(ly) > DEADZONE_THRESHOLD)) {
    JsonDocument json;
    json["speed"] = calculateSpeed(lx, ly, LIMIT_SPEED);
    float angle = calculateAngle(lx, ly);

    // if (angle >= 337.5 || angle < 22.5) {
    //   json["command"] = MOVE_RIGHT;
    // } else if (angle >= 22.5 && angle < 67.5) {
    //   json["command"] = MOVE_DIAGONAL45;
    // } else if (angle >= 67.5 && angle < 112.5) {
    //   json["command"] = MOVE_FORWARD;
    // } else if (angle >= 112.5 && angle < 157.5) {
    //   json["command"] = MOVE_DIAGONAL135;
    // } else if (angle >= 157.5 && angle < 202.5) {
    //   json["command"] = MOVE_LEFT;
    // } else if (angle >= 202.5 && angle < 247.5) {
    //   json["command"] = MOVE_DIAGONAL225;
    // } else if (angle >= 247.5 && angle < 292.5) {
    //   json["command"] = MOVE_BACKWARD;
    // } else if (angle >= 292.5 && angle < 337.5) {
    //   json["command"] = MOVE_DIAGONAL315;
    // }

    if (angle >= 0 && angle < 180) {
      json["command"] = MOVE_FORWARD;
    } else if (angle >= 180 && angle < 360) {
      json["command"] = MOVE_BACKWARD;
    }

    array.add(json);
  }
}

// Right joystick handling
void getRightJoyStick(JsonArray array) {
  int rx = Ps3.data.analog.stick.rx;
  int ry = Ps3.data.analog.stick.ry;

  if (abs(rx) > DEADZONE_THRESHOLD || abs(ry) > DEADZONE_THRESHOLD) {
    JsonDocument json;
    json["speed"] = calculateSpeed(rx, ry, LIMIT_SPEED);
    float angle = calculateAngle(rx, ry);

    if (angle >= 180 && angle < 270) {
      json["command"] = ROTATE_COUNTERCLOCKWISE;
    } else {
      json["command"] = ROTATE_CLOCKWISE;
    }
    array.add(json);
  }
}

void getTriggers(JsonArray array) {
  // Trigger control
  int l2 = Ps3.data.analog.button.l2;
  int r2 = Ps3.data.analog.button.r2;
  JsonDocument json;
  if (abs(l2) > DEADZONE_THRESHOLD) {
    json["speed"] = calculateSpeed(l2, 0, LIMIT_SPEED / 2);
    json["command"] = ROTATE_CLOCKWISE;
    array.add(json);
  } else if (abs(r2) > DEADZONE_THRESHOLD) {
    json["speed"] = calculateSpeed(r2, 0, LIMIT_SPEED / 2);
    json["command"] = ROTATE_COUNTERCLOCKWISE;
    array.add(json);
  }
}

void controlMecanum() {
  JsonDocument newDoc;
  JsonArray array = newDoc.to<JsonArray>();

  // Check left joystick
  getLeftJoyStick(array);

  // Right joystick handling for rotation
  // getRighJoyStick(array);
  getTriggers(array);

  // Default to STOP if no other command is set
  if (array.size() == 0) {
    JsonDocument json;
    json["speed"] = 0;
    json["command"] = STOP;
    array.add(json);
  }

  if (array.size() == 1) {
    if (currDoc == array[0] && currDoc["command"] == STOP) return;
    currDoc = array[0];
  }

  for (JsonDocument doc : array) {
    serializeJsonPretty(doc, Serial);
    robot.executeCommand(doc);
  }
}

void attachController() {
  Ps3.attach(controlMecanum);
  Ps3.attachOnConnect(onConnect);
  Ps3.begin(MAC_ADDRESS);
}