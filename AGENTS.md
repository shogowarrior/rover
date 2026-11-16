# rover

Firmware for a four-wheel mecanum rover, and the clients that drive it. This
file is the guide for any coding agent working in this repository. Claude
Code's own setup (hooks, skills, a review agent) is in `CLAUDE.md`.

**The hardware.** A Wemos D1 R32 (an ESP32-WROOM-32 on an Arduino UNO
footprint) runs the Arduino framework under PlatformIO. An Adafruit Motor
Shield V2 on I2C drives four yellow TT gear motors on 60 mm mecanum wheels,
under a two-deck aluminium chassis 255 x 160 x 85 mm, powered by a 3S 18650
pack (11.1-12.6 V) through a BMS. An HC-SR04 ultrasonic sensor on a servo on
the top deck scans ahead; a second HC-SR04 is wired but not read, because
nobody has recorded where it points. None of the wiring has been verified on
the bench yet: [docs/bench-checklist.md](docs/bench-checklist.md) is how.

## Ground rules

- **Never flash the board or open its serial monitor.** Uploading moves a
  physical robot, and opening the monitor can reset the board into
  exploring; only the operator does either. An update from the panel's
  Options is a flash too. Build and test freely.
- **Never read `src/config.h`** by any means. See [config.h](#srcconfigh).
- **Never change a pin assignment unprompted.** See [Pins](#pins).
- There is no runtime feedback loop: a mistake is invisible until the board
  is flashed. Build after every firmware change, run the host tests after
  every change to the pure modules, run `tools/check_protocol.py` after
  changing a client or a value a client mirrors, run the panel's tests after
  changing the browser panel or anything in `src/`, and run both the host
  tests and the panel's tests after changing `test/vectors/`, whose cases
  both read.

## Commands

`pio` is not on `PATH`. It lives at `~/.platformio/penv/bin/pio`.

```
~/.platformio/penv/bin/pio run -e car_wire             # build the firmware (~8 s warm)
~/.platformio/penv/bin/pio run -e car_wire_gamepad     # build with the PS3 gamepad compiled in
~/.platformio/penv/bin/pio test -e native              # host-side unit tests, no board needed
python3 tools/check_protocol.py                        # the clients' copies of the protocol match src/
node --test extras/joystick/test/                      # the browser panel against a fake DOM, no rover needed
```

Building a board environment needs `src/config.h`. In a fresh clone the
operator creates it from `src/config.example.h`; CI copies the template in its
own checkout. Never create or overwrite it yourself. The native tests do not
need it.

Flashing, for the operator only: `pio run -e car_wire -t upload` over USB
(always works, and is required after any change that could break WiFi or the
loop), `pio run -e car_ota -t upload` over WiFi to a rover already running good
firmware, or the panel's Options, Firmware, which sends a build's
`firmware.bin` over the panel's own link (see
[Firmware updates](#firmware-updates-over-the-link)). `car_ota` builds without
the gamepad, so on a gamepad rover an OTA update removes the pad unless
`ROVER_ENABLE_GAMEPAD` defaults to 1 in `src/Features.h`, which turns it on
for every environment; from the panel, send the `firmware.bin` of the
environment the rover should run.

The serial console, `pio device monitor -e car_wire` (with the exception
decoder), is operator-only too. Opening it can reset the board through EN,
which restarts it: treat it like flashing, with the rover on a stand. Every
boot comes up in manual mode (`AUTONOMOUS_AT_POWER_ON` is false), but a build
that turns that on would start exploring. It also never exits on its own.

## Layout

| Path | What |
|------|------|
| `src/main.cpp` | Composition root: every object allocated statically and wired by reference; `setup()` and `loop()` |
| `src/Rover.{h,cpp}` | Mode arbitration, move deadlines, and the one clamped path to the motors. Pure |
| `src/Explorer.{h,cpp}` | Autonomous exploration state machine; `ExploreParams` holds its thresholds. Pure |
| `src/MovePatterns.{h,cpp}` | The table from move code to four wheel directions, and telemetry move names. Pure |
| `src/Protocol.{h,cpp}` | The WebSocket JSON format, both directions, firmware updates' messages included. Pure (ArduinoJson builds on the host) |
| `src/FirmwareUpdate.{h,cpp}` | The rules of a firmware update over the link: one client, the password, stand down, motion ends it, silence, the restart. Pure |
| `src/Kinematics.{h,cpp}` | Clamping, sensor normalisation, stick-to-move mapping. Pure |
| `src/GamepadSession.{h,cpp}` | The gamepad's rules: pad reports to rover commands, re-send and silence timing, START, SELECT, Cross, when to rewrite the player LEDs. Pure |
| `src/Timing.h` | `timing::reached()` for a deadline, `since()` and `elapsed()` for an age: every wrap-safe time comparison |
| `src/Hardware.h` | The `Motors`, `RangeScanner` and `FirmwareSlot` interfaces between the pure core and the hardware |
| `src/MoveCodes.h` | The move-code enum: the wire protocol. Append only |
| `src/Tuning.h` | Behaviour constants shared by the firmware and the tests |
| `src/Pins.h` | Every GPIO and motor terminal. A value here is a wire |
| `src/Features.h` | Compile-time switches: gamepad, explore at power-on, the pad's host MAC, the default control scheme, whether updates over the link need a password |
| `src/DriveTrain.{h,cpp}` | `Motors` on the Adafruit Motor Shield V2, and whether it answered at boot |
| `src/Scanner.{h,cpp}` | `RangeScanner`: the servo and both HC-SR04s |
| `src/Network.{h,cpp}` | WiFi station, ArduinoOTA, the OTA password both update paths check, confirming a new image once online, and the WiFi-loss failsafe |
| `src/RemoteControl.{h,cpp}` | WebSocket server on port 81: commands, scheme changes and firmware updates in, telemetry out, driver tracking, heartbeat |
| `src/FlashSlot.{h,cpp}` | `FirmwareSlot` on arduino-esp32's `Update`: writes the other app slot, checks the image, and the running image's MD5 |
| `src/Gamepad.{h,cpp}` | PS3 controller over Bluetooth: only the callback's mailbox, and the player LED write. Compiled in only with `ROVER_ENABLE_GAMEPAD` |
| `src/config.h` | WiFi credentials. Gitignored. **Off limits** |
| `src/config.example.h` | The template for `config.h`; CI compiles against it |
| `test/test_*/` | Host tests: kinematics, move patterns, explorer, rover, gamepad, protocol, firmware update |
| `test/fakes/` | Fake `Motors`, `RangeScanner` and `FirmwareSlot` for the host tests |
| `test/support/` | Helpers the host tests share: `Loop.h` steps time the way `loop()` does, `Vectors.h` reads `test/vectors/` |
| `test/vectors/` | Cases as JSON: stick to move, shared by the firmware's tests and the panel's; telemetry frames |
| `tools/check_protocol.py` | Checks the values the clients copy from the firmware (the move codes above all) against `src/` |
| `client/drive.py` | Keyboard control and telemetry, in a terminal |
| `client/ws.py` | Telemetry listener only |
| `client/rover.ipynb` | Notebook experiments over the same link |
| `extras/joystick/` | Browser control panel: open `joystick.html` from disk (see below). Two cells at the top hold every control but the open tab's; under them the view (the rover's scan, or a simulator in the rover's place) beside a Drive tab of sticks or a Program tab of block programs. `js/` holds its classes, `app.js` wires them, `test/` runs them in Node |
| `platformio.ini` | Environments `car_wire`, `car_ota`, `car_wire_gamepad`, `native`; pinned versions |
| `partition.csv` | Two OTA app slots and no filesystem |
| `docs/`, `images/` | Wiring, BOM, pinouts, the mecanum table, bench checklist, roadmap; `features.md` (the owner's requested features); `docs/project/`: `handoff.md` (where the work stands, what to work on now) and the Claude Project's goal, instructions and environment script (`setup.md` says where each goes) |

## Architecture

`main.cpp` builds the object graph and does nothing else. Each pass of
`loop()` calls `rover.update(now)`, then `gamepad.update()`, which reads its
own clock (see the mailbox below), then `network.update(now)`, which serves
OTA and the WebSocket.

```
  RemoteControl (WebSocket :81, Protocol) --+ commands
  Gamepad (PS3) -> GamepadSession ----------+-----------> Rover --Motors--------> DriveTrain
  Network (WiFi, OTA) ----------------------+ standDown:    |   (MovePatterns)   (Motor Shield V2)
                                              link lost,    |
                                              OTA start  Explorer --RangeScanner--> Scanner
                                                                                   (servo, HC-SR04s)

  RemoteControl --image--> FirmwareUpdate --FirmwareSlot--> FlashSlot
                           (standDown as it begins;          (Update: the other app slot)
                            Rover's motion ends it)
```

`Network` also starts `RemoteControl` once WiFi is up and serves it each loop,
and gives `FirmwareUpdate` and ArduinoOTA the one OTA password.

**The pure core** is `Rover`, `Explorer`, `GamepadSession`, `MovePatterns`,
`Protocol`, `Kinematics` and `FirmwareUpdate`, with `Timing.h`. None of it
calls Arduino: time arrives as a `now` argument, and the hardware is reached
only through the interfaces in `Hardware.h`. That is what lets
`pio test -e native` test mode arbitration, move deadlines, clamping, the
whole of autonomy, the gamepad's rules, the wire format and a firmware
update's rules on the host, compiled as gnu++11 like the board.

**The adapters** are `DriveTrain`, `Scanner`, `Network`, `RemoteControl`,
`FlashSlot` and `Gamepad`. They only translate between the core and a library, and they are not
host-tested, so keep them thin. Logic that could be wrong belongs in the core,
with a test. If a core module seems to need `millis()`, a motor or `Serial`,
pass the value in or add an interface instead.

## Invariants

These are not style preferences. Each corresponds to a bug that has been in
this codebase.

**`loop()` never blocks.** No `delay()`, no unbounded `while`, nothing that
waits on the network, in anything reachable from `loop()`. Blocking starves the
WebSocket server and ArduinoOTA: commands stop arriving, *stop commands
included*, and the board cannot be recovered over the air. Timing is state
compared against `millis()` (move deadlines, Explorer's phases), never a sleep.
The only routine busy-wait is the sonar ping in `Scanner::measureCm()`,
bounded at about 30 ms and spaced at least 70 ms apart. A WebSocket handshake
can still stall the loop, and no move deadline is serviced meanwhile:
`WEBSOCKETS_TCP_TIMEOUT=2` in `platformio.ini` (whose comment says why)
bounds each handshake read, not the pass. The real bound is the loop
watchdog, enabled at the end of `setup()`: it resets the board if one pass
ever takes 5 s (OTA feeds it while flashing). The reset alone does not stop
the wheels. The shield's PCA9685 is not reset with the ESP32 and keeps its
last PWM, so the wheels run on through the reboot (about half a second) until
`DriveTrain::begin()` releases them (it tries even when the shield's probe
fails), and indefinitely if the board never boots that far. The only
`delay()` calls are in `setup()`: the bounded WiFi connect and the shield
probe's retries. A firmware update over the link holds the loop for each
chunk it writes, and for up to about 2 s where `Update` erases a 64 KB block
of flash: that is why a chunk is asked for only with the rover at rest, and
why any motion ends an update (see below).

**Motors are released by deadline, not by waiting.** `Rover::drive()` sets the
wheels and records `moveDeadline`; `Rover::update()`, every loop, releases them
once it passes. A repeat of the move already running, at the same speed, only
moves the deadline, except that the pattern is rewritten every
`tuning::MOTOR_REFRESH_MS` (500 ms) to repair an I2C write the bus lost, which
the library never reports. A release always writes, and one that ends motion
is written once more `MOTOR_REFRESH_MS` later, because a stop has no next
command to repair a lost write (`Rover::release()` says what that cost); a new
move cancels it, and an idle rover writes nothing.
`Rover::servicePendingRelease()` makes that second write, from `update()` and,
while an OTA upload blocks the loop, from its progress callback. There are no
per-move tasks or timers: an earlier design spawned four FreeRTOS tasks per
move, which raced on shared motor parameters and could exhaust the heap under
a fast client.

**Every input is clamped in `Rover::drive()`, the one path to the motors.**
WebSocket commands, the gamepad and Explorer all arrive there. Speed is clamped
to `tuning::MOTOR_SPEED_LIMIT` (never above 255: the driver takes a byte, so 300
would wrap to 44) and duration to `tuning::COMMAND_DURATION_MAX_MS`.
`Rover::command()` checks a raw code with `isMoveCode()` before casting it, and
an unknown code stops the rover. Clamp there, not at call sites, and never add
a second route to `Motors`.

**The 1.5 s duration cap is the deadman.** There is no separate timer: every
command ends within `COMMAND_DURATION_MAX_MS`, whatever it asked for, so a
client that stops sending stops the rover. Clients keep moving by re-sending
(the panel and the gamepad every 200 ms, `drive.py` through key auto-repeat).
Any client's repeat interval must stay well inside the duration it asks for,
which the cap bounds.

**Loss of control stops the rover.** Each of these ends with the motors
released:

- The *driver*, the WebSocket client that last sent a command, disconnects:
  `Rover::stop()` releases the wheels and keeps the mode. A telemetry-only
  listener coming and going does not stop anything.
- A client stops answering the heartbeat: the server pings every client each
  second and drops one that misses two pongs in a row, which counts as a
  disconnect. This also keeps a vanished client's full send buffer from
  blocking the loop. A new client's first ping goes out about 600 ms after
  it connects, and its pong must come back within 600 ms of that ping.
  `HeartbeatServer` clears a slot's missed pongs on every connect and
  disconnect (`RemoteControl.h` and `RemoteControl.cpp` say why).
- WiFi drops: `Rover::standDown()` stops and switches to manual, because no
  STOP could reach an exploring rover.
- An OTA flash starts: `standDown()` too, so an upload that fails also leaves
  the rover stopped in manual, as a successful one's reboot does. The upload
  blocks the loop until it ends, so the stop's second write comes from its
  progress callback, which runs only while data arrives: flash over WiFi
  with the rover still or on the stand.
- An update over the link begins: `standDown()` too. Its client
  disconnecting, or silent for `OTA_SILENCE_MS` (5 s) after a reply, ends
  it, and so do Cancel and any motion (a drive command from anyone, the
  pad, Autonomous; Stop is not motion), before another chunk is written.
  Every way an update ends but "done" leaves the old firmware booting and
  the rover as the stand-down left it.
- The gamepad goes silent for `GAMEPAD_SILENCE_MS` (500 ms). A report that old
  never reads as fresh again, however long the silence.
- Every boot starts in manual (`startupMode()` in `main.cpp`), so a
  recovering rover stays put once `DriveTrain::begin()` has released the
  wheels (see above). `AUTONOMOUS_AT_POWER_ON` in `Features.h`, off, would
  let a power-on (the EN button, and so a USB flash, included) start
  exploring; any other reset (OTA from either path, crash, watchdog,
  brownout) starts in manual regardless. An update over the link restarts
  the rover only once it is at rest.
- A new image from either OTA path boots on trial (`verifyRollbackLater()`
  in `Network.cpp`): `Network` keeps it once `loop()` has run it for
  `tuning::IMAGE_TRIAL_MS` (30 s) since it first got online, and until then
  the next reset of any kind boots the previous image, and neither update
  path runs. So a build that crashes, hangs or never gets online undoes
  itself at the next reset, where it might not have been replaced over the
  air.

If you add a new way to lose the link, add its failsafe in the same change.

**Autonomous and manual never both drive.** In `MODE_AUTONOMOUS`,
`Rover::update()` runs `Explorer::update()`, which may request motion; in
`MODE_MANUAL` it runs `Explorer::survey()`, which keeps sweeping and measuring
but never moves. Any command, STOP included, switches to manual; only
`RESUME_AUTONOMOUS` (code 19) switches back, restarting exploration from a
fresh sweep. Sent while already exploring, it restarts an explorer that has
halted (clearing `boxed in` or `sensor silent`) and otherwise does nothing.
Without the arbitration, exploration overwrote every remote command
milliseconds after it arrived; without the way back, the first command ever
sent stranded the rover in manual until a power cycle. Because STOP takes
control, a client must not send one just because it lost focus or is quitting
while the rover explores: stop only what it is driving itself.

**Sensor sentinels come from the library, not from guesses.** HCSR04 2.0.0's
`measureDistanceCm()` returns **-1** for every failure (no echo within about
4 m, an echo deflected away, a dead sensor) and never 0. Testing for `== 0`, as
an earlier version did, let -1 through as an obstacle touching the sensor.
`kinematics::normalizeDistance()` maps negative to `DISTANCE_FAR_CM` (999,
nothing in range); zero is a real reading. A dead or unplugged sensor also
reads -1 everywhere, and that normalises to open space -- so a sweep that
heard no echo at any bearing is never grounds to drive forward: Explorer only
turns in place to look again (backing out of a dead end too narrow to turn
in, it stands still to look again), and halts with `sensor silent` after
three such sweeps in a row. A sensor that dies mid-cruise ends the cruise
once four looks in a row hear nothing. Keep it that way: an absent echo
alone must never justify motion.

**The gamepad's Bluetooth callback only fills a mailbox.** The PS3 library
calls back on the Bluetooth task (core 0); everything else runs on the loop
task (core 1). The callback copies the controls under a spinlock and touches
nothing else; `Gamepad::update()`, on the loop task, takes a copy and hands it
to `GamepadSession`, the only thing that talks to `Rover`. Keep motor state and
the I2C bus single-threaded: no calls into `Rover` from callbacks, interrupts
or other tasks. `Gamepad::update()` reads the clock under the same lock, not
`loop()`'s `now`, so no report is stamped later than the clock it is aged
against (its comment says what that cost).

## How autonomy works

`Explorer` is a non-blocking state machine stepped once per loop. It measures
five bearings: +70, +35, 0, -35 and -70 degrees from straight ahead (positive
is left), reported as left, front-left, front, front-right and right. It cruises
only when nothing *in the rover's path* is within `EXPLORE_GO_CM` (40 cm), and
ends a cruise when something in it comes within `EXPLORE_STOP_CM` (25 cm); the
gap between the two is hysteresis. Testing the path rather than each ray is what
lets it enter a corridor whose walls are near at the sides but not ahead. It
drives at `EXPLORE_SPEED` (64).

| Phase | What happens |
|-------|--------------|
| `SWEEP` | Stand still and measure all five bearings, sweeping back and forth |
| `CRUISE` | Drive forward on a 400 ms lease that only a clear ping renews, the servo weaving 0, +25, 0, -25 degrees. Ends on an obstacle in the path, a near echo that vanishes (deflected, not gone), a front echo that has not changed by 3 cm either way in 1 s (stuck below the beam: back off, then turn well clear), four looks in a row that hear nothing (a sensor dying mid-cruise), or after 2.5 s |
| `TURN` | Rotate toward the more open side in short steps, measuring after each, and keep that direction until the front is clear twice. Also one step away from what a weave look stopped on, and a small wander after a cruise that ran its 2.5 s; these optional turns are skipped where rotating would swing a corner into a wall |
| `BACKOFF` | Reverse briefly, and only over ground just driven forward: nothing watches behind. After a stuck cruise, only the driving before it got stuck counts. At a dead end too narrow to rotate in, back out the way it came, a step at a time with a sweep after each, until the flanks have room or that ground runs out, and only then turn: turning there swings the corners into the walls. A way ahead that looks clear again meanwhile does not send it back in, and a sweep that hears nothing only makes it look again |
| `SIDESTEP` | Strafe away from a flank too close to rotate beside, when the other side has room: instead of a turn, or when the path is clear but one flank is close. At most two in a row. The strafe direction is learned, since the wiring is unverified |
| `HALTED` | Stopped: `boxed in` when more than a full circle of turning, counted since the rover last drove clear, finds no way out (it then resumes only when the way opens by itself); or `sensor silent` after three sweeps in a row hear nothing. Retries every 5 s; `RESUME_AUTONOMOUS` restarts it at once |

The shared thresholds are in `Tuning.h`; the finer ones are `ExploreParams`
in `Explorer.h`.

## Wire protocol

JSON text frames over a WebSocket on port 81. `src/Protocol.h` is the
reference; in short:

- **Client to rover:** `{"move": <code>, "speed": 0..255, "duration": <ms>}`.
  A missing or mistyped field defaults to STOP, speed 0 and 750 ms, so a
  malformed command stops the rover. Frames over `protocol::COMMAND_MAX_BYTES`
  (256 bytes) and invalid JSON are ignored, and `test_longest_command_fits`
  checks that the longest a client sends fits. Move codes are in
  `src/MoveCodes.h`: 0 `STOP` to 18 `ROTATE_COUNTERCLOCKWISE`, and 19
  `RESUME_AUTONOMOUS`. A browser page may connect only from a file, this
  computer or the local network (`protocol::originAllowed()`): the panel
  opens from a file, and a page served from `localhost`, a private IPv4
  address or a `.local` name works too.
- **Client to rover, configuration:** `{"scheme": "NORMAL" | "ADVANCED"}`
  (no `move`) sets the control scheme below. It is not a command: it neither
  takes control nor stops anything, so a client may send it while the rover
  explores. An unknown scheme name is ignored.
- **Firmware updates,** between the rover and the one client updating it
  (see [Firmware updates](#firmware-updates-over-the-link)): text messages
  carrying `"ota"` (no `move`), which are not commands either, and binary
  frames of at most `protocol::OTA_CHUNK_MAX_BYTES` (1000) holding the image.
  The client sends `{"ota": "begin", "size", "md5"}`, answers
  `{"ota": "auth", "nonce"}` with `{"ota": "auth", "cnonce", "response"}`
  when the rover has an OTA password, then sends the bytes from wherever
  each `{"ota": "next", "offset"}` says, one frame per reply. The rover ends
  with `{"ota": "done"}` and restarts, or `{"ota": "failed", "reason"}`;
  `{"ota": "cancel"}` ends it from the client's side.
- **Rover to clients,** every 500 ms: `mode` (`AUTONOMOUS` or `MANUAL`),
  `move` (`STOP` whenever the wheels are idle), `moving`, `temperature` (the
  ESP32's own, in C), `motorsReady` (always sent; `false` when the motor
  shield did not answer at boot, so no move reaches the wheels whatever `move`
  says), `phase` (only while autonomous), `halt` (only when halted), and
  `distanceLeft`, `distanceFrontLeft`, `distanceFront`, `distanceFrontRight`,
  `distanceRight` in cm once every bearing has been measured (999 means no
  echo). Distances stay live in manual mode too. `scheme` (`NORMAL` or
  `ADVANCED`) is always sent, and so is `firmware`, the running image's MD5
  (32 hex digits, the MD5 of the `firmware.bin` it came from): a rover that
  sends it takes updates over the link, and one from before reads an `ota`
  message as a STOP that takes control, so a client sends none to a rover
  without it. A frame must fit `protocol::TELEMETRY_MAX_BYTES`
  (384 bytes; `Protocol.h` says why), and `test_longest_telemetry_fits` fails
  the host tests when a new key would not. `test/vectors/telemetry.json`
  holds example frames, key for key, that `test_protocol` checks.

## The browser control panel

`extras/joystick/joystick.html` opens directly from disk; the rover cannot
serve it. `partition.csv` holds `nvs`, `otadata` and two 1.8 MB OTA app
slots, leaves the last 320 KB of the 4 MB flash unallocated, and has no
SPIFFS or LittleFS partition for web assets. Adding one means a new partition
table, which only a USB flash can write (OTA never does), so the panel is a
local file that connects out to `ws://<rover>:81` (the address field takes
`host` or `host:port`).

Chrome refuses module scripts from `file://`, so the panel is classic
`<script src>` files loaded in order, sharing one global scope: no modules, no
bundler, no packages. Its one remote script is Blockly 13.3.0 from
cdn.jsdelivr.net, for the Program tab: pinned, checked against its hash and
deferred, so driving never waits for it or depends on it. The panel reads like
the firmware: small classes in `js/`, each documenting its contract in its
header, wired by `js/app.js`, the composition root, whose header lists them in
load order.

Every constant mirrored from `src/` is in `js/protocol.js`, except the scan's
bearings and telemetry keys (`BEARINGS` in `js/scan.js`), the stick mapping,
its family names and the move names telemetry reports (`js/mecanum.js`), and
the simulator's own copies (`js/sim.js`). `joy.js` is a vendored third-party
joystick: leave it unmodified. `test/` runs the real page in Node against a
fake DOM, WebSocket and clock (`panel.test.js`, and the keyboard in
`keys.test.js`), and the runner and blocks (`program.test.js`), the
simulator (`sim.test.js`), the stick mapping (`mecanum.test.js`), the looks'
tokens and contrast (`looks.test.js`) and a firmware update with its MD5
(`ota.test.js`) on their own. `test/firmware.js` reads what they check
against in `src/` and
`test/vectors/`, `test/css.js` reads the stylesheets as they check them, and
`test/harness.js` sets the time limit an asynchronous test runs under, so
one that never ends fails by name.

The panel holds a move by re-sending it every 200 ms (`REPEAT_MS` in
`js/protocol.js`), each asking for 400 ms (`MOVE_DURATION_MS`). `REPEAT_MS`
must stay well under `MOVE_DURATION_MS`, or a held move stutters
(`tools/check_protocol.py` holds it to half), and so under the cap. A new
direction goes out at once, a new speed in the same direction at most every
100 ms (`STICK_SEND_MS`, the gamepad's rule below). Letting go, blurring the
window or hiding the tab stops what the panel is driving and leaves an
exploring rover alone. Its Drive and Program tabs switch only what is shown,
with one exception: leaving the Drive tab lets go of both sticks (one STOP,
only if one was driving), which hidden could be neither steered nor centred.
A held rotate button or key carries on, except on the simulator target
(below).

Every control but the open tab's own is in two cells at the top, Stop and
Autonomous among them, on every layout and both tabs, connected or not
(F8 in [docs/features.md](docs/features.md): the owner found a header of
two or three rows, status pills and a bar of Stop and Autonomous across the
foot cluttered and confusing, and asked for every control in the top, in
two cells). Under them are two panes, never three: the view, what the
controls drive, the same pane beside both tabs; and the hands, the open
tab (the Drive tab's sticks, or the Program tab's editor). So a tab switch
moves nothing in the top, Stop least of all, on any layout, and the view
keeps its side of the page. On the rover target the view is the rover's
scan: with no link a card over the faint fan says the link's state, as the
chip does, and offers to connect, and after a link goes the scan and the
readouts keep their last values, dimmed. On the simulator target the view
is the simulated room.

**The keyboard** (`js/keys.js`) takes `client/drive.py`'s keys: W S forward
and back, A D strafe, Q E rotate, - and + the speed by 16, Space Stop, T
Autonomous on or off. A drive key is held as a rotate button is, through the Driver
(`holdKey()`): it drives from its keydown to its keyup, held by where it is
on the keyboard (`event.code`) because its keyup may type something else
(AltGr on Linux, a layout switched mid-hold), the keyboard's own repeats are
not presses, and the rotate button or key pressed last wins, one move at a
time. The drive and speed keys act on the Drive tab alone;
Space and T press Stop and the Autonomous toggle, on either tab (so T on
a rover reported exploring stops it, where `drive.py`'s always resumes), and
Space's keydown and keyup are both cancelled, so a focused button (Run,
Connect) is never clicked as well; Enter in the address, in the link's
popover, connects and leaves the field, so Space stops from there. A
keydown is not the panel's in a text field, a select or any `<dialog>`
(Blockly's alert and name prompt among them), while the page's dialog is
open, in anything marked `data-keys="own"` (the File menu, Options, the
simulator's settings, the block editor) or Blockly's pop-ups, with Ctrl,
Alt or Cmd held, or once something on the page has acted on it (the
simulator's rover turns on Q and E); a keyup always counts. Ctrl, Alt or
Cmd going down lets go of every held key: macOS sends no keyup for a key
let go while Cmd is held. So does a context menu opening, which takes the
keyup without blurring the page. Options lists the keys (a touch screen's
leaves them out: it has none to press), and `test/keys.test.js` checks
them against `drive.py`'s.

The layout is `css/panel.css`'s, on its tokens (type, space, radii) and the
look's colours.

**The top** is two cells of one height, stuck to the top of the screen so
that Stop is on it whenever the page scrolls, on a layer of their own over
the panes and Blockly's widgets, which nothing may cover. They sit in one
row where the top is 900 px wide or more (a container query on its
width), the first as wide as what it holds and the second the rest, and a
cell a row below that: a phone, a tablet upright, and the middle column of
a phone on its side, or under 568 px on its side (480 x 320) the screen's
width over the sticks' columns, which leave the middle too narrow for
them. Each cell has the one outline: the switches and the chip in it are
told from it by their fill. The first cell is what the controls drive and
its state: Rover | Simulator first, as the owner asked, then the
Autonomous switch, then the link chip. The second is how they drive it:
Drive and Program, drawn as text tabs (the open one's word over a 2 px bar
with square ends) so that moving between them never looks like a setting,
then Normal | Advanced, and at its far end Stop, red and an icon alone,
beside the gear. Autonomous and Stop are in different cells so that a
press that misses Stop cannot start the rover exploring, and Autonomous
sits near its cell's start, so that where the cells stack it is never
over Stop (48 px from it at the least, at 320 x 568 and 568 x 320); the
gear, Stop's one neighbour, only opens Options. Every switch but
Autonomous (a track and knob) is the same segmented control, words only,
the chosen segment inverted. Each cell is one line of controls and says as
much as its width allows: `fitTheTop()` in `js/app.js` measures its
`data-fit` steps from the most words to the fewest. The first cell: the chip's address after its word, wherever the
cell has room for it, measured (`host`); every word; Sim and Auto
(`short`); its controls closer together (`snug`); the rover's glyph for
"Rover:" (`rover`); else "Rover:" kept and the alerts' glyphs for their
words (`glyphs`); both glyphs (`icons`); the link's word at 12 px
(`small`); and last (`lamp`) the chip filling the rest of the cell, its
word said in the room left after the lamp, the glyphs and the caret where
it fits whole, and otherwise hidden (`data-word="cut"`), never cut short,
its title and the popover saying it. So the alerts keep their words as
long as any word but the link's can give way (their glyphs looked alike on
an iPad on its side, and a touch screen cannot hover), and "Rover:"
outlasts Sim and Auto. The link's word is one for each state at every
step, never a short word of its own. The second: every word; its segments
closer together, then closer still (`tight`, `snug`), keeping 13 px words
down to a 375 px phone; 12 px words (`small`); and only where nothing else
fits (a 320 px phone, where Advanced whole is 15 px short) Adv for
Advanced (`short`). A cell runs over when its last control passes its
content box, not only when what it holds overflows (`runsPast()`): a chip
that ran into a cell's padding touched its outline. The step follows the
cell's width alone, never the link, the target or the rover's state, and
each control is a slot as wide whatever it says (the chip holds sizers for
its longest words), so nothing in a cell moves as they change, and no
word, state or alert ever adds a line. In one row the first cell widens as
the chip says "Rover:" or an alert, and the width comes out of the empty
start of the second, whose controls keep to its far end: Autonomous, the
chip's left edge, the tabs, the scheme, Stop and the gear never move. Each
glyph is its own shape: the rover's a rover seen from the side, No motors
a motor struck through, and Rover exploring a winding route. Every
button on the page is titled with what it does, the dialog's Yes and
Cancel among them, and every one that is an icon alone has an
`aria-label`: the owner asked for an icon and "hover to see more info" on
all of them.

**The link chip** (`Link` keeps it) is a lamp, the link's state in one
word for each state, the same at every width ("Not connected",
"Connecting…", "Connected", "No data" while telemetry is stale, "Link
lost" after a link went, and "Not reachable" for a socket that closed
before it opened, which the Driver still hears as a lost link), "Rover:"
before it on the simulator target, so that it never reads as the
simulator's (in a narrow cell the rover's glyph in the lamp's place), the
address after the word where the cell has room for it, and a caret; a
lost, stale or unreachable link tints it amber. It opens the link's
popover: the address, Connect (Cancel while connecting, Disconnect while
up) and the note, which says how to connect or why the link went. With no
socket the chip and the card name the address in the field, as Connect
would use it. With no link the connect card over the faint scan, on a
layer of its own (the faint fan's opacity makes it a stacking context,
which painted over the card and took its presses), is titled with the
chip's word ("Connecting to" the address while connecting), and its button
is a press of that Connect that names the address it acts on: "Connect to"
it, Cancel while connecting, "Reconnect to" it after a lost link, "Try" it
"again" after a rover never reached, and "Connect to" the field's address
once that is another. Where the button would cut that short, measured
(`fitConnect()` in `js/app.js`, `data-fit="verb"`), it says its verb alone
and the address takes a line of the card, wrapping anywhere to two lines
at most, never cut short, so two addresses that start alike never look
the same. Its Change address opens the
popover with the focus in the address. In a view under 260 px tall the
card is tighter, and drops Change address where the view is under 230 px
wide too; under 170 px tall (a phone's band over the Program tab's editor)
it is one compact row under the fan, its title left to the chip, so it
covers nothing, and where that view is under 330 px wide the row is
Connect alone. `Link.onSay()` tells its listeners each time the chip is
said again, its word or its address, so the alerts, the chip's word and
the card's fit follow an address typed with no link at once. The card, and
the Connect beside the Program tab's console line, give way while the
popover is open, so two Connect buttons never show at once. After its
word, each in a slot of its own and amber (a glyph alone in a narrow
cell), the chip also says what needs the operator about the rover while
nothing else on screen does (`markAlert()` in `js/app.js`): "No motors"
while the rover reports that its motor shield did not answer and no scan
shows (the simulator target, or the view hidden on the Program tab; where
the scan shows, its fault line says it), and on the simulator target
"Rover exploring" while the rover reports that it explores, since a rover
sent exploring before the switch must not move unseen. Once that link goes
or goes quiet, "Rover exploring" stays, dashed, as last known, until a
frame reports MANUAL: a Stop may not have arrived, so it never clears the
alert. On the simulator target the view says it too, in an amber line at
its top (`#roverAway`): "The rover is exploring on its own. Stop stops
it.", and once the link goes or goes quiet, dashed, "Last seen exploring
on its own. Reconnect, then Stop.", since a phone's chip says it with a
glyph alone. The line wraps to two lines at most, never cut short: cut,
it lost what to do on the phones it is for. The popover says why in words, as the chip's title does: a
touch screen cannot hover. The link's popover and Options hang from the
foot of the top (the link's from the chip's left edge) and the Program
tab's File menu from its button (on a phone on its side, from the second
cell's foot: from its button, in the band beside the cells, it slid under
them), below the cells, never over them, and none is modal: Stop stays one
press while one is open, and that press closes it. Each stops short of the
screen's foot and scrolls inside past it, and `Popover` (`js/popover.js`)
marks the ends with more of it past the edge (`data-more`), which the
stylesheet fades, so a list cut by a short screen reads as one that
scrolls.

**The view** (`#view`) is a sibling of both tabs, never an ancestor of a
stick. On the rover target it holds the scan's card: the rings' legend
("25 cm stop · 40 cm go · 100 cm", 12 px), a row of its own in the card's
top-left corner on every layout, never over the fan; the motor fault,
while the rover reports one, in that row in the legend's place, so that
closed it never shrinks the fan, on one line at most 520 px wide with its
caret beside its words (what to do behind that disclosure); the fan
(`ScanView`), in whichever of its two shapes, wide or tall, draws it the
larger; and the readouts on one line at its foot: the move, the chip's
temperature, and the phase while the rover explores, or "Halted: boxed
in" (or "sensor silent") in amber, its caption hidden. The fan's bearing
names and readings are never drawn under 12 px: where the fan is too small
for its names they go, and the left and right readings move under the
fan's ends; where it is smaller still those two go, and then the rest
(`data-labels` on the fan: all, readings, front, none). The readouts give
way a step at a time, the chip's temperature first, then a smaller size,
and only then their captions, the phase's before the move's, where a value
would otherwise be cut short (a bare "STOP" read like a button), each cell
titled with its caption. After a link goes, and while it is quiet, the
fan's readings, its 25 and 40 cm rings and the readouts' values dim
together, the values faded too. On the simulator target the view holds the
one `SimView`, in `#simSlot`, which is hidden by its attribute on the
rover target so that an idle view knows it is out of sight and draws
nothing. Its controls take one row, the same controls in the same order on
both tabs (the playback speed, pause and reset, what the rover is doing,
the settings) but the speed and the clock ("Sim time", never without its
caption), which only the Program tab's row has: the Drive tab holds the
playback at 1x, its note saying "Held at 1× on the Drive tab" and its
title why. What the rover is doing is shown whole or not at all, never cut
short: how fast gives way first, then the clock, and then the move, which
always goes under about 70 px of room, and how fast with it; where the next preview goes on from
is in the move's title. The room is picked in the settings, with the rays,
the trail and the colours' key (the wheels' drag is no longer there:
`releasedDrag` stays in `js/sim.js` as calibration); the room takes the
rest of the view, and a view too short for the room shows the row alone.
The view's size is the shell grid's, never its content's (size
containment): a fault, the connect card, the readouts or a switch of
target only trade height inside it, so none of them can grow its row and
move the dock under a held stick.

**The layouts:**

- A wide screen (960 by 521 px and up): the cells in one row; under them
  the view on the left and the hands on the right, the same sides on both
  tabs. The Drive tab stacks its two sticks in one column beside the view,
  as the owner asked ("tile them vertically with a side split for the
  preview"): the translate stick with the rotate buttons under it, over
  the pivot stick with its family and line over it and the speed under
  it. Only one stick drives at a time, so stacking costs no thumb
  anything. The column is as wide as the sticks need, and at least 230 px
  so that the speed keeps its word at 1024 x 768 (`--dock-col`), each
  stick up to 280 px, the height they leave spread above, between and
  below the two groups so the column has no empty band, and the view takes
  the rest of the width: the owner asked for the view to be the larger.
  Only a wide screen under 564 px tall, where a stacked stick would keep
  less than 120 px, sets the two side by side. The Program tab gives the
  view a column about half the width (360 to 640 px): the view at its top,
  sized to its drawing (the legend, the fan and the readouts together),
  and the console under it taking the rest of the column, its log
  scrolling, with no rule while it is empty, and never less than its
  state line and three lines of its log on either target: on a short
  screen the view's row gives way (`--console-min`); the editor with its toolbar
  takes the other side at full height. With the view hidden the editor
  takes the width, and the console sits under it, its log as tall as its
  lines up to five and then scrolling. From 1800 px wide the panes use the
  screen's whole width.
- Upright, a phone or a tablet: the cells a row each, the view under them
  taking what height is left, and the Drive tab's dock at the foot of the
  screen: the translate stick on the left, the pivot stick on the right
  with its family's row over it, and the rotate buttons and the speed
  under the two (on a phone the speed takes most of that row, and the
  rotate buttons are their icons alone where narrower than 156 px, their
  titles keeping the words). On the Program tab the view, when shown, is a
  band over the editor the screen's width, on a tablet one height whatever
  the target so a switch of target never moves the editor, and the console
  is under the editor. On a phone the console is one line and a Log
  button that counts the log's lines and opens it upward over the editor's
  foot, so the editor's height never follows what was logged.
- A phone on its side, held like a gamepad: the translate stick down the
  left edge with the rotate buttons under it, the pivot stick down the
  right with the speed under it (its value and the slider, with no caption
  or gauge icon), both at the foot of the screen with their captions
  (Translate, and the family, quieter there: no track, the chosen
  word raised) under the cells, and between them the two cells and the
  view under them, in reach of either thumb; the dock stops at the
  screen's height, so a middle column that outgrows a short screen moves
  neither stick. Under 568 px wide (480 x 320) the cells span the screen
  over the sticks' columns, and the sticks and the view take the screen
  under them. The Program tab keeps the cells where the Drive tab has
  them, so a switch of tab moves nothing in the top: from 568 px wide its
  toolbar takes the bands beside them (Run over Stop program on the left,
  File over View on the right), and under 568 px it is a row of its own
  under them. The editor is under the cells across the screen, its
  categories down its left, and the view, when shown, beside it on the
  left, about 40% of the width.

No layout squeezes a pane between two others. Each stick is as large as
what is above and under it, and the width around it, leave; `css/panel.css`
sums each layout's budget, from the viewport alone (`--stick`), over dock
rows of fixed height. The editor refits as its box changes size, which
Blockly does only for a window's resize. No ancestor of either stick may
be positioned, transformed, filtered or contained: joy.js places a touch by
its canvas's offsetParent, and `panel.test.js` reads every stylesheet for
it. Any move of a stick's box on the screen while it is held lets go of
that stick: a thumb resting where it was would otherwise steer the moved
stick another way. A window resize or a turned phone lets go at once; a
move nothing reports, a row above the sticks coming or going or the page
scrolling, lets go at joy.js's next report, before it can drive. So
nothing above or beside a held stick changes size or place on a scheme
change, a link lost or stale, a fault, the chip's alert or a switch of
target: the cells are one height whatever they say, the view absorbs its
own changes, and each of the dock's rows is one line of a fixed height (the
stacked column's one flexible row, between the two sticks' groups, holds
nothing).
The family's row is there under either scheme, and the translate stick's
caption and the pivot stick's line keep to one line whatever they say
(`FamilySelector` has one wording for every layout, short enough for the
narrowest: 13 px words, the family's 12 px only in a column under 152 px,
never 11), which keeps a family chosen under a held pivot stick a
re-steer. The pivot stick's corner hints say their pivots in 12 px words
on one line, or not at all where the column is under 190 px. Under NORMAL
the pivot stick is drawn grey, by a filter on its own canvas (never on an
ancestor), its hints dimmed, and its line says "Needs Advanced", the pad's
title saying where to choose it; under ADVANCED the line says "Untried: go
slow", because no pivot row is bench-verified; and while Advanced is
wished for the rover (the scheme toggle, below), "Advanced on link" with
no link yet, or "Advanced waits" while a linked rover has yet to report
its scheme. joy.js sizes its canvas once, as it is built, so when the
boxes settle at a new size (a turned phone's, say) the Driver builds the
sticks again; it paints them once too, so it builds them again when the
look changes, in the new look's `--live`, `--stick-rim` and `--stick-ring`
(`js/drive.js`), letting go of a held stick first. A look picked while the
Drive tab is hidden is drawn as the tab is shown, before a press can land.

**The look.** The page's colours are `css/looks.css`'s: six looks, three
themes (Console, the default, Field and Blueprint) in Dark and Light, worn
as `<html data-look>`. The gear, at the end of the top's second cell,
opens Options, where `js/look.js` offers a Dark | Light toggle that keeps
the theme and a tile per theme that keeps the flavour, and remembers the
look; it loads in `<head>`, so the page is drawn in that look from the
first paint, and paints the browser's bar (`theme-color`) then too. Every
look keeps four
signal hues, each with one job: blue (`--live`) for the operator's own
controls (the knob, the slider, focus, Connect, Run, and Autonomous's
dashed track while a press waits), green (`--ok`) for the rover doing
well, amber (`--warn`) for caution, and red (`--stop`) for Stop and danger
alone. The edge (`--edge`) of a button, a switch's track outside the top's
cells, a field or a theme tile holds 3:1 against what it sits on (in a
cell, a switch's track and the chip are told from it by their fill, the
cell's outline its one edge), and the chosen segment of a switch is
inverted (`--chosen`, its word and anything else on it in `--on-chosen`).
Nothing is told apart by hue alone: the link chip, all well, is quiet (ink
and a green lamp), and its alert is a word on an amber tint, so a fault
stands out; a clear way on the scan is drawn open, a sonar ray closing in
is heavy in the simulator, and Autonomous on moves its switch's knob as
well as lighting it. The popover is not modal: Stop stays one press while
it is open. What takes a colour as a plain value (joy.js's canvas,
Blockly's theme, the browser's bar) is given it again on a change, through
`lookToken()`; everything else follows through `var()`. A new colour is a
token in every look, never a literal: `test/looks.test.js` fails a
stylesheet that writes one, a token missing from a look, a pairing in its
contrast audit that falls short, a teal among a look's greens and tints as
drawn on their grounds or among the block colours, which the owner turned
down, and a stylesheet that fades a colour out over a ground it cannot
know (a faint green over a blue ground mixes to teal). The audit is a
hand-kept list, so a rule that paints a token on a new surface adds its
pairing. The blocks' `PALETTE` (`js/blocks.js`) is the one set of
colours the same in every look.

**The scheme toggle**, Normal | Advanced in the top's second cell
(`js/scheme.js`), shows only what telemetry reports, never what it asked
for. On the simulator target it is the simulator's instead (below). It is
never greyed out for want of a link, which the owner read as broken: until
a frame names a scheme (no link yet, connecting, or a link that went)
neither segment is pressed and both take a press, as a wish. The wished
segment is marked pending, titled to say it goes to the rover as soon as
the rover reports its scheme, and nothing is sent. The wish is said in
words too, a touch screen showing no title: "Advanced goes to the rover
once it connects" (or "once it reports its scheme"), behind a dashed ring
as the segment is drawn, in the link's popover and on the connect card
(over its compact row's buttons too, and not in a view under 120 px tall).
The next frame that names a scheme settles it: one `{"scheme": ...}` goes
out if the frame names the other one, pending as a press's would, and the
wish is dropped either way. A wish waits, unsent and unseen, while the
simulator is the target, whose scheme the toggle then shows: nothing but
Stop goes to the rover from there, so it is settled as the rover becomes
the target again, or by the next frame then. A press on the other segment
replaces the wish, and a press on the wished one drops it; firmware from
before schemes never reports one, and leaves the wish pending. While the link is stale the scheme last
reported stays shown, dimmed, and nothing is offered, its title saying why.
The `{"scheme": ...}` message, wished or pressed, is configuration, never a
command: it neither takes control nor stops an exploring rover. The
translate stick translates under either scheme. The pivot stick and its
family selector over it (Pivot, Sideways) take presses only under
ADVANCED; under NORMAL both stay on screen, the stick grey and its line
saying "Needs Advanced" (above), so a scheme change moves nothing. A change to NORMAL, from anyone, lets go of a held
pivot stick (one STOP, only if it was driving), which drives again only from
a fresh press once ADVANCED is back, as the line over it then asks; the
translate stick, a held rotate button and a running program carry on. A
family chosen under a held pivot stick re-steers it at once, as on the
gamepad.

**The Autonomous toggle** (`js/autotoggle.js`), a switch in the top's
first cell after Rover | Simulator, the other cell from Stop, is on while the target
explores, as telemetry reports it (the simulator's mode on the simulator
target, `AutoToggle.bind()`), never as asked. A press turns it the other
way through the Driver: pressed while off it sends RESUME_AUTONOMOUS
(`Driver.resumeAutonomous()`), pressed while on STOP (`Driver.stopRover()`,
whose stand-down names Autonomous, not Stop, as what was pressed), each a
press that lets go of everything held and stops a program. On the rover a
press is a request, which only a frame confirms: it is marked pending
(`data-pending`, a dashed `--live` track) while `aria-pressed` stays what
telemetry reports, until a frame reports that mode or
`AutoToggle.CONFIRM_FRAMES` (3) frames have not. A press while a request
is pending sends STOP, whichever way the request went, so two quick
presses always end stopped, from off or from on; only a press with
nothing pending goes by the report. T, which presses the switch, does the
same. Any other press of the operator's (Stop, a stick, a rotate button, a
drive key, through `Driver.onManualInput()`), a new link or a lost one
forgets the request; a stale link keeps it, since no frame comes to settle
it. The simulator
takes the mode at once, with nothing pending. Until a frame names the mode
the switch is off: with a link a press resumes, as the button it replaced
did; with none (down or connecting) a press sends nothing, opens the
link's popover and says there why ("Autonomous needs the rover connected:
connect, then press it again."), and the switch's title says a press needs
the link. A halted rover still reports AUTONOMOUS, so off and on again
retries it at once, the second press once the switch shows off (a frame,
up to half a second): pressed before then, it is a STOP.

**The target switch**, Rover | Simulator, first in the top's first cell on
every layout and both tabs, is a `TargetSwitch` (`js/targetswitch.js`) for
the whole page: what the Drive tab's controls drive, and what a program
runs on. On the simulator the Driver sends to it
in the Link's place (`driven` in `js/app.js`), through the same arbitration,
re-sends and deadlines, and no move the Drive tab makes reaches the rover.
Stop stops a connected rover too, first, so nothing the simulator does can
keep it from the rover. Autonomous there takes the simulated rover's mode
and leaves the rover alone. The scheme toggle there shows and sets the
simulator's own scheme (`SchemeToggle.bind()`): always known, set at once,
and never sent over the Link, so Normal | Advanced work with no rover, and
the Drive tab's family follows it. While the rover is the target the
simulator takes the rover's scheme, so a switch to the simulator starts
from it. A switch is a new way to lose control, so it stops a running program and lets
go of every held control, with one STOP to the target left behind if this
panel was driving it. The link chip keeps speaking for the rover there
("Rover:" before its word), and says "Rover exploring", amber, while the
rover reports that it explores, dashed once the link goes, so a rover sent
exploring before the switch never moves unseen. A lost or stale link lets go of nothing driving the
simulator. Leaving the Drive tab lets go of a held rotate button too: off
the Drive tab the view plays at the operator's speed. A drive press takes
the simulated rover over from a preview, as it does the rover from a
program. There is one view of the simulator, in the view pane beside both
tabs: held at 1x while the Drive tab shows, because the Driver re-sends in
real time, and at the operator's speed on the Program tab.

**The Program tab** runs a block program on the rover, or previews it on the
simulator. Its toolbar, one slim row that heads the editor's card (on a
phone on its side, a bare row beside or under the cells: the layouts,
above), holds Run (Run on rover, or Preview; on the rover "Run" alone at
the narrowest, its title saying the rest), Stop program (neutral, never red,
and never shortened: it ends the program, and sends STOP only if the
program was driving, where the top's Stop always stops the rover), the
File menu, and the View toggle (`js/programtab.js`), quiet whether pressed
or not, which shows or hides the view pane on this tab alone: hidden, the
pane is gone, no strip left behind, and the editor takes its room. The
view starts shown where the screen has room for both (a wide screen, or a
tablet upright), and a switch to the simulator shows it there again; on a
phone it starts hidden on either target, where it squeezed the editor to a
strip, and Preview shows it, so a preview never runs unseen. Blockly's
categories run down the editor's left, closer together in a short editor
and closer still under 170 px tall, so all seven fit at 480 x 320, or
along its top on an upright phone (`BlockEditor.NARROW`), wrapping to a
second row rather than scrolling; an editor under 360 px wide or 260 px
tall drops Blockly's trash can and zoom buttons (a pinch still zooms), and
one under 200 px tall and 400 px wide, but on an upright phone, its empty
hint (the File menu's examples are a press away). An example or an import
opens at its top-left, zoomed to fit the editor's width, never past the
starting scale or under 0.4, and is fitted again as that width changes
(Preview or View putting the view beside it, on a phone on its side),
until the operator zooms or pans (`BlockEditor.resize()`). Its scrollbars show only while the program
runs past the view (`data-overflow`), and Export is off, saying why, while
the editor is empty. The console's line, under the editor (under the view,
on a wide screen with the view shown), says briefly what is running and
why Run is off ("Not connected."), its title and Run's in full; with no
link on the rover target, while the view's connect card is out of sight, a
Connect beside that line presses the popover's. On the rover a program
needs a live link, and drives only through `Driver.program()`: each move
is re-sent every `REPEAT_MS`, asking 400 ms, like a held control, and the
operator's hands win over it. A drive press, blur, a hidden or closed
page, the link lost, stale or disconnected, Stop, Autonomous, the tab's
Stop program or a switch of target stops a run, and an abort sends STOP
only if the program was driving. Stop program, the operator's own, ends it
with a neutral "Stopped." (`own` on the run's end,
`ProgramRunner.abort()`); amber is for a stop the panel imposed. While a
program runs the Program tab's corner says so, on either tab: a pulsing
green dot for a run on the rover, and a still, hollow green ring for a
preview (`data-running`), whose title says that any drive press takes
over. Its commands are paced (`COMMAND_GAP_MS` and `REPEAT_GAP_MS` in
`js/program.js`), so no loop floods the rover; it acts only on fresh
readings, and never takes no echo for a clear way; every loop yields. Its
limits on a drive, a drive-until and a wait are `ProgramRunner`'s
(`js/program.js`). The compiled code runs with the page's globals in
reach, so a program loaded from anywhere goes through
`RoverBlocks.sanitize()`, which drops block ids, and `RoverBlocks.harden()`
keeps comments out of the code. On the rover, Run asks first when the editor
holds several stacks, and when the program drives a pivot while the rover is
not on ADVANCED. Under NORMAL, the target's, each drive block that pivots
and would run (none in a disabled block) carries Blockly's warning before Run is pressed
(`RoverBlocks.schemeWarning()`). The motion menu keeps all 18 motions
whatever the scheme: Blockly puts the menu's first choice in place of a
saved value it does not offer, so a saved pivot would drive forward. A program's own stop and start exploring are not presses:
the Driver raises no event for them. The tab's File menu holds the
examples, Import, Export and Clear; loading an example or importing over a
program, and Clear, ask first too. Every question the panel asks goes
through `AskDialog` (`js/ask.js`), in the page's one `<dialog>`, never
`window.confirm()`, `alert()` or `prompt()`: desktop Chrome blurs the window
as its own dialog closes, and the blur stopped the run just confirmed; the
desktop app's browser pane dismisses native dialogs unseen. Blockly's own
questions (deleting every block, or a variable in use) go through it too
(`app.js`), with Cancel focused; only its prompts for a variable's name (new
or renamed), which need a text field, and its note that a name is taken stay
Blockly's own in-page dialogs. The link's popover, the File menu, the
simulator's settings and Options share `Popover` (`js/popover.js`).

**The simulator** holds no Link and no Driver: it sends nothing, and its
telemetry never reaches the scan fan or the readouts. It takes the Drive
tab's commands as `Rover::command()` does, each ending within
`COMMAND_DURATION_MAX_MS`, and `RESUME_AUTONOMOUS` takes the mode and stands
still. It follows the
firmware's wheel table with ideal mecanum kinematics, `MOTOR_SPEED_LIMIT`, the
400 ms deadline and the 200 ms re-send, the sweep's timing (so readings are as
old as the rover's) and telemetry every 500 ms. It does not model exploring,
wheel slip, inertia, motor lag, the sonar's beam width, or temperature, phase
and halt. The numbers that describe this rover are estimates, in the
calibration block of `js/sim.js` with how to measure each.

## Firmware updates over the link

The panel's Options (the gear) has a Firmware section after Keys: the
build the rover runs, Choose for a `firmware.bin`, an OTA password field,
Update and Cancel, a progress bar and a status line, which says why Update
is off while it is ("Connect to the rover first.") and an update's result
until the next file is chosen. It is the panel's own
way to do what `pio run -e car_ota -t upload` does, which a browser cannot:
espota starts with a UDP invitation and the board then connects back to the
computer over TCP. ArduinoOTA keeps working beside it, and both check the
one OTA password `config.h` may set, which the panel's updates need.

- **The image goes over the link the panel already holds**, one binary
  frame of at most 1000 bytes at a time, each sent only once the rover has
  asked for it (`next`). The WebSocket library drops a frame whose TCP
  segments arrive more than 2 ms apart (`WEBSOCKETS_TCP_TIMEOUT`), and
  Firefox splits a payload over 1000 bytes into two writes; 1000 bytes and
  the header fit one segment (`Protocol.h`). A frame that comes in pieces
  ends the update.
- **The rules are `FirmwareUpdate`'s**, host-tested in
  `test/test_firmware_update`, and listed in its header. `FlashSlot` writes
  the other app slot through arduino-esp32's `Update`; the image's MD5 is
  checked once it is whole, and the image itself as it is made the one to
  boot.
- **Safety:** see the update's lines under
  [Loss of control stops the rover](#invariants). Beginning stands the rover
  down; the first chunk waits for it to be at rest; motion from anyone ends
  the update; the restart waits for rest too, and comes up in manual.
- **The password** is needed: a rover without one refuses every update
  over the link (`features::LINK_UPDATE_NEEDS_PASSWORD`, below). It is
  checked as ArduinoOTA checks espota's: the rover sends a single-use nonce
  and the client answers md5hex(md5hex(password):nonce:cnonce). The panel
  never keeps the password, logs it or sends it.
- **Trial boot:** a new image is kept only once it has run 30 s since it
  first got online (`Network::updatesOpen()`); until then the next reset
  boots the old one, and both update paths wait (`FirmwareUpdate` refuses
  every update until `setSecret()`, and ArduinoOTA's invitations go
  unanswered, then are dropped).
- **Who may connect:** the WebSocket server refuses the handshake of a
  browser page from anywhere but a file, this computer or the local network
  (`protocol::originAllowed()`, checked by `HeartbeatServer`), so an
  ordinary web page the operator has open cannot drive the rover. It cannot
  keep out a determined one: a sandboxed frame's Origin is `null`, like a
  file's. That is why updates need the password. Clients that are not
  browsers send no Origin.
- **The panel** (`js/firmware.js`, with `js/md5.js`) offers Update only on a
  live link, with telemetry naming the running firmware, and a file that is
  an ESP32 app image (its first byte 0xE9 and the app description's magic
  at byte 32). It stops a program running on the rover first, gives up on
  a rover silent for 10 s, carries on with the popover closed, and after the
  restart and a new connection says whether the rover runs the file sent.
  It does not reconnect by itself.

## The gamepad

`GamepadSession` turns the pad's reports into commands; `test/test_gamepad`
checks its rules. The left stick picks one of eight moves and wins over the
triggers; L2 rotates left (counter-clockwise) and R2 right, matching the
panel's Left button and `drive.py`'s `q`. A trigger's speed follows its whole
pull, up to half the stick's top speed. A held stick is re-sent every
`GAMEPAD_REFRESH_MS` (200 ms); a new direction goes at once, a new speed in
the same direction at most every `GAMEPAD_SPEED_CHANGE_MS` (100 ms). Letting
go sends one STOP, never a stream, so a resting pad cannot keep forcing manual
while the rover explores; a pad silent for `GAMEPAD_SILENCE_MS` counts as let
go. START sends `RESUME_AUTONOMOUS`. Cross sends STOP, driving or not, as
the panel's Stop does, and a stick held through it waits for centre before
it drives again; pressed with START, Cross wins.

**Control schemes.** The rover holds one scheme for every controller
(`main.cpp` owns it; the default is `DEFAULT_CONTROL_SCHEME` in `Features.h`),
so the pad and the panel always drive the same way. NORMAL is the above.
ADVANCED adds the eight pivots (codes 9 to 16): holding L1 makes the stick's
quadrant pick a pivot, holding R1 a pivot sideways; the panel gives the
pivots a second stick, with the same choice as a selector over it. SELECT
toggles the scheme, the panel's toggle on the rover target
sends the `scheme` message, and the pad's player LEDs show it (1 NORMAL, 2 ADVANCED),
rewritten at most every `GAMEPAD_LED_MIN_INTERVAL_MS` (250 ms): each write is
a Bluetooth send from the loop task, and any client can flip the scheme as
fast as it sends.

Any client may change the scheme, so a change never redirects a held stick:
the pad stops what it was driving and waits for the stick to come back to
centre, so a toggle elsewhere can only ever stop it. The panel's pivot
stick lets go too, and its translate stick drives the same way under either
scheme: see the scheme toggle under
[The browser control panel](#the-browser-control-panel).

`kinematics::moveForStick` maps the stick for the pad; the panel carries a
copy, and both are tested against `test/vectors/stick_moves.json`.
[docs/mecanum.md](docs/mecanum.md) has the table and warns that none of it
is bench-verified yet. Every row matches the owner's reference,
[DroneBot Workshop's mecanum table](https://dronebotworkshop.com/mecanum/),
whose constants `test/test_move_patterns` decodes, so change a row only on the
bench's evidence or the reference's.

## Pins

Every GPIO and motor-terminal assignment is in `src/Pins.h`. The numbers are
ESP32 GPIOs, not the D1 R32's UNO-style silkscreen labels, and the two differ:
D8 on the silkscreen is GPIO12.

**A pin constant is a hardware change.** It records where a wire is soldered;
changing one without rewiring the robot breaks it. Never change one unprompted:
report it and let the operator decide.

Open hazard: the scanner's ECHO (`pins::SCAN_ECHO`) is on GPIO12, a strapping
pin. Held high at reset it switches the flash supply to 1.8 V and the board
does not boot, intermittently. The fix is a wire (to GPIO34) plus the constant,
in one change, which is the operator's call. Both ECHO lines also carry 5 V
and need a divider or level shifter. `MOTOR_TERMINAL` disagrees with the table
in `docs/Readme.md`. The bench checklist covers all three, along with the
alternatives for GPIO12 and how to recover a board that will not boot.

## src/config.h

`src/config.h` holds the live WiFi SSID and password, and optionally an OTA
password, which both update paths check. It is gitignored. Never read it by any means (an editor, `cat`,
`grep`, a glob that matches it, printing its macros), never commit it, and
never paste from it. To search `src/`, use `git grep --untracked`, which
searches new files too but skips gitignored ones; a plain recursive `grep`
reads it, and so does `git grep` with `--no-index` or
`--no-exclude-standard`. The build products under `.pio/build/`
(`firmware.elf`, `firmware.bin`, `Network.cpp.o`) contain the same strings,
so never dump them with `strings`, `xxd` or similar either.
`src/config.example.h` has the same shape with placeholder values, and that
is everything you need. Only `src/Network.cpp` includes it. A new setting
that belongs there must be added to `config.example.h` too, because CI
builds against the template. Never write an OTA password into
`platformio.ini`, which git tracks: `config.example.h` shows how the
operator passes one to an upload instead.

## Conventions

- `.clang-format` is Google style, 2-space indent, no column limit.
- The board compiles as **C++11** (gnu++11), and so do the host tests. No
  C++14 or C++17: no `std::optional`, structured bindings, `if constexpr`,
  `std::make_unique`, or multi-statement `constexpr` functions.
- Move codes are part of the wire protocol and the clients carry copies.
  Append new codes before `MOVE_CODE_COUNT`; never renumber.
  `tools/check_protocol.py`, run in CI, fails when a client's copy drifts.
- Behaviour constants go in `Tuning.h` (free of Arduino, so the tests share
  them), autonomy thresholds in `ExploreParams`, pins in `Pins.h`. A value a
  client mirrors names its copy in a comment, and `tools/check_protocol.py`
  checks the copy. The panel simulator's copies in
  `extras/joystick/js/sim.js` (the wheel table, the sweep timing, the
  command duration cap) are checked by `extras/joystick/test/sim.test.js`
  instead.
- Optional features are switches in `Features.h`, not commented-out code, and
  every setting keeps compiling (CI builds `car_wire_gamepad` for the gamepad
  path).
- Prefer deleting dead code to commenting it out. Git has the history.
- ArduinoJson 7: `JsonDocument` grows on the heap rather than having a fixed
  capacity, and passing one by value deep-copies it. Take `JsonVariantConst`
  for read-only parameters, and read fields with `|` so a missing or mistyped
  key gets a safe default.
- `millis()` wraps every 49.7 days. Compare times only through `src/Timing.h`:
  `timing::reached(now, deadline)` for a deadline in the future (signed),
  `timing::since(now, then)` or `timing::elapsed(now, then, interval)` for an
  age (unsigned, so it stays right for any age up to 49.7 days). Never
  `now >= deadline`.
- Library and platform versions are pinned exactly in `platformio.ini`. Bump
  one at a time and re-run everything.
- Comments explain why, and often name the bug a line prevents.
