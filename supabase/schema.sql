-- Run once in the SQL Editor of a NEW Supabase project.
-- This migration intentionally fails if these tables already exist.
begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z][a-z0-9_]{2,23}$'),
  created_at timestamptz not null default now()
);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index messages_sender_time on public.messages(sender_id, created_at desc);
create index messages_recipient_time on public.messages(recipient_id, created_at desc);

create table public.call_signals (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('offer', 'answer', 'end')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id),
  check (octet_length(payload::text) <= 48000),
  check (jsonb_typeof(payload) = 'object')
);
create index call_signals_inbox on public.call_signals(recipient_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.messages enable row level security;
alter table public.call_signals enable row level security;

-- Authenticated usernames/IDs form the contact directory; email is never exposed.
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy messages_read on public.messages for select to authenticated
  using ((select auth.uid()) in (sender_id, recipient_id));
create policy messages_send on public.messages for insert to authenticated
  with check (sender_id = (select auth.uid()));
create policy signals_read on public.call_signals for select to authenticated
  using ((select auth.uid()) in (sender_id, recipient_id));
create policy signals_send on public.call_signals for insert to authenticated
  with check (sender_id = (select auth.uid()));

-- Do not allow client-selected timestamps, row IDs, updates, or deletes.
revoke all on public.profiles, public.messages, public.call_signals from anon, authenticated;
grant select on public.profiles, public.messages, public.call_signals to authenticated;
grant insert (sender_id, recipient_id, body) on public.messages to authenticated;
grant insert (call_id, sender_id, recipient_id, kind, payload) on public.call_signals to authenticated;

create function public.create_chat_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, username)
  values (new.id, lower(trim(new.raw_user_meta_data ->> 'username')));
  return new;
end;
$$;
revoke all on function public.create_chat_profile() from public, anon, authenticated;
create trigger on_chat_user_created after insert on auth.users
  for each row execute function public.create_chat_profile();

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.call_signals;
commit;

-- Configure a daily privileged cleanup job before production:
-- delete from public.call_signals where created_at < now() - interval '1 day';
-- Never put the service_role key in the browser. Profiles need a separate
-- backfill if auth.users already contains accounts; use a fresh project.
