---
name: flash
description: Build and flash rover firmware over USB or OTA, then tail the serial monitor with the ESP32 exception decoder. Use when asked to flash, upload, deploy, or monitor the board.
disable-model-invocation: true
allowed-tools: Read, Bash(~/.platformio/penv/bin/pio run -e car_wire), Bash(~/.platformio/penv/bin/pio run -e car_ota), Bash(~/.platformio/penv/bin/pio run -e car_wire_gamepad), Bash(ls /dev/cu.usbserial*), Bash(ping -c 2 -t 3:*)
---

# Flash the rover

Flashing moves a physical robot. Never run this without the operator asking
for it, and never pick the transport for them when the choice is ambiguous.

`pio` is at `~/.platformio/penv/bin/pio` — it is not on `PATH`.

Only the steps that cannot move the rover are pre-approved for this skill:
the builds, listing the USB port and pinging the OTA host. In the default
permission mode the upload and the serial monitor each raise a permission
prompt, so the operator sees them before they run. A session that skips
prompts (auto mode or bypass-permissions mode) runs them without one, so the
stop-and-ask in steps 3 and 5 is the gate that always holds; a prompt, when
there is one, is an extra check and never replaces it.

## Choose the environment

| Env | Transport | When |
|-----|-----------|------|
| `car_wire` | USB serial, `/dev/cu.usbserial*` | Default. Always works. Required after a change that could break WiFi or the main loop. |
| `car_ota` | ArduinoOTA over WiFi to the host in its `upload_port`: `192.168.0.115` by default, `rover.local` on DHCP | Convenience only, and only when the robot is already running good firmware and reachable. Builds without the gamepad (below). |
| `car_wire_gamepad` | USB serial, as `car_wire` | Only when the operator wants the PS3 gamepad: it compiles in Bluetooth, which costs ~40 KB of RAM and adds WiFi latency (see `src/Features.h`). |

**Ask which one** unless the operator said. If they did not and the board is
plugged in, prefer `car_wire` — a failed OTA leaves you walking over to the
robot with a cable anyway.

**`car_ota` removes the gamepad.** It builds without it, so on a rover
flashed with `car_wire_gamepad` an OTA update takes the PS3 pad away, unless
`ROVER_ENABLE_GAMEPAD` defaults to 1 in `src/Features.h` (which turns it on
for every environment). Before using `car_ota`, ask whether the rover has a
pad; if it does and the default is still 0, flash `car_wire_gamepad` over USB
instead.

## Procedure

1. **Build first, separately.** Never let the first sign of a compile error be
   a half-written flash.
   ```
   ~/.platformio/penv/bin/pio run -e <env>
   ```

