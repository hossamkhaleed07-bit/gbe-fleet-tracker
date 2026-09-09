-- ============================================================
-- 023_reinforcement_requests_approval_migration.sql
-- Approval workflow for reinforcement requests: pending →
-- approved/rejected, reviewed by an admin. Powers the new
-- "Fuel" section (Fuel Approver + Approval pages) in the
-- dashboard.
-- ============================================================

alter table public.reinforcement_requests
  add column if not exists status text not null default 'pending';

alter table public.reinforcement_requests
  drop constraint if exists reinforcement_requests_status_check;
alter table public.reinforcement_requests
  add constraint reinforcement_requests_status_check check (status in ('pending', 'approved', 'rejected'));

alter table public.reinforcement_requests add column if not exists reviewed_by text;
alter table public.reinforcement_requests add column if not exists reviewed_at timestamptz;

drop policy if exists "admin can update reinforcement_requests" on public.reinforcement_requests;
create policy "admin can update reinforcement_requests"
on public.reinforcement_requests for update
to authenticated
using (coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = '')
with check (coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = '');

grant update on public.reinforcement_requests to authenticated;
