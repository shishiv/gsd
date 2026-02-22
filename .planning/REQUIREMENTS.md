# Requirements: gsd-skill-creator Windows Compatibility

**Defined:** 2026-02-22
**Core Value:** Every file path operation, shell command, and platform-dependent behavior works correctly on Windows/Git Bash

## v1 Requirements

### Repository Configuration

- [x] **REPO-01**: Repository has `.gitattributes` with `eol=lf` for all text files to prevent CRLF corruption on Windows clones

### Path Handling

- [ ] **PATH-01**: Storage layer uses `path.join()` instead of string concatenation for all file path construction
- [ ] **PATH-02**: `version-manager.ts` uses `path.join()` and `execFile()` instead of template-string paths inside `exec()`
- [ ] **PATH-03**: Hardcoded forward-slash path defaults in `src/safety/` and `src/validation/` replaced with `path.join()` equivalents
- [ ] **PATH-04**: Home directory resolution uses `os.homedir()` consistently with no tilde-string assumptions passed to fs operations
- [ ] **PATH-05**: All `import.meta.url` usage correctly wrapped with `fileURLToPath()` (no raw `.pathname` access)

### Process and Signal Handling

- [ ] **PROC-01**: `process.kill(-child.pid)` in `executor.ts` guarded with `process.platform !== 'win32'` check with Windows-safe alternative
- [ ] **PROC-02**: `chmod()` calls wrapped in try/catch or platform guard across all 6 files that use them
- [ ] **PROC-03**: SIGKILL usage in `launcher.ts` guarded with platform check and Windows-safe fallback

## v2 Requirements

### Test Infrastructure

- **TEST-01**: `execFile(scriptPath)` for `.sh` scripts replaced with `spawn('bash', [scriptPath])` in test files
- **TEST-02**: Path separator expectations in test assertions are platform-agnostic
- **TEST-03**: Windows CI matrix entry added to GitHub Actions

### Repository Configuration

- **REPO-02**: Existing files normalized (re-checkout) after `.gitattributes` added

## Out of Scope

| Feature | Reason |
|---------|--------|
| cmd.exe / PowerShell support | Claude Code uses Git Bash exclusively on Windows |
| WSL support | Different environment entirely |
| Custom path abstraction layer | Over-engineering; Node.js built-ins are sufficient |
| Rewriting bash scripts in TypeScript | Unnecessary; explicit bash invocation is simpler |
| `cross-env` / `shelljs` dependencies | No new runtime deps; use Node.js built-ins |
| Performance optimization | Separate concern from compatibility |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REPO-01 | Phase 1 | Complete |
| PATH-01 | Phase 2 | Pending |
| PATH-02 | Phase 2 | Pending |
| PATH-03 | Phase 2 | Pending |
| PATH-04 | Phase 2 | Pending |
| PATH-05 | Phase 2 | Pending |
| PROC-01 | Phase 3 | Pending |
| PROC-02 | Phase 3 | Pending |
| PROC-03 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 9 total
- Mapped to phases: 9
- Unmapped: 0

---
*Requirements defined: 2026-02-22*
*Last updated: 2026-02-22 after roadmap creation*
