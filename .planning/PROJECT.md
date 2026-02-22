# gsd-skill-creator — Windows Compatibility

## What This Is

An adaptive learning coprocessor for Claude Code that observes patterns, generates reusable skills, and manages multi-agent coordination. This milestone focuses on making the entire project work reliably on Windows with Git Bash — the primary environment for Claude Code users on Windows.

## Core Value

Every file path operation, shell command, and platform-dependent behavior works correctly on Windows/Git Bash without breaking Linux or macOS.

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

### Active

- [ ] All file path operations use platform-agnostic path handling (path.join, path.resolve, path.sep)
- [ ] Shell commands in scripts and CLI work on Git Bash
- [ ] Tests pass on Windows/Git Bash environment
- [ ] No hardcoded Unix paths (forward-slash-only assumptions)
- [ ] Home directory resolution works on Windows (~, %USERPROFILE%, $HOME)
- [ ] File permissions handled gracefully (no chmod assumptions)
- [ ] Line ending handling (CRLF vs LF) doesn't break YAML/JSON parsing
- [ ] npm scripts in package.json work on Windows

### Out of Scope

- cmd.exe or PowerShell support — Claude Code uses Git Bash on Windows
- WSL support — different environment entirely
- Performance optimization — separate concern
- New features — this is a compatibility pass only

## Context

- The project was developed primarily on Unix-like systems
- Target environment: Windows 10/11 with Git Bash (MINGW64), as used by Claude Code
- Node.js 20+ on Windows handles most path normalization, but explicit path construction in code may use Unix assumptions
- Key risk areas: file operations in `src/storage/`, path construction in `src/cli/`, shell exec in scripts/
- The codebase uses ESM modules which work fine on Windows Node.js

## Constraints

- **Backwards compatible**: Changes must not break Linux/macOS behavior
- **Minimal changes**: Use Node.js path APIs rather than custom abstractions
- **No new dependencies**: Use built-in Node.js `path`, `os`, `fs` modules
- **Test coverage**: All fixes must have corresponding test verification

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Target Git Bash only (not cmd/PowerShell) | Claude Code on Windows uses Git Bash exclusively | — Pending |
| Use path.join/resolve instead of string concatenation | Node.js built-in handles platform differences | — Pending |
| No custom path abstraction layer | Over-engineering for what Node.js already provides | — Pending |

---
*Last updated: 2026-02-22 after initialization*
