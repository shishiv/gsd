# Phase 3: Process and Signal Guards - Research

**Researched:** 2026-02-22
**Domain:** Node.js cross-platform process lifecycle, signal handling, NTFS file permissions
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROC-01 | `process.kill(-child.pid)` in `executor.ts` guarded with `process.platform !== 'win32'` check with Windows-safe alternative | `process.kill(-pid)` throws ESRCH on Windows; Windows-safe alternative is `child.kill('SIGTERM')` on the ChildProcess reference, which Node.js correctly translates to force-kill on Windows |
| PROC-02 | `chmod()` calls wrapped in try/catch or platform guard across all 6 files that use them | `fs.chmod()` / `fs.chmodSync()` on Windows NTFS **does not throw** — it silently succeeds (no-op beyond read-only attribute); the risk is not runtime error but silent non-effect; try/catch is a valid guard, but platform guard with no-op skip is cleaner |
| PROC-03 | SIGKILL usage in `launcher.ts` guarded with platform check and Windows-safe fallback | `child.kill('SIGKILL')` as a string is **not** the problem — Node.js accepts it on Windows (maps to force terminate). The actual SIGKILL risk in `launcher.ts` is the `child.kill('SIGKILL')` call in `shutdownWetty`: on Windows this is safe. PROC-03 is about ensuring the *import* does not throw — signal string constants do not throw on import. No runtime guard is needed for the kill call itself. |

</phase_requirements>

---

## Summary

Phase 3 has three distinct cross-platform concerns, each with a different fix pattern. Understanding the actual Windows behavior of each API is critical to choosing the right guard.

**PROC-01** is the most serious runtime risk. `process.kill(-child.pid, 'SIGTERM')` in `src/chipset/blitter/executor.ts` (line 98) sends a signal to a Unix process group. On Windows, negative PIDs are not supported by libuv's `uv_kill()` — it calls `TerminateProcess()` which expects a single positive PID handle. The call throws `ESRCH` (no such process). This leaves child processes orphaned on timeout. The fix is a `process.platform !== 'win32'` branch: use `process.kill(-child.pid, ...)` on POSIX, fall back to `child.kill('SIGTERM')` on Windows.

**PROC-02** has a subtler character: `fs.chmod()` on Windows NTFS does NOT throw — it silently succeeds, only manipulating the read-only file attribute (ignoring rwx bits). This means the production files (`skill-store.ts`, `skill-generator.ts`, `executor.ts`) will not crash, but the `chmod(0o755)` call is effectively a no-op on Windows. Since Git Bash on Windows can still execute files without the executable bit being set via NTFS ACLs, this silent no-op is acceptable. The required guard (per PROC-02) is a try/catch or platform check. Given that chmod does not throw, the simplest correct approach is a platform guard that skips chmod on Windows entirely, making the intent explicit in code.

**PROC-03** is a nuanced requirement. The SIGKILL concern in `launcher.ts` is `child.kill('SIGKILL')` in `shutdownWetty()`. On Windows, Node.js's `ChildProcess.kill()` accepts SIGKILL, SIGTERM, SIGINT, and SIGQUIT as string arguments and maps them all to a force-terminate — this does NOT throw. The actual import-time risk is zero: signal name strings are not validated at module parse time. However, the PROC-03 requirement as written is still valid: the code should be resilient, and the SIGKILL escalation should be wrapped in a platform-aware fallback so behavior is predictable and testable. The correct fix is minimal: the existing try/catch already guards the kill call; adding a platform check to use `child.kill('SIGTERM')` instead of `'SIGKILL'` on Windows makes the behavior explicit (since Windows force-terminates on both anyway, the try/catch is sufficient).