2. **For `car_ota` only — confirm the target is alive first.** OTA against a
   dead or rebooting board hangs for a long time before failing. Read the
   host from `upload_port` under `[env:car_ota]` in
   [platformio.ini](../../../platformio.ini), and ping that, not an address
   remembered from here:
   ```
   ping -c 2 -t 3 <upload_port host>
   ```
   If it does not answer, stop and tell the operator to use `car_wire`. Do not
   retry. With a static IP the address is written in two places that can
   drift: `upload_port` and `STATIC_IP` in
   [src/Network.cpp](../../../src/Network.cpp); a board that answers on
   neither is not the one to flash. With DHCP (`WIFI_IS_STATIC_IP` false in
   the operator's config), `upload_port = rover.local` is the supported
   setting: the rover advertises its hostname over mDNS.

   If the upload is refused for authentication, the operator has set an OTA
   password in `src/config.h`. Do not go looking for it — that file holds the
   WiFi credentials and is off limits. The comment on `car_ota` in
   `platformio.ini` shows how to pass it for one upload; the operator runs
   that command in their own terminal, because a password typed into this
   session lands in the transcript.

3. **For `car_wire` and `car_wire_gamepad` — confirm the port, then stop and
   ask.**
   ```
   ls /dev/cu.usbserial*
   ```
   If nothing matches, the board is not plugged in or the CH340/CP210x driver
   is missing. Report that rather than guessing at a port.

   A USB upload ends by resetting the board through its EN pin, and the ESP32
   reports an EN reset as a power-on, so the rover **starts exploring the
   moment the upload finishes**, with the cable still attached. Stop here and
   ask the operator to confirm that the rover is on a stand with its wheels
   clear of the bench, or that the motor supply is switched off. **Do not
   upload until they reply that it is.** Warning them in the same turn as the
   upload is no warning at all. The upload's permission prompt is not that
   confirmation either: it asks whether to run a command, not whether the
   wheels are clear.

4. **Upload** — for a USB env, only once the operator has confirmed step 3.
   ```
   ~/.platformio/penv/bin/pio run -e <env> -t upload
   ```
   An OTA upload stands the rover down as it starts: the motors stop and it
   drops to manual, so a rover that was driving comes to rest before its
   firmware is rewritten, and one whose upload then fails stays still until
   told otherwise.

5. **Monitor** when asked, or whenever the upload was meant to fix a crash.
   `monitor_filters = esp32_exception_decoder` is already configured on
   `car_wire` (and inherited by `car_wire_gamepad`), so panics come back as
   symbolised backtraces rather than raw addresses.
   ```
   ~/.platformio/penv/bin/pio device monitor -e car_wire
   ```
   Opening the port can reset the board through EN just as an upload does,
   and that reset starts it exploring. Unless the operator has already
   confirmed, for this session, that the rover is on a stand or its motors are
   off, stop and ask as in step 3 before opening it.

   This does not exit on its own. Run it in the background or with a timeout,
   and tell the operator how to stop it.

## After flashing: which mode the rover wakes in

A power-on starts the rover exploring, and to the ESP32 a reset through EN
(the button, a USB upload, often the serial monitor opening) is a power-on:
that is why steps 3 and 5 stop and ask. After an **OTA** flash, or any other
reset that is not a power-on (a crash, the watchdog, a brownout), it comes up
in **manual** mode, stopped, and waits to be told. Tell the operator so, or a
rover sitting still reads as a failed flash. To start exploring, press
**Autonomous** in the browser panel or `t` in `client/drive.py`.

## Reading a boot failure

If the board does not come up after a flash, check in this order before
touching the code:

- **Nothing on serial at all** — likely a strapping-pin problem, not a firmware
  problem. GPIO12 held high at reset stops the board booting. Run `/pin-audit`.
- **Boots, then reboots in a loop** — read the reset reason and the decoded
  backtrace.
  - `Brownout detector was triggered` is the usual cause on this rover, and it
    is power or wiring, not code: motors starting or stalling sag a low or
    undersized pack, or the ESP32 shares a supply rail with them. Check the
    battery and the power wiring before the firmware.
  - A task watchdog reset naming `loopTask` means one pass of `loop()` took
    over 5 s. The loop watchdog (`enableLoopWDT()` in `main.cpp`) resets the
    board rather than let it keep its motors on while deaf to commands. That
    is a blocking call somewhere on the loop — a firmware bug to find, not a
    timeout to raise. The reset does not stop the wheels at once: the
    shield's PWM chip is not reset with the ESP32, so they run on for about
    half a second, until `DriveTrain::begin()` releases them.
  - Anything else is a panic: follow the backtrace.
- **The wheels never turn** — the motor shield is missing, unpowered, or not
  on I2C. Telemetry says so: `"motorsReady": false`, which the panel shows as
  a warning and `client/drive.py` as `NO MOTORS`. The firmware also prints
  `Motor shield not found on I2C (0x60); motors disabled.` at boot, after
  three tries. Everything else keeps running, so the rover still answers
  over WiFi, but the shield is only probed at boot: fix the wiring or power,
  then reset the rover (wheels off the ground) before looking again. Check
  the shield's motor power and its seating on the headers.
- **Boots, hangs before `Wireless connected:`** — WiFi credentials in
  `src/config.h` are wrong, or the AP is unreachable. The firmware waits about
  10 s, prints `WiFi unavailable; continuing offline.`, and keeps retrying
  from `loop()`; if it never gets that far, the hang is earlier than WiFi.
