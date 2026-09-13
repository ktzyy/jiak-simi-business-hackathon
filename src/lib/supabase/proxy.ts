import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicSupabaseConfig } from "./config";

// One public customer page only; nested merchant/admin paths stay protected.
export function isPublicCustomerPath(pathname: string): boolean {
  return /^\/order\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(pathname);
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (isPublicCustomerPath(request.nextUrl.pathname)) {
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  const { url, publishableKey } = getPublicSupabaseConfig();

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        const previous = response;
        response = NextResponse.next({ request });
        previous.cookies.getAll().forEach(cookie => response.cookies.set(cookie));
        for (const name of ["Cache-Control", "Pragma", "Expires"]) {
          const value = previous.headers.get(name);
          if (value) response.headers.set(name, value);
        }
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // This validates the JWT and refreshes an expired session when possible.
  const { data, error } = await supabase.auth.getClaims();
  const isSignedIn = !error && Boolean(data?.claims?.sub);
  // Authenticated pages and their redirects must never be shared-cache entries.
  response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  const redirectWithSession = (url: URL) => {
    const redirected = NextResponse.redirect(url);
    for (const name of ["Cache-Control", "Pragma", "Expires"]) {
      redirected.headers.set(name, response.headers.get(name)!);
    }
    response.cookies.getAll().forEach(cookie => redirected.cookies.set(cookie));
    return redirected;
  };
  const isLoginRoute = request.nextUrl.pathname === "/login";

  if (!isSignedIn && !isLoginRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return redirectWithSession(loginUrl);
  }

  if (isSignedIn && isLoginRoute) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return redirectWithSession(homeUrl);
  }

  return response;
}
