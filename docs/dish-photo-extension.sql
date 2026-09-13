-- PROPOSAL ONLY: requires explicit approval before migration creation/application.
-- Target staging mikpepfrumtglwweolzq; applies after approved web-ordering extension.
begin;
create table private.dish_photo_jobs (
 id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id),
 actor_id uuid not null references auth.users(id), idempotency_key uuid not null,
 request jsonb not null, source jsonb, status text not null default 'dispatch_unknown' check(status in ('dispatch_unknown','ready','failed')),
 result jsonb, created_at timestamptz not null default now(), unique(restaurant_id,idempotency_key),
 check(pg_column_size(request)<=12000), check(source is null or pg_column_size(source)<=4000),
 check(result is null or pg_column_size(result)<=12000), check((status='ready')=(result is not null))
);
create index dish_photo_budget on private.dish_photo_jobs(restaurant_id,created_at);
create table private.published_dish_photos (
 restaurant_id uuid not null,menu_id uuid not null,menu_version integer not null,
 photos jsonb not null check(jsonb_typeof(photos)='array' and jsonb_array_length(photos)<=100),
 primary key(restaurant_id,menu_id,menu_version),
 foreign key(restaurant_id,menu_id,menu_version) references private.menu_versions(restaurant_id,menu_id,version)
);
alter table private.dish_photo_jobs enable row level security;
alter table private.published_dish_photos enable row level security;
revoke all on private.dish_photo_jobs,private.published_dish_photos from public,anon,authenticated,service_role;
-- No browser Storage policies: access is through scoped server endpoints only.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('dish-photos-private','dish-photos-private',false,8388608,array['image/jpeg','image/png','image/webp']);

