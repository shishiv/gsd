# Phase 2: Path Construction Audit - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace all Unix-assumption path code with cross-platform `path.join()`/`path.resolve()` and `os.homedir()` across the storage, safety, and CLI layers. No new features — purely fixing path construction so existing functionality works on Windows.

Requirements in scope: PATH-01, PATH-02, PATH-03, PATH-04, PATH-05.

</domain>

<decisions>
## Implementation Decisions

### Reference implementation
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

</decisions>

<specifics>
## Specific Ideas

- Follow gsd-tools.cjs patterns exactly — it's a proven cross-platform Node.js CLI that already works on this Windows/Git Bash environment
- The tool uses `path.join()` consistently, `os.homedir()` for home directory, and `path.isAbsolute()` for path type detection
- For `@`-reference tilde expansion: `cleanRef.startsWith('~/') ? path.join(process.env.HOME || '', cleanRef.slice(2)) : path.join(cwd, cleanRef)`

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-path-construction-audit*
*Context gathered: 2026-02-22*
