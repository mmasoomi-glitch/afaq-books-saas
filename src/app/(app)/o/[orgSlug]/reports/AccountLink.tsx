import { journalHref } from "./drilldown";

export interface AccountLinkProps {
  readonly orgSlug: string;
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly from?: string;
  readonly to?: string;
}

/**
 * One account code on a statement, linking to the entries behind it.
 *
 * An anchor rather than a button: this is navigation to a URL that can be
 * bookmarked, shared with whoever asked the question, or pasted into a working
 * paper. A button would need JavaScript to do a worse version of what an
 * anchor already does.
 */
export default function AccountLink(
  props: AccountLinkProps,
): React.JSX.Element {
  const href = journalHref({
    orgSlug: props.orgSlug,
    accountId: props.accountId,
    ...(props.from === undefined ? {} : { from: props.from }),
    ...(props.to === undefined ? {} : { to: props.to }),
  });

  return (
    <a
      href={href}
      title={`Journal entries for ${props.accountCode} — ${props.accountName}`}
    >
      {props.accountCode}
    </a>
  );
}
