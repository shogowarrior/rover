#!/bin/sh
# PostToolUse: after an Edit or Write in this project or one of its worktrees,
# build, test and check what the edited file can break. CLAUDE.md ("Hooks")
# lists what runs when, and each case below says why. This project has no
# runtime feedback loop: a break is otherwise found only by flashing the
# board and watching it misbehave. A file changed any other way, sed or a
# heredoc through Bash, is never checked here.
#
# It builds the checkout the edited file is in. Where that checkout has no
# src/config.h (gitignored; only the operator creates it), the build uses a
# copy of src/config.example.h under .pio/, as CI does: src/ is never touched.
#
# Exit 2 returns stderr to Claude so it can fix the break at once, and so does
# a missing tool: a silent hook would read as a passing build.

# require TOOL WHAT -- stop unless TOOL is on PATH, saying WHAT went unchecked.
require() {
  command -v "$1" >/dev/null 2>&1 && return
  echo "$2 skipped after editing ${file:-a file}: $1 is not on PATH. Install it." >&2
  exit 2
}

input=$(cat)
require jq "Build check"
path=$(printf '%s' "$input" | jq -r '.tool_input.file_path | strings')
[ -n "$path" ] || exit 0
project=${CLAUDE_PROJECT_DIR:-$(pwd)}

# common_dir DIR -- the git directory DIR's checkout shares with every other
# worktree of its repository, resolved; nothing if DIR is not in one.
common_dir() {
  (cd "$1" 2>/dev/null && cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P)
}

