#!/bin/sh
# PreToolUse guard: keep this rover's WiFi credentials, src/config.h, out of
# the transcript. settings.json runs it before every tool call, built in or
# MCP. CLAUDE.md ("Hooks") lists what it blocks, each section below says why,
# and test_guard.py beside it holds a case for every rule. It is a tripwire
# for the obvious spellings, not a sandbox: it cannot see what a variable, a
# script or an alias expands to at run time (`cat "$f"`, `sh dump.sh`).
# settings.json's Read and Edit deny rules are another layer, and the rule
# in AGENTS.md is what actually protects the file.
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
# string_values -- print every single-line string anywhere in tool_input, one
# per line: whatever a tool calls its path, and however deeply it nests it.
# The text a tool searches for or writes is left out: a Grep for the name, or
# an edit of .gitignore whose old_string is the name, opens nothing. Glob's
# pattern is kept, as it names the files the tool returns.
# Without jq there is no telling a read of config.h from any other call, so
# fail closed, but not through block(): its note about the file would come
# with every call, however unrelated.
command -v jq >/dev/null 2>&1 || {
  echo "Blocked: .claude/hooks/guard-secrets.sh needs jq to inspect tool calls, and found none. Install jq." >&2
  exit 2
}
get() { printf '%s' "$input" | jq -r --arg p "$1" 'getpath($p | split(".")) | strings'; }
string_values() {
  printf '%s' "$input" | jq -r '
    .tool_name as $tool | .tool_input | paths(strings) as $p
    | select((($p[-1] | IN("old_string", "new_string", "content", "new_source"))
              or ($p[-1] == "pattern" and $tool != "Glob")) | not)
    | getpath($p) | select(contains("\n") | not)'
}

# Parse once up front: input that cannot be read cannot be cleared either.
cwd=$(get cwd) || block "the tool call could not be parsed, so it could not be checked."
project=${CLAUDE_PROJECT_DIR:-$cwd}

# Path handling shared by every check below, as awk functions.
#   norm(p, base)  p lower-cased and made absolute: a file:// url becomes its
#                  path, ~ is $HOME, a relative path is anchored at base,
#                  and '.', '..' and repeated '/' are resolved, so that
#                  SRC//./Config.h and src/x/../config.h both come out as
#                  .../src/config.h.
#   glob_re(g, loose)  a shell glob as an anchored-ready regular expression:
#                  * and ? stay within one directory unless `loose`, ** (zsh)
#                  crosses any number, [...] and {a,b} are kept.
PATHS_AWK='
BEGIN {
  for (i = 32; i < 127; i++) hexchar[sprintf("%02x", i)] = sprintf("%c", i)
}
function unescape(s,   out, h) {
  out = ""
  while (match(s, /%[0-9a-fA-F][0-9a-fA-F]/)) {
    h = tolower(substr(s, RSTART + 1, 2))
    out = out substr(s, 1, RSTART - 1) ((h in hexchar) ? hexchar[h] : "?")
    s = substr(s, RSTART + 3)
  }
  return out s
}
function norm(p, base,   n, i, k, seg, part, out) {
  if (tolower(substr(p, 1, 7)) == "file://") {
    p = unescape(substr(p, 8))
    if (tolower(substr(p, 1, 9)) == "localhost") p = substr(p, 10)
  }
  if (p == "~" || substr(p, 1, 2) == "~/") p = home substr(p, 2)
  if (substr(p, 1, 1) != "/") p = base "/" p
  n = split(tolower(p), part, "/")
  k = 0
  for (i = 1; i <= n; i++) {
    if (part[i] == "" || part[i] == ".") continue
    if (part[i] == "..") { if (k > 0) k--; continue }
    seg[++k] = part[i]
  }
  out = ""
  for (i = 1; i <= k; i++) out = out "/" seg[i]
  return out == "" ? "/" : out
}
function glob_re(g, loose,   i, c, re, j, body, alts, n, a, star) {
  star = loose ? ".*" : "[^/]*"
  re = ""
  for (i = 1; i <= length(g); i++) {
    c = substr(g, i, 1)
    if (c == "*" && substr(g, i + 1, 1) == "*") {
      i++
      if (substr(g, i + 1, 1) == "/") { i++; re = re "(.*/)?" } else re = re ".*"
    } else if (c == "*") re = re star
    else if (c == "?") re = re (loose ? "." : "[^/]")
    else if (c == "[" && (j = index(substr(g, i + 2), "]")) > 0) {
      body = substr(g, i + 1, j)
      if (substr(body, 1, 1) == "!") body = "^" substr(body, 2)
      re = re "[" body "]"
      i += j + 1
    } else if (c == "{" && (j = index(substr(g, i + 1), "}")) > 0) {
      n = split(substr(g, i + 1, j - 1), alts, ",")
      body = ""
      for (a = 1; a <= n; a++) body = body (a > 1 ? "|" : "") glob_re(alts[a], loose)
      re = re "(" body ")"
      i += j
    } else if (index("\\.+()|^$[]{}", c)) re = re "\\" c
    else re = re c
  }
  return re
}
'

