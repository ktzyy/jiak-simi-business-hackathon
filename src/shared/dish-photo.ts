import { z } from "zod";

export const MAX_DISH_PHOTO_BYTES = 8 * 1024 * 1024;
export const dishPhotoRegionSchema = z.strictObject({
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().positive().max(1), height: z.number().positive().max(1),
}).refine((value) => value.x + value.width <= 1 && value.y + value.height <= 1, "Region must stay within the source image.");

const dish = { dishId: z.string().min(1).max(200), dishName: z.string().trim().min(1).max(200), description: z.string().max(1000).optional() };
export const dishPhotoRequestSchema = z.discriminatedUnion("mode", [
  z.strictObject({ ...dish, mode: z.literal("generate_similar") }),
  z.strictObject({
    ...dish, mode: z.literal("enhance_visible"), merchantConfirmedVisible: z.literal(true),
    sourceImageId: z.string().uuid(), sourceEntryId: z.string().uuid(),
    // This is an optional operator-selected prompt hint, not a verified crop.
    region: dishPhotoRegionSchema.optional(),
  }),
]);
export const dishPhotoCandidateSchema = z.strictObject({
  id: z.string().uuid(), dishId: z.string(), status: z.literal("needs_review"),
  mode: z.enum(["generate_similar", "enhance_visible"]),
  label: z.enum(["AI-generated illustration", "AI-enhanced source photo"]),
  disclosureRequired: z.literal(true),
  mimeType: z.literal("image/jpeg"), imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceImageId: z.string().uuid().nullable(), sourceEntryId: z.string().uuid().nullable(),
  sourceImageSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  region: dishPhotoRegionSchema.nullable(),
  model: z.enum(["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"]),
  quality: z.literal("low"), size: z.literal("1024x1024"),
  promptSha256: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string().datetime(),
});
export const dishPhotoResponseSchema = z.strictObject({
  candidate: dishPhotoCandidateSchema,
  imageBase64: z.string().min(4).max(Math.ceil(MAX_DISH_PHOTO_BYTES / 3) * 4),
});
export type DishPhotoRequest = z.infer<typeof dishPhotoRequestSchema>;
export type DishPhotoCandidate = z.infer<typeof dishPhotoCandidateSchema>;
export type DishPhotoResponse = z.infer<typeof dishPhotoResponseSchema>;

// HTTP photo sidecar; ordering/menu price contracts remain unchanged.
export const dishPhotoJobSchema = z.strictObject({ jobId: z.uuid(), status: z.enum(["dispatch_unknown", "ready", "failed"]), candidate: dishPhotoCandidateSchema.nullable() });
export const publishedDishPhotoSchema = z.strictObject({ dishId: z.string(), dishName: z.string(), jobId: z.uuid(), candidate: dishPhotoCandidateSchema, imageUrl: z.string().startsWith("/api/v1/dish-photos/media/") });
export const publishedDishPhotosSchema = z.array(publishedDishPhotoSchema).max(100);
export const dishPhotoSelectionSchema = z.strictObject({ dishId: z.uuid(), jobId: z.uuid() });
export type DishPhotoJob = z.infer<typeof dishPhotoJobSchema>;
export type PublishedDishPhoto = z.infer<typeof publishedDishPhotoSchema>;
