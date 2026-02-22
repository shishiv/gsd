# Project Research Summary

**Project:** gsd-skill-creator — Windows/Git Bash Compatibility Milestone
**Domain:** Node.js/TypeScript CLI tool cross-platform compatibility (Windows MINGW64/Git Bash)
**Researched:** 2026-02-22
**Confidence:** HIGH

## Executive Summary

This milestone is a surgical compatibility pass on an existing, well-structured TypeScript CLI tool. The codebase is not broken by design — it was developed on Linux/macOS and now needs to run reliably on Windows via Git Bash (MINGW64). The expert approach for this class of work is not a rewrite or a new abstraction layer: it is a disciplined audit of the four known cross-platform failure modes in Node.js (path construction, home directory resolution, process signals, and CRLF line endings), followed by targeted fixes at each violation site. Research confirms that Node.js built-in APIs (`path.join`, `os.homedir`, `execFile`, `process.platform`) already provide the right abstraction — the task is ensuring the existing code uses them consistently everywhere.

The recommended approach is a phased audit ordered by dependency depth. The storage layer (`src/storage/`, `src/learning/version-manager.ts`) must be fixed first because every other layer depends on it for path correctness. A `.gitattributes` file with `eol=lf` is the single highest-leverage commit in this entire milestone — it prevents CRLF corruption on clone before any code changes are made. The executor and signal-handling code needs platform guards, and the shell-script-based test infrastructure needs to be replaced with Node.js equivalents or explicitly invoked via `bash`. None of these changes require new runtime dependencies.

The key risks are subtle: `chmod` calls silently succeed on Windows NTFS without doing anything, process group kills with negative PIDs silently orphan child processes, and Vitest path assertions that pass on Linux CI will fail on Windows with backslash separators. These are all "looks done but isn't" bugs — the code runs without errors but behaves incorrectly. The mitigation is to run the full test suite on a real Windows machine or `windows-latest` GitHub Actions runner after each fix phase to catch silent failures.

## Key Findings

### Recommended Stack

The existing stack (Node.js 20+, TypeScript 5.3, ESM, tsx, vitest) is entirely compatible with Windows and requires no changes. The research identified no missing runtime dependencies. The two dev-only packages worth considering (`cross-env`, `shx`) are not needed because the current `package.json` scripts contain no Unix-specific env-var syntax or shell commands that would break in cmd.exe. The existing scripts run cleanly in Git Bash as-is.

**Core technology patterns (use these, not alternatives):**
- `path.join()` / `path.resolve()`: All path segment concatenation — never string concatenation with `/`
- `os.homedir()`: All home directory references — never `~`, `$HOME`, or `%USERPROFILE%`
- `child_process.execFile()`: All external binary invocation — never `exec()` with shell string interpolation
- `import.meta.dirname` or `fileURLToPath(import.meta.url)`: ESM `__dirname` equivalent — never `.pathname` on a `URL` object
- `process.platform === 'win32'`: Guard for POSIX-only behaviors (signals, chmod) — not as a primary strategy, only for genuinely irreconcilable differences
- `.gitattributes` with `* text=auto eol=lf`: Line ending normalization — prevents CRLF corruption at the git layer, the correct place to handle it

**Critical version note:** `import.meta.dirname` requires Node.js 20.11+. Project requires Node.js 20+ but should document the 20.11 minimum or use the `fileURLToPath` pattern already present in the codebase.

### Expected Features

This is a compatibility milestone, not a feature milestone. "Features" are behaviors that must work correctly on Windows.

**Must have — tool is broken without these (P1):**
- `.gitattributes` with `eol=lf` — prevents CRLF corruption on Windows clone; no code changes needed; highest priority
- Path construction audit across all 77 path-importing files — verify `path.join`/`path.resolve` used everywhere; fix string-concatenation violations
- `os.homedir()` consistency — confirm display-only `~/.claude/` strings are never passed to `fs.*` APIs
- `process.kill(-pid)` platform guard in `src/chipset/blitter/executor.ts` — prevents orphaned processes on timeout
- `chmod` calls wrapped in try/catch or platform guard — prevents silent NTFS failures
- Test suite passes on Windows — path fixture assertions must use `path.join` not hardcoded `/` literals

