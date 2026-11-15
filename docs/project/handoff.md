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
  text fields, menus, Options, dialogs and the block editor, and Ctrl, Alt
  or Cmd, or a context menu, lets go of every held key. Options lists them.

Host tests 142/142, panel tests 279/279 and the protocol check pass.

A third thread, beside F3h and F4, did F6 from the owner's message of
2026-10-04 (features.md, F6):

- the OTA the owner had is ArduinoOTA (`pio run -e car_ota -t upload`),
  intact; nothing OTA-related was ever removed, and the panel never had
  one;
- firmware updates from the panel: a Firmware section in Options, after
  Keys, sends a build's `firmware.bin` over the panel's own WebSocket, 1000
  bytes a frame, each frame only once the rover asks for it. The rules are
  `FirmwareUpdate`'s, a new pure, host-tested module; `FlashSlot` writes the
  other app slot through `Update`. The rover stands down as one begins,
  motion ends it, and every way but "done" keeps the old firmware; the
  restart waits for rest and comes up in manual;
- the OTA password, when set, guards both paths: ArduinoOTA and the panel
  check the same secret, the panel answering ArduinoOTA's challenge;
- telemetry's `firmware`, the running image's MD5: the panel sends nothing
  to a rover without it, shows the build, and says after the restart
  whether it runs the file sent;
- a new image from either path boots on trial and is kept once it has run
  30 s since it first got online, so one that crashes, hangs or never gets online undoes
  itself at the next reset; neither update path runs meanwhile;
- updates over the link need an OTA password, and a rover without one
  refuses them (`features::LINK_UPDATE_NEEDS_PASSWORD`): the WebSocket
  server refuses ordinary browser pages from anywhere but a file, this
  computer or the local network, but a sandboxed frame's origin reads like
  a file's;
- the heartbeat also clears a slot's missed pongs on connect, which a
  dropped split frame showed could carry over to the slot's next client.

Its review round (firmware, panel, layout, simplicity, each finding checked
by a skeptic) kept 11 findings and fixed them all: the 30 s trial above (a
build that got online, then hung, was being kept), the web-page refusal, any
move ending an update while it is received, Options running under the Stop
bar, the panel's "did it take" after a lost "done" or a rover not yet
restarted, the focus a pressed button dropped, a touch screen's hint for a
rover too old to update, and a preview on the simulator no longer stopped by
an update. A hardware-safety pass on those fixes then found that the origin
check cannot stop a page posing as a file (hence the password), that a
flapping link held a good image on trial (the 30 s now counts from first
online), that espota invitations sent during the trial were answered after
it (now dropped), and that a failed keep went unnoticed (updates now stay
closed until a reset).

Host tests 192/192, panel tests 301/301, the protocol check and every board
build pass. That thread built and tested the firmware in its own container
despite the registry block: see "Firmware builds in a cloud thread" below.

On 2026-11-05 the owner asked to replace the teal look with a darker,
higher-contrast one and for a Dark | Light toggle in settings. A thread did
it, F7 in features.md, panel colours only, beside the layout thread working
on the header and panes the same day:

- Console Dark, the default, is black with white ink, its buttons, switch
  tracks, fields and theme tiles edged at 3:1 (`--edge`), and the chosen
  segment of each switch inverted (`--chosen`, its word in `--on-chosen`);
- the teal is gone: blue (`--live`) is the operator's controls, green
  (`--ok`) the rover doing well, amber caution and red Stop alone, in all
  six looks; all-well pills are quiet, a clear way on the scan is drawn
  open, a near sonar ray in the simulator heavy, and a lit Autonomous is
  tinted and edged, so no state hangs on hue alone;
- no teal anywhere, tints and blocks included: Blueprint's green tints are
  opaque and a clear way's body (`--ok-body`) yellower, since a faint green
  over its blue mixed to teal, and the motion blocks are a dusky rose
  (`#805362`) that a red-green colour-blind eye still tells from every
  other category; `looks.test.js` checks both;
- Options has a Dark | Light toggle and a tile per theme (Console, Field,
  Blueprint) in place of six tiles; look ids are unchanged, so a
  remembered look still applies.

