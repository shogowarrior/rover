#include "GamepadSession.h"

#include "Timing.h"
#include "Tuning.h"

GamepadSession::GamepadSession(Rover& rover) : rover(rover) {}

void GamepadSession::update(const GamepadReport& report, uint32_t now) {
  if (report.startPressed) {
    rover.command(RESUME_AUTONOMOUS, 0, 0, now);
    driving = false;
    lastSent = {STOP, 0};
    return;
  }

  const bool fresh =
      report.hasReport && timing::since(now, report.lastReportMs) < tuning::GAMEPAD_SILENCE_MS;
  const kinematics::DriveRequest wanted =
      fresh ? kinematics::translateGamepad(report.controls, tuning::GAMEPAD_DEADZONE,
                                           tuning::GAMEPAD_MAX_SPEED)
            : kinematics::DriveRequest{STOP, 0};

  if (wanted.move == STOP) {
    if (driving) rover.command(STOP, 0, 0, now);
    driving = false;
    lastSent = wanted;
    return;
  }

  const bool turned = wanted.move != lastSent.move;
  const bool respeeded = wanted.speed != lastSent.speed;
  const uint32_t gap = turned ? 0 : respeeded ? tuning::GAMEPAD_SPEED_CHANGE_MS : tuning::GAMEPAD_REFRESH_MS;
  if (driving && timing::since(now, lastSentMs) < gap) return;

  rover.command(wanted.move, wanted.speed, tuning::DEFAULT_MOVE_DURATION_MS, now);
  lastSent = wanted;
  lastSentMs = now;
  driving = true;
}
