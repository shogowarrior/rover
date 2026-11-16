#include "GamepadSession.h"

#include <math.h>
#include <stdlib.h>

#include "Timing.h"

bool GamepadReport::freshAt(uint32_t now) const {
  return hasReport && timing::since(now, lastReportMs) < tuning::GAMEPAD_SILENCE_MS;
}

GamepadReport takeGamepadReport(GamepadReport& mailbox, uint32_t now) {
  if (mailbox.hasReport && !mailbox.freshAt(now)) {
    mailbox = GamepadReport();
  }
  const GamepadReport report = mailbox;
  mailbox.pressed = 0;  // consumed
  return report;
}

GamepadSession::GamepadSession(Control& control, Settings& settings, EventLog& log)
    : control(control), settings(settings), log(log), schemeInUse(settings.scheme()), padInUse(settings.padOn()) {}

void GamepadSession::stopDriving(uint32_t now) {
  if (driving()) control.command(SOURCE_PAD, STOP, 0, 0, now);  // a STOP is never refused
  lastSent = {STOP, 0};
}

void GamepadSession::update(const GamepadReport& report, uint32_t now) {
  const bool fresh = report.freshAt(now);
  notePresence(fresh, now);

  // Turned off or on, by anyone: whatever the pad drove stops, and a stick
  // held through it waits for centre.
  if (settings.padOn() != padInUse) {
    padInUse = settings.padOn();
    stopDriving(now);
    awaitingRelease = true;
    panning = false;
  }
  const bool enabled = padInUse;

  // Settings logs the change, as the pad's.
  if (enabled && report.wasPressed(PAD_SELECT)) {
    settings.setScheme(settings.scheme() == kinematics::SCHEME_ADVANCED ? kinematics::SCHEME_NORMAL
                                                                        : kinematics::SCHEME_ADVANCED,
                       SOURCE_PAD, now);
  }
  if (settings.scheme() != schemeInUse) {
    schemeInUse = settings.scheme();
    if (driving()) {
      stopDriving(now);
      awaitingRelease = true;
    }
  }

  const kinematics::DriveRequest wanted =
      enabled && fresh
          ? kinematics::translateGamepad(report.controls, tuning::GAMEPAD_DEADZONE, topSpeed, schemeInUse)
          : kinematics::DriveRequest{STOP, 0};

  // Before START, so that Cross wins when both arrive in one report and the
  // rover is left stopped in manual: two buttons at once fail toward stopped.
  // Before the pad's own switch too: Stop is one press from every controller.
  if (report.wasPressed(PAD_CROSS)) {
    // Always sent, driving or not: like the panel's Stop, it is how the pad
    // stops an exploring rover, and any command takes control.
    log.add(now, EventLog::INFO, SOURCE_PAD, "Pad: Cross, Stop");
    control.command(SOURCE_PAD, STOP, 0, 0, now);
    lastSent = {STOP, 0};
    // A stick or trigger still held waits for centre, or the next pass would
    // drive it again and Cross would do nothing under a resting thumb.
    awaitingRelease = wanted.move != STOP;
    return;
  }
  if (!enabled) return;  // turning it off stopped what it drove

  stepTopSpeed(report, now);
  aimSonar(report, fresh, now);
  if (report.wasPressed(PAD_START)) {
    log.add(now, EventLog::INFO, SOURCE_PAD, "Pad: START, autonomous");
    control.command(SOURCE_PAD, RESUME_AUTONOMOUS, 0, 0, now);
    lastSent = {STOP, 0};
    return;
  }

  if (awaitingRelease) {
    if (wanted.move == STOP) awaitingRelease = false;
    return;
  }

  if (wanted.move == STOP) {
    stopDriving(now);
    return;
  }

  const bool turned = wanted.move != lastSent.move;
  const bool respeeded = wanted.speed != lastSent.speed;
  const uint32_t gap = turned ? 0 : respeeded ? tuning::GAMEPAD_SPEED_CHANGE_MS : tuning::GAMEPAD_REFRESH_MS;
  if (driving() && timing::since(now, lastSentMs) < gap) return;

  if (!control.command(SOURCE_PAD, wanted.move, wanted.speed, tuning::DEFAULT_MOVE_DURATION_MS, now)) {
    // Another controller holds control: nothing is driving for the pad, so
    // letting go sends no STOP, and the next pass asks again. Control logs
    // the refusal once, and the pad takes over as that hold lapses.
    lastSent = {STOP, 0};
    return;
  }
  lastSent = wanted;
  lastSentMs = now;
}

