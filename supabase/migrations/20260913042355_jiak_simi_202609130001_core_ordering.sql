-- Approved hackathon-only core. Target: mikpepfrumtglwweolzq. Never production.
begin;
create schema if not exists private;
-- Object-level revokes below are limited to objects owned by this migration.
-- Unexposed schema placement plus explicit object grants isolate these internals.

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
  published boolean not null default false,
  current_menu_id uuid,
  current_menu_version integer,
  created_at timestamptz not null default now(),
  check ((current_menu_id is null) = (current_menu_version is null)),
  check (not published or current_menu_id is not null)
);
create table public.restaurant_memberships (
  restaurant_id uuid not null references public.restaurants(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner','editor','kitchen')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (restaurant_id,user_id)
);
create index memberships_user_active on public.restaurant_memberships(user_id,restaurant_id) where active;
create table private.menus (
  id uuid primary key,
  restaurant_id uuid not null references public.restaurants(id),
  unique(restaurant_id,id)
);
create table private.menu_versions (
  restaurant_id uuid not null,
  menu_id uuid not null,
  version integer not null check(version > 0),
  menu jsonb not null,
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  primary key(restaurant_id,menu_id,version),
  foreign key(restaurant_id,menu_id) references private.menus(restaurant_id,id)
);
alter table public.restaurants add constraint restaurants_current_menu_fk foreign key(id,current_menu_id,current_menu_version) references private.menu_versions(restaurant_id,menu_id,version);
create table private.guest_sessions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null default(now() + interval '2 hours'),
  closed_at timestamptz,
  ai_window_started_at timestamptz not null default now(),
  ai_calls integer not null default 0 check(ai_calls >= 0),
  created_at timestamptz not null default now(),
  unique(restaurant_id,id),
  check(expires_at > created_at)
);
create index guest_sessions_expiry on private.guest_sessions(expires_at);
create table private.ai_usage_windows (
  restaurant_id uuid primary key references public.restaurants(id),
  window_started_at timestamptz not null default now(),
  calls integer not null default 0 check(calls >= 0)
);
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  guest_session_id uuid not null,
  source text not null check(source in ('web','whatsapp','voice')),
  status text not null default 'received' check(status='received'),
  payment_status text not null default 'unpaid' check(payment_status='unpaid'),
  cart jsonb not null,
  total_cents bigint not null check(total_cents >= 0),
  created_at timestamptz not null default now(),
  unique(restaurant_id,id),
  foreign key(restaurant_id,guest_session_id) references private.guest_sessions(restaurant_id,id)
);
create index orders_kitchen on public.orders(restaurant_id,created_at,id);
create table private.idempotency_requests (
  restaurant_id uuid not null,
  guest_session_id uuid not null,
  key uuid not null,
  request_body jsonb not null,
  order_id uuid,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key(restaurant_id,guest_session_id,key),
  foreign key(restaurant_id,guest_session_id) references private.guest_sessions(restaurant_id,id),
  foreign key(restaurant_id,order_id) references public.orders(restaurant_id,id),
  check((order_id is null) = (response is null))
);
create table private.outbox_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  order_id uuid not null,
  event_type text not null check(event_type='order.received'),
  state text not null default 'pending' check(state in ('pending','sending','sent','failed')),
  attempts integer not null default 0 check(attempts >= 0),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  unique(order_id,event_type),
  foreign key(restaurant_id,order_id) references public.orders(restaurant_id,id)
);
create index outbox_pending on private.outbox_events(state,available_at);

-- Every app table has RLS, including unexposed internals. No guest table grants.
alter table public.restaurants enable row level security;
alter table public.restaurant_memberships enable row level security;
alter table public.orders enable row level security;
alter table private.menus enable row level security;
alter table private.menu_versions enable row level security;
alter table private.guest_sessions enable row level security;
alter table private.ai_usage_windows enable row level security;
alter table private.idempotency_requests enable row level security;
alter table private.outbox_events enable row level security;
revoke all on public.restaurants,public.restaurant_memberships,public.orders from public,anon,authenticated;
revoke all on private.menus,private.menu_versions,private.guest_sessions,private.ai_usage_windows,private.idempotency_requests,private.outbox_events from public,anon,authenticated;
grant select on public.restaurants,public.restaurant_memberships,public.orders to authenticated;

