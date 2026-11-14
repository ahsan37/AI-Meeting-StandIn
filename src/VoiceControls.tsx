import { useEffect, useState } from 'react';
import type { TranscriptLine } from '../shared/types';

export default function VoiceControls({ botId, transcript }: { botId: string; transcript: TranscriptLine[] }) {
  const [presenterId, setPresenterId] = useState('');
  const [voiceStatus, setVoiceStatus] = useState('stopped');
  const [voiceError, setVoiceError] = useState('');
  const [voiceBusy, setVoiceBusy] = useState(false);
  const participants = [...new Map(transcript.filter(line => line.participantId !== null)
    .map(line => [line.participantId, line])).values()];

  useEffect(() => {
    if (!botId) return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/voice/${botId}`);
        if (!response.ok) return;
        const data = await response.json();
        setVoiceStatus(data.status);
        if (data.error) setVoiceError(data.error);
      } catch { /* Keep controls available while the server reconnects. */ }
    }, 2000);
    return () => clearInterval(timer);
  }, [botId]);

  async function controlVoice(action: 'start' | 'continue' | 'stop') {
    setVoiceBusy(true);
    setVoiceError('');
    try {
      const response = await fetch(`/api/voice/${botId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presenterId: Number(presenterId) }),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      setVoiceStatus(action === 'stop' ? 'stopped' : action === 'start' ? 'starting' : 'thinking');
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : 'Voice request failed.');
    } finally { setVoiceBusy(false); }
  }

  return (
    <section aria-label="Voice takeover">
      <h2>Voice takeover</h2>
      <p>Uses the notes attached to your ElevenLabs agent. Speak first, then select yourself.</p>
      <label>
        Presenter: <select value={presenterId} onChange={event => setPresenterId(event.target.value)} disabled={voiceStatus !== 'stopped'}>
          <option value="">Select yourself</option>
          {participants.map(person => <option key={person.participantId} value={person.participantId!}>{person.speaker} ({person.participantId})</option>)}
        </select>
      </label>{' '}
      <button disabled={voiceBusy || !presenterId || voiceStatus !== 'stopped'} onClick={() => void controlVoice('start')}>Take over</button>{' '}
      <button disabled={voiceBusy || voiceStatus !== 'listening'} onClick={() => void controlVoice('continue')}>Continue</button>{' '}
      <button disabled={voiceBusy} onClick={() => void controlVoice('stop')}>Stop</button>
      <p role="status">Voice: {voiceStatus}</p>
      {voiceError && <p role="alert">{voiceError}</p>}
    </section>
  );
}
