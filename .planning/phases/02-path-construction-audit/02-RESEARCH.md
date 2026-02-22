# Phase 2: Path Construction Audit - Research

**Researched:** 2026-02-22
**Domain:** Node.js cross-platform path handling, child_process, ESM URL utilities
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use `gsd-tools.cjs` (GSD's CLI utility) as the base pattern for all path handling
- Key patterns from gsd-tools.cjs to replicate:
  - `path.join()` for all path construction (never string concatenation with `/`)
  - `require('os').homedir()` for home directory resolution
  - `path.isAbsolute()` checks before joining with cwd
  - Tilde expansion: `startsWith('~/') ? path.join(homedir, slice(2)) : path.join(cwd, ref)`

### Claude's Discretion
- **Path comparison strategy** — How `assertSafePath` and safety/validation layer normalizes paths before comparing (e.g., `path.resolve()` both sides vs normalize to forward slashes)
- **Tilde expansion timing** — Whether to expand `~` at read time (resolve immediately) or use time (keep portable in storage, expand at fs API calls)
- **Commit granularity** — How to group path fixes into commits (per-requirement, per-file, or natural grouping)
- **Verification approach** — Manual testing on Windows/Git Bash, mocked path unit tests, or both
- **`import.meta.url` handling** — How to wrap with `fileURLToPath()` consistently (PATH-05)
- **`execFile()` migration** — How to replace `exec()` template-string patterns in version-manager.ts (PATH-02)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PATH-01 | Storage layer uses `path.join()` instead of string concatenation for all file path construction | `skill-store.ts` already uses `join()` throughout; the issue is the constructor default `'.claude/skills'` which is a relative path needing `path.join('.claude', 'skills')` |
| PATH-02 | `version-manager.ts` uses `path.join()` and `execFile()` instead of template-string paths inside `exec()` | `version-manager.ts` uses `exec()` with `promisify`, passing path strings as part of shell command strings (e.g. `git log --follow -- "${skillPath}"`); needs `execFile('git', [...args], {cwd})` instead |
| PATH-03 | Hardcoded forward-slash path defaults in `src/safety/` and `src/validation/` replaced with `path.join()` equivalents | `assertSafePath()` in `src/validation/path-safety.ts` already uses `resolve()` on both sides and `sep` for the separator check — already cross-platform; constructor defaults (e.g. `'.claude/.audit-log.jsonl'`) need `path.join()` wrapping |
| PATH-04 | Home directory resolution uses `os.homedir()` consistently with no tilde-string assumptions passed to fs operations | `src/types/scope.ts` correctly uses `join(homedir(), '.claude', 'skills')`; `src/portability/platform-adapter.ts` PLATFORMS registry stores `'~/.claude/skills'` tilde strings — these are label strings, NOT passed to fs APIs, but must be verified; workflow display strings use `~/.claude/skills/` purely for display, not for fs |
| PATH-05 | All `import.meta.url` usage correctly wrapped with `fileURLToPath()` (no raw `.pathname` access) | All 10 `import.meta.url` occurrences in codebase already use `fileURLToPath()` or `createRequire()` — no raw `.pathname` access found; this requirement is already satisfied |
</phase_requirements>

---

## Summary

Phase 2 is a targeted surgical audit, not a sweeping rewrite. The codebase is in much better shape than the requirement names imply — most path handling is already correct. The actual work concentrates on two files: `src/learning/version-manager.ts` (PATH-02, genuine bug) and constructor default strings across the storage/safety layers (PATH-01, PATH-03, PATH-04, low-risk but technically incorrect).

The critical finding is that **PATH-05 is already done**: every `import.meta.url` reference in the codebase is already wrapped in `fileURLToPath()` or passed to `createRequire()`. No `.pathname` access exists. This reduces Phase 2's scope meaningfully.

The `version-manager.ts` bug is the most consequential: it builds git commands as shell strings (`git log --follow -- "${skillPath}"`), so a skill path containing spaces or Windows backslashes will either silently truncate or fail. Migrating to `execFile('git', [...], {cwd})` eliminates shell interpolation entirely.

For `platform-adapter.ts` tilde strings, research confirms they are display labels stored in `PlatformConfig.userSkillsDir` and never passed to `fs` APIs — `getSkillsBasePath()` in `types/scope.ts` provides the actual fs-ready path using `os.homedir()`. The PLATFORMS registry does not need changes, but the finding should be documented as a STATE.md concern resolved.

**Primary recommendation:** Fix `version-manager.ts` first (PATH-02, genuine cross-platform bug), then audit constructor defaults for PATH-01/PATH-03/PATH-04, then document PATH-05 as already satisfied.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:path` (built-in) | Node 18+ | `join()`, `resolve()`, `dirname()`, `basename()`, `sep`, `isAbsolute()` | Native, zero-dep, handles platform separators automatically |
| `node:os` (built-in) | Node 18+ | `homedir()` | Native, returns OS-correct path (e.g., `C:\Users\Myke` on Windows) |
| `node:url` (built-in) | Node 18+ | `fileURLToPath()` | Converts `file:///C:/...` ESM URL to Windows-native path |
| `node:child_process` (built-in) | Node 18+ | `execFile()` | Spawns process with argv array, no shell interpretation |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `util.promisify` | Built-in | Promisify `execFile` callback | Already used for `exec`; same pattern applies to `execFile` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `execFile` | `exec` | `exec` passes args through a shell (cmd.exe on Windows); `execFile` bypasses shell entirely — use `execFile` always for git |
| `path.join()` | `path.posix.join()` | `path.posix.join()` always uses `/`; correct for URLs but wrong for native fs paths on Windows — never use for fs paths |
| `os.homedir()` | `process.env.HOME` or `process.env.USERPROFILE` | env vars can be unset or overridden; `os.homedir()` is the authoritative Node.js API |

**Installation:** No new dependencies required. All tools are Node.js built-ins.

---

## Architecture Patterns

### Recommended Project Structure

No structural changes required. This phase is purely in-place fixes within existing files:

```
src/
├── learning/version-manager.ts    # PATH-02: exec() → execFile() migration
├── storage/skill-store.ts         # PATH-01: verify constructor default
├── safety/audit-logger.ts         # PATH-03: verify constructor default
├── validation/path-safety.ts      # PATH-03: already correct (uses resolve + sep)
├── types/scope.ts                  # PATH-04: already correct (uses homedir())
└── portability/platform-adapter.ts # PATH-04: verify tilde strings are labels only
```

### Pattern 1: execFile for Git Commands (PATH-02)

**What:** Replace `exec('git log ...')` shell-string commands with `execFile('git', [...args], {cwd})`.

**When to use:** Any time a git command is constructed with runtime path variables. Shell strings with embedded paths fail on Windows when paths contain spaces or backslashes.

**Current (broken) pattern:**
```typescript
// src/learning/version-manager.ts (current)
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

private async git(command: string): Promise<string> {
  const { stdout } = await execAsync(command, {
    encoding: 'utf8',
    cwd: this.workDir,
  });
  return stdout;
}

// Called as:
await this.git(`git log --format="%H|%h|%ai|%s" --follow -- "${skillPath}"`);
```

**Correct pattern:**
```typescript
// Source: Node.js official docs https://nodejs.org/api/child_process.html#child_processexecfilefile-args-options-callback
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

private async git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    encoding: 'utf8',
    cwd: this.workDir,
  });
  return stdout;
}

// Called as (no shell interpolation, path is a safe argv element):
await this.git(['log', '--format=%H|%h|%ai|%s', '--follow', '--', skillPath]);
```

**Key difference:** With `execFile`, the path is passed as a separate argv element. No shell quoting, no backslash escaping, no space issues.

### Pattern 2: path.join() for Constructor Defaults (PATH-01, PATH-03)

**What:** Replace string literal default paths like `'.claude/skills'` with `join('.claude', 'skills')`.

**When to use:** Any constructor default or constant that combines path segments.

**Example:**
```typescript
// BEFORE (PATH-01 in skill-store.ts):
export class SkillStore {
  constructor(private skillsDir: string = '.claude/skills') {}
}

// AFTER:
import { join } from 'path';
export class SkillStore {
  constructor(private skillsDir: string = join('.claude', 'skills')) {}
}

// BEFORE (PATH-03 in audit-logger.ts):
export class AuditLogger {
  constructor(logPath: string = '.claude/.audit-log.jsonl') {
    this.logPath = logPath;
  }
}

// AFTER:
import { join } from 'path';
export class AuditLogger {
  constructor(logPath: string = join('.claude', '.audit-log.jsonl')) {
    this.logPath = logPath;
  }
}
```

**Note:** On Windows/Git Bash, Node.js `path.join()` still produces forward slashes in many contexts via MSYS translation. However, the native `path.sep` is `\`, and `path.join()` returns backslash-separated paths when running in a native Windows Node.js process (not Git Bash). Using `join()` ensures correctness regardless of which Node.js binary is used.

### Pattern 3: assertSafePath Already Cross-Platform (PATH-03)

**Existing implementation in `src/validation/path-safety.ts`:**
```typescript
// Source: existing codebase (already correct)
import { resolve, sep } from 'path';

export function assertSafePath(resolvedPath: string, baseDir: string): void {
  const absPath = resolve(resolvedPath);
  const absBase = resolve(baseDir);

  if (absPath === absBase) return;

  const basePrefixWithSep = absBase + sep;  // Uses platform-native sep
  if (!absPath.startsWith(basePrefixWithSep)) {
    throw new PathTraversalError(...);
  }
}
```

This is already correct: `resolve()` normalizes to the platform's absolute path format (using `\` on Windows), and `sep` is the platform separator. No changes needed.

### Pattern 4: fileURLToPath() Already Applied (PATH-05)

All `import.meta.url` usages in the codebase already follow the correct pattern:

```typescript
// Pattern in use across all 10 occurrences (already correct):
import { fileURLToPath } from 'node:url';  // or 'url'
import { dirname } from 'node:path';        // or 'path'

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Or for createRequire:
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url); // createRequire handles file URLs natively
```

**No changes needed for PATH-05.** The requirement is pre-satisfied.

### Pattern 5: Platform-Adapter Tilde Strings (PATH-04 — Verify Only)

The `PLATFORMS` registry in `src/portability/platform-adapter.ts` stores tilde strings:
```typescript
export const PLATFORMS = {
  claude: {
    userSkillsDir: '~/.claude/skills',  // Display label — NOT passed to fs
    ...
  },
};
```

Research confirms: `PlatformConfig.userSkillsDir` is used only for display (in `src/cli/commands/export.ts` for help text) and for the export CLI — it is never passed to `fs.readdir`, `fs.mkdir`, or any other fs API. The actual fs path comes from `getSkillsBasePath()` in `src/types/scope.ts`, which correctly uses `join(homedir(), '.claude', 'skills')`.

**Recommendation:** No changes to `platform-adapter.ts`. Document in STATE.md that this concern is resolved.

### Pattern 6: path.join() for Skill Path Construction in version-manager.ts (PATH-02)

```typescript
// BEFORE:
private skillsDir: string;
constructor(skillsDir = '.claude/skills', workDir = '.') {
  this.skillsDir = skillsDir;
}
// Usage:
const skillPath = `${this.skillsDir}/${skillName}/SKILL.md`;  // String concat!

