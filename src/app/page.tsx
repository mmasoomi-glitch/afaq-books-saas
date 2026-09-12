/**
 * A truthful placeholder.
 *
 * `.claude/rules/no-mocks-no-stubs.md` forbids a page that implies working
 * functionality it does not have — no fake dashboard cards, no "$12,438 owed"
 * with nothing behind it, no navigation into features that do not exist. So
 * this page says exactly what is true: the API is real, the interface is not
 * built, and it names where the work is tracked.
 *
 * FRONTEND-UX replaces this with the actual shell.
 */
export default function Home() {
  return (
    <main>
      <h1>Afaq Books</h1>
      <p>
        The accounting API is running. You can sign in, create an organization,
        manage who has access to it, build a chart of accounts, open and close
        accounting periods, post and reverse journal entries, and read the
        trial balance, the profit and loss statement and the balance sheet.
      </p>
      <p>
        <a href="/register">Create an account</a> or{" "}
        <a href="/signin">sign in</a>. A new account belongs to no organization
        until you create one or an administrator adds you to theirs.
      </p>
      <p>
        Available endpoints: <code>POST /api/auth/register</code>,{" "}
        <code>POST /api/auth/signin</code>,{" "}
        <code>POST /api/auth/signout</code>, <code>GET /api/auth/session</code>.
      </p>
      <p>
        Progress is tracked in <code>docs/coordination/SPRINT_BOARD.md</code>{" "}
        and known gaps in <code>docs/coordination/BLOCKERS.md</code>.
      </p>
    </main>
  );
}