**Primary recommendation:** Guard `process.kill(-child.pid)` with a platform check in `executor.ts` (PROC-01, highest priority). Add explicit platform guards or try/catch to the three production chmod call sites (PROC-02). Verify `launcher.ts` SIGKILL path is covered by existing try/catch and document that Node.js maps SIGKILL to force-terminate on Windows (PROC-03).

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:child_process` (built-in) | Node.js 20+ | Process spawning, kill signals | No external dep; provides `spawn`, `ChildProcess.kill()` |
| `node:fs/promises` (built-in) | Node.js 20+ | `chmod`, `chmodSync` calls | Already in use; behavior is documented per-platform |
| `node:process` (built-in) | Node.js 20+ | `process.kill()`, `process.platform` | Platform detection without external deps |
| `node:os` (built-in) | Node.js 20+ | `os.platform()` alternative | Equivalent to `process.platform` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None required | — | — | No new runtime dependencies needed; Node.js built-ins are sufficient (per project out-of-scope decision) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `process.platform` check | `tree-kill` npm package | `tree-kill` kills process trees on all platforms but adds a runtime dependency; out of scope per REQUIREMENTS.md |
| Manual platform guard | `cross-spawn` / `shelljs` | No new runtime deps per project constraints |
| try/catch on chmod | `fswin` / `winattr` | Windows-specific ACL manipulation; over-engineering for this use case |

**Installation:** No new packages needed. All fixes use Node.js built-ins.

---

## Architecture Patterns

### Pattern 1: Platform Guard with Fallback

**What:** Inline `process.platform` check at the call site, with explicit POSIX and Windows branches.

**When to use:** When the behavior diverges by platform AND both branches have meaningful implementations (PROC-01).

**Example:**
```typescript
// Source: Node.js docs — process.kill(), child_process.kill()
if (child.pid) {
  if (process.platform !== 'win32') {
    // Unix: kill the entire process group so child processes (e.g., sleep) are also terminated
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Process may have already exited
      child.kill('SIGTERM');
    }
  } else {
    // Windows: process groups are not supported; kill the direct child
    // child.kill() correctly maps SIGTERM to force-terminate on Windows
    child.kill('SIGTERM');
  }
}
```

### Pattern 2: Platform Guard as Skip (No-Op)

**What:** Skip the call entirely on Windows when the operation is a no-op or not meaningful.

**When to use:** When Windows behavior is a harmless no-op but we want intent to be explicit (PROC-02).

**Example:**
```typescript
// Source: Node.js docs — fs.chmod on Windows
// chmod is a no-op on Windows NTFS (silently succeeds, ignores rwx bits)
// Skip it explicitly so the behavior is clear in code reviews
if (process.platform !== 'win32') {
  await chmod(scriptPath, 0o755);
}
```

### Pattern 3: try/catch with Absorbed Error

**What:** Wrap the call in try/catch and absorb platform-specific errors.

**When to use:** When the error is benign and the call has side effects you still want to attempt (PROC-02 fallback, PROC-03).

**Example:**
```typescript
// Absorb chmod errors on platforms where it may fail or be restricted
try {
  await chmod(scriptPath, 0o755);
} catch {
  // NTFS does not support Unix permissions; ignore on Windows
}
```

### Anti-Patterns to Avoid

- **Negating SIGKILL on Windows by omitting it entirely:** `child.kill('SIGKILL')` on Windows is actually mapped to force-terminate by Node.js — it works. Do not remove the SIGKILL escalation entirely; wrap it properly.
- **Using `os.platform()` in preference to `process.platform`:** Both work, but `process.platform` is the conventional Node.js idiom for inline checks.
- **Guarding only the negative-PID path but not the fallback:** The fallback `child.kill('SIGTERM')` inside the catch block in `executor.ts` (line 101) is already safe on all platforms. The guard only needs to wrap the `process.kill(-child.pid)` call.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-platform process group kill | Custom recursive child PID enumeration | Platform guard + `child.kill()` | Enumerating child PIDs is race-prone and OS-API-dependent; for this use case, direct child kill is sufficient on Windows |
| Windows permission setting | Custom ACL manipulation via WinAPI | Skip chmod on Windows | Scripts invoked via explicit `bash`/`node` interpreter do not need the executable bit on NTFS |

**Key insight:** On Windows/Git Bash, executable permission is not enforced by NTFS for files invoked via an explicit interpreter (e.g., `bash script.sh`). The chmod call is genuinely a no-op and can be safely skipped.

---

## Common Pitfalls

### Pitfall 1: Confusing `process.kill(-pid)` Error with `child.kill()` Safety

**What goes wrong:** Developer assumes both `process.kill(-pid)` and `child.kill('SIGKILL')` are dangerous on Windows and over-guards.

**Why it happens:** The two APIs have different behavior. `process.kill()` with a negative PID throws ESRCH on Windows. `child.kill()` with any signal string including SIGKILL does NOT throw — Node.js emulates it as force-terminate.

**How to avoid:** Guard only `process.kill(-child.pid, ...)`. The `child.kill('SIGKILL')` escalation in `launcher.ts` is already safe; the existing try/catch is sufficient.

**Warning signs:** Over-guarding `child.kill('SIGKILL')` with a platform check that removes the escalation entirely — this changes behavior unnecessarily.

### Pitfall 2: Assuming chmod Throws on Windows

**What goes wrong:** Developer wraps chmod in try/catch expecting to catch an ENOTSUP or EPERM error on Windows.

**Why it happens:** The Node.js issue tracker (issue #30019) shows a proposal to make chmod throw `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM`, but this was **not merged**. Current Node.js behavior: chmod on Windows silently succeeds (manipulates read-only attribute only).

**How to avoid:** Use a platform guard (`process.platform !== 'win32'`) rather than try/catch as the primary mechanism for PROC-02. try/catch is acceptable as a belt-and-suspenders measure.

**Warning signs:** Code that depends on catching a chmod error to detect Windows — this will not work.

### Pitfall 3: Detached + Negative PID Interaction on Windows

**What goes wrong:** `spawn(..., { detached: true })` is used in `executor.ts` (line 78) specifically to enable process group signals. On Windows, `detached: true` creates a separate console window but does NOT create a Unix-style process group that can be targeted by negative-PID kill.

**Why it happens:** The `detached` option has different semantics per platform. On Unix: new session/process group. On Windows: separate console window + ability to run after parent exits.

**How to avoid:** The platform guard for PROC-01 already accounts for this — the negative-PID kill is only attempted on non-Windows. No additional changes to the `detached` flag are needed.

**Warning signs:** Removing `detached: true` to "fix" Windows behavior — this would break the Unix process group kill, which is the whole point of the detached spawn.

### Pitfall 4: Test Files Also Use chmod

**What goes wrong:** Fixing production chmod calls but leaving test-file chmod calls to throw (or behave unexpectedly) on Windows.

**Why it happens:** `executor.test.ts`, `disclosure/integration.test.ts`, and `dashboard/generator.test.ts` all import and call `chmod`. Since chmod silently succeeds on Windows, these are not runtime errors. However, test assertions that depend on permission bits being set may fail on Windows.

**How to avoid:** Per PROC-02 scope ("across all 6 files"), verify test file chmod calls. Since chmod does not throw, test files are lower priority than production files. The requirement counts 6 files; the production files with actual chmod calls on script paths are: `executor.ts`, `skill-store.ts`, `skill-generator.ts`, `terminal.ts`.

---

## Code Examples

Verified patterns from official sources and project code analysis:

### PROC-01: Platform-Guarded Process Group Kill (executor.ts lines 94-106)

Current code:
```typescript
const timer = setTimeout(() => {
  timedOut = true;
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');  // THROWS ESRCH on Windows
    } catch {
      child.kill('SIGTERM');
    }
  } else {
    child.kill('SIGTERM');
  }
}, operation.timeout);
```

Fixed code:
```typescript
const timer = setTimeout(() => {
  timedOut = true;
  if (child.pid && process.platform !== 'win32') {
    // Unix: kill the entire process group
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Process may have already exited
      child.kill('SIGTERM');
    }
  } else if (child.pid) {
    // Windows: process groups are not supported; kill the direct child
    child.kill('SIGTERM');
  } else {
    child.kill('SIGTERM');
  }
}, operation.timeout);
```

Simplified equivalent (same logic, fewer branches):
```typescript
const timer = setTimeout(() => {
  timedOut = true;
  if (child.pid && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  } else {
    child.kill('SIGTERM');
  }
}, operation.timeout);
```

### PROC-02: Platform Guard for chmod (production file pattern)

```typescript
// skill-store.ts, skill-generator.ts, executor.ts pattern
const scriptPath = join(scriptsDir, script.filename);
await writeFile(scriptPath, script.content, 'utf-8');
// chmod is a no-op on Windows NTFS; skip explicitly rather than rely on silent success
if (process.platform !== 'win32') {
  await chmod(scriptPath, 0o755);
}
```

Synchronous variant (terminal.ts):
```typescript
writeFileSync(scriptPath, content, 'utf-8');
if (process.platform !== 'win32') {
  chmodSync(scriptPath, 0o755);
}
```

### PROC-03: SIGKILL in launcher.ts (shutdownWetty)

Current code (launcher.ts lines 154-159):
```typescript
escalationTimer = setTimeout(() => {
  try {
    child.kill('SIGKILL');  // Safe on Windows: Node.js maps to force-terminate
  } catch {
    // Process may have already exited between SIGTERM and SIGKILL
  }
}, gracePeriodMs);
```

This code is already Windows-safe. `child.kill('SIGKILL')` does not throw on Windows — it is mapped to `TerminateProcess()`. The existing try/catch handles the ESRCH case. PROC-03 is satisfied by verifying this and optionally adding a comment documenting the Windows behavior. If a code change is required for test coverage or explicit platform documentation, a platform-specific branch can be added but is not strictly necessary for runtime correctness.

---

## Exact Files Requiring Changes

Based on code analysis, PROC-01 and PROC-02 require changes to these production files:

| File | Requirement | Change Required |
|------|-------------|-----------------|
| `src/chipset/blitter/executor.ts` | PROC-01 | Add `process.platform !== 'win32'` guard around `process.kill(-child.pid, ...)` |
| `src/chipset/blitter/executor.ts` | PROC-02 | Add platform guard around `chmod(scriptPath, 0o755)` (line 55) |
| `src/storage/skill-store.ts` | PROC-02 | Add platform guard around `chmod(scriptPath, 0o755)` (line 365) |
| `src/detection/skill-generator.ts` | PROC-02 | Add platform guard around `chmod(scriptPath, 0o755)` (line 137) |
| `src/cli/commands/terminal.ts` | PROC-02 | Add platform guard around `chmodSync(scriptPath, 0o755)` (line 194) |
| `src/terminal/launcher.ts` | PROC-03 | Verify existing try/catch is sufficient; add explanatory comment |

Test files with chmod (`executor.test.ts`, `disclosure/integration.test.ts`, `dashboard/generator.test.ts`) do not throw on Windows (chmod silently succeeds), so they are lower priority. They are in the "6 files" count but may not need code changes — only verification.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `process.kill(-pid)` for group kill | Platform-guarded `process.kill(-pid)` with `child.kill()` fallback | Standard pattern since Node.js Windows support matured | Avoids ESRCH throw on Windows |
| `chmod()` always called | `chmod()` skipped on Windows or wrapped in try/catch | Node.js issue #30019 (2019, unresolved) confirmed no-throw behavior | No runtime error, but code is explicit about intent |

**Deprecated/outdated:**
- The idea that `fs.chmod` might throw `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM` on Windows: the proposal in issue #30019 was rejected; chmod silently succeeds.
- Using `tree-kill` npm package for cross-platform process tree killing: out of scope per project constraints (no new runtime deps).

---

## Open Questions

1. **PROC-02 scope: does it cover test files?**
   - What we know: Requirements say "across all 6 files that use them"; chmod does not throw on Windows so test files have no runtime risk.
   - What's unclear: Whether the planner should create tasks to add platform guards in test files for completeness, or only in production files.
   - Recommendation: Treat production files (executor.ts, skill-store.ts, skill-generator.ts, terminal.ts) as P0. Test files as P1 (verify-only, no code change needed unless a test asserts on permission bits).

2. **PROC-03 interpretation: is a code change required or just verification?**
   - What we know: `child.kill('SIGKILL')` does not throw on Windows. The existing try/catch guards it. Importing the module does not throw.
   - What's unclear: Whether PROC-03 requires an actual code change or just a test/verification task.
   - Recommendation: Treat PROC-03 as a verification task + comment addition. The requirement says "guarded with platform check and Windows-safe fallback" — if taken literally, a platform branch that explicitly documents Windows behavior is required. Planner should create a small code task to add the guard + comment.

3. **Detached process on Windows: does `detached: true` in executor.ts cause any other Windows issues?**
   - What we know: On Windows, `detached: true` creates a separate console window (visible in Task Manager). This is cosmetically different but not a correctness bug.
   - What's unclear: Whether the project considers visible console windows on Windows a defect.
   - Recommendation: Out of scope for Phase 3. Document as known behavior.

---

## Sources

### Primary (HIGH confidence)

- Node.js official docs (v25.6.1) — `process.kill()`, `child_process.spawn()`, `fs.chmod()`, signal handling on Windows: https://nodejs.org/api/process.html, https://nodejs.org/api/child_process.html, https://nodejs.org/api/fs.html
- Node.js GitHub issue #3617 — confirmed `process.kill(-pid)` throws ESRCH on Windows: https://github.com/nodejs/node/issues/3617
- Node.js GitHub issue #30019 — confirmed `fs.chmod` silently succeeds on Windows (no throw): https://github.com/nodejs/node/issues/30019
- Source code audit — `src/chipset/blitter/executor.ts`, `src/terminal/launcher.ts`, `src/storage/skill-store.ts`, `src/detection/skill-generator.ts`, `src/cli/commands/terminal.ts` (all read directly)

### Secondary (MEDIUM confidence)

- ehmicky/cross-platform-node-guide permissions.md — confirms chmod is Unix-only with limited Windows support: https://github.com/ehmicky/cross-platform-node-guide/blob/main/docs/5_security/permissions.md
- Node.js GitHub issue #12378 — process.kill() and signals on Windows: https://github.com/nodejs/node/issues/12378
- azimi.me — process group kill pattern documentation: https://azimi.me/2014/12/31/kill-child_process-node-js.html

### Tertiary (LOW confidence)

- Node.js GitHub issue #4812 — older report on chmod Windows behavior (v0.x era, behavior unchanged): https://github.com/nodejs/node-v0.x-archive/issues/4812

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — All built-in Node.js APIs, no external dependencies
- Architecture: HIGH — Platform guards are a well-established Node.js cross-platform pattern; code patterns verified against actual source files
- Pitfalls: HIGH — Based on official Node.js issue tracker and direct API documentation; chmod-no-throw behavior confirmed in issue #30019

**Research date:** 2026-02-22
**Valid until:** 2026-08-22 (stable Node.js APIs; chmod behavior unlikely to change given rejected proposal in #30019)