create function public.reserve_dish_photo_job(p_actor_id uuid,p_restaurant_id uuid,p_idempotency_key uuid,p_request jsonb,p_source jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.dish_photo_jobs; mode text;
begin
 if not exists(select 1 from public.restaurant_memberships where restaurant_id=p_restaurant_id and user_id=p_actor_id and active and role in ('owner','editor')) then raise exception 'FORBIDDEN';end if;
 -- Restaurant row serializes reservations and both sliding rate caps.
 perform 1 from public.restaurants where id=p_restaurant_id for update;
 select * into j from private.dish_photo_jobs where restaurant_id=p_restaurant_id and idempotency_key=p_idempotency_key;
 if found then
  if j.request is distinct from p_request or j.source is distinct from p_source then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return jsonb_build_object('jobId',j.id,'status',j.status,'dispatchAllowed',false,'result',j.result);
 end if;
 mode:=p_request->>'mode';
 if p_idempotency_key is null or jsonb_typeof(p_request) is distinct from 'object' or pg_column_size(p_request)>12000
 or mode is null or mode not in ('enhance_visible','generate_similar')
 or coalesce(length(p_request->>'dishId'),0) not between 1 and 200 or coalesce(length(p_request->>'dishName'),0) not between 1 and 200 then raise exception 'INVALID_REQUEST';end if;
 if mode='enhance_visible' then
  if p_request->'merchantConfirmedVisible' is distinct from 'true'::jsonb or jsonb_typeof(p_source) is distinct from 'object'
   or p_source->>'sourceImageId' is distinct from p_request->>'sourceImageId'
   or coalesce(p_request->>'sourceImageId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or coalesce(p_request->>'sourceEntryId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or p_source->>'objectKey' is distinct from p_restaurant_id::text||'/sources/'||(p_request->>'sourceImageId')
   or coalesce(p_source->>'sha256','') !~ '^[a-f0-9]{64}$'
   or coalesce(p_source->>'mimeType','') not in ('image/jpeg','image/png','image/webp')
   or coalesce(p_source->>'sizeBytes','') !~ '^[0-9]{1,7}$' then raise exception 'INVALID_REQUEST';end if;
  if (p_source->>'sizeBytes')::integer not between 1 and 5242880 then raise exception 'INVALID_REQUEST';end if;
 elsif p_source is not null or p_request ? 'sourceImageId' or p_request ? 'sourceEntryId' then raise exception 'INVALID_REQUEST';end if;
 if (select count(*) from private.dish_photo_jobs where restaurant_id=p_restaurant_id and created_at>now()-interval '10 minutes')>=10
 or (select count(*) from private.dish_photo_jobs where restaurant_id=p_restaurant_id and created_at>now()-interval '24 hours')>=50 then raise exception 'RATE_LIMITED';end if;
 insert into private.dish_photo_jobs(restaurant_id,actor_id,idempotency_key,request,source) values(p_restaurant_id,p_actor_id,p_idempotency_key,p_request,p_source) returning * into j;
 return jsonb_build_object('jobId',j.id,'status',j.status,'dispatchAllowed',true,'result',null);
end;$$;

-- p_result NULL marks a definitive failure; it never refunds/reopens the reservation.
-- A timeout/crash leaves dispatch_unknown. A trusted handler may reconcile a known
-- provider output by finishing, but neither this function nor read redispatches.
create function public.finish_dish_photo_job(p_actor_id uuid,p_restaurant_id uuid,p_job_id uuid,p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.dish_photo_jobs;c jsonb;
begin
 if not exists(select 1 from public.restaurant_memberships where restaurant_id=p_restaurant_id and user_id=p_actor_id and active and role in ('owner','editor')) then raise exception 'FORBIDDEN';end if;
 select * into j from private.dish_photo_jobs where id=p_job_id and restaurant_id=p_restaurant_id for update;
 if not found then raise exception 'PHOTO_NOT_FOUND';end if;
 if j.status<>'dispatch_unknown' then
  if j.result is distinct from p_result then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return jsonb_build_object('jobId',j.id,'status',j.status,'result',j.result);
 end if;
 if p_result is not null then
  c:=p_result->'candidate';
  if jsonb_typeof(p_result) is distinct from 'object' or pg_column_size(p_result)>12000 or jsonb_typeof(c) is distinct from 'object'
   or p_result->>'objectKey' is distinct from p_restaurant_id::text||'/candidates/'||p_job_id::text
   or coalesce(p_result->>'sizeBytes','') !~ '^[0-9]{1,7}$'
   or c->>'dishId' is distinct from j.request->>'dishId' or c->>'mode' is distinct from j.request->>'mode'
   or coalesce(c->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or c->'region' is distinct from coalesce(j.request->'region','null'::jsonb)
   or c->>'status' is distinct from 'needs_review' or c->'disclosureRequired' is distinct from 'true'::jsonb
   or c->>'mimeType' is distinct from 'image/jpeg' or coalesce(c->>'imageSha256','') !~ '^[a-f0-9]{64}$'
   or coalesce(c->>'promptSha256','') !~ '^[a-f0-9]{64}$'
   or coalesce(c->>'model','') not in ('gpt-image-2.5-sunburst','gpt-image-2.5-flare')
   or c->>'quality' is distinct from 'low' or c->>'size' is distinct from '1024x1024'
   or c->>'label' is distinct from (case when j.request->>'mode'='enhance_visible' then 'AI-enhanced source photo' else 'AI-generated illustration' end)
   or c->>'sourceImageId' is distinct from j.request->>'sourceImageId'
   or c->>'sourceEntryId' is distinct from j.request->>'sourceEntryId'
   or c->>'sourceImageSha256' is distinct from j.source->>'sha256'
   then raise exception 'INVALID_REQUEST';end if;
  if (p_result->>'sizeBytes')::integer not between 1 and 8388608 then raise exception 'INVALID_REQUEST';end if;
 end if;
 update private.dish_photo_jobs set status=case when p_result is null then 'failed' else 'ready' end,result=p_result where id=j.id returning * into j;
 return jsonb_build_object('jobId',j.id,'status',j.status,'result',j.result);
end;$$;

create function public.read_dish_photo_job(p_actor_id uuid,p_restaurant_id uuid,p_job_id uuid,p_idempotency_key uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j private.dish_photo_jobs;
begin
 if not exists(select 1 from public.restaurant_memberships where restaurant_id=p_restaurant_id and user_id=p_actor_id and active and role in ('owner','editor')) then raise exception 'FORBIDDEN';end if;
 if (p_job_id is null)=(p_idempotency_key is null) then raise exception 'INVALID_REQUEST';end if;
 select * into j from private.dish_photo_jobs where restaurant_id=p_restaurant_id and ((p_job_id is not null and id=p_job_id) or (p_idempotency_key is not null and idempotency_key=p_idempotency_key));
 if not found then raise exception 'PHOTO_NOT_FOUND';end if;
 return jsonb_build_object('jobId',j.id,'status',j.status,'request',j.request,'source',j.source,'result',j.result,'dispatchAllowed',false);
end;$$;

-- p_selections is the merchant's explicit approval: [{dishId,jobId}].
-- It references immutable output; new output requires a new job and new approval.
create function public.publish_menu_with_photos(p_restaurant_id uuid,p_actor_id uuid,p_menu jsonb,p_stall_details_version integer,p_selections jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare selection jsonb;j private.dish_photo_jobs;dish jsonb;photos jsonb:='[]'::jsonb;result jsonb;
begin
 if not exists(select 1 from public.restaurant_memberships where restaurant_id=p_restaurant_id and user_id=p_actor_id and active and role in ('owner','editor')) then raise exception 'FORBIDDEN';end if;
 if jsonb_typeof(p_selections) is distinct from 'array' then raise exception 'INVALID_REQUEST';end if;
 if jsonb_array_length(p_selections)>100 or pg_column_size(p_selections)>30000 then raise exception 'INVALID_REQUEST';end if;
 if (select count(*)<>count(distinct value->>'dishId') from jsonb_array_elements(p_selections)) then raise exception 'INVALID_REQUEST';end if;
 for selection in select value from jsonb_array_elements(p_selections) loop
  if jsonb_typeof(selection) is distinct from 'object' or coalesce(selection->>'jobId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID_REQUEST';end if;
  select * into j from private.dish_photo_jobs where id=(selection->>'jobId')::uuid and restaurant_id=p_restaurant_id;
  if not found or j.status<>'ready' then raise exception 'STALE_PHOTO';end if;
  select value into dish from jsonb_array_elements(p_menu->'dishes') where value->>'id'=selection->>'dishId';
  if dish is null or dish->>'id' is distinct from j.request->>'dishId' or dish->>'name' is distinct from j.request->>'dishName' then raise exception 'STALE_PHOTO';end if;
  photos:=photos||jsonb_build_array(jsonb_build_object('dishId',dish->>'id','dishName',dish->>'name','jobId',j.id,'candidate',j.result->'candidate','objectKey',j.result->>'objectKey'));
 end loop;
 result:=public.publish_menu(p_restaurant_id,p_actor_id,p_menu,p_stall_details_version);
 insert into private.published_dish_photos(restaurant_id,menu_id,menu_version,photos) values(p_restaurant_id,(p_menu->>'id')::uuid,(p_menu->>'version')::integer,photos);
 return jsonb_build_object('menu',result,'photos',photos);
end;$$;

-- Server-only lookup supports immutable older published menu versions too.
-- Public HTTP returns sanitized manifest; media endpoint resolves only listed keys.
create function public.read_published_photos(p_restaurant_id uuid,p_menu_id uuid,p_menu_version integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from private.menu_versions v join public.restaurants r on r.id=v.restaurant_id where v.restaurant_id=p_restaurant_id and v.menu_id=p_menu_id and v.version=p_menu_version and r.published) then raise exception 'UNKNOWN_MENU';end if;
 return coalesce((select photos from private.published_dish_photos where restaurant_id=p_restaurant_id and menu_id=p_menu_id and menu_version=p_menu_version),'[]'::jsonb);
end;$$;
revoke all on function public.reserve_dish_photo_job(uuid,uuid,uuid,jsonb,jsonb),public.finish_dish_photo_job(uuid,uuid,uuid,jsonb),public.read_dish_photo_job(uuid,uuid,uuid,uuid),public.publish_menu_with_photos(uuid,uuid,jsonb,integer,jsonb),public.read_published_photos(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.reserve_dish_photo_job(uuid,uuid,uuid,jsonb,jsonb),public.finish_dish_photo_job(uuid,uuid,uuid,jsonb),public.read_dish_photo_job(uuid,uuid,uuid,uuid),public.publish_menu_with_photos(uuid,uuid,jsonb,integer,jsonb),public.read_published_photos(uuid,uuid,integer) to service_role;
commit;