create function private.is_member(p_restaurant_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.restaurant_memberships m
    where m.restaurant_id=p_restaurant_id and m.user_id=(select auth.uid()) and m.active);
$$;
revoke all on function private.is_member(uuid) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_member(uuid) to authenticated;
create policy restaurant_member_read on public.restaurants for select to authenticated using(private.is_member(id));
create policy membership_self_read on public.restaurant_memberships for select to authenticated using(user_id=(select auth.uid()) and active);
create policy orders_member_read on public.orders for select to authenticated using(private.is_member(restaurant_id));

create function private.reject_mutation() returns trigger language plpgsql set search_path = '' as $$
begin raise exception using message='IMMUTABLE_RECORD',errcode='P0001'; end;
$$;
create trigger immutable_menu_version before update or delete on private.menu_versions for each row execute function private.reject_mutation();
create trigger immutable_order before update or delete on public.orders for each row execute function private.reject_mutation();

create function private.keys_exact(v jsonb, allowed text[]) returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(v) <> 'object' or v is null then false else
    (select coalesce(array_agg(k order by k),array[]::text[]) from jsonb_object_keys(v) k) =
    (select array_agg(k order by k) from unnest(allowed) k) end;
$$;
create function private.int_between(v jsonb, lo numeric, hi numeric) returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(v)='number' then
    (v#>>'{}')::numeric between lo and hi and trunc((v#>>'{}')::numeric)=(v#>>'{}')::numeric else false end;
$$;
create function private.valid_name(v jsonb) returns boolean language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(v)='string' and length(v#>>'{}') between 1 and 120,false);
$$;

create function private.validate_menu(p_menu jsonb) returns void language plpgsql set search_path = '' as $$
declare d jsonb; g jsonb; o jsonb; dish_ids uuid[] := '{}'; group_ids uuid[]; option_ids uuid[]; v_id uuid;
begin
  if not private.keys_exact(p_menu,array['id','restaurantId','version','currency','name','dishes'])
    or not private.int_between(p_menu->'version',1,2147483647) or p_menu->>'currency' is distinct from 'SGD'
    or not private.valid_name(p_menu->'name') or jsonb_typeof(p_menu->'dishes') <> 'array' then
    raise exception 'INVALID_MENU'; end if;
  perform (p_menu->>'id')::uuid,(p_menu->>'restaurantId')::uuid;
  if jsonb_array_length(p_menu->'dishes') not between 1 and 100 then raise exception 'INVALID_MENU'; end if;
  for d in select value from jsonb_array_elements(p_menu->'dishes') loop
    if not private.keys_exact(d,array['id','name','priceCents','available','modifierGroups']) or not private.valid_name(d->'name')
      or not private.int_between(d->'priceCents',0,1000000) or jsonb_typeof(d->'available') <> 'boolean'
      or jsonb_typeof(d->'modifierGroups') <> 'array' then raise exception 'INVALID_MENU'; end if;
    v_id := (d->>'id')::uuid;
    if v_id is null or v_id=any(dish_ids) then raise exception 'INVALID_MENU'; end if;
    dish_ids := array_append(dish_ids,v_id); group_ids := '{}'; option_ids := '{}';
    if jsonb_array_length(d->'modifierGroups') > 20 then raise exception 'INVALID_MENU'; end if;
    for g in select value from jsonb_array_elements(d->'modifierGroups') loop
      if not private.keys_exact(g,array['id','name','minSelections','maxSelections','options']) or not private.valid_name(g->'name')
        or not private.int_between(g->'minSelections',0,20) or not private.int_between(g->'maxSelections',0,20)
        or jsonb_typeof(g->'options') <> 'array' then raise exception 'INVALID_MENU'; end if;
      v_id := (g->>'id')::uuid;
      if v_id is null or v_id=any(group_ids) then raise exception 'INVALID_MENU'; end if;
      group_ids := array_append(group_ids,v_id);
      if jsonb_array_length(g->'options') > 20 or (g->>'minSelections')::integer > (g->>'maxSelections')::integer
        or (g->>'maxSelections')::integer > jsonb_array_length(g->'options') then raise exception 'INVALID_MENU'; end if;
      for o in select value from jsonb_array_elements(g->'options') loop
        if not private.keys_exact(o,array['id','name','priceDeltaCents']) or not private.valid_name(o->'name')
          or not private.int_between(o->'priceDeltaCents',-1000000,1000000) then raise exception 'INVALID_MENU'; end if;
        v_id := (o->>'id')::uuid;
        if v_id is null or v_id=any(option_ids) then raise exception 'INVALID_MENU'; end if;
        option_ids := array_append(option_ids,v_id);
      end loop;
    end loop;
  end loop;
  if p_menu->>'id' is null or p_menu->>'restaurantId' is null then raise exception 'INVALID_MENU'; end if;
exception when invalid_text_representation then raise exception 'INVALID_MENU';
end;
$$;

-- Server-only RPCs: actor IDs are accepted only from the trusted backend after JWT verification.
create function public.publish_menu(p_restaurant_id uuid,p_actor_id uuid,p_menu jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; next_version integer; menu_id uuid;
begin
  if not exists(select 1 from public.restaurant_memberships where restaurant_id=p_restaurant_id and user_id=p_actor_id and active and role in ('owner','editor')) then raise exception 'FORBIDDEN'; end if;
  select * into r from public.restaurants where id=p_restaurant_id for update;
  if not found then raise exception 'UNKNOWN_RESTAURANT'; end if;
  perform private.validate_menu(p_menu);
  if (p_menu->>'restaurantId')::uuid <> p_restaurant_id then raise exception 'UNKNOWN_MENU'; end if;
  menu_id := (p_menu->>'id')::uuid;
  if r.current_menu_id is not null and r.current_menu_id <> menu_id then raise exception 'UNKNOWN_MENU'; end if;
  next_version := coalesce(r.current_menu_version,0)+1;
  if (p_menu->>'version')::integer <> next_version then raise exception 'STALE_MENU'; end if;
  insert into private.menus(id,restaurant_id) values(menu_id,p_restaurant_id) on conflict(id) do nothing;
  if not exists(select 1 from private.menus where id=menu_id and restaurant_id=p_restaurant_id) then raise exception 'UNKNOWN_MENU'; end if;
  insert into private.menu_versions(restaurant_id,menu_id,version,menu,published_by) values(p_restaurant_id,menu_id,next_version,p_menu,p_actor_id);
  update public.restaurants set current_menu_id=menu_id,current_menu_version=next_version,published=true where id=p_restaurant_id;
  return p_menu;
end;
$$;
create function public.read_published_menu(p_restaurant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  select v.menu into result from public.restaurants r join private.menu_versions v on
    (v.restaurant_id,v.menu_id,v.version)=(r.id,r.current_menu_id,r.current_menu_version)
    where r.id=p_restaurant_id and r.published;
  if result is null then raise exception 'UNKNOWN_MENU'; end if;
  return result;
end;
$$;
create function public.create_guest_session(p_restaurant_id uuid,p_token_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare session_id uuid;
begin
  if not exists(select 1 from public.restaurants where id=p_restaurant_id and published) then raise exception 'UNKNOWN_MENU'; end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_SESSION'; end if;
  insert into private.guest_sessions(restaurant_id,token_hash) values(p_restaurant_id,p_token_hash) returning id into session_id;
  return session_id;
end;
$$;

create function public.validate_guest_session(p_session_token_hash text,p_restaurant_id uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare sid uuid;
begin
  select id into sid from private.guest_sessions where token_hash=p_session_token_hash and restaurant_id=p_restaurant_id and closed_at is null and expires_at>now();
  if sid is null then raise exception 'INVALID_SESSION'; end if;
  return sid;
end;
$$;
create function public.consume_guest_ai_budget(p_session_token_hash text,p_restaurant_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s private.guest_sessions; usage_row private.ai_usage_windows;
begin
  select * into s from private.guest_sessions where token_hash=p_session_token_hash and restaurant_id=p_restaurant_id and closed_at is null and expires_at>now() for update;
  if not found then raise exception 'INVALID_SESSION'; end if;
  insert into private.ai_usage_windows(restaurant_id) values(p_restaurant_id) on conflict do nothing;
  select * into usage_row from private.ai_usage_windows where restaurant_id=p_restaurant_id for update;
  if usage_row.window_started_at <= now()-interval '10 minutes' then
    update private.ai_usage_windows set window_started_at=now(),calls=1 where restaurant_id=p_restaurant_id;
  else
    if usage_row.calls >= 100 then raise exception 'RATE_LIMITED'; end if;
    update private.ai_usage_windows set calls=calls+1 where restaurant_id=p_restaurant_id;
  end if;
  if s.ai_window_started_at <= now()-interval '10 minutes' then
    update private.guest_sessions set ai_window_started_at=now(),ai_calls=1 where id=s.id;
  else
    if s.ai_calls >= 20 then raise exception 'RATE_LIMITED'; end if;
    update private.guest_sessions set ai_calls=ai_calls+1 where id=s.id;
  end if;
  return s.id;
end;
$$;

create function private.price_cart(p_menu jsonb,p_cart jsonb) returns jsonb language plpgsql set search_path = '' as $$
declare l jsonb; d jsonb; g jsonb; o jsonb; oid jsonb; qty integer; selected uuid[]; uid uuid; n integer; matched integer;
  options jsonb; lines jsonb := '[]'; unit bigint; total bigint := 0;
begin
  if not private.keys_exact(p_cart,array['restaurantId','menuId','menuVersion','lines'])
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
  return jsonb_build_object('restaurantId',p_menu->>'restaurantId','menuId',p_menu->>'id','menuVersion',(p_menu->>'version')::integer,'currency','SGD','lines',lines,'totalCents',total);
exception when invalid_text_representation then raise exception 'INVALID_CART';
end;
$$;
create function public.quote_cart(p_session_token_hash text,p_cart jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s private.guest_sessions; m jsonb;
begin
  select * into s from private.guest_sessions where token_hash=p_session_token_hash and closed_at is null and expires_at>now();
  if not found then raise exception 'INVALID_SESSION'; end if;
  perform 1 from public.restaurants where id=s.restaurant_id for update;
  m := public.read_published_menu(s.restaurant_id);
  return private.price_cart(m,p_cart);
end;
$$;
create function public.submit_order(p_session_token_hash text,p_cart jsonb,p_reviewed_total_cents bigint,p_source text,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s private.guest_sessions; request jsonb; prior private.idempotency_requests; q jsonb; ticket jsonb; placed public.orders;
begin
  if p_source is null or p_source not in ('web','whatsapp','voice') or p_reviewed_total_cents is null or p_reviewed_total_cents<0 or p_idempotency_key is null then raise exception 'INVALID_REQUEST'; end if;
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
create function public.read_kitchen_orders(p_restaurant_id uuid,p_actor_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.restaurant_memberships where restaurant_id=p_restaurant_id and user_id=p_actor_id and active) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object('orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'createdAt',to_char(o.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'source',o.source,'status',o.status,'paymentStatus',o.payment_status,'cart',o.cart) order by o.created_at,o.id) from public.orders o where restaurant_id=p_restaurant_id),'[]'::jsonb));
end;
$$;
-- Definer functions are not browser endpoints. Backend authenticates staff or guest before RPC.
revoke all on function private.is_member(uuid),private.reject_mutation(),private.keys_exact(jsonb,text[]),private.int_between(jsonb,numeric,numeric),private.valid_name(jsonb),private.validate_menu(jsonb),private.price_cart(jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.is_member(uuid) to authenticated;
revoke all on function public.publish_menu(uuid,uuid,jsonb),public.read_published_menu(uuid),public.create_guest_session(uuid,text),public.quote_cart(text,jsonb),public.submit_order(text,jsonb,bigint,text,uuid),public.read_kitchen_orders(uuid,uuid),public.validate_guest_session(text,uuid),public.consume_guest_ai_budget(text,uuid) from public,anon,authenticated;
grant execute on function public.publish_menu(uuid,uuid,jsonb),public.read_published_menu(uuid),public.create_guest_session(uuid,text),public.quote_cart(text,jsonb),public.submit_order(text,jsonb,bigint,text,uuid),public.read_kitchen_orders(uuid,uuid),public.validate_guest_session(text,uuid),public.consume_guest_ai_budget(text,uuid) to service_role;
commit;
