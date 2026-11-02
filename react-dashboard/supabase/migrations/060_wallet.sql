begin;

-- =====================================================================
-- 060  Wallet (المحفظة)                                   REVIEW ONLY - NOT RUN YET
--
--  Implements wallet-business-rules.md plus the decisions taken with the user:
--    Company Monthly Budget -> Category Allocation -> Account Top-up -> Invoice Expense
--    -> Remaining Account Balance, with every money movement as its own ledger row.
--
--  Money model (double entry).  Every movement is ONE row in wallet_transactions (who,
--  when, why, what) and two or more rows in wallet_postings that move the amount
--  between "pools".  The postings of a movement always add up to zero, so money can
--  only enter through a company budget and only leave through an invoice expense:
--
--    pool       scoped by            holds
--    external   -                    the outside world (source of company budgets)
--    company    period               budget not yet given to any category
--    category   period + category    Undistributed Budget of the category
--    account    account              Actual Account Balance (not per period)
--    spent      account              expenses incl. VAT minus reversals
--
--    company_budget       external -X        company(P) +X
--    category_allocation  company(P) -X      category(P,c) +X
--    reallocation         category(P,a) -X   category(P,b) +X
--    top_up               category(P,c) -X   account(x) +X
--    expense              account(x) -X      spent(x) +X
--    reversal             spent(x) -X        account(x) +X       (linked to the expense)
--    internal_transfer    account(x) -X      account(y) +X       (same category only)
--    carry_forward        category(P,c) -X   category(P+1,c) +X  (or company(P) -> company(P+1))
--
--  Rules enforced by the DATABASE (not only by the page):
--    * append-only: wallet_transactions, wallet_postings and wallet_account_allocations
--      refuse UPDATE / DELETE / TRUNCATE;
--    * every movement balances to zero (deferred constraint trigger, checked at commit);
--    * one expense per invoice and ONE reversal per invoice (unique indexes);
--    * nothing can be posted into a closed period;
--    * a posted invoice cannot be deleted and its amount / account fields cannot change;
--    * all writes go through SECURITY DEFINER functions, one database transaction each,
--      main admin only.  Admin, fleet manager and viewer can read.
--
--  Balances are never stored: they are sums of wallet_postings.
--
--  Decisions (from the user, 2026-11-02):
--    - wallet starts 2026-11-01; invoices before that are never posted;
--    - which account an invoice belongs to comes from wallet_invoice_rules
--      (Card Type or Branch -> account, or "exclude"); the invoice status column
--      plays no part; an invoice with no matching rule stays in the unposted list;
--    - top-up above the Account Allocation: allowed, flagged;
--      top-up above the category's Undistributed Budget: refused;
--    - an invoice may take an account below zero (flagged);
--    - Cancelled and Rejected make the same reversal, recorded with a different kind;
--    - a reversal of an invoice from a closed period is an adjustment in the current
--      open period, linked to the original period; the closed period does not change;
--    - closing a period (main admin, manual) carries each category's Undistributed
--      Budget to the same category, and the company's unallocated budget to the
--      company, in the next month, as visible carry_forward movements;
--    - internal transfers only between accounts of the same category.
--
--  ONE transaction: if anything fails, nothing changes.
--  Needs 050 (private.app_role) and 053 (private.is_admin, private.is_fleet_manager).
--  Uses private.is_viewer() from 056 if it exists.
--  Does not create accounts or rules: those are data, added after this runs.
-- =====================================================================


-- 0) Preconditions
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'private' and p.proname = 'is_admin') then
    raise exception 'STOP: private.is_admin() is missing (053 not run).';
  end if;
  if to_regclass('public.fuel_invoice_records') is null then
    raise exception 'STOP: public.fuel_invoice_records is missing (044 not run).';
  end if;
  if to_regclass('public.wallet_transactions') is not null then
    raise exception 'STOP: public.wallet_transactions already exists - 060 was already run.';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 1) Helpers
-- ---------------------------------------------------------------------

-- Who may read the wallet: admin, fleet manager, and viewer when 056 has run.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'private' and p.proname = 'is_viewer') then
    execute $f$
      create function private.wallet_can_read() returns boolean
      language sql stable
      as 'select private.is_admin() or private.is_fleet_manager() or private.is_viewer()'
    $f$;
  else
    execute $f$
      create function private.wallet_can_read() returns boolean
      language sql stable
      as 'select private.is_admin() or private.is_fleet_manager()'
    $f$;
  end if;
end $$;

-- "Today" in Riyadh.  wallet.today can be set for one session (tests only).
create function private.wallet_today() returns date
language sql stable
as $$
  select coalesce(nullif(current_setting('wallet.today', true), '')::date,
                  (now() at time zone 'Asia/Riyadh')::date)
$$;

create function private.wallet_require_admin() returns void
language plpgsql stable
as $$
begin
  if not coalesce(private.is_admin(), false) then
    raise exception 'WALLET_ADMIN_ONLY' using errcode = '42501';
  end if;
end;
$$;

create function private.wallet_require_reader() returns void
language plpgsql stable
as $$
begin
  if not coalesce(private.wallet_can_read(), false) then
    raise exception 'WALLET_NO_ACCESS' using errcode = '42501';
  end if;
end;
$$;

create function private.wallet_require_reason(p_reason text) returns text
language plpgsql immutable
as $$
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'WALLET_REASON_REQUIRED';
  end if;
  return btrim(p_reason);
end;
$$;

create function private.wallet_require_amount(p_amount numeric) returns numeric
language plpgsql immutable
as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'WALLET_AMOUNT_MUST_BE_POSITIVE';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception 'WALLET_AMOUNT_MAX_TWO_DECIMALS';
  end if;
  return p_amount;
end;
$$;


-- ---------------------------------------------------------------------
-- 2) Tables
-- ---------------------------------------------------------------------

create table public.wallet_settings (
  id          boolean primary key default true check (id),
  start_month date not null check (start_month = date_trunc('month', start_month)::date)
);
insert into public.wallet_settings (start_month) values (date '2026-11-01');

create table public.wallet_periods (
  id         bigint generated always as identity primary key,
  month      date not null unique check (month = date_trunc('month', month)::date),
  status     text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  created_by uuid,
  closed_at  timestamptz,
  closed_by  uuid,
  closed_by_email text,
  close_reason text,
  check ((status = 'closed') = (closed_at is not null))
);

create table public.wallet_categories (
  id      smallint generated always as identity primary key,
  code    text not null unique,
  name_en text not null,
  name_ar text not null,
  sort    smallint not null
);
insert into public.wallet_categories (code, name_en, name_ar, sort) values
  ('management',  'Management',  'الإدارة',  1),
  ('projects',    'Projects',    'المشاريع', 2),
  ('supervisors', 'Supervisors', 'المشرفين', 3);

create table public.wallet_accounts (
  id          bigint generated always as identity primary key,
  category_id smallint not null references public.wallet_categories (id),
  code        text not null unique,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid
);

-- Planned amount per account and month (a target, not money).  Append-only: a change is
-- a new row and the newest row of (period, account) is the one in force.
create table public.wallet_account_allocations (
  id         bigint generated always as identity primary key,
  period_id  bigint not null references public.wallet_periods (id),
  account_id bigint not null references public.wallet_accounts (id),
  amount     numeric(14, 2) not null check (amount >= 0),
  reason     text,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_email text
);
create index wallet_account_allocations_lookup on public.wallet_account_allocations (period_id, account_id, id desc);

