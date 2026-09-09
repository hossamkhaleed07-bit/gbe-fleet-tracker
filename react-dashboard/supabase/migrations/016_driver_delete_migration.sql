grant delete on public.drivers to authenticated;

drop policy if exists "admin can delete drivers" on public.drivers;
create policy "admin can delete drivers"
on public.drivers for delete
to authenticated
using (coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = '');
