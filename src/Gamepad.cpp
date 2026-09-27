#include "Gamepad.h"

#include <Arduino.h>

#include "Features.h"
#include "Timing.h"
#include "Tuning.h"

Gamepad::Gamepad(Rover& rover) : session(rover) {}

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
  if (Ps3.event.button_down.start) mailbox.startPressed = true;
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
  portEXIT_CRITICAL(&mailboxLock);

  session.update(report, now);
}

#else  // gamepad support not compiled in

void Gamepad::begin(const char*) {}

void Gamepad::update(uint32_t) {}

#endif
