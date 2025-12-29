import { NextResponse } from 'next/server';
import { db } from '@/db';
import { tools } from '@/db/schema';
import { eq, asc } from 'drizzle-orm';

// Community catalog is public - no auth required
export async function GET() {
  const catalogTools = await db.query.tools.findMany({
    where: eq(tools.isCommunityCatalog, true),
    orderBy: [asc(tools.name), asc(tools.brand)],
  });

  return NextResponse.json(catalogTools);
}
