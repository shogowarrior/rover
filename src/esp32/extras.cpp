  // // Right joystick handling
  // // else if (abs(rx_changed) + abs(ry_changed) > 2 &&
  // else if ((abs(rx) > DEADZONE_THRESHOLD || abs(ry) > DEADZONE_THRESHOLD)) {
  //   doc["speed"] = calculateSpeed(rx, ry, LIMIT_SPEED);
  //   float angle = calculateAngle(rx, ry);

  //   if (angle >= 337.5 || angle < 22.5) {
  //     doc["command"] = PIVOT_RIGHT_FORWARD;
  //   } else if (angle >= 22.5 && angle < 67.5) {
  //     doc["command"] = PIVOT_SIDEWAYS_FORWARD_RIGHT;
  //   } else if (angle >= 67.5 && angle < 112.5) {
  //     doc["command"] = PIVOT_SIDEWAYS_FORWARD_LEFT;
  //   } else if (angle >= 112.5 && angle < 157.5) {
  //     doc["command"] = PIVOT_LEFT_FORWARD;
  //   } else if (angle >= 157.5 && angle < 202.5) {
  //     doc["command"] = PIVOT_LEFT_BACKWARD;
  //   } else if (angle >= 202.5 && angle < 247.5) {
  //     doc["command"] = PIVOT_SIDEWAYS_BACKWARD_LEFT;
  //   } else if (angle >= 247.5 and angle < 292.5) {
  //     doc["command"] = PIVOT_RIGHT_BACKWARD;
  //   } else if (angle >= 292.5 and angle < 337.5) {
  //     doc["command"] = PIVOT_SIDEWAYS_BACKWARD_RIGHT;
  //   }
  // }