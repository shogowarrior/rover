@AGENTS.md

# Claude Code in this repository

Everything about the project is in AGENTS.md, imported above. This file covers
only what is specific to Claude Code: the hooks, skills, agent and permissions
under `.claude/`.

## Hooks

Both are wired in `.claude/settings.json`. Do not disable or work around
either. Both read the tool call with `jq` and fail closed without it: the
guard blocks every call, and the build check says what it skipped.

- **PostToolUse, `.claude/hooks/build-check.sh`.** After an Edit or Write
  inside the project (or one of its git worktrees), it runs what that file
  can break:
  - a `.cpp`, `.h` or `.ino` file outside `test/`, or `platformio.ini`: build
    `car_wire` (about 8 s warm);
  - the gamepad adapter, a header its Bluetooth-only code reads
    (`Features.h`, `GamepadSession.h`, `Kinematics.h`, `Tuning.h`),
    `Timing.h`, or `platformio.ini`: also build `car_wire_gamepad`, because
    `car_wire` compiles that code out;
  - a host-tested module (`Kinematics`, `MovePatterns`, `Explorer`, `Rover`,
    `GamepadSession`, `Protocol`), `MoveCodes.h`, `Tuning.h`, `Timing.h`,
    `Hardware.h`, anything under `test/`, or `platformio.ini`: also
    `pio test -e native`;
  - anything in `src/` or `client/`, any `.js` file under
    `extras/joystick/` at any depth, or the checker itself:
    `tools/check_protocol.py` (a fifth of a second);
  - anything in `src/`, `extras/joystick/` (the panel's page, styles, scripts
    and tests) or `test/vectors/` (the cases the panel's tests share with the
    host tests): `node --test extras/joystick/test/` (about two seconds);
  - anything under `.claude/hooks/`: `python3 .claude/hooks/test_guard.py`,
    the secrets guard's cases (a few seconds).

  It builds the checkout the edited file is in, against
  `src/config.example.h` where that checkout has no `src/config.h`, as CI
  does. A failure is handed back so the break is fixed at once; this project
  has no other feedback loop. It fires only for the Edit and Write tools:
  change firmware, test and client files with those, or run the build, the
  host tests, the protocol check and the panel tests, and after a change
  under `.claude/hooks/` `python3 .claude/hooks/test_guard.py`, yourself
  after any change made through Bash (sed, a heredoc, a script, the `mv`
  that puts a proven guard in place). To run exactly what an edit would,
  against the template where the checkout has no `src/config.h` (a
  worktree, where a bare `pio run` stops at the `#error` in
  `src/Network.cpp`), hand the hook the file you changed, from the
  checkout's root:
  `printf '{"tool_input":{"file_path":"%s"}}' "$PWD/src/Rover.cpp" | .claude/hooks/build-check.sh`.
- **PreToolUse, `.claude/hooks/guard-secrets.sh`.** Runs before every tool
  call, built in or MCP (Serena, the browser panes, the terminal panel), and
  blocks one that would touch `src/config.h`:
  - any string in the call's input that is a path to the file, in this
    checkout or another, compared case-insensitively after normalising it
    (`file://` URLs included);
  - a Grep glob that could select it, because an explicit glob overrides
    `.gitignore`;
  - a Bash or terminal-panel command that names it or a wildcard matching
    it, has a word the shell would expand to it (`cat src/*.h`), runs a
    recursive grep, or an `rg` that ignores `.gitignore` or picks files with
    `--glob`, over `src/` or a directory above it, or feeds a listing of
    `src/` or a directory above it to a reader (`find src | xargs grep`);
  - a `git grep` with `--no-index` or `--no-exclude-standard`, wherever it
    searches: both read gitignored files;
  - a command that dumps a firmware build product (`strings`, `xxd`,
    `objdump -s`...) or reads one whole (`cat`, `head`, `base64`...): the
    firmware embeds the same strings.

  `settings.json` also denies `Read` and `Edit` of `./src/config.h`. The
  command check is a tripwire, not a sandbox: it cannot see what a variable,
  a script or an alias expands to at run time. The rule in AGENTS.md is what
  actually protects the file, from every tool. Because the check reads the
  command text, a commit message that mentions the file must go through a
  file (`git commit -F <file>`). `.claude/hooks/test_guard.py` holds a case
  for every rule, run by CI and by the build hook: a change to the guard
  that lets one case through, or blocks one it should allow, fails there.

  **Never edit `guard-secrets.sh` in place.** It runs before every tool call
  and fails closed, so a guard that does not parse blocks every tool,
  including the ones that would fix it. An apostrophe in a comment inside
  its single-quoted awk program once did exactly that, and only the operator,
  from a terminal, could restore it. Make the change in a copy, prove the copy
  with `sh -n <copy>` and
  `python3 .claude/hooks/test_guard.py --guard <copy> --shell /bin/sh`, then
  replace the file in one step (`mv <copy> .claude/hooks/guard-secrets.sh`).
  Merging a branch that changes the guard follows the same rule: prove the
  incoming file (`git show <branch>:.claude/hooks/guard-secrets.sh`) first.

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

## Looking at the panel

Check the panel's look and behaviour in the desktop app's built-in browser
pane: it shows the live DOM, and the operator sees the same view. The pane
renders a `file://` page as a static snapshot, with no CSS or JS, so serve the
panel instead. `.claude/launch.json` defines the `panel` preview: it runs
`.claude/serve_panel.py`, which serves `extras/joystick/` on
`http://localhost:8766` with every response marked `no-store`. Python's plain
`http.server` let the pane run a fresh script against a stale cached one.

- Measure the layout with JavaScript, and resize the pane to 375 and 1280 px
  wide. Take screenshots only where they add something.
- A hidden pane pauses the simulator preview, as a hidden page should.
- Background agents running in parallel cannot share the one pane, so they
  use a headless script.
- Never use a headed browser MCP: it opens windows on the operator's screen.
- The only browser an agent may launch is Playwright's
  `chrome-headless-shell`. Never launch a full Chrome app, headless or not,
  by Playwright, raw CDP or a spawn: Google Chrome, or the "Google Chrome for
  Testing.app" in Playwright's cache. macOS registers each app bundle that
  launches in the operator's Notifications settings. Two round-4 agents
  probing focus with a headless Chrome for Testing left two entries there.
  If a check needs a real, focused browser window (blur around the
  file picker, say), report it as a manual check for the operator instead.

## Permissions

`.claude/settings.json` lets a fixed set of commands run without a prompt:
building (`pio run` bare or with `-e car_wire`, `-e car_ota` or
`-e car_wire_gamepad`), `pio test -e native`, `pio check`,
`python3 tools/check_protocol.py`, and read-only git (`status`, `diff`,
`log`). The build rules are exact commands, not prefixes, so in the default
permission mode anything with `-t upload` asks, and so does the serial
monitor, inside `/flash` too: its frontmatter pre-approves only the builds,
listing the USB port and pinging the OTA host. Auto and bypass modes do not
prompt, which is why `/flash` stops and asks the operator itself before
uploading. Uploading is never approved in advance: it happens when the
operator runs `/flash`.
