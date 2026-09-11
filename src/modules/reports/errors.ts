export class TrialBalanceUnbalancedError extends Error {
  constructor(
    public readonly totalDebit: string,
    public readonly totalCredit: string,
  ) {
    super(
      `[REPORT_TB_UNBALANCED] Trial balance is not balanced: totalDebit=${totalDebit}, totalCredit=${totalCredit}`,
    );
    this.name = "TrialBalanceUnbalancedError";
  }

  get code(): string {
    return "REPORT_TB_UNBALANCED";
  }
}
