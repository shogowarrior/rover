#!/bin/sh
# PostToolUse: build the firmware, run the host tests and check the clients
# against the protocol, after an edit.
#
# This project has no runtime feedback loop -- a broken build, a broken
# invariant in the pure logic, or a client whose copy of the protocol has
# drifted is otherwise not discovered until someone flashes the board and
# watches it misbehave. So after an edit inside the project:
#
#   * a C/C++ source or header anywhere but test/, or platformio.ini: build
#     car_wire (~8 s from a warm cache);
#   * the gamepad adapter, or a header its Bluetooth-only code uses, or
#     platformio.ini: also build car_wire_gamepad. car_wire compiles that code
#     out (ROVER_ENABLE_GAMEPAD is 0 there), so its build says nothing about it;
#   * a host-tested module, a header they share, anything under test/, or
#     platformio.ini: also run the host tests, `pio test -e native`;
#   * a file tools/check_protocol.py reads -- a client, or a firmware file a
#     client mirrors -- or the checker itself: run it (milliseconds).
#
# The host-tested list below mirrors build_src_filter in [env:native] plus the
# headers those modules include, and the protocol list mirrors the files
# tools/check_protocol.py reads; keep them in step.
#
# The build runs in the checkout the edited file is in, so an edit in a git
# worktree of this project builds that worktree, not the main checkout. A
# checkout with no src/config.h (a fresh clone or worktree: the file is
# gitignored, and only the operator creates it) is built against
# src/config.example.h instead, as CI does, from a copy under .pio/: src/ is
# never touched.
#
# settings.json runs this after Edit and Write only. A file changed any other
# way -- sed or a heredoc through Bash -- is never built or tested here.
#
# Exit 2 returns stderr to Claude so it can fix the break immediately.

input=$(cat)

# get KEY.PATH -- print the string at that path in the hook input, or nothing.
# jq is the usual parser and python3 stands in for it.
if command -v jq >/dev/null 2>&1; then
  get() { printf '%s' "$input" | jq -r --arg p "$1" 'getpath($p | split(".")) | strings'; }
elif command -v python3 >/dev/null 2>&1; then
  get() {
    printf '%s' "$input" | python3 -c '
import json, sys
node = json.load(sys.stdin)
for key in sys.argv[1].split("."):
    node = node.get(key) if isinstance(node, dict) else None
if isinstance(node, str):
    sys.stdout.write(node)
' "$1"
  }
else
  # Say so rather than skip quietly: a silent hook reads as a passing build.
  echo "Build check skipped: .claude/hooks/build-check.sh needs jq or python3" >&2
  echo "to read which file was edited, and found neither. Install jq." >&2
  exit 2
fi

path=$(get tool_input.file_path)
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

protocol=no
case "$file" in
  client/*.py | extras/joystick/*.js | tools/check_protocol.py | \
    src/MoveCodes.h | src/Tuning.h | src/Kinematics.h | src/Protocol.cpp | \
    src/Explorer.h | src/Explorer.cpp)
    protocol=yes
    ;;
esac

case "$file" in
  *.cpp | *.h | *.ino | platformio.ini) ;;
  *) [ "$protocol" = yes ] || exit 0 ;;
esac

build=no
case "$file" in
  test/*) ;;  # the tests are not part of the firmware
  *.cpp | *.h | *.ino | platformio.ini) build=yes ;;
esac

# What the `#if ROVER_ENABLE_GAMEPAD` half of Gamepad.cpp reads: the mailbox
# (GamepadSession.h), the controls (Kinematics.h), timing and tuning, and the
# switch itself (Features.h).
gamepad=no
case "$file" in
  src/Gamepad.* | src/GamepadSession.h | src/Features.h | src/Kinematics.h | \
    src/Tuning.h | src/Timing.h | platformio.ini)
    gamepad=yes
    ;;
esac

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

# First, as it takes milliseconds and needs no toolchain.
if [ "$protocol" = yes ]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "Protocol check skipped after editing $file: python3 is not on PATH, so" >&2
    echo "nothing has checked the clients against the firmware. Install Python 3." >&2
    exit 2
  fi
  out=$(python3 tools/check_protocol.py 2>&1) ||
    fail "Protocol check (tools/check_protocol.py) FAILED" "$out" '.'
  printf '%s\n' "$out"
fi

[ "$build" = yes ] || [ "$tests" = yes ] || exit 0

PIO="${PIO_BIN:-$HOME/.platformio/penv/bin/pio}"
if [ ! -x "$PIO" ]; then
  if command -v pio >/dev/null 2>&1; then
    PIO=pio
  else
    # As above: without pio nothing was built, and silence would say it was.
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
