# Phase 1: Repository Foundations - Research

**Researched:** 2026-02-22
**Domain:** Git line-ending normalization via `.gitattributes`
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Line ending rules:** Blanket `* text=auto eol=lf` — force LF for all text files. No selective per-extension rules needed; auto-detection handles text vs binary. Explicit `eol=lf` for files that are especially sensitive: `*.yml`, `*.yaml`, `*.json`, `*.sh`, `*.snap`
- **Existing file normalization:** Renormalize all tracked files in a single dedicated commit (`git add --renormalize .`). This commit lands before any other phase work to establish a clean baseline. Accept the large diff — it's a one-time event and clearly attributable.
- **Binary/vendored exceptions:** Mark standard binary extensions: `*.png`, `*.jpg`, `*.gif`, `*.ico`, `*.woff`, `*.woff2`, `*.ttf`, `*.eot` as `binary`. No vendored assets identified in this project — revisit if any appear.
- **Snapshot strategy:** Vitest snapshot files (`*.snap`) get explicit `eol=lf` to prevent cross-platform diffs. After renormalization, regenerate snapshots once to confirm stability.

### Claude's Discretion

- Exact ordering of `.gitattributes` rules
- Whether to add comments explaining each section
- Any additional binary extensions discovered during implementation

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REPO-01 | Repository has `.gitattributes` with `eol=lf` for all text files to prevent CRLF corruption on Windows clones | Sections: Standard Stack, Architecture Patterns, Code Examples, Common Pitfalls |
</phase_requirements>

---

## Summary

Phase 1 is a pure Git configuration change — no application code is modified. The deliverable is a single `.gitattributes` file committed to the repository root, followed by a renormalization commit that re-stages all tracked files with the new line-ending rules applied. These two commits establish the clean baseline all subsequent phases build on.

The implementation is well-understood and the tooling is mature. Git's built-in `text=auto eol=lf` mechanism handles text/binary auto-detection reliably. The only non-obvious risk is the interaction between `text=auto` and `eol=lf` on Windows working directories: `text=auto eol=lf` stores LF in the index AND checks out LF to the working directory, which is exactly what this project needs (Git Bash on Windows requires LF). This differs from the more common `text=auto` alone, which stores LF but checks out CRLF on Windows.

