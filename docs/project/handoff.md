# Handoff

Where the project stands, what to work on now, and how a thread picks it up.
AGENTS.md and CLAUDE.md are binding. Update this file in every thread's PR.

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
- wrote AGENTS.md, the bench checklist and [ROADMAP.md](../ROADMAP.md) (more
  sonars, an IMU for heading hold, Kalman filtering and mapping, all for
  later).

Everything was green at the merge: both board builds, host tests 137/137,
panel tests 189/189, the protocol check, the guard 224/224. The owner ran
`/verify` at the end: the panel was driven in the desktop pane against a
stand-in rover, and the Python clients through a terminal. It found the
motor-fault card cut mid-sentence on a phone on its side, fixed in
`b3a8530` to `385df4d`, after which `/code-review` rounds ran until one came
back clean. Nothing has run on the robot yet:
[bench-checklist.md](../bench-checklist.md) is how.

The first thread on the owner's requests (branch
`claude/project-thread-y2bq7r`) did steps 1 to 3 below, panel only:

- the layout and interaction spec (features.md, F3f), and the owner's 20
  questions, sent in one message with the defaults it carries on with;
- `AskDialog` (`js/ask.js`): every question the panel asks, Blockly's
  delete questions included, in the page's one `<dialog>`; no
  `window.confirm()` is left;
- `Popover` (`js/popover.js`): the Program tab's File menu and the
  simulator's settings share it;
- `TargetSwitch` (`js/targetswitch.js`): the Rover | Simulator switch, on
  the Program toolbar until F1 moved it to the header;
- F2: the examples, Import, Export and Clear in the File menu, and a
  playback list in place of the 1x / 2x / 4x buttons in a narrow simulator
  bar, which also keeps every room's name in full.

A review round (seven lenses, each finding checked by a skeptic) found and
fixed: the focus lost to the page after a question an item asked, a press on
the block editor not closing a menu (Blockly stops its presses), room names
cut short in a narrow simulator bar, disabled items not saying why, Clear's
undo key (Cmd+Z on a Mac), and Blockly's delete question with OK focused.
A second round found: the simulator's settings still opening under the Stop
bar on a phone (its box was a scroll container, which swallowed the scroll
margin), the same margin pushing the File button off a phone on its side,
the empty editor not saying the examples are in the File menu, and tests a
browser would fail but the fake DOM passed (a click on an item's word, focus
in a hidden tab).

Panel tests 197/197 and the protocol check pass. That thread's container
could not build the firmware or run the host tests: its network policy
blocked the PlatformIO registry. It changed nothing they cover; CI builds
and tests them on the PR.

The same thread then did step 4, F3 with F3a to F3e, in a PR of its own
(features.md says what each part measured):

- one right-column width, `--rail` (`clamp(320px, 30vw, 460px)`), beside
  both tabs, shared by the address, the note, the scan, the readouts and
  Autonomous, so the tab switch moves nothing;
- the foot bar's cells under the columns: Stop under the left pane, at most
  480 px, Autonomous under the rail, both 56 px;
- the scan's card says "No rover connected: its scan shows here" until the
  rover's first frame (`ScanView.clear()`);
- on the Program tab, the simulator's view beside the editor as tall as its
  room needs (`--room-aspect`, set by `SimView`), the console under it on a
  screen 861 px tall or more and under the editor on a shorter one, and a
  fold strip, so the view folds away on every layout and the editor takes
  the width; it starts folded unless the target is the simulator;
- the simulator's bar at 44 px on every layout, the spec's one control
  height.

The owner's later ask (landscape on a laptop or an iPad first, more of the
width, windows that fold where needed) is in it: measured at 1024 x 768 and
1180 x 820 as well as 1280 and 1600. The right column does not fold: F3c
keeps it on screen.

Its review round (four lenses, each finding checked by a skeptic) found and
fixed: the room drawn small at laptop and iPad heights with the console
under it (now under the editor below 861 px), Blockly not refitting as a
fold or the console resized the editor, the console's log clipped in a
narrow column, the toolbar wrapping on the Rover target from 960 to 970 px,
an empty strip beside the editor when the simulator fails to load, the
hidden empty state stretching a small scan card, and tests that let nine
kinds of regression through. Panel tests 201/201 and the protocol check
pass. Still open from F3b: the tab and scheme labels overflow at 480 x
320.

A second thread, beside the first, did F5 from the owner's second message
that evening: themes and the Options gear, after Word
Finder's (features.md, F5, says what carried over and what did not):

