# docs/coordination/ARCHITECTURE_DECISIONS.md

Index of Architecture Decision Records.

Each ADR lives under `docs/coordination/adr/`, numbered, with status
metadata. ADRs are append-only — supersession is recorded as a new ADR,
not by editing the old one.

| ID | Title | Status | Owner | Date |
|----|-------|--------|-------|------|
| [0001](adr/0001-stack-nextjs15-prisma-postgres-authjs.md) | Stack: Next.js 15 App Router + TypeScript + Prisma + PostgreSQL + Auth.js v5 | Accepted | ARCHITECT / Lead | 2026-05-27 |

## Status vocabulary

- **Proposed** — under discussion, not yet binding.
- **Accepted** — binding decision. Agents must comply.
- **Superseded by ADR-NNNN** — replaced. The replacement ADR explains
  why and what changes.
- **Deprecated** — no longer recommended but historical record.

## Authoring an ADR

1. Copy the template at `docs/coordination/adr/_template.md` (added in
   ADR-0002 when needed).
2. Use the next sequential number.
3. Include: context, decision, consequences (positive and negative),
   alternatives considered, references.
4. Open a `chore/adr-NNNN-<slug>` branch and a PR. ADRs go through the
   same GitKeeper integration flow as code.
5. Add an entry to this index in the same PR.

## What deserves an ADR

- Stack choices (framework, ORM, language, auth, hosting).
- Cross-cutting patterns (transaction strategy, authorization model,
  AI grounding policy).
- Module boundaries that constrain multiple agents.
- Reversal/correction strategy for financial records.
- Data-retention and audit-log retention policies.

## What does **not** deserve an ADR

- A specific function name.
- A specific file path inside an agent's owned module (handled in
  that module's design notes).
- Minor refactors.
- Library upgrades within the same major version, unless the upgrade
  changes semantics relevant to other modules.
