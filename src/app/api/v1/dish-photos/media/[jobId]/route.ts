import { dishPhotoHandlers } from "@/server/dish-photos";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) { return dishPhotoHandlers().media(request, (await context.params).jobId); }
