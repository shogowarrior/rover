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

Source Control::holder(uint32_t now) const {
  if (held == SOURCE_ROVER || timing::since(now, heldAt) >= tuning::CONTROL_HOLD_MS) return SOURCE_ROVER;
  return held;
}

bool Control::command(Source from, int move, int speed, int durationMs, uint32_t now) {
  if (from == SOURCE_ROVER) return false;  // not a controller
  const Source holding = holder(now);
  const bool outranked = holding != SOURCE_ROVER && holding != from && settings.rankOf(from) > settings.rankOf(holding);

  if (outranked) {
    if (move == STOP) {
      // Stop is one press from every controller, but it hands the holder's
      // control to no one: the holder's next command moves the rover again.
      log.add(now, EventLog::WARN, from, "STOP, though %s has control and may drive on", sourceName(holding));
      rover.command(STOP, 0, 0, now);
      return true;
    }
    if (!refusalNoted[from]) {
      refusalNoted[from] = true;
      log.add(now, EventLog::WARN, from, "Refused %s: %s has control", commandName(move), sourceName(holding));
    }
    return false;
  }

  if (from != lastHolder) {
    log.add(now, EventLog::INFO, from, "%s has control: %s", sourceName(from), commandName(move));
    lastHolder = from;
    for (bool& noted : refusalNoted) noted = false;
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
      return command(from, message.command.move, message.command.speed, message.command.durationMs, now) ? ACCEPTED
                                                                                                         : REFUSED;
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
