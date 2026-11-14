import express from 'express';
import { addMeetingRoutes } from './meeting';
import { addVoiceRoutes } from './voice';
import type { TranscriptLine } from '../shared/types';

const app = express();
app.use(express.json());

// This separate listener is exposed through ngrok for Recall's callbacks and bot page.
const receiver = express();
receiver.use(express.json({ limit: '1mb' }));

// Both route modules share this map. Restarting the backend clears it.
const transcripts = new Map<string, TranscriptLine[]>();
addMeetingRoutes(app, receiver, transcripts);
addVoiceRoutes(app, receiver, transcripts);

app.listen(3001, '127.0.0.1', () => {
  console.log('Backend running at http://127.0.0.1:3001');
});
receiver.listen(3002, '127.0.0.1', () => {
  console.log('Recall receiver and bot page running on port 3002');
});
