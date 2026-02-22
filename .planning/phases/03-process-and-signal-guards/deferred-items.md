# Deferred Items — Phase 03

## Pre-existing TypeScript Errors (Out of Scope)

Discovered during `tsc --noEmit` in plan 03-02 execution. These are pre-existing errors
in unrelated files, not caused by launcher.ts documentation changes.

### src/dashboard/budget-silicon-collector.test.ts
- Lines 276, 316, 382: `TS2353: Object literal may only specify known properties, and 'enabled' does not exist in type 'TerminalConfig'`

### src/dashboard/generator.ts
- Line 32: `TS2307: Cannot find module './metrics/metrics-styles.js' or its corresponding type declarations`

### src/dashboard/renderer.test.ts
- Line 3: `TS2307: Cannot find module './metrics/metrics-styles.js' or its corresponding type declarations`

**Status:** Deferred — pre-existing, out of scope for path-construction-audit and process-and-signal-guards phases.
**Discovered:** 2026-02-22 during 03-02-PLAN.md execution
