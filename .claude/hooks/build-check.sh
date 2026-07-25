#!/bin/sh
# PostToolUse: compile the firmware after any edit under src/.
#
# This project has no runtime feedback loop -- a broken build is otherwise not
# discovered until someone tries to flash the board. A full `pio run` takes
# ~8s from a warm cache, which is cheap enough to pay on every edit.
#
# Exit 2 returns stderr to Claude so it can fix the break immediately.

input=$(cat)
path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')

case "$path" in
  *.cpp|*.h|*.ino|*platformio.ini) ;;
  *) exit 0 ;;
esac

PIO="${PIO_BIN:-$HOME/.platformio/penv/bin/pio}"
[ -x "$PIO" ] || { command -v pio >/dev/null 2>&1 && PIO=pio; } || exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

out=$("$PIO" run -e car_wire 2>&1)
if [ $? -ne 0 ]; then
  echo "Firmware build FAILED after editing $path:" >&2
  printf '%s\n' "$out" | grep -E 'error|Error|undefined reference' | head -30 >&2
  exit 2
fi

printf '%s\n' "$out" | grep -E '^(RAM|Flash):'
exit 0
