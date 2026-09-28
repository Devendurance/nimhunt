-- NimHunt P2 final curated Adventurer avatar catalogue.
-- This migration is additive and does not alter expedition, proof, reward,
-- claim, payout, treasury, or player ownership semantics.

alter table public.adventurer_avatars
  add column if not exists rarity text not null default 'COMMON';

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.adventurer_avatars'::pg_catalog.regclass
      and conname = 'adventurer_avatars_rarity_check'
  ) then
    alter table public.adventurer_avatars
      add constraint adventurer_avatars_rarity_check
      check (rarity in ('COMMON', 'UNCOMMON', 'RARE', 'LEGENDARY', 'MYTHIC', 'LEGACY'));
  end if;
end;
$$;

-- Preserve every P1 profile foreign key. Temporary IDs remain active for
-- display/read compatibility but are no longer selectable for new mutations.
update public.adventurer_avatars
set rarity = 'LEGACY',
    starter = false,
    active = true,
    sort_order = 100 + pg_catalog.substring(avatar_id from '[0-9]+')::integer
where avatar_id ~ '^adventurer-[0-9]{2}$';

insert into public.adventurer_avatars (avatar_id, rarity, starter, active, sort_order)
values
  ('common-01', 'COMMON', true, true, 1),
  ('common-02', 'COMMON', true, true, 2),
  ('common-03', 'COMMON', true, true, 3),
  ('common-04', 'COMMON', true, true, 4),
  ('common-05', 'COMMON', true, true, 5),
  ('uncommon-01', 'UNCOMMON', false, true, 6),
  ('uncommon-02', 'UNCOMMON', false, true, 7),
  ('uncommon-03', 'UNCOMMON', false, true, 8),
  ('uncommon-04', 'UNCOMMON', false, true, 9),
  ('uncommon-05', 'UNCOMMON', false, true, 10),
  ('rare-01', 'RARE', false, true, 11),
  ('rare-02', 'RARE', false, true, 12),
  ('rare-03', 'RARE', false, true, 13),
  ('legendary-01', 'LEGENDARY', false, true, 14),
  ('legendary-02', 'LEGENDARY', false, true, 15),
  ('legendary-03', 'LEGENDARY', false, true, 16),
  ('mythic-01', 'MYTHIC', false, true, 17),
  ('mythic-02', 'MYTHIC', false, true, 18),
  ('mythic-03', 'MYTHIC', false, true, 19),
  ('mythic-04', 'MYTHIC', false, true, 20)
on conflict (avatar_id) do update
set rarity = excluded.rarity,
    starter = excluded.starter,
    active = excluded.active,
    sort_order = excluded.sort_order;

-- Existing legacy profiles may retain their temporary avatar while another
-- profile field is updated. A legacy ID cannot be inserted or assigned to a
-- different profile; only the unchanged value is tolerated during updates.
create or replace function public.reject_adventurer_profile_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name_error text;
begin
  if tg_op = 'UPDATE' and (
    new.player_id is distinct from old.player_id
    or new.wallet is distinct from old.wallet
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'ADVENTURER_IDENTITY_IMMUTABLE';
  end if;

  v_name_error := public.adventurer_name_validation_error(new.display_name, pg_catalog.lower(new.display_name));
  if v_name_error is not null then
    raise exception '%', v_name_error;
  end if;
  if not public.adventurer_avatar_is_available(new.avatar_id) then
    if tg_op <> 'UPDATE'
      or new.avatar_id is distinct from old.avatar_id
      or not exists (
        select 1
        from public.adventurer_avatars
        where avatar_id = new.avatar_id
          and rarity = 'LEGACY'
          and active is true
      ) then
      raise exception 'AVATAR_UNAVAILABLE';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.display_name is distinct from old.display_name
    and pg_catalog.timezone('utc', pg_catalog.now()) < old.display_name_changed_at + pg_catalog.interval '30 days' then
    raise exception 'DISPLAY_NAME_COOLDOWN';
  end if;

  new.normalized_display_name := pg_catalog.lower(new.display_name);
  if tg_op = 'UPDATE' and new.display_name is distinct from old.display_name then
    new.display_name_changed_at := pg_catalog.timezone('utc', pg_catalog.now());
  end if;
  new.updated_at := pg_catalog.timezone('utc', pg_catalog.now());
  return new;
end;
$$;

-- Preserve the existing service-only function boundary after replacing the
-- trigger body. No anon/authenticated execution is granted here.
revoke all on function public.reject_adventurer_profile_mutation() from public, anon, authenticated;