# Which checkout the file is in (root), and its path inside it (file). Only
# files in this project, or in one of its worktrees, can change the firmware;
# a scratch file elsewhere is not worth a build. Without git, fall back to
# "under the project directory".
dir=$(dirname "$path")
if root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) &&
  prefix=$(git -C "$dir" rev-parse --show-prefix 2>/dev/null); then
  [ "$(common_dir "$root")" = "$(common_dir "$project")" ] || exit 0
  file=$prefix${path##*/}
else
  case "$path" in
    "$project"/*) root=$project file=${path#"$project"/} ;;
    *) exit 0 ;;
  esac
fi

# Every file tools/check_protocol.py could read, rather than a list that has
# to follow it: the check takes a fifth of a second. A case * matches "/" too.
protocol=no
case "$file" in
  src/* | client/* | extras/joystick/*.js | tools/check_protocol.py) protocol=yes ;;
esac

# The browser panel's tests: the panel itself, the vectors they share with the
# host tests, and the firmware they read (about two seconds).
panel=no
case "$file" in
  extras/joystick/* | test/vectors/* | src/*) panel=yes ;;
esac

# The secrets guard's case table, after an edit to either hook or the table.
guard=no
case "$file" in
  .claude/hooks/*) guard=yes ;;
esac

build=no
case "$file" in
  test/*) ;;  # the tests are not part of the firmware
  *.cpp | *.h | *.ino | platformio.ini) build=yes ;;
esac

# The `#if ROVER_ENABLE_GAMEPAD` half of Gamepad.cpp, which car_wire compiles
# out, and the headers it reads; Timing.h too, for the pad's timing rules.
gamepad=no
case "$file" in
  src/Gamepad.* | src/GamepadSession.h | src/Features.h | src/Kinematics.h | \
    src/Tuning.h | src/Timing.h | platformio.ini)
    gamepad=yes
    ;;
esac

# build_src_filter in [env:native], the headers those modules include, and
# the tests themselves.
tests=no
case "$file" in
  src/Kinematics.* | src/MovePatterns.* | src/Explorer.* | src/Rover.* | \
    src/GamepadSession.* | src/Protocol.* | src/MoveCodes.h | src/Tuning.h | \
    src/Timing.h | src/Hardware.h | test/* | platformio.ini)
    tests=yes
    ;;
esac

cd "$root" || exit 0

# fail HEADING OUTPUT PATTERN -- report a failed step and stop. The lines that
# match PATTERN are usually the whole story; if none do, show the tail. Each
# test suite rebuilds the shared sources, so one compile error is printed once
# per suite: keep only the first copy of each line.
fail() {
  echo "$1 after editing $file:" >&2
  lines=$(printf '%s\n' "$2" | grep -E "$3" | awk '!seen[$0]++' | head -40)
  [ -n "$lines" ] || lines=$(printf '%s\n' "$2" | tail -30)
  printf '%s\n' "$lines" >&2
  exit 2
}

# The quick checks first, as they need no toolchain.
if [ "$protocol" = yes ]; then
  require python3 "Protocol check (tools/check_protocol.py)"
  out=$(python3 tools/check_protocol.py 2>&1) ||
    fail "Protocol check (tools/check_protocol.py) FAILED" "$out" '.'
  printf '%s\n' "$out"
fi

# The panel's harness runs the real page against a fake DOM; a failed check
# prints its message indented under the test's name. Stack frames and the
# assertion's own fields are dropped: the messages already say what differed.
if [ "$panel" = yes ]; then
  require node "Panel tests (node --test extras/joystick/test/)"
  out=$(node --test extras/joystick/test/ 2>&1) ||
    fail "Panel tests (node --test extras/joystick/test/) FAILED" \
      "$(printf '%s\n' "$out" |
        grep -vE '^[[:space:]]*(at |generatedMessage:|code:|actual:|expected:|operator:|[-+] |[{}]$)')" \
      '^✖|check\(s\) failed|^    [^ ]|Error|^ℹ (tests|fail) '
  printf '%s\n' "$out" | grep -E 'checks passed|^ℹ (tests|fail) '
fi

if [ "$guard" = yes ]; then
  require python3 "Secrets guard cases (.claude/hooks/test_guard.py)"
  out=$(python3 .claude/hooks/test_guard.py 2>&1) ||
    fail "Secrets guard cases (.claude/hooks/test_guard.py) FAILED" "$out" '.'
  printf '%s\n' "$out"
fi

[ "$build" = yes ] || [ "$tests" = yes ] || exit 0

PIO="${PIO_BIN:-$HOME/.platformio/penv/bin/pio}"
if [ ! -x "$PIO" ]; then
  if command -v pio >/dev/null 2>&1; then
    PIO=pio
  else
    echo "Build check skipped after editing $file: pio is not at $PIO or on PATH," >&2
    echo "so nothing has checked that this edit builds. Install PlatformIO, or" >&2
    echo "point PIO_BIN at it." >&2
    exit 2
  fi
fi

# board ENV -- build a board environment. Where src/config.h is missing, the
# template stands in for it: Network.cpp's #include "config.h" finds nothing
# beside itself and falls back to the -I directory (relative to the project,
# as PlatformIO resolves it). PLATFORMIO_BUILD_FLAGS is set for this command
# only, so the operator's own builds never see it.
board() {
  if [ -e src/config.h ]; then
    "$PIO" run -e "$1" 2>&1
  else
    mkdir -p .pio/template-include &&
      cp src/config.example.h .pio/template-include/config.h &&
      PLATFORMIO_BUILD_FLAGS='-I .pio/template-include' "$PIO" run -e "$1" 2>&1
  fi
}

if [ "$build" = yes ]; then
  [ -e src/config.h ] ||
    echo "No src/config.h in $root: building against src/config.example.h, as CI does."
  out=$(board car_wire) ||
    fail "Firmware build (car_wire) FAILED" "$out" 'error|Error|undefined reference'
  printf '%s\n' "$out" | grep -E '^(RAM|Flash):'
fi

if [ "$gamepad" = yes ]; then
  out=$(board car_wire_gamepad) ||
    fail "Gamepad build (car_wire_gamepad) FAILED" "$out" 'error|Error|undefined reference'
  printf '%s\n' "$out" | grep -E '^(RAM|Flash):' | sed 's/^/car_wire_gamepad /'
fi

if [ "$tests" = yes ]; then
  out=$("$PIO" test -e native 2>&1) ||
    fail "Host tests FAILED" "$out" ':FAIL|\[FAILED\]|error|Error|undefined reference|test cases'
  printf '%s\n' "$out" | grep -E 'test cases' | tail -1
fi

exit 0
