import assert from "node:assert/strict";
import test from "node:test";
import { fixtureStallDetails, StallDetailsInputSchema, WeeklyHoursSchema } from "../src/shared/stall-details";
import { stallDetailsHandlers } from "../src/server/stall-details";
import type { BackendClient } from "../src/server/supabase-backend";
import { fixtureMenu } from "../src/shared/fixtures";
const closedWeek = () => Array.from({ length: 7 }, (_, index) => ({ weekday: index + 1, closed: true, intervals: [] as { opens: string; closes: string; closesNextDay: boolean }[] }));
const interval = (opens: string, closes: string, closesNextDay = false) => ({ opens, closes, closesNextDay });

test("opening hours require every day explicitly and reject malformed/zero/overlong intervals", () => {
  assert.equal(WeeklyHoursSchema.safeParse(closedWeek()).success, true);
  assert.equal(WeeklyHoursSchema.safeParse(closedWeek().slice(1)).success, false);
  const duplicate = closedWeek(); duplicate[6].weekday = 1;
  assert.equal(WeeklyHoursSchema.safeParse(duplicate).success, false);
  for (const bad of [interval("24:00", "01:00", true), interval("9:00", "18:00"), interval("09:00", "09:00"), interval("18:00", "09:00"), interval("09:00", "18:00", true)]) {
    const week = closedWeek(); week[0] = { weekday: 1, closed: false, intervals: [bad] };
    assert.equal(WeeklyHoursSchema.safeParse(week).success, false);
  }
  const week = closedWeek(); week[0].closed = false;
  assert.equal(WeeklyHoursSchema.safeParse(week).success, false);
  week[0].closed = true; week[0].intervals = [interval("09:00", "18:00")];
  assert.equal(WeeklyHoursSchema.safeParse(week).success, false);
});

test("split hours permit adjacent boundaries and 24h service but reject weekly wrap overlaps", () => {
  const week = closedWeek();
  week[0] = { weekday: 1, closed: false, intervals: [interval("09:00", "12:00"), interval("12:00", "18:00")] };
  assert.equal(WeeklyHoursSchema.safeParse(week).success, true);
  week[0].intervals[1].opens = "11:59";
  assert.equal(WeeklyHoursSchema.safeParse(week).success, false);
  week[0].intervals = [interval("00:00", "00:00", true)];
  assert.equal(WeeklyHoursSchema.safeParse(week).success, true);
  week[0].intervals = [interval("01:00", "03:00")];
  week[6] = { weekday: 7, closed: false, intervals: [interval("22:00", "02:00", true)] };
  assert.equal(WeeklyHoursSchema.safeParse(week).success, false);
  week[0].intervals[0].opens = "02:00";
  assert.equal(WeeklyHoursSchema.safeParse(week).success, true);
});

test("stall details require a name and Singapore timezone without default hours", () => {
  const details = { name: "  Test stall  ", timezone: "Asia/Singapore", weeklyHours: fixtureStallDetails.weeklyHours };
  assert.equal(StallDetailsInputSchema.parse(details).name, "Test stall");
  assert.equal(StallDetailsInputSchema.safeParse({ ...details, weeklyHours: undefined }).success, false);
  assert.equal(StallDetailsInputSchema.safeParse({ ...details, timezone: "UTC" }).success, false);
  assert.equal(StallDetailsInputSchema.safeParse({ ...details, name: " " }).success, false);
});

test("details routes verify staff, reject incomplete hours and bind optimistic save version", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const actor = "00000000-0000-4000-8000-000000000009";
  const backend: BackendClient = {
    auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) },
    rpc: async (name, args) => { calls.push({ name, args }); return { data: { details: fixtureStallDetails }, error: null }; },
  };
  const handlers = stallDetailsHandlers(() => backend);
  const url = `http://localhost:3000/api/v1/restaurants/${fixtureStallDetails.restaurantId}/details`;
  assert.equal((await handlers.read(new Request(url), fixtureStallDetails.restaurantId)).status, 401);
  assert.equal(calls.length, 0);
  const input = { name: fixtureStallDetails.name, timezone: fixtureStallDetails.timezone, weeklyHours: fixtureStallDetails.weeklyHours, expectedVersion: 0 };
  const request = (body: unknown) => new Request(url, { method: "PUT", headers: { authorization: "Bearer staff-token", origin: process.env.APP_ORIGIN || "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await handlers.save(request({ ...input, weeklyHours: [] }), fixtureStallDetails.restaurantId)).status, 400);
  assert.equal(calls.length, 0);
  const response = await handlers.save(request(input), fixtureStallDetails.restaurantId);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls[0], { name: "save_stall_details", args: { p_actor_id: actor, p_restaurant_id: fixtureStallDetails.restaurantId, p_expected_version: 0, p_details: { name: input.name, timezone: input.timezone, weeklyHours: input.weeklyHours } } });
  assert.equal((await handlers.save(request({ ...input, expectedVersion: 2 }), fixtureStallDetails.restaurantId)).status, 502);
});

test("public details use immutable publication RPC and represent legacy hours as absent", async () => {
  const calls: string[] = [];
  const backend: BackendClient = { auth: { getUser: async () => { throw new Error("Public read does not require staff login"); } }, rpc: async name => { calls.push(name); return { data: { menu: fixtureMenu, details: null }, error: null }; } };
  const response = await stallDetailsHandlers(() => backend).published(new Request("http://localhost:3000"), fixtureMenu.restaurantId);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).details, null);
  assert.deepEqual(calls, ["read_published_stall"]);
});
