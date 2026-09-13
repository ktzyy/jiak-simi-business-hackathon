import { dishPhotoHandlers } from "@/server/dish-photos";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ key: string }> }) { return dishPhotoHandlers().byKey(request, (await context.params).key); }