// AFTER (two fixes combined):
import { join } from 'path';
constructor(skillsDir = join('.claude', 'skills'), workDir = '.') {
  this.skillsDir = skillsDir;
}
// Usage:
const skillPath = join(this.skillsDir, skillName, 'SKILL.md');
```

### Anti-Patterns to Avoid

- **Template string paths:** `` `${dir}/${name}/SKILL.md` `` — fails when `dir` contains backslashes on Windows
- **`exec()` with embedded paths:** `exec(`git show ${hash}:"${skillPath}"`)` — shell interprets backslashes
- **`process.env.HOME` for home dir:** May be unset on Windows; use `os.homedir()` instead
- **`import.meta.url` `.pathname` access:** `new URL(import.meta.url).pathname` returns `/C:/Users/...` on Windows (mangled drive letter); always use `fileURLToPath(import.meta.url)` instead
- **`path.posix.join()` for fs paths:** Produces forward slashes; breaks on Windows native Node.js

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-platform home directory | Custom `~` expansion | `os.homedir()` | Handles Windows `%USERPROFILE%`, Unix `$HOME`, and edge cases |
| Git command execution | Shell-escaped string builder | `execFile('git', args, {cwd})` | argv array bypass eliminates all shell quoting issues |
| ESM `__dirname` equivalent | `new URL(import.meta.url).pathname` | `fileURLToPath(import.meta.url)` | Handles Windows `file:///C:/...` drive letter correctly |
| Path segment joining | String concatenation with `/` | `path.join(a, b, c)` | Platform-native separator, normalizes redundant separators |

