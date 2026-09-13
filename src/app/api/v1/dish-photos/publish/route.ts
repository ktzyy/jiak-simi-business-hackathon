import { dishPhotoHandlers } from "@/server/dish-photos";
export const runtime = "nodejs";
export const POST = dishPhotoHandlers().publish;
