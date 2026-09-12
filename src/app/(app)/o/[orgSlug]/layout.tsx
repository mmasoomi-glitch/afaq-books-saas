import { cachedPageScope } from "../../../../server/next/page-scope-cache";
import AppNav from "./AppNav";
import type { NavLink } from "./nav";
import { navLinksFor } from "./nav";
import SignOutButton from "./SignOutButton";

interface LayoutProps {
  readonly children: React.ReactNode;
  // Route params are a Promise in Next 15.
  readonly params: Promise<{ orgSlug: string }>;
}

export default async function OrgLayout({
  children,
  params,
}: LayoutProps): Promise<React.JSX.Element> {
  const { orgSlug } = await params;

  // The layout is the first authorization boundary a visitor meets: no session
  // redirects to sign-in, and a slug they are not a member of 404s before any
  // page below has run.
  const scope = await cachedPageScope(orgSlug);

  // Filtered server-side, so the client component never receives a link the
  // user cannot use. `navLinksFor` carries the explanation of why hiding a
  // link is NOT authorization; every destination re-checks for itself.
  const links: readonly NavLink[] = navLinksFor(scope.role, orgSlug);

  return (
    <>
      <header>
        <p>
          {scope.organizationSlug} &middot; {scope.role}
        </p>
        <AppNav links={links} />
        <p>
          <a href="/organizations">All organizations</a>
        </p>
        {/*
          Not a `<form method="post">`. The sign-out endpoint enforces
          double-submit CSRF via an `x-csrf-token` header, which an HTML form
          cannot set — the form would have rendered a button that answered 403
          every time. See SignOutButton.
        */}
        <SignOutButton />
      </header>
      {children}
    </>
  );
}
