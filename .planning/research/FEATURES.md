# Feature Research

**Domain:** Windows compatibility for Node.js/TypeScript CLI tool (gsd-skill-creator)
**Researched:** 2026-02-22
**Confidence:** HIGH — based on direct codebase audit, Node.js official docs, and cross-platform guides

---

## Feature Landscape

This document maps what Windows/Git Bash compatibility requires for gsd-skill-creator, scoped to the
active milestone (making the existing codebase work on Windows without breaking Linux/macOS).

---

### Table Stakes (Tool is Broken Without These)

Features users expect. Missing = tool crashes, produces wrong output, or silently corrupts data on Windows.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Home directory resolution via `os.homedir()` | All skill/team/agent paths root at `~/.claude/`; hardcoded `~/` strings are never expanded by Node.js | LOW | `scope.ts` already uses `os.homedir()` correctly — audit remaining callers in `workflows/`, `cli/commands/`, display strings vs actual path construction |
| `path.join()` / `path.resolve()` for all path construction | Windows uses `\` separators; string concatenation (`dir + '/' + file`) produces broken paths | LOW | 77 files import path APIs — audit for any remaining string concatenation with `/` literals used as actual paths (display strings are exempt) |
| No negative-PID `process.kill(-pid)` calls | `process.kill(-childPid, 'SIGTERM')` throws on Windows; process group kill is POSIX-only | MEDIUM | `src/chipset/blitter/executor.ts:98` calls `process.kill(-child.pid, 'SIGTERM')` — must wrap in `process.platform` guard with fallback to `child.kill('SIGTERM')` |
| `chmod` calls must not throw on Windows | `fs.chmod()` / `fs.chmodSync()` silently does nothing or throws on Windows; code must not depend on chmod for correctness | LOW | 6 files call chmod (`storage/skill-store.ts:365`, `cli/commands/terminal.ts:194`, `chipset/blitter/executor.ts:55`, `detection/skill-generator.ts:137`, `disclosure/integration.test.ts:126`, `dashboard/generator.test.ts`); wrap in try/catch or platform guard; chmod for script executability is meaningless on Windows anyway |
| `.sh` bash scripts executable on Windows/Git Bash | `execFile(scriptPath)` fails on Windows if file lacks execute bit; scripts/console/*.sh must be invocable via Git Bash's `bash` interpreter explicitly | MEDIUM | `src/console/check-inbox.test.ts`, `write-status.test.ts`, etc. call `execFile(scriptPath, ...)` directly — on Windows Git Bash, must spawn `bash scriptPath` not treat `.sh` as a native executable |
| `CRLF` line endings must not break YAML/JSON parsing | If git `autocrlf=true` on Windows, checked-out `.md` files and JSONL files get `\r\n`; `js-yaml` and `JSON.parse` on CRLF input can produce unexpected parse failures | MEDIUM | Add `.gitattributes` with `* text=auto eol=lf`; verify js-yaml/JSON parsers strip `\r` before processing; the existing `safeParseFrontmatter` likely untested against CRLF frontmatter |
| Tests run on Windows without Unix-specific fixtures | Test files hardcode paths like `/home/user/.claude/`, `/home/bob/project`, `/tmp/wetty-build` — these fail `path.resolve()` assertions on Windows | MEDIUM | 20+ test files use Unix-absolute paths as fixture data; these are test data strings (not real fs calls), so they need conditional handling or abstraction |
| `npm run test` works on Windows | `vitest` is called via `npm test`; the package.json scripts use no Unix-only syntax, so this should work already — but must verify with actual run | LOW | Current `package.json` scripts use `tsc`, `tsx`, `vitest` — no `&&`, `||`, `export VAR=x` patterns that break on Windows cmd.exe; Git Bash runs these fine |

**Confidence: HIGH** — items above verified by direct codebase inspection and cross-referenced with Node.js official docs on Windows platform behavior.

---

### Differentiators (Polish, Not Required for Correctness)

Features that make the Windows experience good rather than merely functional.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Windows-aware error messages for permission failures | When `chmod` is silently ignored or a path fails, error messages should say "check file permissions" not "chmod failed — run chmod 755" (Linux-centric advice confuses Windows users) | LOW | Affects `storage/skill-store.ts` and `detection/skill-generator.ts` error paths |
| `process.platform` detection for terminal features | `terminal` command (Wetty + tmux) is Linux-only; on Windows it should surface a clear "not supported on Windows" message rather than a cryptic spawn failure | LOW | `src/cli/commands/terminal.ts` and `src/terminal/session.ts` use tmux and bash entry scripts — these are genuinely Linux-only; gate with `process.platform !== 'win32'` check |
| Path display normalization (forward slashes in UI output) | When the tool prints paths to console (help text, status output), Windows users expect to see paths their OS understands; currently all display uses `~/.claude/` (Unix tilde notation which Git Bash does expand) | LOW | Low priority: Git Bash users are accustomed to Unix path syntax; the `~/.claude/` display convention is correct for the target audience |
| `.gitattributes` for line ending hygiene | Prevents future contributors from accidentally introducing CRLF into source files, reducing surface area for future bugs | LOW | One-time addition of `.gitattributes`; no code changes required |
| Vitest `testTimeout` adequacy for Windows | Windows file I/O is measurably slower than Linux; the current 10s timeout may be marginal for embedding model loads on Windows | LOW | Monitor in practice; raise to 30s if tests flake |
| Windows-specific CI matrix entry | Proves compatibility on an ongoing basis; catches regressions | MEDIUM | Requires GitHub Actions `windows-latest` runner; adds CI time but prevents silent breakage |

**Confidence: MEDIUM** — value proposition clear from codebase review; priority relative to table stakes is LOW since tool must work before it can be polished.

---

### Anti-Features (Do Not Build These)

Features that seem helpful for Windows compat but create new problems.

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| Custom path abstraction layer | "Wrap all path calls in our own API for testability" | Over-engineering; Node.js `path` module already handles platform differences; a custom layer adds maintenance burden and a new failure surface | Use `path.join`, `path.resolve`, `os.homedir()` directly — these are the right tool |
| cmd.exe / PowerShell support | "Support all Windows shells" | Out of scope per PROJECT.md; Claude Code uses Git Bash exclusively on Windows; targeting cmd.exe requires entirely different path quoting, environment variable syntax, and script execution strategies | Document that Git Bash is required; add clear error if invoked from cmd.exe |
| WSL support | "WSL is Linux, should work automatically" | WSL is a different environment entirely; path translation between Windows and WSL paths (`/mnt/c/Users/...` vs `C:\Users\...`) creates its own class of bugs | WSL users should follow Linux instructions; explicitly out of scope |
| Replace bash scripts with cross-platform JS alternatives | "Rewrite check-inbox.sh in TypeScript" | The bash scripts are consumed by Claude Code hooks, not by the Node.js CLI directly; rewriting them changes the interface contract and is new feature work, not compatibility | Fix the test harness to invoke scripts via `bash scriptPath` on Windows; leave scripts as-is |
| Auto-detect and convert CRLF at runtime | "Strip \r from all file reads" | Stripping \r universally can corrupt binary content and is fragile; it treats a symptom not the cause | Fix with `.gitattributes eol=lf` at the source; let git handle line endings |
| New dependency for cross-platform path handling (`cross-env`, `shelljs`) | "These libraries solve Windows compat" | The project constraint is no new dependencies; Node.js built-ins are sufficient for path handling; `cross-env` is needed only if npm scripts use `VAR=value node` syntax (they don't currently) | Use `path.join`, `os.homedir()`, `process.platform` — zero new dependencies |

---

## Feature Dependencies

```
[.gitattributes eol=lf]
    └──enables──> [CRLF-safe YAML/JSON parsing]
                      └──enables──> [Reliable test fixtures on Windows]

