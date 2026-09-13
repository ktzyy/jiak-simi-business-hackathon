import orangeBoard from "./fixtures/ocr-orange-board.json";
import { extractedMenuDraftSchema } from "./extraction";

/** Real live extraction, unapproved. Only the API draft; no local paths/provider metadata. */
export const OCR_DRAFT_FIXTURE = extractedMenuDraftSchema.parse(orangeBoard);
export const OCR_ERROR_FIXTURES = {
  unauthorized: { error: { code: "UNAUTHORIZED", message: "Sign in to the restaurant staff account.", retryable: false } },
  forbidden: { error: { code: "FORBIDDEN", message: "Restaurant access is required.", retryable: false } },
  rateLimited: { error: { code: "RATE_LIMITED", message: "Please wait before making another request.", retryable: true } },
  unreadable: { error: { code: "INVALID_IMAGE", message: "Upload a JPEG, PNG, or WebP menu image of at most 5 MiB with matching file contents.", retryable: false } },
} as const;