Three review rounds (four lenses, then four, then three, each finding
checked by a skeptic) kept 43 findings, many found by more than one lens,
and fixed them all, each fix with a test that fails without it. Round 1: the all-well lamps lost on a phone on
its side, blue and green drawn on the inverted chip, a disabled Run
without its edge, Autonomous lit under 4.5:1 on a phone's bare bar in
Console Light, the simulator's rays told apart by hue alone, and the motion
blocks still teal. Round 2: Blueprint still drawing teal where a faint
green mixed with its navy (and a mint on its pale blue), round 1's olive
motion blocks matching control and stop for a red-green colour-blind eye,
chosen words running off their chips on the narrowest phones, and the
theme tiles framed at 1.4:1. Round 3: the same mixing through a fade (the
scan's history once the link goes, the running block's glow, the halos'
pulse, the chosen toolbox pill) and Blockly's white on a light look's
"Create variable" button. A `/code-review` pass then found four more:
the scan's history greyed by a filter WebKit does not apply to an SVG
shape (now by its colours), the simulator's clear rays faded in `--ok`
over Blueprint's blue (now `--ok-body`), the chosen toolbox pill's ring
under 2:1 in the dark looks (now the ink), and a clear wedge's body
snapping rather than gliding as its fill's opacity changed. Panel tests
314/314 and the protocol check pass. No firmware changed.

On 2026-11-05 the owner left four comments on the try-it page: the Drive
tab's view of the simulator was still the smallest pane; the dock and the
right pane wasted space, and should be tiled vertically with a side split
for the view; Stop was too big, and should be an icon beside the gear,
every button with hover hints, and Autonomous a toggle; and the header's
two or three lines should be one. The first thread did all four in one
PR, panel only (features.md, F3i and F3j):

- from 960 px wide the Drive tab splits the page: on the left, at the
  page's height, the simulator's view on the simulator target and the
  rover's scan on the rover target; on the right one column (`--drive`, at
  most 45% of the screen), the dock with the readouts on one line under it;
- the header is one 44 px row beside both tabs: the mark, the Autonomous
  toggle, the status pills, the tabs, the scheme and the target as icons
  with hover hints, the address, the note (two lines at most), and Stop, a
  red icon, beside the gear, with the note, not Disconnect, beside Stop;
  there is no foot bar on a wide screen;
- every button on the page has a hover hint saying what it does;
- Autonomous is a toggle on every layout (`js/autotoggle.js`): on while the
  target explores, a press turns it off (STOP) or on (RESUME_AUTONOMOUS);
  on the simulator target it shows the simulator's mode, and the mode pill
  keeps the rover's, on a phone in the motors pill's place;
- the Program tab gains the header's and the foot bar's height, and every
  phone layout is as it was but for that pill. The view's room is twice as
  wide as on main at 1280 x 800 (600 x 450, from 296 x 222) and about 60%
  wider at 1366 x 657 (542 x 407, from 344 x 258); below 1180 px wide the
  sticks are smaller (194 px at 1024 x 768, from 282), and above it larger
  (252 at 1280 x 800, from 202).

On 2026-11-14 the owner, looking at `main`'s try-it page (which did not yet
have F3i and F3j), found the panel cluttered and confusing, on a phone and
everywhere: Stop and Autonomous still huge at the foot, a pane squeezed
between two others, Normal | Advanced greyed out with no rover, and every
control wanted in two cells at the top, Rover | Simulator first. A thread
did F8 in features.md, panel only, on PR #9's branch, and it replaces the
layout F3 to F3j built:

- every control but the open tab's own is in two cells at the top, on
  every layout and both tabs: Rover | Simulator, the Autonomous switch and
  the link chip in the first; the Drive and Program tabs, Normal |
  Advanced, and Stop, a red icon, beside the gear in the second. One row
  where the top is 900 px wide or more, a cell a row below that, and
  under 568 px on its side across the screen. Autonomous is never over
  Stop where the cells stack, and Stop never moves on a switch of tab.
  Each cell says as much as its width allows, measured, and nothing in a
  cell moves on a switch of target, a change of link or an alert;
- the link chip says the link's state in one word for each ("Not
  reachable" for a rover that never answered) and opens a popover with the
  address, Connect and the note; with no link a card over the scan, titled
  with the chip's word, offers Connect to the address it will use (one row
  under the fan only in a view under 170 px tall); after its word the chip
  says "No motors", or "Rover exploring" on the simulator target, in
  amber, where nothing else on screen says it, the second dashed as last
  known once the link goes, and cleared only by a frame that reports
  MANUAL; on the simulator target a line at the top of the view says it
  too;