-- Which account an invoice is charged to.  Config, editable by the main admin; changing
-- a rule never touches invoices that are already posted.
create table public.wallet_invoice_rules (
  id           bigint generated always as identity primary key,
  match_column text not null check (match_column in ('card_type', 'branch')),
  match_value  text not null,
  action       text not null check (action in ('post', 'exclude')),
  account_id   bigint references public.wallet_accounts (id),
  priority     integer not null default 100,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  check ((action = 'post') = (account_id is not null))
);
create unique index wallet_invoice_rules_unique on public.wallet_invoice_rules (match_column, lower(btrim(match_value)));

create table public.wallet_transactions (
  id               bigint generated always as identity primary key,
  tx_type          text not null check (tx_type in ('company_budget', 'category_allocation', 'reallocation',
                     'top_up', 'expense', 'reversal', 'internal_transfer', 'carry_forward')),
  period_id        bigint not null references public.wallet_periods (id),
  amount           numeric(14, 2) not null check (amount > 0),
  reason           text,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  created_by_email text,
  -- who / what the movement is about (also in the postings; kept here for the audit trail)
  category_id      smallint references public.wallet_categories (id),
  to_category_id   smallint references public.wallet_categories (id),
  account_id       bigint references public.wallet_accounts (id),
  to_account_id    bigint references public.wallet_accounts (id),
  -- expense / reversal
  invoice_id       uuid references public.fuel_invoice_records (id) on delete restrict,
  invoice_snapshot jsonb,
  reverses_tx_id   bigint references public.wallet_transactions (id),
  reversal_kind    text check (reversal_kind in ('cancelled', 'rejected')),
  -- an expense or reversal whose own period was already closed
  is_adjustment    boolean not null default false,
  original_period_id bigint references public.wallet_periods (id),
  -- carry forward: the month the money comes from
  source_period_id bigint references public.wallet_periods (id),

  check (tx_type <> 'expense'  or (invoice_id is not null and account_id is not null and invoice_snapshot is not null)),
  check (tx_type <> 'reversal' or (invoice_id is not null and account_id is not null and reverses_tx_id is not null
                                   and reversal_kind is not null and reason is not null and invoice_snapshot is not null)),
  check ((tx_type = 'reversal') = (reversal_kind is not null)),
  check ((tx_type = 'reversal') = (reverses_tx_id is not null)),
  check (tx_type in ('expense', 'reversal') or invoice_id is null),
  check (tx_type <> 'top_up' or (account_id is not null and category_id is not null)),
  check (tx_type <> 'internal_transfer' or (account_id is not null and to_account_id is not null and account_id <> to_account_id)),
  check (tx_type <> 'reallocation' or (category_id is not null and to_category_id is not null and category_id <> to_category_id)),
  check (tx_type <> 'category_allocation' or category_id is not null),
  check ((tx_type = 'carry_forward') = (source_period_id is not null)),
  check (is_adjustment = (original_period_id is not null))
);

-- The database itself refuses a second expense or a second reversal for one invoice.
create unique index wallet_one_expense_per_invoice  on public.wallet_transactions (invoice_id) where tx_type = 'expense';
create unique index wallet_one_reversal_per_invoice on public.wallet_transactions (invoice_id) where tx_type = 'reversal';
create unique index wallet_one_reversal_per_expense on public.wallet_transactions (reverses_tx_id) where reverses_tx_id is not null;
create unique index wallet_one_budget_per_period    on public.wallet_transactions (period_id) where tx_type = 'company_budget';
create unique index wallet_one_carry_forward        on public.wallet_transactions (source_period_id, coalesce(category_id, 0)) where tx_type = 'carry_forward';
create index wallet_transactions_period on public.wallet_transactions (period_id, tx_type);

create table public.wallet_postings (
  id          bigint generated always as identity primary key,
  tx_id       bigint not null references public.wallet_transactions (id),
  pool        text not null check (pool in ('external', 'company', 'category', 'account', 'spent')),
  period_id   bigint references public.wallet_periods (id),
  category_id smallint references public.wallet_categories (id),
  account_id  bigint references public.wallet_accounts (id),
  amount      numeric(14, 2) not null check (amount <> 0),
  check (case pool
           when 'external' then period_id is null and category_id is null and account_id is null
           when 'company'  then period_id is not null and category_id is null and account_id is null
           when 'category' then period_id is not null and category_id is not null and account_id is null
           else                 period_id is null and category_id is not null and account_id is not null
         end)
);
create index wallet_postings_tx       on public.wallet_postings (tx_id);
create index wallet_postings_category on public.wallet_postings (period_id, category_id) where pool = 'category';
create index wallet_postings_company  on public.wallet_postings (period_id) where pool = 'company';
create index wallet_postings_account  on public.wallet_postings (account_id, pool);


-- ---------------------------------------------------------------------
-- 3) Guards (the database refuses what the rules forbid)
-- ---------------------------------------------------------------------

create function private.wallet_append_only() returns trigger
language plpgsql
as $$
begin
  raise exception 'WALLET_APPEND_ONLY: % rows cannot be changed or deleted', tg_table_name
    using errcode = '42501';
end;
$$;

create trigger wallet_transactions_append_only before update or delete on public.wallet_transactions
  for each row execute function private.wallet_append_only();
create trigger wallet_transactions_no_truncate before truncate on public.wallet_transactions
  for each statement execute function private.wallet_append_only();
create trigger wallet_postings_append_only before update or delete on public.wallet_postings
  for each row execute function private.wallet_append_only();
create trigger wallet_postings_no_truncate before truncate on public.wallet_postings
  for each statement execute function private.wallet_append_only();
create trigger wallet_account_allocations_append_only before update or delete on public.wallet_account_allocations
  for each row execute function private.wallet_append_only();
create trigger wallet_account_allocations_no_truncate before truncate on public.wallet_account_allocations
  for each statement execute function private.wallet_append_only();

-- A period can only go from open to closed, once.
create function private.wallet_period_guard() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'WALLET_PERIOD_CANNOT_BE_DELETED' using errcode = '42501';
  end if;
  if old.status <> 'open' or new.status <> 'closed' or new.month <> old.month then
    raise exception 'WALLET_PERIOD_ONLY_OPEN_TO_CLOSED' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger wallet_periods_guard before update or delete on public.wallet_periods
  for each row execute function private.wallet_period_guard();

-- Nothing is written into a closed period.
create function private.wallet_open_period_guard() returns trigger
language plpgsql
as $$
begin
  if new.period_id is not null
     and (select status from public.wallet_periods where id = new.period_id) <> 'open' then
    raise exception 'WALLET_PERIOD_CLOSED' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger wallet_transactions_open_period before insert on public.wallet_transactions
  for each row execute function private.wallet_open_period_guard();
create trigger wallet_postings_open_period before insert on public.wallet_postings
  for each row execute function private.wallet_open_period_guard();
create trigger wallet_account_allocations_open_period before insert on public.wallet_account_allocations
  for each row execute function private.wallet_open_period_guard();

