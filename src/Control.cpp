#include "Control.h"

#include "MovePatterns.h"
#include "Protocol.h"
#include "Timing.h"
#include "Tuning.h"

namespace {

// A command's name for the log.
const char* commandName(int move) {
  switch (move) {
    case STOP:
      return "STOP";
    case RESUME_AUTONOMOUS:
      return "RESUME_AUTONOMOUS";
    case RUN_CHECKS:
      return "RUN_CHECKS";
    default:
      return isMoveCode(move) ? moveName(static_cast<MoveCode>(move)) : "an unknown move";
  }
}

}  // namespace

Control::Control(Rover& rover, Settings& settings, EventLog& log) : rover(rover), settings(settings), log(log) {}

// ageOf(), not since(): the pad's and the WebSocket server's commands are
// stamped later in the pass than the `now` the serial console and telemetry
// ask with, and since() read such a hold as lapsed, which let the console
// drive under the pad's hold and left `control` out of telemetry.
Source Control::holder(uint32_t now) const {
  if (held == SOURCE_ROVER || timing::ageOf(now, heldAt) >= tuning::CONTROL_HOLD_MS) return SOURCE_ROVER;
  return held;
}

void Control::update(uint32_t now) {
  if (holder(now) == SOURCE_ROVER) held = SOURCE_ROVER;
}

bool Control::command(Source from, int move, int speed, int durationMs, uint32_t now) {
  if (from == SOURCE_ROVER) return false;  // not a controller
  const Source holding = holder(now);
  const bool outranked = holding != SOURCE_ROVER && holding != from && settings.rankOf(from) > settings.rankOf(holding);

  if (outranked) {
    if (move == STOP) {
      // Stop is one press from every controller, but it hands the holder's
      // control to no one: the holder's next command moves the rover again.
      // Said once a hold, like a refusal: a client sending STOP after STOP
      // must not fill the log, nor the serial console it is echoed on.
      if (!stopNoted[from]) {
        stopNoted[from] = true;
        log.add(now, EventLog::WARN, from, "STOP, though %s has control and may drive on", sourceName(holding));
      }
      rover.command(STOP, 0, 0, now);
      return true;
    }
    if (!refusalNoted[from]) {
      refusalNoted[from] = true;
      log.add(now, EventLog::WARN, from, "Refused %s: %s has control", commandName(move), sourceName(holding));
    }
    // Refused, but still re-sent: checks a command ended stay ended.
    if (move == RUN_CHECKS) rover.checksRefused(now);
    return false;
  }

  // A fresh hold, or control passing on: a refusal or a STOP from below is
  // news again.
  if (holding == SOURCE_ROVER || from != lastHolder) {
    for (int i = 0; i < CONTROLLER_COUNT; i++) refusalNoted[i] = stopNoted[i] = false;
  }
  if (from != lastHolder) {
    log.add(now, EventLog::INFO, from, "%s has control: %s", sourceName(from), commandName(move));
    lastHolder = from;
  }
  held = from;
  heldAt = now;
  driver = from;
  rover.command(move, speed, durationMs, now);
  return true;
}

Control::Outcome Control::apply(Source from, const protocol::Message& message, uint32_t now) {
  switch (message.kind) {
    case protocol::Message::DRIVE:
      if (!command(from, message.command.move, message.command.speed, message.command.durationMs, now)) {
        return REFUSED;
      }
      return holder(now) == from ? ACCEPTED : STOPPED;
    case protocol::Message::SETTINGS:
      settings.apply(message.settings, from, now);
      return SETTING;
    case protocol::Message::OTA:
      return UPDATE;
    case protocol::Message::IGNORE:
      break;
  }
  return IGNORED;
}

void Control::lost(Source from, uint32_t now) {
  if (from != driver) return;
  driver = SOURCE_ROVER;
  log.add(now, EventLog::WARN, from, "%s, the driver, is gone: stopped", sourceName(from));
  rover.stop(now);
}
