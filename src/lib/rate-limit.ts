// Simple in-memory rate limiter
// For production at scale, use Redis instead

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetTime) {
      store.delete(key);
    }
  }
}, 60000); // Clean every minute

interface RateLimitOptions {
  limit: number;      // Max requests
  windowMs: number;   // Time window in ms
}

interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetIn: number;
}

export function rateLimit(
  identifier: string,
  options: RateLimitOptions = { limit: 10, windowMs: 60000 }
): RateLimitResult {
  const now = Date.now();
  const key = identifier;

  let entry = store.get(key);

  if (!entry || now > entry.resetTime) {
    entry = {
      count: 0,
      resetTime: now + options.windowMs,
    };
    store.set(key, entry);
  }

  entry.count++;

  const remaining = Math.max(0, options.limit - entry.count);
  const resetIn = Math.max(0, entry.resetTime - now);

  return {
    success: entry.count <= options.limit,
    remaining,
    resetIn,
  };
}

// Helper to get client IP from request
export function getClientIP(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return 'unknown';
}

// Rate limit response helper
export function rateLimitResponse(resetIn: number): Response {
  return new Response(
    JSON.stringify({ error: 'Too many requests. Please try again later.' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.ceil(resetIn / 1000)),
      },
    }
  );
}