**Should have — add after P1 items validated (P2):**
- Console shell script test harness fix — invoke `.sh` files via `bash` explicitly, or replace with Node.js equivalents
- Terminal command Windows guard — surface clear "not supported on Windows" message for `skill-creator terminal`
- Windows CI matrix (`windows-latest` GitHub Actions runner) — prevents regressions

**Defer to v2+ (P3):**
- Windows-aware error messages (polish, no functional impact)
- Vitest timeout tuning (only if tests flake in practice)

**Anti-features confirmed — do not build:**
- Custom path abstraction layer (over-engineering; Node.js path APIs are sufficient)
- cmd.exe / PowerShell support (out of scope; Git Bash is required)
- WSL support (different environment; follow Linux docs)
- Runtime CRLF stripping (treat the cause with `.gitattributes`, not the symptom)

### Architecture Approach

The existing layered architecture is correct and should not be changed. Platform fixes belong at the Platform Boundary Layer — they are point fixes within existing files, not new modules. The research explicitly recommends against creating a `src/platform/` abstraction directory; Node.js `path`, `os`, and `fs` modules already are the abstraction. All fixes are surgical edits within the files where violations exist, keeping PRs atomic and diffs reviewable.

**Major components and their Windows concerns:**

1. **Storage Layer** (`src/storage/`, `src/learning/version-manager.ts`) — Primary audit target. `version-manager.ts` has confirmed template-string path interpolation in shell commands and uses `exec()` instead of `execFile()`. All storage path construction must use `path.join()`; no string concatenation.

2. **Executor / Process Layer** (`src/chipset/blitter/executor.ts`, `src/terminal/launcher.ts`) — Two confirmed violations: `process.kill(-child.pid, 'SIGTERM')` (POSIX-only process group kill) and `chmod(scriptPath, 0o755)` (NTFS no-op). Both need platform guards. Launcher's SIGKILL must also be guarded.

3. **Safety Layer** (`src/safety/`) — Six files use hardcoded forward-slash path defaults (e.g., `'.claude/skills'`). These are latent comparison bugs: `assertSafePath` uses `path.resolve()` which returns backslashes on Windows, so mixing hardcoded `/` strings with resolved paths will silently fail comparisons.

4. **Console Scripts and Tests** (`scripts/console/*.sh`, `src/console/*.test.ts`) — Highest integration risk. Tests call `.sh` scripts via `execFile(scriptPath)` which does not invoke a shell on Windows — the scripts fail with ENOENT. Scripts also depend on `jq` and `date` which are not bundled with Git Bash by default. Preferred fix: replace bash scripts with Node.js equivalents.

5. **Portability Layer** (`src/portability/platform-adapter.ts`) — Stores literal `~/.claude/skills` strings. These appear to be label-only (human-readable exports), not runtime paths. Must verify they are never passed to `fs` operations; if so, replace with `join(homedir(), ...)`.

**Key data flow:** `scope.ts` correctly roots all paths with `join(homedir(), '.claude', ...)` — this is the correct foundation. The risk is downstream files that receive this base path and do further concatenation with `/` instead of calling `join()` again.

### Critical Pitfalls

1. **Process group kill with negative PID** (`process.kill(-child.pid, 'SIGTERM')`) — Throws or silently fails on Windows, leaving child processes orphaned. Fix: wrap in `if (process.platform !== 'win32')` guard; fall back to `child.kill('SIGTERM')`. Warning sign: any use of `detached: true` in `spawn()` is a setup that expects this pattern.

2. **CRLF line endings breaking YAML and shell scripts** — Git's `core.autocrlf=true` (Windows default) causes checked-out `.md` and `.sh` files to get `\r\n`. YAML values get trailing `\r`. Bash scripts fail with `\r: command not found`. Fix: add `.gitattributes` with `* text=auto eol=lf` before any Windows testing is done — this is the single most important commit.

3. **`chmod` silently does nothing on Windows NTFS** — Calls succeed without error but the execute bit is never set. Code that then tries to directly invoke the script as an executable will fail. Fix: wrap all `chmod` calls in `if (process.platform !== 'win32')` guards; on Windows, always invoke scripts through an interpreter (`bash script.sh`), not directly.

