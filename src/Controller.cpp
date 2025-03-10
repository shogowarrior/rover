#include "Controller.h"
#include "common.h"

JsonDocument currDoc;

float Controller::calculateAngle(int x, int y) {
  float angle = atan2(y, -x) * 180 / PI;
  if (angle < 0) {
    angle += 360;
  }
  return angle;
}

int Controller::calculateSpeed(int x, int y, int speed) {
  float magnitude = sqrt(x * x + y * y);
  return map(magnitude, 0, 127, 0, speed);
}

// Left joystick handling
void Controller::getLeftJoyStick(JsonArray array) {
  int lx = Ps3.data.analog.stick.lx;
  int ly = Ps3.data.analog.stick.ly;

  if ((abs(lx) > DEADZONE_THRESHOLD || abs(ly) > DEADZONE_THRESHOLD)) {
    JsonDocument json;
    json["speed"] = calculateSpeed(lx, ly, MAX_SPEED);
    float angle = calculateAngle(lx, ly);
    if (angle >= 0 && angle < 180) {
      json["move"] = MOVE_FORWARD;
    } else if (angle >= 180 && angle < 360) {
      json["move"] = MOVE_BACKWARD;
    }
    array.add(json);
  }
}

// Right joystick handling
void Controller::getRightJoyStick(JsonArray array) {
  int rx = Ps3.data.analog.stick.rx;
  int ry = Ps3.data.analog.stick.ry;

  if (abs(rx) > DEADZONE_THRESHOLD || abs(ry) > DEADZONE_THRESHOLD) {
    JsonDocument json;
    json["speed"] = calculateSpeed(rx, ry, MAX_SPEED);
    float angle = calculateAngle(rx, ry);

    if (angle >= 180 && angle < 270) {
      json["move"] = ROTATE_COUNTERCLOCKWISE;
    } else {
      json["move"] = ROTATE_CLOCKWISE;
    }
    array.add(json);
  }
}

void Controller::getTriggers(JsonArray array) {
  // Trigger control
  int l2 = Ps3.data.analog.button.l2;
  int r2 = Ps3.data.analog.button.r2;
  JsonDocument json;
  if (abs(l2) > DEADZONE_THRESHOLD) {
    json["speed"] = calculateSpeed(l2, 0, MAX_SPEED / 2);
    json["move"] = ROTATE_CLOCKWISE;
    array.add(json);
  } else if (abs(r2) > DEADZONE_THRESHOLD) {
    json["speed"] = calculateSpeed(r2, 0, MAX_SPEED / 2);
    json["move"] = ROTATE_COUNTERCLOCKWISE;
    array.add(json);
  }
}


void controlRover() {
  JsonDocument newDoc;
  JsonArray array = newDoc.to<JsonArray>();

  // Check left joystick
  controller.getLeftJoyStick(array);

  // Right joystick handling for rotation
  // controller.getRighJoyStick(array);
  controller.getTriggers(array);

  // Default to STOP if no other command is set
  if (array.size() == 0) {
    JsonDocument json;
    json["speed"] = 0;
    json["move"] = STOP;
    array.add(json);
  }

  if (array.size() == 1) {
    if (currDoc == array[0] && currDoc["move"] == STOP) return;
    currDoc = array[0];
  }

  for (JsonDocument doc : array) {
    serializeJsonPretty(doc, Serial);
    rover.executeMove(doc);
  }
}

void onConnect() {
  Serial.println("PS3 controller connected!");
}

void Controller::attach() {
  Ps3.attach(controlRover);
  Ps3.attachOnConnect(onConnect);
  Ps3.begin(MAC_ADDRESS);
}

// // Left joystick handling
// void getLeftJoyStick(JsonArray array) {
//   int lx = Ps3.data.analog.stick.lx;
//   int ly = Ps3.data.analog.stick.ly;

//   if ((abs(lx) > DEADZONE_THRESHOLD || abs(ly) > DEADZONE_THRESHOLD)) {
//     JsonDocument json;
//     json["speed"] = calculateSpeed(lx, ly, MAX_SPEED);
//     float angle = calculateAngle(lx, ly);

//     // if (angle >= 337.5 || angle < 22.5) {
//     //   json["move"] = MOVE_RIGHT;
//     // } else if (angle >= 22.5 && angle < 67.5) {
//     //   json["move"] = MOVE_DIAGONAL45;
//     // } else if (angle >= 67.5 && angle < 112.5) {
//     //   json["move"] = MOVE_FORWARD;
//     // } else if (angle >= 112.5 && angle < 157.5) {
//     //   json["move"] = MOVE_DIAGONAL135;
//     // } else if (angle >= 157.5 && angle < 202.5) {
//     //   json["move"] = MOVE_LEFT;
//     // } else if (angle >= 202.5 && angle < 247.5) {
//     //   json["move"] = MOVE_DIAGONAL225;
//     // } else if (angle >= 247.5 && angle < 292.5) {
//     //   json["move"] = MOVE_BACKWARD;
//     // } else if (angle >= 292.5 && angle < 337.5) {
//     //   json["move"] = MOVE_DIAGONAL315;
//     // }

//     if (angle >= 0 && angle < 180) {
//       json["move"] = MOVE_FORWARD;
//     } else if (angle >= 180 && angle < 360) {
//       json["move"] = MOVE_BACKWARD;
//     }
//     array.add(json);
//   }
// }

// void getRightJoyStick(JsonArray array) {
//   int rx = Ps3.data.analog.stick.rx;
//   int ry = Ps3.data.analog.stick.ry;
//    else if (abs(rx_changed) + abs(ry_changed) > 2 &&
//   else if ((abs(rx) > DEADZONE_THRESHOLD || abs(ry) > DEADZONE_THRESHOLD)) {
//     doc["speed"] = calculateSpeed(rx, ry, MAX_SPEED);
//     float angle = calculateAngle(rx, ry);
//     if (angle >= 337.5 || angle < 22.5) {
//       doc["move"] = PIVOT_RIGHT_FORWARD;
//     } else if (angle >= 22.5 && angle < 67.5) {
//       doc["move"] = PIVOT_SIDEWAYS_FORWARD_RIGHT;
//     } else if (angle >= 67.5 && angle < 112.5) {
//       doc["move"] = PIVOT_SIDEWAYS_FORWARD_LEFT;
//     } else if (angle >= 112.5 && angle < 157.5) {
//       doc["move"] = PIVOT_LEFT_FORWARD;
//     } else if (angle >= 157.5 && angle < 202.5) {
//       doc["move"] = PIVOT_LEFT_BACKWARD;
//     } else if (angle >= 202.5 && angle < 247.5) {
//       doc["move"] = PIVOT_SIDEWAYS_BACKWARD_LEFT;
//     } else if (angle >= 247.5 and angle < 292.5) {
//       doc["move"] = PIVOT_RIGHT_BACKWARD;
//     } else if (angle >= 292.5 and angle < 337.5) {
//       doc["move"] = PIVOT_SIDEWAYS_BACKWARD_RIGHT;
//     }
//   }
// }