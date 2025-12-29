import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { projects, stocks, cuts, tools } from '@/db/schema';
import { headers } from 'next/headers';

interface LocalStock {
  name: string;
  l: number;
  w: number;
  qty: number;
  mat: string;
}

interface LocalCut {
  label: string;
  l: number;
  w: number;
  qty: number;
  mat: string;
}

interface LocalTool {
  name: string;
  brand: string;
  model: string;
  cond: 'excellent' | 'good' | 'fair' | 'poor';
  notes: string;
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const localStocks: LocalStock[] = body.stocks || [];
  const localCuts: LocalCut[] = body.cuts || [];
  const localTools: LocalTool[] = body.tools || [];

  let projectId: string | null = null;

  // Create a project for imported stocks/cuts if any exist
  if (localStocks.length > 0 || localCuts.length > 0) {
    const [project] = await db
      .insert(projects)
      .values({
        userId: session.user.id,
        name: 'Imported from Browser',
        description: 'Automatically imported from your browser storage',
        kerf: 0.125,
      })
      .returning();

    projectId = project.id;

    // Import stocks
    if (localStocks.length > 0) {
      await db.insert(stocks).values(
        localStocks.map((s, i) => ({
          projectId: project.id,
          name: s.name,
          length: s.l,
          width: s.w,
          quantity: s.qty,
          material: s.mat,
          sortOrder: i,
        }))
      );
    }

    // Import cuts
    if (localCuts.length > 0) {
      await db.insert(cuts).values(
        localCuts.map((c, i) => ({
          projectId: project.id,
          label: c.label,
          length: c.l,
          width: c.w,
          quantity: c.qty,
          material: c.mat || '',
          sortOrder: i,
        }))
      );
    }
  }

  // Import tools
  if (localTools.length > 0) {
    await db.insert(tools).values(
      localTools.map((t) => ({
        userId: session.user.id,
        name: t.name,
        brand: t.brand,
        model: t.model,
        condition: t.cond,
        notes: t.notes,
      }))
    );
  }

  return NextResponse.json({
    success: true,
    projectId,
    imported: {
      stocks: localStocks.length,
      cuts: localCuts.length,
      tools: localTools.length,
    },
  });
}
