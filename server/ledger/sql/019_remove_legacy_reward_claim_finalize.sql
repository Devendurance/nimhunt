-- Reward Week compatibility bridge closure.
-- Apply only after the amount-aware application is live and verified.

do $$
begin
  if to_regprocedure('public.finalize_reward_claim(uuid,uuid,text,text,text,text,text,text,bigint)') is null then
    raise exception 'AMOUNT_AWARE_FINALIZE_RPC_MISSING';
  end if;
end $$;

do $$
begin
  revoke all on function public.finalize_reward_claim(uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated, service_role;
exception
  when undefined_object then null;
end $$;

drop function if exists public.finalize_reward_claim(uuid, uuid, text, text, text, text, text, text);

revoke all on function public.finalize_reward_claim(uuid, uuid, text, text, text, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.finalize_reward_claim(uuid, uuid, text, text, text, text, text, text, bigint) to service_role;

do $$
begin
  if to_regprocedure('public.finalize_reward_claim(uuid,uuid,text,text,text,text,text,text)') is not null then
    raise exception 'LEGACY_FINALIZE_RPC_REMAINS';
  end if;
  if to_regprocedure('public.finalize_reward_claim(uuid,uuid,text,text,text,text,text,text,bigint)') is null then
    raise exception 'AMOUNT_AWARE_FINALIZE_RPC_MISSING';
  end if;
end $$;
