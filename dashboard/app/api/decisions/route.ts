import { NextRequest, NextResponse } from 'next/server';
import { getLogPath, readDecisions } from '../../../lib/readLog';

export async function GET(req: NextRequest) {
  const scenario = (req.nextUrl.searchParams.get('scenario') ?? 'real') as
    | 'real'
    | 'save'
    | 'refuse';

  const path = getLogPath(scenario);
  const records = readDecisions(path);

  return NextResponse.json({ scenario, records, live: records.length > 0 });
}
