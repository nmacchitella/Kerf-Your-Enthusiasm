import { NextRequest, NextResponse } from 'next/server';
import { getDevSession } from '@/lib/dev-session';
import { db } from '@/db';
import { projects, stocks, cuts } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { rateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

export async function GET() {
  const session = getDevSession();

  const userProjects = await db.query.projects.findMany({
    where: eq(projects.userId, session.user.id),
    with: {
      stocks: true,
      cuts: true,
    },
    orderBy: [desc(projects.updatedAt)],
  });

  return NextResponse.json(userProjects);
}

export async function POST(request: NextRequest) {
  // Rate limit: 20 projects per hour per IP
  const ip = getClientIP(request);
  const rl = rateLimit(`projects:create:${ip}`, { limit: 20, windowMs: 3600000 });
  if (!rl.success) {
    return rateLimitResponse(rl.resetIn);
  }

  const session = getDevSession();

  const body = await request.json();

  const [project] = await db
    .insert(projects)
    .values({
      userId: session.user.id,
      name: body.name,
      description: body.description || null,
      kerf: body.kerf || 0.125,
    })
    .returning();

  // If stocks were provided, insert them
  if (body.stocks?.length) {
    await db.insert(stocks).values(
      body.stocks.map((s: { name: string; l: number; w: number; t?: number; qty: number; mat: string }, i: number) => ({
        projectId: project.id,
        name: s.name,
        length: s.l,
        width: s.w,
        thickness: s.t ?? 0,
        quantity: s.qty,
        material: s.mat,
        sortOrder: i,
      }))
    );
  }

  // If cuts were provided, insert them
  if (body.cuts?.length) {
    await db.insert(cuts).values(
      body.cuts.map((c: { label: string; l: number; w: number; t?: number; qty: number; mat: string }, i: number) => ({
        projectId: project.id,
        label: c.label,
        length: c.l,
        width: c.w,
        thickness: c.t ?? 0,
        quantity: c.qty,
        material: c.mat || '',
        sortOrder: i,
      }))
    );
  }

  // Fetch the complete project with relations
  const completeProject = await db.query.projects.findFirst({
    where: eq(projects.id, project.id),
    with: {
      stocks: true,
      cuts: true,
    },
  });

  return NextResponse.json(completeProject, { status: 201 });
}
