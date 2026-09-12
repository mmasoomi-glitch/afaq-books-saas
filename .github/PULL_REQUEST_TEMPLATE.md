<!-- PR title format: feat(scope): … | fix(scope): … | chore(scope): … etc. -->

## Summary

<!-- 1–3 bullets. What changed and why. -->

-

## Sprint and ownership

- **Sprint:** <NNN>
- **Sprint base SHA:** <sha from SPRINT_BOARD.md>
- **Agent / role:** <role slug>
- **Branch:** `<branch name>`
- **Owned paths touched:** <list>
- **Non-owned paths touched (with handoff reference):** <list or "none">

## Changes

<!-- Group by concern. Migrations, schema, services, UI, tests, docs. -->

### Schema / migrations

- <migration filename, what it does>
- <`prisma/schema.prisma` sections changed>

### Code

- <files / brief>

### Tests

- <new tests added>

### Docs

- <files updated>

## Verification

<!-- Paste actual command output, or link to CI logs. Don't paraphrase. -->

```text
$ pnpm typecheck
…
$ pnpm test
…
$ pnpm test:e2e
…
```

## Accounting / security / AI review

(Tick the ones that apply; QA-AUDITOR signs off before integration.)

- [ ] Touches ledger / financial state — accounting-invariant tests added/updated and pass
- [ ] Touches org-scoped data — tenant-isolation tests added/updated and pass
- [ ] Touches authentication / authorization — escalation tests added/updated and pass
- [ ] Touches AI suggestion surface — grounding + injection tests added/updated and pass
- [ ] Touches schema — reviewed by the schema owner (LEDGER-CORE / AUTH-TENANCY)
- [ ] No mocks / stubs / fake data in production paths
- [ ] No secrets in the diff
- [ ] CLAUDE.md, OWNERSHIP, SPRINT_BOARD, IMPLEMENTATION_STATUS updated as relevant

## Known limitations / follow-ups

<!-- Anything not done, with a `BLOCKERS.md` reference. -->

-

## Reviewer notes

<!-- Anything reviewers need to know to review fast (e.g. read this file
     first, run this migration locally, etc.). -->
