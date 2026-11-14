import express from 'express';
import type { Express, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { TranscriptLine } from '../shared/types';

type VoiceSession = {
  token: string;
  status: string;
  error: string;
  commandStream?: Response;
  config: {
    agentId: string;
    signedUrl?: string;
    dynamicVariables: { covered_topics: string; recent_transcript: string };
  };
};

export function addVoiceRoutes(app: Express, receiver: Express, transcripts: Map<string, TranscriptLine[]>) {
  const sessions = new Map<string, VoiceSession>();
  const tokens = new Map<string, VoiceSession>();
  const recallUrl = 'https://us-west-2.recall.ai/api/v1/bot';

  // Only the bot page and its assets are public. Session data requires a random token.
  receiver.use('/assets', express.static(resolve('dist/assets')));
  receiver.get('/voice.html', (_request, response) => response.sendFile(resolve('dist/voice.html')));
  receiver.use('/voice/:token', (request, response, next) => {
    const session = tokens.get(String(request.params.token));
    if (!session) { response.sendStatus(404); return; }
    response.locals.session = session;
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  receiver.get('/voice/:token/config', (_request, response) => {
    response.json((response.locals.session as VoiceSession).config);
  });
  receiver.post('/voice/:token/status', (request, response) => {
    const session = response.locals.session as VoiceSession;
    session.status = String(request.body.status);
    session.error = String(request.body.error ?? '');
    response.sendStatus(204);
  });
  receiver.get('/voice/:token/commands', (_request, response) => {
    const session = response.locals.session as VoiceSession;
    response.setHeader('Content-Type', 'text/event-stream');
    response.flushHeaders();
    session.commandStream = response;
    const timer = setInterval(() => response.write(': keepalive\n\n'), 15000);
    response.on('close', () => {
      clearInterval(timer);
      if (session.commandStream === response) session.commandStream = undefined;
    });
  });

  app.get('/api/voice/:botId', (request, response) => {
    const session = sessions.get(String(request.params.botId));
    response.json({ status: session?.status ?? 'stopped', error: session?.error ?? '' });
  });

  app.post('/api/voice/:botId/start', async (request, response) => {
    const botId = String(request.params.botId);
    if (sessions.has(botId)) {
      response.status(409).json({ error: 'Stop the previous voice session before starting another.' });
      return;
    }
    const lines = transcripts.get(botId) ?? [];
    const presenterId = Number(request.body.presenterId);
    const presenter = lines.find(line => line.participantId === presenterId);
    if (!presenter) {
      response.status(400).json({ error: 'Speak first, then select yourself as the presenter.' });
      return;
    }
    const agentId = process.env.ELEVENLABS_AGENT_ID;
    const publicUrl = (process.env.PUBLIC_WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL)?.replace(/\/$/, '');
    if (!agentId || !publicUrl || !process.env.RECALL_API_KEY) {
      response.status(503).json({ error: 'Set ELEVENLABS_AGENT_ID and the Recall settings in .env, then restart the backend.' });
      return;
    }
    const session: VoiceSession = {
      token: randomUUID(), status: 'starting', error: '',
      config: {
        agentId,
        dynamicVariables: {
          covered_topics: `The presenter is ${presenter.speaker} (participant ${presenterId}). Infer covered topics from the transcript; no separate progress summary has been generated. Resume their latest unfinished point.`,
          recent_transcript: lines.map(line => `${line.speaker} (participant ${line.participantId}): ${line.text}`).join('\n').slice(-24000),
        },
      },
    };
    sessions.set(botId, session);
    tokens.set(session.token, session);
    try {
      // Public agents work with an ID; private agents need a short-lived signed URL.
      if (process.env.ELEVENLABS_API_KEY) {
        const auth = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`, {
          headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
          signal: AbortSignal.timeout(15000),
        });
        if (!auth.ok) throw new Error(`ElevenLabs authentication failed (${auth.status}). Check API key access to this agent.`);
        session.config.signedUrl = (await auth.json()).signed_url;
      }
      const result = await fetch(`${recallUrl}/${encodeURIComponent(botId)}/output_media/`, {
        method: 'POST',
        headers: { Authorization: process.env.RECALL_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ camera: { kind: 'webpage', config: {
          url: `${publicUrl}/voice.html#${session.token}`,
        } } }),
        signal: AbortSignal.timeout(20000),
      });
      if (!result.ok) throw new Error(`Recall output media failed (${result.status}): ${await result.text()}`);
      response.json({ status: session.status });
    } catch (error) {
      // Keep the token/session so Stop can clean up if Recall accepted a timed-out request.
      session.status = 'error';
      session.error = error instanceof Error ? error.message : 'Could not start voice takeover.';
      response.status(502).json({ error: session.error });
    }
  });

  app.post('/api/voice/:botId/continue', (request, response) => {
    const session = sessions.get(String(request.params.botId));
    if (!session?.commandStream || session.status !== 'listening') {
      response.status(409).json({ error: 'Wait until the agent has finished speaking.' });
      return;
    }
    session.commandStream.write('data: {"command":"continue"}\n\n');
    session.status = 'thinking';
    response.sendStatus(204);
  });

  app.post('/api/voice/:botId/stop', async (request, response) => {
    const botId = String(request.params.botId);
    const session = sessions.get(botId);
    if (!session) { response.sendStatus(204); return; }
    session.commandStream?.write('data: {"command":"stop"}\n\n');
    try {
      const result = await fetch(`${recallUrl}/${encodeURIComponent(botId)}/output_media/`, {
        method: 'DELETE',
        headers: { Authorization: process.env.RECALL_API_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ camera: true }),
        signal: AbortSignal.timeout(15000),
      });
      if (!result.ok) throw new Error(`Recall could not stop output (${result.status}). Retry Stop or remove the bot from the meeting.`);
      session.commandStream?.end();
      tokens.delete(session.token);
      sessions.delete(botId);
      response.sendStatus(204);
    } catch (error) {
      response.status(502).json({ error: error instanceof Error ? error.message : 'Stop failed. Retry or remove the bot from the meeting.' });
    }
  });
}
