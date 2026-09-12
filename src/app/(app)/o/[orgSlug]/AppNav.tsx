"use client";

import Link from "next/link";

import { usePathname } from "next/navigation";

export interface NavLink {
  readonly href: string;
  readonly label: string;
}

export interface AppNavProps {
  readonly links: readonly NavLink[];
}

/**
 * Draws the navigation. Decides nothing about it.
 *
 * This component receives an already-filtered list and deliberately imports
 * neither `can` nor `Action` nor `MembershipRole`. Permission logic that runs in
 * a client component is permission logic shipped to the browser, where the role
 * it reasons about is whatever the props say it is.
 */
export default function AppNav({
  links,
}: AppNavProps): React.JSX.Element | null {
  const pathname = usePathname();

  // A role with nothing to navigate to gets no empty `<nav>` landmark, which a
  // screen reader would announce and then offer nothing inside.
  if (links.length === 0) return null;

  return (
    <nav aria-label="Organization">
      <ul>
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              // Exact equality, not `startsWith`. `/o/acme/entries` is a prefix
              // of `/o/acme/entries/new`, so a prefix match would mark two
              // links as the current page at once — and `aria-current="page"`
              // on two links tells a screen-reader user they are in two places.
              aria-current={link.href === pathname ? "page" : undefined}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
