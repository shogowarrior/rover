#include "Gamepad.h"

#include <Arduino.h>

#include "Features.h"
#include "Timing.h"
#include "Tuning.h"

Gamepad::Gamepad(Rover& rover, kinematics::ControlScheme& scheme)
    : scheme(scheme), session(rover, scheme) {}

#if ROVER_ENABLE_GAMEPAD
#include <Ps3Controller.h>

namespace {

// The mailbox between the Bluetooth task and the loop task: the one piece of
// global state outside main.cpp, forced by Ps3.attach() taking a plain
// function pointer.
portMUX_TYPE mailboxLock = portMUX_INITIALIZER_UNLOCKED;
GamepadReport mailbox;

// Called on the Bluetooth task for every report the pad sends. Copy, and
// touch nothing else.
void onReport() {
  const uint32_t now = millis();
  portENTER_CRITICAL(&mailboxLock);
  mailbox.controls.lx = Ps3.data.analog.stick.lx;
  mailbox.controls.ly = Ps3.data.analog.stick.ly;
  mailbox.controls.l2 = Ps3.data.analog.button.l2;
  mailbox.controls.r2 = Ps3.data.analog.button.r2;
  mailbox.controls.l1 = Ps3.data.button.l1;
  mailbox.controls.r1 = Ps3.data.button.r1;
  if (Ps3.event.button_down.start) mailbox.startPressed = true;
  if (Ps3.event.button_down.select) mailbox.selectPressed = true;
  mailbox.lastReportMs = now;
  mailbox.hasReport = true;
  portEXIT_CRITICAL(&mailboxLock);
}

void onConnect() { Serial.println("PS3 controller connected."); }

}  // namespace

void Gamepad::begin(const char* hostMac) {
  Ps3.attach(onReport);
  Ps3.attachOnConnect(onConnect);
  Ps3.begin(hostMac);
  started = true;
}

void Gamepad::update(uint32_t now) {
  if (!started) return;

  GamepadReport report;
  portENTER_CRITICAL(&mailboxLock);
  // A pad silent past the limit is forgotten outright, so its last stick
  // position can never read as fresh again, however long the silence.
  if (mailbox.hasReport && timing::since(now, mailbox.lastReportMs) >= tuning::GAMEPAD_SILENCE_MS) {
    mailbox = GamepadReport();
  }
  report = mailbox;
  mailbox.startPressed = false;  // consumed
  mailbox.selectPressed = false;
  portEXIT_CRITICAL(&mailboxLock);

  session.update(report, now);
  showScheme(report.hasReport);
}

// Light the player LED for the current scheme whenever it differs from what
// the pad shows: after SELECT, after the panel changes the scheme, and on a
// pad that has just (re)appeared, which the library sets to player 1 on
// connecting. Sent from the loop task, as the library's own examples do.
void Gamepad::showScheme(bool padPresent) {
  if (!padPresent) {
    shownScheme = -1;
    return;
  }
  if (shownScheme == scheme) return;
  Ps3.setPlayer(scheme == kinematics::SCHEME_ADVANCED ? 2 : 1);
  shownScheme = scheme;
}

#else  // gamepad support not compiled in

void Gamepad::begin(const char*) {}

void Gamepad::update(uint32_t) {}

void Gamepad::showScheme(bool) {}

#endif
