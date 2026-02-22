# Roadmap: gsd-skill-creator Windows Compatibility

## Overview

A surgical compatibility pass on an existing TypeScript CLI tool. Three phases ordered by dependency: repository line-ending hygiene must land first (prevents CRLF corruption from masking all downstream bugs), then path construction is audited across the storage, safety, and CLI layers, then process signal handling is guarded for Windows. Every phase is independently verifiable against a real Windows/Git Bash environment.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Repository Foundations** - Add `.gitattributes` to prevent CRLF corruption on Windows clones
- [ ] **Phase 2: Path Construction Audit** - Replace all Unix-assumption path code with `path.join`/`os.homedir` across storage, safety, and CLI layers
- [ ] **Phase 3: Process and Signal Guards** - Add platform guards around process group kills and `chmod` calls

## Phase Details

### Phase 1: Repository Foundations
**Goal**: Windows clones receive LF line endings for all files, preventing CRLF corruption in YAML, JSON, and shell scripts before any code work begins
**Depends on**: Nothing (first phase)
**Requirements**: REPO-01
**Success Criteria** (what must be TRUE):
  1. After a fresh Windows clone, YAML skill files parse without trailing `\r` characters in string values
  2. Shell scripts in `scripts/` are executable in Git Bash without `\r: command not found` errors
  3. Vitest snapshot files are stable across Linux and Windows (no spurious CRLF diffs on re-run)
**Plans:** 1 plan
Plans:
- [ ] 01-01-PLAN.md — Create .gitattributes with LF enforcement and renormalize all tracked files

### Phase 2: Path Construction Audit
**Goal**: All file path construction across the storage, safety, and CLI layers uses `path.join()`/`path.resolve()` and `os.homedir()`, with no Unix-only string assumptions reaching `fs` APIs
**Depends on**: Phase 1
**Requirements**: PATH-01, PATH-02, PATH-03, PATH-04, PATH-05
**Success Criteria** (what must be TRUE):
  1. Running `skill-creator status` on Windows resolves skill directories correctly under the user's actual Windows home path
  2. `skill-creator create` writes skill files to the correct `~/.claude/` location on Windows without path construction errors
  3. `version-manager.ts` executes git commands via `execFile()` with no shell interpolation of path strings
  4. `src/safety/` path comparisons against `assertSafePath` resolve identically on Windows (backslash) and Linux (forward slash)
  5. `import.meta.url` usages resolve to correct file paths on Windows without mangled drive letter prefixes
**Plans**: TBD

### Phase 3: Process and Signal Guards
**Goal**: Child process cleanup and file permission code handles Windows gracefully — no orphaned processes on timeout, no silent NTFS `chmod` failures
**Depends on**: Phase 2
**Requirements**: PROC-01, PROC-02, PROC-03
**Success Criteria** (what must be TRUE):
  1. When the executor times out a child process on Windows, the child process terminates (not orphaned in Task Manager)
  2. `chmod` calls in skill generation and storage do not throw on Windows NTFS volumes
  3. Importing `src/terminal/launcher.ts` on Windows does not throw due to SIGKILL usage
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Repository Foundations | 0/1 | Not started | - |
| 2. Path Construction Audit | 0/TBD | Not started | - |
| 3. Process and Signal Guards | 0/TBD | Not started | - |
