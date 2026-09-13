-- PROPOSAL: requires Kimberley approval before applying to staging.
-- Extends two existing photo functions. No new tables, no menu/order changes.
-- Original JPEG crops use the existing private storage and publication manifest.
begin;
create or replace function public.reserve_dish_photo_job(p_actor_id uuid,p_restaurant_id uuid,p_idempotency_key uuid,p_request jsonb,p_source jsonb default null)
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
 or mode is null or mode not in ('enhance_visible','generate_similar','source_crop')
 or coalesce(length(p_request->>'dishId'),0) not between 1 and 200 or coalesce(length(p_request->>'dishName'),0) not between 1 and 200 then raise exception 'INVALID_REQUEST';end if;
 if mode in ('enhance_visible','source_crop') then
  if (mode='enhance_visible' and p_request->'merchantConfirmedVisible' is distinct from 'true'::jsonb) or jsonb_typeof(p_source) is distinct from 'object'
   or p_source->>'sourceImageId' is distinct from p_request->>'sourceImageId'
   or coalesce(p_request->>'sourceImageId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or coalesce(p_request->>'sourceEntryId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or p_source->>'objectKey' is distinct from p_restaurant_id::text||'/sources/'||(p_request->>'sourceImageId')
   or coalesce(p_source->>'sha256','') !~ '^[a-f0-9]{64}$'
   or coalesce(p_source->>'mimeType','') not in ('image/jpeg','image/png','image/webp')
   or coalesce(p_source->>'sizeBytes','') !~ '^[0-9]{1,7}$' then raise exception 'INVALID_REQUEST';end if;
  if (p_source->>'sizeBytes')::integer not between 1 and 5242880 then raise exception 'INVALID_REQUEST';end if;
 elsif p_source is not null or p_request ? 'sourceImageId' or p_request ? 'sourceEntryId' then raise exception 'INVALID_REQUEST';end if;
 if mode <> 'source_crop' and ((select count(*) from private.dish_photo_jobs where restaurant_id=p_restaurant_id and created_at>now()-interval '10 minutes' and request->>'mode'<>'source_crop')>=10
 or (select count(*) from private.dish_photo_jobs where restaurant_id=p_restaurant_id and created_at>now()-interval '24 hours' and request->>'mode'<>'source_crop')>=50) then raise exception 'RATE_LIMITED';end if;
 if mode='source_crop' and (select count(*) from private.dish_photo_jobs where restaurant_id=p_restaurant_id and created_at>now()-interval '24 hours' and request->>'mode'='source_crop')>=300 then raise exception 'RATE_LIMITED';end if;
 insert into private.dish_photo_jobs(restaurant_id,actor_id,idempotency_key,request,source) values(p_restaurant_id,p_actor_id,p_idempotency_key,p_request,p_source) returning * into j;
 return jsonb_build_object('jobId',j.id,'status',j.status,'dispatchAllowed',true,'result',null);
end;$$;

-- p_result NULL marks a definitive failure; it never refunds/reopens the reservation.
-- A timeout/crash leaves dispatch_unknown. A trusted handler may reconcile a known
-- provider output by finishing, but neither this function nor read redispatches.
create or replace function public.finish_dish_photo_job(p_actor_id uuid,p_restaurant_id uuid,p_job_id uuid,p_result jsonb)
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
   or c->>'status' is distinct from 'needs_review' or c->'disclosureRequired' is distinct from to_jsonb(j.request->>'mode'<>'source_crop')
   or c->>'mimeType' is distinct from 'image/jpeg' or coalesce(c->>'imageSha256','') !~ '^[a-f0-9]{64}$'
   or coalesce(c->>'promptSha256','') !~ '^[a-f0-9]{64}$'
   or (j.request->>'mode'<>'source_crop' and (coalesce(c->>'model','') not in ('gpt-image-2.5-sunburst','gpt-image-2.5-flare') or c->>'quality' is distinct from 'low' or c->>'size' is distinct from '1024x1024'))
   or (j.request->>'mode'='source_crop' and (c->'model' is distinct from 'null'::jsonb or c->'quality' is distinct from 'null'::jsonb or c->'size' is distinct from 'null'::jsonb))
   or c->>'label' is distinct from (case when j.request->>'mode'='source_crop' then 'Original photo' when j.request->>'mode'='enhance_visible' then 'AI-enhanced source photo' else 'AI-generated illustration' end)
   or c->>'sourceImageId' is distinct from j.request->>'sourceImageId'
   or c->>'sourceEntryId' is distinct from j.request->>'sourceEntryId'
   or c->>'sourceImageSha256' is distinct from j.source->>'sha256'
   then raise exception 'INVALID_REQUEST';end if;
  if (p_result->>'sizeBytes')::integer not between 1 and 8388608 then raise exception 'INVALID_REQUEST';end if;
 end if;
 update private.dish_photo_jobs set status=case when p_result is null then 'failed' else 'ready' end,result=p_result where id=j.id returning * into j;
 return jsonb_build_object('jobId',j.id,'status',j.status,'result',j.result);
end;$$;


commit;