-- Every movement has at least two postings, they add up to zero, and the money that
-- moves equals the movement's amount.  Checked at COMMIT, after all rows are in.
create function private.wallet_check_balanced() returns trigger
language plpgsql
as $$
declare
  v_tx_id bigint;
  v_n int; v_sum numeric; v_in numeric; v_amount numeric;
begin
  if tg_table_name = 'wallet_transactions' then
    v_tx_id := new.id;
  else
    v_tx_id := new.tx_id;
  end if;
  select count(*), coalesce(sum(amount), 0), coalesce(sum(amount) filter (where amount > 0), 0)
    into v_n, v_sum, v_in
    from public.wallet_postings where tx_id = v_tx_id;
  select amount into v_amount from public.wallet_transactions where id = v_tx_id;
  if v_n < 2 or v_sum <> 0 or v_in <> v_amount then
    raise exception 'WALLET_UNBALANCED_MOVEMENT: tx % has % postings, sum %, moved % of %',
      v_tx_id, v_n, v_sum, v_in, v_amount;
  end if;
  return null;
end;
$$;
create constraint trigger wallet_transactions_balanced after insert on public.wallet_transactions
  deferrable initially deferred for each row execute function private.wallet_check_balanced();
create constraint trigger wallet_postings_balanced after insert on public.wallet_postings
  deferrable initially deferred for each row execute function private.wallet_check_balanced();

-- An account cannot move to another category once money has touched it (history would
-- move with it).  Deleting an account is refused by the foreign keys.
create function private.wallet_account_guard() returns trigger
language plpgsql
as $$
begin
  if new.category_id <> old.category_id
     and exists (select 1 from public.wallet_postings where account_id = old.id) then
    raise exception 'WALLET_ACCOUNT_CATEGORY_LOCKED' using errcode = '42501';
  end if;
  if new.code <> old.code then
    raise exception 'WALLET_ACCOUNT_CODE_LOCKED' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger wallet_accounts_guard before update on public.wallet_accounts
  for each row execute function private.wallet_account_guard();


-- ---------------------------------------------------------------------
-- 4) Internal building blocks
-- ---------------------------------------------------------------------

-- The period row for a month, created (open) on first use.  Months before the wallet
-- start are refused.
create function private.wallet_period_for(p_month date) returns public.wallet_periods
language plpgsql
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_row public.wallet_periods;
begin
  if p_month is null then
    raise exception 'WALLET_MONTH_REQUIRED';
  end if;
  if v_month < (select start_month from public.wallet_settings) then
    raise exception 'WALLET_BEFORE_START' using hint = (select start_month from public.wallet_settings)::text;
  end if;
  insert into public.wallet_periods (month, created_by) values (v_month, auth.uid())
    on conflict (month) do nothing;
  select * into v_row from public.wallet_periods where month = v_month;
  return v_row;
end;
$$;

create function private.wallet_open_period_for(p_month date) returns public.wallet_periods
language plpgsql
as $$
declare v_row public.wallet_periods := private.wallet_period_for(p_month);
begin
  if v_row.status <> 'open' then
    raise exception 'WALLET_PERIOD_CLOSED' using hint = v_row.month::text, errcode = '42501';
  end if;
  return v_row;
end;
$$;

-- Budget-pool operations of one period run one at a time, so two top-ups cannot both
-- pass the "enough undistributed budget" check.
create function private.wallet_lock_period(p_period_id bigint) returns void
language sql
as $$ select pg_advisory_xact_lock(hashtext('wallet.period'), p_period_id::int) $$;

create function private.wallet_lock_account(p_account_id bigint) returns void
language sql
as $$ select pg_advisory_xact_lock(hashtext('wallet.account'), p_account_id::int) $$;

create function private.wallet_lock_invoice(p_invoice_id uuid) returns void
language sql
as $$ select pg_advisory_xact_lock(hashtext('wallet.invoice'), hashtext(p_invoice_id::text)) $$;

create function private.wallet_company_balance(p_period_id bigint) returns numeric
language sql stable
as $$
  select coalesce(sum(amount), 0) from public.wallet_postings where pool = 'company' and period_id = p_period_id
$$;

create function private.wallet_undistributed(p_period_id bigint, p_category_id smallint) returns numeric
language sql stable
as $$
  select coalesce(sum(amount), 0) from public.wallet_postings
   where pool = 'category' and period_id = p_period_id and category_id = p_category_id
$$;

create function private.wallet_account_balance(p_account_id bigint) returns numeric
language sql stable
as $$
  select coalesce(sum(amount), 0) from public.wallet_postings where pool = 'account' and account_id = p_account_id
$$;

-- The movements of a month and every month before it.  Balances "as of" a month use only
-- these, so a later adjustment never changes what a closed month shows.
create function private.wallet_tx_through(p_month date) returns setof public.wallet_transactions
language sql stable
as $$
  select t.* from public.wallet_transactions t join public.wallet_periods p on p.id = t.period_id
   where p.month <= date_trunc('month', p_month)::date
$$;

create function private.wallet_account_balance_asof(p_account_id bigint, p_month date) returns numeric
language sql stable
as $$
  select coalesce(sum(x.amount), 0) from public.wallet_postings x
    join private.wallet_tx_through(p_month) t on t.id = x.tx_id
   where x.pool = 'account' and x.account_id = p_account_id
$$;

create function private.wallet_category_id(p_code text) returns smallint
language plpgsql stable
as $$
declare v_id smallint;
begin
  select id into v_id from public.wallet_categories where code = lower(btrim(p_code));
  if v_id is null then
    raise exception 'WALLET_UNKNOWN_CATEGORY' using hint = coalesce(p_code, '');
  end if;
  return v_id;
end;
$$;

create function private.wallet_account(p_code text) returns public.wallet_accounts
language plpgsql stable
as $$
declare v_row public.wallet_accounts;
begin
  select * into v_row from public.wallet_accounts where code = btrim(p_code);
  if v_row.id is null then
    raise exception 'WALLET_UNKNOWN_ACCOUNT' using hint = coalesce(p_code, '');
  end if;
  return v_row;
end;
$$;

-- Writes one movement and its postings.  p_postings: [{pool, period_id, category_id, account_id, amount}]
create function private.wallet_insert_tx(p_tx jsonb, p_postings jsonb) returns bigint
language plpgsql
as $$
declare v_id bigint;
begin
  insert into public.wallet_transactions (
    tx_type, period_id, amount, reason, created_by, created_by_email,
    category_id, to_category_id, account_id, to_account_id,
    invoice_id, invoice_snapshot, reverses_tx_id, reversal_kind,
    is_adjustment, original_period_id, source_period_id)
  values (
    p_tx ->> 'tx_type', (p_tx ->> 'period_id')::bigint, (p_tx ->> 'amount')::numeric, p_tx ->> 'reason',
    auth.uid(), (select auth.jwt()) ->> 'email',
    (p_tx ->> 'category_id')::smallint, (p_tx ->> 'to_category_id')::smallint,
    (p_tx ->> 'account_id')::bigint, (p_tx ->> 'to_account_id')::bigint,
    (p_tx ->> 'invoice_id')::uuid, p_tx -> 'invoice_snapshot', (p_tx ->> 'reverses_tx_id')::bigint, p_tx ->> 'reversal_kind',
    coalesce((p_tx ->> 'is_adjustment')::boolean, false), (p_tx ->> 'original_period_id')::bigint,
    (p_tx ->> 'source_period_id')::bigint)
  returning id into v_id;

  insert into public.wallet_postings (tx_id, pool, period_id, category_id, account_id, amount)
  select v_id, p ->> 'pool', (p ->> 'period_id')::bigint, (p ->> 'category_id')::smallint,
         (p ->> 'account_id')::bigint, (p ->> 'amount')::numeric
    from jsonb_array_elements(p_postings) p;

  return v_id;