**Key insight:** Node.js built-ins for path and OS operations exist precisely because cross-platform path handling has edge cases (UNC paths, drive letters, mixed separators) that custom code reliably misses.

---

## Common Pitfalls

### Pitfall 1: exec() Shell Interpolation of Paths

**What goes wrong:** `exec(`git log -- "${path}"`)` on Windows fails when `path` contains backslashes — the shell may interpret `\` as escape sequences or `\"` may not work as expected in cmd.exe.

**Why it happens:** `exec()` passes the full string to the system shell (`/bin/sh` on Unix, `cmd.exe` on Windows). Path strings with `\` are interpreted.

**How to avoid:** Use `execFile('git', ['log', '--', path], {cwd})` — the path is an argv element, never shell-interpreted.

**Warning signs:** Tests pass on Linux/macOS but fail on Windows with paths containing spaces; git operations silently truncate paths at first backslash.

### Pitfall 2: import.meta.url .pathname on Windows

**What goes wrong:** `new URL(import.meta.url).pathname` returns `/C:/Users/Myke/repos/...` on Windows — the leading `/` before the drive letter causes `fs.readFile` to fail (path not found).

**Why it happens:** `file:///C:/path` is the correct file URL format; `.pathname` returns `/C:/path` (three slashes → one retained), which is not a valid Windows path.

