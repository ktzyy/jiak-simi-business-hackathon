import { createClient } from '@supabase/supabase-js';
import { isDeepStrictEqual } from 'node:util';
import { DEMO_MENU, DEMO_RESTAURANT_ID, DEMO_STAFF_EMAIL } from '../src/shared/demo-menu';
import { DEMO_FULL_MENU } from '../src/shared/demo-full-menu-proposal';
import { MenuSchema } from '../src/shared/contracts';

async function main() {
  if (process.argv[2] !== '--apply' || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://mikpepfrumtglwweolzq.supabase.co') throw new Error('invalid_configuration');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, options);
  const backend = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY!, options);
  const rpc = async (name: string, args: Record<string, unknown>) => { const { data, error } = await backend.rpc(name, args); if (error) throw new Error('rpc_unconfirmed_read_before_retry'); return data; };
  const login = await auth.auth.signInWithPassword({ email: DEMO_STAFF_EMAIL, password: process.env.DEMO_STAFF_PASSWORD! });
  if (login.error || !login.data.user) throw new Error('demo_login_failed');
  try {
    const scope = { p_actor_id: login.data.user.id, p_restaurant_id: DEMO_RESTAURANT_ID };
    const menu = MenuSchema.parse({ ...DEMO_FULL_MENU, version: 4, dishes: DEMO_MENU.dishes.map(d => DEMO_FULL_MENU.dishes.find(full => full.id === d.id)!) });
    const before = await rpc('read_published_stall', { p_restaurant_id: DEMO_RESTAURANT_ID });
    if (!isDeepStrictEqual(before.menu, DEMO_FULL_MENU) && !isDeepStrictEqual(before.menu, menu)) throw new Error('menu_changed_preserve_it');
    const details = (await rpc('read_stall_details', scope)).details;
    if (!details || !isDeepStrictEqual(before.details, details)) throw new Error('details_changed_preserve_them');
    if (before.menu.version === 3) await rpc('publish_menu', { ...scope, p_menu: menu, p_stall_details_version: details.version });
    const after = await rpc('read_published_stall', { p_restaurant_id: DEMO_RESTAURANT_ID });
    if (!isDeepStrictEqual(after.menu, menu)) throw new Error('publication_unconfirmed');
    console.log(JSON.stringify({ status: 'three_dish_demo_verified', version: menu.version, dishes: menu.dishes.map(d => d.name), sharedAddonsPerDish: menu.dishes[0].modifierGroups.find(g => g.name === 'Additional Ingredients')?.options.length, ordersCreated: 0 }));
  } finally { await auth.auth.signOut(); }
}
main().catch(error => { console.error(error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'unconfirmed_stop_and_review'); process.exitCode = 1; });