4. **Hardcoded forward-slash path strings in `src/safety/` defaults** — Six files set defaults like `'.claude/skills'` as string literals. `assertSafePath` compares against `path.resolve()` output which uses backslashes on Windows — the comparison fails silently. Fix: use `path.join('.claude', 'skills')` (not a string literal) for any path that is later used in file system operations or compared against resolved paths.

5. **Vitest test assertions hardcoding `/` path separators** — Tests that assert `expect(skill.path).toBe('.claude/skills/foo/SKILL.md')` will fail on Windows because `path.join()` in production code returns backslash separators. Fix: use `path.join()` to build expected paths in tests; or normalize both sides with `path.normalize()` before comparison.

## Implications for Roadmap

Based on combined research, the dependency ordering is clear: fix the repository-level line-ending issue first (no code required), then audit path construction bottom-up (storage before CLI), then fix process/signal handling, then fix tests. Each phase is independently verifiable and does not block the next from starting in parallel for different file sets.

### Phase 1: Repository Foundations

**Rationale:** `.gitattributes` with `eol=lf` must land before any Windows testing begins. CRLF corruption will make every subsequent phase harder to debug — test failures will look like code bugs when they are actually encoding issues. This is zero code change and the highest leverage action in the milestone.

**Delivers:** Clean line endings on all Windows clones; YAML and shell scripts parse correctly; Vitest snapshot files stay stable across platforms.

**Addresses:** Table-stakes feature "CRLF line endings must not break YAML/JSON parsing"; Pitfall 7 (CRLF).

**Avoids:** Debugging sessions where YAML parse failures look like logic bugs but are actually `\r` characters in parsed strings.

**Research flag:** No additional research needed. Pattern is well-documented and implementation is a single file addition.

### Phase 2: Storage and Path Construction Audit

**Rationale:** The storage layer is the foundation for all other layers. Path violations here cause data corruption or silent misdirected writes. `version-manager.ts` has a confirmed `exec()` + template-string path interpolation bug — this is the highest-probability actual defect in the codebase.

**Delivers:** All path construction in `src/storage/`, `src/learning/`, and `src/safety/` uses `path.join()`/`path.resolve()`. `version-manager.ts` replaced `exec()` with `execFile()` for git commands. `src/safety/` default path strings replaced with `path.join()` calls.

**Files to touch:** `src/storage/skill-store.ts`, `src/storage/skill-index.ts`, `src/storage/pattern-store.ts`, `src/learning/version-manager.ts`, `src/safety/operation-cooldown.ts`, `src/safety/integrity-monitor.ts`, `src/safety/audit-logger.ts`, `src/safety/file-lock.ts`

**Uses:** `path.join`, `path.resolve`, `os.homedir`, `execFile` (all built-in; no new dependencies)

**Avoids:** Pitfall 3 (hardcoded forward-slash strings), Pitfall 4 (exec with shell interpolation)

**Research flag:** No additional research needed. Node.js API usage is well-documented; violations were identified by direct codebase inspection.

### Phase 3: CLI and Workflow Layer Audit

**Rationale:** Commands and workflows depend on storage. Once storage is verified correct, the CLI layer is the next risk surface. The `platform-adapter.ts` tilde-string assumption needs verification under real runtime conditions.

**Delivers:** All path construction in `src/cli/`, `src/workflows/`, `src/agents/`, and `src/portability/` uses correct APIs. `os.homedir()` is used wherever paths are constructed, not displayed. Display strings using `~/.claude/` notation are explicitly separated from runtime path construction.

**Files to touch:** `src/cli/commands/*.ts`, `src/workflows/create-skill-workflow.ts`, `src/workflows/list-skills-workflow.ts`, `src/agents/agent-generator.ts`, `src/portability/platform-adapter.ts`

**Avoids:** Pitfall 8 (`~` passed to fs APIs); Pitfall 3 (forward-slash string literals in fs contexts)

**Research flag:** No additional research needed; patterns are established in Phase 2.

### Phase 4: Process and Signal Handling

**Rationale:** Executor and terminal launcher signal handling is isolated from path issues and can be fixed independently. These are low-risk changes (platform guards around existing code) but require testing with real child process spawning to verify Windows behavior.

