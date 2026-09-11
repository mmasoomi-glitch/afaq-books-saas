import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

/**
 * Lint configuration, ESLint 9 flat config.
 *
 * `next.config.ts` sets `eslint.ignoreDuringBuilds: false`, so everything here
 * is a build gate the moment this file exists — which is the point of writing
 * it rather than leaving a lint step that silently passes.
 *
 * The one real decision was type-aware linting. It needs a second TypeScript
 * program and costs roughly triple the lint time. It is on, for a narrow set of
 * rules, because the failure it catches is the one this codebase cannot afford:
 * a promise nobody awaited on the path that writes to a ledger.
 */
export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "next-env.d.ts",
      "prisma/migrations/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      /**
       * The rule this configuration exists for.
       *
       * `strict` TypeScript says nothing about a promise nobody awaits. So
       * `postJournalEntry(scope, entry)` without `await` typechecks perfectly,
       * returns immediately, and the caller reports success — while the write
       * may still fail afterwards with nobody listening. In a ledger that is a
       * posted entry that silently did not post, and the next report is wrong
       * with no error anywhere to explain it.
       *
       * `void expr` is the documented escape hatch and is NOT flagged, so
       * deliberate fire-and-forget stays expressible. The rule does not need
       * turning off to keep that.
       */
      "@typescript-eslint/no-floating-promises": "error",

      /**
       * Flags `await` on something that is not a promise.
       *
       * Almost always means the author believed a function was async when it is
       * not — so the `await` is decorative, the value is used immediately, and
       * the code reads as if it waited for something. Harmless on its own;
       * useful because it usually points at a misunderstanding about which
       * layer is asynchronous.
       */
      "@typescript-eslint/await-thenable": "error",

      /**
       * `checksVoidReturn.attributes` is FALSE, and this is disabling a check
       * rather than satisfying it — worth being plain about.
       *
       * The default flags an async function passed to a JSX attribute:
       * `onSubmit={handleSubmit}` where React's type expects `void` and gets
       * `Promise<void>`. React does not await the returned promise, so an
       * unhandled rejection inside it would be invisible. That is a real
       * concern in general, and it does not apply to `SignInForm`, whose
       * handler wraps its whole body in try/catch/finally and never rejects.
       *
       * The alternative — wrapping every handler as `onSubmit={(e) => { void
       * handleSubmit(e); }}` — satisfies the rule without changing what runs,
       * which is ceremony rather than safety. The rest of the rule stays on,
       * and it is the part that matters: an async callback passed where a
       * synchronous one is required outside JSX really is a bug.
       */
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],

      /**
       * OFF, deliberately.
       *
       * This codebase keeps runtime checks TypeScript believes are redundant —
       * `if (row === undefined) throw` after a query whose types say the row is
       * non-nullable. The types describe what the schema PROMISES. The check
       * describes what the database actually returned, which is a different
       * claim, and the gap between them is where a wrong number in someone's
       * books comes from.
       *
       * Not in `recommended`, so this is documentation of intent as much as
       * configuration: it says do not turn this on later without reading this.
       */
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },

  {
    files: ["src/app/**/*.tsx", "src/app/**/*.ts", "src/middleware.ts"],
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
    },
    languageOptions: { globals: { ...globals.browser } },
  },

  {
    files: ["tests/**/*.ts"],
    rules: {
      // Test code may assert more confidently about its own fixtures than
      // production code may about a database it did not write.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      /**
       * `allowEmptyCatch` because an empty catch is used deliberately in two
       * places, and in both the swallowing IS the behaviour:
       * `verifyAgainstDummy` exists for its duration and not its result, and
       * `verifyPassword` must return false for a corrupt hash rather than
       * throwing, because a caller that could tell those apart is an oracle.
       *
       * The rule stays on for every other empty block.
       */
      "no-empty": ["error", { allowEmptyCatch: true }],

      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      /**
       * `warn` and `error` are allowed because they are load-bearing: the rate
       * limiter uses `console.warn` to report that it is failing OPEN, and the
       * adapter uses `console.error` for an exception it is about to turn into
       * a generic 500. Both are the only record that something went wrong.
       *
       * A bare `console.log` in a request path is almost always a debugging
       * leftover, and in this codebase the thing nearest to hand when someone
       * adds one is an email address or a journal line.
       */
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
);
