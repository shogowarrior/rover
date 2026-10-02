#include "Gamepad.h"

#include <Arduino.h>

#include "Features.h"

Gamepad::Gamepad(Rover& rover, kinematics::ControlScheme& scheme) : session(rover, scheme) {}

#if ROVER_ENABLE_GAMEPAD
#include <Ps3Controller.h>

namespace {

// The mailbox between the Bluetooth task and the loop task: the one piece of
// global state outside main.cpp, forced by Ps3.attach() taking a plain
// function pointer.
portMUX_TYPE mailboxLock = portMUX_INITIALIZER_UNLOCKED;
GamepadReport mailbox;

// Called on the Bluetooth task for every report the pad sends. Copy, and
// touch nothing else. The stamp is taken before the lock, so it is never
// later than the clock of the pass that reads this report: that pass reads
// its clock under the lock, after this write.
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

void Gamepad::update() {
  if (!started) return;

  // The clock is read here, under the lock, and not taken from loop(). The
  // pad reports every 10 ms or so on the other core, while loop() reads its
  // `now` before rover.update(), whose sonar ping busy-waits up to ~30 ms. A
  // report that landed during the ping was newer than that `now`, so its
  // unsigned age wrapped to 49.7 days and it was wiped as silence: a held
  // stick was released and re-driven on every ping, START and SELECT presses
  // were lost, and a scheme change's hold on the stick was lifted. Every
  // report written before the lock is stamped no later than this clock; one
  // written after it waits for the next pass.
  portENTER_CRITICAL(&mailboxLock);
  const uint32_t now = millis();
  const GamepadReport report = takeGamepadReport(mailbox, now);
  portEXIT_CRITICAL(&mailboxLock);

  session.update(report, now);
  // From the loop task, as the library's own examples send it.
  const int led = session.playerLedToShow(report.hasReport, now);
  if (led != 0) Ps3.setPlayer(led);
}

#else  // gamepad support not compiled in

void Gamepad::begin(const char*) {}

void Gamepad::update() {}

#endif
