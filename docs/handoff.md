# Handoff

Where the project stands, how a thread picks it up, and what is next. Read
AGENTS.md and CLAUDE.md first; they are binding. Update this file at the end
of every thread.

## Where things stand

As of 2026-10-03, `main` holds a finished review and refactor (165 commits,
`f37f1b0..385df4d`, merged and pushed). It:

- split the firmware into a pure, host-tested core (`Rover`, `Explorer`,
  `GamepadSession`, `MovePatterns`, `Protocol`, `Kinematics`) and thin
  adapters, and rewrote autonomy (AGENTS.md, "How autonomy works");
- added the Normal | Advanced control scheme for the PS3 pad and the panel,
  with the eight pivots corrected to DroneBot's table;
- rebuilt the browser panel as small classes in `extras/joystick/js/`, with a
  Drive tab, a Program tab of Blockly programs, and a simulator to preview
  them on;
- extended the build hook, hardened the secrets guard and gave it a 224-case
  test table (`test_guard.py`), and added `tools/check_protocol.py`, the
  panel's Node tests against a fake DOM, and the shared cases in
  `test/vectors/`;
- wrote AGENTS.md, the bench checklist and [ROADMAP.md](ROADMAP.md) (more
  sonars, an IMU for heading hold, Kalman filtering and mapping, all for
  later).

Everything was green at the merge: both board builds, host tests 137/137,
panel tests 189/189, the protocol check, the guard 224/224. The owner ran
`/verify` at the end: the panel was driven in the desktop pane against a
stand-in rover, and the Python clients through a terminal. It found the
motor-fault card cut mid-sentence on a phone on its side, fixed in
`b3a8530` to `385df4d`, after which `/code-review` rounds ran until one came
back clean. Nothing has run on the robot yet:
[bench-checklist.md](bench-checklist.md) is how.

## Starting a thread

1. If this is a cloud Project thread, its setup is in
   [claude-project.md](claude-project.md): the environment script, the git
   identity, the PlatformIO cache, and the one-line proof that the hooks
   work. A thread on the owner's Mac needs none of it.
2. Read [features.md](features.md): the goal's detail.
3. In the first thread of a goal, write the layout spec (features.md F3f) and
   send it to the owner with every "Ask the owner" question in features.md,
   in one message. Carry on with the marked defaults without waiting, and
   record the answers in features.md as they come.

**Where the next thread starts:** `main`, unless its task names a branch. A
thread that cannot merge its PR says so in its report and its PR, naming the
branch, and the project conversation names that branch in the next thread's
task.

## Next

The owner's requests of 2026-10-03, all in [features.md](features.md), in
its order of work:

1. The layout and interaction spec (F3f), written first and sent to the
   owner with every question; work carries on with the defaults without
   waiting.
2. Shared parts: the in-page ask dialog in place of every `window.confirm()`,
   one menu helper, one target switch.
3. F2, the file actions in one menu.
4. F3 and F3a to F3e: one layout for both tabs.
5. F1, a simulator for the Drive tab; then F3g, Normal | Advanced on both
   tabs.
6. F3h, both sticks shown, disabled by scheme.
7. F4, other buttons.

## Open, not started

- Small panel and client items listed under "Open from earlier work" in
  [features.md](features.md): the three remaining `confirm()` calls, label
  overflow at 480 x 320, `client/ws.py`'s traceback, and no committed
  stand-in rover.
- `/code-review ultra` (once called `/ultrareview`), the multi-agent cloud
  review, has never run on this code. Only the owner can start it, as with
  `/verify`.
- On the owner's Mac only: two "Google Chrome for Testing" entries, set to
  Off, are left in System Settings > Notifications from an agent's browser
  launch in the last branch. The owner can remove them.

## Decisions that stay with the owner

Never change these silently:

- **GPIO12.** The scanner's ECHO is on a strapping pin; the fix is a wire to
  GPIO34 plus the constant, together (AGENTS.md, "Pins";
  bench-checklist.md).
- **Motor voltage.** The 3-6 V TT motors see about twice their rating at PWM
  255 on the 3S pack: cap `tuning::MOTOR_SPEED_LIMIT` or add a regulator
  (ROADMAP.md, "Now").
- **The pivot rows.** Codes 9 to 16 follow DroneBot's table but are not
  bench-verified ([mecanum.md](mecanum.md)).
- **The secrets guard's reach.** It does not see what command substitution
  such as `$(find src ...)` expands to; AGENTS.md's rule is the real
  protection. Any change to the guard follows CLAUDE.md's copy, prove, move
  procedure.
- **Flashing, the serial monitor, `src/config.h`, the pins**: the operator's
  alone, always.
- **CLAUDE.md for fresh clones.** The watch-game session, whose sibling
  word-finder already runs as a Project, recommended adding "set git config
  user.name and user.email before the first commit" to CLAUDE.md as well as
  to the Project instructions. It is in the instructions; adding it to
  CLAUDE.md is the owner's call.

## Checking the panel without the desktop pane

The owner's Mac has the desktop app's browser pane; a cloud thread does not.
There:

- `node --test extras/joystick/test/` runs the real page against a fake DOM,
  WebSocket and clock, and covers behaviour.
- For layout, use Playwright's chromium headless shell only, as
  [claude-project.md](claude-project.md) says, measuring at 375, 1280 and
  about 1600 px (the owner's screen).
- To exercise the panel end to end, run a stand-in rover: a WebSocket server
  on `127.0.0.1:8181` that logs every frame, answers `{"scheme": ...}`,
  sends telemetry every 500 ms in the shape of `test/vectors/telemetry.json`,
  and can stop telemetry or report `motorsReady: false` on demand. The panel
  takes `127.0.0.1:8181` in its address field.
- Anything needing a real focused window, native dialogs, touch or the pane
  goes to the owner as a manual check.

## History

`git log` on `main` has the full record; each commit body says why.
Highlights of the last branch: the firmware split and autonomy rewrite
(`bfdc9bd`), the control schemes (`0acbc26` onwards), the Program tab and
its simulator, the panel's redesign and two consolidation waves, with review
rounds 1 to 3 along the way and rounds 4 to 14 at the end. The last change before this file fixed how the motor
fault reads on a phone on its side (`b3a8530` to `385df4d`).
