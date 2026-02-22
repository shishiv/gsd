# Architecture Research

**Domain:** Cross-platform Node.js/TypeScript — Windows compatibility for existing codebase
**Researched:** 2026-02-22
**Confidence:** HIGH

---

## Standard Architecture for Cross-Platform Node.js

### System Overview

This is not a greenfield architecture decision. The system exists and is well-structured. The architecture question for this milestone is: **where do platform-specific fixes belong within the existing layer structure?**

```
┌─────────────────────────────────────────────────────────────┐
│                     CLI Entry Point                          │
│  src/cli.ts  ·  bin/skill-creator  ·  npm scripts           │
├─────────────────────────────────────────────────────────────┤
│                  Command Handlers Layer                       │
│  src/cli/commands/  ·  src/workflows/                        │
│  (builds paths, reads args, calls storage/application)       │
├─────────────────────────────────────────────────────────────┤
│     Application Pipeline     │    Supporting Systems         │
│  src/application/            │  src/detection/               │
│  src/storage/                │  src/learning/                │
│  src/embeddings/             │  src/orchestrator/            │
│  (path construction HERE)    │  src/discovery/               │
├──────────────────────────────┴──────────────────────────────┤
│                   Platform Boundary Layer                     │
│  Node.js fs/promises  ·  node:os  ·  node:path               │
│  child_process  ·  Shell scripts (scripts/console/*.sh)       │
├─────────────────────────────────────────────────────────────┤
│                    OS / File System                           │
│  Windows (MINGW64/Git Bash)  ·  macOS  ·  Linux              │
└─────────────────────────────────────────────────────────────┘
```

**Platform fixes belong at the Platform Boundary Layer**, not above it. The layers above should call Node.js APIs correctly, and Node.js handles the rest.

### Component Responsibilities for Windows Compatibility

| Component | Platform Concern | Fix Location |
|-----------|-----------------|--------------|
| `src/types/scope.ts` | Home directory resolution | Already correct: uses `homedir()` + `path.join()` |
| `src/storage/skill-store.ts` | Path construction for skill files | Uses `join()/dirname()/resolve()` — needs audit for string concat |
| `src/storage/skill-index.ts` | Cache index paths | Audit for hardcoded separators |
| `src/portability/platform-adapter.ts` | `~/.claude/skills` tilde expansion | **Tilde strings not resolved** — needs `join(homedir(), ...)` |
| `src/learning/version-manager.ts` | Shell exec via `exec()` — shell interpolation of paths | Path quoting in git command strings |
| `src/dashboard/collectors/git-collector.ts` | `execFile('git', args)` | Safe — `execFile` does not invoke shell |
| `src/terminal/launcher.ts` | `spawn('wetty', args)` with SIGTERM/SIGKILL | Signals not available on Windows — needs platform guard |
| `src/discovery/session-enumerator.ts` | `~/.claude/projects/` scanning | Uses `homedir()` + `join()` — correct |
| `scripts/console/*.sh` | Bash scripts invoked by tests via `execFile(scriptPath)` | **Will fail on Windows** — needs `bash` shebang resolution or Node.js replacement |
| `src/console/*.test.ts` | Tests execute `.sh` scripts directly via `execFile` | **Primary failure point** — tests call bash scripts without shell resolution |
| `package.json` scripts | npm run commands | `build`/`test`/`dev` already cross-platform |

---

## Recommended Project Structure for Platform Code

The existing structure is correct. **Do not create a new platform abstraction layer.** Node.js path APIs already provide the abstraction.

```
src/
├── types/
│   └── scope.ts              # getSkillsBasePath() — already uses homedir()+join()
├── validation/
│   └── path-safety.ts        # assertSafePath() uses path.sep — already correct
├── portability/
│   └── platform-adapter.ts   # PLATFORMS registry has literal "~/.claude/skills"
│                             # → These are data for export labels, not runtime paths
│                             # → If ever resolved at runtime, expand via homedir()
├── storage/                  # PRIMARY audit target
│   ├── skill-store.ts        # Uses join/dirname/resolve — audit for string concat
│   └── skill-index.ts        # Cache path construction
├── learning/
│   └── version-manager.ts    # exec() with shell=true — path quoting risk
├── terminal/
│   └── launcher.ts           # SIGTERM/SIGKILL — Windows incompatible
└── console/                  # TEST layer has bash script deps — HIGH RISK
    └── *.test.ts             # execFile(scriptPath) — bash not on PATH by default
```

**No new directories needed.** Fixes are surgical edits within existing files.

### Structure Rationale

