# Pitfalls Research

**Domain:** Node.js/TypeScript Windows compatibility (Git Bash / MINGW64)
**Researched:** 2026-02-22
**Confidence:** HIGH (verified against Node.js official docs, codebase inspection, known GitHub issues)

---

## Critical Pitfalls

### Pitfall 1: Process Group Kill with Negative PID (`process.kill(-pid)`)

**What goes wrong:**
`src/chipset/blitter/executor.ts` uses `process.kill(-child.pid, 'SIGTERM')` to kill a process group on timeout. This pattern is POSIX-only. On Windows, negative PIDs are not supported — the call throws `ESRCH` or silently fails, leaving spawned child processes orphaned when a timeout fires.

**Why it happens:**
The detached + negative-PID pattern is idiomatic Unix. Developers coming from Linux assume it works everywhere. Node.js docs do not prominently warn that this is a no-op on Windows.

**How to avoid:**
Add a platform check before using negative PIDs. On Windows, fall back to `child.kill('SIGTERM')` directly:

```typescript
if (process.platform !== 'win32' && child.pid) {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
} else {
  child.kill('SIGTERM');
}
```

For complete process tree termination on Windows, use the `taskkill /F /T /PID` command via `spawn`. The `tree-kill` npm package handles both platforms correctly if a dependency is acceptable.

**Warning signs:**
- `executor.ts` uses `detached: true` on spawn — this is the setup that expects negative PID kills to work
- Timeout tests that pass on CI (Linux) but never terminate child processes on Windows dev machines
- Test suite hangs or orphaned node processes visible in Task Manager on Windows

**Phase to address:** Phase that audits shell/process execution code (executor, launcher, terminal modules)

---

### Pitfall 2: `chmod()` Called on Windows NTFS Files

**What goes wrong:**
`src/chipset/blitter/executor.ts` calls `chmod(scriptPath, 0o755)` on temp script files. `src/storage/skill-store.ts` calls `chmod(scriptPath, 0o755)` on progressive-disclosure script files in `scripts/` subdirectories. On Windows NTFS, `chmod` is a no-op for the execute bit — it does not error, but the permission is never set. Scripts that rely on being executable via their shebang will fail to run when invoked directly.

**Why it happens:**
Unix developers treat `chmod +x` as a required step for shell scripts. Node.js `fs.chmod` silently accepts the call on Windows without throwing, making the bug invisible during development.

**How to avoid:**
- Wrap `chmod` calls in a platform guard: skip on `process.platform === 'win32'`
- Never invoke scripts directly by path on Windows — always pass them as arguments to an interpreter (`bash script.sh`, `node script.js`)
- The executor already chooses an interpreter per script type — the `chmod` for bash/custom scripts is only needed for the `custom` type that runs `scriptPath` directly without an interpreter. On Windows, custom scripts must be invoked through `bash` or another interpreter instead

**Warning signs:**
- `chmod` calls not wrapped in `process.platform !== 'win32'` checks
- `custom` script type in `SCRIPT_EXTENSIONS` uses `.sh` extension and runs `scriptPath` directly as the command — this fails on Windows without a `bash` prefix

**Phase to address:** Phase that audits file I/O and executor code

---

### Pitfall 3: Hardcoded Forward-Slash Path Strings in Display/Logic Code

**What goes wrong:**
Multiple files use hardcoded Unix-style paths as string literals rather than using `path.join()` or `path.sep`:
- `src/workflows/list-skills-workflow.ts`: `'~/.claude/skills/'` and `.claude/skills/` as display strings
- `src/workflows/create-skill-workflow.ts`: `` `~/.claude/skills/${name}/SKILL.md` ``, `references/`, `scripts/` — these are used as both display text and passed into functions
- `src/safety/operation-cooldown.ts`: default path `'.claude/.cooldown-state.json'`
- `src/safety/integrity-monitor.ts`: defaults `'.claude/skills'`, `'.claude/agents'`, `'.claude/.integrity-snapshot.json'`
- `src/safety/audit-logger.ts`: default `'.claude/.audit-log.jsonl'`
- `src/safety/file-lock.ts`: default `'.claude/.skill-creator.lock'`

On Windows, these strings will display correctly in output (Git Bash passes forward slashes through), but if they are ever fed to code that compares them against `path.resolve()` results (which returns backslashes on Windows), comparisons will fail silently. `assertSafePath` uses `path.resolve()` and `path.sep` — mixing hardcoded forward-slash strings with resolved paths is a latent comparison bug.

**Why it happens:**
Forward-slash paths look like valid relative paths in code review. The bug only manifests at runtime on Windows when `path.resolve()` normalizes to backslashes.