# normalise PATH -- norm() for one path, anchored at the working directory.
normalise() {
  printf '%s\n' "$1" | awk -v home="$HOME" -v base="$cwd" "$PATHS_AWK"'{ print norm($0, base) }'
}

secret=$(normalise "$project/src/config.h")
[ -n "$secret" ] || block "the project path could not be normalised, so nothing could be checked."

# --- Paths -------------------------------------------------------------------

# Every string in the call, whatever the tool names its field: file_path,
# notebook_path, path, Serena's relative_path, a browser's file:// url, the
# files a tool is asked to send or publish. Relative ones are tried against
# the working directory and the project, as tools anchor them at either. Any
# src/config.h counts, not only this checkout's: a worktree's copy holds the
# same credentials. A string with a space in it is prose unless it starts
# like an absolute path: norm() would otherwise read "Never read ." as a
# directory and the rest as a path below it. So a relative path with a space
# in it is missed; this project has none.
named=$(string_values) || block "the tool call could not be parsed, so it could not be checked."
if [ -n "$named" ]; then
  hit=$(printf '%s\n' "$named" | awk -v home="$HOME" -v cwd="$cwd" -v project="$project" "$PATHS_AWK"'
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\// && tolower(substr($0, 1, 7)) != "file://" { next }  # a web address
    /[ \t\r]/ && !/^[\/~]/ && tolower(substr($0, 1, 7)) != "file://" { next }  # prose
    norm($0, cwd) ~ /\/src\/config\.h$/ || norm($0, project) ~ /\/src\/config\.h$/ { print; exit }') ||
    block "awk failed, so the tool call could not be checked."
  [ -z "$hit" ] || block "'$hit' is src/config.h."
fi

# --- Grep globs --------------------------------------------------------------

# Searching a directory skips gitignored files, but an explicit glob
# overrides .gitignore: `glob: "*.h"` alone would print the file's lines.
#
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

# Reads a command as shell words and prints the first hazard it finds as two
# lines, its kind and a detail, or nothing.
#
# Words: quotes and backslashes are honoured; ; | & ( ) ` $( and newlines
# start a new command; a # comment and a heredoc's body are skipped.
#
# A word is at command position after an operator, past NAME=value
# assignments and wrappers (sudo, env, time, xargs and their options...).
# Each program's arguments are then split into options, the values options
# take, and operands, so that `grep -rn -A 3 WIFI client` searches client/
# for WIFI. An operand covers src/config.h when it is the file, src/, or a
# directory above it, and a search with no directory operand covers the
# working directory, which follows each `cd`. A word holding a variable or a
# command substitution could be anything, so as an operand of a recursive
# search it counts as covering.
COMMAND_AWK='
function covers(p,   up) {
  if (p ~ /[$`]/) return 1
  if (p ~ /[*?[]/) {
    p = "^" glob_re(norm(p, cwd), 0) "$"
    for (up = srcdir; up != ""; sub(/\/[^\/]*$/, "", up)) if (up ~ p) return 1
    return secret ~ p
  }
  p = norm(p, cwd)
  return p == "/" || p == srcdir || p == secret || index(srcdir "/", p "/") == 1
}
function expands_to_secret(w) {
  return w !~ /[$`]/ && w ~ /[*?[{]/ && secret ~ ("^" glob_re(norm(w, cwd), 0) "$")
}
function rg_glob_selects(g,   re, here) {
  g = tolower(g)
  if (substr(g, 1, 1) == "!") return 0  # an exclusion never adds a file
  re = "^" glob_re(g, 1) "$"
  here = norm(".", cwd) "/"
  return "config.h" ~ re || "src/config.h" ~ re ||
    (index(secret, here) == 1 && substr(secret, length(here) + 1) ~ re)
}

# Tokenising.
function flush() {
  if (inword && wantdelim) { delim = cur; wantdelim = 0 }
  else if (inword) { n++; word[n] = cur; quoted[n] = q; isop[n] = 0 }
  cur = ""; q = 0; inword = 0
}
function operator(c) { flush(); n++; word[n] = c; isop[n] = 1 }
# Whether the operator at k ends a pipeline (; & && || or a newline), so that
# a listing made before it cannot reach a reader after it. | and |& pass one
# on, as may a subshell or a command substitution, and so does a newline
# that follows a |.
function ends_pipeline(k,   prev, nxt) {
  prev = isop[k - 1] ? word[k - 1] : ""
  nxt = isop[k + 1] ? word[k + 1] : ""
  if (word[k] == "|") return prev == "|" || nxt == "|"
  if (word[k] == "&" || word[k] == "\n") return prev != "|"
  return word[k] == ";"
}
# At the newline that ends a line with <<DELIM on it, skip to the line after
# the one holding just DELIM.
function skip_heredoc(   rest, eol, line) {
  while (delim != "" && i < len) {
    rest = substr(text, i + 1)
    eol = index(rest, "\n")
    line = eol ? substr(rest, 1, eol - 1) : rest
    i += eol ? eol : length(rest)
    sub(/^\t+/, "", line)
    if (line == delim) delim = ""
  }
  delim = ""
}

# Whether a grep or rg searches src/: one of its operands covers it, or it
# has none and searches the working directory. The first argument is the
# pattern, unless -e or -f gave it.
function searches_src(   k) {
  for (k = patternopt ? 1 : 2; k <= nargs; k++) if (covers(arg[k])) return 1
  return nargs < (patternopt ? 1 : 2) && covers(".")
}

# One command: when it ends, judge it.
function finish() {
  if (prog == "cd" && nargs == 1 && arg[1] !~ /[$`*?[]/ && arg[1] != "-") cwd = norm(arg[1], cwd)
  if (prog == "find" && findpaths == 0 && covers(".")) namessrc = 1  # GNU find lists . by default
  if (prog ~ /^[ef]?grep$/ && recursive && searches_src()) found = "recursive-grep\n" prog
  else if (prog == "rg" && (noignore != "" || rgglob != "") && searches_src())
    found = noignore != "" ? "rg-no-ignore\n" noignore : "rg-glob\n" rgglob
  if (found == "" && fed && namessrc &&
      prog ~ /^([ef]?grep|rg|ag|ack|cat|head|tail|less|more|sed|awk|nl|tr|cut|sort|strings|xxd|od|hexdump|base64|bat)$/)
    found = "fed-reader\n" prog
}
function start_command() {
  finish()
  prog = ""; nargs = 0; recursive = 0; patternopt = 0; noignore = ""; rgglob = ""
  skipnext = 0; endopts = 0; atcmd = 1; wrapped = 0; fed = 0; findexpr = 0; findpaths = 0
}

{ text = text $0 "\n" }

END {
  srcdir = secret; sub(/\/[^\/]*$/, "", srcdir)

  n = 0; cur = ""; q = 0; inword = 0; quote = ""; delim = ""; wantdelim = 0
  len = length(text)
  for (i = 1; i <= len; i++) {
    c = substr(text, i, 1)
    if (quote == "\047") { if (c == "\047") quote = ""; else cur = cur c; continue }
    if (quote == "\"") {
      if (c == "\"") quote = ""
      else if (c == "\\" && i < len) { i++; cur = cur substr(text, i, 1) }
      else cur = cur c
      continue
    }
    if (c == "\047" || c == "\"") { quote = c; q = 1; inword = 1; continue }
    if (c == "\\" && i < len) {
      i++
      if (substr(text, i, 1) != "\n") { cur = cur substr(text, i, 1); q = 1; inword = 1 }
      continue
    }
    if (c == "#" && !inword) { while (i < len && substr(text, i + 1, 1) != "\n") i++; continue }
    if (c == " " || c == "\t") { flush(); continue }
    if (c == "$" && substr(text, i + 1, 1) == "(") { i++; operator("$("); continue }
    if (c == "\n") { operator(c); skip_heredoc(); continue }
    # The & of a redirection (2>&1, <&3, &>file) joins nothing: without this
    # `find . 2>&1 | xargs cat` would read as two commands, and lose its find.
    if (c == "&" && (substr(text, i - 1, 1) ~ /[<>]/ || substr(text, i + 1, 1) == ">")) { flush(); continue }
    if (index(";|&()`", c)) { operator(c); continue }
    if (c == "<" && substr(text, i + 1, 2) == "<<") { flush(); i += 2; continue }  # here-string
    if (c == "<" && substr(text, i + 1, 1) == "<") {
      flush(); i++
      if (substr(text, i + 1, 1) == "-") i++
      wantdelim = 1
      continue
    }
    if (c == "<" || c == ">") { flush(); continue }
    cur = cur c; inword = 1
  }
  flush()

  # Each command in turn, following any cd. Every word is first checked for
  # expanding to the file itself, and for naming src/. namessrc, a listing
  # that can include the file, lasts to the end of its pipeline: a find over
  # src/ or a directory above it, or any word naming src/ itself (as
  # `git ls-files -o src` does). The tests of a find are not read, so
  # `find . -name "*.md" | xargs grep` is refused too: git grep --untracked
  # and rg skip gitignored files.
  found = ""; namessrc = 0
  start_command()
  for (k = 1; k <= n && found == ""; k++) {
    w = word[k]
    if (isop[k]) {
      start_command()
      if (ends_pipeline(k)) namessrc = 0
      continue
    }
    if (!quoted[k] && w !~ /^-/ && expands_to_secret(w)) { found = "shell-glob\n" w; break }
    if (w !~ /^-/ && w !~ /[$`*?[]/ && norm(w, cwd) == srcdir) namessrc = 1
    if (atcmd) {
      if (w ~ /^[A-Za-z_][A-Za-z0-9_]*=/) continue       # an assignment
      if (wrapped && (w ~ /^-/ || w ~ /^[0-9]+$/)) continue  # the wrapper options
      base = tolower(w); sub(/.*\//, "", base)
      if (base ~ /^(sudo|env|command|exec|time|nice|nohup|xargs|then|do|else|if|while|until|!|\{)$/) {
        wrapped = base ~ /^(sudo|env|nice|xargs)$/
        if (base == "xargs") fed = 1
        continue
      }
      prog = base; atcmd = 0; wrapped = 0
      continue
    }
    if (skipnext) {
      skipnext = 0
      if (prog == "rg" && rgoption ~ /^(-g|--glob|--iglob)$/ && rg_glob_selects(w)) rgglob = w
      continue
    }
    # find lists the paths before its first test (-name, !, a parenthesis).
    # The options ahead of them, GNU and BSD, are not paths.
    if (prog == "find" && !findexpr) {
      if (w ~ /^-([HLPEXdsxfD]+|O[0-9]*)$/) continue
      if (w !~ /^-/ && w != "!" && w != "(") {
        findpaths++
        if (covers(w)) namessrc = 1
        continue
      }
      findexpr = 1
    }
    if (prog == "find" && w ~ /^-(exec|execdir|ok|okdir)$/) {
      finish(); prog = ""; nargs = 0; atcmd = 1; fed = 1
      continue
    }
    if (w == "--" && !endopts) { endopts = 1; continue }
    if (w ~ /^--./ && !endopts) {
      if (prog ~ /grep$/) {
        if (w ~ /^--(recursive|dereference-recursive|directories=recurse)$/) recursive = 1
        if (w == "--directories" && word[k + 1] == "recurse") recursive = 1
        if (w ~ /^--(regexp|file)(=|$)/) patternopt = 1
        if (w ~ /^--(regexp|file|include|exclude|exclude-dir|exclude-from|label|max-count|after-context|before-context|context|directories|devices|binary-files)$/) skipnext = 1
      } else if (prog == "rg") {
        if (w ~ /^--(no-ignore|unrestricted)/) noignore = w
        if (w ~ /^--(regexp|file)(=|$)/) patternopt = 1
        if (w ~ /^--i?glob=/) { g = w; sub(/^--i?glob=/, "", g); if (rg_glob_selects(g)) rgglob = g }
        if (w ~ /^--(regexp|file|glob|iglob|type|type-not|type-add|after-context|before-context|context|max-count|threads|max-depth|replace|max-columns|encoding|sort|sortr|pre|pre-glob|ignore-file|max-filesize|color|colors|path-separator|context-separator|engine)$/) {
          skipnext = 1; rgoption = w
        }
      }
      continue
    }
    if (w ~ /^-./ && !endopts) {
      if (prog ~ /grep$/) {
        if (w ~ /^-[A-Za-z]*[rR]/) recursive = 1
        if (w == "-d" && word[k + 1] == "recurse") recursive = 1
        if (w ~ /^-[A-Za-z]*[ef]/) patternopt = 1
        if (w ~ /[efmABCdD]$/) skipnext = 1
      } else if (prog == "rg") {
        if (w ~ /^-[A-Za-z]*u/) noignore = w
        if (w ~ /^-[A-Za-z]*[ef]/) patternopt = 1
        if (w ~ /^-g./) { if (rg_glob_selects(substr(w, 3))) rgglob = substr(w, 3) }
        else if (w ~ /[efgtTABCmjdMrE]$/) { skipnext = 1; rgoption = w ~ /g$/ ? "-g" : w }
      }
      continue
    }
    arg[++nargs] = w
  }
  if (found == "") finish()
  if (found != "") print found
}
'

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

  # git grep skips gitignored files, which is why AGENTS.md sends a search of
  # src/ to it, but two of its options undo that: --no-index searches the
  # directory as plain files, and --no-exclude-standard makes --untracked
  # take ignored files too. Either reads src/config.h. git accepts any
  # unambiguous prefix of a long option, so match the shortest it takes,
  # --no-ind and --no-exc (--no-in and --no-ex are ambiguous). grep reads a
  # line at a time, so first join the lines at each escaped newline, as the
  # shell does: one that ends in an odd run of backslashes.
  joined=$(printf '%s\n' "$lower" | awk '{
    n = match($0, /\\+$/) ? RLENGTH : 0
    if (n % 2) printf "%s", substr($0, 1, length($0) - 1); else print
  }') || block "awk failed, so the command could not be checked."
  if matches "$joined" '(^|[^[:alnum:]_.-])git[[:space:]]([^|;&]*[[:space:]])?grep[[:space:]][^|;&]*--no-(ind|exc)'; then
    block "git grep --no-index and --no-exclude-standard search gitignored files,
src/config.h among them. Search with git grep --untracked, which skips them."
  fi

  hazard=$(printf '%s\n' "$cmd" | awk -v home="$HOME" -v cwd="$cwd" -v secret="$secret" \
    "$PATHS_AWK$COMMAND_AWK") || block "awk failed, so the command could not be checked."
  kind=$(printf '%s\n' "$hazard" | sed -n 1p)
  detail=$(printf '%s\n' "$hazard" | sed -n 2p)
  case "$kind" in
    shell-glob)
      block "the shell would expand '$detail' to include src/config.h. Name the files
you mean, or search with git grep --untracked, rg, or the Grep tool." ;;
    recursive-grep)
      block "a recursive $detail over src/ (or a directory above it) reads src/config.h:
grep does not know it is gitignored. Search with git grep --untracked, rg, or
the Grep tool, which all skip gitignored files; rg also searches a directory
you name, such as .pio/libdeps/." ;;
    rg-no-ignore)
      block "rg $detail searches gitignored files, and this search covers src/.
Drop the flag (rg skips gitignored files by default), or name the directory
you mean." ;;
    rg-glob)
      block "rg's --glob '$detail' overrides .gitignore, and this search covers src/,
so it would read src/config.h. Use -t/--type (it respects .gitignore), or a
narrower glob or directory." ;;
    fed-reader)
      block "this hands $detail a listing of src/ (or of a directory above it), and
$detail reads every file it is given, gitignored or not. Search with
git grep --untracked, rg, or the Grep tool, which skip gitignored files." ;;
  esac

  # The build products. The firmware embeds the SSID and password as string
  # literals, so everything that links src/Network.cpp carries them in the
  # clear: firmware.elf, firmware.bin and Network.cpp.o under .pio/build/.
  # Listing their symbols (nm) or sizes is fine; printing their strings or
  # raw bytes is not, and neither is reading one whole. Flags are
  # case-sensitive here: objdump -S and readelf -S are harmless, -s and -x
  # are not.
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
  # A whole-file reader given a product in the same command of a pipeline,
  # so `nm firmware.elf | head` stays usable. Other files under .pio/build/
  # (idedata.json, the .d dependency lists) hold no secrets, so only the
  # products themselves, or a wildcard that could pick one, count here.
  reader='(^|[^[:alnum:]_.-])(cat|head|tail|base64|less|more|dd|tr|nl|bat|sed|awk)[[:space:]][^|;&]*'
  if matches "$lower" "$reader"'(firmware\.(elf|bin)|network\.cpp\.o|\.pio/build/[^[:space:]]*[*?[])'; then
    block "this command would read a firmware build product whole, and the firmware
carries the WiFi SSID and password as plain strings. Use nm or a size tool."
  fi
fi

exit 0
