# Stack Research

**Domain:** Node.js/TypeScript CLI tool — Windows/Git Bash cross-platform compatibility
**Researched:** 2026-02-22
**Confidence:** HIGH (core APIs), MEDIUM (tooling nuances), LOW (process group signal behavior)

---

## Context

This is not a greenfield stack choice. The project already uses: Node.js 20+, TypeScript 5.3, ESM (`"type": "module"`), `tsx` for dev execution, `vitest` for testing, and `npm` for package management. The goal is to identify what additions, corrections, and patterns are required to make the **existing** stack work reliably on Windows/Git Bash (MINGW64) — without breaking Linux/macOS behavior.

---

## Recommended Stack (Compatibility Layer Only)

Per the project constraint, no new runtime dependencies are added. What follows are the correct API usages, dev-tool additions, and configuration changes needed.

### Core Node.js APIs — Use These, Not String Manipulation

| API | Version | Purpose | Why Recommended |
|-----|---------|---------|-----------------|
| `path.join(...segments)` | Node.js 20+ built-in | Join path segments safely | Outputs platform-correct separator; already used in ~45 files, but must be used *everywhere* — no string concatenation with `/` |
| `path.resolve(...segments)` | Node.js 20+ built-in | Resolve to absolute path | Handles drive letters on Windows; required when calling Node.js APIs that expect absolute paths |
| `os.homedir()` | Node.js 20+ built-in | Get user home directory | On Windows reads `%USERPROFILE%`; already used correctly in codebase (14+ files) — continue this pattern |
| `os.tmpdir()` | Node.js 20+ built-in | Get temp directory | Cross-platform; returns `C:\Users\...\AppData\Local\Temp` on Windows — already used in executor |
| `import.meta.dirname` | Node.js 20.11+ | ESM equivalent of `__dirname` | Available since Node 20.11 (project requires 20+); already used via `fileURLToPath(import.meta.url)` pattern — can use either, but `import.meta.dirname` is cleaner |
| `fileURLToPath(import.meta.url)` | Node.js 20+ + `node:url` | Convert `file://` URL to OS path | Required when constructing paths from ESM import URLs on Windows — `import.meta.url` gives `file:///C:/...`, direct `.pathname` FAILS on Windows due to drive letter prefix |
| `path.posix.join(...)` | Node.js 20+ built-in | Force forward slashes | Use ONLY for values embedded in YAML/JSON/Markdown that humans read — NOT for file system operations |

**Critical finding from codebase audit:** The existing code mostly uses `os.homedir()` + `path.join()` correctly. The known risk areas are:

1. `src/workflows/create-skill-workflow.ts` — outputs hardcoded `~/.claude/...` path strings in human-readable output (acceptable for display, not acceptable as actual fs paths)
2. `src/chipset/blitter/executor.ts` — calls `chmod()` and uses `detached: true` with process group kill via `process.kill(-pid, 'SIGTERM')` — both are POSIX-only behaviors that silently fail on Windows
3. `src/cli/commands/terminal.ts` — uses `chmodSync()`, `detached: true`, UNIX-specific signal handling, and `.local/share/wetty` path — deeply POSIX-specific
4. `src/dashboard/collectors/git-collector.ts` — calls `execFile('git', ...)` which works on Windows if git is in PATH (Git Bash puts it there), but must not use `shell: true`

### Dev-Only Tools to Add

| Tool | Version | Purpose | Why |
|------|---------|---------|-----|
| `cross-env` | `^7.0.3` | Cross-platform env var setting in npm scripts | `NODE_ENV=test vitest` syntax fails in cmd.exe; since target is Git Bash this is lower priority, but `cross-env` ensures it works even when npm scripts are invoked from Windows native terminals |
| `shx` | `^0.3.4` | Cross-platform shell commands in npm scripts | Replaces `rm -rf`, `mkdir -p`, `cp` in package.json scripts with portable equivalents; current scripts are clean but any future additions should use shx |

**Installation (dev dependencies only):**
```bash
npm install -D cross-env shx
```