end;
$$;

-- Which rule applies to an invoice: the lowest priority number wins; on a tie a Branch
-- rule beats a Card Type rule.  Comparison ignores case and surrounding spaces.
create function private.wallet_invoice_rule(p_invoice public.fuel_invoice_records) returns public.wallet_invoice_rules
language sql stable
as $$
  select r.* from public.wallet_invoice_rules r
   where r.is_active
     and ((r.match_column = 'branch'    and lower(btrim(r.match_value)) = lower(btrim(p_invoice.branch)))
       or (r.match_column = 'card_type' and lower(btrim(r.match_value)) = lower(btrim(p_invoice.card_type))))
   order by r.priority, (r.match_column = 'branch') desc, r.id
   limit 1
$$;

-- Where a movement about an old month goes: its own period while that is open,
-- otherwise the open period of today's month, marked as an adjustment.
create function private.wallet_target_period(p_period public.wallet_periods, out period_id bigint, out original_period_id bigint)
language plpgsql
as $$
begin
  if p_period.status = 'open' then
    period_id := p_period.id;
    original_period_id := null;
  else
    period_id := (private.wallet_open_period_for(private.wallet_today())).id;
    original_period_id := p_period.id;
  end if;
end;
$$;

-- Posts one invoice as an expense if it should be.  Never raises for "not postable":
-- it returns why instead, so saving an invoice never fails because of the wallet.
create function private.wallet_try_post_invoice(p_invoice_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.fuel_invoice_records;
  v_rule public.wallet_invoice_rules;
  v_acc public.wallet_accounts;
  v_month date;
  v_period public.wallet_periods;
  v_target record;
  v_amount numeric;
begin
  perform private.wallet_lock_invoice(p_invoice_id);
  if exists (select 1 from public.wallet_transactions where invoice_id = p_invoice_id and tx_type = 'expense') then
    return 'already_posted';
  end if;
  select * into v_inv from public.fuel_invoice_records where id = p_invoice_id;
  if v_inv.id is null then
    return 'missing';
  end if;
  v_month := date_trunc('month', coalesce(v_inv.entry_date, (v_inv.created_at at time zone 'Asia/Riyadh')::date))::date;
  if v_month < (select start_month from public.wallet_settings) then
    return 'before_start';
  end if;
  v_rule := private.wallet_invoice_rule(v_inv);
  if v_rule.id is null then
    return 'no_rule';
  end if;
  if v_rule.action = 'exclude' then
    return 'excluded';
  end if;
  select * into v_acc from public.wallet_accounts where id = v_rule.account_id;
  if not v_acc.is_active then
    return 'inactive_account';
  end if;
  v_amount := round(v_inv.cost, 2);
  if v_amount is null or v_amount <= 0 then
    return 'missing_cost';
  end if;

  v_period := private.wallet_period_for(v_month);
  v_target := private.wallet_target_period(v_period);

  perform private.wallet_insert_tx(
    jsonb_build_object('tx_type', 'expense', 'period_id', v_target.period_id, 'amount', v_amount,
      'account_id', v_acc.id, 'category_id', v_acc.category_id, 'invoice_id', v_inv.id,
      'invoice_snapshot', to_jsonb(v_inv),
      'is_adjustment', v_target.original_period_id is not null, 'original_period_id', v_target.original_period_id),
    jsonb_build_array(
      jsonb_build_object('pool', 'account', 'category_id', v_acc.category_id, 'account_id', v_acc.id, 'amount', -v_amount),
      jsonb_build_object('pool', 'spent',   'category_id', v_acc.category_id, 'account_id', v_acc.id, 'amount',  v_amount)));
  return 'posted';
end;
$$;


-- ---------------------------------------------------------------------
-- 5) Invoices: post on save, lock once posted
-- ---------------------------------------------------------------------

create function private.wallet_invoice_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.wallet_transactions where invoice_id = old.id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'WALLET_INVOICE_POSTED_CANNOT_DELETE' using errcode = '42501',
      hint = 'Cancel or reject the invoice instead.';
  end if;
  if new.cost is distinct from old.cost or new.amount is distinct from old.amount or new.vat is distinct from old.vat
     or new.card_type is distinct from old.card_type or new.branch is distinct from old.branch
     or new.entry_date is distinct from old.entry_date or new.id is distinct from old.id then
    raise exception 'WALLET_INVOICE_POSTED_LOCKED' using errcode = '42501',
      hint = 'cost, amount, vat, card_type, branch and entry_date cannot change after posting; cancel and re-enter instead.';
  end if;
  return new;
end;
$$;
create trigger wallet_invoice_guard before update or delete on public.fuel_invoice_records
  for each row execute function private.wallet_invoice_guard();

create function private.wallet_invoice_post() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.wallet_try_post_invoice(new.id);
  return null;
end;
$$;
create trigger wallet_invoice_post after insert or update on public.fuel_invoice_records
  for each row execute function private.wallet_invoice_post();


-- ---------------------------------------------------------------------
-- 6) Operations (main admin; each call is one database transaction)
-- ---------------------------------------------------------------------

