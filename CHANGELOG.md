# NoirPerp — Changelog

Every change documented BEFORE commit. Entry format:
- **What changed / added**
- **Why** (ticket, decision reference, or inline reason)
- **Root cause** (for bug fixes)
- **What was tried** (for bug fixes — including things that didn't work)
- **Files touched**

Purpose: prevent re-fixing already-fixed bugs; prevent re-visiting
solved design decisions; give future agents full context.

---

## 2026-04-24

### Phase 0 scaffolding (in progress)

- **Added**: Design spec `docs/specs/2026-04-24-noirperp-design.md` —
  approved by CTO after full brainstorming session.
  **Why**: source-of-truth document for the rebuild; written before any
  code to prevent scope drift.
  **Files**: `docs/specs/2026-04-24-noirperp-design.md`.

- **Added**: Phase 0 implementation plan
  `docs/plans/2026-04-24-phase-0-scaffolding.md`.
  **Why**: bite-sized TDD task list for Phase 0 scaffolding + smoke test.
  **Files**: `docs/plans/2026-04-24-phase-0-scaffolding.md`.

- **Added**: Root `.gitignore`.
  **Why**: exclude node_modules, build artifacts, env files, IDE cruft.
  **Files**: `.gitignore`.

- **Added**: `CLAUDE.md` — pinned agent rules (Pillar 1).
  **Why**: anti-hallucination guardrail; locks FHEVM primitive
  assumptions, change-management rules, testing rules.
  **Files**: `CLAUDE.md`.

- **Added**: `PROGRESS.md` — phase tracker (Pillar 3).
  **Why**: anti-hallucination guardrail; single source of truth for
  phase state; enforces phase-gate discipline.
  **Files**: `PROGRESS.md`.

- **Added**: `CHANGELOG.md` — this file (Pillar 2).
  **Why**: anti-hallucination guardrail; every change logged before
  commit; Predictoor-pattern.
  **Files**: `CHANGELOG.md`.
