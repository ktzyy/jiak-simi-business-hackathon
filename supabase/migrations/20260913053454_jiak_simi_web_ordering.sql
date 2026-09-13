-- REVIEW DRAFT: fulfillment, kitchen completion and versioned stall hours.
-- Target mikpepfrumtglwweolzq. Explicit approval required before migration/application.
begin;
create function private.immutable_ticket_response(p_receipt jsonb) returns jsonb language sql immutable set search_path='' as $$
 select p_receipt||jsonb_build_object('status','received','statusVersion',1,'completedAt',null,'cart',(p_receipt->'cart')||jsonb_build_object('fulfillmentType',case when p_receipt->'cart'->>'fulfillmentType' in ('dine_in','takeaway') then p_receipt->'cart'->>'fulfillmentType' else null end));
$$;
create or replace function private.price_cart(p_menu jsonb,p_cart jsonb) returns jsonb language plpgsql set search_path = '' as $$
declare l jsonb; d jsonb; g jsonb; o jsonb; oid jsonb; qty integer; selected uuid[]; uid uuid; n integer; matched integer;
  options jsonb; lines jsonb := '[]'; unit bigint; total bigint := 0;
begin
  if not private.keys_exact(p_cart,array['restaurantId','menuId','menuVersion','fulfillmentType','lines'])
    or p_cart->>'fulfillmentType' is null or p_cart->>'fulfillmentType' not in ('dine_in','takeaway')
    or not private.int_between(p_cart->'menuVersion',1,2147483647) or jsonb_typeof(p_cart->'lines') <> 'array' then raise exception 'INVALID_CART'; end if;
  if p_cart->>'restaurantId' is distinct from p_menu->>'restaurantId' or p_cart->>'menuId' is distinct from p_menu->>'id' then raise exception 'UNKNOWN_MENU'; end if;
  if (p_cart->>'menuVersion')::integer <> (p_menu->>'version')::integer then raise exception 'STALE_MENU'; end if;
  if jsonb_array_length(p_cart->'lines') not between 1 and 50 then raise exception 'INVALID_CART'; end if;
  for l in select value from jsonb_array_elements(p_cart->'lines') loop
    if not private.keys_exact(l,array['dishId','quantity','optionIds']) or not private.int_between(l->'quantity',1,20)
      or jsonb_typeof(l->'optionIds') <> 'array' then raise exception 'INVALID_CART'; end if;
    if jsonb_array_length(l->'optionIds') > 100 then raise exception 'INVALID_CART'; end if;
    uid := (l->>'dishId')::uuid;
    select value into d from jsonb_array_elements(p_menu->'dishes') where (value->>'id')::uuid=uid;
    if d is null or not (d->>'available')::boolean then raise exception 'UNKNOWN_DISH'; end if;
    selected := '{}';
    for oid in select value from jsonb_array_elements(l->'optionIds') loop
      if jsonb_typeof(oid) <> 'string' then raise exception 'INVALID_OPTIONS'; end if;
      uid := (oid#>>'{}')::uuid;
      if uid=any(selected) then raise exception 'INVALID_OPTIONS'; end if;
      selected := array_append(selected,uid);
    end loop;
    options := '[]'; matched := 0; unit := (d->>'priceCents')::bigint; qty := (l->>'quantity')::integer;
    for g in select value from jsonb_array_elements(d->'modifierGroups') loop
      n := 0;
      for o in select value from jsonb_array_elements(g->'options') loop
        if (o->>'id')::uuid=any(selected) then n:=n+1; matched:=matched+1; options:=options||jsonb_build_array(o); unit:=unit+(o->>'priceDeltaCents')::bigint; end if;
      end loop;
      if n < (g->>'minSelections')::integer or n > (g->>'maxSelections')::integer then raise exception 'INVALID_OPTIONS'; end if;
    end loop;
    if matched <> cardinality(selected) then raise exception 'UNKNOWN_OPTION'; end if;
    if unit not between 0 and 1000000 then raise exception 'INVALID_MENU'; end if;
    total := total + unit*qty;
    lines := lines || jsonb_build_array(jsonb_build_object('dishId',d->>'id','name',d->>'name','quantity',qty,'options',options,'unitPriceCents',unit,'lineTotalCents',unit*qty));
  end loop;
  return jsonb_build_object('restaurantId',p_menu->>'restaurantId','menuId',p_menu->>'id','menuVersion',(p_menu->>'version')::integer,'fulfillmentType',p_cart->>'fulfillmentType','currency','SGD','lines',lines,'totalCents',total);
exception when invalid_text_representation then raise exception 'INVALID_CART';
end;
$$;

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
  if prior.response is not null then return private.immutable_ticket_response(prior.response); end if;
  perform 1 from public.restaurants where id=s.restaurant_id for update;
  q := private.price_cart(public.read_published_menu(s.restaurant_id),p_cart);
  if (q->>'totalCents')::bigint <> p_reviewed_total_cents then raise exception 'PRICE_CHANGED'; end if;
  insert into public.orders(restaurant_id,guest_session_id,source,cart,total_cents) values(s.restaurant_id,s.id,p_source,q,(q->>'totalCents')::bigint) returning * into placed;
  ticket := jsonb_build_object('id',placed.id,'createdAt',to_char(placed.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'source',placed.source,'status','received','statusVersion',1,'completedAt',null,'paymentStatus','unpaid','cart',q);
  insert into private.outbox_events(restaurant_id,order_id,event_type) values(s.restaurant_id,placed.id,'order.received');
  update private.idempotency_requests set order_id=placed.id,response=ticket where restaurant_id=s.restaurant_id and guest_session_id=s.id and key=p_idempotency_key;
  return ticket;
end;
$$;

create or replace function public.submit_voice_order(p_actor_id uuid,p_voice_session_id uuid,p_confirmation_nonce uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v private.voice_sessions; receipt jsonb;
begin
 perform private.require_voice_owner(p_actor_id,p_voice_session_id);
 select * into v from private.voice_sessions where id=p_voice_session_id for update;
 select ticket into receipt from private.channel_order_receipts where channel='voice' and session_id=v.id and confirmation_nonce=p_confirmation_nonce;
 if receipt is not null then return private.immutable_ticket_response(receipt); end if;
 if v.status<>'active' or v.expires_at<=now() then raise exception 'SESSION_EXPIRED'; end if;
 if v.pending is null or p_confirmation_nonce is null or (v.pending->>'confirmationNonce')::uuid<>p_confirmation_nonce then raise exception 'STALE_REVIEW'; end if;
 receipt:=public.submit_order(v.session_token_hash,v.pending->'cart',(v.pending->'quote'->>'totalCents')::bigint,'voice',(v.pending->>'idempotencyKey')::uuid);
 insert into private.channel_order_receipts(channel,session_id,confirmation_nonce,ticket) values('voice',v.id,p_confirmation_nonce,receipt);
 update private.voice_sessions set pending=null where id=v.id;
 return private.immutable_ticket_response(receipt);
end;
$$;

create or replace function public.messaging_submit_order(p_conversation_id uuid,p_lease_id uuid,p_update_id text,p_confirmation_nonce uuid) returns jsonb
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
 receipt:=private.immutable_ticket_response(receipt);
 update private.messaging_conversations set state=jsonb_build_object('version',1,'pending',null,'lastTicket',receipt),pending_expires_at=null where id=c.id;
 update private.messaging_updates set submitted_ticket=receipt where conversation_id=c.id and update_id=p_update_id;
 return receipt;
end;
$$;

create or replace function public.messaging_claim_update(p_provider text,p_account_id text,p_restaurant_id uuid,p_recipient_id text,p_update_id text,p_session_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.messaging_conversations; u private.messaging_updates; fresh uuid;
begin
 if p_provider is distinct from 'telegram' or p_account_id is null or length(p_account_id) not between 1 and 128 or p_recipient_id is null or length(p_recipient_id) not between 1 and 128
 or p_update_id is null or length(p_update_id) not between 1 and 128 or p_session_token_hash is null or p_session_token_hash!~'^[a-f0-9]{64}$' then raise exception 'INVALID_REQUEST'; end if;
 insert into private.messaging_conversations(provider,account_id,recipient_id,restaurant_id,session_token_hash)
 values(p_provider,p_account_id,p_recipient_id,p_restaurant_id,p_session_token_hash) on conflict(provider,account_id,recipient_id) do nothing returning id into fresh;
 select * into c from private.messaging_conversations where provider=p_provider and account_id=p_account_id and recipient_id=p_recipient_id for update;
 if c.restaurant_id<>p_restaurant_id then raise exception 'FORBIDDEN'; end if;
 if c.state->'lastTicket'<>'null'::jsonb then c.state:=jsonb_set(c.state,'{lastTicket}',private.immutable_ticket_response(c.state->'lastTicket'));end if;
 if c.state->'pending'<>'null'::jsonb and (c.state->'pending'->'cart'->>'fulfillmentType' is null or c.state->'pending'->'quote'->>'fulfillmentType' is null) then c.state:=jsonb_set(c.state,'{pending}','null');c.pending_expires_at:=null;end if;
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

create table private.kitchen_order_state (
 order_id uuid primary key references public.orders(id),restaurant_id uuid not null references public.restaurants(id),
 status text not null check(status in ('received','done')),status_version integer not null check(status_version>0),
 completed_at timestamptz,completed_by uuid references auth.users(id),
 foreign key(restaurant_id,order_id) references public.orders(restaurant_id,id),
 check((status='received' and status_version=1 and completed_at is null and completed_by is null) or (status='done' and status_version=2 and completed_at is not null and completed_by is not null))
);
create index kitchen_state_restaurant on private.kitchen_order_state(restaurant_id,status);
create table private.kitchen_completion_requests (
 restaurant_id uuid not null references public.restaurants(id),key uuid not null,request_body jsonb not null,response jsonb not null,
 created_at timestamptz not null default now(),primary key(restaurant_id,key)
);
alter table private.kitchen_order_state enable row level security;
alter table private.kitchen_completion_requests enable row level security;
revoke all on private.kitchen_order_state,private.kitchen_completion_requests from public,anon,authenticated;
create function private.current_kitchen_ticket(p_order_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',o.id,'createdAt',to_char(o.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'source',o.source,'status',coalesce(s.status,'received'),'statusVersion',coalesce(s.status_version,1),'completedAt',
 case when s.completed_at is null then null else to_char(s.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
 'paymentStatus',o.payment_status,'cart',o.cart||jsonb_build_object('fulfillmentType',case when o.cart->>'fulfillmentType' in ('dine_in','takeaway') then o.cart->>'fulfillmentType' else null end))
 from public.orders o left join private.kitchen_order_state s on s.order_id=o.id where o.id=p_order_id;
$$;
create or replace function public.read_kitchen_orders(p_restaurant_id uuid,p_actor_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.restaurant_memberships where restaurant_id=p_restaurant_id and user_id=p_actor_id and active) then raise exception 'FORBIDDEN';end if;
 select coalesce(jsonb_agg(private.current_kitchen_ticket(o.id) order by o.created_at,o.id),'[]'::jsonb) into result from public.orders o where o.restaurant_id=p_restaurant_id;
 return jsonb_build_object('orders',result,'counts',jsonb_build_object('received',(select count(*) from jsonb_array_elements(result) t where t->>'status'='received'),'done',(select count(*) from jsonb_array_elements(result) t where t->>'status'='done'),'total',jsonb_array_length(result)));
end;
$$;
create function public.complete_kitchen_order(p_actor_id uuid,p_restaurant_id uuid,p_order_id uuid,p_expected_status_version integer,p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior private.kitchen_completion_requests;s private.kitchen_order_state;request jsonb;receipt jsonb;
begin
 if not exists(select 1 from public.restaurant_memberships where restaurant_id=p_restaurant_id and user_id=p_actor_id and active and role in ('owner','editor','kitchen')) then raise exception 'FORBIDDEN';end if;
 if p_idempotency_key is null or p_expected_status_version is null or p_expected_status_version<1 then raise exception 'INVALID_REQUEST';end if;
 -- Serialize completion keys for this restaurant before inspecting replay or ticket version.
 perform 1 from public.restaurants where id=p_restaurant_id for update;
 request:=jsonb_build_object('orderId',p_order_id,'expectedStatusVersion',p_expected_status_version);
 select * into prior from private.kitchen_completion_requests where restaurant_id=p_restaurant_id and key=p_idempotency_key;
 if found then
  if prior.request_body is distinct from request then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return prior.response;
 end if;
 perform 1 from public.orders where id=p_order_id and restaurant_id=p_restaurant_id for update;
 if not found then raise exception 'ORDER_NOT_FOUND';end if;
 insert into private.kitchen_order_state(order_id,restaurant_id,status,status_version) values(p_order_id,p_restaurant_id,'received',1) on conflict do nothing;
 select * into s from private.kitchen_order_state where order_id=p_order_id for update;
 if s.status_version<>p_expected_status_version then raise exception 'STALE_STATUS';end if;
 if s.status<>'received' then raise exception 'INVALID_STATUS_TRANSITION';end if;
 update private.kitchen_order_state set status='done',status_version=status_version+1,completed_at=now(),completed_by=p_actor_id where order_id=p_order_id;
 receipt:=private.current_kitchen_ticket(p_order_id);
 insert into private.kitchen_completion_requests(restaurant_id,key,request_body,response) values(p_restaurant_id,p_idempotency_key,request,receipt);
 return receipt;
end;
$$;

create table private.stall_details_versions (
 restaurant_id uuid not null references public.restaurants(id),version integer not null check(version>0),details jsonb not null,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),primary key(restaurant_id,version)
);
create table private.stall_details_current (
 restaurant_id uuid primary key references public.restaurants(id),version integer not null,
 foreign key(restaurant_id,version) references private.stall_details_versions(restaurant_id,version)
);
create table private.menu_stall_details (
 restaurant_id uuid not null,menu_id uuid not null,menu_version integer not null,details_version integer not null,
 primary key(restaurant_id,menu_id,menu_version),
 foreign key(restaurant_id,menu_id,menu_version) references private.menu_versions(restaurant_id,menu_id,version),
 foreign key(restaurant_id,details_version) references private.stall_details_versions(restaurant_id,version)
);
alter table private.stall_details_versions enable row level security;
alter table private.stall_details_current enable row level security;
alter table private.menu_stall_details enable row level security;
revoke all on private.stall_details_versions,private.stall_details_current,private.menu_stall_details from public,anon,authenticated;
create trigger immutable_stall_details before update or delete on private.stall_details_versions for each row execute function private.reject_mutation();
create trigger immutable_menu_details before update or delete on private.menu_stall_details for each row execute function private.reject_mutation();
create function private.validate_stall_details(p_details jsonb) returns void language plpgsql set search_path='' as $$
declare d jsonb;i jsonb;day integer;seen integer[]:='{}';starts integer[]:='{}';ends integer[]:='{}';a integer;b integer;duration integer;segment_start integer;segment_end integer;j integer;k integer;
begin
 if not private.keys_exact(p_details,array['name','timezone','weeklyHours']) or not private.valid_name(p_details->'name') or btrim(p_details->>'name')='' or p_details->>'timezone' is distinct from 'Asia/Singapore'
 or jsonb_typeof(p_details->'weeklyHours')<>'array' or octet_length(p_details::text)>65536 then raise exception 'INVALID_STALL_DETAILS';end if;
 if jsonb_array_length(p_details->'weeklyHours')<>7 then raise exception 'INVALID_STALL_DETAILS';end if;
 for d in select value from jsonb_array_elements(p_details->'weeklyHours') loop
  if not private.keys_exact(d,array['weekday','closed','intervals']) or not private.int_between(d->'weekday',1,7) or jsonb_typeof(d->'closed')<>'boolean' or jsonb_typeof(d->'intervals')<>'array' then raise exception 'INVALID_STALL_DETAILS';end if;
  day:=(d->>'weekday')::integer;
  if day=any(seen) then raise exception 'INVALID_STALL_DETAILS';end if;seen:=array_append(seen,day);
  if ((d->>'closed')::boolean and jsonb_array_length(d->'intervals')<>0) or (not (d->>'closed')::boolean and jsonb_array_length(d->'intervals') not between 1 and 4) then raise exception 'INVALID_STALL_DETAILS';end if;
  for i in select value from jsonb_array_elements(d->'intervals') loop
   if not private.keys_exact(i,array['opens','closes','closesNextDay']) or jsonb_typeof(i->'opens')<>'string' or jsonb_typeof(i->'closes')<>'string' or jsonb_typeof(i->'closesNextDay')<>'boolean'
   or (i->>'opens')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or (i->>'closes')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'INVALID_STALL_DETAILS';end if;
   a:=split_part(i->>'opens',':',1)::integer*60+split_part(i->>'opens',':',2)::integer;
   b:=split_part(i->>'closes',':',1)::integer*60+split_part(i->>'closes',':',2)::integer+case when (i->>'closesNextDay')::boolean then 1440 else 0 end;
   duration:=b-a;if duration<=0 or duration>1440 then raise exception 'INVALID_STALL_DETAILS';end if;
   a:=(day-1)*1440+a;b:=a+duration;
   for k in 1..case when b>10080 then 2 else 1 end loop
    if k=1 then segment_start:=a;segment_end:=least(b,10080);else segment_start:=0;segment_end:=b-10080;end if;
    for j in 1..coalesce(array_length(starts,1),0) loop
     if segment_start<ends[j] and segment_end>starts[j] then raise exception 'INVALID_STALL_DETAILS';end if;
    end loop;
    starts:=array_append(starts,segment_start);ends:=array_append(ends,segment_end);
   end loop;
  end loop;
 end loop;
end;
$$;
create function public.read_stall_details(p_actor_id uuid,p_restaurant_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.restaurant_memberships where restaurant_id=p_restaurant_id and user_id=p_actor_id and active) then raise exception 'FORBIDDEN';end if;
 select v.details into result from private.stall_details_current c join private.stall_details_versions v using(restaurant_id,version) where c.restaurant_id=p_restaurant_id;
 return jsonb_build_object('details',result);
end;
$$;
create function public.save_stall_details(p_actor_id uuid,p_restaurant_id uuid,p_expected_version integer,p_details jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_version integer;new_version integer;result jsonb;
begin
 if not exists(select 1 from public.restaurant_memberships where restaurant_id=p_restaurant_id and user_id=p_actor_id and active and role in ('owner','editor')) then raise exception 'FORBIDDEN';end if;
 perform 1 from public.restaurants where id=p_restaurant_id for update;
 perform private.validate_stall_details(p_details);
 select version into current_version from private.stall_details_current where restaurant_id=p_restaurant_id;
 current_version:=coalesce(current_version,0);
 if p_expected_version is null or p_expected_version<>current_version then raise exception 'STALE_STALL_DETAILS';end if;
 new_version:=current_version+1;
 result:=p_details||jsonb_build_object('restaurantId',p_restaurant_id,'version',new_version,'name',btrim(p_details->>'name'));
 insert into private.stall_details_versions(restaurant_id,version,details,created_by) values(p_restaurant_id,new_version,result,p_actor_id);
 insert into private.stall_details_current(restaurant_id,version) values(p_restaurant_id,new_version) on conflict(restaurant_id) do update set version=excluded.version;
 update public.restaurants set name=btrim(p_details->>'name') where id=p_restaurant_id;
 return jsonb_build_object('details',result);
end;
$$;
-- The old publication overload would bypass hours review, so remove it explicitly.
drop function public.publish_menu(uuid,uuid,jsonb);
create function public.publish_menu(p_restaurant_id uuid,p_actor_id uuid,p_menu jsonb,p_stall_details_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.restaurants;next_version integer;menu_id uuid;details_version integer;
begin
 if not exists(select 1 from public.restaurant_memberships where restaurant_id=p_restaurant_id and user_id=p_actor_id and active and role in ('owner','editor')) then raise exception 'FORBIDDEN';end if;
 select * into r from public.restaurants where id=p_restaurant_id for update;
 if not found then raise exception 'UNKNOWN_RESTAURANT';end if;
 select version into details_version from private.stall_details_current where restaurant_id=p_restaurant_id;
 if details_version is null then raise exception 'STALL_DETAILS_REQUIRED';end if;
 if p_stall_details_version is null or p_stall_details_version<>details_version then raise exception 'STALE_STALL_DETAILS';end if;
 perform private.validate_menu(p_menu);
 if (p_menu->>'restaurantId')::uuid<>p_restaurant_id then raise exception 'UNKNOWN_MENU';end if;
 menu_id:=(p_menu->>'id')::uuid;
 if r.current_menu_id is not null and r.current_menu_id<>menu_id then raise exception 'UNKNOWN_MENU';end if;
 next_version:=coalesce(r.current_menu_version,0)+1;
 if (p_menu->>'version')::integer<>next_version then raise exception 'STALE_MENU';end if;
 insert into private.menus(id,restaurant_id) values(menu_id,p_restaurant_id) on conflict(id) do nothing;
 if not exists(select 1 from private.menus where id=menu_id and restaurant_id=p_restaurant_id) then raise exception 'UNKNOWN_MENU';end if;
 insert into private.menu_versions(restaurant_id,menu_id,version,menu,published_by) values(p_restaurant_id,menu_id,next_version,p_menu,p_actor_id);
 insert into private.menu_stall_details(restaurant_id,menu_id,menu_version,details_version) values(p_restaurant_id,menu_id,next_version,details_version);
 update public.restaurants set current_menu_id=menu_id,current_menu_version=next_version,published=true where id=p_restaurant_id;
 return p_menu;
end;
$$;
create function public.read_published_stall(p_restaurant_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare menu jsonb;details jsonb;
begin
 menu:=public.read_published_menu(p_restaurant_id);
 select v.details into details from private.menu_stall_details m join private.stall_details_versions v on v.restaurant_id=m.restaurant_id and v.version=m.details_version
 where m.restaurant_id=p_restaurant_id and m.menu_id=(menu->>'id')::uuid and m.menu_version=(menu->>'version')::integer;
 return jsonb_build_object('menu',menu,'details',details);
end;
$$;
revoke all on function private.immutable_ticket_response(jsonb),private.current_kitchen_ticket(uuid),private.validate_stall_details(jsonb) from public,anon,authenticated;
revoke all on function public.complete_kitchen_order(uuid,uuid,uuid,integer,uuid),public.read_stall_details(uuid,uuid),public.save_stall_details(uuid,uuid,integer,jsonb),public.publish_menu(uuid,uuid,jsonb,integer),public.read_published_stall(uuid) from public,anon,authenticated;
grant execute on function public.complete_kitchen_order(uuid,uuid,uuid,integer,uuid),public.read_stall_details(uuid,uuid),public.save_stall_details(uuid,uuid,integer,jsonb),public.publish_menu(uuid,uuid,jsonb,integer),public.read_published_stall(uuid) to service_role;
commit;