**How to avoid:**
- Use `path.join('.claude', 'skills')` instead of `'.claude/skills'` for paths passed to any file system operation
- Display strings (shown to users as `~/.claude/skills/`) are acceptable as-is since they are UI text, not filesystem paths
- Audit every location where a string literal containing `/` is passed to `assertSafePath`, `path.resolve`, `stat`, `readFile`, `writeFile`, or similar

**Warning signs:**
- `assertSafePath()` comparison failures on Windows where resolved path uses `\` but base dir was provided as a `/` string
- `path.sep` is `\` on Windows — any code that splits a path string on `/` manually will break

**Phase to address:** Phase that audits `src/safety/` defaults and workflow display paths

---

### Pitfall 4: `spawn` with `bash` Interpreter — Assumes Bash is on PATH

**What goes wrong:**
`src/chipset/blitter/executor.ts` uses `'bash'` as the interpreter for `bash` and `custom` script types. On Windows, `bash` is Git Bash's bash — it is on PATH only when Git Bash is the active shell. When the MCP server or CLI is launched from a context where Git Bash is not in PATH (e.g., cmd.exe, PowerShell, or a Windows service), spawning `bash` will fail with `ENOENT`.

The scripts in `scripts/console/` (write-status.sh, validate-config.sh, etc.) use `#!/bin/bash` shebangs and rely on `jq` being installed. Both `bash` and `jq` are external runtime dependencies that do not exist on stock Windows.

**Why it happens:**
Developers test in Git Bash where `bash` is always available. The MCP server invocation path from Claude Code uses a different process context.

**How to avoid:**
- For the executor: add a `shell` option that uses `bash` on Unix and `bash.exe` with full Git Bash path resolution on Windows, or document that `bash`/`custom` script types require Git Bash
- For shell scripts in `scripts/console/`: rewrite as Node.js scripts that work without bash or jq, since this project already targets Node.js as its runtime
- Never assume `jq` is installed — it is not a Node.js dependency and not bundled with Git Bash by default

**Warning signs:**
- Any `spawn('bash', ...)` or `spawn('sh', ...)` call without a platform-specific command override
- Shell scripts that call `jq`, `date`, `mktemp`, or other Unix utilities not available on bare Windows
- The `tests/test-gsd-stack.sh` test harness uses `mktemp`, `trap`, `$(...)` — these require Git Bash and cannot run with `node test`

**Phase to address:** Phase that audits executor, console scripts, and test infrastructure

---

## Moderate Pitfalls

### Pitfall 5: `import.meta.url` and `new URL()` Pathname Extraction

**What goes wrong:**
`src/orchestrator/__fixtures__/fixture-loader.ts` correctly uses `fileURLToPath(import.meta.url)` to get `__dirname`. However, if any code uses `new URL('.', import.meta.url).pathname` directly (without `fileURLToPath`), it produces a path starting with `/C:/...` on Windows — a MINGW-style path that Node.js fs APIs do not accept.

**Why it happens:**
`import.meta.url` returns a `file:///C:/...` URL on Windows. `URL.pathname` strips the protocol but leaves the leading `/`, producing `/C:/Users/...` which Windows APIs reject. `fileURLToPath` properly handles this difference.

**How to avoid:**
Always use `fileURLToPath(import.meta.url)` — never `.pathname`. The fixture-loader is correctly written; verify all other ESM modules follow the same pattern.

**Warning signs:**
- `new URL('.', import.meta.url).pathname` anywhere in the codebase
- ENOENT errors on Windows for paths that start with `/C:/` or `/Users/` (the leading slash is the bug)

**Phase to address:** Phase scanning ESM module path resolution patterns

---

### Pitfall 6: Vitest Snapshots Containing Path Separators

**What goes wrong:**
Tests that assert on file paths (e.g., `expect(skill.path).toBe('.claude/skills/foo/SKILL.md')`) will fail on Windows if `path.join()` is used in production code — which returns `'.claude\\skills\\foo\\SKILL.md'` on Windows. Conversely, tests that hardcode backslashes will fail on Linux CI.

The codebase has many `path:` assertions in test files (verified in `src/application/stages/model-filter-stage.test.ts`, `cache-order-stage.test.ts`, etc.).

