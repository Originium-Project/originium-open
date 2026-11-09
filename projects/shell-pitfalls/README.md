# Shell pitfalls that make a check pass by accident

Six traps in plain shell behaviour (and the standard utilities every script calls). Each one turns a failed step into a success, or a wrong value into a right-looking one, usually without any error message. Every reproduction below was run on bash 5.2 and zsh 5.9; the output shown is what they printed.

Use this list when you write a script that gates something (a push, a merge, a deploy) on the result of another command.

## 1. zsh does not split unquoted variables

```sh
s="a b"
for f in $s; do echo "$f"; done
```

bash prints two lines (`a`, `b`). zsh prints one line (`a b`), because zsh does not word-split unquoted parameter expansions. A loop over a list of files then runs once, with a file name that does not exist.

Fix: write the list as an array and expand it with `"${files[@]}"`, which behaves the same in bash and zsh (`files=(a b); for f in "${files[@]}"; do ...`). In zsh only, `${=s}` forces splitting of a string. Check that the loop ran the number of times you expect.

## 2. A pipe reports the last command's status

```sh
false | tail -1; echo $?     # 0 in bash and zsh
```

`cmd | tail -1` returns the status of `tail`, so a failing test run piped into `tail` looks green. Either enable `set -o pipefail` (bash) or `setopt pipefail` (zsh), after which the example above prints `1`, or capture the output first:

```sh
out=$(cmd); rc=$?
```

and gate on `$rc`.

## 3. `ps | grep` finds the grep itself

```sh
ps -eo args | grep -c needle        # prints 1 although no "needle" process exists
ps -eo args | grep -c "[n]eedle"    # prints 0
```

`grep needle` is a process whose own command line contains `needle`, so it matches itself. A "wait until the job is gone" loop built this way never sees the job gone. Writing one character of the pattern as a bracket class (`[n]eedle`) still matches the real job, but no longer matches the text `[n]eedle` in grep's own command line. Run the two lines from a script file or an interactive prompt: inside `sh -c '...'` the outer shell's own command line also contains the word, so the counts come out higher (the exact numbers depend on how the command is run).

## 4. `path` is not a free variable name in zsh

In zsh, `path` is tied to `PATH`. Assigning to it replaces the search path:

```sh
zsh -c 'path=(/nonexistent); ls'
# zsh:1: command not found: ls
```

A `while read path` loop overwrites `PATH` with each line it reads, and commands stop being found ("command not found"). Use another name (`p`, `file_path`). The same applies to `fpath`, `cdpath`, `manpath` and `module_path`.

## 5. `set -e` ignores a failure on the left of `&&`

```sh
set -e
false && echo never
echo still running      # printed
```

A command that fails as a non-final part of an `&&` or `||` list does not stop the script. `cmd && echo OK` followed by more steps is not a gate: write `cmd || exit 1`, or an explicit `if`.

## 6. Empty output is not the same as "clean"

```sh
[ -z "$(ls /no/such/dir 2>/dev/null)" ] && echo "nothing found"   # prints "nothing found"
```

`ls` fails here (non-zero exit), writes its error to stderr, and prints nothing to stdout. A test for empty output reports "nothing found" although the command never looked. Run the command first, check its status, then look at the output:

```sh
out=$(ls /no/such/dir) || exit 1
[ -z "$out" ] && echo "nothing found"
```

The same applies to any "no output means nothing found" check: confirm the command ran (exit status, or a known-good line in the output) before you trust an empty answer.

A related detail, the same in bash and zsh: `local x=$(cmd)` returns the status of `local`, not of `cmd`. Declare first (`local x`), then assign (`x=$(cmd)`), and read `$?` after the assignment.

```sh
f() { local x=$(false); echo "one step: $?"; }     # prints "one step: 0" in bash 5.2 and zsh 5.9
g() { local x; x=$(false); echo "two steps: $?"; } # prints "two steps: 1" in both
f; g
```

## License

MIT, copyright (c) 2026 Originium Project contributors. See [LICENSE](LICENSE).
