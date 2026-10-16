import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth";

export function proxy(request: NextRequest) {
  const result = checkAuth(request.nextUrl.pathname, request.headers.get("authorization"), process.env);
  if (result.ok) return NextResponse.next();
  return new NextResponse(result.message, {
    status: result.status,
    headers: result.status === 401 ? { "WWW-Authenticate": 'Basic realm="Career Agent", charset="UTF-8"' } : {},
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
