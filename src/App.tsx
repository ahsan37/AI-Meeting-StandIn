import { useEffect, useState } from 'react';
import type { TranscriptLine } from '../shared/types';
import VoiceControls from './VoiceControls';
import PdfNotes from './PdfNotes';
export default function App() {
  const [meetingUrl, setMeetingUrl] = useState('');
  const [joining, setJoining] = useState(false);
  const [botId, setBotId] = useState('');
  const [joinError, setJoinError] = useState('');
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);

  useEffect(() => {
    if (!botId) return;
    setTranscript([]);

    const feed = new EventSource(`/api/transcript/${botId}`);
    feed.onmessage = (event) => {
      const lines: TranscriptLine[] = JSON.parse(event.data);
      setTranscript(lines);
    };

    return () => feed.close();
  }, [botId]);

  async function joinMeeting() {
    setJoining(true);
    setJoinError('');

    try {
      const response = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingUrl }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setBotId(data.botId);
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : 'Could not send the join request.');
    } finally {
      setJoining(false);
    }
  }

  return (
    <main>
      <h1>Conversation takeover</h1>
      <h2>Join Google Meet</h2>
      <form onSubmit={(event) => { event.preventDefault(); void joinMeeting(); }}>
        <label>
          Meeting link: <input
            type="url"
            placeholder="https://meet.google.com/abc"
            value={meetingUrl}
            onChange={(event) => setMeetingUrl(event.target.value)}
            disabled={joining || Boolean(botId)}
            required
          />
        </label>
        <button type="submit" disabled={joining || Boolean(botId)}>
          {joining ? 'Sending…' : botId ? 'Request sent' : 'Join meeting'}
        </button>
      </form>
      {joinError && <p role="alert">{joinError}</p>}
      {botId && (
        <p role="status">
          Join request accepted. Admit “Ahsan AI” in Google Meet if prompted.
          <br />Bot ID: {botId}
        </p>
      )}

      {botId && <VoiceControls botId={botId} transcript={transcript} />}

      {botId && (
        <section aria-label="Live transcript">
          <h2>Live transcript</h2>
          {transcript.map((line) => (
            <p key={line.id}>
              <strong>{line.speaker} (participant {line.participantId ?? 'unknown'}): </strong>
              {line.text}
            </p>
          ))}
        </section>
      )}

      <PdfNotes />
    </main>
  );
}
