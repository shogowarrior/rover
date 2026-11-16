# Requested features: the next work

The owner's requests for the browser panel and the controls, from
2026-10-03. All seven steps of the [order of work](#order-of-work) are done,
and so are [F5](#f5-themes-and-options), from a second message that evening,
[F6](#f6-firmware-updates-from-the-panel), from the next morning, and
[F7](#f7-darker-looks-and-a-dark--light-toggle), from 2026-11-05;
what [F4](#f4-other-buttons) deferred waits for the owner. The owner's
comments on the try-it page on 2026-11-05, a larger view of the simulator
on the Drive tab, a one-row header and Stop beside the gear, were
[F3i](#f3i-the-drive-tab-split-for-the-view) and
[F3j](#f3j-one-header-row-stop-beside-the-gear). His comments of
2026-11-14 (the panel cluttered and confusing on a phone and everywhere,
Stop and Autonomous still huge, a pane squeezed between two others,
Normal | Advanced greyed out, and every control wanted in two cells at the
top, Rover | Simulator first) are
[F8](#f8-two-cells-at-the-top-two-panes-below), done, which answers the
comments of 2026-11-05 again and replaces the layout F3 to F3j built: two
cells at the top and two panes under them. F3's entries stay as the
history of how the panel got there.
[project/handoff.md](project/handoff.md) says where the
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

Two more came on 2026-10-04, at 02:46 and 02:56 UTC:

```text
Remind to check for ota feature as I had  and add it the the dashboard ui
```

```text
Make sure to not commit WiFi details
```

And one on 2026-11-05, at 18:52 UTC:

```text
please work on changing this cyan/teal them... i hate it. make it darker and more contrasting with for intuitive and clear controls. add dardk/light option as toggle in settings
```

Four comments on the try-it page came on 2026-11-05: on the Drive tab's
view of the simulator, on its dock, on the bar holding Stop and
Autonomous, and on the header:

```text
i had asked this to be bigger. i still see it the smallest window
```

```text
so much wasted space on this and the right most pane whatever that is for. can you please tile them vertically with a side split for the preview?
```

```text
this is BIGGG.. move it to the top next or left of setting for stop with just icon and hover to see more info. all buttons should have that

also move autonomus as a toggle
```

```text
instead of 2-3 lines...can this be converged into one line? and yet be ergonomical
```

Six more came on 2026-11-14: on Autonomous at the foot, on Stop at the
foot, and then four on the panel as a whole:

```text
Why is this here
```

```text
Why is this so big. Don't I ask for this to be moved in the top
```

```text
The UI is very cluttered right now on phone. You should work on it
```

```text
Not just phone but in general. It is not user friendly at all and confusing
```

```text
check how stupid the UI looks with a pane in b/w squzzed? please put smore work on this as i mentioned before. I am very unhappy. buttons and things take up too much space. STOP/autonmiuys are humogus and can be made much much shorter . i wnat all control in the top. the toggles can be made sleeker
```

```text
like why does the normal/advanced be disabled in drive mode. Rover or simulator should be the first option an. can we squuse all this in 2 cells at the top instead of whtever this is
```

On 2026-11-16 the owner had flashed the rover and found it scanning, trying
to move, stopping and starting over by itself. Their words, in order, the
first of them in full:

```text
the start should always be in default manual mode. it can scan the ultrasonar but the car doesnt have to move. also add a toggle for ultrasoner auto, alway front or manual (some sort of angle controller)? check if it. can fit the joystic part to control the sonar. for now. it scans, trys to move and keeps scanning, stops and then repeats the procss. I have no idea how to capture the logs. is it possible to capture the logs and metrics ? I believe i had added this feature but never tested it. take it completion. we should be able to see the logs in the UI. i think you support this already. i had also added support for ps3 controller but not sure if you have taken care of it tooo. i ha the buttons mapped for both analog sticks and turning at the top. i had other buttons mapped too but not sure. please used the other buttons and figure out a scheme. a toggle to control using ps3 should also be there. i forgot if the sixpairaccess tool is still needed but i never changed its setting so should work. with so many toggle, i am wondering if some/all can move into settings popup. will make the UI cleaner except for the ones needed in the main UI. Work on all 3 and figure oyut the UI thing i mentioned for all 3
```

```text
whatever it is doing feels like diagnostics and if so , we shpuld add an option to run diganostics checks
```

```text
think of this UI as controlling and managing, the rover. like a robot right> we are doing good so far
```

```text
check if we can introduce the concept of time series data which can help with graphs and other thigns than just sqlite for stuff. like prometheus ow whatever is popular for arduino here
```

```text
yeah use dbs insteae of jsonl file i mean better anbd faster right? we dont have to scan the whole files to get to what we need
```

```text
can you please flash to stop the rover from moving the ultrasonar and other stuffpl ease. its connected and still moving. There should also be a way to send command to it over serial/this usb along with ps3 bluetooth, wifi. As for how to handle multiple requests. there can be a queue which can be used? but then what it means is whatever was quesed for say 1 minute and the rover will not be in realtime, find a way to address this. The log should also let filter by client used to control and which control was accepted , just liek in case of multiple requests at the same time. we need to find a priority which might be helpful.  lets put this in settings which the rover can use. also this settings can be cionfiguration (json. ini, yaml whatever) which can be saved from restart to restart and are global. Like run diagnostics boolean can also be part of the global config. we expose it as UI but behind the scense, it can be a config file saved on the rover in any case, the format of command from any source should be in same format if you havent done already. This will ensure optiomnal resuable code. keep that ibn mind do the immideate flash first as i said to stop moving and keep working on these and intergrate with your existing plan as it makes sense
```

```text
i have disconnected the rover for now so flashing can be done later
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
| Remind to check for ota feature as I had | Done: [F6](#f6-firmware-updates-from-the-panel), "What was there" |
| and add it the the dashboard ui | Done: [F6](#f6-firmware-updates-from-the-panel) |
| Make sure to not commit WiFi details | Done: [F6](#f6-firmware-updates-from-the-panel), the last bullet of "Done" |
| please work on changing this cyan/teal them... i hate it. | Done: [F7](#f7-darker-looks-and-a-dark--light-toggle), no teal left in any look |
| make it darker and more contrasting | Done: [F7](#f7-darker-looks-and-a-dark--light-toggle), Console Dark on black, controls edged at 3:1 |
| with for intuitive and clear controls. | Done: [F7](#f7-darker-looks-and-a-dark--light-toggle), the chosen segment inverted, one job per hue |
| add dardk/light option as toggle in settings | Done: [F7](#f7-darker-looks-and-a-dark--light-toggle), Dark \| Light in Options |
| i had asked this to be bigger. i still see it the smallest window | Done: [F3i](#f3i-the-drive-tab-split-for-the-view), then [F8](#f8-two-cells-at-the-top-two-panes-below) |
| so much wasted space on this and the right most pane whatever that is for. | Done: [F3i](#f3i-the-drive-tab-split-for-the-view), "Before" says what the pane was; then [F8](#f8-two-cells-at-the-top-two-panes-below), which took the right-most pane away |
| can you please tile them vertically with a side split for the preview? | Done: [F3i](#f3i-the-drive-tab-split-for-the-view), then [F8](#f8-two-cells-at-the-top-two-panes-below) |
| this is BIGGG.. move it to the top next or left of setting for stop with just icon and hover to see more info. | Done: [F3j](#f3j-one-header-row-stop-beside-the-gear) on a wide screen, then [F8](#f8-two-cells-at-the-top-two-panes-below) on every layout |
| all buttons should have that | Done: [F3j](#f3j-one-header-row-stop-beside-the-gear): every button on the page has its hint on hover; [F8](#f8-two-cells-at-the-top-two-panes-below) keeps it, and names every icon-only button |
| also move autonomus as a toggle | Done: [F3j](#f3j-one-header-row-stop-beside-the-gear), "Autonomous is a toggle"; [F8](#f8-two-cells-at-the-top-two-panes-below) makes it a switch in the top |
| instead of 2-3 lines...can this be converged into one line? and yet be ergonomical | Done: [F3j](#f3j-one-header-row-stop-beside-the-gear) on a wide screen, then [F8](#f8-two-cells-at-the-top-two-panes-below): one row of two cells, or two rows of one on a narrow screen |
| Why is this here (Autonomous at the foot) | Done: [F8](#f8-two-cells-at-the-top-two-panes-below), no foot bar on any layout |
| Why is this so big. Don't I ask for this to be moved in the top (Stop at the foot) | Done: [F8](#f8-two-cells-at-the-top-two-panes-below), Stop a red icon in the top on every layout |
| The UI is very cluttered right now on phone. You should work on it | Done: [F8](#f8-two-cells-at-the-top-two-panes-below) |
| Not just phone but in general. It is not user friendly at all and confusing | Done: [F8](#f8-two-cells-at-the-top-two-panes-below) |
| check how stupid the UI looks with a pane in b/w squzzed? | Done: [F8](#f8-two-cells-at-the-top-two-panes-below), two panes on every layout, never three |
| please put smore work on this as i mentioned before. I am very unhappy. | Done: [F8](#f8-two-cells-at-the-top-two-panes-below), built in three steps and two rounds of a critic's screenshots at twelve sizes |
| buttons and things take up too much space. | Done: [F8](#f8-two-cells-at-the-top-two-panes-below) |
| STOP/autonmiuys are humogus and can be made much much shorter . | Done: [F8](#f8-two-cells-at-the-top-two-panes-below) |
| i wnat all control in the top. | Done: [F8](#f8-two-cells-at-the-top-two-panes-below) |
| the toggles can be made sleeker | Done: [F8](#f8-two-cells-at-the-top-two-panes-below) |
| like why does the normal/advanced be disabled in drive mode. | Done: [F8](#f8-two-cells-at-the-top-two-panes-below), never greyed for want of a link |
| Rover or simulator should be the first option an. | Done: [F8](#f8-two-cells-at-the-top-two-panes-below) |
| can we squuse all this in 2 cells at the top instead of whtever this is | Done: [F8](#f8-two-cells-at-the-top-two-panes-below) |
| the start should always be in default manual mode. it can scan the ultrasonar but the car doesnt have to move. | Done: [F9](#f9-a-rover-to-manage-manual-at-boot-settings-logs-and-three-controllers) |
| a toggle for ultrasoner auto, alway front or manual (some sort of angle controller)? ... fit the joystic part to control the sonar | Done: [F9](#f9-a-rover-to-manage-manual-at-boot-settings-logs-and-three-controllers), the sonar setting and its aim |
| is it possible to capture the logs and metrics ? ... we should be able to see the logs in the UI | Done: [F9](#f9-a-rover-to-manage-manual-at-boot-settings-logs-and-three-controllers) |
| please used the other buttons and figure out a scheme. a toggle to control using ps3 should also be there. | Done: [F9](#f9-a-rover-to-manage-manual-at-boot-settings-logs-and-three-controllers) |
| i forgot if the sixpairaccess tool is still needed | Answered: [F9](#f9-a-rover-to-manage-manual-at-boot-settings-logs-and-three-controllers) |
| with so many toggle, i am wondering if some/all can move into settings popup | Done: [F9](#f9-a-rover-to-manage-manual-at-boot-settings-logs-and-three-controllers), in Options |
| we shpuld add an option to run diganostics checks | Done: [F9](#f9-a-rover-to-manage-manual-at-boot-settings-logs-and-three-controllers), the checks |
| introduce the concept of time series data ... like prometheus | Done: [F9](#f9-a-rover-to-manage-manual-at-boot-settings-logs-and-three-controllers), `client/ws.py --prometheus` |
| use dbs insteae of jsonl file | Done: [F9](#f9-a-rover-to-manage-manual-at-boot-settings-logs-and-three-controllers), SQLite (`client/ws.py --db`) |
| can you please flash to stop the rover from moving | Built and merged (PR #12) for the owner's own flash: an agent never flashes |
| a way to send command to it over serial/this usb along with ps3 bluetooth, wifi | Done: [F9](#f9-a-rover-to-manage-manual-at-boot-settings-logs-and-three-controllers), the serial console |
| how to handle multiple requests ... the rover will not be in realtime, find a way to address this ... we need to find a priority | Done: [F9](#f9-a-rover-to-manage-manual-at-boot-settings-logs-and-three-controllers), a priority and no queue |
| The log should also let filter by client used to control and which control was accepted | Done: [F9](#f9-a-rover-to-manage-manual-at-boot-settings-logs-and-three-controllers) |
| this settings can be cionfiguration ... saved from restart to restart and are global. Like run diagnostics boolean | Done: [F9](#f9-a-rover-to-manage-manual-at-boot-settings-logs-and-three-controllers), in flash |
| the format of command from any source should be in same format | Done: [F9](#f9-a-rover-to-manage-manual-at-boot-settings-logs-and-three-controllers) |

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
5. **Done.** [F1](#f1-a-simulator-for-the-drive-tab), then
   [F3g](#f3g-normal-and-advanced-on-both-tabs), which builds on F1's target
   switch.
6. **Done.** [F3h](#f3h-both-sticks-shown-disabled-by-scheme): the biggest
   change to the Drive tab's arbitration.
7. **Done.** [F4](#f4-other-buttons): the PS3 pad's Cross as STOP, and
   `client/drive.py`'s keys on the panel.

[F5](#f5-themes-and-options), themes and the Options gear, came later and
was done beside steps 1 to 4, by its own thread, and
[F6](#f6-firmware-updates-from-the-panel), firmware updates from the panel,
beside steps 6 and 7. [F7](#f7-darker-looks-and-a-dark--light-toggle),
darker looks and a Dark | Light toggle, came on 2026-11-05, beside the
layout work the owner asked for the same day.
[F8](#f8-two-cells-at-the-top-two-panes-below), the two cells at the top
and two panes below, came on 2026-11-14 and replaced that layout.
[F9](#f9-a-rover-to-manage-manual-at-boot-settings-logs-and-three-controllers),
the rover as a robot to manage, came on 2026-11-16: manual at boot first
(PR #12), then the rest.

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
| 9 | F3a | Does "biggest buttons" mean too big? | shrink them modestly; Stop stays the most prominent | Too big, 2026-11-14: "Why is this so big", "STOP/autonmiuys are humogus and can be made much much shorter". Stop is a 40 x 32 icon and Autonomous a switch, both in the top ([F8](#f8-two-cells-at-the-top-two-panes-below)) |
| 10 | F3b | "drive/program at the top": keep them there, or a complaint? | keep them at the top, as the switch row | Keep them, 2026-11-14: "i wnat all control in the top". The tabs are in the top's second cell ([F8](#f8-two-cells-at-the-top-two-panes-below)) |
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
| 21 | F3j | On a phone, does Stop move to the top too? | no: it stays at the foot, under the thumb | Yes, 2026-11-14: "Don't I ask for this to be moved in the top". Stop is in the top on every layout ([F8](#f8-two-cells-at-the-top-two-panes-below)) |
| 22 | F3j | Autonomous beside Stop, or at the header row's other end? | the other end, so a reach for Stop never starts the rover exploring | none yet |

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
- On the rover target the scheme toggle shows only what telemetry reports,
  and its message is configuration, never a command; a press before the
  rover reports a scheme is a wish, sent once it does
  ([F8](#f8-two-cells-at-the-top-two-panes-below)); on the simulator
  target it shows and sets the simulator's own scheme and sends nothing.
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

**Done** (step 5), with the four defaults above. The switch is in the
header and remembers its choice as `rover.target`; a panel that remembered
the Program tab's choice (`rover.programTarget`) starts from that. On the
simulator the Driver sends to
`SimTarget.command()` in the Link's place; `command()` clamps a duration to
the firmware's 1.5 s cap (`COMMAND_DURATION_MAX_MS`, checked against
`Tuning.h`) and takes over from a preview's held motion. A link lost or gone
stale lets go of nothing driving the simulator (until F3g, a held stick,
whose scheme went with the link). The tests listed above are
in, with layout tests for the view's place, and each was checked by
breaking what it holds.

From 1180 px wide, or on a screen 761 px tall or more, the dock is as wide
as its controls and the view takes the rest of the left pane, on the rover
target too (a card says what the place is for), so the stick is the same
size on both targets. On a screen 761 px tall or more the dock's controls
go into one column under the stick: with two, the view had a strip (160 px
at 1024 x 768). Narrower and shorter, beside the dock's two columns, the
view was a strip too (112 px wide at 960 x 540, its room 20 px), so there
the dock is as it was before F1 on either target, and on the simulator the
view takes the scan's cell in the rail, the readouts staying, as on a
phone. Measured, the stick and the living room's floor:

| Screen | Stick | Floor | The view |
|---|---|---|---|
| 960 x 540 | 238 | none: the wheels and the motion, 302 x 149 | in the rail |
| 1100 x 700 | 308 | 206 x 155 | in the rail |
| 1179 x 760 | 335 | 286 x 215 | in the rail |
| 1180 x 700 | 175 | 227 x 170 | beside two columns, the stick at most 2/5 of the pane |
| 1280 x 720 | 203 | 269 x 202 | beside two columns |
| 1366 x 657 | 228 | 280 x 210 | beside two columns |
| 1536 x 730 | 275 | 377 x 283 | beside two columns |
| 1024 x 768 | 195 | 300 x 225 | beside one column |
| 1180 x 820 | 247 | 422 x 316 | beside one column |
| 1280 x 800 | 227 | 492 x 369 | beside one column |
| 1600 x 900 | 327 | 657 x 493 | beside one column |

The stick was 352 px at 1280 x 800 before: the view's room comes from it.
At every size above, the stick's box stays put through a link coming and
going, a switch of target, a pivot chosen under ADVANCED and a motor fault,
and every switch in the header takes a click at its centre. The Program
tab's view is unchanged, within 2 px.

On a phone the view takes the scan's row on the simulator target, which
under NORMAL is 143 px at 375 x 812, 131 at 375 x 667 and 132 at 360 x 560:
too short for a room anyone could read. Under 300 px the view shows the
wheels and the motion, larger, with the bar's playback, pause and reset;
under 120 px without the bar or the log; under 32 px the move alone
(`css/sim.css`). F8 since put the view's controls in one row that always
stays, with the room under it down to a view about 113 px tall (100 px
inside its padding), and the row alone under that. A tablet upright gets
the whole view under NORMAL (321 px at 768 x 1024), and the wheels and the motion under ADVANCED (263 px). The switch's own row costs a phone 54 px, and the scan
pays for it on the rover target too (143 px at 375 x 812 against 197
before). On a phone 600 px tall or less, every phone on its side among
them, the Drive tab leaves the switch to the Program tab: at 375 x 548 its
row left the scan 11 px, and choosing Pivot moved the stick 10 px; on a
phone on its side under 780 px wide it ran the head past the screen. There
the Drive tab's scan is as it was before F1. Putting the switch in a row
that already exists would win the 54 px back on taller phones; the
mark-and-status row is full once a rover is connected, and the
tabs-and-scheme row has no room for a third switch at 375 px.

## F2. File actions in one menu

**Asked:** "export/import/clear in a single dropdown. check if other things
can be put in dropdown too. there can be multiple based on what is needed.
but htink before you do as some things might be better without dropdown to
make it explicit/"

**Done** (step 3). The Program toolbar held the Rover | Simulator switch
(in the header since F1), Run, Stop program and one File menu button
(`#programMenu`). Its menu
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
1600 px. On an upright phone it took three rows (the switch, Run and Stop
program, the menu) until F1 moved the switch to the header: two now, 96 px
instead of 150 at 375 x 812.

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

**Superseded.** [F8](#f8-two-cells-at-the-top-two-panes-below) replaced
the layout F3 and its parts built (the rail, the foot bar of Stop and
Autonomous, the header's rows and pills, the fold strip) with two cells at
the top and two panes under them. F3 to F3j stay below as the history of
how the panel got there, and of the rules F8 kept; AGENTS.md describes the
panel as it is.

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

[F3j](#f3j-one-header-row-stop-beside-the-gear) amended this at the
owner's later ask: on a wide screen Stop is a red icon, 64 x 44 px, beside
the gear in the header's one row, and Autonomous a 44 px toggle at that
row's other end; the foot bar is a phone's alone. Both stay the last
controls in the focus order.

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

F1 added Rover | Simulator after Normal | Advanced: the same row on a wide
screen, and a row of its own under the other two on a phone, where the row
has no room for a third switch. On a phone 600 px tall or less, every phone
on its side among them, the Drive tab leaves it to the Program tab (F1 says
why). From 960 to 999 px wide the tabs and the scheme are a step narrower,
or Advanced ran under Rover. Both tabs' content still starts at the same
height, and no label overflows at 375 x 812, 812 x 375 or any wide size; at
480 x 320 the switch is on the Program tab only, where "Simulator"
overflows as the others there do.

[F3j](#f3j-one-header-row-stop-beside-the-gear) put the switch row in the
header's one row on a wide screen, each segment an icon with its word as
its name and a hint on hover, so the 960 to 999 px step is gone.

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

F1 amended "never takes its place on a wide screen": from 960 to 1179 px
wide under 761 px tall the left pane has no room for the view beside the
dock, so on the Drive tab on the simulator target it takes the fan's cell
in the rail, as on a phone, and the readouts stay. Everywhere else on a
wide screen the fan keeps its place on both targets.

[F3i](#f3i-the-drive-tab-split-for-the-view) amended this again at the
owner's later ask: beside the Drive tab on a wide screen the scan is the
left side on the rover target, the simulator's view takes its place on the
simulator target, and the readouts are under the dock. Beside the Program
tab the right column is as before, at all times.

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

[F3i](#f3i-the-drive-tab-split-for-the-view) amended this at the owner's
later ask: beside the Drive tab the right column is the dock's, with the
readouts under it, and the scan is the left side on the rover target.
[F3j](#f3j-one-header-row-stop-beside-the-gear) then put the address, the
note and Autonomous in the header's one row.

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
else: Drive | Program, Normal | Advanced, and Rover | Simulator, in that
order, each a segmented control of the one control height. On a phone the
row wraps, Rover | Simulator under the other two.
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

Amended at the owner's later asks, by
[F3i](#f3i-the-drive-tab-split-for-the-view) and
[F3j](#f3j-one-header-row-stop-beside-the-gear): on a wide screen the
header is one row, 44 px tall, which holds Stop and Autonomous (still the
last controls in the focus order) and the switch row as icons, each
carrying its word as its accessible name and its hint as its title; the
foot bar is a phone's alone; and beside the Drive tab the right column is
the dock's, with the readouts under it, the scan being the left side on
the rover target.

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

**Binding rules.** On the rover target the toggle shows only what telemetry
reports, and its message is configuration. Never filter the motion menu by scheme: Blockly
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

**Done** (step 5), with both defaults above. On the simulator target the
toggle is bound to the simulator (`SchemeToggle.bind()`): it shows the
simulator's scheme, always known and never stale, and a choice sets it at
once, with nothing to confirm and nothing sent over the Link. The Drive
tab's family follows it as it follows the rover's, so the pivots can be
tried with no rover. While the rover is the target the simulator takes the
rover's scheme, so a switch to the simulator starts from it; there it is
its own, and the rover's reports are kept for when the rover is the target
again. A request to the rover still pending is not marked on the
simulator, and lands as ever. Because the rover's link no longer carries
the scheme the simulator drives with, a lost or stale link now lets go of
nothing driving the simulator, a held stick included.

In the blocks, under NORMAL (the target's), each enabled drive block that
pivots carries Blockly's warning, on two lines: a pivot, kept off the stick
and the pad by NORMAL, and Run on the rover asks first. It comes and goes
with the scheme and as blocks change; a disabled block, or one inside a
disabled block, carries none, and Run does not ask about it. Blockly echoes
a warning inside a collapsed block on the block that folds it and clears
the echo only when it is expanded, so the editor clears an echo left
holding no warning. The
menu's pivot entries are not relabelled: a dropdown's label is also what
the block shows, so "Advanced" would stay on a block after a switch to
Advanced, and the warning already says it. Checked in a headless browser
with Blockly 13.3.0: the Mecanum tour's eight pivots warn under NORMAL on
either target and under no other scheme, and nothing reaches the Link.

The tests named above pass, `sim.test.js`'s now named for the rover target.
New ones hold the toggle on the simulator with no rover, the start from the
rover's scheme, a pending request across a switch, the editor told the
target's scheme, the editor's marks on a stand-in workspace (a pivot in a
disabled block, a collapsed block's echo), and the warning's words for
each of the 18 motions, each checked by breaking what it holds. Panel
tests 251/251.

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

**Done** (step 6), with the three defaults above: the second stick drives
the pivots, the pad is unchanged, and an upright phone has two smaller
sticks. The left stick always translates; the right one drives the pivots
by quadrant, with Pivot | Pivot sideways over it. Under NORMAL the right
stick and its switch stay on screen, dimmed, take no press, and the line
over the stick says "Advanced only." (its title says why); under ADVANCED
the line is the caveat, "Untried: go slow.". The Driver tracks the two
sticks apart: the rotate button pressed last wins, then the stick pressed
last, then a program, and letting go of one hands the rover back to the
other if it is still held. Two thumbs at once work, a touch the system
cancels lets go of its own stick only, and a mouse released anywhere lets
go of both. A change to NORMAL lets go of a held pivot stick (one STOP,
only if it was driving), and once ADVANCED is back the line over it asks
for a fresh press; the translate stick, the rotate buttons and a program
carry on. Choosing a family under a held pivot stick re-steers it at once.

Every layout has the same controls: the family's row over the pivot stick,
the translate stick's caption over the left, and the rotate buttons and
the speed under the two. A phone upright has them in the dock over Stop; a
phone on its side has a stick down each edge, with the header, the scan,
and Stop and Autonomous in the middle; a wide screen has them side by side
in the dock, and from 1180 px wide beside the simulator's view, each stick
then at most a quarter of the pane. The layouts that stacked the controls
in one column on a tall wide screen are gone. Each stick's size is a
budget from the viewport, its sum written in `css/panel.css`. Measured in
a headless browser at 320 x 568 to 412 x 915 upright, 568 x 320 to
1000 x 500 on its side, 768 x 1024 and 820 x 1180 (iPad), and 960 x 540 to
1920 x 1080: no stick moves through a scheme change, a family change, a
press request, a motor fault or a lost link on the simulator target, and
the Stop bar never covers either stick. Sticks: 162 px at 375 x 812, 112
at 375 x 548, 210 at 740 x 360 on its side, 282 at 1024 x 768, 202 at
1280 x 800 beside the view. Still as on main: with no rover connected the
address row runs a 548 to 667 px tall phone, and a 568 x 320 phone on its
side, a little past the screen, when nothing can drive. At 480 x 320 on
its side, the label overflow listed under open items, "Pivot sideways",
Autonomous and Stop run 2 to 4 px past their buttons.

The review round found no logic bug. It found the rotate buttons
outgrowing the stick's column at its floor, so they drop their icons
where it is narrow, and the off pivot pad taking a drag as a page pan,
which it no longer does. The README's control table and `docs/mecanum.md`
list the panel's and the pad's controls side by side; the pad reaches the
pivots with L1 or R1, and its right stick is still not read.

Tests: both sticks' arbitration, two thumbs, a cancelled touch, the mouse,
the scheme and family rules, the press requests, the refits and box moves
for each stick, both canvases' ancestors, the look rebuilding both, and the
layout's rules on a phone on its side, each checked by breaking what it
holds. Panel tests 259/259.

### F3i. The Drive tab split for the view

**Superseded** by [F8](#f8-two-cells-at-the-top-two-panes-below): the view
pane is beside both tabs now, the readouts are a line in it, and the rail
is gone. Kept as history.

**Asked** on the try-it page, 2026-11-05: "i had asked this to be bigger.
i still see it the smallest window", on the Drive tab's view of the
simulator, and "so much wasted space on this and the right most pane
whatever that is for. can you please tile them vertically with a side
split for the preview?", on its dock.

**Before.** On a wide screen the Drive tab had three panes from 1180 px
wide: the dock, the simulator's view beside it, and the rail. The view was
the narrowest (332 x 557 at 1280 x 800), each stick had at most a quarter
of the left pane with room around it, and the rail's scan, on the
simulator target, only said that no rover was connected. From 960 to
1179 px wide the view took the scan's cell in the rail (320 x 427 at
1024 x 768). The right-most pane is that rail: the rover's scan, its five
sonar bearings, over the readouts (the move, the exploring phase and the
chip's temperature), which show the rover, not the simulator.

**Done.** From 960 px wide the Drive tab splits the page in two:

- on the left, at the page's height, what the controls drive: the
  simulator's view on the simulator target, the rover's scan on the rover
  target (the card that held the view's place on the rover is gone);
- on the right one column, the dock with the readouts under it, tiled as
  asked; the column is as wide as the two sticks need, from the rail's
  width up to 45% of the screen (672 px, two 300 px sticks, at most), so
  the view is the larger side;
- the readouts keep one line and one height: each label over its value,
  the phase coming and going at the line's end, a value too long for its
  cell cut short, so nothing moves a held stick.

A first version moved the readouts under the view where the height limited
the sticks, at a height per range of widths. Its review found that it left
the view less room than before on short laptop windows (1366 x 657,
1280 x 577), with the header's two rows and the foot bar still taking
their height; F3j, in the same PR, gave that height back, and the readouts
stay under the dock at every height. The table under F3j has the sizes.

### F3j. One header row, Stop beside the gear

**Superseded** by [F8](#f8-two-cells-at-the-top-two-panes-below): the
header, its pills and the phone's foot bar gave way to two cells at the
top on every layout, Stop still beside the gear and Autonomous still a
toggle. Kept as history.

**Asked** on the try-it page, 2026-11-05, on Stop and Autonomous: "this is
BIGGG.. move it to the top next or left of setting for stop with just icon
and hover to see more info. all buttons should have that", then "also move
autonomus as a toggle"; and on the header, "instead of 2-3 lines...can
this be converged into one line? and yet be ergonomical". The comments are
quoted whole under [The request, verbatim](#the-request-verbatim).

**Before.** On a wide screen the header took two rows (the mark and the
status, then the tabs, the scheme and the target, beside the address and
the note), and Stop and Autonomous a bar across the foot, Stop 480 px wide
and both 56 px tall: about 240 px of a 720 px screen. Autonomous only ever
asked the rover to explore, lit while it did.

**Done.** On a wide screen (960 x 521 px and up) the header is one row,
44 px tall, the same beside both tabs:

- from the left: the mark; the Autonomous toggle; the status pills; Drive |
  Program, Normal | Advanced and Rover | Simulator, each segment an icon
  with its word as its name and a hint on hover (`labelSegment()`); the
  address and Connect; the note, in what the row leaves, two lines at most
  and the whole of it on hover; Stop, a red icon 64 px wide; the gear;
- Stop sits beside the gear as asked, and Autonomous at the row's other
  end, by the mark, so a hand reaching for Stop cannot start the rover
  exploring. Nor can it land on Disconnect, which leaves an exploring rover
  exploring with no link to stop it: the note, which takes no press, is
  Stop's neighbour, never under 24 px wide, and Disconnect is at least
  57 px from Stop at every size measured. The gear, Stop's other
  neighbour, only opens Options, which leaves Stop one press. Stop and
  Autonomous keep their place in the page's markup, the last controls in
  the focus order and a phone's foot bar, and the grid draws them into the
  header's row;
- up to 1280 px wide each status pill is its icon alone (the link's WiFi
  arcs, the mode's compass, the motors' wheel) in its state's colour; every
  pill is titled with what it says in full, at every width;
- the mode pill gives way to the Autonomous toggle, which shows the same,
  except on the simulator target, where the toggle shows the simulator's
  mode and the pill the rover's. That holds on a phone too, where the
  mode pill takes the motors pill's place on the simulator target (the
  rover's motors drive nothing there, and a fault still shows as its
  strip): without it nothing said a rover sent exploring before the switch
  was still moving by itself;
- every button on the page says on hover what it does: Connect (and what
  Disconnect leaves running), the rotate buttons and the speed with their
  keys, the family's two segments, Run, the File menu and its examples,
  the simulator's fold and settings, and the firmware's Choose and Update,
  as well as the header's icons;
- there is no foot bar on a wide screen: the height it and the header's
  second row took goes to the sticks, the view and the Program tab.

**Autonomous is a toggle** on every layout (`js/autotoggle.js`): on while
the target explores, as telemetry reports it, and a press turns it the
other way: pressed while off it sends RESUME_AUTONOMOUS, pressed while on
STOP, each a press as before, and a program it stops says Autonomous was
pressed, not Stop. T presses it too. Until a frame names the mode it is off, so a
press resumes, as the button did. A halted rover still reports
AUTONOMOUS: off and on again retries it at once, the second press once the
switch shows off.

On a phone the header and the foot bar are as they were, words and all,
but for the mode pill in the motors pill's place on the simulator target
(above): measured against `main` at nine phone and tablet sizes, nothing
else changed and no stick moved. On
the simulator target, F3i and F3j together:

| Screen | Stick before | Stick | Room before | Room |
|---|---|---|---|---|
| 960 x 600 | 212 | 188 | none, its row too short | 424 x 318 |
| 1024 x 768 | 282 | 194 | 284 x 213, in the rail | 459 x 344 |
| 1180 x 820 | 185 | 230 | 261 x 196 | 545 x 409 |
| 1280 x 577 | 189 | 260 | 264 x 198 | 457 x 343 |
| 1280 x 800 | 202 | 252 | 296 x 222 | 600 x 450 |
| 1366 x 657 | 205 | 271 | 344 x 258 | 542 x 407 |
| 1366 x 1024 | 217 | 271 | 326 x 244 | 647 x 485 |
| 1440 x 900 | 230 | 288 | 352 x 264 | 688 x 516 |
| 1536 x 730 | 247 | 300 | 385 x 289 | 640 x 480 |
| 1920 x 1080 | 300 | 300 | 344 x 258 | 824 x 618 |

Below 1180 px wide the sticks are smaller than before, 45% of the screen
being all the column takes; from 1180 they are larger. Beside the Program
tab the rail's scan is 147 px taller. At every size measured no stick
moves when the move's name, the phase or the chip changes, a motor fault
comes or goes, the target switches, the link goes, comes back or goes
stale, the mode changes or the scheme does, and no part of the header
leaves its row or overlaps another.

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

**Done** (step 7), with the default above: Cross as STOP and the keyboard
now, the rest deferred.

*Cross on the PS3 pad* sends STOP whether or not the pad is driving, as the
panel's Stop does, so the pad stops an exploring rover without driving it
first. It is an edge, like START: the Bluetooth callback sets a flag in the
mailbox under its lock, and `GamepadSession` acts on it once. A stick or
trigger held through it waits for centre before it drives again, or the
next pass would drive it again; with nothing held the next push drives at
once. Pressed with START in one report, Cross wins: the rover is left
stopped in manual. The README's control table, `docs/mecanum.md` and the
bench checklist's pad section list it. Host tests 142/142 (five new in
`test_gamepad`, each checked by breaking what it holds); `car_wire` and
`car_wire_gamepad` build.

*The panel's keys* are `drive.py`'s: W S forward and back, A D strafe, Q E
rotate, - and + the speed by 16 (and _ and =), Space Stop, T Autonomous. A
drive key is a Driver input like a rotate button (`holdKey()`,
`releaseKey()`, `releaseKeys()`): it drives from its keydown to its keyup,
held by where it is on the keyboard (`event.code`), the keyboard's own
repeats are not presses, and the rotate button or key
pressed last wins, one move at a time as in `drive.py` (the left stick has
the diagonals). So every stand-down lets go of a held key as it does of the
rest, and the key then drives again only from a fresh press. Space and T
click the Stop and Autonomous buttons, so they do all that those do, on
either tab, the simulator target included; Space's keydown and keyup are
both cancelled, so a focused Run, Connect or Autonomous is never clicked as
well, and a held Space stops once; Enter in the address connects and leaves
the field, so Space stops from there. The drive and speed keys act on the
Drive tab alone. Options, under the gear, lists the keys from the same
table the keyboard reads, and the buttons carry `aria-keyshortcuts`.

Where the proposal above differed: the speed slider and the tab list keep
the keys (neither takes a letter or Space, and both take the focus when
pressed, so excluding them left the keys dead after every change of speed
or tab), and so does the simulator's rover, which turns on Q and E and moves
on the arrows itself (the keyboard leaves any key the page has acted on),
so dragging it into place leaves W, A, S and D working. Keys are left alone
in text fields, selects and any `<dialog>`, while the page's dialog is open, in the File menu,
Options, the simulator's settings and the block editor (marked
`data-keys="own"`), in Blockly's pop-ups, with Ctrl, Alt or Cmd held, and
mid-composition; a keyup always counts, wherever the focus is. Ctrl, Alt or
Cmd going down lets go of every held key: macOS sends no keyup for a key let
go while Cmd is held, and the key would have driven on. So does a context
menu opening, except the sticks' and rotate buttons', which are suppressed.

The review round found two bugs and two gaps, all fixed. A key was let go
only if its keyup typed what its keydown had, and AltGr on Linux (which
sets no Ctrl or Alt) or a layout switched mid-hold left it driving: keys
are held by `event.code` now. Space and T acted on Blockly's own alert and
name prompt, `<dialog>`s it adds to the page, and T could start a rover
exploring from there. A context menu took a held key's release with it.
Enter in the address left the focus there, so Space typed rather than
stopped. The hardware-safety review of Cross found nothing; it noted that
a pad silent for 500 ms forgets a hold through Cross, as it does a scheme
change's.

Tests: `test/keys.test.js`, 20 tests, among them the table checked against
`drive.py`'s `KEYS`, each key held, re-sent and let go, repeats, the last
press winning over a rotate button and a stick, Space and T on both tabs and
with a button focused, every place a key is left alone, the modifiers, blur,
a hidden page, a context menu, a keyup that types something else, Enter in
the address, a tab switch on either target, the simulator target and the
press requests; 40 mutations of the keyboard, the Driver and the Link, none
survived. Panel tests 279/279.

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
  CSS alone (no `:has()`, which Firefox lacked before 121). [F7](#f7-darker-looks-and-a-dark--light-toggle)
  replaced the teal colours and the six tiles with a Dark | Light toggle
  and a tile per theme.
- Every colour is a token in `css/looks.css`, one block per look, keyed by
  `data-look` on `<html>`. `js/look.js` loads in `<head>` and puts on the
  remembered look (`rover.look` in localStorage, prefixed because Chrome
  gives every `file://` page one storage origin). A storage that throws, or
  an id no look has, gives the default.
- The gear (`#options`) in the header opens Options (`#optionsPanel`), the
  tiles under Theme. On an upright phone narrower than 440 px, and on a
  phone on its side, the mode pill gives way to it: Autonomous lights while
  the rover explores (since F3j, on the simulator target the motors pill
  gives way instead, and the mode pill keeps the rover's mode). Under 500 px upright the wordmark keeps its mark and
  drops its word, and on a phone on its side under 780 px the pills drop
  their lamps (since [F7](#f7-darker-looks-and-a-dark--light-toggle), Link
  and Motors OK keep theirs while all is well), so the status keeps its
  row. In Chromium no pill is cut short on a phone on its side from 480 x
  320 up, "Motors OK" with its lamp and "No motor shield" included; a
  phone's own font may still cut one (the fault's card under it says it in
  full).
- What takes a colour as a plain value is given it again on a change:
  joy.js's stick (built again, letting go of a held stick first as a scheme
  change does: one STOP only if it was driving, and its caption asks for a
  fresh press), Blockly's theme and the browser's `theme-color`, which
  `look.js` paints in `<head>`, with the first paint. The stick's knob
  shades toward a rim of its look's own (`--stick-rim`): Console Dark's was
  the one `drive.js` gave joy.js before (`#1c1e21`), and a light look's its
  dark teal, where the case colour had faded the knob into its well; since
  [F7](#f7-darker-looks-and-a-dark--light-toggle) every look's rim is a dark
  blue (Console Dark's `#1d3f73`). A
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

## F6. Firmware updates from the panel

**Asked** (2026-10-04, 02:46 UTC): "Remind to check for ota feature as I had
and add it the the dashboard ui". And at 02:56: "Make sure to not commit
WiFi details".

**What was there.** ArduinoOTA, in `src/Network.cpp` since the first commit:
`pio run -e car_ota -t upload` sends `firmware.bin` over WiFi with espota,
behind the OTA password `config.h` may set. Nothing had been removed: no
branch and no commit ever held another OTA path, and the panel never had
one. A browser cannot use espota: it starts with a UDP invitation, and the
board then opens a TCP connection back to the computer.

**Done.** The panel's own way to do what `car_ota` does, over the WebSocket
it already holds:
- The Options popover (the gear) has a Firmware section after Keys: the
  rover's running build, Choose file for a `firmware.bin`, the rover's OTA
  password, Update and Cancel, a progress bar and a status line. The
  popover stays non-modal, so Stop stays one press; an update carries on
  with it closed. The keyboard's drive keys leave the section alone.
- The image goes as binary frames of 1000 bytes, one at a time, each
  answered before the next is sent: the WebSocket library drops a frame
  whose TCP segments arrive more than 2 ms apart (`WEBSOCKETS_TCP_TIMEOUT`),
  and a frame of 1008 bytes is one segment. `FirmwareUpdate`
  (`src/FirmwareUpdate.{h,cpp}`, host-tested) runs the rules; `FlashSlot`
  writes into the other OTA slot through arduino-esp32's `Update`.
- The rover stands down as an update begins, and any motion ends the update
  (the operator's hands win, as over a program); no chunk is written while
  the wheels turn. Stop is not motion. A link lost, five seconds of silence,
  Cancel, a file that is not an ESP32 app image, a wrong password or a
  failed check ends it with the old firmware still the one that boots. When
  the image is whole, its MD5 and the whole image are verified before it is
  made the one to boot, and the rover restarts into it once at rest, in
  manual, as after any reset but a power-on.
- The OTA password, when `config.h` sets one, guards both ways in: the
  panel answers the rover's challenge as espota does, and never keeps,
  logs or sends the password.
- Telemetry carries `firmware`, the MD5 of the running image, so the panel
  knows the rover takes updates (older firmware never gets an `ota`
  message, which it would read as a STOP), shows which build runs, and says
  so when it is the file just sent.
- An image that crashes, hangs or never gets online is undone: new
  firmware is kept once it has run half a minute online, and until then the
  next reset boots the previous one and neither update path runs. This
  covers ArduinoOTA's uploads too.
- Updates from the panel need an OTA password; a rover without one refuses
  them (`LINK_UPDATE_NEEDS_PASSWORD` in `src/Features.h`). The WebSocket
  server now refuses an ordinary web page the operator has open, from
  anywhere but a file, this computer or the local network, which could
  otherwise have driven the rover. A determined page can still pose as a
  file (a sandboxed frame's origin is `null`), so only the password keeps
  one from replacing the firmware. PlatformIO's uploads work without a
  password, as before.
- Starting an update stops a program running on the rover.
- No WiFi details anywhere: the change carries no SSID, WiFi password or
  OTA password, in code, tests, docs or commits.

**Not done, and why.**
- An HTTP update endpoint (`HTTPUpdateServer`, ElegantOTA): a second
  server, CORS from a `file://` page, and an upload that blocks `loop()` for
  its whole length with no timeout of its own.
- Reconnecting by itself after the restart: the panel says to connect again.

**Tests.** `test/test_firmware_update` (the rules: one owner, the password,
stand-down and rest, motion, silence, cancel, fragments, sizes, the image
check, the restart), `test_protocol` (the messages and the telemetry key)
and `test_rover` (`atRest()`); the panel's `ota.test.js` (MD5 against RFC
1321 and Node's, the Link, when Update is offered, an update end to end,
the password, every way one ends, the restart, a program stopped);
`tools/check_protocol.py` checks the panel's copies of the names and that
its chunk fits the rover's.

**Checks for the owner,** which need the rover: [the bench
checklist](bench-checklist.md), section 10, "Updating from the panel". And
the section's look in each theme on a laptop and an iPad-size screen;
Safari is untested.

## F7. Darker looks and a Dark | Light toggle

**Asked** (2026-11-05, 18:52 UTC): "please work on changing this cyan/teal
them... i hate it. make it darker and more contrasting with for intuitive
and clear controls. add dardk/light option as toggle in settings"

**What was there.** F5's six looks, Console Dark the default: a slate case
(`#0b0d11`) with one teal accent (`#4db8a8`) for the operator's controls
and the rover doing well alike: the stick's knob, the open tab, Link, a
clear way on the scan, Autonomous lit, Run and a running program. Controls
were set apart by a lighter fill, not an edge, and the chosen segment was a
slightly lighter grey than its track. Options held six tiles in one radio
set, a tile per look.

**Done.**
- Console Dark, still the default, is black (`#000000` case, `#111214`
  cards) with white ink, and its buttons, switch tracks, fields and theme
  tiles are edged (`--edge`) at 3:1 against what they sit on (a filled
  button and a menu's rows excepted), so each reads as a control at a
  glance. The light looks and Field and Blueprint got the same edges.
- The chosen segment of every switch (Drive | Program, Normal | Advanced,
  Rover | Simulator, the stick family, Dark | Light) is inverted: the
  page's ink as its fill (`--chosen`) and its word in `--on-chosen`: the
  case colour in a dark look, white in a light one. It stays legible where
  the switch is disabled or stale, and whatever else marks the chip (a
  scheme asked for again, the open Program tab's running dot) takes the
  same ink. On the narrowest layouts (under 360 px upright, and the stick
  family on a phone on its side under about 570 px) the words are a size
  smaller, so none runs past its chip onto the frame, where that ink
  vanishes.
- The teal is gone from every look, tints included: a faint green over
  Blueprint's navy or pale blue mixed to it, so there the green tint is
  opaque and a clear way's body (`--ok-body`) a yellower green, and
  nothing fades a green out over its ground: the clear ways the scan keeps
  once the link goes are grey (by their colours: WebKit applies no filter
  to an SVG shape), the simulator's clear rays fade in `--ok-body` too, a
  running program's halo breathes in its own tint, the running block is
  edged in green with no glow, and the chosen toolbox category is ringed
  in the ink on a raised ground, not tinted. `looks.test.js` holds
  every look's greens, as drawn on their grounds, and every block colour
  out of the teal hues, and fails a stylesheet that fades a colour out. Its one job is split in two, so each
  hue has one: blue (`--live`) for the operator's own controls (the knob,
  the slider, focus, Connect, Run, the hint glyphs), green (`--ok`) for the
  rover doing well (Link's lamp, Motors OK's lamp, a clear way, exploring,
  a program running or done). Amber is caution and red is Stop, as before.
  Three judges (contrast, colour vision, what reads as "safe to drive")
  picked blue and green over one accent, because a control and a status
  then never look alike. Blue against green holds for every common
  colour-vision deficiency. Green and amber share a lightness, and in a
  light look green and red all but match for a protanope (2.4 to 4.3 apart
  in CIEDE2000, where the teal was 13.5 or more from the same red), so
  wherever any two of them meet a shape or a word tells them apart too
  (below).
- Nothing is told apart by hue alone. An all-well pill is quiet (ink and a
  green lamp), so a fault, tinted and worded in amber or red, is what
  stands out. A
  clear way on the scan is drawn open (a faint fill with a green edge),
  amber and red wedges solid; in the simulator a sonar ray closing in or
  at STOP is drawn heavy, a clear one thin, and its key the same. A lit
  Autonomous button is tinted and edged in green, not filled, and dashed
  while the link is not up; the mode pill is filled green while the rover
  explores. On a phone on its side, where the pills drop their lamps to
  fit, Link and Motors OK keep theirs.
- The Program tab's motion blocks were teal too (`PALETTE.motion` in
  `js/blocks.js`, the same in every look): they are a dusky rose
  (`#805362`), 10 or more (CIEDE2000) from every other category in normal
  vision and under simulated protanopia and deuteranopia, where the teal
  fell to 7 and an olive tried in review to 2 (it looked like control's
  brown and the stop block's red). The blocks' white text is at 6.3:1.
- Options: under Theme, a Dark | Light toggle across the popover, then a
  tile per theme (Console, Field, Blueprint), each previewed in the flavour
  in force. The toggle keeps the theme and a tile keeps the flavour. Every
  look keeps its id, so a look remembered before this change still
  applies.
- `test/looks.test.js`'s audit takes in the new pairings: the chosen
  segment's word, the edges on the case and on a card, blue and green as
  text and as marks, green's own word on its fill, and the scan's rover
  dot on its haze. Its rows for the knob at the smallest and the largest
  stick, there since F5, now hold against each look's new dark blue
  `--stick-rim`.

**Left as it was.** Console Dark and Field Dark are now close: Field
differs by its strong rules and its 7:1 ink. The "40 GO" tick on the scan
stays amber, since it marks where caution starts. The light looks' amber is
dark (it must hold as text on white), and amber and red come close in a
light look, as before: for a protanope, and as text for a deuteranope. A no-echo wedge is full length at
2.5:1, as before.

**Tests.** `panel.test.js`: the toggle and the tiles in the popover with the
look in force shown, the toggle keeping the theme and a tile the flavour,
the tiles previewing the flavour in force, a remembered look restored,
whatever is filled in `--chosen` written in `--on-chosen` (disabled and
stale chips included), a chosen scheme also asked for and the open Program
tab's running dot in the chip's ink, a disabled Run edged, the all-well
lamps on a phone on its side (Link's in a rule with no `:has()`), the
words a size down where a chip is narrowest, the running dot in its
chip's corner on a phone, the clear wedge drawn open in `--ok-body`,
gliding in its fill's opacity too, and grey by its colours once the link
goes, Blockly's flyout button in the look's ink, the chosen toolbox
category ringed in it; `sim.test.js`: each ray's zone, a near one heavy,
a clear one and its key in `--ok-body`; `looks.test.js`: the
audit above, Autonomous lit on the bare bar of a phone on its side, no
teal drawn in any look or block, no stylesheet fading a colour out over
its ground, and the motion blocks apart from every category for a
red-green colour-blind eye. Each new test fails with the
rule it checks broken.

**Checks for the owner,** which need a real screen: Console Dark and Light
on a laptop and a tablet, the toggle and the tiles by touch and keyboard,
the browser bar's colour on a phone after a toggle, and the scan's green,
amber and red in daylight.

## F8. Two cells at the top, two panes below

**Asked.** The owner's words, verbatim, newest last (all are under
[The request, verbatim](#the-request-verbatim) too):

2026-11-05, pinned on the try-it page:
- on the Drive tab's simulator view: "i had asked this to be bigger. i still see it the smallest window"
- on the dock: "so much wasted space on this and the right most pane whatever that is for. can you please tile them vertically with a side split for the preview?"
- on the Stop/Autonomous bar: "this is BIGGG.. move it to the top next or left of setting for stop with just icon and hover to see more info. all buttons should have that / also move autonomus as a toggle"
- on the header: "instead of 2-3 lines...can this be converged into one line? and yet be ergonomical"

2026-11-14:
- on Autonomous at the foot: "Why is this here"
- on Stop at the foot: "Why is this so big. Don't I ask for this to be moved in the top"
- "The UI is very cluttered right now on phone. You should work on it" / "Not just phone but in general. It is not user friendly at all and confusing"
- "check how stupid the UI looks with a pane in b/w squzzed? please put smore work on this as i mentioned before. I am very unhappy. buttons and things take up too much space. STOP/autonmiuys are humogus and can be made much much shorter . i wnat all control in the top. the toggles can be made sleeker"
- "like why does the normal/advanced be disabled in drive mode. Rover or simulator should be the first option an. can we squuse all this in 2 cells at the top instead of whtever this is"

**Before.** The page the owner looked at on 2026-11-14 was `main`, which
did not yet have F3i and F3j: they were on PR #9's branch, where this work
started. There the header took two or three rows (the wordmark and three
status pills; the tabs, the scheme and the target; the address, Connect
and the note), Stop and Autonomous were a bar across the foot, the page's
biggest buttons, and from 1180 px wide the simulator's view sat in a
narrow column between the dock and the rail: the squeezed pane. On the
Program tab a folded "Simulator" strip sat between the editor and the
rail. F3i and F3j had answered the comments of 2026-11-05 on a wide screen
only, with one crowded header row (the mark, Autonomous, the pills, three
switches drawn as icons, the address, the note, Stop and the gear); a
phone kept the header's rows, the address row and the foot bar. On the
rover target Normal | Advanced stayed disabled until telemetry named a
scheme, so with no link it was always grey, which the owner read as
broken.

**Done.** Every control but the open tab's own is in two cells at the top,
and under them are two panes, never three. AGENTS.md, "The browser control
panel", says how each part works; this says what changed and why.

- **The top: two cells**, one rounded box each, 40 px tall with controls
  32 px tall and 13 px words (a size smaller only in the narrowest cells),
  one line whatever they say, stuck to the top of the screen on every
  layout and both tabs. In one row where the top is 900 px wide or more,
  the first as wide as what it holds and the second the rest; a cell a row
  on a narrow screen (a phone or a tablet upright, and the middle column
  of a phone on its side), and under 568 px on its side the screen's width
  over the sticks. Each cell has one outline, its switches and chip told
  from it by their fill.
  - The first cell is what the controls drive and its state: Rover |
    Simulator first, as asked; Autonomous, a switch with a knob, on while
    the target explores; and the link chip.
  - The second is how they drive it: Drive and Program as text tabs, the
    open one's word over a 2 px bar, so moving between them never looks
    like a setting (the running dot kept in the Program tab's corner);
    Normal | Advanced; and at its far end Stop, a red 40 x 32 square, icon
    alone and titled with its key, beside the gear.
  - Autonomous and Stop are in different cells, so that a press that
    misses Stop can never start the rover exploring, and Autonomous sits
    near its cell's start, so that where the cells stack it is never over
    Stop (48 px from it at the least, at 320 x 568 and 568 x 320).
  - Each cell says as much as its width allows, measured (`fitTheTop()`,
    `data-fit`): in the first, the chip's address after its word wherever
    the cell has room for it, then every word, then Sim and Auto, then its
    controls closer together, then the rover's glyph for "Rover:", else
    "Rover:" kept and the alerts' glyphs for their words, then both
    glyphs, the link's word at 12 px, and last the chip filling the rest
    of the cell, its word said where it fits whole and otherwise hidden,
    never cut short; the link's word is one per state at every step, never
    a short word of its own. So the alerts keep their words longest, and
    "Rover:" outlasts Sim and Auto. In the second, every word, then its
    segments closer together in two steps, keeping 13 px words down to a
    375 px phone, then 12 px words, and on a 320 px phone alone Adv for
    Advanced. A cell counts as too narrow once its last control passes its
    content box. The step follows the cell's width alone, and each control
    is a slot as wide whatever it says, so nothing in a cell moves on a
    switch of target, a change of link or an alert.
  - Every switch (the target, the scheme, the pivot family, Dark | Light)
    is the same sleek segmented control: a pill-shaped track, words only,
    the chosen segment inverted (F7's rule).
- **The link chip and its popover.** The chip is a lamp, the link's state
  in one word for each state ("Not connected", "Connecting…",
  "Connected", "No data", "Link lost", and "Not reachable" for a rover
  that never answered), "Rover:" before it on the simulator target, and a
  caret, amber while the link is lost, stale or unreachable. It opens the
  link's popover, which holds the address, Connect and the note, and hangs
  below the cells from the chip's left edge, not modal, like Options; each
  scrolls inside where the screen is too short for it, the end with more
  past it faded. With no link the view shows a connect card over the faint
  scan, on a layer of its own (under the faint fan's, its buttons took no
  press), titled with the chip's word. Its button is a press of the
  popover's Connect that names the address it acts on: "Connect to" it,
  Cancel while connecting, "Reconnect to" it after a lost link, "Try" it
  "again" after a rover never reached, and "Connect to" another address
  typed since; where that would be cut, the verb alone, the address on a
  line of the card. Change address opens the popover with the focus in the
  address. In a view under 260 px tall the card is tighter, and under
  170 px (a phone's band over the Program tab's editor) it is one row of
  buttons under the fan, covering none of it.
- **Alerts, in words.** The spec's badges ("No motors" and "Rover
  exploring", amber) became the chip's alerts: after the chip's word, each
  in a slot of its own, amber, and in a narrow cell a glyph of its own
  shape (a motor struck through, a winding route): "No motors" while the
  rover reports that its motor shield did not answer and no scan
  shows, and on the simulator target "Rover exploring" while the rover
  reports that it explores, kept dashed as last known once the link goes,
  until a frame reports MANUAL: a Stop may not have arrived. On the
  simulator target an amber line at the top of the view says it too ("The
  rover is exploring on its own. Stop stops it."), dashed as last seen
  once the link goes, since a phone's chip shows a glyph alone. The
  popover says why in full, as the chip's title does, since a touch screen
  cannot hover.
- **Normal | Advanced is never greyed for want of a link.** Until the rover
  reports a scheme, both segments take a press as a wish, marked pending
  and titled "Sent to the rover as soon as it reports its scheme", and
  said in words in the link's popover and on the connect card ("Advanced
  goes to the rover once it connects"). The first frame that names a
  scheme settles it: one `{"scheme"}` if it differs, none if it already
  matches, and the wish is dropped either way. A press on the other
  segment replaces it, and a press on the same one drops it. While the
  simulator is the target the wish waits, unsent, and is settled once the
  rover is the target again. Stale is as before: dimmed, and the title
  says why. The wish is configuration, never a command. While Advanced is
  wished, the pivot stick's line says so: "Advanced on link", or "Advanced
  waits" for a linked rover that has yet to report its scheme.
- **Autonomous waits for the rover.** A press on the rover is a request:
  the switch shows only what telemetry reports, its track dashed while the
  request waits, until a frame reports the mode asked for or three have
  not. A press while a request is pending sends STOP, so two quick
  presses always end stopped, from off or from on, and off and on again
  to retry a halted rover waits for the switch to show off; only a press
  with nothing pending goes by the report. Any other press of the
  operator's, a new link or a lost one forgets the request. With no link
  a press sends nothing, opens the link's popover and says there that
  Autonomous needs the rover connected: a switch that did nothing read as
  broken.
- **The view pane**, one element beside both tabs. On the rover target
  the scan's card: the rings' legend ("25 cm stop · 40 cm go · 100 cm",
  12 px) a row of its own in its top-left corner, the motor fault in that
  row in the legend's place (one line, at most 520 px wide), so that
  closed it never shrinks the fan, the fan in a wide or a tall shape,
  whichever draws it the larger, its words never under 12 px (the
  bearings' names go where the fan is too small for them, then the left
  and right readings, then the rest), and the readouts (the move, the
  chip's temperature, the phase while exploring, "Halted: boxed in" in
  amber) in one line at its foot, where a card of their own used to stand,
  giving up the temperature, then a size, and their captions, the phase's
  first, only where a value would be cut. After a link goes the readings,
  the 25 and 40 cm rings and the readouts dim together. On the simulator
  target the one simulator view, its controls in one row, the same on both
  tabs but the playback speed and the clock, which the Drive tab's held 1x
  has no use for (the clock never without its "Sim time"); the move shown
  whole or not at all, never cut short; the room picked in its settings,
  the wheels' drag no longer among them, and the room taking the
  rest. Its size comes from the shell's grid, never from what it holds.
- **The hands pane**: the Drive tab's dock, or the Program tab's editor
  card, its toolbar one slim row at its head (Run, Stop program, neutral,
  never red and never shortened, the File menu, and a quiet View toggle
  that shows or hides the view pane on that tab, with no strip left
  behind), and the console's line under the editor (under the view, on a
  wide screen with the view shown); on a phone the log is behind a Log
  button and opens upward over the editor's foot. Preview shows a hidden
  view, and while a preview runs the Program tab's corner has a hollow
  green ring, where a run on the rover has the pulsing dot. Blockly's
  categories run along the editor's top on an upright phone and down its
  left everywhere else, never wrapping on a phone on its side, and packed
  tighter in a short editor, so all seven fit at 480 x 320; an editor
  under 360 px wide or 260 px tall drops the trash can and the zoom
  buttons; an example or an import opens at its top-left, zoomed to fit
  the editor's width; its scrollbars show only while the program runs past
  the view, and Export is off on an empty editor. Stop program ends a run
  with a neutral "Stopped.".
- **The dock.** Under NORMAL the pivot stick is grey, its hints dimmed,
  and its line says "Needs Advanced"; under ADVANCED "Untried: go slow".
  The dock's words are 13 px (the family 12 only in a narrow column, the
  corner hints 12, gone where the column is under 190 px); on an upright
  phone the speed takes most of its row, and on a phone on its side it is
  its value and the slider, the gauge icon gone. The stacked column on a
  wide screen is at least 230 px, so "Speed" keeps its word at 1024 x 768.
- **The layouts.** On a wide screen the view is on the left and the hands
  on the right, on both tabs, and the Drive tab stacks its two sticks in
  one column beside the view, from the owner's "tile them vertically with
  a side split for the preview": the translate stick over the pivot
  stick, each up to 280 px, the spare height spread around them. The
  Program tab gives the view a column about half the width (360 to
  640 px), the view at its top, sized to its drawing, and the console
  under it, and the editor the other side at full height: at 40% of the
  width and the column's whole height, the view's card left half its
  column empty from 1024 x 768 to 1920 x 1080. From 1800 px wide the panes
  use the screen's whole width. Upright the view is on top and the hands
  under it, the Program tab's view a band the screen's width. On a phone
  on its side the sticks run down the two edges at the screen's foot, with
  the two cells and the view between them, and the Program tab's toolbar
  takes the bands beside the cells (a row under them at 480 x 320), so the
  cells, Stop with them, stay where the Drive tab has them. No layout puts
  a pane between two others.
- **Removed:** the wordmark; the status pills; the address row; the foot
  bar of Stop and Autonomous; the rail and its readouts card; the Drive
  tab's own view slot (`SimView.moveTo()` with it) and the Program tab's
  simulator strip and fold; the icons in the tabs' and switches' segments;
  `--on-ok`, which only the mode pill used; and the wheels' drag in the
  simulator's settings, which no row of the wheel table needs
  (`releasedDrag` stays in `js/sim.js`, calibration).

**Where the build differs from the spec, and why.** The critic's two
rounds of screenshots, at twelve sizes from 320 x 568 to 1440 x 900, and
two reviews of the result by phone, tablet, laptop and code, led to these:

- The badges are the chip's alerts, not buttons of their own. As glyphs on
  a phone they were a crosshair and a compass that meant nothing without
  hover. First they took the chip's word's place, which hid "Link lost"
  and "No data" behind "Exploring" (the review); now each is a slot after
  the word. In one row the first cell widens by that slot, which comes out
  of the empty start of the second, its controls kept to its far end: from
  its start the tabs and the scheme moved up to 275 px as telemetry came,
  and a click aimed at Advanced landed on Normal (the second review).
  Nothing in either cell moves, in one row or stacked.
- On a wide screen tall enough, the sticks stack in one column beside the
  view, the translate stick over the pivot stick, rather than side by side.
  Side by side, the dock sat in the middle of a card twice its height,
  half the pane empty: "so much wasted space". Stacked, the dock fills its
  column (each stick up to 280 px, the spare height spread above, between
  and below the two groups), the view takes the rest of the width, and
  that is the owner's "tile them vertically with a side split for the
  preview". Only one stick drives at a time, so stacking costs no thumb
  anything. They stack from 564 px tall, where each stick keeps 120 px, so
  a laptop's browser (1366 x 657, or 1280 x 595 on a 1080p screen at 150%)
  stacks them too; a shorter wide screen keeps them side by side.
- The chip's address is tried wherever the first cell has room for it,
  measured, not from a fixed 1280 px; an iPad upright still has none once
  every word and the alerts' room are kept, and shows it in the link's
  popover alone. On a 390 px phone upright "Rover:" gives way to the
  rover's glyph for the same reason; on a phone on its side it stays
  beside the alerts' glyphs. On a 320 px phone the scheme says Adv:
  Advanced whole is 15 px short there, and closer still the segments'
  words meet their pills' ends.
- In the first cell Autonomous comes before the link chip, not after it:
  at the cell's far end it lay right over Stop where the cells stack (the
  critics' round 3).
- On a phone the Program tab's view starts hidden on either target, and a
  switch to the simulator does not open it: shown, it squeezed the editor
  to a strip on a 375 x 667 phone. The View toggle opens it, and so does
  Preview, so a preview never runs unseen. Where there is room for both (a
  wide screen, or a tablet upright) it starts shown, and a switch to the
  simulator shows it again.
- On a phone on its side the Program tab's toolbar is not the editor
  card's head: it takes the empty bands beside the stacked cells (Run over
  Stop program on the left, File over View on the right), and at 480 x
  320, where the cells span the screen, a row under them. Under the cells
  the editor had about 90 px; with the bands it has 170 at 568 x 320. One
  branch put the cells in one row on that tab from 700 px wide instead,
  which moved Stop on a switch of tab; the bands keep Stop where the Drive
  tab has it.
- The pivot stick's line under NORMAL says "Needs Advanced", not "Pivots
  need Advanced (top right)": that is 209 px, and the column is 120 px at
  its narrowest; Advanced is the one word of that name on the page, and
  the stick's title says where it is. Under it the stick is grey, so it
  reads as off rather than as a stick in use.

**Coverage.** Each clause, and what answers it now:

| The owner's words | What was done |
|---|---|
| i had asked this to be bigger. i still see it the smallest window | The view is one of two panes on every layout, the larger beside the Drive tab on a wide screen, its column about half a wide screen on the Program tab, and the room fills it under one row of controls |
| so much wasted space on this and the right most pane whatever that is for. | The right-most pane, the rail, is gone: the readouts are one line in the view. The stacked sticks fill their column on a wide screen |
| can you please tile them vertically with a side split for the preview? | On a wide screen the Drive tab stacks the two sticks in one column (each up to 280 px, the spare height spread around them) beside the view, which takes the rest of the width |
| this is BIGGG.. move it to the top next or left of setting for stop with just icon and hover to see more info. | Stop is a red square, icon alone, left of the gear at the end of the top's second cell, on every layout; its title says the rest |
| all buttons should have that | Every button on the page is titled, and every icon-only one has an `aria-label` (`panel.test.js`, "every button titled with what it does") |
| also move autonomus as a toggle | Autonomous is a switch in the top's first cell; a press on the rover waits, its track dashed, for the rover to report the mode, and with no link it opens the link's popover and says why |
| instead of 2-3 lines...can this be converged into one line? and yet be ergonomical | One row of two cells where the top is wide enough, two rows of one cell each on a narrow screen; no address row, no pills, no foot bar |
| Why is this here (Autonomous at the foot) | The foot bar is gone on every layout; Autonomous is in the top |
| Why is this so big. | Stop is 40 x 32 in a 40 px cell, no taller than its neighbours |
| Don't I ask for this to be moved in the top | Stop is in the top on every layout and both tabs, phones included |
| The UI is very cluttered right now on phone. You should work on it | A phone shows two cells, the view and the dock, nothing else; the Program tab shows the cells, its toolbar, the editor and the console's line (the log behind a button), the view behind its toggle |
| Not just phone but in general. It is not user friendly at all and confusing | The cells group the controls by what they decide (what you drive, how you drive it); the link and the rover's faults say themselves in words; with no link, the view says how to connect, naming the address; nothing is greyed out without its reason on screen, and a press that cannot act says why |
| check how stupid the UI looks with a pane in b/w squzzed? | Two panes on every layout, never three: no view between the dock and the rail, no strip between the editor and the rail |
| please put smore work on this as i mentioned before. I am very unhappy. | Built in three steps, then two rounds of a critic's screenshots at twelve sizes and every state, two reviews of the result by phone, tablet, laptop and code, and the fixes each found, merged and checked again |
| buttons and things take up too much space. | Controls 32 px tall with 13 px words; the Program toolbar and the simulator's bar one row each |
| STOP/autonmiuys are humogus and can be made much much shorter . | Stop a 40 x 32 square, Autonomous a 32 px switch, both inside the cells |
| i wnat all control in the top. | Every control but the open tab's own is in the two cells; the address and Connect hang from the chip |
| the toggles can be made sleeker | Every switch is one sleek segmented control, words only, the chosen segment inverted |
| like why does the normal/advanced be disabled in drive mode. | It no longer is: with no rover reporting, a press is a wish, sent once one does, and the page says so in words |
| Rover or simulator should be the first option an. | Rover \| Simulator is first in the first cell |
| can we squuse all this in 2 cells at the top instead of whtever this is | Two cells at the top, on every layout and both tabs |

**What did not change.** Stop is one press on every layout and tab, never
in a popover or under one, and does not move when the tab changes; Space is
Stop and T Autonomous. No ancestor of a stick is positioned, transformed,
filtered or contained. Nothing above or beside a held stick changes size or
place on a scheme change, a link lost or stale, a fault, an alert or a
switch of target. The Driver, the keys and the simulator's model
(`js/sim.js`) are as F3j left them, and the firmware update's messages and
rules are unchanged. The other parts changed only as Done says: Link's one
word for each state, "Not reachable", the card's words for the address and
`onSay()`; AutoToggle's pending press and its press with no link;
TargetSwitch's Sim for Simulator in a narrow cell; FamilySelector's lines
("Needs Advanced", "Untried: go slow" and a wish's); ProgramRunner's own
stop, a neutral "Stopped."; SimView's one row, its room list in the
settings and no wheel drag there, "Sim time" and the move whole or not at
all; and the Firmware section's status line, which says why Update is off.
Colours come only from `css/looks.css`'s tokens; no firmware changed.

**Tests.** Every test that pinned a removed rule was rewritten to pin its
replacement with the same intent, and none was deleted: no stick ancestor
positioned or contained; the top's cells one fixed height whatever they
say, each step of `data-fit` in its place and Stop clear of the scheme at
every one; Stop in the cells on every layout and tab; every button titled,
the View toggle both ways and the connect card's buttons among them; the
dock's rows of fixed heights, and the sticks sized from the viewport
alone; the view's size from the grid alone, one simulator view held at
1x on the Drive tab, and no frames while it is out of sight. New: the
scheme wish (made before connecting, sent with the first frame, not sent
when the frame matches, replaced, dropped, and across a lost link), the
chip's lamp, words and alert, the connect card, the View toggle's
defaults, the readouts' fit, the scan's two shapes and its fit, the
popovers' height caps and their faded ends. The contrast audit gained the
chip and its alert on their tint, the address on the alert's tint, the
tab's underline and the switch's knob. The review's fixes added: Autonomous
never over Stop where the cells stack, the chip's word for each state and
"Not reachable", the readouts' fit measured, the tablet's band one height,
the Program tab's console, Log, View toggle and compact connect card, the
operator's own stop, the dock's grey pivot stick and its sizes, the wish
waiting on the simulator target and said in words, the dialog's titled
buttons, the firmware's status line, and, from the merge, nothing on a
phone on its side laying the cells out by tab. The second review's fixes
added: the connect card on its own layer, naming its address, its verb
alone where that would be cut, and its compact row only under 170 px;
Autonomous's pending press, a press while one is pending sending STOP
(so two quick presses end stopped, from off or on), and a press with no
link; "Rover exploring" kept through a Stop until a frame reports
MANUAL, and the view's line saying it; both cells' steps, a cell's last
control inside its box, and the second cell's controls held to its far
end; the pivot stick's line under a wish; the wide Program tab's grid; the
scan's 12 px floor and its label steps, the fault in the legend's row, the
rings dimmed after a lost link and the phase's caption first; the
preview's ring; the simulator's move whole or hidden; the File menu on a
phone on its side; the editor's thresholds and an example's fit; and the
stacked dock column. The third review's fixes added: a press of
Autonomous while one waits sending STOP, from on as from off; the view's
amber line on the simulator target and the card's address wrapping to two
lines, never cut; the wide Program tab's console keeping its line and
three lines of its log on either target, the view's row giving way; a
loaded program fitted again as the editor's width changes (Preview or
View putting the view beside it), until the operator zooms or pans; and
the simulator's speed hidden with its move under 70 px. Panel tests
348/348.

**Checks for the owner,** which need real screens and fingers:

- a laptop, an iPad both ways, and a phone both ways, on both tabs and
  both targets: the two cells and the two panes, nothing cut off, and
  nothing moving under a held stick;
- touch on the cells' small controls: the segments, the chip and its
  caret, Autonomous, Stop and the gear are 32 px tall (the segments 28),
  each with a touch target that reaches 44 px over the cell's padding;
- the scheme wish with the rover: press Advanced before connecting, then
  connect, and the rover should come up on ADVANCED;
- Stop by touch and by Space with the link's popover or Options open;
- on the simulator target with the rover exploring, the chip saying "Rover
  exploring" in amber and the view's line saying so, both dashed once the
  rover's link is cut, and both staying through a Stop until the rover
  reports MANUAL;
- the pivot stick under NORMAL reading as off (grey, "Needs Advanced"),
  and as live again under ADVANCED;
- the connect card's Connect and Change address by touch, on a phone and
  an iPad, at first load: under the faint fan's layer they once took no
  press;
- Autonomous with the rover: a press dashes its track until the rover
  reports the mode, two quick presses leave the rover stopped, tried from
  off and again from on with the rover exploring, and with no link a
  press opens the link's popover and says why;
- on a phone, the chip's glyphs told apart by shape (the rover side on, No
  motors, Rover exploring) without hovering;
- a laptop's Program tab: the view's column about half the width, the
  console under the view, and the editor at full height;
- on a phone on its side, the Program tab's toolbar in the bands beside
  the cells, and Stop in the same place on both tabs;
- a touch screen's Options without the keys, and an iPad with a trackpad,
  which may count as a pointer that hovers and show them;
- on an iPhone, a tap into the address or the OTA password: their words
  are 13 px, and Safari zooms the page into a field whose text is under
  16 px, which no headless check shows.

## F9. A rover to manage: manual at boot, settings, logs, and three controllers

**Asked.** The owner's words are under
[The request, verbatim](#the-request-verbatim), 2026-11-16. In short: every
boot in manual, the sonar looking but the wheels still; a choice of sonar
(sweep, ahead, or aimed, with something to aim it); the rover's logs and
metrics, kept and shown in the panel; the PS3 pad's spare buttons put to
use, and a way to turn the pad off; checks on demand; graphs over time;
commands over the USB cable too, in the same format as WiFi and the pad;
a priority, not a queue, when several controllers send at once, and a log
that says whose command was taken; settings kept on the rover from boot to
boot; and the toggles in Options, all but those driving needs.

**Before.** A boot from the EN button, which a USB flash and opening the
serial monitor both press, started exploring (`AUTONOMOUS_AT_POWER_ON`):
the "scans, tries to move, stops, repeats" the owner saw. In manual mode
the sonar kept sweeping. The rover kept no log a client could see, and no
metrics. The pad used its sticks, triggers, L1, R1, START, SELECT and
Cross. Any client's command took control at once, the scheme was the only
setting, and it was lost at every boot.

**Done.** AGENTS.md says how each part works; this says what changed and
why.

- **Manual at every boot** (PR #12, built for the owner to flash):
  `AUTONOMOUS_AT_POWER_ON` is off, so every boot waits, stopped, until
  Autonomous (or the pad's START). It is not a setting, on purpose: any
  WiFi client can change a setting, and none may send the next power-on
  exploring.
- **The sonar in manual mode** is a setting: Front (the default: one sweep,
  so every bearing has a reading, then held straight ahead), Sweep, or Aim
  at an angle up to 80 degrees either side. The panel aims it by a drag on
  the scan's fan, or the slider in Options, and the fan draws where it
  aims; the pad's right stick pans it, R3 points it ahead and Triangle
  sweeps.
  Exploring always sweeps and weaves, whatever the setting.
- **Three controllers, one format.** The USB serial console takes the same
  JSON messages as a WebSocket client, one to a line, and the pad's presses
  become the same commands; all three go through `Control`. There is no
  queue, since a queue would leave the rover acting on what someone asked a
  minute ago. A command is acted on at once or refused: a controller that
  drove holds control for 1 s after its last command, one ranked above it
  takes over at once, one below is refused, and Stop is never refused. The
  default order is USB, the pad, then WiFi: the cable is someone at the
  bench, and the pad is in someone's hands, while any client on the network
  can send.
- **Settings on the rover**, kept in flash (NVS) as the same JSON they are
  sent in, written once they have been still for 3 s with the rover at
  rest: the scheme, the sonar and its aim, pad control, the priority, and
  whether to run the checks at boot. Any controller may change any of
  them; each change is a line in the log with whose it was. A copy that
  does not read leaves the defaults.
- **The log**: the rover's own lines (the boot and why, sweeps, decisions,
  mode changes, the shield, the links), each with whose it is (USB, PAD,
  WIFI or ROVER): who took control, whose command was refused and why,
  who changed a setting. The last 32 lines go to a client as it connects,
  each new one as it is added, and every line is echoed on the serial
  console.
- **Metrics** every 2 s: uptime, loop rate and its longest pass, free heap
  and its low mark, WiFi signal, clients, and the sonar's pings and silent
  pings.
- **The checks**: Run checks (`RUN_CHECKS`, code 20) checks the shield, pings
  each bearing three times, turns each wheel alone and then the moves, each
  result a line in the log; the panel asks first, since the moves drive the
  rover forward and sideways. They are held like a move: the panel re-sends
  `RUN_CHECKS` while they run, and once a client stops (a closed panel, a
  script that died) no other wheel turns. A single `RUN_CHECKS` typed into
  the serial console checks the shield and the sonar, then stops. The
  checks at boot, a setting, do only the shield and the sonar.
- **The pad**: D-pad up and down step its top speed (back to 50 when the pad
  goes silent or is turned off), the right stick, R3 and
  Triangle the sonar, and pad control off leaves only Cross, as Stop;
  player LED 4 says it is off. The SixaxisPairTool (or sixpair) is needed
  again only if the pad has been paired with another host since, or
  `PS3_HOST_MAC` changes.
- **Keeping it on the computer**: `client/ws.py --db rover.db` records
  telemetry, the log (by controller), metrics and settings in SQLite,
  indexed by time, so a question is a query rather than a read of a whole
  file; `--prometheus 9101` serves the latest values for Prometheus to
  scrape and Grafana to graph. `--import` loads a recording the panel saved.
  `client/drive.py` prints the log between its telemetry rows.
- **The panel**, a console for the robot (AGENTS.md, "The browser control
  panel", has the details):
  - Options (the gear) opens on the rover's settings: the sonar and its
    aim, pad control and the pad's state, the priority as a list to reorder,
    the checks at boot, and Run checks, which asks first and holds the
    checks while the panel is open and in front. Each shows only what the
    rover reports, a press pending until it does. Normal | Advanced stays in
    the top: the pivot stick depends on it.
  - A Log button on the scan's readouts opens a drawer under the scan: the
    last 500 lines, filtered by controller (USB, Pad, WiFi, Rover) and to
    warnings, with Save (JSON lines, which `client/ws.py --import` reads),
    and graphs of the last 10 minutes (loop rate, free heap, WiFi, the
    chip's temperature, the front distance). Closed, the button counts new
    warnings.
  - A line at the top of the view says when the pad or the USB console has
    control and this panel's moves are refused; the readouts name the check
    under way.

**Left for the bench** (docs/bench-checklist.md): the serial console's
commands, the priority with the pad and the panel at once, the settings
lasting through a reset, and the pad's new buttons.

## Menu or explicit: every control

| Control | Where | Menu? | Why |
|---|---|---|---|
| Drive \| Program | the top's second cell | no | which tab is open must show; leaving Drive lets go of a held stick |
| Normal \| Advanced | the top's second cell | no | shows the state that decides what the stick does |
| Link chip | the top's first cell | no | the link's state, always in sight, and the rover's faults in words |
| Address, Connect / Disconnect | the link chip's popover; with no link, Connect on the card over the scan | the address yes, Connect no | the first step is a press on the card; the address is set once, so it hangs from the chip ([F8](#f8-two-cells-at-the-top-two-panes-below)) |
| Stop | the top's second cell, beside the gear, on every layout | never | safety: one press, same place, stops exploring too |
| Autonomous | the top's first cell, after Rover \| Simulator, the other cell from Stop | no | a toggle: turned on it starts the robot moving on its own, a deliberate press; turned off it stops it |
| Stick family | Drive tab | no | re-steers a held stick: one tap mid-drive |
| Stick, rotate, speed | Drive tab | no | held or continuous controls |
| Rover \| Simulator | the top's first cell, first | no | decides whether the Drive tab and Run move the real rover |
| Run / Preview | Program toolbar | no | the primary action |
| Stop program | Program toolbar | no | safety: ends a run at once |
| Examples | File menu | yes | was a dropdown already; replaces the program like Import |
| Export | File menu | yes | infrequent, moves nothing |
| Import | File menu | yes | infrequent; the item calls the file picker directly |
| Clear | File menu | yes | last, behind an in-page question |
| Simulator room | the simulator's settings | yes | already a dropdown; on the bar it showed beside the Drive tab and went beside the narrower Program tab, so a tab switch changed the bar ([F8](#f8-two-cells-at-the-top-two-panes-below)) |
| Simulator 1x / 2x / 4x | simulator bar, off it while the Drive tab holds it at 1x | a list | one control at every width ([F8](#f8-two-cells-at-the-top-two-panes-below)) |
| Simulator Pause, Reset | simulator bar | no | quick, stateful toggles |
| Simulator settings | simulator bar | already one | a `Popover`, like the File menu |
| View toggle | Program toolbar, its far end | no | shows or hides the view pane on the Program tab; a toggle whose state shows ([F8](#f8-two-cells-at-the-top-two-panes-below)) |
| Blockly zoom, centre, trash | workspace | no | Blockly's own |
| Options (gear) | the top's second cell, its far end | yes | the look, Dark \| Light and a theme: set once, moves nothing ([F5](#f5-themes-and-options), [F7](#f7-darker-looks-and-a-dark--light-toggle)) |
| The keys' list | Options | yes | a reference that moves nothing ([F4](#f4-other-buttons)) |
| Firmware update | Options | yes | rare, and out of driving's way; the popover is not modal, so Stop stays one press ([F6](#f6-firmware-updates-from-the-panel)) |

## Open from earlier work

In scope only where an item or step below says what takes it up; the rest
waits for the owner.

- **Done** (step 2): `js/programtab.js` asked with native `confirm()` to
  load an example, import over a program, and Clear, which the desktop
  app's browser pane dismisses unseen. They ask in the page now.
- **Done** ([F8](#f8-two-cells-at-the-top-two-panes-below)): at 480 x 320
  on its side the middle column was too narrow for the top's cells, which
  need about 290 px at their smallest, and Stop and the gear spilled over
  the pivot stick's family. Under 568 px on its side the cells now span
  the screen, a cell a row, over the sticks' columns, and the Program
  tab's toolbar is a row under them.
- **Done** ([F8](#f8-two-cells-at-the-top-two-panes-below)): on an upright
  phone taller than 600 px the target switch's own row cost the scan 54 px
  on either target. The switch is in the top's first cell now, with no row
  of its own.
- `client/ws.py` prints a raw traceback when the rover is unreachable, where
  `client/drive.py` prints one clean line.
- No stand-in rover or project verify recipe is committed. The one used to
  verify the last branch was a Python `websockets` server on
  `127.0.0.1:8181` that logged every frame, sent telemetry every 500 ms, and
  had switch files to stop telemetry and report a motor fault. Committing one
  (under `tools/`) would make every item above checkable end to end without
  the rover.