**Delivers:** `src/chipset/blitter/executor.ts` kills child processes correctly on Windows (no orphaned processes). `src/terminal/launcher.ts` does not throw when imported on Windows. `chmod` calls throughout codebase are wrapped in `process.platform` guards or try/catch.

**Files to touch:** `src/chipset/blitter/executor.ts`, `src/terminal/launcher.ts`, `src/storage/skill-store.ts` (chmod), `src/detection/skill-generator.ts` (chmod)

**Avoids:** Pitfall 1 (process group kill), Pitfall 2 (chmod on NTFS); prevents orphaned processes in Windows Task Manager

**Research flag:** The behavior of `detached: true` on Windows for the blitter use case may need hands-on validation — the documented behavior is clear but the interaction with the executor's timeout logic needs an integration test to confirm.

### Phase 5: Test Infrastructure

**Rationale:** Tests can be fixed independently without touching production code. This is the highest-risk phase because it may require replacing bash scripts with Node.js equivalents (behavior change) or skipping tests on Windows. Must run the full Vitest suite on Windows to discover all assertion failures.

**Delivers:** Full Vitest suite passes on Windows with zero failures. `src/console/*.test.ts` either invoke `.sh` scripts via `bash` explicitly or use Node.js replacement scripts. Path assertions in tests use `path.join()` not hardcoded string literals. `tests/test-gsd-stack.sh` is either replaced or explicitly documented as Linux-only.

**Files to touch:** All test files with hardcoded path string assertions; `scripts/console/*.sh` (may be replaced with `.ts` equivalents); `src/console/*.test.ts`

**Avoids:** Pitfall 6 (Vitest path separator failures); Pitfall 4 (bash script invocation without interpreter)

**Research flag:** The decision to replace bash console scripts with Node.js alternatives vs. invoking them via `bash` explicitly deserves a quick design review during planning. The preferred approach (Node.js replacement) is more work but removes a runtime dependency on `bash` and `jq` being in PATH.

### Phase 6: CI and Validation

**Rationale:** Adds `windows-latest` to the GitHub Actions matrix to prevent regressions. This is the proof that compatibility is real and ongoing, not a one-time assertion.

**Delivers:** CI runs on both `ubuntu-latest` and `windows-latest` for Node.js 20.x and 22.x. All tests green on both platforms. Documentation updated to note Git Bash requirement for Windows users.

**Addresses:** P2 feature "Windows CI matrix"; prevents future regressions

**Research flag:** No research needed. GitHub Actions `windows-latest` runner is well-documented; adding a strategy matrix is standard practice.

### Phase Ordering Rationale

- `.gitattributes` (Phase 1) must precede all other work to prevent CRLF contamination from masking real bugs
- Storage/safety (Phase 2) precedes CLI/workflows (Phase 3) because CLI layers call storage; fix the dependency before the dependent
- Process/signals (Phase 4) is isolated from path work and can proceed in parallel with Phase 3 if resources allow
- Tests (Phase 5) come last because test infrastructure changes carry the highest behavior-change risk and need production code stable first
- CI (Phase 6) is a cap that proves everything; it cannot come before the fixes it validates

### Research Flags

Phases needing deeper research or hands-on validation during planning:
- **Phase 4 (Process/Signal):** Confirm detached-process + platform-guard interaction via integration test; documented behavior is clear but runtime interaction with executor timeout logic needs empirical verification on Windows
- **Phase 5 (Tests):** Design decision needed on bash script replacement vs. explicit `bash` invocation; assess whether `scripts/console/*.sh` scripts can be cleanly replicated as Node.js without behavior change

Phases with standard, well-documented patterns (skip `/gsd:research-phase`):
- **Phase 1 (Repository Foundations):** `.gitattributes` is a one-liner; no research needed
- **Phase 2 (Storage/Path Audit):** Node.js API substitutions are fully documented; violations identified by inspection
- **Phase 3 (CLI/Workflow Audit):** Same patterns as Phase 2; no new unknowns
- **Phase 6 (CI):** GitHub Actions matrix is standard; no research needed

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | No new technology choices required; existing stack is fully Windows-compatible; violations are usage issues not stack issues |
| Features | HIGH | Violations identified by direct codebase inspection, not inference; priority ordering is unambiguous |
| Architecture | HIGH | Node.js official docs confirm all recommended patterns; fix-in-place approach is confirmed correct by cross-platform guide consensus |
| Pitfalls | HIGH | All critical pitfalls verified against Node.js issue tracker, official docs, and direct codebase inspection; no inferred pitfalls |