create function public.wallet_set_company_budget(p_month date, p_amount numeric, p_reason text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_period public.wallet_periods; v_amount numeric := private.wallet_require_amount(p_amount);
begin
  perform private.wallet_require_admin();
  v_period := private.wallet_open_period_for(p_month);
  perform private.wallet_lock_period(v_period.id);
  if exists (select 1 from public.wallet_transactions where period_id = v_period.id and tx_type = 'company_budget') then
    raise exception 'WALLET_BUDGET_ALREADY_SET' using hint = v_period.month::text;
  end if;
  return private.wallet_insert_tx(
    jsonb_build_object('tx_type', 'company_budget', 'period_id', v_period.id, 'amount', v_amount, 'reason', nullif(btrim(p_reason), '')),
    jsonb_build_array(
      jsonb_build_object('pool', 'external', 'amount', -v_amount),
      jsonb_build_object('pool', 'company', 'period_id', v_period.id, 'amount', v_amount)));
end;
$$;

create function public.wallet_allocate_category(p_month date, p_category text, p_amount numeric, p_reason text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.wallet_periods; v_cat smallint := private.wallet_category_id(p_category);
  v_amount numeric := private.wallet_require_amount(p_amount); v_available numeric;
begin
  perform private.wallet_require_admin();
  v_period := private.wallet_open_period_for(p_month);
  perform private.wallet_lock_period(v_period.id);
  v_available := private.wallet_company_balance(v_period.id);
  if v_amount > v_available then
    raise exception 'WALLET_ALLOCATION_EXCEEDS_COMPANY_BUDGET' using hint = v_available::text;
  end if;
  return private.wallet_insert_tx(
    jsonb_build_object('tx_type', 'category_allocation', 'period_id', v_period.id, 'amount', v_amount,
      'category_id', v_cat, 'reason', nullif(btrim(p_reason), '')),
    jsonb_build_array(
      jsonb_build_object('pool', 'company',  'period_id', v_period.id, 'amount', -v_amount),
      jsonb_build_object('pool', 'category', 'period_id', v_period.id, 'category_id', v_cat, 'amount', v_amount)));
end;
$$;

create function public.wallet_set_account_allocation(p_month date, p_account text, p_amount numeric, p_reason text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_period public.wallet_periods; v_acc public.wallet_accounts := private.wallet_account(p_account); v_id bigint;
begin
  perform private.wallet_require_admin();
  if p_amount is null or p_amount < 0 then
    raise exception 'WALLET_AMOUNT_MUST_NOT_BE_NEGATIVE';
  end if;
  v_period := private.wallet_open_period_for(p_month);
  insert into public.wallet_account_allocations (period_id, account_id, amount, reason, created_by, created_by_email)
    values (v_period.id, v_acc.id, round(p_amount, 2), nullif(btrim(p_reason), ''), auth.uid(), (select auth.jwt()) ->> 'email')
    returning id into v_id;
  return v_id;
end;
$$;

-- Returns {tx_id, allocation, top_ups, over_allocation, undistributed_after}.
create function public.wallet_top_up(p_month date, p_account text, p_amount numeric, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.wallet_periods; v_acc public.wallet_accounts := private.wallet_account(p_account);
  v_amount numeric := private.wallet_require_amount(p_amount); v_available numeric;
  v_tx bigint; v_alloc numeric; v_top_ups numeric;
begin
  perform private.wallet_require_admin();
  if not v_acc.is_active then
    raise exception 'WALLET_ACCOUNT_INACTIVE' using hint = v_acc.code;
  end if;
  v_period := private.wallet_open_period_for(p_month);
  perform private.wallet_lock_period(v_period.id);
  v_available := private.wallet_undistributed(v_period.id, v_acc.category_id);
  if v_amount > v_available then
    raise exception 'WALLET_TOPUP_EXCEEDS_UNDISTRIBUTED' using hint = v_available::text;
  end if;
  v_tx := private.wallet_insert_tx(
    jsonb_build_object('tx_type', 'top_up', 'period_id', v_period.id, 'amount', v_amount,
      'account_id', v_acc.id, 'category_id', v_acc.category_id, 'reason', nullif(btrim(p_reason), '')),
    jsonb_build_array(
      jsonb_build_object('pool', 'category', 'period_id', v_period.id, 'category_id', v_acc.category_id, 'amount', -v_amount),
      jsonb_build_object('pool', 'account', 'category_id', v_acc.category_id, 'account_id', v_acc.id, 'amount', v_amount)));

  select amount into v_alloc from public.wallet_account_allocations
   where period_id = v_period.id and account_id = v_acc.id order by id desc limit 1;
  select coalesce(sum(amount), 0) into v_top_ups from public.wallet_transactions
   where period_id = v_period.id and tx_type = 'top_up' and account_id = v_acc.id;
  return jsonb_build_object('tx_id', v_tx, 'allocation', v_alloc, 'top_ups', v_top_ups,
    'over_allocation', v_alloc is not null and v_top_ups > v_alloc,
    'undistributed_after', v_available - v_amount);
end;
$$;

create function public.wallet_reallocate(p_month date, p_from_category text, p_to_category text, p_amount numeric, p_reason text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.wallet_periods; v_from smallint := private.wallet_category_id(p_from_category);
  v_to smallint := private.wallet_category_id(p_to_category);
  v_amount numeric := private.wallet_require_amount(p_amount); v_reason text := private.wallet_require_reason(p_reason);
  v_available numeric;
begin
  perform private.wallet_require_admin();
  if v_from = v_to then
    raise exception 'WALLET_SAME_CATEGORY';
  end if;
  v_period := private.wallet_open_period_for(p_month);
  perform private.wallet_lock_period(v_period.id);
  v_available := private.wallet_undistributed(v_period.id, v_from);
  if v_amount > v_available then
    raise exception 'WALLET_REALLOCATION_EXCEEDS_UNDISTRIBUTED' using hint = v_available::text;
  end if;
  return private.wallet_insert_tx(
    jsonb_build_object('tx_type', 'reallocation', 'period_id', v_period.id, 'amount', v_amount,
      'category_id', v_from, 'to_category_id', v_to, 'reason', v_reason),
    jsonb_build_array(
      jsonb_build_object('pool', 'category', 'period_id', v_period.id, 'category_id', v_from, 'amount', -v_amount),
      jsonb_build_object('pool', 'category', 'period_id', v_period.id, 'category_id', v_to,   'amount',  v_amount)));
end;
$$;

-- Same category only; cannot take the source account below zero.  Recorded in today's month.
create function public.wallet_transfer(p_from_account text, p_to_account text, p_amount numeric, p_reason text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.wallet_accounts := private.wallet_account(p_from_account);
  v_to public.wallet_accounts := private.wallet_account(p_to_account);
  v_amount numeric := private.wallet_require_amount(p_amount); v_reason text := private.wallet_require_reason(p_reason);
  v_period public.wallet_periods; v_available numeric;
begin
  perform private.wallet_require_admin();
  if v_from.id = v_to.id then
    raise exception 'WALLET_SAME_ACCOUNT';
  end if;
  if v_from.category_id <> v_to.category_id then
    raise exception 'WALLET_TRANSFER_ACROSS_CATEGORIES' using hint = 'Use a reallocation between categories.';
  end if;
  if not v_to.is_active then
    raise exception 'WALLET_ACCOUNT_INACTIVE' using hint = v_to.code;
  end if;
  v_period := private.wallet_open_period_for(private.wallet_today());
  perform private.wallet_lock_account(least(v_from.id, v_to.id));
  perform private.wallet_lock_account(greatest(v_from.id, v_to.id));
  v_available := private.wallet_account_balance(v_from.id);
  if v_amount > v_available then
    raise exception 'WALLET_TRANSFER_EXCEEDS_BALANCE' using hint = v_available::text;
  end if;
  return private.wallet_insert_tx(
    jsonb_build_object('tx_type', 'internal_transfer', 'period_id', v_period.id, 'amount', v_amount,
      'account_id', v_from.id, 'to_account_id', v_to.id, 'category_id', v_from.category_id, 'reason', v_reason),
    jsonb_build_array(
      jsonb_build_object('pool', 'account', 'category_id', v_from.category_id, 'account_id', v_from.id, 'amount', -v_amount),
      jsonb_build_object('pool', 'account', 'category_id', v_to.category_id,   'account_id', v_to.id,   'amount',  v_amount)));
end;
$$;

-- Cancel or reject a posted invoice: one reversal, linked to the expense.  Returns
-- {tx_id, period_month, is_adjustment, balance_after}.
create function public.wallet_reverse_invoice(p_invoice_id uuid, p_kind text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := private.wallet_require_reason(p_reason);
  v_expense public.wallet_transactions; v_inv public.fuel_invoice_records;
  v_period public.wallet_periods; v_target record; v_tx bigint;
begin
  perform private.wallet_require_admin();
  if p_kind is null or p_kind not in ('cancelled', 'rejected') then
    raise exception 'WALLET_BAD_REVERSAL_KIND' using hint = coalesce(p_kind, '');
  end if;
  perform private.wallet_lock_invoice(p_invoice_id);
  select * into v_expense from public.wallet_transactions where invoice_id = p_invoice_id and tx_type = 'expense';
  if v_expense.id is null then
    raise exception 'WALLET_INVOICE_NOT_POSTED';
  end if;
  if exists (select 1 from public.wallet_transactions where invoice_id = p_invoice_id and tx_type = 'reversal') then
    raise exception 'WALLET_INVOICE_ALREADY_REVERSED';
  end if;
  select * into v_inv from public.fuel_invoice_records where id = p_invoice_id;
  select * into v_period from public.wallet_periods where id = v_expense.period_id;
  v_target := private.wallet_target_period(v_period);

  v_tx := private.wallet_insert_tx(
    jsonb_build_object('tx_type', 'reversal', 'period_id', v_target.period_id, 'amount', v_expense.amount,
      'account_id', v_expense.account_id, 'category_id', v_expense.category_id, 'invoice_id', p_invoice_id,
      'invoice_snapshot', to_jsonb(v_inv), 'reverses_tx_id', v_expense.id, 'reversal_kind', p_kind, 'reason', v_reason,
      'is_adjustment', v_target.original_period_id is not null, 'original_period_id', v_target.original_period_id),
    jsonb_build_array(
      jsonb_build_object('pool', 'spent',   'category_id', v_expense.category_id, 'account_id', v_expense.account_id, 'amount', -v_expense.amount),
      jsonb_build_object('pool', 'account', 'category_id', v_expense.category_id, 'account_id', v_expense.account_id, 'amount',  v_expense.amount)));

  return jsonb_build_object('tx_id', v_tx,
    'period_month', (select month from public.wallet_periods where id = v_target.period_id),
    'is_adjustment', v_target.original_period_id is not null,
    'balance_after', private.wallet_account_balance(v_expense.account_id));
end;
$$;

-- Posts every unposted invoice that has a rule now (after rules or accounts were fixed).
-- Returns how many were posted.
create function public.wallet_post_pending_invoices()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare r record; v_n int := 0;
begin
  perform private.wallet_require_admin();
  for r in
    select i.id from public.fuel_invoice_records i
     where not exists (select 1 from public.wallet_transactions t where t.invoice_id = i.id and t.tx_type = 'expense')
       and coalesce(i.entry_date, (i.created_at at time zone 'Asia/Riyadh')::date) >= (select start_month from public.wallet_settings)
     order by i.created_at, i.id
  loop
    if private.wallet_try_post_invoice(r.id) = 'posted' then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- Closes a month: carries what is left to the next month (visible movements), then closes.
create function public.wallet_close_period(p_month date, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.wallet_periods; v_next public.wallet_periods; c record; v_left numeric;
  v_moved jsonb := '[]'::jsonb;
begin
  perform private.wallet_require_admin();
  v_period := private.wallet_open_period_for(p_month);
  v_next := private.wallet_open_period_for((v_period.month + interval '1 month')::date);
  perform private.wallet_lock_period(v_period.id);
  perform private.wallet_lock_period(v_next.id);

  for c in select id, code from public.wallet_categories order by sort loop
    v_left := private.wallet_undistributed(v_period.id, c.id);
    if v_left > 0 then
      perform private.wallet_insert_tx(
        jsonb_build_object('tx_type', 'carry_forward', 'period_id', v_next.id, 'amount', v_left,
          'category_id', c.id, 'source_period_id', v_period.id, 'reason', nullif(btrim(p_reason), '')),
        jsonb_build_array(
          jsonb_build_object('pool', 'category', 'period_id', v_period.id, 'category_id', c.id, 'amount', -v_left),
          jsonb_build_object('pool', 'category', 'period_id', v_next.id,   'category_id', c.id, 'amount',  v_left)));
      v_moved := v_moved || jsonb_build_object('category', c.code, 'amount', v_left);
    end if;
  end loop;

  v_left := private.wallet_company_balance(v_period.id);
  if v_left > 0 then
    perform private.wallet_insert_tx(
      jsonb_build_object('tx_type', 'carry_forward', 'period_id', v_next.id, 'amount', v_left,
        'source_period_id', v_period.id, 'reason', nullif(btrim(p_reason), '')),
      jsonb_build_array(
        jsonb_build_object('pool', 'company', 'period_id', v_period.id, 'amount', -v_left),
        jsonb_build_object('pool', 'company', 'period_id', v_next.id,   'amount',  v_left)));
    v_moved := v_moved || jsonb_build_object('category', null, 'amount', v_left);
  end if;

  update public.wallet_periods
     set status = 'closed', closed_at = now(), closed_by = auth.uid(),
         closed_by_email = (select auth.jwt()) ->> 'email', close_reason = nullif(btrim(p_reason), '')
   where id = v_period.id;

  return jsonb_build_object('closed', v_period.month, 'next', v_next.month, 'carried', v_moved);
end;
$$;


-- ---------------------------------------------------------------------
-- 7) Reads for the Wallet Overview (admin, fleet manager, viewer)
-- ---------------------------------------------------------------------

-- Per category for one month.  Header amounts come from wallet_transactions; balances
-- from wallet_postings, so the reconciliation compares two independent sources.
create function public.wallet_category_summary(p_month date)
returns table (category_id smallint, code text, name_en text, name_ar text,
               allocated numeric, carried_in numeric, reallocated_in numeric, reallocated_out numeric,
               effective_allocation numeric, top_ups numeric, undistributed numeric, carried_out numeric)
language plpgsql stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare v_pid bigint;
begin
  perform private.wallet_require_reader();
  select id into v_pid from public.wallet_periods where month = date_trunc('month', p_month)::date;
  return query
  with t as (select * from public.wallet_transactions where v_pid is not null and (period_id = v_pid or source_period_id = v_pid))
  select c.id, c.code, c.name_en, c.name_ar,
         coalesce(sum(t.amount) filter (where t.tx_type = 'category_allocation' and t.category_id = c.id), 0),
         coalesce(sum(t.amount) filter (where t.tx_type = 'carry_forward' and t.period_id = v_pid and t.category_id = c.id), 0),
         coalesce(sum(t.amount) filter (where t.tx_type = 'reallocation' and t.to_category_id = c.id), 0),
         coalesce(sum(t.amount) filter (where t.tx_type = 'reallocation' and t.category_id = c.id), 0),
         coalesce(sum(t.amount) filter (where t.tx_type = 'category_allocation' and t.category_id = c.id), 0)
           + coalesce(sum(t.amount) filter (where t.tx_type = 'carry_forward' and t.period_id = v_pid and t.category_id = c.id), 0)
           + coalesce(sum(t.amount) filter (where t.tx_type = 'reallocation' and t.to_category_id = c.id), 0)
           - coalesce(sum(t.amount) filter (where t.tx_type = 'reallocation' and t.category_id = c.id), 0),
         coalesce(sum(t.amount) filter (where t.tx_type = 'top_up' and t.category_id = c.id), 0),
         case when v_pid is null then 0::numeric else private.wallet_undistributed(v_pid, c.id) end,
         coalesce(sum(t.amount) filter (where t.tx_type = 'carry_forward' and t.source_period_id = v_pid and t.category_id = c.id), 0)
    from public.wallet_categories c
    left join t on true
   group by c.id, c.code, c.name_en, c.name_ar, c.sort
   order by c.sort;
end;
$$;

-- Per account: this month's movements, the balance at the end of the month (or so far, for
-- the current month) and the balance right now.
create function public.wallet_account_summary(p_month date)
returns table (account_id bigint, code text, name text, category_code text, is_active boolean,
               allocation numeric, top_ups numeric, expenses numeric, reversals numeric,
               transfers_in numeric, transfers_out numeric, balance numeric, balance_now numeric,
               over_allocation boolean, negative_balance boolean)
language plpgsql stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare v_pid bigint;
begin
  perform private.wallet_require_reader();
  select id into v_pid from public.wallet_periods where month = date_trunc('month', p_month)::date;
  return query
  select a.id, a.code, a.name, c.code, a.is_active, al.amount,
         coalesce(m.top_ups, 0), coalesce(m.expenses, 0), coalesce(m.reversals, 0),
         coalesce(m.t_in, 0), coalesce(m.t_out, 0), b.balance, b.balance_now,
         al.amount is not null and coalesce(m.top_ups, 0) > al.amount,
         b.balance < 0
    from public.wallet_accounts a
    join public.wallet_categories c on c.id = a.category_id
    cross join lateral (select private.wallet_account_balance_asof(a.id, p_month) as balance,
                               private.wallet_account_balance(a.id) as balance_now) b
    left join lateral (
      select x.amount from public.wallet_account_allocations x
       where x.period_id = v_pid and x.account_id = a.id order by x.id desc limit 1) al on true
    left join lateral (
      select sum(t.amount) filter (where t.tx_type = 'top_up') as top_ups,
             sum(t.amount) filter (where t.tx_type = 'expense') as expenses,
             sum(t.amount) filter (where t.tx_type = 'reversal') as reversals,
             sum(t.amount) filter (where t.tx_type = 'internal_transfer' and t.to_account_id = a.id) as t_in,
             sum(t.amount) filter (where t.tx_type = 'internal_transfer' and t.account_id = a.id) as t_out
        from public.wallet_transactions t
       where t.period_id = v_pid and (t.account_id = a.id or t.to_account_id = a.id)) m on true
   order by c.sort, a.code;
end;
$$;

-- The eight indicators of the Wallet Overview for one month.
create function public.wallet_overview(p_month date)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare v_p public.wallet_periods; v jsonb;
begin
  perform private.wallet_require_reader();
  select * into v_p from public.wallet_periods where month = date_trunc('month', p_month)::date;
  with t as (select * from public.wallet_transactions where v_p.id is not null and period_id = v_p.id),
       cats as (select * from public.wallet_category_summary(p_month))
  select jsonb_build_object(
    'month', date_trunc('month', p_month)::date,
    'period_status', coalesce(v_p.status, 'none'),
    'company_budget',           (select coalesce(sum(amount) filter (where tx_type = 'company_budget'), 0) from t),
    'company_carried_in',       (select coalesce(sum(amount) filter (where tx_type = 'carry_forward' and category_id is null), 0) from t),
    'company_unallocated',      case when v_p.id is null then 0 else private.wallet_company_balance(v_p.id) end,
    'total_category_allocations', (select coalesce(sum(effective_allocation), 0) from cats),
    'total_undistributed',      (select coalesce(sum(undistributed), 0) from cats),
    'total_distributed_to_accounts', (select coalesce(sum(amount) filter (where tx_type = 'top_up'), 0) from t),
    'total_account_balances',   (select coalesce(sum(x.amount), 0) from public.wallet_postings x
                                   join private.wallet_tx_through(p_month) tt on tt.id = x.tx_id where x.pool = 'account'),
    'total_expenses',           (select coalesce(sum(amount) filter (where tx_type = 'expense'), 0) from t),
    'total_internal_transfers', (select coalesce(sum(amount) filter (where tx_type = 'internal_transfer'), 0) from t),
    'total_reversed_expenses',  (select coalesce(sum(amount) filter (where tx_type = 'reversal'), 0) from t),
    'adjustments',              (select count(*) from t where is_adjustment),
    'accounts_over_allocation', (select count(*) from public.wallet_account_summary(p_month) where over_allocation),
    'accounts_negative',        (select count(*) from public.wallet_account_summary(p_month) where negative_balance),
    'unposted_invoices',        (select count(*) from private.wallet_unposted_rows())
  ) into v;
  return v;
end;
$$;

-- The reconciliation equations with the actual numbers: left and right side of each
-- check, one row per check (and per category where the check is per category).
create function private.wallet_reconciliation_rows(p_month date)
returns table (check_code text, scope text, left_value numeric, right_value numeric)
language plpgsql stable
as $$
#variable_conflict use_column
declare v_pid bigint;
begin
  select id into v_pid from public.wallet_periods where month = date_trunc('month', p_month)::date;

  -- 1) Company Budget + carry forward in = category allocations + unallocated (+ carried out)
  return query
  with t as (select * from public.wallet_transactions where v_pid is not null and (period_id = v_pid or source_period_id = v_pid))
  select 'company_budget'::text, 'company'::text,
         coalesce(sum(amount) filter (where tx_type = 'company_budget' and period_id = v_pid), 0)
           + coalesce(sum(amount) filter (where tx_type = 'carry_forward' and category_id is null and period_id = v_pid), 0),
         coalesce(sum(amount) filter (where tx_type = 'category_allocation' and period_id = v_pid), 0)
           + case when v_pid is null then 0 else private.wallet_company_balance(v_pid) end
           + coalesce(sum(amount) filter (where tx_type = 'carry_forward' and category_id is null and source_period_id = v_pid), 0)
    from t;

  -- 2) per category: allocation (after reallocation, + carried in) = undistributed + top-ups (+ carried out)
  return query
  select 'category_allocation'::text, s.code, s.effective_allocation, s.undistributed + s.top_ups + s.carried_out
    from public.wallet_category_summary(p_month) s;

  -- 3) per category and total, from the start through this month:
  --    top-ups = account balances + (expenses - reversals)
  return query
  with tx as (
    select c.code,
           coalesce(sum(t.amount) filter (where t.tx_type = 'top_up'), 0) as top_ups,
           coalesce(sum(t.amount) filter (where t.tx_type = 'expense'), 0) as expenses,
           coalesce(sum(t.amount) filter (where t.tx_type = 'reversal'), 0) as reversals
      from public.wallet_categories c
      left join private.wallet_tx_through(p_month) t on t.category_id = c.id
     group by c.code, c.sort),
  bal as (
    select c.code, coalesce(sum(p.amount), 0) as balances
      from public.wallet_categories c
      left join (public.wallet_postings p join private.wallet_tx_through(p_month) tt on tt.id = p.tx_id)
             on p.pool = 'account' and p.category_id = c.id
     group by c.code)
  select 'top_ups_vs_balances'::text, tx.code, tx.top_ups, bal.balances + tx.expenses - tx.reversals
    from tx join bal using (code)
  union all
  select 'top_ups_vs_balances', 'total', sum(tx.top_ups), sum(bal.balances + tx.expenses - tx.reversals)
    from tx join bal using (code);

  -- 4) internal transfers and reallocations move money, never create or remove it
  return query
  select 'transfers_net_zero'::text, 'company'::text,
         coalesce(sum(p.amount), 0), 0::numeric
    from public.wallet_postings p join public.wallet_transactions t on t.id = p.tx_id
   where t.tx_type in ('internal_transfer', 'reallocation') and (v_pid is null or t.period_id = v_pid);

  -- 5) every movement balances (should always be 0 because of the commit check)
  return query
  select 'unbalanced_movements'::text, 'company'::text, count(*)::numeric, 0::numeric
    from (select tx_id from public.wallet_postings group by tx_id having sum(amount) <> 0) u;
end;
$$;

create function public.wallet_reconciliation(p_month date)
returns table (check_code text, scope text, left_value numeric, right_value numeric, ok boolean)
language plpgsql stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.wallet_require_reader();
  return query
  select r.check_code, r.scope, r.left_value, r.right_value, r.left_value = r.right_value
    from private.wallet_reconciliation_rows(p_month) r;
end;
$$;

-- Invoices from the wallet start that are not posted and not excluded, with the reason.
create function private.wallet_unposted_rows()
returns table (invoice_id uuid, invoice_number text, entry_date date, card_type text, branch text, cost numeric, reason text)
language plpgsql stable
as $$
#variable_conflict use_column
begin
  return query
  select i.id, i.invoice_number, i.entry_date, i.card_type, i.branch, i.cost,
         case when r.id is null then 'no_rule'
              when not a.is_active then 'inactive_account'
              when i.cost is null or round(i.cost, 2) <= 0 then 'missing_cost'
              else 'not_posted' end
    from public.fuel_invoice_records i
    left join lateral (select * from private.wallet_invoice_rule(i)) r on true
    left join public.wallet_accounts a on a.id = r.account_id
   where coalesce(i.entry_date, (i.created_at at time zone 'Asia/Riyadh')::date) >= (select start_month from public.wallet_settings)
     and not exists (select 1 from public.wallet_transactions t where t.invoice_id = i.id and t.tx_type = 'expense')
     and (r.id is null or r.action <> 'exclude')
   order by i.entry_date, i.invoice_number;
end;
$$;

-- The list shows invoice details, which a viewer cannot read (053): admin and fleet manager
-- only.  The overview gives everyone the count.
create function public.wallet_unposted_invoices()
returns table (invoice_id uuid, invoice_number text, entry_date date, card_type text, branch text, cost numeric, reason text)
language plpgsql stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not (coalesce(private.is_admin(), false) or coalesce(private.is_fleet_manager(), false)) then
    raise exception 'WALLET_NO_ACCESS' using errcode = '42501';
  end if;
  return query select * from private.wallet_unposted_rows();
end;
$$;


-- ---------------------------------------------------------------------
-- 8) Access
-- ---------------------------------------------------------------------