- **No new `src/platform/` directory:** Over-engineering. Node.js `path`, `os`, and `fs` modules are the abstraction layer. A custom wrapper over a wrapper adds complexity without value. Project constraints explicitly state: "No custom path abstraction layer."
- **Fix in place:** Each file is fixed where the violation exists. This makes diffs reviewable and keeps PRs atomic.
- **Validation stays in `src/validation/path-safety.ts`:** It already uses `path.sep` correctly. No changes needed.

---

## Architectural Patterns

### Pattern 1: Node.js Path APIs for All Path Construction

**What:** Always use `path.join()`, `path.resolve()`, `path.dirname()`, `path.basename()` to build paths. Never concatenate path segments with `/` or `\` string literals.

**When to use:** Every time a file path is constructed from multiple segments.

**Trade-offs:** Minor verbosity. Zero portability issues.

**Example:**
```typescript
// WRONG — assumes Unix separator
const skillPath = `${this.skillsDir}/${skillName}/SKILL.md`;

// CORRECT — path.join uses platform separator
import { join } from 'node:path';
const skillPath = join(this.skillsDir, skillName, 'SKILL.md');
```

**Specific violation found:** `src/learning/version-manager.ts` line 43:
```typescript
// WRONG
const skillPath = `${this.skillsDir}/${skillName}/SKILL.md`;
// CORRECT
const skillPath = join(this.skillsDir, skillName, 'SKILL.md');
```

### Pattern 2: `os.homedir()` for Home Directory Resolution

**What:** Use `os.homedir()` (or `homedir()` from `node:os`) to resolve the user's home directory. Never rely on `~`, `$HOME`, or `%USERPROFILE%` in runtime path strings — those are shell expansions, not Node.js features.

**When to use:** Any code that constructs a path under the user's home directory.

**Trade-offs:** None. This is correct on all platforms.

**Example:**
```typescript
import { homedir } from 'node:os';
import { join } from 'node:path';

// WRONG — tilde is not expanded by Node.js fs APIs
const skillsDir = '~/.claude/skills';

// CORRECT
const skillsDir = join(homedir(), '.claude', 'skills');
```

**Context:** The `PLATFORMS` registry in `src/portability/platform-adapter.ts` stores literal `~/.claude/skills` strings. This is acceptable **only if those strings are never used as runtime paths** (they appear to be used as human-readable labels for export documentation). Verify this assumption during audit. If any code passes these strings to `fs` operations, replace with `homedir()` resolution.

### Pattern 3: `execFile` over `exec` for Git Commands

**What:** Use `child_process.execFile` with explicit argument arrays instead of `child_process.exec` with shell-interpolated command strings. `execFile` does not invoke a shell, so there are no shell quoting issues or path separator problems.

**When to use:** Running external binaries (git, node, etc.) from TypeScript code.

**Trade-offs:** Cannot use shell built-ins (pipes, redirection) — which is appropriate for clean code anyway.

**Example:**
```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// WRONG — exec() uses shell, path quoting brittle on Windows
const { stdout } = await execAsync(`git log --follow -- "${skillPath}"`);

// CORRECT — execFile avoids shell quoting entirely
const { stdout } = await execFileAsync('git', ['log', '--follow', '--', skillPath], {
  cwd: this.workDir,
  encoding: 'utf8',
});
```

**Specific violation found:** `src/learning/version-manager.ts` uses `exec()` with template string interpolation for all git commands. This is the primary shell-exec risk.

### Pattern 4: Platform Guard for POSIX Signals

**What:** SIGTERM and SIGKILL are POSIX signals not available on Windows. Code that sends these signals to child processes must guard with `process.platform !== 'win32'` or use `child.kill()` without arguments (which sends a platform-appropriate signal).

**When to use:** Any code that uses `child.kill('SIGTERM')` or `child.kill('SIGKILL')`.

**Trade-offs:** Graceful shutdown behavior differs on Windows (no escalation to SIGKILL via signal name).

**Example:**
```typescript
// FRAGILE — SIGKILL is not available on Windows
child.kill('SIGKILL');

