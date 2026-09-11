import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Afaq Books",
  description: "Double-entry accounting.",
  // The app is behind authentication and has nothing to gain from indexing.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * The root layout, deliberately minimal.
 *
 * FRONTEND-UX owns this file and the shell that will live in it. What is here
 * is the least that makes `next build` produce a valid document, so that the
 * API routes can be served and tested. It is not a design, and nothing should
 * be built on top of it without that agent.
 */
export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
