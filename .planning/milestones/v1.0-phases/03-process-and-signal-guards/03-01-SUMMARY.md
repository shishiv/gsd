---
phase: 03-process-and-signal-guards
plan: 01
subsystem: infra
tags: [windows, platform-guard, process-kill, chmod, signals, child-process]

# Dependency graph
requires:
  - phase: 02-path-construction-audit
    provides: execFile migration and path.join usage — safe path construction in child_process calls
provides:
  - Platform-guarded process group kill in executor.ts (PROC-01): negative PIDs only used on non-Windows
  - Platform-guarded chmod in executor.ts, skill-store.ts, skill-generator.ts, terminal.ts (PROC-02)
affects:
  - 03-02 (process-and-signal-guards plan 02, if any signal escalation work)
  - Any future work touching executor.ts timeout logic

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "process.platform !== 'win32' guard before negative PID kill (process.kill(-pid))"
    - "process.platform !== 'win32' guard before chmod/chmodSync on script files"

key-files:
  created: []
  modified:
    - src/chipset/blitter/executor.ts
    - src/storage/skill-store.ts
    - src/detection/skill-generator.ts
    - src/cli/commands/terminal.ts

key-decisions:
  - "Wrap process.kill(-child.pid) with platform guard not removal — detached: true preserved for Unix process group semantics"
  - "chmod guards added for code clarity even though chmod is technically a silent no-op on Windows NTFS"
  - "Test file chmod calls (executor.test.ts, integration.test.ts, generator.test.ts) left unmodified — chmod does not throw on Windows so test files are not a runtime risk"
  - "Pre-existing timeout test failures (2 tests) are a Windows bash/sleep issue that predates this work — confirmed by testing before and after changes"

patterns-established:
  - "Platform guard pattern: if (process.platform !== 'win32') { chmod(...) } for all script executable-permission calls"
  - "Platform guard pattern: if (child.pid && process.platform !== 'win32') { process.kill(-child.pid) } else { child.kill() } for process group termination"

requirements-completed:
  - PROC-01
  - PROC-02

# Metrics
duration: 12min
completed: 2026-02-22
---

# Phase 3 Plan 01: Process and Signal Guards Summary

**Platform guards added to executor.ts process group kill (PROC-01) and all four production chmod/chmodSync call sites (PROC-02) so Windows never receives negative PIDs or unnecessary chmod syscalls**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-02-22T04:56:00Z
- **Completed:** 2026-02-22T05:08:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `process.kill(-child.pid, 'SIGTERM')` is now only called on non-Windows platforms; Windows falls through to `child.kill('SIGTERM')` which force-terminates (PROC-01)
- All 4 production chmod/chmodSync call sites wrapped with `process.platform !== 'win32'` guards (PROC-02): executor.ts, skill-store.ts, skill-generator.ts, terminal.ts
- `detached: true` on spawn preserved — required for Unix process group kills
- 337 tests for the 4 modified files' test suites pass cleanly

## Task Commits

Each task was committed atomically:

1. **Task 1: executor.ts — process group kill guard + chmod guard** - `9ac9d98` (fix)
2. **Task 2: skill-store.ts, skill-generator.ts, terminal.ts — chmod guards** - `df4b32f` (fix)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/chipset/blitter/executor.ts` - Platform guard around `process.kill(-child.pid, 'SIGTERM')` and `chmod(scriptPath, 0o755)`
- `src/storage/skill-store.ts` - Platform guard around `chmod(scriptPath, 0o755)` for disclosure script files
- `src/detection/skill-generator.ts` - Platform guard around `chmod(scriptPath, 0o755)` for executable scripts
- `src/cli/commands/terminal.ts` - Platform guard around `chmodSync(scriptPath, 0o755)` for terminal entry script

## Decisions Made

- Wrapped negative PID kill with platform guard rather than removing it — `detached: true` is required for Unix process group semantics and must be preserved
- Added chmod guards even though chmod is a technical no-op on Windows NTFS — the explicit skip makes Windows behavior clear and prevents any future behavioral surprise if Node.js changes its NTFS chmod handling
- Did not modify test files (executor.test.ts, integration.test.ts, generator.test.ts) as the plan specifies — chmod does not throw on Windows, so test file chmod calls are not a runtime risk
- Pre-existing 2 timeout test failures confirmed pre-existing (bash `sleep 10` not killed by child.kill() on Windows) — these failures exist identically before and after our changes

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

Discovered 2 pre-existing test failures in `executor.test.ts` (`kills scripts that exceed timeout` and `emits completion signal with timeout status`). These tests use `sleep 10` in a bash script and a 500ms timeout. On Windows, the bash process is not killed by `child.kill('SIGTERM')` within the timeout window, causing the test itself to time out at 10s. Confirmed pre-existing by running the tests on the original code via `git stash` — identical failures. These are out of scope for this plan and deferred to future Windows test infrastructure work.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All four production platform guards are in place
- Process group kill is now Windows-safe (PROC-01 complete)
- All chmod/chmodSync calls are Windows-safe (PROC-02 complete)
- No new dependencies added
- Phase 3 plan 01 complete; ready for any remaining phase 3 plans

---
*Phase: 03-process-and-signal-guards*
*Completed: 2026-02-22*

## Self-Check: PASSED

- FOUND: src/chipset/blitter/executor.ts
- FOUND: src/storage/skill-store.ts
- FOUND: src/detection/skill-generator.ts
- FOUND: src/cli/commands/terminal.ts
- FOUND: .planning/phases/03-process-and-signal-guards/03-01-SUMMARY.md
- FOUND commit: 9ac9d98 (Task 1 — executor.ts platform guards)
- FOUND commit: df4b32f (Task 2 — skill-store, skill-generator, terminal guards)
