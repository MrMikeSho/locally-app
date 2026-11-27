-- Locally design update: listing details (beds / baths / features) + view counter.
-- Run ONCE in Supabase > SQL Editor BEFORE uploading the new index.html. Safe to run again.

alter table public.listings
  add column if not exists bedrooms  numeric,
  add column if not exists bathrooms numeric,
  add column if not exists features  text[] not null default '{}',
  add column if not exists views     integer not null default 0;

-- Anyone can add ONE to a listing's view counter, and nothing else (no other column can be changed this way)
create or replace function public.bump_listing_view(p_id bigint) returns void
language sql security definer set search_path = public as $$
  update public.listings set views = views + 1 where id = p_id;
$$;
revoke all on function public.bump_listing_view(bigint) from public;
grant execute on function public.bump_listing_view(bigint) to anon, authenticated;