// CORRECT — platform-aware escalation
if (process.platform === 'win32') {
  child.kill(); // sends SIGTERM on all platforms, or terminates on Windows
} else {
  child.kill('SIGKILL');
}
```

**Specific location:** `src/terminal/launcher.ts` — `shutdownWetty()` function. Note: Wetty is a terminal server that likely has no use case on Windows anyway. This may be out-of-scope per PROJECT.md constraints, but the code should not crash when imported on Windows.

### Pattern 5: Shell Script Execution in Tests

**What:** The console test files (`src/console/*.test.ts`) directly call `.sh` bash scripts via `execFile(scriptPath)`. On Windows with Git Bash, `execFile` does NOT invoke a shell — it executes the file directly. Bash scripts are not native Windows executables and will fail with ENOENT or permission errors.

**When to use:** Applies whenever TypeScript tests invoke `.sh` scripts.

**The fix options (in priority order):**
1. **Replace bash scripts with Node.js scripts** (preferred) — align with PROJECT.md constraint of no new dependencies, maximum portability.
2. **Invoke via `bash` explicitly** — `execFile('bash', [scriptPath, ...args])` requires bash on PATH.
3. **Skip on Windows with `vi.skipIf(process.platform === 'win32')`** — acceptable only if the scripts have no Windows use case.

**Example (option 1 — preferred):**
```typescript
// Instead of execFile(scriptPath, [basePath])
// Replace check-inbox.sh with check-inbox.ts (Node.js)
// Then test the Node.js module directly — no shell needed
```

**Example (option 2 — fallback):**
```typescript
// Current (fails on Windows):
execFile(scriptPath, [basePath], ...)

// Fixed (works if bash is on PATH):
execFile('bash', [scriptPath, basePath], ...)
```

---

## Data Flow: Path Construction Through the System

```
User invokes: skill-creator create my-skill
        ↓
src/cli.ts: parses args, calls parseScope()
        ↓
src/types/scope.ts: getSkillsBasePath('user')
  → join(homedir(), '.claude', 'skills')   ← CORRECT (already uses path.join + homedir)
        ↓
src/workflows/create-skill-workflow.ts: constructs skill dir path
  → join(basePath, skillName)              ← audit for string concat
        ↓
src/storage/skill-store.ts: reads/writes SKILL.md
  → join(this.skillsDir, skillName, 'SKILL.md')  ← audit for template strings
        ↓
fs/promises: writeFile(resolvedPath, content, 'utf-8')
  → Node.js handles OS-level path translation
```

**Key insight:** The path is correct from `scope.ts` onward — it uses `homedir()` and `join()`. The risk is in intermediate files that receive the base path and do further string concatenation instead of using `join()`.

---

## Fix Order (Dependency-Driven)

Fix order is determined by dependency depth: fix foundational path construction before derived usages.

### Phase 1: Storage Layer (Highest Impact, No Dependencies Upstream)

**Files to fix:**
- `src/storage/skill-store.ts` — audit all path construction
- `src/storage/skill-index.ts` — audit cache path construction
- `src/storage/pattern-store.ts` — audit JSONL path construction
- `src/learning/version-manager.ts` — replace `exec()` + template strings with `execFile()` + arg arrays

**Why first:** All other layers depend on storage. Fix here propagates correctly through consumers. Also the highest likelihood of actual bugs: `version-manager.ts` has confirmed template-string path interpolation in shell commands.

### Phase 2: CLI and Command Handlers

**Files to fix:**
- `src/cli.ts` — audit for hardcoded path strings (low risk — mostly delegates to scope.ts)
- `src/cli/commands/*.ts` — audit for direct path construction
- `src/agents/agent-generator.ts` — uses `'.claude/agents'` as default (relative path, fine for project scope)
- `src/portability/platform-adapter.ts` — verify tilde strings are not passed to `fs` operations

**Why second:** Commands depend on storage. Once storage is verified correct, command-level path handling is the next risk surface.

### Phase 3: Scripts and Tests

**Files to fix:**
- `src/console/*.test.ts` — replace `execFile(scriptPath)` with `execFile('bash', [scriptPath])` or replace `.sh` with Node.js
- `scripts/console/*.sh` — assess whether Node.js replacement is viable (preferred)
- `tests/test-gsd-stack.sh` — assess scope and platform requirements

**Why last:** Tests can be fixed independently without breaking production code. Shell script replacement is higher risk (behavior change) and needs verification.

### Phase 4: Signal Handling

**Files to fix:**
- `src/terminal/launcher.ts` — guard SIGKILL with platform check

**Why last:** Terminal/Wetty integration is likely unused on Windows. This is a correctness fix to prevent import-time errors, not a critical user path.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Creating a Platform Abstraction Module

**What people do:** Create `src/platform/paths.ts` with `joinPath()`, `homePath()`, etc.
**Why it's wrong:** Node.js already provides `path.join()` and `os.homedir()`. An extra abstraction layer is indirection without value and creates drift when Node.js APIs evolve.
**Do this instead:** Import `join`, `resolve`, `homedir` directly from `node:path` and `node:os`.

### Anti-Pattern 2: Using `exec()` with Template String Paths

**What people do:** `exec(\`git show ${hash}:"${skillPath}"\`)` — shell interpolation of paths.
**Why it's wrong:** On Windows, paths may contain backslashes that shell-interpret as escape characters. Quote handling differs between shells. Git Bash uses a different quoting model than cmd.exe.
**Do this instead:** `execFile('git', ['show', `${hash}:${skillPath}`])` — pass path as argument, not in shell string.

### Anti-Pattern 3: Platform Detection as a Primary Strategy

**What people do:** `if (process.platform === 'win32') { ... } else { ... }` everywhere.
**Why it's wrong:** Duplicates logic, diverges over time, and misses the real fix. Most path issues are solvable with the correct Node.js API, not with platform branching.
**Do this instead:** Fix the root cause (use `path.join`, `os.homedir`). Reserve `process.platform` for genuinely irreconcilable differences (e.g., POSIX signals in `terminal/launcher.ts`).

### Anti-Pattern 4: Hardcoded Forward Slashes in Path Construction

**What people do:** `` `${basePath}/${skillName}/SKILL.md` ``
**Why it's wrong:** Forward slashes work on Windows for **most** Node.js fs operations, but `path.sep` returns `\` on Windows, so code that compares or splits paths using `/` breaks.
**Do this instead:** `join(basePath, skillName, 'SKILL.md')` — let Node.js handle the separator.

---

## Integration Points

### External Services

| Service | Integration Pattern | Windows Notes |
|---------|---------------------|---------------|
| Git | `execFile('git', args)` — already used in `git-collector.ts` | Safe — `git` is on PATH when Git Bash is installed |
| Git (version-manager) | `exec(\`git ...\`)` — shell interpolation | **Needs fix** — replace with `execFile` |
| Wetty terminal server | `spawn('wetty', args)` | Not relevant on Windows; guard SIGKILL signals |
| Bash scripts (`scripts/console/*.sh`) | `execFile(scriptPath)` from tests | **Needs fix** — explicit `bash` invocation or Node.js replacement |
| Hugging Face Transformers | npm package — pure JS | No Windows issues |

### Internal Boundaries

| Boundary | Communication | Windows Concern |
|----------|---------------|-----------------|
| `scope.ts` → `skill-store.ts` | Pass base path string | Scope already correct; store must use `join()` for further construction |
| `cli.ts` → `skill-store.ts` | Pass skill name and paths | Audit that names aren't combined with `/` in CLI layer |
| `version-manager.ts` → git | Shell exec | Replace with `execFile` |
| Tests → `scripts/console/*.sh` | `execFile(scriptPath)` | Needs bash resolution on Windows |

---

## Scaling Considerations

This is a CLI tool with a single user. Scaling is irrelevant. The only "scale" concern is correctness across environments:

| Environment | Architecture Adjustment |
|-------------|------------------------|
| Windows/Git Bash (target) | All fixes in this milestone address this |
| macOS/Linux (existing) | All fixes must be backwards-compatible — `path.join()` and `homedir()` work identically |
| CI/CD (future) | Tests that skip on Windows may need `vi.skipIf` until bash scripts are replaced |

---

## Confidence Assessment

| Area | Confidence | Source |
|------|------------|--------|
| Path API guidance (`path.join` over string concat) | HIGH | Node.js official docs + cross-platform guide |
| `os.homedir()` for home resolution | HIGH | Node.js official docs |
| `execFile` over `exec` for external binaries | HIGH | Node.js docs + community consensus |
| Shell script test failure on Windows | HIGH | Node.js `execFile` documented behavior (no shell invocation) |
| POSIX signals on Windows | HIGH | Node.js docs: SIGKILL not available on Windows |
| Tilde strings in `platform-adapter.ts` — whether used at runtime | MEDIUM | Code inspection shows they appear to be label-only, but full tracing needed |

---

## Sources

- Node.js child_process documentation: https://nodejs.org/api/child_process.html
- Cross-platform Node.js guide: https://github.com/ehmicky/cross-platform-node-guide/blob/main/docs/3_filesystem/file_paths.md
- Alan Norbauer: Cross-platform Node.js patterns: https://alan.norbauer.com/articles/cross-platform-nodejs/
- Node.js path module: https://nodejs.org/api/path.html
- Node.js os.homedir(): https://nodejs.org/api/os.html#oshomedir

---

*Architecture research for: gsd-skill-creator Windows compatibility*
*Researched: 2026-02-22*
