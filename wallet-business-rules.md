# FINAL BUSINESS RULES CONFIRMATION
## GBE Fleet Tracker – Wallet Management

The following two business rules are now confirmed and must be implemented.

### 1. Budget Allocation vs. Actual Top-up – Separate Financial Operations

The company operates using a two-stage budget distribution process.

**Stage 1 – Monthly Budget Allocation**

At the beginning of each month, the company receives a new monthly budget.

Example: SAR 100,000.

This budget is distributed across three main categories:

- Management: SAR 10,000.
- Projects: SAR 65,000.
- Supervisors: SAR 25,000.

These amounts represent allocated budgets, not necessarily amounts already deposited into individual cards.

**Stage 2 – Actual Account Replenishment**

The allocated category budget can then be distributed to individual projects and cards through actual top-up operations.

Example:

Projects Monthly Allocation: SAR 65,000.

| Project | Monthly Allocation | Actual Top-up |
|---|---:|---:|
| FDP | 20,000 | 15,000 |
| JDL | 20,000 | 10,000 |
| ADM | 15,000 | 10,000 |
| LMS | 10,000 | 5,000 |
| Total | 65,000 | 40,000 |

The remaining SAR 25,000 is still available within the Projects allocation and has not yet been distributed to individual project accounts.

The system must clearly distinguish between:

1. Company Monthly Budget.
2. Category Allocation.
3. Account Allocation.
4. Actual Top-up.
5. Account Expenses.
6. Available Undistributed Budget.
7. Actual Account Balance.

**Important financial rules:**

- A budget allocation is not an expense.
- An actual top-up is not an expense.
- Moving money from a category budget to an individual account must not create additional company money.
- Actual expenses are deducted only when valid invoices are posted.
- Internal transfers must not increase or decrease consolidated company funds.
- The dashboard must distinguish undistributed budget from money already available in individual accounts.
- Never count the same amount twice.

The main dashboard must show both:

**Undistributed Budget:** Money still available within the category allocation but not yet replenished to accounts.

**Distributed Account Balance:** Money already replenished to individual accounts and not yet spent.

### 2. Invoice Cancellation and Automatic Reversal

If an invoice has already been posted and deducted from an account, and it is subsequently cancelled or rejected, the system must automatically reverse the original financial deduction.

Example:

Supervisor Account Balance: SAR 2,000.

Invoice Total Including VAT: SAR 575.

After invoice entry:

New Balance = SAR 1,425.

Later, the invoice is cancelled.

The system must automatically create a reversal transaction of SAR 575.

New Balance = SAR 2,000.

**Reversal Requirements:**

- Never delete the original invoice transaction.
- Create a separate reversal transaction linked to the original transaction.
- Preserve the original invoice details.
- Record the cancellation reason.
- Record who performed the cancellation.
- Record the reversal date and time.
- Prevent multiple reversals of the same invoice.
- Update the account balance immediately.
- Update category and company financial summaries.
- Maintain a complete audit trail.

If the invoice belongs to a closed financial period, do not silently modify the closed historical balance. Record the correction as an auditable adjustment according to the configured financial closing policy.

### 3. Required Dashboard Indicators

Add these indicators to Wallet Overview:

- Total Monthly Company Budget.
- Total Category Allocations.
- Total Undistributed Budget.
- Total Distributed to Accounts.
- Total Actual Account Balances.
- Total Expenses Including VAT.
- Total Internal Transfers.
- Total Reversed Expenses.

The dashboard must provide a complete reconciliation between the original monthly budget, allocated budgets, actual top-ups, expenses, and remaining funds.

### FINAL REQUIREMENT

The system must operate using a clear financial hierarchy:

Company Monthly Budget
→ Category Budget Allocation
→ Actual Account Top-ups
→ Invoice Expenses
→ Remaining Account Balances

All internal money movements must be tracked without creating duplicate funds or duplicate expenses.

These two rules are confirmed business requirements and must override any conflicting assumptions in the previous implementation instructions.
