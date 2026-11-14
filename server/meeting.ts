import type { Express, Response } from 'express';
import type { TranscriptLine } from '../shared/types';

export function addMeetingRoutes(app: Express, receiver: Express, transcripts: Map<string, TranscriptLine[]>) {
  const viewers = new Set<{ botId: string; response: Response }>();

  app.get('/api/transcript/:botId', (request, response) => {
    const botId = String(request.params.botId);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.flushHeaders();
    response.write(`data: ${JSON.stringify(transcripts.get(botId) ?? [])}\n\n`);
    const viewer = { botId, response };
    viewers.add(viewer);
    const keepAlive = setInterval(() => response.write(': keepalive\n\n'), 15000);
    response.on('close', () => {
      clearInterval(keepAlive);
      viewers.delete(viewer);
    });
  });

  receiver.post('/transcript/', (request, response) => {
    const token = process.env.RECALL_WEBHOOK_TOKEN;
    if (!token || request.query.token !== token) {
      response.sendStatus(401);
      return;
    }
    const event = request.body;
    if (event.event !== 'transcript.data') {
      response.sendStatus(204);
      return;
    }
    const botId = event.data?.bot?.id;
    const data = event.data?.data;
    if (!botId || !Array.isArray(data?.words)) {
      response.sendStatus(400);
      return;
    }
    const text = data.words.map((word: { text: string }) => word.text).join(' ').trim();
    if (text) {
      const start = data.words[0].start_timestamp.relative;
      const participant = data.participant;
      const line: TranscriptLine = {
        id: `${event.data.recording?.id}:${participant?.id}:${start}`,
        participantId: participant?.id ?? null,
        speaker: participant?.name || 'Unknown speaker',
        text,
        start,
      };
      const lines = transcripts.get(botId) ?? [];
      // Recall can retry delivery; don't display the same sentence twice.
      if (!lines.some((existing) => existing.id === line.id)) {
        lines.push(line);
        lines.sort((a, b) => a.start - b.start);
        transcripts.set(botId, lines);
        for (const viewer of viewers) {
          if (viewer.botId === botId) viewer.response.write(`data: ${JSON.stringify(lines)}\n\n`);
        }
      }
    }
    response.sendStatus(204);
  });

  app.post('/api/join', async (request, response) => {
    const meetingUrl = String(request.body?.meetingUrl ?? '').trim();

    const apiKey = process.env.RECALL_API_KEY;
    if (!apiKey) {
      response.status(503).json({ error: 'Add RECALL_API_KEY to .env' });
      return;
    }

    const publicUrl = process.env.PUBLIC_WEBHOOK_URL?.replace(/\/$/, '');
    const token = process.env.RECALL_WEBHOOK_TOKEN;
    if (!publicUrl?.startsWith('https://') || !token) {
      response.status(503).json({ error: 'Set PUBLIC_WEBHOOK_URL and RECALL_WEBHOOK_TOKEN in .env, then restart the backend.' });
      return;
    }

    try {
      const result = await fetch(`https://us-west-2.recall.ai/api/v1/bot/`, {
        method: 'POST',
        headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meeting_url: meetingUrl,
          bot_name: 'Ahsan AI',
          recording_config: {
            retention: null,
            video_mixed_mp4: null,
            transcript: {
              provider: { elevenlabs_streaming: { model_id: 'scribe_v2_realtime', language_code: 'en' } },
              diarization: { use_separate_streams_when_available: true },
            },
            realtime_endpoints: [{
              type: 'webhook',
              url: `${publicUrl}/transcript/?token=${encodeURIComponent(token)}`,
              events: ['transcript.data'],
            }],
          },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const bot = await result.json();
      if (!result.ok) {
        response.status(result.status).json({ error: `Recall: ${bot.detail ?? JSON.stringify(bot)}` });
        return;
      }

      response.status(201).json({ botId: bot.id });
    } catch {
      response.status(502).json({ error: 'The Recall request failed. Check your connection and Recall dashboard before retrying.' });
    }
  });
}
