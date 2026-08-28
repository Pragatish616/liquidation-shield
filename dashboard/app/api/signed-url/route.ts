import { NextResponse } from 'next/server';

// Without this, Next.js can statically optimize this route at build time
// (observed: it built as a static ○ route despite the no-store fetch
// below) and would then serve one build-time response -- 404, or a single
// real signed URL -- forever, stale, to every request. Every call here
// must mint a fresh signed URL.
export const dynamic = 'force-dynamic';

// Mints a short-lived signed conversation URL server-side, so
// ELEVENLABS_API_KEY never reaches the browser -- required for a private
// agent, and preferred over the public NEXT_PUBLIC_ELEVENLABS_AGENT_ID path
// even for a public one. VoiceAgent.tsx tries this route first and falls
// back to agentId only if it's unavailable (404/error), not configured, or
// this request itself fails.
//
// Endpoint per ElevenLabs' Conversational AI REST API:
// GET https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=...
// -> { signed_url: string }
export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;

  if (!apiKey || !agentId) {
    return NextResponse.json({ error: 'not_configured' }, { status: 404 });
  }

  const url = `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'xi-api-key': apiKey },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: 'signed_url_request_failed' }, { status: 502 });
  }

  if (!res.ok) {
    return NextResponse.json({ error: 'signed_url_request_failed' }, { status: 502 });
  }

  const data = (await res.json()) as { signed_url?: string };
  if (!data.signed_url) {
    return NextResponse.json({ error: 'signed_url_missing' }, { status: 502 });
  }

  return NextResponse.json({ signedUrl: data.signed_url });
}
