import "server-only";
import { PUBLIC_DEMO_BEARER, PUBLIC_DEMO_RESTAURANT_ID } from "../shared/public-demo";
import { HttpError } from "./http";

const DEMO_ACTOR_ID = "b123ff27-d269-4b0f-97f6-78a3e97170a3";
export function isPublicDemoRequest(request: Request): boolean {
  return request.headers.get("authorization") === `Bearer ${PUBLIC_DEMO_BEARER}`;
}
// Every caller must pass its parsed, authoritative RPC restaurant scope.
// Missing scope is rejected, including session-only routes until separately scoped.
export function publicDemoActor(request: Request, restaurantId?: string): string | null {
  if (!isPublicDemoRequest(request)) return null;
  if (process.env.DEMO_MODE !== "true") throw new HttpError(401, "UNAUTHORIZED", "Public demo access is disabled.");
  if (restaurantId !== PUBLIC_DEMO_RESTAURANT_ID) throw new HttpError(403, "FORBIDDEN", "Public demo access is limited to the dummy stall.");
  return DEMO_ACTOR_ID;
}
