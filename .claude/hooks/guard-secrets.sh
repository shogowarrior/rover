#!/bin/sh
# PreToolUse guard: block any access to files holding device secrets.
#
# src/config.h contains the live WiFi SSID and password. It is gitignored, but
# nothing otherwise stops it being read into context and echoed into a
# transcript, commit message, or PR body. Exit 2 blocks the tool call and
# returns stderr to Claude.

input=$(cat)
path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty')

[ -z "$path" ] && exit 0

case "$path" in
  */src/config.h|src/config.h)
    echo "Blocked: src/config.h holds the WiFi SSID and password for this device." >&2
    echo "Its structure is documented in CLAUDE.md; work from that instead." >&2
    exit 2
    ;;
esac

exit 0
