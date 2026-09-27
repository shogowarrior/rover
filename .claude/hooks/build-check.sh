#!/bin/sh
# PostToolUse: build the firmware, and run the host tests, after an edit.
#
# This project has no runtime feedback loop -- a broken build, or a broken
# invariant in the pure logic, is otherwise not discovered until someone
# flashes the board and watches it misbehave. So after an edit to a C/C++
# source or header, or platformio.ini, inside the project:
#
#   * anywhere but test/: build car_wire (~8 s from a warm cache);
#   * a host-tested module, a header they share, anything under test/, or
#     platformio.ini: also run the host tests, `pio test -e native`.
#
# The host-tested list below mirrors build_src_filter in [env:native] plus the
# headers those modules include; keep the two in step.
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
project=${CLAUDE_PROJECT_DIR:-$(pwd)}

# Only files inside the project can change the firmware; a scratch file
# elsewhere is not worth a build.
case "$path" in
  "$project"/*) file=${path#"$project"/} ;;
  *) exit 0 ;;
esac

case "$file" in
  *.cpp | *.h | *.ino | platformio.ini) ;;
  *) exit 0 ;;
esac

build=yes
case "$file" in
  test/*) build=no ;;  # the tests are not part of the firmware
esac

tests=no
case "$file" in
  src/Kinematics.* | src/MovePatterns.* | src/Explorer.* | src/Rover.* | \
    src/Protocol.* | src/MoveCodes.h | src/Tuning.h | src/Hardware.h | \
    test/* | platformio.ini)
    tests=yes
    ;;
esac

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

cd "$project" || exit 0

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

if [ "$build" = yes ]; then
  out=$("$PIO" run -e car_wire 2>&1) ||
    fail "Firmware build FAILED" "$out" 'error|Error|undefined reference'
  printf '%s\n' "$out" | grep -E '^(RAM|Flash):'
fi

if [ "$tests" = yes ]; then
  out=$("$PIO" test -e native 2>&1) ||
    fail "Host tests FAILED" "$out" ':FAIL|\[FAILED\]|error|Error|undefined reference|test cases'
  printf '%s\n' "$out" | grep -E 'test cases' | tail -1
fi

exit 0
