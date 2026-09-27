@AGENTS.md

# Claude Code in this repository

Everything about the project is in AGENTS.md, imported above. This file covers
only what is specific to Claude Code: the hooks, skills, agent and permissions
under `.claude/`.

## Hooks

Both are wired in `.claude/settings.json`. Do not disable or work around
either.

- **PostToolUse, `.claude/hooks/build-check.sh`.** After an Edit or Write to
  a `.cpp`, `.h` or `.ino` file or `platformio.ini` inside the project, it
  builds `car_wire` (about 8 s warm), except for files under `test/`. After a
  change to a host-tested module (`Kinematics`, `MovePatterns`, `Explorer`,
  `Rover`, `Protocol`), `MoveCodes.h`, `Tuning.h`, `Hardware.h`, anything
  under `test/` or `platformio.ini`, it also runs `pio test -e native`. A
  failure is handed back so the break is fixed at once; this project has no
  other feedback loop. It fires only for the Edit and Write tools: change
  firmware and test files with those, or run the build and the host tests
  yourself after any change made through Bash (sed, a heredoc, a script).
- **PreToolUse, `.claude/hooks/guard-secrets.sh`.** Blocks any tool call that
  would touch `src/config.h`: a file path naming it (compared case-insensitively
  after normalising the path), a Grep glob that could select it, or a Bash
  command that names it. `settings.json` also denies `Read(./src/config.h)`.
  The Bash check is a tripwire, not a sandbox: it cannot see a wildcard that
  only expands to the file at run time. The rule in AGENTS.md is what
  actually protects the file. Because the check reads the command text, a
  commit message that mentions the file must go through a file
  (`git commit -F <file>`).

## Skills

- **`/flash`** builds, checks the transport is reachable (the USB port, or a
  ping to the rover for OTA), uploads, and can tail the serial monitor. It is
  marked `disable-model-invocation`: only the operator can start it, and it is
  the only way the board gets flashed. Never upload any other way, and never
  plan flashing as a step you will take.
- **`/pin-audit`** cross-checks every constant in `src/Pins.h` against the
  D1 R32 header map, the strapping and input-only pins, the motor-terminal
  table and 5 V echo levels, and reports a table. It is read-only. Run it
  whenever a change touches `src/Pins.h` or adds a peripheral, and when a
  board boots only some of the time.

## The hardware-safety-reviewer agent

`.claude/agents/hardware-safety-reviewer.md` reviews a change for one
question: can it make the robot do something unsafe, unrecoverable or
unbootable? It looks for unbounded motion, missing failsafes, a blocked loop,
states only a power cycle escapes, motor state shared across tasks, strapping
pins, and sensor errors that fail toward danger. Run it after changing motor
control, `loop()`, sensor handling, network input handling, a failsafe or a
pin, before calling the change done.

## Permissions

`.claude/settings.json` lets a fixed set of commands run without a prompt:
building (`pio run` bare or with `-e car_wire`, `-e car_ota` or
`-e car_wire_gamepad`), `pio test -e native`, `pio check`, and read-only git
(`status`, `diff`, `log`). The build rules are exact commands, not prefixes,
so anything with `-t upload` always asks. Uploading is never approved in
advance: it happens when the operator runs `/flash`.