**How to avoid:** Always use `fileURLToPath(import.meta.url)` from `node:url`. This is already done correctly throughout this codebase — no action required.

**Warning signs:** File not found errors on Windows when loading config files relative to the module; works on Linux/macOS.

### Pitfall 3: Relative Path Defaults That Don't Use path.join()

**What goes wrong:** A class constructor default like `'.claude/skills'` works on Windows in Git Bash (MSYS translates `/` to `\` for many fs calls) but fails in native Windows Node.js where `path.sep === '\\'` and `resolve()` produces backslash paths that don't prefix-match a forward-slash base.

**Why it happens:** The `assertSafePath()` uses `resolve()` which produces backslash paths on Windows — comparing against a `resolve('.claude/skills')` that was never `join()`-constructed can produce subtle mismatches when `this.skillsDir` was assigned with a literal `/` separator.

**How to avoid:** Use `join('.claude', 'skills')` for all constructor defaults that will later be passed to `resolve()`.

**Warning signs:** `PathTraversalError` thrown spuriously when accessing skills in project scope on Windows.

### Pitfall 4: os.homedir() vs process.env.HOME

**What goes wrong:** `process.env.HOME` is undefined on Windows (the variable is `HOMEPATH` or `USERPROFILE`). Code that falls back to `''` or `'/'` silently creates wrong paths.

**Why it happens:** Unix convention assumes `$HOME`; Windows convention differs.

**How to avoid:** Use `os.homedir()` exclusively. This is already done correctly in `src/types/scope.ts` and all `homedir()` import sites.

**Warning signs:** Skills written to `/.claude/skills/` or `C:\.claude\skills\` instead of `C:\Users\Myke\.claude\skills\`.

---

## Code Examples

Verified patterns from Node.js official sources:

### execFile for Git (PATH-02 fix pattern)
```typescript
// Source: Node.js docs https://nodejs.org/api/child_process.html#child_processexecfilefile-args-options-callback
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';

const execFileAsync = promisify(execFile);

export class VersionManager {
  private skillsDir: string;
  private workDir: string;

  constructor(skillsDir = join('.claude', 'skills'), workDir = '.') {
    this.skillsDir = skillsDir;
    this.workDir = workDir;
  }

  private async git(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      encoding: 'utf8',
      cwd: this.workDir,
    });
    return stdout;
  }

  async getHistory(skillName: string): Promise<SkillVersion[]> {
    const skillPath = join(this.skillsDir, skillName, 'SKILL.md');
    // No quotes needed around skillPath — it's an argv element, not a shell string
    const stdout = await this.git([
      'log', '--format=%H|%h|%ai|%s', '--follow', '--', skillPath
    ]);
    // ...
  }

  async getVersionContent(skillName: string, hash: string): Promise<string> {
    const skillPath = join(this.skillsDir, skillName, 'SKILL.md');
    // git show hash:path — path must be a relative posix path for git's object store
    // Use forward slashes explicitly here (git uses posix paths internally):
    const gitPath = skillPath.replace(/\\/g, '/');
    return await this.git(['show', `${hash}:${gitPath}`]);
  }

  async rollback(skillName: string, targetHash: string): Promise<RollbackResult> {
    const skillPath = join(this.skillsDir, skillName, 'SKILL.md');
    const gitPath = skillPath.replace(/\\/g, '/');

    await this.git(['checkout', targetHash, '--', gitPath]);
    await this.git(['add', gitPath]);
    const commitMessage = `rollback(${skillName}): revert to ${targetHash.slice(0, 7)}`;
    await this.git(['commit', '-m', commitMessage]);
    // ...
  }
}
```

**Special note on `git show hash:path` and `git checkout hash -- path`:** Git's object store always uses POSIX paths internally, even on Windows. When passing a path to these git commands as an argument (not a shell string), the path must still use forward slashes for the `hash:path` colon-syntax. Apply `.replace(/\\/g, '/')` to the path portion only when constructing the `hash:path` combined arg.

### path.join() for Constructor Defaults (PATH-01, PATH-03)
```typescript
// Source: Node.js path docs https://nodejs.org/api/path.html#pathjoinpaths
import { join } from 'path';

