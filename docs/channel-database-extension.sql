-- REVIEW DRAFT ONLY: NOT A MIGRATION. Requires explicit approval before remote application.
-- Target mikpepfrumtglwweolzq only; extends approved core without seed data.
begin;
alter table public.orders drop constraint orders_source_check;
alter table public.orders add constraint orders_source_check check(source in ('web','whatsapp','voice','telegram'));

create or replace function public.submit_order(p_session_token_hash text,p_cart jsonb,p_reviewed_total_cents bigint,p_source text,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s private.guest_sessions; request jsonb; prior private.idempotency_requests; q jsonb; ticket jsonb; placed public.orders;
begin
  if p_source is null or p_source not in ('web','whatsapp','voice','telegram') or p_reviewed_total_cents is null or p_reviewed_total_cents<0 or p_idempotency_key is null then raise exception 'INVALID_REQUEST'; end if;
  select * into s from private.guest_sessions where token_hash=p_session_token_hash and closed_at is null and expires_at>now();
  if not found then raise exception 'INVALID_SESSION'; end if;
  -- JSONB object keys canonicalize; array order remains part of the exact request contract.
  request := jsonb_build_object('cart',p_cart,'reviewedTotalCents',p_reviewed_total_cents,'source',p_source);
  insert into private.idempotency_requests(restaurant_id,guest_session_id,key,request_body)
    values(s.restaurant_id,s.id,p_idempotency_key,request) on conflict do nothing;
  select * into prior from private.idempotency_requests where restaurant_id=s.restaurant_id and guest_session_id=s.id and key=p_idempotency_key for update;
  if prior.request_body is distinct from request then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if prior.response is not null then return prior.response; end if;
  perform 1 from public.restaurants where id=s.restaurant_id for update;
  q := private.price_cart(public.read_published_menu(s.restaurant_id),p_cart);
  if (q->>'totalCents')::bigint <> p_reviewed_total_cents then raise exception 'PRICE_CHANGED'; end if;
  insert into public.orders(restaurant_id,guest_session_id,source,cart,total_cents) values(s.restaurant_id,s.id,p_source,q,(q->>'totalCents')::bigint) returning * into placed;
  ticket := jsonb_build_object('id',placed.id,'createdAt',to_char(placed.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'source',placed.source,'status','received','paymentStatus','unpaid','cart',q);
  insert into private.outbox_events(restaurant_id,order_id,event_type) values(s.restaurant_id,placed.id,'order.received');
  update private.idempotency_requests set order_id=placed.id,response=ticket where restaurant_id=s.restaurant_id and guest_session_id=s.id and key=p_idempotency_key;
  return ticket;
end;
$$;

create table private.staff_ai_usage (
 restaurant_id uuid not null references public.restaurants(id), operation text not null check(operation in ('extraction','voice')),
 window_started_at timestamptz not null default now(), calls integer not null check(calls between 0 and 20),
 primary key(restaurant_id,operation)
);
alter table private.staff_ai_usage enable row level security;
revoke all on private.staff_ai_usage from public,anon,authenticated;
create function public.consume_staff_ai_budget(p_actor_id uuid,p_restaurant_id uuid,p_operation text) returns uuid
language plpgsql security definer set search_path='' as $$
declare u private.staff_ai_usage;
begin
 if p_operation is null or p_operation not in ('extraction','voice') then raise exception 'INVALID_REQUEST'; end if;
 if not exists(select 1 from public.restaurant_memberships where restaurant_id=p_restaurant_id and user_id=p_actor_id and active and role in ('owner','editor')) then raise exception 'FORBIDDEN'; end if;
 insert into private.staff_ai_usage(restaurant_id,operation,calls) values(p_restaurant_id,p_operation,0) on conflict do nothing;
 select * into u from private.staff_ai_usage where restaurant_id=p_restaurant_id and operation=p_operation for update;
 if u.window_started_at <= now()-interval '10 minutes' then
  update private.staff_ai_usage set window_started_at=now(),calls=1 where restaurant_id=p_restaurant_id and operation=p_operation;
 else
  if u.calls>=20 then raise exception 'RATE_LIMITED'; end if;
  update private.staff_ai_usage set calls=calls+1 where restaurant_id=p_restaurant_id and operation=p_operation;
 end if;
 return p_restaurant_id;
end;
$$;

create table private.voice_sessions (
 id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id),
 actor_id uuid not null references auth.users(id), provider_session_id text not null unique check(length(provider_session_id) between 1 and 200),
 session_token_hash text not null references private.guest_sessions(token_hash),
 status text not null default 'active' check(status in ('active','closed')), expires_at timestamptz not null default(now()+interval '10 minutes'),
 revision integer not null default 0 check(revision>=0), pending jsonb, created_at timestamptz not null default now(),
 check(pending is null or octet_length(pending::text)<=65536)
);
create index voice_sessions_restaurant_actor on private.voice_sessions(restaurant_id,actor_id);
create table private.channel_order_receipts (
 channel text not null check(channel in ('voice','telegram')), session_id uuid not null, confirmation_nonce uuid not null,
 ticket jsonb not null, created_at timestamptz not null default now(), primary key(channel,session_id,confirmation_nonce)
);
alter table private.voice_sessions enable row level security;
alter table private.channel_order_receipts enable row level security;
revoke all on private.voice_sessions,private.channel_order_receipts from public,anon,authenticated;

create function private.voice_session_payload(v private.voice_sessions) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',v.id,'restaurantId',v.restaurant_id,'providerSessionId',v.provider_session_id,'status',v.status,
 'sessionTokenHash',v.session_token_hash,'expiresAt',to_char(v.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
$$;
create function private.require_voice_owner(p_actor_id uuid,p_voice_session_id uuid) returns void language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from private.voice_sessions v join public.restaurant_memberships m on m.restaurant_id=v.restaurant_id
  where v.id=p_voice_session_id and v.actor_id=p_actor_id and m.user_id=p_actor_id and m.active and m.role in ('owner','editor')) then raise exception 'FORBIDDEN'; end if;
end;
$$;
create function public.create_voice_session(p_actor_id uuid,p_restaurant_id uuid,p_provider_session_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v private.voice_sessions; h text;
begin
 if not exists(select 1 from public.restaurant_memberships where restaurant_id=p_restaurant_id and user_id=p_actor_id and active and role in ('owner','editor')) then raise exception 'FORBIDDEN'; end if;
 if p_provider_session_id is null or length(p_provider_session_id) not between 1 and 200 then raise exception 'INVALID_REQUEST'; end if;
 h:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
 perform public.create_guest_session(p_restaurant_id,h);
 insert into private.voice_sessions(restaurant_id,actor_id,provider_session_id,session_token_hash)
 values(p_restaurant_id,p_actor_id,p_provider_session_id,h) returning * into v;
 return private.voice_session_payload(v);
end;
$$;
create function public.read_voice_session(p_actor_id uuid,p_voice_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v private.voice_sessions;
begin
 perform private.require_voice_owner(p_actor_id,p_voice_session_id);
 select * into v from private.voice_sessions where id=p_voice_session_id;
 return private.voice_session_payload(v);
end;
$$;
create function public.close_voice_session(p_actor_id uuid,p_voice_session_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_voice_owner(p_actor_id,p_voice_session_id);
 update private.voice_sessions set status='closed',pending=null where id=p_voice_session_id;
 return jsonb_build_object('ok',true);
end;
$$;
create function public.begin_voice_review(p_actor_id uuid,p_voice_session_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v private.voice_sessions;
begin
 perform private.require_voice_owner(p_actor_id,p_voice_session_id);
 select * into v from private.voice_sessions where id=p_voice_session_id for update;
 if v.status<>'active' or v.expires_at<=now() then raise exception 'SESSION_EXPIRED'; end if;
 update private.voice_sessions set pending=null,revision=revision+1 where id=v.id returning * into v;
 return jsonb_build_object('revision',v.revision);
end;
$$;
create function public.save_voice_review(p_actor_id uuid,p_voice_session_id uuid,p_cart jsonb,p_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v private.voice_sessions; q jsonb; nonce uuid:=gen_random_uuid();
begin
 perform private.require_voice_owner(p_actor_id,p_voice_session_id);
 select * into v from private.voice_sessions where id=p_voice_session_id for update;
 if v.status<>'active' or v.expires_at<=now() then raise exception 'SESSION_EXPIRED'; end if;
 if p_revision is null or p_revision<>v.revision or p_revision<1 then raise exception 'STALE_REVIEW'; end if;
 if v.pending is not null then raise exception 'STALE_REVIEW'; end if;
 q:=public.quote_cart(v.session_token_hash,p_cart);
 update private.voice_sessions set pending=jsonb_build_object('cart',p_cart,'quote',q,'confirmationNonce',nonce,'idempotencyKey',gen_random_uuid()) where id=v.id;
 return jsonb_build_object('quote',q,'confirmationNonce',nonce,'revision',v.revision);
end;
$$;
create function public.submit_voice_order(p_actor_id uuid,p_voice_session_id uuid,p_confirmation_nonce uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v private.voice_sessions; receipt jsonb;
begin
 perform private.require_voice_owner(p_actor_id,p_voice_session_id);
 select * into v from private.voice_sessions where id=p_voice_session_id for update;
 select ticket into receipt from private.channel_order_receipts where channel='voice' and session_id=v.id and confirmation_nonce=p_confirmation_nonce;
 if receipt is not null then return receipt; end if;
 if v.status<>'active' or v.expires_at<=now() then raise exception 'SESSION_EXPIRED'; end if;
 if v.pending is null or p_confirmation_nonce is null or (v.pending->>'confirmationNonce')::uuid<>p_confirmation_nonce then raise exception 'STALE_REVIEW'; end if;
 receipt:=public.submit_order(v.session_token_hash,v.pending->'cart',(v.pending->'quote'->>'totalCents')::bigint,'voice',(v.pending->>'idempotencyKey')::uuid);
 insert into private.channel_order_receipts(channel,session_id,confirmation_nonce,ticket) values('voice',v.id,p_confirmation_nonce,receipt);
 update private.voice_sessions set pending=null where id=v.id;
 return receipt;
end;
$$;

create table private.messaging_conversations (
 id uuid primary key default gen_random_uuid(), provider text not null check(provider='telegram'), account_id text not null check(length(account_id) between 1 and 128),
 recipient_id text not null check(length(recipient_id) between 1 and 128), restaurant_id uuid not null references public.restaurants(id),
 session_token_hash text not null, state jsonb not null default '{"version":1,"pending":null,"lastTicket":null}',
 pending_expires_at timestamptz, active_update_id text, lease_id uuid, lease_until timestamptz, created_at timestamptz not null default now(),
 unique(provider,account_id,recipient_id), check(octet_length(state::text)<=65536)
);
create index messaging_restaurant on private.messaging_conversations(restaurant_id);
create table private.messaging_updates (
 provider text not null, account_id text not null, update_id text not null check(length(update_id) between 1 and 128),
 conversation_id uuid not null references private.messaging_conversations(id), status text not null default 'claimed' check(status in ('claimed','completed')),
 submitted_ticket jsonb, created_at timestamptz not null default now(), primary key(provider,account_id,update_id), unique(conversation_id,update_id)
);
create table private.messaging_replies (
 conversation_id uuid not null, update_id text not null, reply jsonb not null check(octet_length(reply::text)<=65536),
 status text not null default 'ready' check(status in ('ready','attempted','sent','unknown','not_sent')), provider_message_id text,
 created_at timestamptz not null default now(), primary key(conversation_id,update_id),
 foreign key(conversation_id,update_id) references private.messaging_updates(conversation_id,update_id)
);
alter table private.messaging_conversations enable row level security;
alter table private.messaging_updates enable row level security;
alter table private.messaging_replies enable row level security;
revoke all on private.messaging_conversations,private.messaging_updates,private.messaging_replies from public,anon,authenticated;

create function public.messaging_claim_update(p_provider text,p_account_id text,p_restaurant_id uuid,p_recipient_id text,p_update_id text,p_session_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.messaging_conversations; u private.messaging_updates; fresh uuid;
begin
 if p_provider is distinct from 'telegram' or p_account_id is null or length(p_account_id) not between 1 and 128 or p_recipient_id is null or length(p_recipient_id) not between 1 and 128
 or p_update_id is null or length(p_update_id) not between 1 and 128 or p_session_token_hash is null or p_session_token_hash!~'^[a-f0-9]{64}$' then raise exception 'INVALID_REQUEST'; end if;
 insert into private.messaging_conversations(provider,account_id,recipient_id,restaurant_id,session_token_hash)
 values(p_provider,p_account_id,p_recipient_id,p_restaurant_id,p_session_token_hash) on conflict(provider,account_id,recipient_id) do nothing returning id into fresh;
 select * into c from private.messaging_conversations where provider=p_provider and account_id=p_account_id and recipient_id=p_recipient_id for update;
 if c.restaurant_id<>p_restaurant_id then raise exception 'FORBIDDEN'; end if;
 select * into u from private.messaging_updates where provider=p_provider and account_id=p_account_id and update_id=p_update_id;
 if found then
  if u.conversation_id<>c.id then raise exception 'INVALID_REQUEST'; end if;
  if u.status='completed' then return jsonb_build_object('status','duplicate','conversationId',c.id,'leaseId',null,'state',null,'sessionTokenHash',null); end if;
 end if;
 if c.active_update_id is not null and (c.active_update_id<>p_update_id or c.lease_until>now()) then
  return jsonb_build_object('status','busy','conversationId',c.id,'leaseId',null,'state',null,'sessionTokenHash',null);
 end if;
 if fresh is not null then perform public.create_guest_session(p_restaurant_id,p_session_token_hash);
 elsif not exists(select 1 from private.guest_sessions where token_hash=c.session_token_hash and closed_at is null and expires_at>now()) then
  perform public.create_guest_session(p_restaurant_id,p_session_token_hash);
  c.session_token_hash:=p_session_token_hash;c.state:=jsonb_set(c.state,'{pending}','null');c.pending_expires_at:=null;
 end if;
 if c.pending_expires_at<=now() then c.state:=jsonb_set(c.state,'{pending}','null');c.pending_expires_at:=null; end if;
 insert into private.messaging_updates(provider,account_id,update_id,conversation_id) values(p_provider,p_account_id,p_update_id,c.id) on conflict do nothing;
 -- A concurrent same provider update ID for another recipient cannot be silently claimed.
 if not exists(select 1 from private.messaging_updates where provider=p_provider and account_id=p_account_id and update_id=p_update_id and conversation_id=c.id) then raise exception 'INVALID_REQUEST'; end if;
 update private.messaging_conversations set session_token_hash=c.session_token_hash,state=c.state,pending_expires_at=c.pending_expires_at,
 active_update_id=p_update_id,lease_id=gen_random_uuid(),lease_until=now()+interval '180 seconds' where id=c.id returning * into c;
 return jsonb_build_object('status','claimed','conversationId',c.id,'leaseId',c.lease_id,'state',c.state,'sessionTokenHash',c.session_token_hash);
end;
$$;

create function public.messaging_submit_order(p_conversation_id uuid,p_lease_id uuid,p_update_id text,p_confirmation_nonce uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.messaging_conversations; receipt jsonb;
begin
 select * into c from private.messaging_conversations where id=p_conversation_id for update;
 if not found or p_lease_id is null or c.lease_id is distinct from p_lease_id or c.active_update_id is distinct from p_update_id or c.lease_until<=now() then raise exception 'INVALID_LEASE'; end if;
 select ticket into receipt from private.channel_order_receipts where channel='telegram' and session_id=c.id and confirmation_nonce=p_confirmation_nonce;
 if receipt is null then
  if p_confirmation_nonce is null or c.state->'pending'='null'::jsonb or c.pending_expires_at is null or c.pending_expires_at<=now()
   or (c.state->'pending'->>'confirmationNonce')::uuid is distinct from p_confirmation_nonce then raise exception 'STALE_REVIEW'; end if;
  receipt:=public.submit_order(c.session_token_hash,c.state->'pending'->'cart',(c.state->'pending'->'quote'->>'totalCents')::bigint,'telegram',(c.state->'pending'->>'idempotencyKey')::uuid);
  insert into private.channel_order_receipts(channel,session_id,confirmation_nonce,ticket) values('telegram',c.id,p_confirmation_nonce,receipt);
 end if;
 update private.messaging_conversations set state=jsonb_build_object('version',1,'pending',null,'lastTicket',receipt),pending_expires_at=null where id=c.id;
 update private.messaging_updates set submitted_ticket=receipt where conversation_id=c.id and update_id=p_update_id;
 return receipt;
end;
$$;

create function public.messaging_complete_update(p_conversation_id uuid,p_lease_id uuid,p_update_id text,p_state jsonb,p_reply jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.messaging_conversations; u private.messaging_updates; q jsonb; pending jsonb; nonce uuid; idem uuid; expiry timestamptz;
begin
 select * into c from private.messaging_conversations where id=p_conversation_id for update;
 if not found or p_lease_id is null or c.lease_id is distinct from p_lease_id or c.active_update_id is distinct from p_update_id or c.lease_until<=now() then raise exception 'INVALID_LEASE'; end if;
 select * into u from private.messaging_updates where conversation_id=c.id and update_id=p_update_id;
 if not found or u.status<>'claimed' then raise exception 'INVALID_LEASE'; end if;
 if not private.keys_exact(p_state,array['version','pending','lastTicket']) or p_state->'version'<>'1'::jsonb or octet_length(p_state::text)>65536
  or not private.keys_exact(p_reply,array['text','confirmationNonce']) or jsonb_typeof(p_reply->'text')<>'string' or length(p_reply->>'text') not between 1 and 4000 or octet_length(p_reply::text)>65536 then raise exception 'INVALID_REQUEST'; end if;
 if p_state->'lastTicket' is distinct from c.state->'lastTicket' then raise exception 'INVALID_REQUEST'; end if;
 if u.submitted_ticket is not null and p_state->'pending'<>'null'::jsonb then raise exception 'INVALID_REQUEST'; end if;
 pending:=p_state->'pending';
 if pending<>'null'::jsonb then
  if not private.keys_exact(pending,array['cart','quote','confirmationNonce','idempotencyKey']) then raise exception 'INVALID_REQUEST'; end if;
  nonce:=(pending->>'confirmationNonce')::uuid;idem:=(pending->>'idempotencyKey')::uuid;
  if nonce is null or idem is null then raise exception 'INVALID_REQUEST'; end if;
  if exists(select 1 from private.channel_order_receipts where channel='telegram' and session_id=c.id and confirmation_nonce=nonce) then raise exception 'STALE_REVIEW'; end if;
  q:=public.quote_cart(c.session_token_hash,pending->'cart');
  if q is distinct from pending->'quote' then raise exception 'PRICE_CHANGED'; end if;
  if c.state->'pending'->>'confirmationNonce'=nonce::text then
   if pending is distinct from c.state->'pending' then raise exception 'INVALID_REQUEST'; end if;
   expiry:=c.pending_expires_at;
  else expiry:=now()+interval '10 minutes';end if;
  if expiry is null or expiry<=now() then raise exception 'STALE_REVIEW'; end if;
 end if;
 if p_reply->'confirmationNonce'<>'null'::jsonb then
  if (p_reply->>'confirmationNonce')::uuid is distinct from nonce then raise exception 'INVALID_REQUEST'; end if;
 end if;
 update private.messaging_conversations set state=p_state,pending_expires_at=expiry,active_update_id=null,lease_id=null,lease_until=null where id=c.id;
 update private.messaging_updates set status='completed' where conversation_id=c.id and update_id=p_update_id;
 insert into private.messaging_replies(conversation_id,update_id,reply) values(c.id,p_update_id,p_reply);
 return jsonb_build_object('ok',true);
exception when invalid_text_representation then raise exception 'INVALID_REQUEST';
end;
$$;

create function public.messaging_claim_reply(p_conversation_id uuid,p_update_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.messaging_replies;
begin
 select * into r from private.messaging_replies where conversation_id=p_conversation_id and update_id=p_update_id for update;
 if not found then raise exception 'INVALID_REQUEST'; end if;
 if r.status<>'ready' then return jsonb_build_object('status','already_attempted','reply',null); end if;
 update private.messaging_replies set status='attempted' where conversation_id=p_conversation_id and update_id=p_update_id;
 return jsonb_build_object('status','claimed','reply',r.reply);
end;
$$;
create function public.messaging_finish_reply(p_conversation_id uuid,p_update_id text,p_status text,p_provider_message_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_status is null or p_status not in ('sent','unknown','not_sent') or length(p_provider_message_id)>200 then raise exception 'INVALID_REQUEST'; end if;
 update private.messaging_replies set status=p_status,provider_message_id=p_provider_message_id where conversation_id=p_conversation_id and update_id=p_update_id and status='attempted';
 if not found then raise exception 'INVALID_REQUEST'; end if;
 return jsonb_build_object('ok',true);
end;
$$;

revoke all on function private.voice_session_payload(private.voice_sessions),private.require_voice_owner(uuid,uuid) from public,anon,authenticated;
revoke all on function public.consume_staff_ai_budget(uuid,uuid,text),public.create_voice_session(uuid,uuid,text),public.read_voice_session(uuid,uuid),public.close_voice_session(uuid,uuid),public.begin_voice_review(uuid,uuid),public.save_voice_review(uuid,uuid,jsonb,integer),public.submit_voice_order(uuid,uuid,uuid),public.messaging_claim_update(text,text,uuid,text,text,text),public.messaging_submit_order(uuid,uuid,text,uuid),public.messaging_complete_update(uuid,uuid,text,jsonb,jsonb),public.messaging_claim_reply(uuid,text),public.messaging_finish_reply(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.consume_staff_ai_budget(uuid,uuid,text),public.create_voice_session(uuid,uuid,text),public.read_voice_session(uuid,uuid),public.close_voice_session(uuid,uuid),public.begin_voice_review(uuid,uuid),public.save_voice_review(uuid,uuid,jsonb,integer),public.submit_voice_order(uuid,uuid,uuid),public.messaging_claim_update(text,text,uuid,text,text,text),public.messaging_submit_order(uuid,uuid,text,uuid),public.messaging_complete_update(uuid,uuid,text,jsonb,jsonb),public.messaging_claim_reply(uuid,text),public.messaging_finish_reply(uuid,text,text,text) to service_role;
commit;
