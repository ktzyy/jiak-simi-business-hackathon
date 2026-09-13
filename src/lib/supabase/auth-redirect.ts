/** Return a local application path, never a protocol-relative or external URL. */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) return "/";
  let decoded = value;
  for (let depth = 0; depth < 5; depth++) {
    if (!decoded.startsWith("/") || decoded.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(decoded)) return "/";
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        const url = new URL(value, "https://local.invalid");
        return url.origin === "https://local.invalid" && !url.pathname.startsWith("//") ? `${url.pathname}${url.search}${url.hash}` : "/";
      }
      decoded = next;
    } catch { return "/"; }
  }
  return "/";
}

interface ConfirmationAuth {
  verifyOtp(input: { token_hash: string; type: "email" | "signup" }): PromiseLike<{ error: unknown }>;
  exchangeCodeForSession(code: string): PromiseLike<{ error: unknown }>;
}

/** Validate callback shape before touching Auth. PKCE uses the server cookie verifier. */
export async function completeAuthConfirmation(params: URLSearchParams, auth: () => Promise<ConfirmationAuth>): Promise<boolean> {
  if (["code", "token_hash", "type", "error"].some(key => params.getAll(key).length > 1) || params.has("error")) return false;
  const tokenHash = params.get("token_hash"), type = params.get("type"), code = params.get("code");
  const validToken = (value: string | null): value is string => Boolean(value && value.length <= 4096 && !/[\s\u0000-\u001f\u007f]/.test(value));
  try {
    if (validToken(code) && !params.has("token_hash") && !params.has("type")) {
      return !(await (await auth()).exchangeCodeForSession(code)).error;
    }
    if (validToken(tokenHash) && !params.has("code") && (type === "email" || type === "signup")) {
      return !(await (await auth()).verifyOtp({ token_hash: tokenHash, type })).error;
    }
  } catch { /* Auth details and callback credentials must not cross the response boundary. */ }
  return false;
}