// skill-store.ts
export class SkillStore {
  constructor(private skillsDir: string = join('.claude', 'skills')) {}
}

// audit-logger.ts
export class AuditLogger {
  constructor(logPath: string = join('.claude', '.audit-log.jsonl')) {
    this.logPath = logPath;
  }
}

// version-manager.ts
export class VersionManager {
  constructor(skillsDir = join('.claude', 'skills'), workDir = '.') {}
}
```

### fileURLToPath Pattern (PATH-05 — already in use, shown for reference)
```typescript
// Source: Node.js url docs https://nodejs.org/api/url.html#urlfileurltopathfileurl
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve paths relative to current module:
const configPath = join(__dirname, '..', '..', 'config', 'reserved-names.json');
```

---

## Scope Mapping: What Actually Needs Changing

Based on full codebase audit:

### PATH-01: Storage Layer
**File:** `src/storage/skill-store.ts`
- Constructor default: `'.claude/skills'` → `join('.claude', 'skills')` (line 92)
- All internal uses of `join()` are already correct

**File:** `src/learning/version-manager.ts`
- Constructor default: `'.claude/skills'` → `join('.claude', 'skills')` (line 23)
- All `\`${this.skillsDir}/${skillName}/SKILL.md\`` → `join(this.skillsDir, skillName, 'SKILL.md')` (lines 43, 88, 106, 154, 168)

### PATH-02: version-manager.ts exec() → execFile()
**File:** `src/learning/version-manager.ts`
- Replace `exec` import with `execFile`
- Replace `promisify(exec)` with `promisify(execFile)`
- Change `git(command: string)` to `git(args: string[])`
- Rewrite all `this.git(...)` call sites (5 call sites):
  - `getHistory`: `git log --format=...`
  - `getVersionContent`: `git show hash:path`
  - `rollback`: `git checkout`, `git add`, `git commit`
  - `compareVersions`: `git diff`
  - `getCurrentHash`: `git log -1`
- Add `.replace(/\\/g, '/')` for `gitPath` in `git show` and `git checkout` colon-syntax args

### PATH-03: Safety/Validation Defaults
**File:** `src/safety/audit-logger.ts`
- Constructor default: `'.claude/.audit-log.jsonl'` → `join('.claude', '.audit-log.jsonl')` (line 64)
- Add `import { join } from 'path'` if not present (currently only `dirname` is imported)

**File:** `src/validation/path-safety.ts`
- No changes needed. Already uses `resolve()` and `sep` — cross-platform correct.

**File:** `src/validation/directory-validation.ts`
- `isLegacyFlatFile()` normalizes path separators explicitly via `replace(/\\/g, '/')` — correct for string parsing
- No changes needed

