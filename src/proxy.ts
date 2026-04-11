import { NextResponse } from 'next/server';

// Auth bypassed for local development — all routes are open.
export function proxy() {
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/projects/:path*', '/login'],
};
