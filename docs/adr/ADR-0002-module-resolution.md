# ADR-0002 — The repository uses `bundler` module resolution

- **Status:** accepted
- **Date:** 2026-09-12
- **Deciders:** PLATFORM-GUARDIAN, on an independent review recommendation
- **Supersedes:** nothing. Amends the `tsconfig.json` shipped with ADR-0001.

## Context

Until now `tsconfig.json` used `module: "NodeNext"` and
`moduleResolution: "NodeNext"`. That is why every relative import in this
repository ends in `.js` — NodeNext requires the extension that will exist at
runtime, not the one on disk.

Next.js 15 does not ask about this. `next dev` and `next build` **rewrite**
`tsconfig.json` on first run: they set `moduleResolution: "bundler"`,
`module: "esnext"`, `jsx: "preserve"`, `noEmit`, `incremental`, and add their
language-service plugin. A repository that adds Next.js and does nothing else
discovers the rewrite as an unexplained diff, usually in someone else's PR.

So the choice had to be made before the first `next build`, not after it.

## Options considered

**(A) One config, Next's shape.** Accept `bundler` resolution repository-wide
and commit the rewritten file deliberately.

**(B) Two configs.** Root config for Next, a separate `tsconfig.check.json`
with NodeNext that CI typechecks the server and tests against.

**(C) Hide it.** Keep NodeNext at the root and point Next at a different file
via `typescript.tsconfigPath`, so it rewrites something nobody reads.

## Decision

**(A).**

(B) means two answers to "how does an import resolve" and a standing risk that
a file typechecks under one and not the other — discovered at the worst moment,
when a release build behaves differently from the gate that approved it.

(C) is worse in the same way and adds concealment: the configuration that
actually governs the production build is the one nobody looks at.

(A) has one source of truth. The `.js` import suffixes stay exactly as they
are — `bundler` resolution resolves `./y.js` to `y.ts` on disk, which is what
Vite and esbuild do and what Vitest already does today.

## Consequences

**What we keep.** `strict`, `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes` are ours, not Next's defaults, and are preserved
explicitly in the committed file. Next does not remove options it did not add.
If a future `next build` drops one of them, that is a regression to catch in
review — the three of them are why several defects in the HTTP layer were
compile errors rather than runtime surprises.

**What we lose, stated plainly.** `bundler` resolution is less strict than
`NodeNext` about importing CommonJS-only packages — the class of error where a
package has no ESM entry point and `NodeNext` would have said so. With
`esModuleInterop` on, which Next requires, such an import may typecheck and
fail at runtime instead. That is a real reduction in a check we had.

It is accepted because the exposure is small and bounded: server dependencies
here are `@prisma/client`, `pg`, `@node-rs/argon2` and `zod`, all of which ship
ESM, and a new dependency that does not is something a person chooses
deliberately rather than something that arrives by accident.

**`lib` now includes `dom`.** React needs it. The cost is that DOM globals are
visible to server code that has no business using them, so `document` in a
server module is no longer a type error. Nothing enforces that boundary but
review and the existing CI check that keeps framework imports out of
`src/server/http/`.

**Not affected.** The adapter (`src/server/http/adapters/web.ts`) uses `Request`
and `Response`, which are standard in Node 22 and were already in scope through
`@types/node`; adding `dom` does not change their behaviour, only where the
types come from.