### PATH-04: Home Directory Resolution
**File:** `src/types/scope.ts` — Already correct (`join(homedir(), '.claude', 'skills')`)

**File:** `src/portability/platform-adapter.ts` — No changes. Tilde strings are display labels only, confirmed not passed to fs APIs.

**File:** `src/workflows/create-skill-workflow.ts` — `~/.claude/skills/${name}/SKILL.md` strings are display-only (used in `p.log.message()` and `p.outro()` calls, not fs operations). No changes needed.

**File:** `src/workflows/list-skills-workflow.ts` — `'~/.claude/skills/'` string is display-only. No changes needed.

**File:** `src/cli/commands/resolve.ts` — `'~/.claude/skills/'` strings are display-only for scope path display in logs. No changes needed.

### PATH-05: import.meta.url
**Status: Already satisfied.** All 10 occurrences use `fileURLToPath()` or `createRequire()`. No changes needed.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `exec()` with shell strings | `execFile()` with argv array | Node.js v10+ | Eliminates shell injection, works cross-platform |
| `process.env.HOME` | `os.homedir()` | Node.js stable API | Windows-compatible |
| Raw `import.meta.url` pathname | `fileURLToPath(import.meta.url)` | Node.js ESM (v12+) | Correct Windows drive letter handling |
| String path concatenation | `path.join()` | Best practice always | Platform separator independence |

**Deprecated/outdated:**
- `exec()` for git operations with embedded paths: replaced by `execFile()` in this phase
- Template string path construction: replaced by `path.join()` in this phase

---

## Open Questions

1. **`git show hash:path` path format on Windows**
   - What we know: Git's object store uses POSIX paths internally; `git show` expects `hash:posix/path`
   - What's unclear: Whether Git on Windows (Git Bash) transparently handles backslashes in the colon-syntax arg when passed via argv (not shell string)
   - Recommendation: Apply `.replace(/\\/g, '/')` to the path portion defensively; this is a no-op on Linux/macOS and ensures correctness on Windows

2. **VersionManager constructor defaults used with absolute paths**
   - What we know: `SkillStore` and `VersionManager` constructors accept override paths; the defaults are relative
   - What's unclear: Whether callers in `src/cli/commands/audit.ts` pass absolute paths already resolved via `homedir()` or rely on the relative default being resolved from cwd
   - Recommendation: Read `src/cli/commands/audit.ts` during implementation to confirm before changing defaults

3. **Test file `execFile` patterns**
   - What we know: `version-manager.test.ts` uses `execAsync` (promisified `exec`) for test setup (git init, git add, etc.)
   - What's unclear: Whether test setup exec calls need the same treatment (they don't embed runtime path variables, so lower priority)
   - Recommendation: Leave test setup `exec()` calls as-is for now; they use fixed commands without user-controlled paths

---

## Sources

### Primary (HIGH confidence)
- Node.js `child_process.execFile` docs — https://nodejs.org/api/child_process.html#child_processexecfilefile-args-options-callback
- Node.js `path.join` docs — https://nodejs.org/api/path.html#pathjoinpaths
- Node.js `os.homedir` docs — https://nodejs.org/api/os.html#oshomedir
- Node.js `url.fileURLToPath` docs — https://nodejs.org/api/url.html#urlfileurltopathfileurl
- Codebase direct read: all 10 `import.meta.url` usages verified to use `fileURLToPath()` or `createRequire()`
- Codebase direct read: `src/validation/path-safety.ts` verified to use `resolve()` + `sep` (cross-platform correct)
- Codebase direct read: `src/types/scope.ts` verified to use `join(homedir(), '.claude', 'skills')`
- Codebase direct read: `src/portability/platform-adapter.ts` tilde strings traced — not passed to fs APIs

### Secondary (MEDIUM confidence)
- Git documentation on path formats in git show/checkout: POSIX paths required in `hash:path` syntax even on Windows

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all built-in Node.js APIs, well-documented
- Architecture: HIGH — direct codebase read, no inference
- Pitfalls: HIGH — based on direct code analysis of exact patterns in this codebase
- PATH-05 already-done finding: HIGH — verified by reading all `import.meta.url` occurrences

**Research date:** 2026-02-22
**Valid until:** 2026-05-22 (stable Node.js APIs, 90-day validity)
