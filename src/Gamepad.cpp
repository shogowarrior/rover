#include "Gamepad.h"

#include <Arduino.h>

#include "Features.h"
#include "Tuning.h"

#if ROVER_ENABLE_GAMEPAD
#include <Ps3Controller.h>

namespace {

// The mailbox between the Bluetooth task and the loop task.
portMUX_TYPE mailboxLock = portMUX_INITIALIZER_UNLOCKED;
kinematics::GamepadState latestControls = {0, 0, 0, 0};
uint32_t lastReportMs = 0;
bool hasReport = false;
bool startPressed = false;  // latched until update() consumes it

// Ps3.attach() takes a plain function pointer, and calls it on the Bluetooth
// task for every report the pad sends. Copy, and touch nothing else.
void onReport() {
  const uint32_t now = millis();
  portENTER_CRITICAL(&mailboxLock);
  latestControls.lx = Ps3.data.analog.stick.lx;
  latestControls.ly = Ps3.data.analog.stick.ly;
  latestControls.l2 = Ps3.data.analog.button.l2;
  latestControls.r2 = Ps3.data.analog.button.r2;
  if (Ps3.event.button_down.start) startPressed = true;
  lastReportMs = now;
  hasReport = true;
  portEXIT_CRITICAL(&mailboxLock);
}

void onConnect() { Serial.println("PS3 controller connected."); }

}  // namespace

Gamepad::Gamepad(Rover& rover) : rover(rover) {}

void Gamepad::begin(const char* hostMac) {
  Ps3.attach(onReport);
  Ps3.attachOnConnect(onConnect);
  Ps3.begin(hostMac);
  started = true;
}

void Gamepad::update(uint32_t now) {
  if (!started) return;

  kinematics::GamepadState controls;
  bool fresh;
  bool resume;
  portENTER_CRITICAL(&mailboxLock);
  controls = latestControls;
  fresh = hasReport && static_cast<int32_t>(now - lastReportMs) < static_cast<int32_t>(tuning::GAMEPAD_SILENCE_MS);
  resume = startPressed;
  startPressed = false;
  portEXIT_CRITICAL(&mailboxLock);

  if (resume) {
    rover.command(RESUME_AUTONOMOUS, 0, 0, now);
    driving = false;
    lastSent = {STOP, 0};
    return;
  }

  // A pad that has stopped reporting is treated as released. The library
  // never reports a disconnect, so silence is the only sign it has gone.
  const kinematics::DriveRequest wanted =
      fresh ? kinematics::translateGamepad(controls, tuning::GAMEPAD_DEADZONE, tuning::GAMEPAD_MAX_SPEED)
            : kinematics::DriveRequest{STOP, 0};

  if (wanted.move == STOP) {
    // One STOP on release, never a stream of them: a resting pad must not
    // keep forcing manual mode while the rover explores.
    if (driving) rover.command(STOP, 0, 0, now);
    driving = false;
    lastSent = wanted;
    return;
  }

  const bool changed = wanted.move != lastSent.move || wanted.speed != lastSent.speed;
  if (!changed && static_cast<int32_t>(now - lastSentMs) < static_cast<int32_t>(tuning::GAMEPAD_REFRESH_MS)) return;

  rover.command(wanted.move, wanted.speed, tuning::DEFAULT_MOVE_DURATION_MS, now);
  lastSent = wanted;
  lastSentMs = now;
  driving = true;
}

#else  // gamepad support not compiled in

Gamepad::Gamepad(Rover& rover) : rover(rover) {}

void Gamepad::begin(const char*) {
  Serial.println("Gamepad support is not compiled in; build car_wire_gamepad.");
}

void Gamepad::update(uint32_t) {}

#endif
