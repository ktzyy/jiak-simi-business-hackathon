-- Rollback-only pgTAP regression suite; run against local/staging after migration.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id,email) values
 ('a0000000-0000-4000-8000-000000000001','owner-one@example.invalid'),
 ('a0000000-0000-4000-8000-000000000002','owner-two@example.invalid'),
 ('a0000000-0000-4000-8000-000000000003','outsider@example.invalid');
insert into public.restaurants(id,name,slug) values
 ('b0000000-0000-4000-8000-000000000001','Test stall one','db-test-stall-one'),
 ('b0000000-0000-4000-8000-000000000002','Test stall two','db-test-stall-two');
insert into public.restaurant_memberships(restaurant_id,user_id,role) values
 ('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','owner'),
 ('b0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','owner');
create temporary table test_context(menu jsonb,cart jsonb,ticket jsonb);
insert into test_context(menu,cart) values (
'{"id":"c0000000-0000-4000-8000-000000000001","restaurantId":"b0000000-0000-4000-8000-000000000001","version":1,"currency":"SGD","name":"Test menu","dishes":[{"id":"d0000000-0000-4000-8000-000000000001","name":"Noodles","priceCents":500,"available":true,"modifierGroups":[{"id":"e0000000-0000-4000-8000-000000000001","name":"Size","minSelections":1,"maxSelections":1,"options":[{"id":"f0000000-0000-4000-8000-000000000001","name":"Large","priceDeltaCents":100},{"id":"f0000000-0000-4000-8000-000000000002","name":"Small","priceDeltaCents":0}]}]}]}',
'{"restaurantId":"b0000000-0000-4000-8000-000000000001","menuId":"c0000000-0000-4000-8000-000000000001","menuVersion":1,"lines":[{"dishId":"d0000000-0000-4000-8000-000000000001","quantity":2,"optionIds":["f0000000-0000-4000-8000-000000000001"]}]}');

