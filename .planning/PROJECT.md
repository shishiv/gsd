# gsd-skill-creator — Windows Compatibility

## What This Is

An adaptive learning coprocessor for Claude Code that observes patterns, generates reusable skills, and manages multi-agent coordination. Now Windows-compatible — all core path, process, and file operations work correctly on Windows with Git Bash.

## Core Value

Every file path operation, shell command, and platform-dependent behavior works correctly on Windows/Git Bash without breaking Linux or macOS.

## Current State

Shipped v1.0 Windows Compatibility (2026-02-22). The codebase is cross-platform across the storage, safety, CLI, and process layers. TypeScript/ESM with Node.js 20+.

**What shipped in v1.0:**
- LF line-ending enforcement via `.gitattributes` (1197 files normalized)
- `path.join()` migration across storage/safety constructors (5 defaults fixed)
- `exec()` → `execFile()` in version-manager (shell injection eliminated)
- Platform guards on `process.kill(-pid)` and all `chmod` calls (4 production files)
- SIGKILL documentation in launcher.ts (cross-platform behavior documented)

**Known tech debt:**
- 3 residual forward-slash strings in `skill-index.ts`, `migrate.ts`, `cli.ts` (functional on Windows, style-inconsistent)
- Pre-existing executor timeout test failures on Windows (bash/sleep not terminated within 500ms)

## Requirements

### Validated

- ✓ Multi-stage skill application pipeline — existing
- ✓ Embedding-based skill activation with semantic similarity — existing
- ✓ CLI interface for skill management (create, test, status, suggest) — existing
- ✓ Bounded learning with refinement guardrails — existing
- ✓ MCP server for tool exposure — existing
- ✓ Team coordination (copper/blitter/exec model) — existing
- ✓ Pattern detection and observation pipeline — existing
- ✓ Bundle/portability system — existing
- ✓ Dashboard visualization — existing
- ✓ LF line endings on Windows clones — v1.0
- ✓ Platform-agnostic path handling in storage/safety layers — v1.0
- ✓ Shell-safe git execution via execFile() — v1.0
- ✓ Home directory resolution via os.homedir() — v1.0
- ✓ import.meta.url wrapped with fileURLToPath() — v1.0
- ✓ Process group kill guarded on Windows — v1.0
- ✓ chmod calls platform-guarded — v1.0
- ✓ SIGKILL usage documented as Windows-safe — v1.0

### Active

(None — next milestone requirements TBD via `/gsd:new-milestone`)

### Out of Scope

- cmd.exe or PowerShell support — Claude Code uses Git Bash on Windows
- WSL support — different environment entirely
- Performance optimization — separate concern
- Custom path abstraction layer — Node.js built-ins are sufficient
- Rewriting bash scripts in TypeScript — explicit bash invocation is simpler

## Context

- TypeScript/ESM project, Node.js 20+
- Target environment: Windows 10/11 with Git Bash (MINGW64), Linux, macOS
- Cross-platform path handling via `path.join()`, `os.homedir()`, `fileURLToPath()`
- Git operations via `execFile()` with argv arrays (no shell interpolation)
- Process management: platform-guarded negative-PID kills, chmod skips on NTFS

## Constraints

- **Backwards compatible**: Changes must not break Linux/macOS behavior
- **Minimal changes**: Use Node.js path APIs rather than custom abstractions
- **No new dependencies**: Use built-in Node.js `path`, `os`, `fs` modules
- **Test coverage**: All fixes must have corresponding test verification

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Target Git Bash only (not cmd/PowerShell) | Claude Code on Windows uses Git Bash exclusively | ✓ Good — focused scope, all fixes work in Git Bash |
| Use path.join/resolve instead of string concatenation | Node.js built-in handles platform differences | ✓ Good — clean pattern, no new deps |
| No custom path abstraction layer | Over-engineering for what Node.js already provides | ✓ Good — kept changes surgical |
| Use eol=lf not text=auto alone | text=auto alone checks out CRLF on Windows | ✓ Good — forces LF on all platforms |
| exec() → execFile() for git calls | exec() routes through cmd.exe on Windows | ✓ Good — eliminates shell interpolation risk |
| Platform guard pattern (not removal) for process.kill(-pid) | Preserves Unix process group semantics via detached:true | ✓ Good — both platforms handled correctly |
| Skip chmod on Windows explicitly (not rely on no-op) | Makes intent clear even though chmod silently succeeds on NTFS | ✓ Good — code documents behavior |

---
*Last updated: 2026-02-22 after v1.0 milestone*
