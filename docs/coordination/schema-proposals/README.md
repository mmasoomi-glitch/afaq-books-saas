# docs/coordination/schema-proposals/

Schema-change proposals from agents that **don't** own the table
they need.

## When to file a proposal

You're SALES-AR. You need a new column on `Invoice` (your table) —
just write the migration on your branch. No proposal needed.

You're SALES-AR. You need a new column on `Account` (LEDGER-CORE's
table) — you do **not** write the migration. You file a proposal
here. LEDGER-CORE reviews, writes the migration on their branch, and
tags you.

## File naming

```
NNNN-<short-slug>.md
```

`NNNN` is the next sequential number. Don't skip numbers.

## Template

```markdown
# Schema Proposal NNNN — <title>

- **Proposer:** <agent slug>
- **Date:** YYYY-MM-DD
- **Target schema owner:** <agent slug>
- **Status:** proposed | accepted | implemented (migration <id>) | rejected
- **Sprint-board task:** <NNN-NN>

## Need

<what business behavior requires this schema change>

## Proposed change

<tables, columns, types, FKs, indexes, constraints>

## Why existing schema is insufficient

<concrete description>

## Query patterns

<example queries that need this shape>

## Migration considerations

<data preservation, ordering, downtime, RLS implications>

## Reviewer comments

<schema owner appends here>
```

## Accepted proposals

Once accepted, the schema owner writes the migration on their branch,
links the migration id back into this file, and sets status to
`implemented`. The file stays as historical record.