alter table public.wallet_settings            enable row level security;
alter table public.wallet_periods             enable row level security;
alter table public.wallet_categories          enable row level security;
alter table public.wallet_accounts            enable row level security;
alter table public.wallet_account_allocations enable row level security;
alter table public.wallet_invoice_rules       enable row level security;
alter table public.wallet_transactions        enable row level security;
alter table public.wallet_postings            enable row level security;

revoke all on public.wallet_settings, public.wallet_periods, public.wallet_categories, public.wallet_accounts,
              public.wallet_account_allocations, public.wallet_invoice_rules, public.wallet_transactions,
              public.wallet_postings from public, anon, authenticated;

grant select on public.wallet_settings, public.wallet_periods, public.wallet_categories, public.wallet_accounts,
                public.wallet_account_allocations, public.wallet_invoice_rules, public.wallet_transactions,
                public.wallet_postings to authenticated;

create policy "wallet read" on public.wallet_settings            for select to authenticated using (private.wallet_can_read());
create policy "wallet read" on public.wallet_periods             for select to authenticated using (private.wallet_can_read());
create policy "wallet read" on public.wallet_categories          for select to authenticated using (private.wallet_can_read());
create policy "wallet read" on public.wallet_accounts            for select to authenticated using (private.wallet_can_read());
create policy "wallet read" on public.wallet_account_allocations for select to authenticated using (private.wallet_can_read());
create policy "wallet read" on public.wallet_invoice_rules       for select to authenticated using (private.wallet_can_read());
create policy "wallet read" on public.wallet_transactions        for select to authenticated using (private.wallet_can_read());
create policy "wallet read" on public.wallet_postings            for select to authenticated using (private.wallet_can_read());