// The library never reports a disconnect: a pad that goes silent is gone,
// and the STOP for what it drove follows from update()'s silent report.
void GamepadSession::notePresence(bool fresh, uint32_t now) {
  if (fresh == present) return;
  present = fresh;
  if (fresh) {
    log.add(now, EventLog::INFO, SOURCE_PAD, "Pad connected");
  } else {
    log.add(now, EventLog::WARN, SOURCE_PAD, "Pad silent for %lu ms: gone",
            static_cast<unsigned long>(tuning::GAMEPAD_SILENCE_MS));
  }
}

void GamepadSession::stepTopSpeed(const GamepadReport& report, uint32_t now) {
  const int step = report.wasPressed(PAD_UP) ? tuning::GAMEPAD_SPEED_STEP
                   : report.wasPressed(PAD_DOWN) ? -tuning::GAMEPAD_SPEED_STEP
                                                 : 0;
  if (step == 0) return;
  topSpeed = kinematics::clampInt(topSpeed + step, tuning::GAMEPAD_SPEED_STEP, tuning::MOTOR_SPEED_LIMIT);
  log.add(now, EventLog::INFO, SOURCE_PAD, "Pad: top speed %d", topSpeed);
}

void GamepadSession::aimSonar(const GamepadReport& report, bool fresh, uint32_t now) {
  // The aim is kept, wherever a client or the pad last set it, for the next
  // time the sonar aims.
  if (report.wasPressed(PAD_TRIANGLE)) settings.setSonar(Explorer::SONAR_SWEEP, SOURCE_PAD, now);
  if (report.wasPressed(PAD_R3)) settings.setSonar(Explorer::SONAR_FRONT, SOURCE_PAD, now);

  const int deadzone = tuning::GAMEPAD_DEADZONE;
  if (!fresh || abs(report.rx) <= deadzone) {
    if (panning) log.add(now, EventLog::INFO, SOURCE_PAD, "Pad: the sonar aimed at %ld deg", lroundf(panDeg));
    panning = false;
    return;
  }
  if (!panning) {
    panning = true;
    lastPanMs = now;
    panDeg = settings.sonar() == Explorer::SONAR_AIM ? static_cast<float>(settings.aimDeg()) : 0.0f;
  }
  // Past the dead zone, 0 to 1 of the stick's travel; pushed right, the
  // sonar turns right, to negative angles.
  float push = (abs(report.rx) - deadzone) / static_cast<float>(127 - deadzone);
  if (push > 1.0f) push = 1.0f;
  if (report.rx > 0) push = -push;
  const float seconds = timing::since(now, lastPanMs) / 1000.0f;
  lastPanMs = now;
  const float limit = static_cast<float>(tuning::SONAR_AIM_MAX_DEG);
  panDeg = fmaxf(-limit, fminf(limit, panDeg + push * tuning::GAMEPAD_PAN_DEG_PER_S * seconds));
  settings.setSonar(Explorer::SONAR_AIM, SOURCE_PAD, now);
  settings.setAim(lroundf(panDeg), SOURCE_PAD, now);
}

PadState GamepadSession::state() const {
  if (!settings.padOn()) return PAD_OFF;
  return present ? PAD_CONNECTED : PAD_WAITING;
}

int GamepadSession::playerLedToShow(bool padPresent, uint32_t now) {
  if (!padPresent) {
    shownLed = 0;
    return 0;
  }
  const int wanted = !settings.padOn() ? 4 : settings.scheme() == kinematics::SCHEME_ADVANCED ? 2 : 1;
  if (shownLed == wanted) return 0;
  if (timing::since(now, lastLedWriteMs) < tuning::GAMEPAD_LED_MIN_INTERVAL_MS) return 0;
  shownLed = wanted;
  lastLedWriteMs = now;
  return wanted;
}
