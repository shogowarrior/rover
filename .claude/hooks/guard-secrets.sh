#!/bin/sh
# PreToolUse guard: keep this rover's WiFi credentials out of the transcript.
#
# src/config.h holds the live WiFi SSID and password. It is gitignored, but
# nothing otherwise stops it being read into context and echoed into a
# transcript, commit message, or PR body. src/config.example.h has the same
# shape with placeholder values and is always fine to read.
#
# What is checked, whichever tool the call is for:
#
#   file_path, notebook_path, path   (Read, Edit, Write, NotebookEdit, Grep)
#       blocked when it names src/config.h.
#   glob                             (Grep)
#       blocked when it could select config.h and the search covers this
#       project's src/. Searching a directory skips gitignored files, but
#       ripgrep's --glob overrides .gitignore, so `glob: "*.h"` alone would
#       search the file and print its matching lines.
#   command                          (Bash, the terminal panel's run_in_terminal)
#       blocked when the text names config.h, once every config.example.h is
#       removed; and when it names a firmware build product (.pio/build/,
#       firmware.elf or .bin, Network.cpp.o) together with a tool that prints
#       its strings or bytes (strings, xxd, od, objdump -s, grep -a...). The
#       firmware embeds the credentials as plain strings, so those files leak
#       them without ever naming config.h. This is a tripwire for the obvious
#       spellings, not a sandbox: it cannot see a wildcard or variable that
#       only expands to the file at run time (`cat src/*.h`). The Read deny
#       rule in settings.json is the other layer.
#
# The Mac's disk is case-insensitive, so SRC/Config.h opens the same file:
# every comparison is made on a lower-cased, normalised path.
#
# Exit 2 blocks the tool call and returns stderr to Claude.

set -f  # never glob-expand: the patterns below are data, not file lists

block() {
  echo "Blocked: $1" >&2
  echo "src/config.h holds this rover's live WiFi SSID and password. Its shape, with" >&2
  echo "placeholder values, is in src/config.example.h -- work from that instead." >&2
  exit 2
}

input=$(cat)
[ -n "$input" ] || block "the hook received no tool call to check."

# get KEY.PATH -- print the string at that path in the hook input, or nothing.
# jq is the usual parser and python3 stands in for it. With neither there is
# no telling a read of config.h from any other call, so fail closed.
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
  echo "Blocked: .claude/hooks/guard-secrets.sh needs jq or python3 to inspect tool" >&2
  echo "calls for access to src/config.h, and found neither. Install jq." >&2
  exit 2
fi

# Parse once up front: input that cannot be read cannot be cleared either.
cwd=$(get cwd) || block "the tool call could not be parsed, so it could not be checked."

# Lower-case a path, anchor it at the session's working directory if it is
# relative, and resolve '.', '..' and repeated '/', so that SRC//./Config.h
# and src/x/../config.h both come out as .../src/config.h.
normalise() {
  case "$1" in
    /*) p=$1 ;;
    *) p="$cwd/$1" ;;
  esac
  printf '%s\n' "$p" | tr '[:upper:]' '[:lower:]' | awk -F/ '{
    n = 0
    for (i = 1; i <= NF; i++) {
      if ($i == "" || $i == ".") continue
      if ($i == "..") { if (n > 0) n--; continue }
      seg[++n] = $i
    }
    out = ""
    for (i = 1; i <= n; i++) out = out "/" seg[i]
    print (out == "" ? "/" : out)
  }'
}

is_secret() {
  case "$1" in
    */src/config.h) return 0 ;;
  esac
  return 1
}

# --- Paths -------------------------------------------------------------------

for key in file_path notebook_path path; do
  value=$(get "tool_input.$key")
  [ -n "$value" ] || continue
  target=$(normalise "$value")
  [ -n "$target" ] || block "the path '$value' could not be normalised, so it could not be checked."
  is_secret "$target" && block "$key '$value' is src/config.h."
done

