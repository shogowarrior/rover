#include "GamepadSession.h"

#include "Timing.h"
#include "Tuning.h"

bool GamepadReport::freshAt(uint32_t now) const {
  return hasReport && timing::since(now, lastReportMs) < tuning::GAMEPAD_SILENCE_MS;
}

GamepadReport takeGamepadReport(GamepadReport& mailbox, uint32_t now) {
  if (mailbox.hasReport && !mailbox.freshAt(now)) {
    mailbox = GamepadReport();
  }
  const GamepadReport report = mailbox;
  mailbox.startPressed = false;  // consumed
  mailbox.selectPressed = false;
  mailbox.crossPressed = false;
  return report;
}

GamepadSession::GamepadSession(Rover& rover, kinematics::ControlScheme& scheme)
    : rover(rover), scheme(scheme), schemeInUse(scheme) {}

void GamepadSession::stopDriving(uint32_t now) {
  if (driving()) rover.command(STOP, 0, 0, now);
  lastSent = {STOP, 0};
}

void GamepadSession::update(const GamepadReport& report, uint32_t now) {
  if (report.selectPressed) {
    scheme = scheme == kinematics::SCHEME_ADVANCED ? kinematics::SCHEME_NORMAL
                                                   : kinematics::SCHEME_ADVANCED;
  }
  if (scheme != schemeInUse) {
    schemeInUse = scheme;
    if (driving()) {
      stopDriving(now);
      awaitingRelease = true;
    }
  }

  const kinematics::DriveRequest wanted =
      report.freshAt(now) ? kinematics::translateGamepad(report.controls, tuning::GAMEPAD_DEADZONE,
                                                         tuning::GAMEPAD_MAX_SPEED, scheme)
                          : kinematics::DriveRequest{STOP, 0};

  // Before START, so that Cross wins when both arrive in one report and the
  // rover is left stopped in manual: two buttons at once fail toward stopped.
  if (report.crossPressed) {
    // Always sent, driving or not: like the panel's Stop, it is how the pad
    // stops an exploring rover, and any command takes control.
    rover.command(STOP, 0, 0, now);
    lastSent = {STOP, 0};
    // A stick or trigger still held waits for centre, or the next pass would
    // drive it again and Cross would do nothing under a resting thumb.
    awaitingRelease = wanted.move != STOP;
    return;
  }
  if (report.startPressed) {
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

int GamepadSession::playerLedToShow(bool padPresent, uint32_t now) {
  if (!padPresent) {
    shownLed = 0;
    return 0;
  }
  const int wanted = scheme == kinematics::SCHEME_ADVANCED ? 2 : 1;
  if (shownLed == wanted) return 0;
  if (timing::since(now, lastLedWriteMs) < tuning::GAMEPAD_LED_MIN_INTERVAL_MS) return 0;
  shownLed = wanted;
  lastLedWriteMs = now;
  return wanted;
}
