-- Run once in Supabase: SQL Editor -> New query -> Run.
create table if not exists public.game_rooms (
  pin text primary key check (pin ~ '^[0-9]{6}$'),
  host_token uuid not null,
  mission_seed uuid not null,
  status text not null default 'lobby' check (status in ('lobby', 'started')),
  players jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.game_rooms enable row level security;

create or replace function public.join_game_room(room_pin text, player_name text)
returns public.game_rooms language plpgsql security definer set search_path = public as $$
declare room public.game_rooms;
begin
  select * into room from public.game_rooms where pin = room_pin and expires_at > now() for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if room.status <> 'lobby' then raise exception 'GAME_STARTED'; end if;
  if not exists (select 1 from jsonb_array_elements(room.players) p where p->>'name' = player_name) then
    update public.game_rooms set players = players || jsonb_build_array(jsonb_build_object('name', player_name, 'joinedAt', extract(epoch from now()) * 1000)) where pin = room_pin returning * into room;
  end if;
  return room;
end; $$;

create or replace function public.start_game_room(room_pin text, host_token uuid)
returns public.game_rooms language plpgsql security definer set search_path = public as $$
declare room public.game_rooms;
begin
  update public.game_rooms set status = 'started' where pin = room_pin and public.game_rooms.host_token = $2 and expires_at > now() returning * into room;
  if not found then raise exception 'HOST_ONLY'; end if;
  return room;
end; $$;

revoke all on public.game_rooms from anon, authenticated;
revoke all on function public.join_game_room(text, text) from public, anon, authenticated;
revoke all on function public.start_game_room(text, uuid) from public, anon, authenticated;
grant execute on function public.join_game_room(text, text) to service_role;
grant execute on function public.start_game_room(text, uuid) to service_role;

-- Tournament controls: run after the block above. Safe to re-run.
create table if not exists public.game_evaluations (
  room_pin text not null references public.game_rooms(pin) on delete cascade,
  player_name text not null,
  used integer not null default 0 check (used between 0 and 8),
  primary key (room_pin, player_name)
);

alter table public.game_evaluations enable row level security;

create or replace function public.use_game_evaluation(room_pin text, player_name text)
returns integer language plpgsql security definer set search_path = public as $$
declare next_used integer;
begin
  if not exists (select 1 from public.game_rooms where pin = room_pin and status = 'started' and expires_at > now()) then
    raise exception 'GAME_NOT_ACTIVE';
  end if;
  insert into public.game_evaluations (room_pin, player_name, used) values (room_pin, player_name, 1)
  on conflict (room_pin, player_name) do update set used = public.game_evaluations.used + 1
  where public.game_evaluations.used < 8
  returning used into next_used;
  if next_used is null then raise exception 'EVALUATION_LIMIT'; end if;
  return next_used;
end; $$;

revoke all on public.game_evaluations from anon, authenticated;
revoke all on function public.use_game_evaluation(text, text) from public, anon, authenticated;
grant execute on function public.use_game_evaluation(text, text) to service_role;
