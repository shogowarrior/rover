# Requested features: the next work

The owner's requests for the browser panel and the controls, from
2026-10-03. Nothing here is started. [handoff.md](handoff.md) says where the
project stands and how a thread starts; this file is the goal's detail.

Every bullet and clause the owner wrote is quoted below and mapped to an
item, so none gets lost. Each item gives what the code does today, the rules
that bind a change, a proposal, the questions for the owner, and when it is
done. A proposal is a recommendation, not a decision. The first thread sends
the owner the layout spec ([F3f](#f3f-consistency-rules)) and every "Ask the
owner" question below in one message, then carries on with the defaults
marked *(default)* without waiting, and records the answers here as they
come.

## The request, verbatim

```text
i asked the watch game session to help. create documents needed for putting this in a claude project. work with it to see what you need. it might not be done with setting those up so please check with it.
create a handoff as needed. also add the following:

* add simualtor for the drive mode also so we can see how the controls work. just like the simulator for program (in blockly).
* export/import/clear in a single dropdown. check if other things can be put in dropdown too. there can be multiple based on what is needed. but htink before you do as some things might be better without dropdown to make it explicit/
* look at the UI, it looks like none of the panes are aligned with stuff all over the place.
   * there big stop/autonomous at the bottom with biggest buttons.
   * drive/program at the top
   * the actual move/chip sensor data map to the very right onm at all times even without rover connected.
   * its a bit confusing what goes into the right with the size different indrive/program mode.
   * the preview is a thin veritcal bar with big gaps in the top and bottom wasting space
   * please make things consistent
   * normal/advanced should be available in both drive/program. not sure how advanced can be used with blockly for all move types (18)
   * drive mode should have both the joysticks visible but disabled based on on normal/advanced/ please make it consistent
* check if other buttons can be used too


All this requests can go to your handoff and make sure nothing is dropepd. from my requests. i dont want to waste time on figureing out what got missed.

please work on the stuff needed for project 1st and then we can do the features requested/ you can creat a separate doc for it which handoff cna refer to. goal and project instructions are different
```

The screenshot that came with it shows the Program tab on a wide screen
(about 1626 CSS px) with no rover connected.

## Coverage

| The owner's words | Where |
|---|---|
| i asked the watch game session to help. create documents needed for putting this in a claude project. | Done: [claude-project.md](claude-project.md), [handoff.md](handoff.md), this file |
| work with it to see what you need. it might not be done with setting those up so please check with it. | Done: it had set up nothing for rover, and described word-finder's Project, which these docs follow. Its one suggestion for the repo is an owner decision in [handoff.md](handoff.md) |
| create a handoff as needed. | Done: [handoff.md](handoff.md) |
| add simualtor for the drive mode also so we can see how the controls work. just like the simulator for program (in blockly). | [F1](#f1-a-simulator-for-the-drive-tab) |
| export/import/clear in a single dropdown. | [F2](#f2-file-actions-in-one-menu) |
| check if other things can be put in dropdown too. there can be multiple based on what is needed. | [F2](#f2-file-actions-in-one-menu) (which menus, and how many), [Menu or explicit](#menu-or-explicit-every-control) |
| but htink before you do as some things might be better without dropdown to make it explicit/ | [Menu or explicit](#menu-or-explicit-every-control): every control, with why it stays out of a menu or goes in |
| look at the UI, it looks like none of the panes are aligned with stuff all over the place. | [F3](#f3-one-layout-for-both-tabs) |
| there big stop/autonomous at the bottom with biggest buttons. | [F3a](#f3a-stop-and-autonomous) |
| drive/program at the top | [F3b](#f3b-the-top-rows) |
| the actual move/chip sensor data map to the very right onm at all times even without rover connected. | [F3c](#f3c-the-right-column-at-all-times) |
| its a bit confusing what goes into the right with the size different indrive/program mode. | [F3d](#f3d-one-right-column-width) |
| the preview is a thin veritcal bar with big gaps in the top and bottom wasting space | [F3e](#f3e-the-simulator-view-fills-its-pane) |
| please make things consistent | [F3f](#f3f-consistency-rules) |
| normal/advanced should be available in both drive/program. | [F3g](#f3g-normal-and-advanced-on-both-tabs) |
| not sure how advanced can be used with blockly for all move types (18) | [F3g](#f3g-normal-and-advanced-on-both-tabs), "How Blockly already reaches all 18 moves" |
| drive mode should have both the joysticks visible but disabled based on on normal/advanced/ | [F3h](#f3h-both-sticks-shown-disabled-by-scheme) |
| please make it consistent (the joysticks bullet) | [F3h](#f3h-both-sticks-shown-disabled-by-scheme), "Consistent means" |
| check if other buttons can be used too | [F4](#f4-other-buttons) |
| All this requests can go to your handoff and make sure nothing is dropepd. from my requests. i dont want to waste time on figureing out what got missed. | This table; [handoff.md](handoff.md) points here |
| please work on the stuff needed for project 1st and then we can do the features requested/ | Done in that order: these docs are the first change, and nothing below is started |
| you can creat a separate doc for it which handoff cna refer to. | This file |
| goal and project instructions are different | [claude-project.md](claude-project.md) keeps them as two texts |

## Order of work

1. Write the layout and interaction spec ([F3f](#f3f-consistency-rules)) into
   this file, and send it to the owner with the questions (see above).
2. Shared parts first, each with its tests: the in-page ask dialog in place of
   every `window.confirm()`, one menu/popover helper (shared with the
   simulator's settings popover), and a target switch class.
3. [F2](#f2-file-actions-in-one-menu): it shortens the Program toolbar, which is
   what holds the right column narrow today.
4. [F3](#f3-one-layout-for-both-tabs) and F3a to F3e: one right-column width,
   the foot bar aligned to the columns, the simulator view fixed.
5. [F1](#f1-a-simulator-for-the-drive-tab), then
   [F3g](#f3g-normal-and-advanced-on-both-tabs), which builds on F1's target
   switch.
6. [F3h](#f3h-both-sticks-shown-disabled-by-scheme): the biggest change to the
   Drive tab's arbitration.
7. [F4](#f4-other-buttons).

After each step: the panel tests, `tools/check_protocol.py`, layout measured
at 375, 1280 and about 1600 px (see the handoff for how, without the desktop
pane), and `/code-review` rounds until one comes back clean.

## Rules every item keeps

These come from AGENTS.md and the panel's tests, except the last bullet (the
owner's standing instructions) and the one-press rule for Run, Stop program
and the target switch (proposed here, as this file's reading of "better
without dropdown to make it explicit"). The items name the ones they lean
on.

- No ancestor of a stick canvas may be positioned, transformed, filtered or
  contained, and nothing above a held stick may change height
  (`panel.test.js` reads every stylesheet for the first).
- Stop is one press, always visible, in the same place on both tabs, and
  always sends STOP. Autonomous, Run, Stop program and the target switch stay
  one visible press too.
- The simulator holds no Link and no Driver; nothing a preview does reaches
  the rover, the scan fan or the readouts.
- The scheme toggle shows only what telemetry reports, and its message is
  configuration, never a command.
- Every new way to lose control comes with its failsafe in the same change.
- Classic scripts from `file://`, no modules or packages; each new class is
  named in `js/app.js`'s header.
- Never delete a feature; consolidate rather than copy (shared helpers, one
  template for production and tests).

## F1. A simulator for the Drive tab

**Asked:** "add simualtor for the drive mode also so we can see how the
controls work. just like the simulator for program (in blockly)."

**Today.** Only the Program tab has one. `js/app.js` builds one `SimTarget`
drawn by one `SimView` in `#simSlot`, and the Program toolbar's Rover |
Simulator switch (`#programTarget`, `js/programtab.js`) picks where Run goes.
The Drive tab's controls feed only the `Driver` (`js/drive.js`), which sends
through the Link; `SimTarget` offers only the program target API (hold,
release, stop, explore) and has no public raw command. The Drive tab has no
room reserved for a view.

**Binding rules.** The simulator holds no Link and no Driver. Stop must keep
stopping an exploring rover. The sim's containers (`.sim`, `.sim-stage`,
`#simSlot`) are positioned or size-contained, so a view must sit beside the
stick's ancestors, never around them. The Driver re-sends every 200 ms of
real time while a simulated command lasts 400 ms of simulated time: at 2x or
4x playback the simulated rover would stutter, so driving it needs 1x.
Switching targets is a new way to lose control: it must let go of every held
input.

**Proposal.** One Rover | Simulator switch for the whole page, in the header
row beside Normal | Advanced, as a small reusable class (one storage key,
read once from the old `rover.programTarget`). In Simulator mode `app.js`
gives the Driver a sink in place of the Link: an adapter whose
`send({move, speed, duration})` calls a new public `SimTarget.command()` that
mirrors `Rover::command` (STOP stops, RESUME_AUTONOMOUS explores, an unknown
code stops, speed 0 releases). One SimTarget and one SimView serve both tabs.
On a switch: one STOP to the old target only if it was driving, abort a
running program. Playback held at 1x while the Drive tab drives the
simulator, the faster speeds disabled with a title saying why. Stop also
sends STOP to a connected rover. In Simulator mode a Drive press
aborts a running preview, as a press aborts a run on the rover ("the
operator's hands win"), and playback drops to 1x.

Where the one view lives:
- On a wide screen, in the left pane at the room's own aspect (F3e): beside
  the editor on the Program tab, and beside the dock on the Drive tab. The
  Drive tab keeps the view's room in both modes, showing a placeholder in
  Rover mode, so the dock's width and `--stick` never change with the
  target. The right column keeps the rover's data (F3c).
- On a phone, on the Program tab, where it is today: under the editor, with
  its fold.
- On a phone, on the Drive tab in Simulator mode, in the scan fan's row,
  size-contained so the dock never moves, with the readouts kept. Where that
  row is under about 300 px, the view shows a compact wheels-and-motion
  panel instead of the room. A motor fault, which already takes that row,
  still wins it.

Alternatives weighed: mirroring every Drive command to both the rover and
the simulator (simplest, but a live link drives both); a second switch on
the Drive tab (two switches can disagree over one Driver); a second Driver
(duplicates the DOM and the arbitration); only a live wheel diagram beside
the stick (no room).

**Ask the owner.**
- In Simulator mode, does Stop still send STOP to a connected rover?
  *(default: yes; Stop means everything today)*
- In Simulator mode, does Autonomous act on the simulator only, or is it
  disabled? *(default: the simulator only, which says exploring is not
  simulated)*
- Do Drive and Program share one simulated world (room, trail, pose)?
  *(default: yes)*
- On a phone's Drive tab, does the view replace the scan fan while on
  Simulator, or fold away like the Program tab's? *(default: replace the fan;
  the readouts stay)*

**Tests.** Extend `sim.test.js`'s "a preview never sends: a spy link, socket
and driver see nothing" and "in the page, a preview sends nothing over the
real, open Link" to driving; update the Program-tab target tests in
`panel.test.js` for the moved switch and its storage key. New: in Simulator
mode the stick and rotate buttons send nothing over an open Link while Stop
still does; a switch under a held stick or rotate button sends one STOP to
the old target; playback is held at 1x; with a preview running, a stick press
ends it and only the Driver's moves reach the simulator.

**Done when** the Drive tab's stick, rotate buttons, speed and family drive
the simulated rover in the room with no rover connected, nothing reaches the
Link except Stop, and both tabs show the same switch in the same place. F3b's
and F3e's checks, first made on the Program tab, now pass on the Drive tab
too.

## F2. File actions in one menu

**Asked:** "export/import/clear in a single dropdown. check if other things
can be put in dropdown too. there can be multiple based on what is needed.
but htink before you do as some things might be better without dropdown to
make it explicit/"

**Today.** The Program toolbar (`joystick.html`, `css/program.css`) holds the
Rover | Simulator switch, Run, Stop program, a spacer, Examples (a `<select>`
already used as an action menu), then Export, Import and Clear as buttons
with the hidden `#programFile` input. Export works mid-run; Examples, Import
and Clear only while idle. Examples, Import and Clear ask with
`window.confirm()`, while Run asks in the page's `<dialog>`. The toolbar's
900 px is what holds the Program tab's right column narrow (F3d). The
simulator's settings popover already behaves like a menu (`aria-expanded`;
Escape and a press outside close it).

**Binding rules.** No packages, so the menu is hand-written. Run's question
lives in a `<dialog>`, never `window.confirm()`: desktop Chrome blurs the
window after its own dialog, and blur stands the Driver down. Import's file
picker needs user activation, so the menu item's click handler calls
`#programFile.click()` directly. All four actions stay.

**Proposal.** One menu button ("Program", `aria-haspopup="menu"`) holding the
four examples, Import..., Export, a separator, and Clear last, the items
keeping their ids. Built as one small class shared with the simulator's
settings popover (open and close, Escape, a press outside, focus back to the
button). Replace the three `window.confirm()` calls with the page's
`<dialog>` by generalising `ProgramTab.#ask`. Keep the enable rules.

Which menus, and how many: the new Program menu; the simulator's room
`<select>` and settings popover, which are menus already; and the
simulator's 1x / 2x / 4x as a `<select>` only where the simulator's bar is
narrower than its buttons need (below about 360 px). Everything else stays a
visible control, for the reasons in
[Menu or explicit](#menu-or-explicit-every-control).

**Ask the owner.**
- One menu with the examples in it, or Examples kept as its own dropdown?
  *(default: one menu)*
- Clear inside the menu, last, behind an in-page question? *(default: yes; it
  is undoable with Ctrl+Z and moves nothing)*
- Should the simulator's 1x/2x/4x become a dropdown? *(default: only in a
  narrow view)*

**Tests.** Keep the toolbar ids on the menu items (`panel.test.js`'s toolbar
and offline file-tool tests). Extend "program: Run asks in the page, so a run
the operator confirmed drives on", whose stand-in `confirm` must never be
called, to Clear, Import and Examples. New: the menu opens and closes on
Escape and a press outside; Import from the menu triggers `#programFile`;
Clear asks in the page; the playback `<select>` appears only in a narrow
simulator bar and sets the same speed as the buttons.

**Done when** Export, Import and Clear (and the examples, unless the owner
asks to keep them apart) are in one menu, no `window.confirm()` is left in the panel, the toolbar fits one
row at the new right-column width, and every control sits where
[Menu or explicit](#menu-or-explicit-every-control) puts it.

## F3. One layout for both tabs

**Asked:** "look at the UI, it looks like none of the panes are aligned with
stuff all over the place."

**Today** (wide layout, `css/panel.css`), the causes, all in CSS:
- Two right-column widths: `--rail-drive` is `clamp(340px, 52vw - 160px,
  620px)` and `--rail-program` is `clamp(300px, 24vw, 380px)`, chosen per tab.
- The address, Connect and the note are always `--rail-program` wide, and the
  foot bar always uses the Drive tab's columns "so Stop never moves". On the
  Program tab Autonomous starts about 240 px left of the column above it, and
  Stop ends about 240 px short of the editor's pane (about 200 px at 1280).
- The right column's top lines up with the Program toolbar, not the editor,
  because the toolbar is inside the tab's area; under the readouts the
  Program layout leaves an empty row about 600 px tall.
- The simulator column is `clamp(280px, 36%, 400px)`, and the console spans
  only the left pane.

**Binding rules.** AGENTS.md describes the current wide layout (two column
widths, Stop under the controls) and must be rewritten with it. `--stick`
budgets the Drive column, and the Driver (`js/drive.js`) builds the stick
again whenever `--stick` changes (joy.js sizes it only once), so it must
stay a function of the viewport only. The stick-ancestor,
landscape-fault, landscape-caveat and token checks in `panel.test.js` all
bind. Layout has no Node test: measure it in a browser.

**Proposal.** One `--rail` width for both tabs, used by every part of the
right column (address, note, fault, scan, readouts, Autonomous), the foot
bar's two cells aligned to the two columns above, and a written spec
([F3f](#f3f-consistency-rules)) applied everywhere. F2 makes this possible by
shortening the Program toolbar. Recompute `--stick` against the single
column.

**Ask the owner.** Is a slightly narrower Program editor at 1280 px fine in
exchange for one column width on both tabs? *(default: yes)*

**Done when** at 375, 1280 and about 1600 px every pane edge lines up with the
one above or below it, on both tabs, and the stick never moves on a tab
switch, a link change or a target switch.

### F3a. Stop and Autonomous

**Asked:** "there big stop/autonomous at the bottom with biggest buttons."

**Today.** The foot bar is full-bleed with both buttons 64 px tall; Stop is a
red fill with heavy uppercase text and a glow. Because the bar takes the
Drive tab's columns on both tabs, Stop is about 912 px wide and Autonomous
620 px in the screenshot: the widest controls on the page, and not under the
Program tab's panes. On a phone the bar is Autonomous | Stop, Stop under the
right thumb.

**Binding rules.** Stop stays one press, in the same place on both tabs, the
last control in the focus order; on a phone, under the right thumb.

**Proposal.** On wide screens align the bar's cells to the columns above,
cap Stop's width under the left pane (about 480 px), make Autonomous a
secondary style under the right column, and lower both to 56 px. Stop stays
the most prominent control. Leave the phone bar as it is.

**Ask the owner.** Does "biggest buttons" mean too big? *(default: shrink them
modestly; Stop stays the most prominent)*

**Done when**, measured at 1280 and about 1600 px on both tabs, Stop's cell
lies under the left pane and Autonomous's under the right column, both 56 px
tall, Stop still the most prominent control; the phone bar is unchanged; and
`panel.test.js`'s Stop tests (always sends STOP, on every tab, named apart
from Stop program) pass.

### F3b. The top rows

**Asked:** "drive/program at the top"

**Today.** Drive | Program sit in the header's second row beside Normal |
Advanced; the address and Connect are on the right of the first row. The
Program tab adds a toolbar row of its own and the Drive tab none, so the two
tabs' content starts at different heights.

**Proposal.** Keep the tabs at the top, and make that row the row for every
page-wide switch: Drive | Program, Normal | Advanced, and Rover | Simulator
(F1). Per-tab actions stay inside the tab, so both tabs' content starts on
the same line.

**Ask the owner.** A request to keep them there, or a complaint? *(default:
keep them at the top, as the page-wide switch row)*

**Done when** every page-wide switch is in that one header row, both tabs'
content starts at the same height (measured at 375, 1280 and about 1600 px),
no switch label overflows its button (`scrollWidth <= clientWidth`) at
375 x 812 and 480 x 320, and the tab tests (arrow keys, leaving Drive lets go
of a held stick) pass. Until F1 lands, the header holds the switches that
exist; F1 adds Rover | Simulator and checks this again.

### F3c. The right column at all times

**Asked:** "the actual move/chip sensor data map to the very right onm at all
times even without rover connected."

**Today.** The motor fault, the scan fan and the Move/Phase/Chip readouts sit
outside both tabs and are always the right column on a wide screen. With no
link the fan shows only its rings, Move and Chip read "—", Phase is hidden
(it shows only while the rover explores), and nothing says why. After a link drops, the last scan stays, dimmed, as history.

**Binding rules.** AGENTS.md: the scan, the readouts and Stop and Autonomous
stay on screen on both tabs; the simulator's telemetry never reaches the fan
or the readouts. Changing the column's width when the link comes or goes
would move the stick's box and let go of a held stick.

**Proposal.** Read the bullet literally: the right column always shows the
rover's data (the motor fault, the scan fan, the Move and Chip readouts, and
Phase while the rover explores, as today), on both tabs, connected or not,
whatever the target. Before the
first frame it says so plainly ("No rover connected: its scan shows here")
at its full size, and after a link drops it keeps the last scan, dimmed, as
today. Its width never changes with the link. The simulator's view never
takes its place on a wide screen (F1, F3e); on a phone's Drive tab in Simulator
mode only the fan gives way to the view, and the readouts stay (F1). Add both
to AGENTS.md's sentence that the scan and the readouts stay on screen: the
empty state, and that phone exception.

**Ask the owner.** Did the bullet mean the rover's data should stay on the
right at all times (as proposed), or that it should not show without a
rover? *(default: stay at all times, with the empty state)*

**Done when** with no rover connected the right column shows the empty
state at the same width as with a link, on both tabs and at every width,
and the Move and Chip readouts (and Phase while the rover explores) never
leave the screen. `panel.test.js`
gains a test for the empty state; its tests for a new link starting from
nothing and a lost link keeping the dimmed scan still pass.

### F3d. One right-column width

**Asked:** "its a bit confusing what goes into the right with the size
different indrive/program mode."

**Today.** The right column is 620 px on Drive and 380 px on Program in the
screenshot (506 and 307 at 1280). On Drive the scan fills the column; on
Program it is a fixed-ratio card with an empty row under the readouts. Every part
of the column is right-aligned, but the address and note use the Program
width on both tabs and Autonomous the Drive width, so the column's parts
start at two different left edges (380 and 620 px from the right in the
screenshot), and on the Program tab Autonomous does not line up with the
column above it.

**Proposal.** One width for both tabs, about `clamp(320px, 30vw, 460px)`,
used by every part of the column, with the scan filling it on both tabs (F3).

**Ask the owner.** A wider column for the fan, or a narrower one for the
editor? *(default: the middle of that clamp)*

**Done when** one measured width, the same on both tabs, is shared by the
address, the note, the fault, the scan, the readouts and Autonomous, at 1280
and about 1600 px; and the scan card is the same height on both tabs, with
no empty row under the readouts taller than 24 px.

### F3e. The simulator view fills its pane

**Asked:** "the preview is a thin veritcal bar with big gaps in the top and
bottom wasting space"

**Today.** The simulator column is about 383 x 598 CSS px in the screenshot,
a tall narrow box. `SimView.#fit` scales the room by
`min(width / w, height / h)` and centres it, and every room is landscape or
square (Living room 4 x 3 m, Corridor 6 x 1.2, Box 2 x 2, Obstacle course
5 x 3). So the width sets the scale and about 150 px of empty stage sits
above and below the room; the Corridor fills about an eighth of the height.

**Binding rules.** `#simSlot` stays a definite box the simulator fills.
Below about 300 px the view no longer fits its own controls. Dragging and
the arrow-key nudges work in world axes; a rotated view must rotate them too
(`sim.test.js` "the view: a bearing to the rover's left reads, and is drawn,
on its left"). Blockly
needs width for its toolbox and flyout.

**Proposal.** On a wide screen the view lives in the left pane on both tabs
(never in the narrow right column, which is portrait too; phones as in F1): about half the pane beside the
editor on the Program tab, and beside the dock on the Drive tab (F1). Its
stage is sized to the room's aspect (SimView sets a `--room-aspect` variable
when it fits or changes room), with the status, the key and, on the Program
tab, the console under it, so the space below carries information. Drawing
the room turned 90 degrees in a portrait stage is a follow-up only if a
portrait pane remains.

**Ask the owner.**
- May the room be drawn turned 90 degrees, or must its "north" stay up?
  *(default: north stays up)*
- Does the Program console move under the simulator, or stay under the
  editor? *(default: under the simulator on wide screens)*

**Tests.** `sim.test.js`'s view tests (drag, the turn handle, "the view: a
bearing to the rover's left reads, and is drawn, on its left", pause, bump
marks, frames), plus a new one that SimView sets `--room-aspect` for each
room; `panel.test.js`'s `#simSlot` placement tests.

**Done when**, for each of the four rooms at 1280 and about 1600 px on the
Program tab (and on the Drive tab once F1 lands), the room fills its stage's width or height with no empty band above
or below it taller than 24 px, and on a phone the view fits above the dock
without moving it.

### F3f. Consistency rules

**Asked:** "please make things consistent"

**Today**, besides F3 to F3e: the family selector is hidden under NORMAL
rather than shown disabled, and on a phone it comes and goes above the stick;
the scheme toggle is greyed with no link; the target switch exists on the
Program tab only; three questions use `window.confirm()` and one a
`<dialog>`; the simulator's buttons are 32 px tall on wide screens and the
Program toolbar's 44 px.

**Proposal.** Write this spec here first, then apply it:
- Header rows hold the page-wide switches; each tab holds only its own
  actions; the foot bar holds the safety buttons.
- One left pane and one right column, the same widths on both tabs, and the
  foot bar's cells aligned to them.
- One control height per layout for ordinary controls; the foot bar's Stop
  and Autonomous are the one exception, taller.
- Controls that depend on the scheme are shown disabled, never hidden.
- One way to ask: the in-page `<dialog>`.
- Shared helpers for the target switch, the menu and the ask dialog, used
  everywhere they apply.

**Done when** the spec is in this file, has gone to the owner with the
questions, and every item follows it (amended by any answer that comes
back).

### F3g. Normal and Advanced on both tabs

**Asked:** "normal/advanced should be available in both drive/program. not
sure how advanced can be used with blockly for all move types (18)"

**Today.** The toggle already sits in the header outside both tabs, so it
shows on both. It looks unavailable because it stays disabled until a
telemetry frame names a scheme, and the screenshot has no link. Its message
goes only to the Link. On the Drive tab, the family selector that reaches
the eight pivots appears only once the rover reports ADVANCED, so with no
rover no pivot can be tried from the Drive tab.

**How Blockly already reaches all 18 moves.** Both drive blocks share one
motion menu built from `RoverBlocks.MOTION_MENU`, which lists all 18 whatever
the scheme: the 8 translations, the 2 rotations and the 8 pivots, each
pivot's tooltip saying it is not bench-verified. The Mecanum tour example
drives all 18. The runner, `RoverTarget` and the simulator accept every
code, and so does the firmware: the scheme gates only the gamepad's stick
family, never a WebSocket command. On the rover the one gate for programs is
Run's in-page question when a program drives a pivot and the rover does not
report ADVANCED. A preview never asks.

**Binding rules.** The toggle shows only what telemetry reports, and its
message is configuration. Never filter the motion menu by scheme: Blockly
quietly puts the menu's first choice, MOVE_FORWARD, in place of a saved value
the menu does not offer (`blocks.js`), so a saved pivot would become a drive
forward.

**Proposal.**
- With the target on Simulator (F1), bind the toggle to the simulator: it
  shows the scheme the simulator's telemetry reports and sends the choice to
  `SimTarget.setScheme()`. Normal | Advanced then work with no rover, and
  the Drive tab's pivot controls follow the simulator's scheme. This keeps
  the rule, since it is the simulator's telemetry.
- In the blocks, under NORMAL, label the pivot entries "Advanced" and put a
  warning on each enabled pivot drive block (Blockly's warning text, from a
  change listener). Keep all 18 and keep Run's question.

**Ask the owner.**
- With a rover connected and the target on Simulator, does the simulator's
  scheme follow the rover's or stand on its own? *(default: its own, starting
  from the rover's)*
- Should NORMAL refuse pivots in programs outright (a firmware and protocol
  change), or keep asking as today? *(default: keep asking)*

**Tests.** The toggle tests ("schemes: the toggle is disabled and unknown
until telemetry names a scheme", "schemes: Advanced sends one
{"scheme":"ADVANCED"} and nothing else, and the rover explores on",
"schemes: the family selector is offered under ADVANCED only; corner hints
under a pivot family"), the Run-question tests, `sim.test.js` "the preview reports the rover's scheme; nothing of its own
reaches the page" (which F3g changes: in Simulator mode the simulator's
scheme reaches the toggle, and follows the rover's only at the start),
and `program.test.js`'s motion-menu tests. New: bound to the simulator, the
toggle works with no link and sends nothing over the Link.

**Done when** Normal | Advanced can be switched on both tabs with no rover
connected (on the simulator), and a pivot block under NORMAL says so before
Run is pressed.

### F3h. Both sticks shown, disabled by scheme

**Asked:** "drive mode should have both the joysticks visible but disabled
based on on normal/advanced/ please make it consistent"

**Today.** The panel has one stick, the rotate buttons and the family
selector (Translate | Pivot | Pivot sideways), shown only under ADVANCED. The
PS3 pad also uses one stick: the left, with L1 or R1 held for the pivot
families under ADVANCED, L2/R2 to rotate, START to explore and SELECT for the
scheme. The pad's right stick is never read (`src/Gamepad.cpp` copies only
`lx`, `ly`, L1, R1, L2, R2, START and SELECT, and `GamepadState` has no
right-stick fields), so neither controller has a second working stick today.

**Binding rules.** joy.js is vendored and stays unmodified; two canvases work
only if neither has a positioned or contained ancestor. The box-move and
resize rules, and "nothing above the stick changes height while held", apply
to both sticks. A mapping shared with the pad lives in `Kinematics`,
`js/mecanum.js` and `test/vectors/stick_moves.json`, and a pad change runs
the `car_wire_gamepad` build and the hardware-safety-reviewer. `--stick`
budgets one stick, and the fake DOM finds one canvas. On an upright phone the
stick is 112 to 236 px by the screen's height (about 202 px at 375 x 812), so
two sticks at today's size do not fit the dock's 343 px, and even at their
floors they take most of it.

**Consistent means:**
- the same controls on every layout (wide, a phone on its side, a phone
  held upright) and under both schemes, the ones NORMAL cannot use shown
  disabled, never hidden;
- every stick's moves from the one shared mapping, `moveForStick(x, yUp,
  family)` in `js/mecanum.js` and `kinematics::moveForStick` in the firmware,
  with the `PIVOT` and `PIVOT_SIDEWAYS` families, tested against
  `test/vectors/stick_moves.json`;
- the panel's and the pad's controls listed side by side in the README's
  control table and `docs/mecanum.md`, so any difference between them is
  written down.

**Proposal.** Two sticks on every layout:
- The left stick always translates (8 ways) and is always live.
- The right stick drives the pivots by quadrant, with a Pivot | Pivot
  sideways switch beside it (the family selector without Translate).
- Under NORMAL the right stick and its switch are drawn but disabled: greyed,
  no input, a title saying "Advanced".
- Rotate stays as buttons. Arbitration: rotate wins, then the stick pressed
  last; letting go of one hands control back to the other if it is still held.

On an upright phone the two sticks shrink to share the dock's width, and
rotate and speed move to a row under them. Give the pad's right stick the
same mapping only if the owner wants the pad to match; otherwise record in
`docs/mecanum.md` that the panel's right stick has no pad equivalent (the pad
reaches the same pivots with L1 or R1 held).

**Ask the owner.**
- What does the second stick drive: the pivots, rotation, or something else?
  *(default: the pivots)*
- Should the PS3 pad's right stick get the same mapping (a firmware change)?
  *(default: no, not in this round)*
- On an upright phone, two smaller sticks with rotate and speed under them,
  or one stick with the family choices always shown and the pivots disabled
  under NORMAL? *(default: two smaller sticks, as asked)*

**Tests.** The stick, touch and rotate arbitration tests, `setFamily`
re-steering, the resize/refit/box-move tests, the stick-ancestor check (both
canvases), the quadrant and scheme-flip tests, `fake-dom.js` (a second canvas
and joy.js capture); `mecanum.test.js` and the vectors if the mapping is new;
`test_kinematics` and `test_gamepad` if the pad changes.

**Done when** every layout shows both sticks and the same controls under both
schemes, the ones NORMAL cannot use visibly disabled; the right stick's moves
come from `moveForStick` and pass the vectors; nothing moves under a held
stick when the scheme flips; and the README and `docs/mecanum.md` list the
panel's and the pad's controls side by side.

## F4. Other buttons

**Asked:** "check if other buttons can be used too"

Three readings; the default is all three, in this order.

**Unused PS3 buttons.** The firmware reads only the left stick, L1, R1, L2,
R2, START and SELECT, and writes only player LEDs 1 and 2. The pinned library
also offers the right stick, L3/R3, the D-pad, triangle/circle/cross/square,
PS, pressure values, the SIXAXIS sensors, rumble, LEDs 3 and 4 and battery
status. Proposals, most useful first:
- Cross (or Circle) = STOP, as a one-shot edge like START. A safety gain:
  today the pad's only stop is letting go of the stick, so stopping an
  exploring rover from the pad means driving it first.
- D-pad up/down = step the pad's top speed (`GAMEPAD_MAX_SPEED` is a fixed 50
  of 255 today).
- A short rumble when a scheme change lets go of the stick; LED 3 or 4 lit
  while exploring or on a motor fault.
- The right stick, if F3h's pad parity is wanted.

Every pad change goes through the mailbox (copied under the spinlock, presses
as edges), `GamepadSession` with `test/test_gamepad`, the `car_wire_gamepad`
build, the hardware-safety-reviewer, and the README's control table and
`docs/mecanum.md`. A battery key in telemetry must fit
`TELEMETRY_MAX_BYTES`.

**Keyboard keys on the panel.** The panel has no keyboard driving today.
Mirror `client/drive.py`: w/s forward and back, a/d strafe, q/e rotate, space
Stop, t Autonomous, -/+ speed. A held key is a Driver input like a rotate
button (keydown arms it, ignoring auto-repeat; keyup releases it), the blur
and hidden stand-downs cover focus loss, space's keydown and keyup call
`preventDefault()` so it never also clicks a focused button (Autonomous,
Run or Connect would otherwise fire on keyup), and keys are ignored while focus is in
the address, a select, the speed slider, the tab list, the dialog, Blockly,
or the simulator's rover (which already takes q/e and the arrow keys to turn
and nudge the preview rover).

**The browser Gamepad API.** A pad plugged into the laptop could drive
through the panel with the same mapping. It needs a `gamepaddisconnected`
failsafe in the same change. Optional.

**In this round:** PS3 Cross = STOP, and the panel's keyboard keys.
**Deferred** unless the owner asks: the D-pad speed steps, rumble, LEDs 3 and
4, the pad's right stick (see F3h), a battery key, and the browser Gamepad
API.

**Ask the owner.** Which reading was meant, and is the split above right?
*(default: all three readings; Cross = STOP and keyboard keys now, the rest
deferred)*

**Tests.** `test/test_gamepad` for Cross (an edge, like START, that stops an
exploring rover and switches to manual), the `car_wire_gamepad` build and
the hardware-safety-reviewer; `panel.test.js` for the keys (each drives
through the Driver, a held key re-sends and its release sends one STOP, the
keys are ignored in the places above, blur and a hidden page stand them
down; with Autonomous or Run focused, space sends exactly one STOP and
nothing else), alongside the existing blur and Stop tests.

**Done when** Cross stops the rover from the pad, the keys drive the Drive
tab as `client/drive.py` does, both are tested as above, and the README's
control table lists them.

## Menu or explicit: every control

| Control | Where | Menu? | Why |
|---|---|---|---|
| Drive \| Program | header | no | which tab is open must show; leaving Drive lets go of a held stick |
| Normal \| Advanced | header | no | shows the state that decides what the stick does |
| Address, Connect / Disconnect | header | no | the first step, and a way to stop driving |
| Stop | foot bar | never | safety: one press, same place, stops exploring too |
| Autonomous | foot bar | no | starts the robot moving on its own: a deliberate press |
| Stick family | Drive tab | no | re-steers a held stick: one tap mid-drive |
| Stick, rotate, speed | Drive tab | no | held or continuous controls |
| Rover \| Simulator | Program toolbar (header under F1) | no | decides whether Run moves the real rover |
| Run / Preview | Program toolbar | no | the primary action |
| Stop program | Program toolbar | no | safety: ends a run at once |
| Examples | Program toolbar | yes | already a dropdown; replaces the program like Import |
| Export | Program toolbar | yes | infrequent, moves nothing |
| Import | Program toolbar | yes | infrequent; the item calls the file picker directly |
| Clear | Program toolbar | yes | last, behind an in-page question |
| Simulator room | simulator bar | yes | already a dropdown |
| Simulator 1x / 2x / 4x | simulator bar | narrow view only | its state should show |
| Simulator Pause, Reset | simulator bar | no | quick, stateful toggles |
| Simulator settings | simulator bar | already one | the popover whose logic the new menu shares |
| Simulator fold | Program tab, phone | no | a disclosure |
| Blockly zoom, centre, trash | workspace | no | Blockly's own |

## Open from earlier work

Not started. In scope only where an item or step below says what takes it
up; the rest waits for the owner.

- `js/programtab.js` asks with native `confirm()` to load an example, import
  over a program, and Clear, while Run uses the in-page `<dialog>`; the
  desktop app's browser pane dismisses native dialogs, so those three do
  nothing there. Taken up by the shared ask dialog (Order of work, step 2),
  which F2 then uses.
- At 480 x 320 on its side, the middle column is 101 px wide and the tab and
  scheme labels overflow their buttons. Found while verifying the last
  branch's landscape layout. Taken up by F3b's done-when.
- `client/ws.py` prints a raw traceback when the rover is unreachable, where
  `client/drive.py` prints one clean line.
- No stand-in rover or project verify recipe is committed. The one used to
  verify the last branch was a Python `websockets` server on
  `127.0.0.1:8181` that logged every frame, sent telemetry every 500 ms, and
  had switch files to stop telemetry and report a motor fault. Committing one
  (under `tools/`) would make every item above checkable end to end without
  the rover.
