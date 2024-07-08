// void MecanumRobot::rampSpeed(MotorParams motorParams[], int duration) {
//   int numMotors = 4;
//   for (int i = 0; i < numMotors; i++) {
//     runMotor(motorParams[i]);
//   }

//   // int currentSpeeds[numMotors];
//   // int speedSteps[numMotors];

//   // // Ramp up to target speed
//   // for (int i = 0; i < numMotors; i++) {
//   //   currentSpeeds[i] = 0;  // Assuming initial speed is 0
//   //   speedSteps[i] = motorParams[i].speed / (duration / 10);
//   // }

//   // for (int step = 0; step < (duration / 10); step++) {
//   //   for (int i = 0; i < numMotors; i++) {
//   //     currentSpeeds[i] += speedSteps[i];
//   //     runMotor(motorParams[i], currentSpeeds[i]);
//   //   }
//   //   delay(10);
//   // }

//   // // Maintain max speed for the specified duration
//   // delay(duration);

//   // // Ramp down to zero speed
//   // for (int step = 0; step < (duration / 10); step++) {
//   //   for (int i = 0; i < numMotors; i++) {
//   //     currentSpeeds[i] -= speedSteps[i];
//   //     runMotor(motorParams[i], currentSpeeds[i]);
//   //   }
//   //   delay(10);
//   // }

//   // // Ensure all motors stop
//   // for (int i = 0; i < numMotors; i++) {
//   //   motorParams[i].motor->setSpeed(0);
//   //   motorParams[i].motor->run(RELEASE);
//   // }
// }