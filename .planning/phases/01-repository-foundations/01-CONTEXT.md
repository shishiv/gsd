# Phase 1: Repository Foundations - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Add `.gitattributes` to prevent CRLF corruption on Windows clones. All source files receive LF line endings. Existing files are renormalized. This is a repository-level configuration change — no application code is modified.

</domain>

<decisions>
## Implementation Decisions

### Line ending rules
- Blanket `* text=auto eol=lf` — force LF for all text files
- No selective per-extension rules needed; auto-detection handles text vs binary
- Explicit `eol=lf` for files that are especially sensitive: `*.yml`, `*.yaml`, `*.json`, `*.sh`, `*.snap`

### Existing file normalization
- Renormalize all tracked files in a single dedicated commit (`git add --renormalize .`)
- This commit lands before any other phase work to establish a clean baseline
- Accept the large diff — it's a one-time event and clearly attributable

### Binary/vendored exceptions
- Mark standard binary extensions: `*.png`, `*.jpg`, `*.gif`, `*.ico`, `*.woff`, `*.woff2`, `*.ttf`, `*.eot` as `binary`
- No vendored assets identified in this project — revisit if any appear

### Snapshot strategy
- Vitest snapshot files (`*.snap`) get explicit `eol=lf` to prevent cross-platform diffs
- After renormalization, regenerate snapshots once to confirm stability

### Claude's Discretion
- Exact ordering of `.gitattributes` rules
- Whether to add comments explaining each section
- Any additional binary extensions discovered during implementation

</decisions>

<specifics>
## Specific Ideas

No specific requirements — standard `.gitattributes` best practices apply. The success criteria from the roadmap are the definitive acceptance test.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-repository-foundations*
*Context gathered: 2026-02-22*