select throws_ok($$select public.publish_menu('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002',(select menu from test_context))$$,'P0001','FORBIDDEN','cross-restaurant publication rejected');
select throws_ok($$select public.publish_menu('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',jsonb_set((select menu from test_context),'{dishes,0,priceCents}','null'))$$,'P0001','INVALID_MENU','unknown price cannot publish');
select throws_ok($$select public.publish_menu('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',jsonb_set((select menu from test_context),'{currency}','null'))$$,'P0001','INVALID_MENU','null currency cannot bypass validation');
select lives_ok($$select public.publish_menu('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',(select menu from test_context))$$,'owner publishes reviewed menu');
select is(public.read_published_menu('b0000000-0000-4000-8000-000000000001'),(select menu from test_context),'read returns exact candidate menu');
select throws_ok($$update private.menu_versions set menu='{}'$$,'P0001','IMMUTABLE_RECORD','published graph immutable');
do $$ begin perform public.create_guest_session('b0000000-0000-4000-8000-000000000001',repeat('1',64)); end $$;
select lives_ok($$select public.validate_guest_session(repeat('1',64),'b0000000-0000-4000-8000-000000000001')$$,'existing active guest capability reusable');
select throws_ok($$select public.validate_guest_session(repeat('1',64),'b0000000-0000-4000-8000-000000000002')$$,'P0001','INVALID_SESSION','guest validation binds restaurant');
do $$ begin for n in 1..20 loop perform public.consume_guest_ai_budget(repeat('1',64),'b0000000-0000-4000-8000-000000000001'); end loop; end $$;
select throws_ok($$select public.consume_guest_ai_budget(repeat('1',64),'b0000000-0000-4000-8000-000000000001')$$,'P0001','RATE_LIMITED','paid parse budget enforced atomically');
update private.guest_sessions set ai_window_started_at=now()-interval '11 minutes';
select lives_ok($$select public.consume_guest_ai_budget(repeat('1',64),'b0000000-0000-4000-8000-000000000001')$$,'paid parse budget resets after window');
update private.ai_usage_windows set calls=100;
select throws_ok($$select public.consume_guest_ai_budget(repeat('1',64),'b0000000-0000-4000-8000-000000000001')$$,'P0001','RATE_LIMITED','restaurant paid parse budget blocks session rotation');
update private.ai_usage_windows set window_started_at=now()-interval '11 minutes';
select lives_ok($$select public.consume_guest_ai_budget(repeat('1',64),'b0000000-0000-4000-8000-000000000001')$$,'restaurant paid parse window resets');
select is(public.quote_cart(repeat('1',64),(select cart from test_context))->>'totalCents','1200','server calculates option plus quantity');
select throws_ok($$select public.quote_cart(repeat('2',64),(select cart from test_context))$$,'P0001','INVALID_SESSION','unknown capability denied');
select throws_ok($$select public.quote_cart(repeat('1',64),jsonb_set((select cart from test_context),'{restaurantId}','"b0000000-0000-4000-8000-000000000002"'))$$,'P0001','UNKNOWN_MENU','session cannot order for another restaurant');
select throws_ok($$select public.quote_cart(repeat('1',64),jsonb_set((select cart from test_context),'{lines,0,quantity}','21'))$$,'P0001','INVALID_CART','quantity cap is 20');
select throws_ok($$select public.quote_cart(repeat('1',64),jsonb_set((select cart from test_context),'{lines,0,unitPriceCents}','1',true))$$,'P0001','INVALID_CART','client supplied price rejected');
select throws_ok($$select public.quote_cart(repeat('1',64),jsonb_set((select cart from test_context),'{lines,0,optionIds}','[]'))$$,'P0001','INVALID_OPTIONS','required group enforced');
select throws_ok($$select public.quote_cart(repeat('1',64),jsonb_set((select cart from test_context),'{lines,0,optionIds}','["f0000000-0000-4000-8000-000000000001","f0000000-0000-4000-8000-000000000001"]'))$$,'P0001','INVALID_OPTIONS','duplicate option rejected');
select throws_ok($$select public.quote_cart(repeat('1',64),jsonb_set((select cart from test_context),'{lines,0,optionIds}','["f0000000-0000-4000-8000-000000000001","f0000000-0000-4000-8000-000000000002"]'))$$,'P0001','INVALID_OPTIONS','conflicting group options rejected');
select throws_ok($$select public.quote_cart(repeat('1',64),jsonb_set((select cart from test_context),'{lines,0,dishId}','"d0000000-0000-4000-8000-000000000099"'))$$,'P0001','UNKNOWN_DISH','unknown dish rejected');
select throws_ok($$select private.price_cart(jsonb_set((select menu from test_context),'{dishes,0,modifierGroups,0,options,0,priceDeltaCents}','-1000'),(select cart from test_context))$$,'P0001','INVALID_MENU','negative computed unit price rejected');
select throws_ok($$select private.price_cart(jsonb_set((select menu from test_context),'{dishes,0,available}','false'),(select cart from test_context))$$,'P0001','UNKNOWN_DISH','unavailable dish rejected');
select throws_ok($$select public.submit_order(repeat('1',64),(select cart from test_context),1,'web','10000000-0000-4000-8000-000000000001')$$,'P0001','PRICE_CHANGED','reviewed total enforced');
select is((select count(*)::integer from private.idempotency_requests),0,'failed submission rolls back key');
select is((select count(*)::integer from public.orders),0,'failed submission creates no order');
update test_context set ticket=public.submit_order(repeat('1',64),cart,1200,'web','10000000-0000-4000-8000-000000000001');
select is((select ticket->>'paymentStatus' from test_context),'unpaid','ticket remains unpaid');
select is((select ticket->>'status' from test_context),'received','ticket starts received');
select is(public.submit_order(repeat('1',64),(select cart from test_context),1200,'web','10000000-0000-4000-8000-000000000001'),(select ticket from test_context),'same-key retry returns original immutable receipt');
select is((select count(*)::integer from public.orders),1,'retry does not duplicate order');
select is((select count(*)::integer from private.outbox_events),1,'retry does not duplicate delivery event');
select throws_ok($$select public.submit_order(repeat('1',64),(select cart from test_context),1201,'web','10000000-0000-4000-8000-000000000001')$$,'P0001','IDEMPOTENCY_CONFLICT','changed contents with same key fail');
select throws_ok($$update public.orders set total_cents=1$$,'P0001','IMMUTABLE_RECORD','ticket snapshot immutable');
select throws_ok($$select public.read_kitchen_orders('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002')$$,'P0001','FORBIDDEN','cross-restaurant kitchen RPC denied');
select is(jsonb_array_length(public.read_kitchen_orders('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001')->'orders'),1,'owner receives kitchen wrapper');
do $$ begin perform public.publish_menu('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',jsonb_set((select menu from test_context),'{version}','2')); end $$;
select throws_ok($$select public.quote_cart(repeat('1',64),(select cart from test_context))$$,'P0001','STALE_MENU','old menu requires review');
select is(public.submit_order(repeat('1',64),(select cart from test_context),1200,'web','10000000-0000-4000-8000-000000000001'),(select ticket from test_context),'committed retry succeeds after menu publication');
update private.guest_sessions set expires_at=now()-interval '1 minute',created_at=now()-interval '2 hours';
select throws_ok($$select public.quote_cart(repeat('1',64),(select cart from test_context))$$,'P0001','INVALID_SESSION','expired capability denied');

set local role anon;
select throws_ok('select * from public.orders','42501',null,'anonymous table reads denied');
select throws_ok('insert into public.orders default values','42501',null,'anonymous table inserts denied');
select throws_ok('update public.orders set status=''received''','42501',null,'anonymous table updates denied');
select throws_ok('delete from public.orders','42501',null,'anonymous table deletes denied');
select throws_ok($$select public.read_published_menu('b0000000-0000-4000-8000-000000000001')$$,'42501',null,'anonymous cannot call server-only RPC');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from public.restaurants),1,'staff RLS isolates restaurant');
select is((select count(*)::integer from public.orders),1,'member sees own kitchen ticket');
select throws_ok('insert into public.orders default values','42501',null,'staff cannot bypass submit transaction');
select throws_ok('update public.orders set status=''received''','42501',null,'staff cannot bypass immutable tickets');
select throws_ok('delete from public.orders','42501',null,'staff cannot delete tickets');
select throws_ok('update public.restaurant_memberships set role=''owner''','42501',null,'member cannot self-promote');
select throws_ok('select * from private.guest_sessions','42501',null,'guest token hashes not exposed to members');
select throws_ok($$select public.create_guest_session('b0000000-0000-4000-8000-000000000001',repeat('3',64))$$,'42501',null,'browser cannot mint arbitrary guest sessions');
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000002',true);
select is((select count(*)::integer from public.orders),0,'other restaurant sees no tickets');
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000003',true);
select is((select count(*)::integer from public.restaurants),0,'unaffiliated signed-in user sees no restaurants');
reset role;
select * from finish();
rollback;