# --- Grep globs --------------------------------------------------------------

# glob_selects GLOB RELPATH -- whether GLOB could select config.h, whose path
# relative to the search root is RELPATH. Deliberately looser than ripgrep, so
# it can over-block but never under-block: {a,b} alternatives become '*',
# '**/' becomes '*', a shell pattern's '*' also crosses '/', and several globs
# in one string (split on spaces or commas) are each tried.
glob_selects() {
  loose=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' |
    sed -e ':a' -e 's/{[^{}]*}/*/g' -e 'ta' -e 's#\*\*/#*#g' | tr ',' ' ')
  for g in $loose; do
    case "$g" in
      '!'*) continue ;;  # an exclusion never adds a file
    esac
    for name in config.h src/config.h "$2"; do
      case "$name" in
        $g) return 0 ;;
      esac
    done
  done
  return 1
}

glob=$(get tool_input.glob)
if [ -n "$glob" ]; then
  root=$(normalise "$(get tool_input.path)")
  [ "$root" = / ] && root=  # so "$root/" below is "/", not "//"
  secret=$(normalise "${CLAUDE_PROJECT_DIR:-$cwd}/src/config.h")
  case "$secret" in
    "$root"/*)
      if glob_selects "$glob" "${secret#"$root"/}"; then
        block "glob '$glob' would search src/config.h: an explicit glob overrides
.gitignore. Use type: \"cpp\" (it respects .gitignore) or a narrower path."
      fi
      ;;
  esac
fi

# --- Bash --------------------------------------------------------------------

# matches TEXT ERE -- whether TEXT matches ERE. A grep that fails, rather than
# finding nothing, blocks: a check that did not run has not cleared anything.
matches() {
  printf '%s\n' "$1" | grep -Eq "$2"
  case $? in
    0) return 0 ;;
    1) return 1 ;;
    *) block "grep failed, so the command could not be checked." ;;
  esac
}

cmd=$(get tool_input.command)
if [ -n "$cmd" ]; then
  lower=$(printf '%s\n' "$cmd" | tr '[:upper:]' '[:lower:]')

  # The template is safe to name, so drop it first. Then look for config.h,
  # or config followed by a wildcard, as a name of its own: sdkconfig.h and
  # friends are other files.
  if matches "$(printf '%s\n' "$lower" | sed 's/config\.example\.h//g')" \
    '(^|[^a-z0-9_.-])config(\.h|\.?[[*?])'; then
    block "this command names src/config.h (or a wildcard that matches it).
If it only mentions the file -- a commit message, say -- pass the text through
a file instead (git commit -F <file>)."
  fi

  # The build products. The firmware embeds the SSID and password as string
  # literals, so everything that links src/Network.cpp carries them in the
  # clear: firmware.elf, firmware.bin and Network.cpp.o under .pio/build/.
  # Listing their symbols (nm) or sizes is fine; printing their strings or
  # raw bytes is not. Flags are case-sensitive here: objdump -S and readelf -S
  # are harmless, -s and -x are not.
  product='\.pio/build|firmware\.(elf|bin)|network\.cpp\.o'
  dump='(^|[^[:alnum:]_.])(strings|xxd|hexdump|hd|od)([^[:alnum:]_.-]|$)'
  dump="$dump"'|objdump[^|;&]*[[:space:]](-[[:alpha:]]*s|--full-contents)'
  dump="$dump"'|readelf[^|;&]*[[:space:]](-[[:alpha:]]*[xpR]|--(hex|string|relocated)-dump)'
  dump="$dump"'|(grep|rg)[^|;&]*[[:space:]](-[[:alpha:]]*a|--text|--binary)'
  if matches "$lower" "$product" && matches "$cmd" "$dump"; then
    block "this command would print the strings or bytes of a firmware build
product, and the firmware carries the WiFi SSID and password as plain strings.
Use nm or a size tool on it, not strings, xxd, od, objdump -s or grep -a."
  fi
fi

exit 0
