import { NextRequest, NextResponse } from 'next/server';
import { fetchLiveDecisions } from '../../../lib/readLog';

export async function GET(req: NextRequest) {
  const scenario = (req.nextUrl.searchParams.get('scenario') ?? 'real') as 'real' | 'save' | 'refuse';
  const payload = await fetchLiveDecisions(scenario);
  return NextResponse.json(payload);
}