- a press of Autonomous on the rover is marked, its track dashed, until a
  frame reports the mode asked for; a press while one is pending sends
  STOP, so two quick presses always end stopped, from off or from on, and
  off and on again to retry a halted rover waits for the switch to show
  off; and with no link a press opens the link's popover and says why;
- Normal | Advanced is never greyed out for want of a link: a press before
  the rover reports a scheme is a wish, said in words on the card and in
  the popover, sent as soon as the rover reports one (and only while the
  rover is the target);
- under the cells two panes, never three: the view (the rover's scan, its
  legend in a corner, its readouts in one line, or the simulated room
  under one row of controls) beside both tabs, and the hands (the dock, or
  the editor with its console line under it, which on a wide screen sits
  under the view instead, the view's column there about half the width);
  on a wide screen the Drive tab stacks its sticks in one column beside
  the view, from the owner's "tile them vertically", each up to 280 px;
  under NORMAL the pivot stick is grey and says "Needs Advanced"; the
  Program tab's View toggle shows or hides the view, which starts hidden
  on a phone and opens for a Preview;
- gone: the wordmark, the status pills, the address row, the foot bar, the
  rail with its readouts card, and the Program tab's simulator strip.

It was built in three steps, then checked by two rounds of a critic's
screenshots at twelve sizes from 320 x 568 to 1440 x 900, every state
included; the second round's fixes were split across parallel workers (the
cells, the view, the dock, the Program tab, the popovers, and these docs).
A review of the result by phone, tablet, laptop and code then found more,
fixed by five more parallel workers (the cells, the view, the Program tab,
the dock, and the scheme wish with the dialog and Options) and merged one
at a time. The merge itself found and fixed three things no single branch
had: at 480 x 320 the Program tab's toolbar lay under the cells, out of
reach (now a row under them); from 700 px wide on its side the Program tab
put the cells in one row, moving Stop on a switch of tab (now the
toolbar takes the bands beside the stacked cells from 568 px wide); and a
phone's compact connect card dropped the scheme wish's note (now a line
over its buttons). It was then checked headless at 375 x 667, 480 x 320,
844 x 390, 768 x 1024, 1280 x 800 and 1920 x 1080 in nine states (no
link, live, simulator, both Program tab targets, the alerts, the motor
fault, the link's popover, Options): no overflow, no page errors, both
cells 40 px everywhere, Stop in the same place on both tabs at every
size. features.md, F8, maps each of the owner's clauses to what was done,
and says where the build differs from the spec and why (the badges became
the chip's alerts, the stacked sticks, Autonomous before the chip, the
Program toolbar on a phone on its side, "Needs Advanced"). A second review
by phone, tablet, laptop and code then went over the merged result, and
two parallel workers fixed what it found, merged one at a time onto
PR #9's branch: the top (the connect card on a layer of its own, which had
taken no press on a tablet, and naming its address; Autonomous's pending
press and its press with no link; "Rover exploring" kept through a Stop;
both cells' steps, measured, the alerts' words kept longest and the second
cell's controls held to its far end) and the view, the Program tab and the
dock (the wide Program tab's view column about half the width with the
console under it; the scan's 12 px floor and the fault in the legend's
row; the simulator's move whole or not at all, and no wheel drag in its
settings; the preview's ring on the tab; an example's fit in the editor;
the stacked dock column at least 230 px). Three things stay as they are by
design: on a 390 px phone upright the chip shows the rover's glyph for
"Rover:", which has no room there once the alerts' room is kept; an iPad
upright has no room for the chip's address, which only the link's popover
shows there; and a 320 px phone says Adv for Advanced, which whole is
15 px short there. The third review's last fixes: a press of Autonomous
while one waits sends STOP, so two quick presses end stopped from on as
from off; the view's amber line and the card's address wrap to two lines
rather than being cut; the wide Program tab's console keeps three lines of
its log; a loaded program is fitted again as the editor's width changes,
until the operator zooms or pans; and the simulator's speed goes with its
move under 70 px. Panel tests 348/348, the protocol check and the guard's
224/224 pass. The host tests and board builds were not run for this round;
no firmware changed since they last passed (host tests 192/192).

## Current work

The owner's panel and controls requests of 2026-10-03. [features.md](../features.md)
quotes them verbatim and maps each to an item (F1-F7) with today's code, the
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

F6, firmware updates from the panel, and F7, darker looks with a Dark |
Light toggle, came later and are done too, and so are F3i, the Drive tab
split for a larger view, and F3j, the header in one row with Stop beside
the gear and Autonomous a toggle, from the owner's comments on the try-it
page. F8, from his comments of 2026-11-14, is done and replaces F3 to
F3j's layout: every control in two cells at the top, and two panes under
them, the view beside both tabs and the open tab.

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

- F6's checks for the owner, which need the rover: bench-checklist.md,
  section 10, including the trial boot. Nothing about updates from the
  panel has run on a board yet.
- F5's and F7's checks for the owner, which need a real screen:
  features.md, F5 and F7, list them, and what each left as it was
  (Blockly's focus colours, its faint zoom and trash icons; Console Dark
  and Field Dark now close, the light looks' dark amber).
- F8's checks for the owner, which need real screens and fingers
  (features.md, F8): the panel on a laptop, an iPad both ways and a phone
  both ways, on both tabs and both targets; touch on the cells' small
  controls (the segments, the link chip and its caret, Autonomous, Stop
  and the gear, 32 px tall with touch targets reaching 44 px); the connect
  card's buttons by touch at first load; the scheme wish with the rover
  (press Advanced before connecting, then connect); Autonomous with the
  rover (its dashed track until the rover reports; two quick presses
  leaving it stopped, tried from off and again from on with the rover
  exploring; a press with no link opening the link's popover); Stop by
  touch and by Space with a popover open; "Rover exploring" on the
  simulator target, in the chip and the view's line, dashed once the
  rover's link is cut and kept through a Stop until the rover reports
  MANUAL; the chip's glyphs told apart by shape on a phone;
  the grey pivot stick reading as off under NORMAL; on a phone on its
  side, the Program tab's toolbar in the bands and Stop in the same place
  on both tabs; a laptop's Program tab with the console under the view; a
  touch screen's Options without the keys (an iPad with a trackpad may
  show them); and on an iPhone a tap into the address or the OTA password,
  whose 13 px words Safari may zoom the page for (it zooms into a field
  under 16 px).
- Small panel and client items listed under "Open from earlier work" in
  [features.md](../features.md): `client/ws.py`'s traceback, and no
  committed stand-in rover.
- No owner answers yet to the 22 questions (features.md, "The owner's
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
  laptop or an iPad on its side first), and for a change to the top or the
  panes at F8's twelve sizes too: 320 x 568, 375 x 667, 390 x 844,
  568 x 320, 844 x 390, 932 x 430, 768 x 1024, 820 x 1180, 1024 x 768,
  1180 x 820, 1280 x 800 and 1440 x 900, with 480 x 320 (the smallest
  phone on its side, where the cells span the screen) and 1920 x 1080. Where the container already has one
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

## Firmware builds in a cloud thread

The cloud environment blocks the PlatformIO registry
(`api.registry.platformio.org`, `dl.registry.platformio.org`), so
`pio run` and `pio test -e native` fail in a fresh thread. GitHub and PyPI
are reachable, and a script in the project's shared files rebuilds every
package PlatformIO would fetch from those upstreams:
`PROJECT=<checkout> bash /mnt/project-files/tools/pio-offline/setup_pio_offline.sh`
(about a minute and 1.2 GB; its README says what it guesses). It writes only
`~/.platformio` and the gitignored `.pio/libdeps`, never a tracked file or
the WiFi settings header. The repo's commands, the build hook included, then
work unchanged. A git worktree needs `.pio/libdeps` copied in. Allowing the
two registry hosts in the environment's network settings would make it
unnecessary.

## History

`git log` on `main` has the full record; each commit body says why.
Highlights of the last branch: the firmware split and autonomy rewrite
(`bfdc9bd`), the control schemes (`0acbc26` onwards), the Program tab and
its simulator, the panel's redesign and two consolidation waves, with review
rounds 1 to 3 along the way and rounds 4 to 14 at the end. The last change before this file fixed how the motor
fault reads on a phone on its side (`b3a8530` to `385df4d`).