**Why it happens:**
Tests written on Linux/macOS hardcode `/` separators. When run on Windows, `path.join()` returns `\` separators and assertions fail.

**How to avoid:**
- In tests, normalize paths before comparison: `path.normalize(result.path)` vs `path.normalize(expected)`
- Or use `path.join()` to build expected paths in tests rather than string literals
- Add `path.sep` normalization in `SkillStore` return values, or consistently use `path.normalize()` on returned paths
- Configure vitest with a `resolve.alias` or snapshot serializer that normalizes path separators

**Warning signs:**
- Tests with `.toBe('.claude/skills/...')` on path values returned by production code
- Vitest snapshot files that contain hardcoded `/` separators — these will always fail on Windows unless snapshots are regenerated per-platform

**Phase to address:** Phase that runs the full test suite on Windows and fixes failures

---

### Pitfall 7: CRLF Line Endings Breaking YAML and Shell Scripts

**What goes wrong:**
If a Windows developer's git config has `core.autocrlf=true` (the Windows default), checked-out files may have CRLF line endings. Two failure modes:
1. Shell scripts (`scripts/console/*.sh`) become unparseable — bash reports `\r: command not found` on the first line after the shebang
2. YAML files read by `js-yaml` may parse incorrectly or produce values with trailing `\r` characters, causing subtle validation failures

The `src/validation/yaml-safety.ts` parses YAML — if skill files have CRLF endings due to git autocrlf, frontmatter values could contain `\r`.

**Why it happens:**
Git's `core.autocrlf=true` is the default on Windows git installs. Without a `.gitattributes` file specifying `text=lf`, all text files get CRLF on checkout.

**How to avoid:**
- Add a `.gitattributes` file at the project root:
  ```
  * text=auto eol=lf
  *.sh text eol=lf
  *.md text eol=lf
  *.json text eol=lf
  *.yaml text eol=lf
  *.yml text eol=lf
  ```
- In YAML/JSON parsing code, trim `\r` from string values or normalize line endings before parsing: `content.replace(/\r\n/g, '\n')`
- This is the single highest-leverage fix for a Windows compatibility pass

**Warning signs:**
- No `.gitattributes` file in the repository root (confirmed: not present in this repo's untracked files)
- YAML parsing tests that pass when run in-memory but fail when files are read from disk on Windows
- Shell scripts that error with `bash\r: No such file or directory`

**Phase to address:** Phase 1 (foundation) — should be the first thing committed

---

### Pitfall 8: `os.homedir()` Returns Windows-Style Path with Backslashes

**What goes wrong:**
`src/types/scope.ts` uses `join(homedir(), '.claude', 'skills')` — this is correct. However, code that takes the result of `getSkillsBasePath('user')` and embeds it in a string, compares it to a `~`-prefixed string, or splits on `/` will break on Windows where `homedir()` returns `C:\Users\username`.

The display string `'~/.claude/skills/'` in `list-skills-workflow.ts` is a UI tilde shorthand — this is fine for display. But if any code path tries to *resolve* a literal `~` as a path (e.g., from user input or a config file), it will fail on Windows where the shell does not expand `~` in Node.js contexts.

**Why it happens:**
On Unix, `~` is shell-expanded before Node.js receives arguments. On Windows in Git Bash, `~` may or may not be expanded depending on context (it is expanded in interactive Git Bash but not in `node` process args).

**How to avoid:**
- Never pass `~` paths to `fs` APIs — always use `os.homedir()` programmatically
- When reading config files that might contain `~` paths (e.g., user-defined paths), expand `~` using `path.join(os.homedir(), value.slice(1))`
- In the CLI argument parser, check for and expand `~` in any path argument

**Warning signs:**
- ENOENT errors on Windows for paths starting with `~`
- User-facing config that allows specifying custom skill directories (a future feature) — `~` expansion must be handled explicitly

**Phase to address:** Phase that audits CLI path argument handling and config reading

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term Windows compatibility problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcoded `'.claude/skills'` in default constructor args | Simpler code | Path separator mismatch on Windows with `assertSafePath` comparisons | Never — use `path.join('.claude', 'skills')` |
| `chmod(scriptPath, 0o755)` unconditionally | One-liner permission set | Silent no-op on Windows NTFS; direct script invocation fails | Only for Unix-only execution paths, with explicit `if (process.platform !== 'win32')` guard |
| `spawn('bash', ...)` without PATH resolution | Works in Git Bash dev environment | Fails if MCP server launched outside Git Bash context | Only when the feature is explicitly documented as "requires Git Bash" |
| Shell scripts in `scripts/console/` using `jq` and `date` | Familiar POSIX tooling | Requires non-bundled tools; fails on Windows without manual setup | Never for core functionality — rewrite as Node.js scripts |
| Test assertions hardcoding `'/'` path separators | Readable test code | Test failures on Windows | Acceptable in display/UI string tests; never for filesystem path assertions |

---

## Integration Gotchas

Common mistakes when connecting to platform-specific services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| MCP server stdio transport | Assumes `console.log` safe; uses stdout for debug | Already correctly avoided in `mcp/server.ts` — extend this discipline to any new MCP tools |
| Git Bash process spawning | Assumes `spawn('bash')` finds Git Bash in PATH | Verify `bash` is resolvable; document dependency or ship with fallback |
| `@huggingface/transformers` | Binary native modules may fail on Windows ARM or Windows 32-bit | Library uses ONNX Runtime — test on target Windows version before shipping; requires Node.js 20+ |
| `natural` NLP library | Uses JS-only implementations — no native binaries | Cross-platform safe, but verify on Windows Node.js 20 |
| Vitest test runner | Snapshot files written with LF on Unix, CRLF on Windows | Configure `.gitattributes` to force LF; configure git `core.autocrlf=false` in project `.gitconfig` |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows — with Windows-specific angles.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| JSONL files loaded fully into memory (`src/observation/jsonl-compactor.ts`) | Memory pressure; slow startup | Stream JSONL line-by-line using `readline` interface | 500MB+ files; affects Windows more due to lower default Node.js heap |
| `readdir` + `stat` per skill in `SkillStore.list()` | Slow skill listing on large collections | Batch with `Promise.all`; use `withFileTypes` (already done) | 500+ skills |
| Synchronous-style operations in embedding service | Event loop blocking; CLI feels sluggish | Already async — but Windows I/O has higher per-call overhead than Linux; batch operations matter more | 100+ skill activations |
| Temp files not cleaned up on Windows crash | Accumulation in `%TEMP%\offload-exec-*` directories | The executor uses fire-and-forget `unlink` — add cleanup on process exit with `process.on('exit')` | After many executor runs with crashes |

---

## Security Mistakes

Domain-specific security issues relevant to this self-modifying tool.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Path traversal via Windows-specific sequences (`..\\`, `%2e%2e%5c`) | Escape `.claude/skills` directory, write arbitrary files | `validateSafeName` already checks `'\\'` and `..` — verify it also normalizes encoded sequences |
| YAML loaded from user-written skill files contains Windows-specific path sequences | Malicious YAML injects backslash paths that bypass validation | Normalize all path inputs through `path.resolve()` before comparison |
| Shell scripts in `scripts/console/` executed with `set -euo pipefail` — Windows bash may differ in `pipefail` behavior | Silent error swallowing on Windows bash | Test scripts with Git Bash 2.x specifically; Git Bash bundles an older bash version |
| `process.env` on Windows is case-insensitive (`PATH` = `Path` = `path`) | Env var lookups that check specific casing may fail | Use `process.env.PATH ?? process.env.Path ?? process.env.path` or use a cross-platform env helper |

---

## UX Pitfalls

Windows-specific user experience problems.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| CLI output using ANSI escape codes (`picocolors`) — Windows Terminal supports these but old cmd.exe doesn't | Garbled output with escape sequences visible | `picocolors` auto-detects TTY and disables colors when not supported — verify this works in Git Bash's non-interactive mode |
| Error messages showing backslash paths (`C:\Users\...`) mixed with forward-slash paths in the same output | Confusing mixed separators in error messages | Normalize displayed paths to forward slashes on all platforms for user-facing messages |
| `@clack/prompts` interactive prompts — behavior in non-TTY context (piped input, MCP stdio) | Prompts hang or produce garbage output | Ensure all CLI paths that call `p.confirm` or `p.text` are not reachable from MCP server or non-interactive contexts |
| Long Windows path limits (`MAX_PATH = 260`) — skill directories nested 4 levels deep | `ENAMETOOLONG` errors for users with deep home directory paths | Verify `mkdir({ recursive: true })` handles this; suggest enabling Windows Long Path support in docs |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces on Windows.

- [ ] **chmod guards:** `chmod` calls exist but need `process.platform !== 'win32'` guards — verify they do not throw on Windows (they don't, but the effect is absent)
- [ ] **Process kill:** Timeout kill in `executor.ts` appears to work (no error thrown) but orphans processes on Windows — verify with a real test that child processes are actually killed
- [ ] **Shell scripts:** `scripts/console/*.sh` appear functional but require `jq` — verify `jq` presence or rewrite in Node.js
- [ ] **Path assertions in tests:** Tests appear to pass in local dev (Unix) but will fail on Windows — run `vitest` on Windows before declaring compatibility achieved
- [ ] **CRLF handling:** YAML and JSON files appear to parse correctly in CI (Linux) but will silently corrupt values on Windows without `.gitattributes` — add the file and verify
- [ ] **`~` expansion:** The `~/.claude/skills/` display string appears correct but any code path that passes it to `fs` APIs must be audited
- [ ] **Bash shebang in hooks:** `src/hooks/session-start.ts` and `session-end.ts` have `#!/usr/bin/env node` shebangs — correct for Node.js scripts, but verify they are invoked via `node` and not directly (which would require executable bit on Windows)

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Orphaned child processes from executor timeout failure | LOW | Kill process tree manually via Task Manager; restart the operation |
| YAML values with trailing `\r` corrupting skill files | MEDIUM | Run a cleanup script: read all SKILL.md files, normalize CRLF to LF, rewrite; verify frontmatter parses correctly |
| Test snapshots broken by path separator differences | LOW | Delete snapshot files, regenerate with `vitest --update-snapshots` on the target platform |
| Shell scripts failing because `jq` not installed | MEDIUM | Install `jq` manually (via Git Bash package manager or scoop) or rewrite the scripts as Node.js |
| `MAX_PATH` errors on Windows | HIGH | Enable Windows Long Path support (`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled`) + retest; or restructure skill directories to use shorter paths |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Process group kill (negative PID) | Phase auditing `src/chipset/blitter/executor.ts` | Test: spawn a long-running process, trigger timeout, verify process is actually killed on Windows |
| `chmod` on Windows NTFS | Same phase as executor audit | Test: create a skill with scripts/ subdirectory; verify no EPERM and scripts are invocable |
| Hardcoded forward-slash path strings | Phase auditing `src/safety/` defaults and workflows | Test: run `assertSafePath` with Windows-style resolved paths |
| `spawn('bash')` without PATH resolution | Phase auditing process spawning | Test: invoke executor from a non-Git-Bash context; verify graceful error |
| CRLF line endings | Phase 1 (foundation) — add `.gitattributes` | Test: clone repo on Windows with `core.autocrlf=true`; verify shell scripts and YAML parse correctly |
| Vitest path separator in assertions | Phase running tests on Windows | Test: run full `vitest` suite on Windows; zero failures expected |
| `~` expansion in path arguments | Phase auditing CLI argument handling | Test: pass `~/my-skills` as a skill directory argument on Windows; verify it resolves correctly |
| `os.homedir()` backslash output | Same as scope.ts audit (already correct) | Test: `getSkillsBasePath('user')` returns a path that `fs.existsSync` can resolve on Windows |

---

## Sources

- Node.js official docs — `child_process.spawn`, `process.kill`, `os.homedir`: [https://nodejs.org/api/child_process.html](https://nodejs.org/api/child_process.html)
- Node.js issue #3617 — `process.kill` cannot kill process group on Windows: [https://github.com/nodejs/node/issues/3617](https://github.com/nodejs/node/issues/3617)
- Node.js issue #37845 — `new URL('.', import.meta.url).pathname` wrong on Windows: [https://github.com/nodejs/node/issues/37845](https://github.com/nodejs/node/issues/37845)
- Vitest issue #4653 — Snapshots always rewritten on Windows due to CRLF: [https://github.com/vitest-dev/vitest/issues/4653](https://github.com/vitest-dev/vitest/issues/4653)
- pnpm issue #3699 — EPERM: operation not permitted, chmod on Windows: [https://github.com/pnpm/pnpm/issues/3699](https://github.com/pnpm/pnpm/issues/3699)
- Node.js issue #43860 — CRLF line endings break bash scripts in npm: [https://github.com/nodejs/node/issues/43860](https://github.com/nodejs/node/issues/43860)
- cross-spawn package — cross-platform spawn with shebang support: [https://www.npmjs.com/package/cross-spawn](https://www.npmjs.com/package/cross-spawn)
- Writing cross-platform Node.js (George Ornbo): [https://shapeshed.com/writing-cross-platform-node/](https://shapeshed.com/writing-cross-platform-node/)
- Tips for portable Node.js code (Domenic): [https://gist.github.com/domenic/2790533](https://gist.github.com/domenic/2790533)
- Node.js Windows path pitfalls blog (sxzz.moe): [https://xlog.sxzz.moe/nodejs-windows-compatibility](https://xlog.sxzz.moe/nodejs-windows-compatibility)
- Codebase inspection: `src/chipset/blitter/executor.ts`, `src/storage/skill-store.ts`, `src/types/scope.ts`, `src/validation/path-safety.ts`, `src/terminal/launcher.ts`, `src/discovery/session-enumerator.ts`, `scripts/console/*.sh`
- Project context: `.planning/PROJECT.md`, `.planning/codebase/CONCERNS.md`

---
*Pitfalls research for: Node.js/TypeScript Windows compatibility (Git Bash / MINGW64)*
*Researched: 2026-02-22*