The Vitest snapshot concern is real and documented (vitest issue #4653). Snapshot files with CRLF cause spurious rewrites on every test run. The fix — marking `*.snap` with `eol=lf` in `.gitattributes` and regenerating snapshots post-renormalization — is the correct approach. No third-party tools are required for any part of this phase.

**Primary recommendation:** Write `.gitattributes` with `* text=auto eol=lf` as the blanket rule, add explicit `eol=lf` overrides for sensitive extensions, mark binary files, then execute the two-commit renormalization sequence.

---

## Standard Stack

### Core

| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| `.gitattributes` | Git built-in | Repository-level line-ending policy | The only Git-native mechanism; affects all contributors without per-user config |
| `git add --renormalize .` | Git built-in | Applies new `.gitattributes` rules to all tracked files | Official documented approach for normalizing existing repos |

### Supporting

| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| `git ls-files --eol` | Git built-in | Inspect current line endings of indexed files | Verification before and after renormalization |
| `git diff --check` | Git built-in | Detect whitespace errors including mixed line endings | Spot-check after normalization |
| `file` command (Git Bash) | System | Check working-directory file endings | Post-clone verification on Windows |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `.gitattributes` | `core.autocrlf` global config | `core.autocrlf` is per-user — not enforced repository-wide; `.gitattributes` wins |
| `* text=auto eol=lf` | `* text eol=lf` | `text` (without `auto`) skips Git's binary detection; risk of corrupting binary files if not exhaustively listed |
| `git add --renormalize .` | Delete and re-add all files | Renormalize is the official, atomic approach; manual delete risks losing data |

**Installation:** No packages to install. All tooling is built into Git.

---

## Architecture Patterns

### Recommended `.gitattributes` Structure

```
# 1. Blanket default — all text files: LF in repo AND working directory
* text=auto eol=lf

# 2. Explicit overrides for sensitive file types (belt-and-suspenders)
*.yml   text eol=lf
*.yaml  text eol=lf
*.json  text eol=lf
*.sh    text eol=lf
*.snap  text eol=lf

# 3. Binary assets — no line-ending translation
*.png   binary
*.jpg   binary
*.gif   binary
*.ico   binary
*.woff  binary
*.woff2 binary
*.ttf   binary
*.eot   binary
```

### Renormalization Sequence

**What:** Two-commit sequence to apply `.gitattributes` rules to existing tracked files.

**When to use:** Any time `.gitattributes` is added or changed in an existing repository.

**Exact sequence:**
```bash
# Commit 1: add .gitattributes
git add .gitattributes
git commit -m "chore(repo): add .gitattributes for LF line endings"

# Commit 2: renormalize all tracked files
git add --renormalize .
git commit -m "chore(repo): normalize line endings to LF"
```

Source: [GitHub Docs — Configuring Git to handle line endings](https://docs.github.com/en/get-started/getting-started-with-git/configuring-git-to-handle-line-endings), [Edward Thomson — Renormalizing Line Endings](https://www.edwardthomson.com/blog/advent_day_21_renormalizing_line_endings)

### `text=auto eol=lf` vs `text=auto` — Critical Distinction

`* text=auto` — stores LF in index; checks out CRLF on Windows. **Wrong for this project.** Files like `*.sh` would have CRLF in the Git Bash working directory, causing `\r: command not found` errors.

`* text=auto eol=lf` — stores LF in index; checks out LF on Windows too. **Correct for this project.** Git Bash reads LF files natively.

Source: [Git - gitattributes Documentation](https://git-scm.com/docs/gitattributes)

### Explicit Override Pattern

Even with the blanket `text=auto eol=lf`, add explicit `eol=lf` overrides for critical file types. Git's binary auto-detection is reliable but adding explicit rules provides:
1. Documentation of intent (human-readable policy)
2. Protection against edge cases where auto-detection might misclassify (e.g., a YAML file with embedded NUL bytes)
3. Faster processing (Git skips heuristic for explicitly-marked files)

### Anti-Patterns to Avoid

- **Using `text=auto` without `eol=lf`:** On Windows this checks out CRLF — YAML parsers and shell scripts will break.
- **Using `text eol=lf` (without `auto`) as the blanket rule:** Skips binary detection; Git will attempt to convert binary files and corrupt them.
- **Skipping the renormalization commit:** `.gitattributes` rules only apply to future `git add` operations; existing indexed files retain old line endings until renormalized.
- **Renormalizing without a prior clean working tree:** If there are uncommitted changes, `git add --renormalize .` may mix line-ending changes with code changes. Always start from a clean state.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Line-ending normalization | Custom pre-commit hook that runs `dos2unix` | `.gitattributes` with `eol=lf` | `.gitattributes` is enforced by Git itself at index time; hooks can be bypassed |
| Binary detection | Per-extension explicit `-text` for every binary | `* text=auto` blanket + explicit overrides only for exceptions | `text=auto` correctly handles 99.9% of binaries via NUL-byte detection |
| Working-directory re-checkout | Manual `rm -rf * && git checkout .` | `git add --renormalize .` + commit | Official mechanism; safe, atomic, undoable |

**Key insight:** This entire phase is configuration, not code. All complexity lives in Git's attribute system. There is nothing to implement in application code.

---

## Common Pitfalls

### Pitfall 1: `text=auto` Without `eol=lf` on Windows

**What goes wrong:** Files are stored as LF in the repo but checked out as CRLF in the Windows working directory. YAML skill files get `\r` appended to string values. Shell scripts fail with `\r: command not found`. This is the exact bug REPO-01 is designed to prevent.

**Why it happens:** `text=auto` alone uses the platform default for checkout. On Windows the default is CRLF (unless `core.eol` is explicitly set to `lf`). Adding just `* text=auto` without `eol=lf` would appear correct in the index but fail at runtime.

**How to avoid:** Always use `* text=auto eol=lf` — not `* text=auto` alone — as the blanket rule.

**Warning signs:** `git ls-files --eol` shows `w/crlf` in the working-tree column for text files on a Windows checkout.

### Pitfall 2: Existing CRLF Files Not Renormalized

**What goes wrong:** `.gitattributes` is committed but existing tracked files retain CRLF in the index. Git only applies new rules at `git add` time, not retroactively to what is already staged.

**Why it happens:** Many developers commit `.gitattributes` and assume the rules immediately apply to all existing files. They don't.

**How to avoid:** Always run `git add --renormalize .` and commit the result as a separate commit after adding `.gitattributes`.

**Warning signs:** `git ls-files --eol` shows `i/crlf` for files that should be LF (the `i/` prefix is the index copy).

### Pitfall 3: Vitest Snapshot CRLF Churn

**What goes wrong:** Vitest reads snapshot files from disk and normalizes content to LF internally for comparison. If the on-disk snapshot has CRLF (from prior Windows Git config), every test run triggers a rewrite even when nothing changed.

**Why it happens:** Documented in vitest issue #4653. The `readSnapshotFile` function did not historically normalize CRLF → LF on read; vitest team exposed `snapshotEnvironment` hook rather than fixing it globally.

**How to avoid:** Mark `*.snap` with `eol=lf` in `.gitattributes` and regenerate all snapshots once after renormalization. With LF enforced, the on-disk content matches vitest's internal representation.

**Warning signs:** `git status` shows `*.snap` files as modified immediately after a clean `vitest run` with no code changes.

### Pitfall 4: Large Diff in Renormalization Commit

**What goes wrong:** The renormalization commit touches every text file in the repo, making history appear noisy and making `git blame` less useful for those files.

**Why it happens:** Unavoidable one-time cost of normalizing an existing repo.

**How to avoid:** Accept it. Use a clear commit message that explains why the diff is large (`chore(repo): normalize line endings to LF`). Consider adding the commit SHA to a `blame.ignoreRevsFile` (`.git-blame-ignore-revs`) if the project uses `git blame` heavily.

**Warning signs:** N/A — this is expected behavior, not a warning sign.

### Pitfall 5: `core.autocrlf` Override on Individual Machines

**What goes wrong:** Developers with `git config --global core.autocrlf true` may see CRLF re-introduced on their local checkout even with `.gitattributes` in place, because `core.autocrlf` affects the working directory independently.

**Why it happens:** Git's attribute `eol` setting governs what Git writes to the working directory; `core.autocrlf=true` is a separate conversion layer. The interaction is: `.gitattributes eol=lf` wins for the index, but `core.autocrlf=true` can still convert files on checkout.

**How to avoid:** `* text=auto eol=lf` takes precedence over `core.autocrlf` when an explicit `eol` attribute is set. Per Git docs: "If the eol attribute is specified, the setting of core.autocrlf and core.eol is overridden." This means explicit `eol=lf` in `.gitattributes` is robust against individual user settings.

**Warning signs:** Files appear in `git diff` as changed on a fresh clone with no edits.

---

## Code Examples

### Complete `.gitattributes` for This Project

```gitattributes
# Blanket rule: store LF in index, check out LF in working directory (all platforms)
* text=auto eol=lf

# Explicit LF enforcement for files that break on CRLF
*.yml   text eol=lf
*.yaml  text eol=lf
*.json  text eol=lf
*.sh    text eol=lf
*.snap  text eol=lf

# Binary assets — disable all line-ending translation
*.png   binary
*.jpg   binary
*.gif   binary
*.ico   binary
*.woff  binary
*.woff2 binary
*.ttf   binary
*.eot   binary
```

Source: Pattern derived from [GitHub Docs](https://docs.github.com/en/get-started/getting-started-with-git/configuring-git-to-handle-line-endings) and [Edward Thomson's gitattributes series](https://www.edwardthomson.com/blog/advent_day_1_gitattributes_for_text_files)

### Renormalization Commands

```bash
# Step 1: Write and commit .gitattributes
git add .gitattributes
git commit -m "chore(repo): add .gitattributes for LF line endings"

# Step 2: Renormalize all tracked files
git add --renormalize .
git commit -m "chore(repo): normalize line endings to LF"
```

Source: [GitHub Docs — Configuring Git to handle line endings](https://docs.github.com/en/get-started/getting-started-with-git/configuring-git-to-handle-line-endings)

### Verification Commands

```bash
# Inspect line endings in index (i/) and working tree (w/) for all files
git ls-files --eol

# Expected output for text files after normalization:
# i/lf    w/lf    attr/text=auto eol=lf    src/foo.ts

# Check for mixed line endings (whitespace errors)
git diff --check HEAD

# On Windows: verify a specific file has LF in working directory
file scripts/console/check-inbox.sh
# Expected: "ASCII text" (not "ASCII text, with CRLF line terminators")
```

### Snapshot Regeneration After Renormalization

```bash
# After renormalization commit, regenerate snapshots to purge any stale CRLF content
npx vitest run --reporter=verbose 2>&1 | head -50

# If snapshots were updated (git status shows *.snap changes), commit them:
git add tests/**/*.snap src/**/*.snap
git commit -m "test(snapshots): regenerate after line-ending normalization"
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `core.autocrlf=true` in global git config | `.gitattributes` in repo | Git 1.7.2 (2010) | Repository-level policy; no per-developer config required |
| `* text=auto` blanket rule | `* text=auto eol=lf` for repos targeting Linux/macOS/Git Bash | Always supported; adoption grew with cross-platform Node.js | Ensures LF in working directory on Windows, not just in index |
| Manual per-extension text rules | `text=auto` with selective overrides | Git 1.8.x | Reduced maintenance burden; binary detection handles most cases |

**Deprecated/outdated:**
- `core.autocrlf`: Workable but per-user; `.gitattributes` is the canonical repository-level solution
- Listing every text extension explicitly without `text=auto`: Labor-intensive and error-prone; auto-detection is reliable

---

## Open Questions

1. **Are there existing `.snap` files in the repository?**
   - What we know: `Glob **/*.snap` returned no results — no snapshot files currently exist in the repo.
   - What's unclear: Whether tests will generate snapshot files in the future.
   - Recommendation: Add `*.snap text eol=lf` to `.gitattributes` proactively. No regeneration step is needed since there are no existing snapshots to fix. Verify after first vitest run that generates snapshots.

2. **Does `git add --renormalize .` include files in subdirectories like `src/orchestrator/__fixtures__/`?**
   - What we know: `--renormalize .` operates on all tracked files recursively from the current directory.
   - What's unclear: Whether any fixture files contain intentional CRLF content that should be preserved.
   - Recommendation: Inspect fixture files with `git ls-files --eol` before committing to confirm no intentional CRLF content.

3. **Does `serve-dashboard.mjs` need any special handling?**
   - What we know: `.mjs` files are JavaScript modules and should be treated as text.
   - What's unclear: Nothing — `text=auto` will detect it as text and apply `eol=lf` correctly.
   - Recommendation: No special rule needed; covered by the blanket rule.

---

## Sources

### Primary (HIGH confidence)
- [Git - gitattributes Documentation](https://git-scm.com/docs/gitattributes) — `text`, `eol`, `binary` attributes, interaction with `core.autocrlf`
- [GitHub Docs — Configuring Git to handle line endings](https://docs.github.com/en/get-started/getting-started-with-git/configuring-git-to-handle-line-endings) — Official renormalization procedure with exact command sequence

### Secondary (MEDIUM confidence)
- [Edward Thomson — Advent Day 1: gitattributes for Text Files](https://www.edwardthomson.com/blog/advent_day_1_gitattributes_for_text_files) — Explains `text=auto` vs `text eol=lf` distinction; author is a Git maintainer
- [Edward Thomson — Advent Day 21: Renormalizing Line Endings](https://www.edwardthomson.com/blog/advent_day_21_renormalizing_line_endings) — Renormalization procedure and merge-conflict pitfalls
- [Vitest Issue #4653 — Snapshot CRLF on Windows](https://github.com/vitest-dev/vitest/issues/4653) — Documents root cause of snapshot churn; confirms `.gitattributes` fix is the correct approach

### Tertiary (LOW confidence)
- [CRLF vs. LF: Normalizing Line Endings in Git](https://www.aleksandrhovhannisyan.com/blog/crlf-vs-lf-normalizing-line-endings-in-git/) — Community article; used for corroboration only

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Git built-in tooling with official documentation
- Architecture: HIGH — Pattern is stable, well-documented, and confirmed against official Git docs
- Pitfalls: HIGH for CRLF/working-directory pitfalls (official docs confirm); MEDIUM for Vitest snapshot pitfall (GitHub issue, not official docs)

**Research date:** 2026-02-22
**Valid until:** 2027-02-22 (Git attribute system is stable; unlikely to change)
