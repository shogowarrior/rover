#include "common.h"

// Gamepad input path.
//
// This is compiled but not attached by default -- main.cpp does not call
// attach(). Pairing requires the controller's Bluetooth MAC to match
// PS3_MAC_ADDRESS.

Controller::Command Controller::fromLeftStick() const {
  const int lx = Ps3.data.analog.stick.lx;
  const int ly = Ps3.data.analog.stick.ly;

  if (abs(lx) <= DEADZONE_THRESHOLD && abs(ly) <= DEADZONE_THRESHOLD) {
    return {STOP, 0};
  }

  const int speed = kinematics::stickSpeed(lx, ly, CONTROLLER_MAX_SPEED);
  const float angle = kinematics::stickAngleDeg(lx, ly);

  // NOTE: unverified against hardware. The PS3 stick's Y axis is inverted
  // (pushing up reports negative), so this mapping may well have forward and
  // backward the wrong way round. Check on the bench before trusting it.
  return {angle < 180.0f ? MOVE_FORWARD : MOVE_BACKWARD, speed};
}

Controller::Command Controller::fromTriggers() const {
  const int l2 = Ps3.data.analog.button.l2;
  const int r2 = Ps3.data.analog.button.r2;

  if (abs(l2) > DEADZONE_THRESHOLD) {
    return {ROTATE_CLOCKWISE, kinematics::stickSpeed(l2, 0, CONTROLLER_MAX_SPEED / 2)};
  }
  if (abs(r2) > DEADZONE_THRESHOLD) {
    return {ROTATE_COUNTERCLOCKWISE, kinematics::stickSpeed(r2, 0, CONTROLLER_MAX_SPEED / 2)};
  }
  return {STOP, 0};
}

Controller::Command Controller::readGamepad() const {
  // The stick wins over the triggers when both are deflected. The rover can
  // only execute one move at a time, and an earlier version that collected
  // several into an array simply ran them back to back, so the last one won
  // after the others had each briefly twitched the wheels.
  const Command stick = fromLeftStick();
  if (stick.move != STOP) return stick;
  return fromTriggers();
}

namespace {

// Ps3.attach takes a plain function pointer, so this cannot be a member.
void onGamepadUpdate() {
  static Controller::Command previous = {STOP, 0};

  const Controller::Command next = controller.readGamepad();
  if (next.move == previous.move && next.speed == previous.speed) return;
  previous = next;

  rover.command(next.move, next.speed, MOVE_DURATION);
}

void onGamepadConnect() { Serial.println("PS3 controller connected!"); }

}  // namespace

void Controller::attach() {
  Ps3.attach(onGamepadUpdate);
  Ps3.attachOnConnect(onGamepadConnect);
  Ps3.begin(PS3_MAC_ADDRESS);
}
