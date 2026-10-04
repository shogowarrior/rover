# Requested features: the next work

The owner's requests for the browser panel and the controls, from
2026-10-03. Steps 1 to 4 of the [order of work](#order-of-work) are done, and
so is [F5](#f5-themes-and-options), from a second message that evening; the
rest is not started. [project/handoff.md](project/handoff.md) says where the
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

A second message followed at 22:28 UTC, while steps 1 to 3 were in review:

```text
also remind the thread to make inwdows collapsible wherever needed. keeping mind that it will mostly be landscope mode in either laptop or ipad like device seo mifght as well use more width. check with word-finder and add the support for themes and options like the gear stuff it uses. see if it helps. talk to the word-finder project to see how it does that
```

## Coverage

| The owner's words | Where |
|---|---|
| i asked the watch game session to help. create documents needed for putting this in a claude project. | Done: [project/](project/setup.md) (the goal, instructions, environment script and handoff), this file |
| work with it to see what you need. it might not be done with setting those up so please check with it. | Done: it had set up nothing for rover, and described word-finder's Project, which these docs follow. Its one suggestion for the repo is an owner decision in [project/handoff.md](project/handoff.md) |
| create a handoff as needed. | Done: [project/handoff.md](project/handoff.md) |
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
| All this requests can go to your handoff and make sure nothing is dropepd. from my requests. i dont want to waste time on figureing out what got missed. | This table; [project/handoff.md](project/handoff.md) points here |
| please work on the stuff needed for project 1st and then we can do the features requested/ | Done in that order: these docs came first, then the work below in its [order](#order-of-work) |
| you can creat a separate doc for it which handoff cna refer to. | This file |
| goal and project instructions are different | Two files: [project/goal.md](project/goal.md) and [project/instructions.md](project/instructions.md) |
| also remind the thread to make inwdows collapsible wherever needed. | [F3](#f3-one-layout-for-both-tabs), "Also asked" |
| keeping mind that it will mostly be landscope mode in either laptop or ipad like device seo mifght as well use more width. | [F3](#f3-one-layout-for-both-tabs), "Also asked" |
| check with word-finder and add the support for themes and options like the gear stuff it uses. | Done: [F5](#f5-themes-and-options) |
| see if it helps. | [F5](#f5-themes-and-options): what carried over, and what did not and why |
| talk to the word-finder project to see how it does that | Done: [F5](#f5-themes-and-options), "Where it came from" |

## Order of work

1. **Done.** Write the layout and interaction spec
   ([F3f](#f3f-consistency-rules)) into this file, and send it to the owner
   with the questions (see above).
2. **Done.** Shared parts first, each with its tests: the in-page ask dialog
   in place of every `window.confirm()` (`AskDialog`, `js/ask.js`), one
   menu/popover helper shared with the simulator's settings popover
   (`Popover`, `js/popover.js`), and a target switch class (`TargetSwitch`,
   `js/targetswitch.js`).
3. **Done.** [F2](#f2-file-actions-in-one-menu): it shortens the Program
   toolbar, which was what held the right column narrow.
4. **Done.** [F3](#f3-one-layout-for-both-tabs) and F3a to F3e: one
   right-column width, the foot bar aligned to the columns, the simulator
   view fixed, and the owner's later ask: landscape first, more of the
   width, panes that fold.
5. [F1](#f1-a-simulator-for-the-drive-tab), then
   [F3g](#f3g-normal-and-advanced-on-both-tabs), which builds on F1's target
   switch.
6. [F3h](#f3h-both-sticks-shown-disabled-by-scheme): the biggest change to the
   Drive tab's arbitration.
7. [F4](#f4-other-buttons).

[F5](#f5-themes-and-options), themes and the Options gear, came later and
was done beside steps 1 to 4, by its own thread.

After each step: the panel tests, `tools/check_protocol.py`, layout measured
at 375, 1024 x 768, 1180 x 820, 1280 and about 1600 px (see the handoff for
how, without the desktop pane), and `/code-review` rounds until one comes back clean.

## The owner's answers

Every "Ask the owner" question below, numbered as they went to the owner in
one message on 2026-10-03, with the spec. Work goes on with the default
until an answer comes; record each answer here, and amend the item and the
spec it changes.

| # | Item | Question | Default | Answer |
|---|---|---|---|---|
| 1 | F1 | In Simulator mode, does Stop still send STOP to a connected rover? | yes | none yet |
| 2 | F1 | In Simulator mode, does Autonomous act on the simulator only, or is it disabled? | the simulator only, saying exploring is not simulated | none yet |
| 3 | F1 | Do Drive and Program share one simulated world (room, trail, pose)? | yes | none yet |
| 4 | F1 | On a phone's Drive tab in Simulator mode, does the view replace the scan fan, or fold away? | replace the fan; the readouts stay | none yet |
| 5 | F2 | One menu with the examples in it, or Examples kept as its own dropdown? | one menu | none yet |
| 6 | F2 | Clear inside the menu, last, behind an in-page question? | yes | none yet |
| 7 | F2 | Should the simulator's 1x / 2x / 4x become a dropdown? | only in a narrow view | none yet |
| 8 | F3 | A slightly narrower Program editor at 1280 px, for one column width on both tabs? | yes | none yet |
| 9 | F3a | Does "biggest buttons" mean too big? | shrink them modestly; Stop stays the most prominent | none yet |
| 10 | F3b | "drive/program at the top": keep them there, or a complaint? | keep them at the top, as the switch row | none yet |
| 11 | F3c | The rover's data on the right at all times, or not shown without a rover? | at all times, with an empty state | none yet |
| 12 | F3d | A wider right column for the fan, or a narrower one for the editor? | the middle: `clamp(320px, 30vw, 460px)` | none yet |
| 13 | F3e | May the simulated room be drawn turned 90 degrees? | no: north stays up | none yet |
| 14 | F3e | Does the Program console move under the simulator, or stay under the editor? | under the simulator on wide screens 861 px tall or more, under the editor on shorter ones | none yet |
| 15 | F3g | With a rover connected and the target on Simulator, does the simulator's scheme follow the rover's? | its own, starting from the rover's | none yet |
| 16 | F3g | Should NORMAL refuse pivots in programs outright (a firmware change), or keep asking? | keep asking | none yet |
| 17 | F3h | What does the second stick drive? | the pivots | none yet |
| 18 | F3h | Should the PS3 pad's right stick get the same mapping (a firmware change)? | no, not in this round | none yet |
| 19 | F3h | On an upright phone: two smaller sticks, or one stick with the pivots shown disabled? | two smaller sticks | none yet |
| 20 | F4 | Which reading of "other buttons" was meant, and is the split right? | all three; PS3 Cross = STOP and keyboard keys now, the rest later | none yet |

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
drawn by one `SimView` in `#simSlot`, and one `TargetSwitch`
(`js/targetswitch.js`), drawn as the Program toolbar's Rover | Simulator
switch (`#programTarget`), picks where Run goes.
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
row beside Normal | Advanced: the `TargetSwitch` moved there, under one
storage key read once from the old `rover.programTarget`. In Simulator mode `app.js`
gives the Driver a sink in place of the Link: an adapter whose
`send({move, speed, duration})` calls a new public `SimTarget.command()` that
mirrors `Rover::command` (STOP stops, RESUME_AUTONOMOUS explores, an unknown
code stops, speed 0 releases). One SimTarget and one SimView serve both tabs.
On a switch: one STOP to the old target only if it was driving, abort a
running program. Playback held at 1x while the Drive tab drives the
simulator, the faster speeds disabled with a title saying why, both as
buttons and in the narrow view's playback list. Stop also
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
ends it and only the Driver's moves reach the simulator; the narrow view's
playback list holds 1x too.

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

**Done** (step 3). The Program toolbar holds the Rover | Simulator switch,
Run, Stop program and one File menu button (`#programMenu`). Its menu
(`#programMenuList`) holds the four examples under an Examples heading
(the group `#programExamples`), a separator, Import…, Export, a separator
and Clear, built on `Popover` and following the spec's *Menus*. The menu is
named File, not Program as proposed below, because the tab is already called
Program. Export works mid-run; the examples, Import and Clear only while
idle, and stay in the menu otherwise, disabled, with a title that says why
("Stop the program first", or "Nothing to clear"). Loading an example or
importing over a program, and Clear, ask first in the page's one `<dialog>`
(`AskDialog`), and so do Blockly's own questions (deleting every block, or a
variable still in use).

Where the 1x / 2x / 4x buttons would leave the room's name too little of
the simulator's bar, a playback list (`.sim-speed-pick`) takes their place,
setting the same speed; while paused it shows none, as no button is pressed
then. Narrower still, the room's name takes a row of its own. The widths
(`css/sim.css`) are measured, and follow the tools' size: the list below
421 px of the bar in the one-column layout and 349 px in the wide one, the
room's own row below 340 and 304. So the bar is one row from 340 px (390 px
phones and up) and at 1280 to 1600 px, and two rows on a 375 px phone, at
480 x 320 and at 960 x 540, with every room's name in full. (F3 made the
tools one size on every layout, so the widths are 421 and 340 everywhere:
see F3e.)

At 1280 and 1600 px the toolbar is one row at today's right-column width (it
took two at 1280); F3 re-checked it at the new one: one row from 1024 to
1600 px. On an upright phone it
still takes three rows (the switch, Run and Stop program, the menu), until
F1 moves the switch to the header.

**Before**, for the record: the toolbar held Examples (a `<select>` used as
an action menu), then Export, Import and Clear as buttons, needing 900 px
for one row, which is what held the Program tab's right column narrow
(F3d); Examples, Import and Clear asked with `window.confirm()`.

**Binding rules.** No packages, so the menu is hand-written. Run's question
lives in a `<dialog>`, never `window.confirm()`: desktop Chrome blurs the
window after its own dialog, and blur stands the Driver down. Import's file
picker needs user activation, so the menu item's click handler calls
`#programFile.click()` directly. All four actions stay.

**Proposal** (as written; built, with the menu named File). One menu button
("Program", `aria-haspopup="menu"`) holding the four examples, Import...,
Export, a separator, and Clear last, the items keeping their ids. Built as
one small class shared with the simulator's settings popover (open and
close, Escape, a press outside, focus back to the button). Replace the three
`window.confirm()` calls with the page's `<dialog>` by generalising
`ProgramTab.#ask`. Keep the enable rules.

Which menus, and how many: the new File menu; the simulator's room
`<select>` and settings popover, which are menus already; and the
simulator's 1x / 2x / 4x as a `<select>` only where the simulator's bar is
narrower than its buttons need (below about 360 px). Everything else stays a
visible control, for the reasons in
[Menu or explicit](#menu-or-explicit-every-control).

**Ask the owner.**
- One menu with the examples in it, or Examples kept as its own dropdown?
  *(default: one menu)*
- Clear inside the menu, last, behind an in-page question? *(default: yes; it
  is undoable with Ctrl+Z, Cmd+Z on a Mac, in the editor, and moves
  nothing)*
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
asks to keep them apart) are in one menu, no `window.confirm()` is left in
the panel, the toolbar fits one row at the new right-column width, and every
control sits where [Menu or explicit](#menu-or-explicit-every-control) puts
it. All but the right-column width hold now; F3 checks that.

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

**Also asked** (the second message): "make inwdows collapsible wherever
needed", and, since the panel "will mostly be landscope mode in either laptop
or ipad like device", "use more width". Both were taken up in step 4: see
**Done** below.

**Ask the owner.** Is a slightly narrower Program editor at 1280 px fine in
exchange for one column width on both tabs? *(default: yes)*

**Done when** at 375, 1280 and about 1600 px every pane edge lines up with the
one above or below it, on both tabs, and the stick never moves on a tab
switch, a link change or a target switch.

**Done** (step 4). One `--rail`, `clamp(320px, 30vw, 460px)`, beside both
tabs (320 px at 1024, 384 at 1280, 460 at 1600), used by the address and
Connect, the note, the fault, the scan and the readouts, and Autonomous, all
from one left edge; the shell's grid is the same beside both tabs, and
`--stick` budgets that one rail. Measured in the headless shell at
1024 x 768, 1180 x 820, 1280 x 800, 1440 x 900 and 1600 x 900: every part
of the right column shares one x and width on both tabs, both tabs' content
starts 142 px down, and the stick's box is the same before and after a tab
switch, a target switch, a fold and a link coming and going. The phone
layouts (375 x 812, 480 x 320, 812 x 375, 768 x 1024) measure as before
but for the console's place and the empty state.

The owner then asked for landscape on a laptop or an iPad first, more of
the width, and windows that fold where needed. The rail takes 30% of the
width rather than a fixed share per tab, the simulator's view folds on
every layout (F3e), and the right column does not fold, because F3c keeps
it on screen at all times.

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

**Done** (step 4). Stop starts at the left pane's edge, 480 px wide at every
wide size measured, and Autonomous fills the cell under the rail; both are
56 px tall. Stop keeps its red fill and glow, Autonomous its raised fill,
lit while the rover explores. The phone bar is unchanged.

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

**Done** (step 4), but for 480 x 320. Both tabs' content starts at the
same height on every layout, and no label overflows at 375 x 812,
812 x 375 or any wide size. At 480 x 320 "Program", "Normal" and
"Advanced" still overflow: the middle column there is 101 px, a segment 50,
and "Program" needs more even with its padding cut to 4 px. Fixing it
takes a narrower stick or right column at that size, a layout change of its
own, so it stays open below.

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

**Done** (step 4). Until the rover's first frame the scan's card says "No
rover connected: its scan shows here" over the fan's empty rings, at the
card's full size, on both tabs and at every width but the smallest cards
(under 189 x 90 px, where the readings go too). `ScanView.clear()` marks it
(`svg[data-empty]`), and panel.css shows it only while no link is up: with
a link up and its first frame to come, the link pill says so. A link that
goes keeps its last scan, dimmed, as before. The column's width never
changes with the link.

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

**Done** (step 4). One width, as F3 says. The scan fills the column beside
both tabs, 459 px tall at 1280 x 800 and 559 at 1600 x 900 on either tab,
with the readouts at the column's foot and no empty row.

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
  editor? *(default: under the simulator on wide screens 861 px tall or
  more, under the editor on shorter ones, where under the view it left the
  room a strip; first "under the simulator on wide screens")*

**Tests.** `sim.test.js`'s view tests (drag, the turn handle, "the view: a
bearing to the rover's left reads, and is drawn, on its left", pause, bump
marks, frames), plus a new one that SimView sets `--room-aspect` for each
room; `panel.test.js`'s `#simSlot` placement tests.

**Done when**, for each of the four rooms at 1280 and about 1600 px on the
Program tab (and on the Drive tab once F1 lands), the room fills its stage's width or height with no empty band above
or below it taller than 24 px, and on a phone the view fits above the dock
without moving it.

**Done** (step 4) on the Program tab; the Drive tab's view and the phone
check are F1's. In the wide layout the view sits beside the editor, after
its fold strip, and takes 44% of the pane (`clamp(260px, 44cqw, 560px)`:
280 px at 1024, 364 at 1280, 472 at 1600). SimView puts the room's aspect
(`--room-aspect`) and its margins (`--room-pad-x`, `--room-pad-y`, from
`SimView.PAD`) on `#simSlot`, and sim.css gives the stage the height the
room needs at the view's width, up to the stage's height. On a screen 861
px tall or more the console sits under the view and takes what is left, at
least 120 px and never less than its content, its log as tall as that
allows. Shorter, as most laptop and iPad windows are, the console goes under
the editor and the view has the column's height: under the view, the
console left the room a strip across a wide column (the living room 122 x
92 px at 1366 x 657, now 298 x 224; 174 x 131 at 1024 x 768, now 244 x
183). Measured for all four rooms from 960 x 540 to 1920 x 969, the room
fills its stage's width or height, with only SimView's own margins above and
below it (19 and 23 px: the badge and the scale bar). The settings hang from
the bar over what is under the room, so a corridor's short view still has
room for them. The key stays in the settings on a wide screen: under the status
it cost the room its height.

The view folds on every layout now, for the owner's "collapsible wherever
needed": beside the editor its heading is a strip down its side, and
folded, only the strip stays, the editor takes the width (580 px instead of
288 at 1024 x 768) and the console goes under the editor. A fold, or the
console growing under the editor, changes the editor's size, and Blockly
refits only to a window's resize, so the Program tab watches the editor's
box and refits it. It starts folded
unless the target is the simulator, as it always did on a phone, and
choosing the simulator unfolds it. The simulator's bar is 44 px tall on
every layout (the spec's one control height), so the bar is one row from
1280 px and two at 1024 and 1180, with every room's name in full.

### F3f. Consistency rules

**Asked:** "please make things consistent"

**Today**, besides F3 to F3e: the family selector is hidden under NORMAL
rather than shown disabled, and on a phone it comes and goes above the stick;
the scheme toggle is greyed with no link; the target switch exists on the
Program tab only; the simulator's buttons are 32 px tall on wide screens and the
Program toolbar's 44 px.

**The spec.** Every item from here on follows it, and an answer from the
owner amends it here. The items name the parts they apply; a part no item
has applied yet describes the target, not today's page.

*Layouts.* Three, chosen by the viewport as today: **wide** (960 px wide and
521 px tall and up), **a phone on its side** (landscape, 520 px tall or
less), and **a phone upright** (the rest). Every check is made at 375 x 812,
480 x 320 and 812 x 375 for the phones, and 1024 x 768 and 1180 x 820 (a
laptop or an iPad on its side, which the owner puts first), 1280 x 800 and
about 1600 x 900 (the owner's screen) for wide, on both tabs.

*Regions.* Four, in this order on screen and in the focus order, on every
layout and both tabs:
1. The header: the wordmark, the status pills and the Options gear; the
   address, Connect and the note; and the switch row.
2. The open tab: its own action row first (the Program toolbar), then its
   content.
3. The right column: the rover's data, at all times (F3c): the motor fault,
   the scan and the readouts.
4. The foot bar: Autonomous, then Stop, the last control in the focus order.

*The switch row.* One header row holds every page-wide switch and nothing
else: Drive | Program, Normal | Advanced, and Rover | Simulator once F1 moves
it there, in that order, each a segmented control of the one control height.
A tab's own actions never go in it, and a page-wide switch never goes in a
tab.

*Columns, wide.* The left pane (the open tab) and the right column, the
same two widths on both tabs. The right column is one `--rail`,
`clamp(320px, 30vw, 460px)` (384 px at 1280, 460 px at 1600), used by every
part of it: the address and Connect, the note, the fault, the scan and the
readouts, and the foot bar's Autonomous, all starting at one left edge. One
gap between the columns, one gutter at the page's edges. Both columns start
on one line under the header: the left pane's top is the Program toolbar's
on the Program tab and the dock's on the Drive tab.

*The foot bar.* Its two cells sit under the two columns. On wide, Stop
starts at the left pane's left edge and is as wide as that pane up to
480 px, and Autonomous fills the cell under the right column, so a hand
reaching for Stop never lands on Autonomous. Both are 56 px tall, the two
largest controls on the page, Stop the most prominent (its red fill), and
Autonomous a raised secondary button, lit while the rover explores. On a
phone the bar stays as today: Autonomous | Stop, Stop under the right thumb.

*Control heights.* One height for every ordinary control on every layout:
`--tap`, 44 px, the touch floor. That covers buttons, segmented controls,
selects, the address field, menu buttons, the Program toolbar and the
simulator's bar (44 px on wide too since F3). The exceptions are larger, never
smaller: the foot bar's Stop and Autonomous, the Drive tab's rotate buttons
(held controls, as today) and Blockly's own controls. The one smaller is
drawn so, not touched so: the Options gear is a status pill's size, with a
full `--tap` target round it.

*Disabled, never hidden.* A control that belongs to a layout is always shown
there. When it cannot act now (the scheme, the link or a running program
forbids it) it is disabled, with a title that says why ("Advanced only",
"Connect to the rover first"). Messages are not controls: the motor fault
and the halt reason come and go, as today, and keep their line where a held
stick would move.

*Nothing moves under a held stick.* No change of the scheme, the link, the
target or a running program changes the size or place of anything above or
beside a held stick, on any layout. Disabled-not-hidden is what makes that
hold; the rules in [Rules every item keeps](#rules-every-item-keeps) still
apply.

*One way to ask.* Every question is asked in the page's one `<dialog>`
through one shared helper (`AskDialog`): the question as its text, a
confirm button that names the action ("Run on rover", "Replace", "Clear",
"Delete"), Cancel focused so a reflexive Enter does nothing, and Escape or
Cancel answering no. Blockly's own questions go through it too; only its
prompts for a variable's name (new or renamed), which need a text field, and
its note that a name is taken stay Blockly's own in-page dialogs. No `window.confirm()`, `alert()` or `prompt()`. A question is asked only before
something costly to undo: driving the rover in a way the operator may not
expect, or replacing or removing the program in the editor. Never before
Stop.

*Menus.* One shared helper for every popup (`Popover`): the Program tab's
File menu, the simulator's settings and Options. A menu holds only infrequent actions that move
nothing; every safety control, page-wide switch, primary action and held
control stays a visible, one-press control
([Menu or explicit](#menu-or-explicit-every-control)). A menu button says it
opens a menu (a chevron, `aria-haspopup="menu"`, `aria-expanded`). A click,
Enter, Space or Down opens it on its first item, Up on its last; Up and Down
move through its items and wrap, Home and End go to the ends; an item does
its action and closes the menu with the focus back on its button; Escape
closes it the same way, Tab closes it and moves on, and a press outside
closes it. An item that cannot act now stays in the menu, disabled. A
popover that is not a menu (the simulator's settings, Options) shares the
opening, Escape and press-outside behaviour.

*Labels.* No label overflows its control (`scrollWidth <= clientWidth`) at
any of the sizes above. An icon-only button (the simulator's pause, reset
and settings) carries its word as its accessible name and its title.

*Empty states.* A region with nothing to show yet says why in its own place,
at its full size: the right column before a rover's first frame (F3c), the
editor while Blockly loads or after it failed, the console before a run.

*Measured, not eyeballed.* Each layout change is measured in a headless
browser at the sizes above, on both tabs (the handoff says how): the column
edges, the foot bar's cells, control heights, label overflow, and that no
stick's box moved.

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
the address, a select, the speed slider, the tab list, the dialog, an open
menu or the simulator's settings, Blockly, or the simulator's rover (which already takes q/e and the arrow keys to turn
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

## F5. Themes and Options

**Asked:** "check with word-finder and add the support for themes and
options like the gear stuff it uses. see if it helps. talk to the
word-finder project to see how it does that"

**Where it came from.** Word Finder's code (`BeeBeRBaB/word-finder` at
`71d24bf`) and its project's own account of it. There, seven fixed palettes,
each Light and Dark, are one radio set of 14 tiles on the Theme page of
Settings, under a gear in the header; its owner chose no custom palette and
no follow-the-system mode. A pick sets attributes on `<html>` that select a
block of custom properties, a classic script in `<head>` puts the remembered
look on before the first paint, `theme-color` is read from the tokens again
on each change, and a script holds every look to WCAG AA.

**Done.** All of that, in the panel's shape:
- Three themes, each Dark and Light: Console, the default, the panel's own
  colours, the stick's among them (but for an echo's wedge, drawn whole
  now, below; a dragged block's marker in the page's ink rather than pure
  white; and the keys in a block's menu in `--dim` rather than Blockly's
  grey); Field, the most contrast, for glare or a bright room; and
  Blueprint, tinted navy or pale blue. Six tiles in one
  radio set, each a miniature of the panel in its look's colours, drawn by
  CSS alone (no `:has()`, which Firefox lacked before 121).
- Every colour is a token in `css/looks.css`, one block per look, keyed by
  `data-look` on `<html>`. `js/look.js` loads in `<head>` and puts on the
  remembered look (`rover.look` in localStorage, prefixed because Chrome
  gives every `file://` page one storage origin). A storage that throws, or
  an id no look has, gives the default.
- The gear (`#options`) in the header opens Options (`#optionsPanel`), the
  tiles under Theme. On an upright phone narrower than 440 px, and on a
  phone on its side, the mode pill gives way to it: Autonomous lights while
  the rover explores. Under 500 px upright the wordmark keeps its mark and
  drops its word, and on a phone on its side under 780 px the pills drop
  their lamps, so the status keeps its row. At 480 x 320, "Motors OK" is
  cut short beside the gear, and "No motor shield" is cut on a phone on its
  side about 530 to 600 px wide and 375 to 430 tall, a band main cuts it in
  too, a little narrower (the fault's card under it says it in full).
- What takes a colour as a plain value is given it again on a change:
  joy.js's stick (built again, letting go of a held stick first as a scheme
  change does: one STOP only if it was driving, and its caption asks for a
  fresh press), Blockly's theme and the browser's `theme-color`, which
  `look.js` paints in `<head>`, with the first paint. The stick's knob
  shades toward a rim of its look's own (`--stick-rim`): Console Dark's is
  the one `drive.js` gave joy.js before (`#1c1e21`), and a light look's is
  its dark teal, where the case colour had faded the knob into its well. A
  look picked on the Program tab is drawn on the stick as the Drive tab is
  shown.
  Where no look can be read (`css/looks.css` missing), the stick takes
  joy.js's own colours, and Stop still works.
- `test/looks.test.js` holds every look to the same tokens, fails a colour
  written into any other stylesheet, and holds each pairing of ink and
  surface in its audit (a hand-kept list: a new pairing adds its row) to its
  contrast: text 4.5:1, marks 3:1, quiet marks 1.1:1, and Field's ink 7:1
  and its rules 3:1. It found the scan's red echo wedge under 3:1 on the
  card at 85% opacity, so an echo's wedge is drawn whole now. Its audit
  takes in the stick's knob as joy.js shades it, at the smallest and the
  largest stick.

**Not carried over, and why.**
- Word Finder's Settings is a modal pane, the page behind it inert. Options
  is a `Popover`, not modal, like the File menu: Stop stays one press while
  it is open, where behind a modal pane's backdrop the press would only
  close the pane.
- Its game options (board, difficulty, sound) have no counterpart here. The
  setting that matters, the scheme, already shows in the header, and a menu
  would hide it ([Menu or explicit](#menu-or-explicit-every-control)).
  Options holds the look for now, and is where a later setting goes.
- Its other look settings: Letters (a larger size) and Reduce motion. The
  panel has one type scale for now, a later Options setting if wanted, and
  already follows the system's reduced-motion setting
  (`prefers-reduced-motion`, `css/panel.css`). Its Background art and
  Vibrate have no counterpart.
- Its service worker and module scripts, and the lessons that came with
  them: the panel is classic scripts opened from `file://`.

**Tests.** `test/looks.test.js` as above; `panel.test.js` for the tiles,
the remembered look and its fallbacks, the popover staying non-modal with
Stop one press, a look change under a held stick, on a hidden tab and
mid-program, the block editor built in the look and repainted, and the
panel with no look to read; `program.test.js` for Blockly's theme, built
from the look in force (two stand-in looks) under one name.

**Checks for the owner,** which need a real screen: the six looks on a
laptop and a tablet (Field Light in sunlight; the light looks' dark amber),
the gear and tiles by touch, the tiles' focus ring by keyboard, the browser
bar's colour on a phone, a `<select>`'s list in a light look, a look picked
while holding the stick, and the header on a 440 px phone and a 568 x 320
one on its side, in the phone's own font.

**Left as they were,** in every look: Blockly's keyboard-focus colours
(its own yellow and blue, which a light workspace shows faintly), and its
zoom and trash icons, drawn at 40% (under 3:1 in Console and Blueprint, as
on main).

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
| Examples | File menu | yes | was a dropdown already; replaces the program like Import |
| Export | File menu | yes | infrequent, moves nothing |
| Import | File menu | yes | infrequent; the item calls the file picker directly |
| Clear | File menu | yes | last, behind an in-page question |
| Simulator room | simulator bar | yes | already a dropdown |
| Simulator 1x / 2x / 4x | simulator bar | narrow view only | its state should show |
| Simulator Pause, Reset | simulator bar | no | quick, stateful toggles |
| Simulator settings | simulator bar | already one | a `Popover`, like the File menu |
| Simulator fold | Program tab, every layout (a strip down the view's side on wide) | no | a disclosure |
| Blockly zoom, centre, trash | workspace | no | Blockly's own |
| Options (gear) | header | yes | the look: set once, moves nothing ([F5](#f5-themes-and-options)) |

## Open from earlier work

In scope only where an item or step below says what takes it up; the rest
waits for the owner.

- **Done** (step 2): `js/programtab.js` asked with native `confirm()` to
  load an example, import over a program, and Clear, which the desktop
  app's browser pane dismisses unseen. They ask in the page now.
- At 480 x 320 on its side, the middle column is 101 px wide and the tab and
  scheme labels overflow their buttons. Found while verifying the last
  branch's landscape layout. F3b took it up and left it: cutting the
  segments' padding is not enough, and the fix is a narrower stick or right
  column at that size.
- `client/ws.py` prints a raw traceback when the rover is unreachable, where
  `client/drive.py` prints one clean line.
- No stand-in rover or project verify recipe is committed. The one used to
  verify the last branch was a Python `websockets` server on
  `127.0.0.1:8181` that logged every frame, sent telemetry every 500 ms, and
  had switch files to stop telemetry and report a motor fault. Committing one
  (under `tools/`) would make every item above checkable end to end without
  the rover.