**Note:** The project constraint says "no new dependencies." These are dev-only and directly address npm script portability. The alternative is rewriting any shell commands as `node -e "fs.rmSync(...)"` inline — also acceptable. If the constraint is strict, use the `node --eval` approach instead.

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `chmod()` / `chmodSync()` for executable bits | `chmod` is a no-op on Windows; the Windows filesystem does not use Unix permission bits; code at `src/chipset/blitter/executor.ts:55` and `src/storage/skill-store.ts:365` will silently succeed but have no effect — tests may pass but behavior differs | Wrap in `if (process.platform !== 'win32')` guard; on Windows, files are executable by association (`.exe`, `.bat`, `.cmd`) not by permission bits |
| `process.kill(-pid, 'SIGTERM')` (negative PID = process group) | Windows does not support process groups; `process.kill(-pid, signal)` throws `ESRCH` or silently fails on Windows | Use `child.kill('SIGTERM')` to kill the process directly; for group kill, use the `taskkill /F /T /PID <pid>` approach with a platform check |
| `detached: true` in `spawn()` for process-group isolation | `detached: true` behavior differs on Windows — it creates an independent console, not a process group | Fine to keep for the terminal/wetty use case (which is Linux-only anyway), but must be guarded; for the blitter executor, remove `detached: true` and kill child directly |
| Hardcoded `~` in paths passed to `fs` APIs | `~` is a shell expansion, not a Node.js concept; `fs.readFile('~/file')` fails on all platforms including Linux — it's the shell that expands it | Always use `path.join(os.homedir(), ...)` for actual fs operations; `~` strings are only valid as display values |
| `import.meta.url` `.pathname` directly on Windows | `new URL('.', import.meta.url).pathname` returns `/C:/Users/...` on Windows — the leading `/` before the drive letter is invalid as a Windows path | Always use `fileURLToPath(new URL('.', import.meta.url))` or `import.meta.dirname` (Node 20.11+) |
| `bash -c "..."` in `spawn()` or `exec()` | `bash` is not guaranteed to be in PATH on Windows native; even with Git Bash, spawning from a Node.js process may not have Git Bash's PATH | Use `spawn('node', ['-e', '...'])` for simple cross-platform tasks; for bash scripts in the blitter, explicitly set `shell: '/bin/bash'` only with a platform guard |
| `SIGKILL` via `process.kill(pid, 'SIGKILL')` | `SIGKILL` is not available on Windows — throws `Error: kill SIGKILL` | Use `child.kill()` without signal argument (defaults to safe termination) or catch and ignore the error on Windows |
| String concatenation for paths: `dir + '/' + file` | Produces broken paths on Windows where `\` is expected; also fails if `dir` ends in `\` (double separator) | `path.join(dir, file)` always |
| `python3` as interpreter in blitter | Python 3 executable is `python` on Windows (not `python3`); `python3` command not found errors are common | Use `process.platform === 'win32' ? 'python' : 'python3'`; or better, skip Python scripts in the blitter on Windows with a clear error message |

---

## Stack Patterns by Scenario

**If executing shell scripts in the blitter executor (`src/chipset/blitter/executor.ts`):**

```typescript
// WRONG — breaks on Windows
const child = spawn(command, args, {
  detached: true,       // Process group behavior undefined on Windows
  stdio: ['ignore', 'pipe', 'pipe'],
});
process.kill(-child.pid, 'SIGTERM');  // Negative PID = POSIX process group only

// CORRECT — cross-platform
const isWindows = process.platform === 'win32';
const child = spawn(command, args, {
  detached: !isWindows,   // Only detach on POSIX
  stdio: ['ignore', 'pipe', 'pipe'],
});

// Kill: try process group on POSIX, fall back to direct kill
function killChild(child: ChildProcess): void {
  if (!isWindows && child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
      return;
    } catch { /* fall through */ }
  }
  child.kill('SIGTERM');
}
```

**If setting file permissions (`chmod`):**

```typescript
// WRONG — silently does nothing on Windows
await chmod(scriptPath, 0o755);

// CORRECT — guarded
if (process.platform !== 'win32') {
  await chmod(scriptPath, 0o755);
}
// On Windows: file executability is determined by extension (.bat, .cmd, .exe)
// .sh files will never be directly executable on Windows anyway
```

**If constructing `__dirname` equivalent in ESM:**

```typescript
// Pattern 1: Node 20.11+ (preferred — project requires Node 20+)
const dir = import.meta.dirname;  // string, no import needed

