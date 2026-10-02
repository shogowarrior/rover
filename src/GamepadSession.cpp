#include "GamepadSession.h"

#include "Timing.h"
#include "Tuning.h"

GamepadReport takeGamepadReport(GamepadReport& mailbox, uint32_t now) {
  if (mailbox.hasReport && timing::since(now, mailbox.lastReportMs) >= tuning::GAMEPAD_SILENCE_MS) {
    mailbox = GamepadReport();
  }
  const GamepadReport report = mailbox;
  mailbox.startPressed = false;  // consumed
  mailbox.selectPressed = false;
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
  if (report.startPressed) {
    rover.command(RESUME_AUTONOMOUS, 0, 0, now);
    lastSent = {STOP, 0};
    return;
  }

  const bool fresh =
      report.hasReport && timing::since(now, report.lastReportMs) < tuning::GAMEPAD_SILENCE_MS;
  const kinematics::DriveRequest wanted =
      fresh ? kinematics::translateGamepad(report.controls, tuning::GAMEPAD_DEADZONE,
                                           tuning::GAMEPAD_MAX_SPEED, scheme)
            : kinematics::DriveRequest{STOP, 0};

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
