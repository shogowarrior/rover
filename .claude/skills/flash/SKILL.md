---
name: flash
description: Build and flash rover firmware over USB or OTA, then tail the serial monitor with the ESP32 exception decoder. Use when asked to flash, upload, deploy, or monitor the board.
disable-model-invocation: true
allowed-tools: Bash, Read
---

# Flash the rover

Flashing moves a physical robot. Never run this without the operator asking
for it, and never pick the transport for them when the choice is ambiguous.

`pio` is at `~/.platformio/penv/bin/pio` — it is not on `PATH`.

## Choose the environment

| Env | Transport | When |
|-----|-----------|------|
| `car_wire` | USB serial, `/dev/cu.usbserial*` | Default. Always works. Required after a change that could break WiFi or the main loop. |
| `car_ota` | ArduinoOTA over WiFi to `192.168.0.115` | Convenience only, and only when the robot is already running good firmware and reachable. |

**Ask which one** unless the operator said. If they did not and the board is
plugged in, prefer `car_wire` — a failed OTA leaves you walking over to the
robot with a cable anyway.

## Procedure

1. **Build first, separately.** Never let the first sign of a compile error be
   a half-written flash.
   ```
   ~/.platformio/penv/bin/pio run -e <env>
   ```

2. **For `car_ota` only — confirm the target is alive first.** OTA against a
   dead or rebooting board hangs for a long time before failing.
   ```
   ping -c 2 -t 3 192.168.0.115
   ```
   If it does not answer, stop and tell the operator to use `car_wire`. Do not
   retry. Note that the OTA IP is hardcoded in two places that can drift:
   `upload_port` in [platformio.ini](../../../platformio.ini) and the static IP
   in [src/Service.cpp](../../../src/Service.cpp).

3. **For `car_wire` only — confirm the port exists.**
   ```
   ls /dev/cu.usbserial*
   ```
   If nothing matches, the board is not plugged in or the CH340/CP210x driver
   is missing. Report that rather than guessing at a port.

4. **Upload.**
   ```
   ~/.platformio/penv/bin/pio run -e <env> -t upload
   ```

5. **Monitor** when asked, or whenever the upload was meant to fix a crash.
   `monitor_filters = esp32_exception_decoder` is already configured on
   `car_wire`, so panics come back as symbolised backtraces rather than raw
   addresses.
   ```
   ~/.platformio/penv/bin/pio device monitor -e car_wire
   ```
   This does not exit on its own. Run it in the background or with a timeout,
   and tell the operator how to stop it.

## Reading a boot failure

If the board does not come up after a flash, check in this order before
touching the code:

- **Nothing on serial at all** — likely a strapping-pin problem, not a firmware
  problem. GPIO12 held high at reset stops the board booting. Run `/pin-audit`.
- **Boots, then reboots in a loop** — read the decoded backtrace. A panic in
  `loop()` usually means a null motor pointer (`AFMS.begin()` failed because
  the shield is not on I2C) or a task stack overflow.
- **Boots, hangs before "Wireless connected."** — WiFi credentials in
  `src/config.h` are wrong, or the AP is unreachable. The firmware retries with
  a bounded number of attempts and then continues offline; if it never gets
  that far, the hang is earlier than WiFi.