// Pattern 2: Broader compatibility (already used in codebase)
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));

// WRONG — breaks on Windows
const __dirname = new URL('.', import.meta.url).pathname;
// Returns "/C:/Users/..." — leading slash before drive letter is invalid
```

**If running npm scripts that need env vars:**

```json
// package.json — current scripts are safe (no env var assignment)
// If adding env-var scripts in future:
{
  "scripts": {
    "test:ci": "cross-env NODE_ENV=test vitest run",
    "clean": "shx rm -rf dist"
  }
}
```

**If spawning git in code:**

```typescript
// execFile works on Windows because git.exe is in PATH via Git Bash
// Do NOT use shell: true — it invokes cmd.exe on Windows, not bash
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

// CORRECT — already done in git-collector.ts
const { stdout } = await execFileAsync('git', ['log', '--format=...']);

// WRONG — shell: true uses cmd.exe on Windows
const { stdout } = await execFileAsync('git', ['log'], { shell: true });
```

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `tsx@4.21.0` | Node.js 20+, Windows | tsx works on Windows; it invokes `node` with transform hooks — no shell dependency |
| `vitest@4.0.18` | Node.js 20+, Windows | Vitest works on Windows; documented issue with path separator in VSCode debugger runner args (not test execution itself) |
| `@huggingface/transformers@3.8.1` | Node.js 20+, Windows | ONNX runtime downloads platform-specific binary; works on Windows x64; first-run download path uses `os.homedir()` — verify `~/.cache` path construction |
| `modern-tar@0.7.3` | Node.js 20+, Windows | Pure JS tar implementation — no native binaries, cross-platform safe |
| `gray-matter@4.0.3` | Node.js 20+, Windows | Pure JS YAML/frontmatter parser — cross-platform safe; CRLF in input files is handled by JS-YAML's parser (LF-only assumption in regexes could bite if files have CRLF) |
| `js-yaml@4.1.1` | Node.js 20+, Windows | Pure JS — cross-platform safe; reads whatever string is passed; CRLF is safe for YAML block scalars but can cause issues in literal block chomping |

---

## CRLF / Line Ending Strategy

**Problem:** Git on Windows with `core.autocrlf=true` (common default) converts LF to CRLF on checkout. This causes:
- YAML block scalars parsed from files to contain `\r\n` — trailing `\r` appears in extracted strings
- Test fixture comparisons to fail if fixtures were committed with LF but checked out with CRLF
- Regex patterns like `/\n/` to miss line splits in CRLF content

**Solution — `.gitattributes` (HIGH confidence):**

```gitattributes
# Force LF everywhere in the repo — never CRLF
* text=auto eol=lf

# Binary files — no conversion
*.png binary
*.jpg binary
*.onnx binary
*.wasm binary
```

**After adding `.gitattributes`:** Run `git add --renormalize .` to normalize all tracked files. This is a one-time operation per developer workspace.

**Code-level defense:** When reading file content that will be parsed or compared, normalize line endings:

```typescript
// Normalize before YAML/JSON parse or string comparison
const normalized = content.replace(/\r\n/g, '\n');
```

This is especially important in `src/storage/skill-store.ts` (reads YAML frontmatter from .md files) and test fixtures.

---

## Testing Strategy for Windows Compatibility

### Unit Test Pattern — Platform-Agnostic Path Assertions

```typescript
// WRONG — hardcodes Unix path separator in assertion
expect(result.path).toBe('/tmp/skill-store-test/skills/my-skill');

// CORRECT — use path.join so assertion matches platform output
import { join } from 'node:path';
import { tmpdir } from 'node:os';
expect(result.path).toBe(join(tmpdir(), 'skill-store-test', 'skills', 'my-skill'));
```

### Testing Cross-Platform Path Logic — Dependency Injection

Node.js `path.sep` and `path.join` are read-only and platform-locked. To test Windows path handling on Linux (or vice versa), inject the path module:

```typescript
// Production code — accept path module as dependency
export function resolveSkillPath(
  skillName: string,
  baseDir: string,
  pathModule = path  // default to platform path
): string {
  return pathModule.join(baseDir, skillName, 'SKILL.md');
}