**Overall confidence:** HIGH

### Gaps to Address

- **`platform-adapter.ts` tilde strings at runtime (MEDIUM):** Code inspection suggests the `~/.claude/skills` strings in the PLATFORMS registry are label-only and never passed to `fs` APIs. This assumption needs explicit verification by tracing all callers during Phase 3 — if any caller passes these strings to `fs.readFile`, `fs.writeFile`, or similar, it is a live bug, not a latent one.

- **`jq` dependency in console scripts (MEDIUM):** Scripts in `scripts/console/` call `jq`. Git Bash does not bundle `jq` by default on Windows. Phase 5 planning must decide: document `jq` as a required install, replace the scripts with Node.js, or skip the tests on Windows with `vi.skipIf`. The research recommends Node.js replacement as the preferred path, but the scope of that work needs assessment.

- **Windows MAX_PATH limits (LOW):** Skill directories are nested 4 levels deep under `~/.claude/`. Users with long Windows usernames could hit the 260-character path limit. Not a blocker for this milestone but worth noting in documentation and addressing if reports come in.

- **Bash availability in MCP server context (MEDIUM):** The executor spawns `bash` for bash and custom script types. When the MCP server is launched by Claude Code, the process environment may differ from an interactive Git Bash session. This needs a runtime test — not just a unit test — to confirm `bash` is resolvable in the actual MCP invocation context.

## Sources

### Primary (HIGH confidence)

- Node.js official path documentation — `path.join`, `path.posix`, `path.win32`, `path.sep`: https://nodejs.org/api/path.html
- Node.js official ESM documentation — `import.meta.url`, `import.meta.dirname`: https://nodejs.org/api/esm.html
- Node.js official os documentation — `os.homedir()` Windows USERPROFILE behavior: https://nodejs.org/api/os.html
- Node.js official child_process documentation — `execFile` vs `exec`, signal behavior: https://nodejs.org/api/child_process.html
- Node.js issue #3617 — `process.kill` cannot kill process group on Windows: https://github.com/nodejs/node/issues/3617
- Node.js issue #37845 — `new URL('.', import.meta.url).pathname` wrong on Windows: https://github.com/nodejs/node/issues/37845
- Git attributes documentation — `eol=lf` configuration: https://git-scm.com/docs/gitattributes
- Direct codebase inspection — `src/chipset/blitter/executor.ts`, `src/storage/`, `src/safety/`, `src/learning/version-manager.ts`, `scripts/console/*.sh`

### Secondary (MEDIUM confidence)

- ehmicky/cross-platform-node-guide — permissions, path handling, process signals: https://github.com/ehmicky/cross-platform-node-guide
- Alan Norbauer, Cross-Platform Node.js — `.gitattributes`, shell avoidance, `node.exe` usage: https://alan.norbauer.com/articles/cross-platform-nodejs/
- Vitest issue #4653 — Snapshots rewritten on Windows due to CRLF: https://github.com/vitest-dev/vitest/issues/4653
- pnpm issue #3699 — EPERM chmod on Windows: https://github.com/pnpm/pnpm/issues/3699
- zoonderkins/portable-node-guide — community cross-platform patterns: https://github.com/zoonderkins/portable-node-guide
- bcoe/awesome-cross-platform-nodejs — curated patterns: https://github.com/bcoe/awesome-cross-platform-nodejs

### Tertiary (LOW confidence)

- Process group kill on Windows — `taskkill /F /T` as alternative to `process.kill(-pid)`: community blog posts; needs validation in executor integration test
- `@huggingface/transformers` ONNX runtime on Windows — general claim that it works; needs verification against the specific Node.js 20 + Windows x64 combination used in this project

---
*Research completed: 2026-02-22*
*Ready for roadmap: yes*
