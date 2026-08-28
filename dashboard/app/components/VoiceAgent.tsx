'use client';

import { useState } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { Microphone, Stop } from '@phosphor-icons/react';
import type { ViewKey } from '../types';
import type { DecisionRecord } from '../../lib/readLog';

interface VoiceAgentProps {
  records: DecisionRecord[];
  onSwitchView: (view: ViewKey) => void;
}

// HARD CONSTRAINT: no client tool registered here may execute, submit,
// approve, or authorize an intervention. This agent is read-and-explain
// only -- it can navigate the dashboard and answer questions about what's
// already on screen. A future "stage a plan" tool must only populate UI
// state and still require a separate physical button click to run anything.
//
// useConversation must be called inside a ConversationProvider (an
// @elevenlabs/react requirement, not visible from the hook's own name) --
// that's the only reason this file has an inner/outer component split.
export function VoiceAgent(props: VoiceAgentProps) {
  return (
    <ConversationProvider>
      <VoiceAgentInner {...props} />
    </ConversationProvider>
  );
}

function VoiceAgentInner({ records, onSwitchView }: VoiceAgentProps) {
  const [micError, setMicError] = useState<string | null>(null);

  const conversation = useConversation({
    clientTools: {
      switchView: ({ view }: { view: ViewKey }) => {
        onSwitchView(view);
        return `Switched to ${view}`;
      },
      // Answers instantly from what's already on screen, no round trip to
      // the backend -- the webhook tool (configured in the ElevenLabs
      // dashboard, not here) is what fetches authoritative state instead.
      // Returns a JSON string, not a bare object: @elevenlabs/react's
      // ClientTool type constrains results to string | number | void.
      readCurrentHF: () => {
        const last = [...records].reverse().find((r) => r.hf !== undefined);
        return JSON.stringify({
          hf: last?.hf ?? null,
          targetHF: last?.targetHF ?? null,
          urgency: last?.reason ?? null,
        });
      },
    },
  });

  const connected = conversation.status === 'connected' || conversation.status === 'connecting';
  const speaking = conversation.isSpeaking;

  async function handleStart() {
    setMicError(null);

    // Mic permission is requested here, on click, and only here -- never
    // on page load. If the user denies it, startSession is never called.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setMicError('Microphone permission denied.');
      return;
    }
    // Only needed to trigger/confirm the permission prompt -- the SDK
    // captures its own stream once the session actually starts.
    stream.getTracks().forEach((track) => track.stop());

    // Prefer a server-minted signed URL (works for a private agent, keeps
    // the API key off the browser entirely) over the public agentId.
    try {
      const res = await fetch('/api/signed-url', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { signedUrl?: string };
        if (data.signedUrl) {
          conversation.startSession({ signedUrl: data.signedUrl });
          return;
        }
      }
    } catch {
      // /api/signed-url unavailable -- fall back to the public agent below.
    }

    const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
    if (!agentId) {
      setMicError('Voice agent not configured.');
      return;
    }
    conversation.startSession({ agentId });
  }

  function handleStop() {
    conversation.endSession();
  }

  // Three visual states: idle (no ring), listening (signal-blue pulse),
  // agent-speaking (safe-green pulse).
  const ringColor = speaking ? 'bg-safe' : connected ? 'bg-signal' : null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      {micError && (
        <span className="rounded-control border border-danger/20 bg-danger/[0.08] px-3 py-1.5 text-[11.5px] text-danger">
          {micError}
        </span>
      )}
      <div className="flex items-center gap-2">
        {connected && (
          <button
            type="button"
            onClick={handleStop}
            aria-label="Stop voice agent"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.08] bg-ink-800 text-paper-300 shadow-panel transition-colors hover:bg-ink-700 hover:text-paper-100"
          >
            <Stop size={16} weight="fill" />
          </button>
        )}
        <button
          type="button"
          onClick={connected ? undefined : handleStart}
          disabled={connected}
          aria-label={connected ? (speaking ? 'Agent speaking' : 'Listening') : 'Start voice agent'}
          className="relative flex h-14 w-14 items-center justify-center rounded-full border border-white/[0.08] bg-signal text-white shadow-panel transition-transform active:scale-95 disabled:cursor-default"
        >
          {ringColor && (
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-40 ${ringColor}`} />
          )}
          <Microphone size={22} weight={connected ? 'fill' : 'regular'} className="relative" />
        </button>
      </div>
    </div>
  );
}