// Test — override with path.win32 to test Windows behavior on Linux
import { win32 } from 'node:path';
const windowsPath = resolveSkillPath('my-skill', 'C:\\Users\\test\\.claude', win32);
expect(windowsPath).toBe('C:\\Users\\test\\.claude\\my-skill\\SKILL.md');
```

### CI Matrix Recommendation (MEDIUM confidence)

Add Windows to the vitest CI run matrix. The most practical approach with GitHub Actions:

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, windows-latest]
    node: ['20.x', '22.x']
runs-on: ${{ matrix.os }}
```

Running vitest on `windows-latest` in CI catches path separator assumptions, CRLF issues, and `chmod`/signal behavior differences before they reach users.

### What vitest Does NOT Catch on Windows

Vitest runs unit tests in the Node.js process — it does not catch:
- Shell script execution failures in `blitter/executor.ts` (spawned processes)
- Wetty terminal behavior in `cli/commands/terminal.ts` (Linux-only feature by design)
- Signal handling differences for process group kill (`process.kill(-pid, 'SIGTERM')`)

These require integration tests with actual child process spawning, or explicit platform guards that make the Windows code path skip the unsupported operation.

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Path construction | `path.join()` built-in | `upath` library (always forward slash) | `upath` adds a dependency; `path.join()` is correct for fs operations; only use `path.posix.join()` for the rare case where forward-slash output is needed in stored strings |
| Shell commands in npm scripts | `shx` dev dependency | `node --eval` inline | `node --eval` is zero-dependency but verbose for multi-step operations; both are acceptable; shx is cleaner for readability |
| Home directory resolution | `os.homedir()` | `process.env.HOME \|\| process.env.USERPROFILE` | `os.homedir()` is the correct Node.js API; manual env-var fallback is what `os.homedir()` does internally — no benefit to reimplementing |
| Process group kill | Platform-guarded `process.kill(-pid)` | `tree-kill` npm package | `tree-kill` is well-maintained and handles cross-platform process tree killing elegantly; but given the "no new dependencies" constraint, the platform guard approach is correct |
| Line ending normalization | `.gitattributes` `eol=lf` | `cross` / `crlf` npm packages | Git-level normalization is the right layer; npm packages that normalize CRLF add complexity and miss files read outside the project |

---

## Sources

- Node.js official path documentation — `path.join`, `path.posix`, `path.win32`, `path.sep` behavior (HIGH confidence): https://nodejs.org/api/path.html
- Node.js ESM modules documentation — `import.meta.url`, `import.meta.dirname` (Node 20.11+) (HIGH confidence): https://nodejs.org/api/esm.html
- Node.js os.homedir() — Windows USERPROFILE behavior (HIGH confidence): https://nodejs.org/api/os.html
- GitHub issue: `new URL('.', import.meta.url).pathname` Windows path bug (HIGH confidence): https://github.com/nodejs/node/issues/37845
- Alan Norbauer, Cross-Platform Node.js — `.gitattributes eol=lf`, avoid shell scripts, use `node.exe` explicitly (MEDIUM confidence): https://alan.norbauer.com/articles/cross-platform-nodejs/
- kentcdodds/cross-env — cross-platform env var setting in npm scripts (HIGH confidence): https://github.com/kentcdodds/cross-env
- shelljs/shx — portable shell commands for npm scripts (HIGH confidence): https://github.com/shelljs/shx
- Vitest Windows path separator issue (runner args, not test execution): https://github.com/vitest-dev/vitest/issues/693
- Node.js child_process Windows shell behavior — cmd.exe vs bash (HIGH confidence): https://nodejs.org/api/child_process.html
- Blog: Mocking Node.js path separators via dependency injection (MEDIUM confidence): https://blog.shukebeta.com/2025/08/17/mocking-nodejs-path-separators-the-dependency-injection-solution
- CRLF/LF line ending management with .gitattributes (HIGH confidence): https://git-scm.com/docs/gitattributes

---

*Stack research for: Node.js/TypeScript CLI tool Windows/Git Bash cross-platform compatibility*
*Researched: 2026-02-22*
