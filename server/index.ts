import express from 'express';
import { resolve } from 'node:path';
import { addMeetingRoutes } from './meeting';
import { addVoiceRoutes } from './voice';
import type { TranscriptLine } from '../shared/types';

const production = process.env.NODE_ENV === 'production';
const app = express();
app.use(express.json({ limit: '1mb' }));

// Render exposes one port. Locally, keep Recall's endpoints on the ngrok port.
const receiver = production ? app : express();
if (!production) receiver.use(express.json({ limit: '1mb' }));

// Both route modules share this map. Restarting the backend clears it.
const transcripts = new Map<string, TranscriptLine[]>();
addMeetingRoutes(app, receiver, transcripts);
addVoiceRoutes(app, receiver, transcripts);
app.get('/health', (_request, response) => response.json({ ok: true }));

if (production) {
  app.use(express.static(resolve('dist')));
  const port = Number(process.env.PORT || 3001);
  app.listen(port, '0.0.0.0', () => {
    console.log(`App running on port ${port}`);
  });
} else {
  app.listen(3001, '127.0.0.1', () => {
    console.log('Backend running at http://127.0.0.1:3001');
  });
  receiver.listen(3002, '127.0.0.1', () => {
    console.log('Recall receiver and bot page running on port 3002');
  });
}
