#!/usr/bin/env python3
"""Cases for the secrets guard, .claude/hooks/guard-secrets.sh.

    python3 .claude/hooks/test_guard.py [--guard PATH] [--shell SH]

Each case is a tool call and what the guard must do with it: B, block (exit
2), or A, allow (exit 0). The paths are fictional (/p/rover, HOME=/h) and the
guard opens no file, so no case touches the disk. The guard runs with a PATH
that holds only the tools it uses, so CI's Ubuntu runner tries it with dash
and mawk where a Mac has its own sh and awk. Without jq it cannot tell one
call from another, so that run must block every call.

CI runs this, and so does the build hook after an edit under .claude/hooks/.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
P = "/p/rover"
S = "src/config.h"  # the file, relative
SA = P + "/" + S    # absolute
EX = "src/config.example.h"


def read(path, cwd=P):
    return ("Read", {"file_path": path}, cwd)


def bash(cmd, cwd=P):
    return ("Bash", {"command": cmd}, cwd)


def grep(glob, path=None, cwd=P, pattern="WIFI"):
    tool_input = {"pattern": pattern, "glob": glob}
    if path is not None:
        tool_input["path"] = path
    return ("Grep", tool_input, cwd)


CASES = [
    # --- any string in tool_input that is a path to the file ---------------
    ("read abs", "B", read(SA)),
    ("read rel", "B", read(S)),
    ("read upper", "B", read("SRC/Config.H")),
    ("read dot-dot", "B", read(P + "/src/./x/../config.h")),
    ("read double slash", "B", read("//p//rover//src//config.h")),
    ("read file url", "B", read("file://" + SA)),
    ("read file url localhost %2E", "B", read("file://localhost" + P + "/src/config%2Eh")),
    ("read tilde other checkout", "B", read("~/x/" + S)),
    ("read worktree copy", "B", read(P + "/.claude/worktrees/w1/" + S)),
    ("read from docs ../", "B", read("../" + S, cwd=P + "/docs")),
    ("read rel from other cwd (project anchor)", "B", read(S, cwd="/elsewhere")),
    ("read template", "A", read(EX)),
    ("read hpp", "A", read("src/config.hpp")),
    ("read sdkconfig", "A", read("src/sdkconfig.h")),
    ("write", "B", ("Write", {"file_path": S, "content": "x"}, P)),
    ("notebook", "B", ("NotebookEdit", {"notebook_path": SA, "new_source": "x"}, P)),
    ("serena relative_path", "B", ("mcp__serena__find_symbol", {"relative_path": S, "name_path": "x"}, P)),
    ("list of files", "B", ("SendUserFile", {"files": ["README.md", S]}, P)),
    ("deep nest", "B", ("X", {"a": {"b": [{"c": S}]}}, P)),
    ("prose", "A", ("Bash2", {"description": "Never read ./" + S + " here"}, P)),
    ("abs path then prose", "A", ("X", {"note": SA + " is secret"}, P)),
    ("abs path with space", "B", ("X", {"p": "/x y/" + S}, P)),
    ("grep pattern is a search", "A", ("Grep", {"pattern": S, "path": P + "/docs"}, P)),
    ("glob pattern names files", "B", ("Glob", {"pattern": S}, P)),
    ("edit old_string", "A", ("Edit", {"file_path": P + "/.gitignore", "old_string": S, "new_string": S}, P)),
    ("write content", "A", ("Write", {"file_path": P + "/notes.txt", "content": S}, P)),
    ("web url", "A", ("WebFetch", {"url": "https://example.com/" + S}, P)),
    ("multi-line string", "A", ("X", {"t": "a\n" + S}, P)),
    ("browser file url", "B", ("mcp__Claude_Browser__navigate", {"url": "file://" + SA}, P)),
    ("array under content", "B", ("X", {"content": ["a", S]}, P)),
    ("dict under pattern", "B", ("Grep", {"pattern": {"p": S}}, P)),

    # --- Grep globs --------------------------------------------------------
    ("glob *.h root", "B", grep("*.h", P)),
    ("glob *.h src", "B", grep("*.h", P + "/src")),
    ("glob *.h docs", "A", grep("*.h", P + "/docs")),
    ("glob *.md root", "A", grep("*.md", P)),
    ("glob braces", "B", grep("*.{h,cpp}", P)),
    ("glob **/", "B", grep("**/*.h", P)),
    ("glob exclusion only", "A", grep("!*.h", P)),
    ("glob comma list", "B", grep("*.md,*.h", P)),
    ("glob space list", "B", grep("*.md *.h", P)),
    ("glob config.*", "B", grep("config.*", P)),
    ("glob src/*", "B", grep("src/*", P)),
    ("glob upper", "B", grep("CONFIG.H", P)),
    ("glob no path", "B", grep("*.h")),
    ("glob class", "B", grep("src/con[f]ig.h", P)),
    ("glob cpp", "A", grep("*.cpp", P)),
    ("glob ?", "B", grep("?onfig.h", P)),
    ("glob root /", "B", grep("*.h", "/")),
    ("glob parent", "B", grep("*.h", "/p")),
    ("glob relpath from root", "B", grep("rover/src/*.h", "/p")),
    ("glob other dir abs", "A", grep("*.h", "/q")),
    ("glob exclusion plus include", "B", grep("!*.md,*.h", P)),
    ("glob nested braces", "B", grep("*.{c,{h,hpp}}", P)),
    ("glob type only (no glob)", "A", ("Grep", {"pattern": "x", "type": "cpp", "path": P}, P)),
    ("grep tool braces no h", "B", grep("*.{md,txt}", P)),
    ("glob dir braces", "B", grep("{src,docs}/*.h", P)),
    ("glob src/**", "B", grep("src/**", P)),
    ("glob tab list", "B", grep("*.md\t*.h", P)),
    ("glob excl then md", "A", grep("!src/*.h *.md", P)),
    ("glob below secret dir", "A", grep("*.h", P + "/src/sub")),
    ("glob relative path src", "B", grep("*.h", "src")),
    ("glob tilde path", "A", grep("*.h", "~/x")),
    ("glob file url path", "B", grep("*.h", "file://" + P)),
    ("glob upper path", "B", grep("*.h", "/P/ROVER")),
    ("glob newline list", "B", grep("*.md\n*.h", P)),
    ("glob escaped star", "A", grep("\\*.h", P)),
    ("glob exact relpath", "B", grep("src/config.h", P)),
    ("glob relpath from parent no match", "A", grep("rover/docs/*.h", "/p")),
    ("glob empty-ish", "A", grep(",", P)),

    # --- Bash: names the file ---------------------------------------------
    ("cat it", "B", bash("cat " + S)),
    ("cat template", "A", bash("cat " + EX)),
    ("cat upper", "B", bash("cat SRC/CONFIG.H")),
    ("ls config*", "B", bash("ls src/config*")),
    ("config?", "B", bash("ls src/config?h")),
    ("config.[h]", "B", bash("ls src/config.[h]")),
    ("sdkconfig", "A", bash("echo sdkconfig.h")),
    ("comment mention", "B", bash("echo hi # " + S)),
    ("terminal panel", "B", ("mcp__terminal__run_in_terminal", {"command": "cat " + S}, P)),

    # --- Bash: shell expansion ---------------------------------------------
    ("conf*", "B", bash("cat src/conf*.h")),
    ("src/*.h", "B", bash("cat src/*.h")),
    ("s*/c*.h", "B", bash("cat s*/c*.h")),
    ("?onfig", "B", bash("cat src/?onfig.h")),
    ("braces", "B", bash("cat src/{con,x}fig.h")),
    ("quoted glob", "A", bash("echo 'src/*.h'")),
    ("cd src && cat *", "B", bash("cd src && cat *")),
    ("cd abs; cat ./*", "B", bash("cd " + P + "/src; cat ./*")),
    ("glob other dir", "A", bash("cat docs/*.md")),
    ("variable", "A", bash('cat "$f"')),

    # --- Bash: recursive grep ----------------------------------------------
    ("grep -rn src/", "B", bash("grep -rn WIFI src/")),
    ("grep -rn .", "B", bash("grep -rn WIFI .")),
    # r anywhere in a cluster of short flags, not only first.
    ("grep -nr src", "B", bash("grep -nr WIFI src")),
    ("grep -ir .", "B", bash("grep -ir WIFI .")),
    ("grep -rn client", "A", bash("grep -rn WIFI client")),
    ("grep -r no operand", "B", bash("grep -r WIFI")),
    ("grep -e client", "A", bash("grep -rn -e WIFI client")),
    ("grep -e no operand", "B", bash("grep -rn -e WIFI")),
    ("grep -R ..", "B", bash("grep -R x ..", cwd=P + "/docs")),
    ("grep --recursive", "B", bash("grep --recursive x src")),
    ("grep -d recurse", "B", bash("grep -d recurse x src")),
    ("grep --directories recurse", "B", bash("grep --directories recurse x src")),
    ("grep --directories=recurse", "B", bash("grep --directories=recurse x src")),
    ("grep non-recursive", "A", bash("grep -n WIFI src/Network.cpp")),
    ("egrep -r /", "B", bash("egrep -r x /")),
    ("grep -A 3 option value", "A", bash("grep -rn -A 3 WIFI client")),
    ("grep --include value", "A", bash("grep -rn --include '*.h' WIFI client")),
    ("grep -r var", "B", bash('grep -r x "$DIR"')),
    ("grep -r cmdsub", "B", bash('grep -r x "$(pwd)"')),
    ("grep -r -- -x src", "B", bash("grep -r -- -x src")),
    ("grep -r glob dir", "B", bash("grep -r x s*")),
    ("cd docs && grep -r .", "A", bash("cd docs && grep -r x .")),
    ("cd src && grep -r .", "B", bash("cd src && grep -r x .")),
    ("sudo grep", "B", bash("sudo grep -r x src")),
    ("env grep", "B", bash("env FOO=1 grep -r x src")),
    ("assign grep", "B", bash("FOO=1 grep -r x src")),
    ("time grep", "B", bash("time grep -r x .")),
    ("nice -n 5 grep", "B", bash("nice -n 5 grep -r x src")),
    ("if grep", "B", bash("if grep -r x src; then echo y; fi")),
    ("subshell grep", "B", bash("(grep -r x src)")),
    ("cmdsub grep", "B", bash("echo $(grep -r x src)")),
    ("backtick grep", "B", bash("echo `grep -r x src`")),
    ("path grep", "B", bash("/usr/bin/grep -r x src")),
    ("git grep", "A", bash("git grep -n WIFI -- src")),
    ("git grep --untracked", "A", bash("git grep --untracked -n WIFI -- src")),
    # --no-index and --no-exclude-standard read gitignored files, and git
    # takes any unambiguous prefix of a long option: --no-ind and --no-exc
    # are the shortest.
    ("git grep --no-index", "B", bash("git grep --no-index -n WIFI src")),
    ("git grep --no-ind", "B", bash("git grep --no-ind WIFI src")),
    ("git grep --no-exclude-standard", "B", bash("git grep --untracked --no-exclude-standard WIFI")),
    ("git grep --no-exc", "B", bash("git grep --untracked --no-exc WIFI")),
    ("git -C --no-pager grep --no-index", "B", bash("git -C " + P + " --no-pager grep --no-index WIFI")),
    ("git diff --no-index", "A", bash("git diff --no-index docs/a.md docs/b.md")),
    ("heredoc body", "A", bash("cat > f <<EOF\ngrep -r x src\nEOF\necho done")),
    ("heredoc quoted dash", "A", bash("cat > f <<-'EOF'\n\tgrep -r x src\n\tEOF\necho done")),
    ("after heredoc", "B", bash("cat > f <<EOF\nhi\nEOF\ngrep -r x src")),
    ("here-string", "A", bash("grep x <<< src")),
    ("comment grep", "A", bash("echo hi # grep -r x src")),
    # A # inside a word starts no comment, so the operand after it counts.
    ("# inside a word", "B", bash("grep -r a#b " + P + "/src", cwd="/elsewhere")),
    ("escaped newline", "B", bash("grep -r \\\n x src")),
    # Which arguments are operands: -e and -f take the pattern, so the first
    # argument is then an operand too.
    ("grep two -e src", "B", bash("grep -r -e x -e y src")),
    ("grep -f file src", "B", bash("grep -r -f pats src")),
    ("grep -rf no operand", "B", bash("grep -rf pats")),
    ("grep second operand", "B", bash("grep -r x client src")),
    ("grep pattern named src", "A", bash("grep -r src client")),
    ("grep -e src client", "A", bash("grep -r -e src client")),
    ("grep -re x client", "A", bash("grep -re x client")),
    ("grep -re x", "B", bash("grep -re x")),
    ("grep -r only pattern from docs", "A", bash("grep -r x", cwd=P + "/docs")),
    ("grep -r no args at all", "B", bash("grep -r")),

    # --- Bash: rg ----------------------------------------------------------
    ("rg src", "A", bash("rg WIFI src")),
    ("rg -u", "B", bash("rg -u WIFI src")),
    ("rg -nu", "B", bash("rg -nu WIFI src")),
    ("rg --no-ignore .", "B", bash("rg --no-ignore WIFI .")),
    ("rg -uu client", "A", bash("rg -uu x client")),
    ("rg --unrestricted none", "B", bash("rg --unrestricted x")),
    ("rg -g *.h", "B", bash("rg -g '*.h' WIFI")),
    ("rg --glob= src", "B", bash("rg --glob='*.h' x src")),
    ("rg --glob sep", "B", bash("rg --glob '*.h' x src")),
    ("rg --iglob", "B", bash("rg --iglob '*.H' x")),
    ("rg -g md", "A", bash("rg -g '*.md' x")),
    ("rg -g attached", "B", bash("rg -g'*.h' x")),
    ("rg -g exclusion", "A", bash("rg -g '!*.h' x")),
    ("rg -t cpp", "A", bash("rg -t cpp x src")),
    ("rg -g client", "A", bash("rg -g '*.h' x client")),
    ("rg -g braces", "B", bash("rg -g '*.{h,cpp}' x")),
    ("rg -g src/*", "B", bash("rg -g 'src/*' x")),
    ("rg -g comma", "A", bash("rg -g '*.md,*.h' x")),
    ("rg -ig combined", "B", bash("rg -ig '*.h' x")),
    ("rg -e pattern then src", "B", bash("rg -u -e x src")),
    ("rg -A value", "A", bash("rg -A 3 -u x client")),
    ("rg -u -e no operand", "B", bash("rg -u -e x")),
    ("rg -u pattern only from docs", "A", bash("rg -u x", cwd=P + "/docs")),
    ("rg -u src as pattern", "A", bash("rg -u src client")),
    ("rg -u two operands", "B", bash("rg -u x client .")),
    ("rg -g braces no h", "A", bash("rg -g '*.{md,txt}' x")),
    ("rg -g ** h", "B", bash("rg -g '**/*.h' x")),
    ("rg -g class", "B", bash("rg -g 'src/con[f]ig.h' x")),

    # --- Bash: listings fed to readers --------------------------------------
    ("find src | xargs grep", "B", bash("find src -name '*.h' | xargs grep WIFI")),
    ("find . md | xargs grep", "B", bash("find . -name '*.md' | xargs grep x")),
    ("find src -exec cat", "B", bash("find src -exec cat {} \\;")),
    ("find docs | xargs grep", "A", bash("find docs -name '*.md' | xargs grep x")),
    ("find; separate xargs", "A", bash("find . -name x; echo y | xargs grep z")),
    ("git ls-files src | xargs cat", "B", bash("git ls-files -o src | xargs cat")),
    ("ls src | xargs cat", "B", bash("ls src | xargs cat")),
    ("find 2>&1 | xargs", "B", bash("find . 2>&1 | xargs cat")),
    ("find -print0 | xargs -0", "B", bash("find . -name '*.h' -print0 | xargs -0 grep x")),
    ("find no path", "B", bash("find -name '*.h' | xargs cat")),
    ("find -L src", "B", bash("find -L src -type f | xargs head")),
    ("find src | sort (no reader feed)", "A", bash("find src -name '*.h' | sort")),
    ("find src && xargs (new pipeline)", "A", bash("find src -name x && echo a | xargs cat")),
    ("find src |\\n xargs", "B", bash("find src |\n xargs cat")),
    ("find docs -exec cat", "A", bash("find docs -exec cat {} \\;")),
    ("find src -execdir", "B", bash("find src -execdir grep x {} +")),
    ("ls | xargs cat", "A", bash("ls | xargs cat")),
    ("find . -name x | xargs ls", "A", bash("find . -name x | xargs ls")),

    # --- Bash: build products ----------------------------------------------
    ("strings elf", "B", bash("strings .pio/build/car_wire/firmware.elf")),
    ("xxd bin", "B", bash("xxd firmware.bin")),
    ("objdump -s o", "B", bash("objdump -s .pio/build/x/src/Network.cpp.o")),
    ("strings o in its directory", "B", bash("strings Network.cpp.o", cwd=P + "/.pio/build/car_wire/src")),
    ("objdump -S", "A", bash("objdump -S firmware.elf")),
    ("readelf -x", "B", bash("readelf -x .rodata firmware.elf")),
    ("readelf -S", "A", bash("readelf -S firmware.elf")),
    ("grep -a bin", "B", bash("grep -a SSID .pio/build/car_wire/firmware.bin")),
    ("nm | head", "A", bash("nm firmware.elf | head")),
    ("cat bin", "B", bash("cat .pio/build/car_wire/firmware.bin")),
    ("head -c elf", "B", bash("head -c 100 firmware.elf")),
    ("tail -c elf", "B", bash("tail -c 4000 .pio/build/car_wire/firmware.elf")),
    ("base64 bin", "B", bash("base64 firmware.bin")),
    ("cat idedata", "A", bash("cat .pio/build/car_wire/idedata.json")),
    ("cat wildcard products", "B", bash("cat .pio/build/*/firmware*")),
    ("ls bin", "A", bash("ls -la .pio/build/car_wire/firmware.bin")),
    ("pio run", "A", bash("~/.platformio/penv/bin/pio run -e car_wire")),
    ("od bin", "B", bash("od -c firmware.bin")),
    ("hexdump elf", "B", bash("hexdump -C x/firmware.elf")),
    ("rg --text", "B", bash("rg --text SSID .pio/build")),
    ("size elf", "A", bash("xtensa-esp32-elf-size .pio/build/car_wire/firmware.elf")),
    ("sed elf", "B", bash("sed -n p firmware.elf")),

    # --- harmless ----------------------------------------------------------
    ("plain ls", "A", bash("ls -la")),
    ("pio test", "A", bash("~/.platformio/penv/bin/pio test -e native")),
    ("git status", "A", bash("git status")),
    ("check_protocol", "A", bash("python3 tools/check_protocol.py")),
    ("no strings", "A", ("X", {"n": 1}, P)),
]

# Input that is not a tool call at all: nothing can be cleared, so it blocks.
RAW = [
    ("empty input", "B", ""),
    ("invalid json", "B", "{not json"),
]

TOOLS = ("awk", "cat", "grep", "sed", "tr")  # what the guard runs besides its parser

# (name, what else is on PATH, whether the case table applies or every call
# must block, saying only that jq is missing). python3 is there without jq to
# show it does not stand in.
MODES = [
    ("jq", ("jq",), True),
    ("python3 without jq", ("python3",), False),
]


def bin_dir(root, tools):
    """A directory holding only `tools`, linked to where this machine has them."""
    os.makedirs(root)
    for tool in tools:
        found = shutil.which(tool)
        if not found:
            sys.exit(f"test_guard: {tool} is not on PATH, and the guard needs it")
        os.symlink(found, os.path.join(root, tool))
    return root


def run(shell, guard, path, stdin):
    result = subprocess.run([shell, guard], input=stdin.encode(), capture_output=True,
                            env={"PATH": path, "HOME": "/h", "CLAUDE_PROJECT_DIR": P, "LANG": "C"})
    return {2: "B", 0: "A"}.get(result.returncode, f"exit {result.returncode}"), result.stderr.decode()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--guard", default=os.path.join(HERE, "guard-secrets.sh"))
    parser.add_argument("--shell", default="/bin/sh")
    args = parser.parse_args()

    calls = [(name, want, json.dumps({"tool_name": tool, "tool_input": tool_input, "cwd": cwd}))
             for name, want, (tool, tool_input, cwd) in CASES] + RAW
    failed = 0
    with tempfile.TemporaryDirectory() as scratch, ThreadPoolExecutor(os.cpu_count()) as pool:
        for mode, parsers, table in MODES:
            path = bin_dir(os.path.join(scratch, str(len(parsers)) + "".join(parsers)), TOOLS + parsers)
            outcomes = pool.map(lambda call: run(args.shell, args.guard, path, call[2]), calls)
            wrong = 0
            for (name, want, stdin), (got, err) in zip(calls, outcomes):
                want = want if table else "B"
                # Without jq, the missing tool is all a block may name: the
                # note about config.h would come with every call, however
                # unrelated. Empty input is turned away before jq is sought.
                misleads = not table and stdin and ("needs jq" not in err or "WiFi" in err)
                if got != want or misleads:
                    wrong += 1
                    print(f"{mode}, {name}: want {want}, got {got}\n  {stdin[:120]}\n  {err.strip()[:200]}")
            print(f"{mode}: {len(calls) - wrong}/{len(calls)} as expected")
            failed += wrong
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