- six looks, three themes (Console, the panel's own colours and the
  default; Field, the most contrast; Blueprint) each Dark and Light, every
  colour a token in `css/looks.css`, worn as `<html data-look>`;
- `LookPicker` (`js/look.js`, loaded in `<head>` so the first paint is in
  the remembered look): the gear in the header opens Options, a non-modal
  `Popover` with a tile per look, so Stop stays one press;
- the stick, Blockly's theme and the browser bar repaint on a change (the
  bar from `<head>`, with the first paint), the stick's knob shading toward
  a rim of its look's own;
- `test/looks.test.js`: every look has every token, no other stylesheet
  writes a colour, and every pairing of ink and surface in its audit (a
  hand-kept list) meets its contrast. It found the red echo wedge under
  3:1, now drawn whole. A headless check of every look against `main`
  found the light looks' knob faded into its well and Blockly's key hints
  faint, both fixed, and the header's pills cut on narrow phones, fixed
  but on a few phones on their side (features.md, F5).

Panel tests 232/232 and the protocol check pass. Its container could not
build the firmware either (same registry block); it changed no firmware.

The first thread then did F1, the first half of step 5, in a PR of its own
(features.md has the measurements):

- one Rover | Simulator switch in the header for the whole page: on the
  simulator the Drive tab's Driver sends to `SimTarget.command()` in the
  Link's place, so no move reaches the rover and only Stop stops it too,
  and Autonomous takes only the simulated rover's mode; the scheme toggle
  stayed the rover's until F3g;