-- Accounts and invoice rules are configuration (not money): the main admin edits them directly.
grant insert, update on public.wallet_accounts to authenticated;
grant insert, update, delete on public.wallet_invoice_rules to authenticated;
create policy "wallet admin insert" on public.wallet_accounts      for insert to authenticated with check (private.is_admin());
create policy "wallet admin update" on public.wallet_accounts      for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "wallet admin insert" on public.wallet_invoice_rules for insert to authenticated with check (private.is_admin());
create policy "wallet admin update" on public.wallet_invoice_rules for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "wallet admin delete" on public.wallet_invoice_rules for delete to authenticated using (private.is_admin());

-- Only the wallet's own private functions: existing private functions keep their grants.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private' and p.proname like 'wallet!_%' escape '!' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
-- the read policies call this as the signed-in user
grant execute on function private.wallet_can_read() to authenticated;

revoke all on function
  public.wallet_set_company_budget(date, numeric, text), public.wallet_allocate_category(date, text, numeric, text),
  public.wallet_set_account_allocation(date, text, numeric, text), public.wallet_top_up(date, text, numeric, text),
  public.wallet_reallocate(date, text, text, numeric, text), public.wallet_transfer(text, text, numeric, text),
  public.wallet_reverse_invoice(uuid, text, text), public.wallet_post_pending_invoices(),
  public.wallet_close_period(date, text), public.wallet_category_summary(date), public.wallet_account_summary(date),
  public.wallet_overview(date), public.wallet_reconciliation(date), public.wallet_unposted_invoices()
  from public, anon;
grant execute on function
  public.wallet_set_company_budget(date, numeric, text), public.wallet_allocate_category(date, text, numeric, text),
  public.wallet_set_account_allocation(date, text, numeric, text), public.wallet_top_up(date, text, numeric, text),
  public.wallet_reallocate(date, text, text, numeric, text), public.wallet_transfer(text, text, numeric, text),
  public.wallet_reverse_invoice(uuid, text, text), public.wallet_post_pending_invoices(),
  public.wallet_close_period(date, text), public.wallet_category_summary(date), public.wallet_account_summary(date),
  public.wallet_overview(date), public.wallet_reconciliation(date), public.wallet_unposted_invoices()
  to authenticated;

notify pgrst, 'reload schema';

commit;
