/**
 * Most values the panel shares with the firmware: the wire protocol's move
 * codes, scheme names and mode names, the speed limits, the port, the
 * telemetry interval, the distances the scan fan is drawn at, and the command
 * timing the firmware's deadman depends on. The rest are elsewhere: the
 * sweep's bearings and their telemetry keys (BEARINGS in scan.js), the stick
 * mapping and the move names telemetry reports (mecanum.js), and the
 * simulator's own copies (sim.js).
 *
 * The wire format itself is in src/Protocol.h. The panel is a set of classic
 * scripts that share one global scope (see app.js), so the constants below
 * are globals for every script loaded after this one.
 */

// tools/check_protocol.py compares each `const NAME = <number>;` line in this
// file with its source in src/ and fails CI when one drifts, so keep that
// exact form.

// Move codes: the wire protocol. Source: src/MoveCodes.h. All twenty are
// here, the pivots (9 to 16) included, and check_protocol.py fails if one is
// missing.
const STOP = 0;
const MOVE_FORWARD = 1;
const MOVE_BACKWARD = 2;
const MOVE_RIGHT = 3;
const MOVE_LEFT = 4;
const MOVE_DIAGONAL45 = 5;
const MOVE_DIAGONAL135 = 6;
const MOVE_DIAGONAL225 = 7;
const MOVE_DIAGONAL315 = 8;
const PIVOT_RIGHT_FORWARD = 9;
const PIVOT_RIGHT_BACKWARD = 10;
const PIVOT_LEFT_FORWARD = 11;
const PIVOT_LEFT_BACKWARD = 12;
const PIVOT_SIDEWAYS_FORWARD_RIGHT = 13;
const PIVOT_SIDEWAYS_FORWARD_LEFT = 14;
const PIVOT_SIDEWAYS_BACKWARD_RIGHT = 15;
const PIVOT_SIDEWAYS_BACKWARD_LEFT = 16;
const ROTATE_CLOCKWISE = 17;
const ROTATE_COUNTERCLOCKWISE = 18;
const RESUME_AUTONOMOUS = 19;

// The control schemes, as protocol::schemeName() in src/Protocol.cpp spells
// them. A client changes the rover's scheme by sending {"scheme": <name>}
// with no "move", and telemetry reports it under "scheme". The firmware
// matches the name exactly and ignores one it does not know, so a misspelt
// copy would fail silently; check_protocol.py compares these with
// schemeName().
const SCHEME_NORMAL = "NORMAL";
const SCHEME_ADVANCED = "ADVANCED";

// The modes, as writeTelemetry() in src/Protocol.cpp spells Rover::Mode under
// "mode", named as its enumerators are. The readouts, a program's "rover is
// exploring" and the simulator's own telemetry all go by them, and a
// misspelt copy would leave each one quietly wrong; check_protocol.py
// compares these with writeTelemetry().
const MODE_AUTONOMOUS = "AUTONOMOUS";
const MODE_MANUAL = "MANUAL";

// kinematics::MOTOR_SPEED_MAX in src/Kinematics.h: the motor driver takes a
// byte, so no command asks for more.
const SPEED_MAX = 255;

// tuning::MOTOR_SPEED_LIMIT in src/Tuning.h: the most speed Rover::drive()
// lets through, whatever a command asks. Equal to SPEED_MAX today, but the
// operator may lower it (README, Safety). The panel's commands still ask up to
// SPEED_MAX, and the firmware clamps them; the simulator clamps a preview here
// as the firmware would, or the preview would drive faster and farther than
// the rover.
const MOTOR_SPEED_LIMIT = 255;

// tuning::WEBSOCKET_PORT in src/Tuning.h. The address field also accepts
// "host:port", so the panel can be pointed at a stand-in during development.
const PORT = 81;

// tuning::TELEMETRY_INTERVAL_MS in src/Tuning.h: the rover sends telemetry
// this often. The simulator's keeps the same pace, and the scheme toggle
// waits three frames for a change it asked for.
const TELEMETRY_MS = 500;

// tuning::EXPLORE_STOP_CM and tuning::EXPLORE_GO_CM in src/Tuning.h.
// Exploration ends a cruise when something in its path is within STOP_CM and
// starts one only when the way is clear beyond GO_CM. The scan fan is ringed
// and coloured at the same two distances.
const STOP_CM = 25;
const GO_CM = 40;

// kinematics::DISTANCE_FAR_CM in src/Kinematics.h: what the rover reports
// when no echo came back. It is the absence of a measurement, not a distance.
const FAR_CM = 999;

/* --- command timing ------------------------------------------------------ */

// Every command asks for MOVE_DURATION_MS of motion, well inside the 1.5 s
// the firmware allows one (tuning::COMMAND_DURATION_MAX_MS), the deadman for
// every client: if this page dies mid-drive, its last 400 ms move runs out.
const MOVE_DURATION_MS = 400;
// A held input is re-sent REPEAT_MS after the last send, so each move is
// refreshed well before it expires. The gamepad re-sends as often
// (tuning::GAMEPAD_REFRESH_MS).
const REPEAT_MS = 200;

// A dragged stick reports every animation frame. A new direction goes out at
// once; the same direction at a new speed no sooner than this after the last
// send, the repeat carrying the latest speed otherwise. Each speed change
// costs the rover a rewrite of all four motors over I2C (~7 ms of its loop),
// so one per frame would be felt. The gamepad's rule is the same
// (tuning::GAMEPAD_SPEED_CHANGE_MS in src/Tuning.h); keep the two equal.
const STICK_SEND_MS = 100;

if (typeof module !== "undefined") {
  module.exports = {
    STOP, MOVE_FORWARD, MOVE_BACKWARD, MOVE_RIGHT, MOVE_LEFT,
    MOVE_DIAGONAL45, MOVE_DIAGONAL135, MOVE_DIAGONAL225, MOVE_DIAGONAL315,
    PIVOT_RIGHT_FORWARD, PIVOT_RIGHT_BACKWARD, PIVOT_LEFT_FORWARD, PIVOT_LEFT_BACKWARD,
    PIVOT_SIDEWAYS_FORWARD_RIGHT, PIVOT_SIDEWAYS_FORWARD_LEFT,
    PIVOT_SIDEWAYS_BACKWARD_RIGHT, PIVOT_SIDEWAYS_BACKWARD_LEFT,
    ROTATE_CLOCKWISE, ROTATE_COUNTERCLOCKWISE, RESUME_AUTONOMOUS,
    SCHEME_NORMAL, SCHEME_ADVANCED, MODE_AUTONOMOUS, MODE_MANUAL,
    SPEED_MAX, MOTOR_SPEED_LIMIT, PORT, TELEMETRY_MS, STOP_CM, GO_CM, FAR_CM,
    MOVE_DURATION_MS, REPEAT_MS, STICK_SEND_MS,
  };
}