- a switch lets go of everything on the target left behind (a running
  program, held controls, one STOP if driving), a lost or stale link lets
  go of nothing driving the simulator (until F3g, a held stick, since the
  rover's scheme went with the link), and a drive press ends a preview;
- one view of the simulator, moved beside the Drive tab's controls while
  they drive it and held at 1x there; from 1180 px wide or 761 px tall its
  place beside the dock is kept on the rover target too, with the dock's
  controls in one column on a screen 761 px tall or more;
- narrower and shorter, and on a phone, the view takes the scan's place on
  the simulator, showing the wheels and the motion where it is too short
  for the room.

Its review round (logic, then layout) fixed: Stop reaching the rover only
after the simulator, a paused view left frozen on the Drive tab, a held
rotate button carrying on off the tab, the view a strip at 960 x 540, the
switches overlapping at 960 px, a pivot or a motor fault moving the stick
on short screens, and the head running past a phone on its side. The
switch's own row costs an upright phone over 600 px tall 54 px of scan on
either target; F1 in features.md says what winning it back would take. On
a phone 600 px tall or less the Drive tab leaves the switch to the Program
tab. Panel tests 245/245 and the protocol check pass.

It then did F3g, the second half of step 5, in a PR of its own:

- on the simulator target the scheme toggle shows and sets the simulator's
  own scheme (`SchemeToggle.bind()`), always known and set at once, with
  nothing sent over the Link, so Normal | Advanced and the Drive tab's
  pivots work with no rover; while the rover is the target the simulator
  takes the rover's scheme, so a switch starts from it;
- under NORMAL, the target's, each pivot drive block that would run
  carries Blockly's warning before Run is pressed; the motion menu keeps
  all 18, and Run on the rover still asks.

Panel tests 251/251 and the protocol check pass.

It then did F3h, step 6, in a PR of its own (features.md has the
measurements):

- two sticks on every layout: the left one always translates, the right one
  drives the pivots by quadrant with Pivot | Pivot sideways over it, and
  under NORMAL the right stick and its switch stay on screen, dimmed and
  off, the line over the stick saying "Advanced only.";
- the Driver tracks the sticks apart (rotate pressed last, then the stick
  pressed last, then a program); a change to NORMAL lets go of a held pivot
  stick only, and the translate stick, the rotate buttons and a program
  carry on;
- the layouts: an upright phone has both sticks in the dock over Stop, a
  phone on its side a stick down each edge with the header, the scan and
  Stop between them, a wide screen both sticks side by side, beside the
  simulator's view from 1180 px; the tall wide one-column dock is gone;
- on a phone up to 760 px tall a motor fault no longer moves the sticks,
  and on the simulator target the address waits on the Program tab, so a
  lost link moves nothing.

The PS3 pad is unchanged: its right stick is still not read, and the README
and `docs/mecanum.md` list the panel's and the pad's controls side by side.
Panel tests 259/259 and the protocol check pass.

It then did F4, step 7, in a PR of its own (features.md has the details):

- the PS3 pad's Cross sends STOP, driving or not, so the pad stops an
  exploring rover without driving it first; a stick held through it waits
  for centre, and with START in one report Cross wins (`GamepadSession`,
  five new host tests, both board builds);
- the panel takes `client/drive.py`'s keys: W A S D, Q E, - and +, Space for
  Stop and T for Autonomous (`js/keys.js`). A drive key is held through the
  Driver like a rotate button, so every stand-down lets go of it; the drive
  and speed keys act on the Drive tab, Space and T on both; keys are left to
  text fields, menus, Options, the dialog and the block editor, and Ctrl,
  Alt or Cmd lets go of every held key. Options lists them.

Host tests 142/142, panel tests 275/275 and the protocol check pass.

## Current work

The owner's panel and controls requests of 2026-10-03. [features.md](../features.md)
quotes them verbatim and maps each to an item (F1-F5) with today's code, the
binding rules, a proposal, the owner's questions with defaults, tests, and
when it is done. They were done in this order, and all seven are done; what
F4 deferred is under "Open, not started" below:

1. **Done.** Write the layout and interaction spec (F3f) into features.md, and send it
   to the owner with every "Ask the owner" question in features.md, in one
   message. Carry on with the marked defaults without waiting, and record the
   answers in features.md as they come.
2. **Done.** Shared parts, each tested: the in-page ask dialog in place of
   every `window.confirm()`, one menu helper (shared with the simulator's
   settings popover), one Rover | Simulator target switch.
3. **Done.** F2: Export, Import, Clear and the examples in one menu, and the
   simulator's 1x / 2x / 4x as a list only in a narrow view.
4. **Done.** F3 with F3a to F3e: one layout for both tabs.
5. **Done.** F1: a simulator for the Drive tab; then F3g: Normal |
   Advanced usable on both tabs, with or without a rover.
6. **Done.** F3h: both sticks shown in Drive mode, the one NORMAL cannot
   use visibly disabled.
7. **Done.** F4: other buttons (PS3 Cross as STOP, keyboard keys).

**One thread at a time,** each on one item or a few related ones: each item
builds on the one before, and every thread edits this file and features.md.
Start the next thread only after the previous one's PR is merged.

**Where a thread starts:** `main`, unless its task names a branch. A thread
that cannot merge its PR says so in its report and its PR, naming the branch,
and the next thread's task names that branch.

## Starting a thread

1. A cloud thread's setup is in the Project instructions
   ([instructions.md](instructions.md)): the git identity, the PlatformIO
   cache, and the one-line proof that the hooks work. A thread on the owner's
   Mac needs none of it.
2. Read [features.md](../features.md) for the item you are on.
3. Before the PR merges, update this file: what changed, what is next, what is
   unfinished.

## Open, not started

- What F4 deferred, unless the owner asks: the pad's D-pad stepping its top
  speed, rumble, player LEDs 3 and 4, its right stick (F3h), a battery key in
  telemetry, and the browser Gamepad API (features.md, F4). The keyboard's
  checks for the owner, which need a real browser and keyboard: holding a key
  and pressing Cmd on a Mac, a non-English layout, and Space with a button
  focused.

- F5's checks for the owner, which need a real screen: features.md, F5,
  lists them, and what it left as it was (Blockly's focus colours, its
  faint zoom and trash icons).
- The gear sits at the end of the header's first group, which on a wide
  screen is mid-header. A later header change (F1 moved the Rover |
  Simulator switch into the header) can give it the header's right end.
  Moving it means updating the panel test that pins it to the masthead's
  end, and keeping it within `--tap-lg` of the top, which the popover's
  height cap assumes.
- Small panel and client items listed under "Open from earlier work" in
  [features.md](../features.md): label overflow at 480 x 320, `client/ws.py`'s
  traceback, and no committed stand-in rover.
- No owner answers yet to the 20 questions (features.md, "The owner's
  answers"). The work follows the defaults until they come.
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
  bench-verified ([mecanum.md](../mecanum.md)).
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
  [instructions.md](instructions.md) says, measuring at 375, 1024 x 768,
  1180 x 820, 1280 and about 1600 px (the owner's screen; the owner puts a
  laptop or an iPad on its side first). Where the container already has one
  under `/opt/pw-browsers` (its `chromium_headless_shell-<revision>`), skip
  `playwright install` and pin the `playwright` package whose browser
  revision matches it (1.56.1 for revision 1194). Where `cdn.jsdelivr.net` is
  blocked, install `blockly@13.3.0` from npm beside it and serve that file in
  the CDN URL's place with `page.route`; it matches the page's pinned hash.
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
