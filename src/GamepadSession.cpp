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

GamepadSession::GamepadSession(Rover& rover, kinematics::ControlScheme& scheme, EventLog& log)
    : rover(rover), scheme(scheme), log(log), schemeInUse(scheme) {}

void GamepadSession::stopDriving(uint32_t now) {
  if (driving()) rover.command(STOP, 0, 0, now);
  lastSent = {STOP, 0};
}

void GamepadSession::update(const GamepadReport& report, uint32_t now) {
  const bool fresh = report.freshAt(now);
  notePresence(fresh, now);

  if (enabled && report.wasPressed(PAD_SELECT)) {
    scheme = scheme == kinematics::SCHEME_ADVANCED ? kinematics::SCHEME_NORMAL
                                                   : kinematics::SCHEME_ADVANCED;
    log.add(now, EventLog::INFO, "Pad: SELECT, the %s scheme",
            scheme == kinematics::SCHEME_ADVANCED ? "Advanced" : "Normal");
  }
  if (scheme != schemeInUse) {
    schemeInUse = scheme;
    if (driving()) {
      stopDriving(now);
      awaitingRelease = true;
    }
  }

  const kinematics::DriveRequest wanted =
      enabled && fresh ? kinematics::translateGamepad(report.controls, tuning::GAMEPAD_DEADZONE, topSpeed, scheme)
                       : kinematics::DriveRequest{STOP, 0};

  // Before START, so that Cross wins when both arrive in one report and the
  // rover is left stopped in manual: two buttons at once fail toward stopped.
  // Before the pad's own switch too: Stop is one press from every controller.
  if (report.wasPressed(PAD_CROSS)) {
    // Always sent, driving or not: like the panel's Stop, it is how the pad
    // stops an exploring rover, and any command takes control.
    log.add(now, EventLog::INFO, "Pad: Cross, Stop");
    rover.command(STOP, 0, 0, now);
    lastSent = {STOP, 0};
    // A stick or trigger still held waits for centre, or the next pass would
    // drive it again and Cross would do nothing under a resting thumb.
    awaitingRelease = wanted.move != STOP;
    return;
  }
  if (!enabled) return;  // setEnabled() stopped what it drove

  stepTopSpeed(report, now);
  aimSonar(report, fresh, now);
  if (report.wasPressed(PAD_START)) {
    log.add(now, EventLog::INFO, "Pad: START, autonomous");
    rover.command(RESUME_AUTONOMOUS, 0, 0, now);
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

  rover.command(wanted.move, wanted.speed, tuning::DEFAULT_MOVE_DURATION_MS, now);
  lastSent = wanted;
  lastSentMs = now;
}

// The library never reports a disconnect: a pad that goes silent is gone,
// and the STOP for what it drove follows from update()'s silent report.
void GamepadSession::notePresence(bool fresh, uint32_t now) {
  if (fresh == present) return;
  present = fresh;
  if (fresh) {
    log.add(now, EventLog::INFO, "Pad connected");
  } else {
    log.add(now, EventLog::WARN, "Pad silent for %lu ms: gone", static_cast<unsigned long>(tuning::GAMEPAD_SILENCE_MS));
  }
}

void GamepadSession::stepTopSpeed(const GamepadReport& report, uint32_t now) {
  const int step = report.wasPressed(PAD_UP) ? tuning::GAMEPAD_SPEED_STEP
                   : report.wasPressed(PAD_DOWN) ? -tuning::GAMEPAD_SPEED_STEP
                                                 : 0;
  if (step == 0) return;
  topSpeed = kinematics::clampInt(topSpeed + step, tuning::GAMEPAD_SPEED_STEP, tuning::MOTOR_SPEED_LIMIT);
  log.add(now, EventLog::INFO, "Pad: top speed %d", topSpeed);
}

void GamepadSession::aimSonar(const GamepadReport& report, bool fresh, uint32_t now) {
  // The aim is kept, wherever a client or the pad last set it, for the next
  // time the sonar aims.
  if (report.wasPressed(PAD_TRIANGLE)) rover.setSonar(Explorer::SONAR_SWEEP, rover.status().aimDeg, now);
  if (report.wasPressed(PAD_R3)) rover.setSonar(Explorer::SONAR_FRONT, rover.status().aimDeg, now);

  const int deadzone = tuning::GAMEPAD_DEADZONE;
  if (!fresh || abs(report.rx) <= deadzone) {
    if (panning) log.add(now, EventLog::INFO, "Pad: the sonar aimed at %ld deg", lroundf(panDeg));
    panning = false;
    return;
  }
  if (!panning) {
    panning = true;
    lastPanMs = now;
    const Rover::Status status = rover.status();
    panDeg = status.sonar == Explorer::SONAR_AIM ? static_cast<float>(status.aimDeg) : 0.0f;
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
  rover.setSonar(Explorer::SONAR_AIM, lroundf(panDeg), now);
}

void GamepadSession::setEnabled(bool on, uint32_t now) {
  if (on == enabled) return;
  enabled = on;
  log.add(now, EventLog::INFO, on ? "Pad control on" : "Pad control off: only Cross works, as Stop");
  stopDriving(now);
  awaitingRelease = true;
  panning = false;
}

PadState GamepadSession::state() const {
  if (!enabled) return PAD_OFF;
  return present ? PAD_CONNECTED : PAD_WAITING;
}

int GamepadSession::playerLedToShow(bool padPresent, uint32_t now) {
  if (!padPresent) {
    shownLed = 0;
    return 0;
  }
  const int wanted = !enabled ? 4 : scheme == kinematics::SCHEME_ADVANCED ? 2 : 1;
  if (shownLed == wanted) return 0;
  if (timing::since(now, lastLedWriteMs) < tuning::GAMEPAD_LED_MIN_INTERVAL_MS) return 0;
  shownLed = wanted;
  lastLedWriteMs = now;
  return wanted;
}