[path.join() audit]
    └──required by──> [All file operations work on Windows]

[process.kill(-pid) guard]
    └──requires──> [process.platform detection pattern established]
                       └──enables──> [terminal command Windows guard] (differentiator)

[bash script invocation fix]
    └──required by──> [console/*.test.ts tests pass on Windows]

[chmod try/catch wrapping]
    └──independent──> (no other features depend on it)
```

### Dependency Notes

- **`.gitattributes` must land before test runs**: If tests are run on a fresh Windows clone before the `.gitattributes` fix, CRLF files will cause YAML parse failures that look like code bugs.
- **`path.join()` audit is prerequisite for everything**: Broken path construction is the most likely cause of silent data corruption; fix first.
- **`process.kill(-pid)` guard is independent**: Only affects the blitter executor timeout path; does not block other work.
- **bash script invocation does not affect the main CLI**: The `.sh` scripts are only tested via the `console/*.test.ts` integration tests; if those tests are skipped on Windows, this can be deferred to v1.x.

---

## MVP Definition

### Launch With (v1 — this milestone)

Minimum to make the tool non-broken on Windows/Git Bash.

- [ ] **`.gitattributes` with `eol=lf`** — prevents CRLF corruption on clone; no code changes
- [ ] **Path construction audit** — verify all 77 path-importing files use `path.join`/`path.resolve`; fix any string-concatenation path builders
- [ ] **`os.homedir()` consistency check** — confirm display-only `~/.claude/` strings vs actual path construction; fix any places that pass tilde strings to `fs.*` calls
- [ ] **`process.kill(-pid)` platform guard** — wrap the blitter executor's negative-PID kill with `process.platform !== 'win32'` check
- [ ] **`chmod` calls wrapped in try/catch** — prevent crash on Windows; log warning instead; script executability is irrelevant on Windows
- [ ] **Tests pass on Windows** — specifically the path-related and storage tests; Unix-path fixture data in tests is test data (not real fs), so those tests should still pass as-is

### Add After Validation (v1.x)

Once core is working and tested.

- [ ] **`console/*.sh` test harness fix** — make test runner invoke `.sh` files via `bash` explicitly on Windows; affects only the console bridge integration tests
- [ ] **Terminal command Windows guard** — surface clear "not supported on Windows" message for `skill-creator terminal` subcommand
- [ ] **Windows CI matrix** — add `windows-latest` GitHub Actions runner to catch regressions

### Future Consideration (v2+)

Defer until product-market fit on Windows is established.

- [ ] **Windows-aware error messages** — polish only; doesn't affect functionality
- [ ] **Vitest timeout tuning** — only needed if tests flake in practice

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `.gitattributes eol=lf` | HIGH | LOW | P1 |
| Path construction audit (`path.join`) | HIGH | LOW | P1 |
| `os.homedir()` consistency | HIGH | LOW | P1 |
| `process.kill(-pid)` guard | HIGH | LOW | P1 |
| `chmod` try/catch | MEDIUM | LOW | P1 |
| Tests pass on Windows (path fixtures) | HIGH | MEDIUM | P1 |
| `.sh` script test harness fix | MEDIUM | MEDIUM | P2 |
| Terminal command Windows guard | MEDIUM | LOW | P2 |
| Windows CI matrix | HIGH | MEDIUM | P2 |
| Windows-aware error messages | LOW | LOW | P3 |
| Vitest timeout tuning | LOW | LOW | P3 |

**Priority key:**
- P1: Must have for this milestone (tool broken without it)
- P2: Should have; add when P1 items are complete
- P3: Nice to have; future consideration

---

## Competitor Feature Analysis

This is an internal tool compatibility pass, not a competitive product launch.
Relevant reference is the cross-platform guide ecosystem:

| Compatibility Pattern | ehmicky/cross-platform-node-guide | bcoe/awesome-cross-platform-nodejs | Our Approach |
|-----------------------|-----------------------------------|------------------------------------|--------------|
| Path handling | Use `path.join`, `path.normalize` | Same | Same — audit and fix |
| Line endings | `.gitattributes eol=lf` | Same | Add `.gitattributes` |
| Permissions | Avoid `chmod`; use try/catch | Use `graceful-fs` | try/catch (no new deps) |
| Process groups | Platform guard for negative PID | `tree-kill` package | Platform guard (no new deps) |
| Shell scripts | Use `cross-spawn` or detect shell | Same | Fix test harness; leave `.sh` scripts intact |
| npm scripts | No `VAR=x node` syntax | Use `cross-env` | Not needed — current scripts are already clean |

---

## Sources

- Node.js official docs on process.kill() Windows limitations: [Issue #3617](https://github.com/nodejs/node/issues/3617), [Issue #27642](https://github.com/nodejs/node/issues/27642)
- [ehmicky/cross-platform-node-guide — permissions](https://github.com/ehmicky/cross-platform-node-guide/blob/main/docs/5_security/permissions.md) — HIGH confidence (official guide)
- [zoonderkins/portable-node-guide](https://github.com/zoonderkins/portable-node-guide) — MEDIUM confidence (community guide, well-maintained)
- [bcoe/awesome-cross-platform-nodejs](https://github.com/bcoe/awesome-cross-platform-nodejs) — MEDIUM confidence
- Direct codebase audit of gsd-skill-creator-dev (`src/`) — HIGH confidence
- PROJECT.md and CONCERNS.md from `.planning/` — HIGH confidence (project source of truth)
- Node.js v25 docs on `child_process`, `process.kill()`, `fs.chmod()` — HIGH confidence

---

*Feature research for: Windows/Git Bash compatibility — gsd-skill-creator*
*Researched: 2026-02-22*
