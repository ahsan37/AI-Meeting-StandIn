# Conversation takeover

This step uploads PDF notes, sends Ahsan AI into a meeting, and displays live
English transcript text from ElevenLabs Scribe with speaker names and participant IDs. The local PDF preview stays in the browser. Voice takeover uses the knowledge base
already attached to your ElevenLabs agent.

## Run locally

Use Node.js 22.13 or newer. Run `npm ci` to install dependencies.
Keep the Recall API key in `.env`, never in frontend code. This demo uses Recall's
US West region, so the key must come from that region.

Before joining, create an ElevenLabs API key with Speech-to-Text access and add
it under transcription providers in your Recall US West dashboard. Select the
matching ElevenLabs data residency (US for a standard account). Recall uses this
key directly; this transcription step does not need an ElevenLabs key in `.env`.

`.env` needs these values (see `.env.example`):

- `RECALL_API_KEY`: your Recall key.
- `RECALL_WEBHOOK_TOKEN`: a private random token; one is already generated locally.
- `PUBLIC_WEBHOOK_URL`: the HTTPS forwarding URL from ngrok, without a path.

Start the tunnel in one terminal:

```sh
ngrok http 3002 --inspect=false
```

Copy its HTTPS forwarding URL into `PUBLIC_WEBHOOK_URL`. Start the backend and
frontend in two more terminals:

```sh
npm run dev:server
```

```sh
npm run dev
```

Open http://127.0.0.1:5173/. Restart the backend whenever you change `.env`.
Keep all three processes running. Ngrok routes meeting transcripts through its
service to this laptop. Only the token-protected receiver on port 3002 is exposed;
the Join endpoint stays on the local backend on port 3001.

## Try it

1. Remove the previous bot from Meet, then refresh the app.
2. Paste the meeting URL and click **Join meeting**.
3. Admit **Ahsan AI** if prompted.
4. Speak in English and pause. Finalized phrases should appear with your name
   and participant ID after a few seconds.
5. Remove the bot or end the meeting when finished.

A fresh bot is needed to use the new ElevenLabs transcription configuration.
The Join button confirms Recall accepted the request; admission still happens in
Meet. If the bot does not appear, check its ID in the Recall dashboard.

## How it works

```text
Meeting audio → Recall → ElevenLabs Scribe → Recall webhook → ngrok → server → browser
```

- `server/index.ts` starts the two Express listeners and creates the shared transcript map.
- `server/meeting.ts` creates meeting bots, receives transcripts, and pushes them to your browser.
- `server/voice.ts` prepares handoff context and handles voice start, continue, and stop.
- `src/App.tsx` handles joining and displays the transcript.
- `src/VoiceControls.tsx` owns presenter selection, voice buttons, and status polling.
- `src/PdfNotes.tsx` owns PDF extraction and the local preview.
- `src/voice.ts` runs in the browser inside Recall's cloud bot.
- `shared/types.ts` describes a transcript line for both frontend and backend.
- `vite.config.ts` builds both pages and forwards browser `/api` requests to port 3001.

The server keeps transcripts in memory, so restarting clears them. Recall media
retention and mixed video output are disabled in the bot configuration. The bot
uses meeting audio for transcription and stays silent until takeover starts.

The bot itself runs at Recall, but this receiver still runs on your laptop. This
step does not survive your laptop losing Wi-Fi; cloud hosting comes later.

## Build

```sh
npm run build
```

This checks TypeScript and generates frontend files in `dist/`. That folder is
regenerable build output, not source code. The backend is not bundled into it.
The PDF.js bundle-size warning does not prevent the build from working.

## Next step

Move the backend to the cloud, then add automatic disconnect detection and handback.

API references: [Realtime webhooks](https://docs.recall.ai/docs/real-time-webhook-endpoints),
[ElevenLabs transcription setup](https://docs.recall.ai/docs/elevenlabs),
[event payloads](https://docs.recall.ai/docs/real-time-event-payloads).

## Manual voice takeover

The configured agent is `agent_2801m797vxb1fj8twbdk9z7tmqn1`.

1. In the ElevenLabs agent's Security settings, enable **First message** overrides.
   The app overrides it with an empty string, then explicitly requests the opening
   explanation. This avoids waiting for a reply after a fixed greeting.
2. Keep `covered_topics` and `recent_transcript` in the agent prompt and attach
   the source PDF to its knowledge base. The app currently supplies the recent
   transcript (up to 24,000 characters) and presenter identity; it does not yet
   generate a separate running summary of covered topics.
3. Public agents work using `ELEVENLABS_AGENT_ID`. If authentication is enabled,
   put an ElevenLabs key with access to the agent in `ELEVENLABS_API_KEY` in `.env`.
   This is separate from the Scribe key stored in Recall. If the agent has a domain
   allowlist, allow the ngrok hostname used for this demo.
4. Run `npm run build` to build the voice page, then restart the backend. Keep
   ngrok forwarding to port 3002 and the frontend running as before.
5. Join Meet, say a few sentences, select yourself as Presenter, and click
   **Take over**. Remain quiet while the agent continues, or ask it a question.
6. Click **Continue** after a section to request the next one. Click **Stop** to
   end the voice session and return to presenting. The silent meeting bot stays.

This is manual control: no Wi-Fi detection or automatic section progression yet.
In ElevenLabs, disable silence check-in prompts for this agent if you do not want
it to ask whether the audience is still there while waiting between sections.

`server/voice.ts` holds the small in-memory voice sessions and control routes.
`src/voice.ts` runs inside Recall's cloud browser. Its microphone receives meeting
audio excluding the bot's own output, and SDK playback is heard in Meet. Recall
also displays the simple `voice.html` page as the bot's camera tile; no slides
are shared. The token-protected voice endpoints and static voice assets share the
existing ngrok tunnel. Join and takeover controls remain local on port 3001.

Rebuild after editing `src/voice.ts` or `voice.html`; these use `dist/`, unlike the
Vite frontend. Restarting the backend loses session state; stop takeover first or
remove the bot in Meet. Cloud hosting is still needed before testing Wi-Fi loss.

References: [Recall Output Media](https://docs.recall.ai/docs/stream-media),
[ElevenLabs JS SDK](https://elevenlabs.io/docs/eleven-agents/libraries/java-script),
[First message overrides](https://elevenlabs.io/docs/eleven-agents/customization/personalization/overrides).

## Why browser code runs in the bot

There are two browser pages. Your browser opens `index.html`, which runs the React
controls. Recall opens `voice.html` in a browser on its own cloud machine. That
page runs `src/voice.ts`. Recall supplies meeting sound as its microphone input,
and sends its audio playback into the meeting. The ElevenLabs SDK uses these
browser audio capabilities to connect the meeting to the voice agent.

The Node backend serves that page's files, but does not execute its browser code.
Once loaded, the bot page connects directly to ElevenLabs for voice audio. It
still uses our backend for handoff configuration, control commands, and status.

## Transcript storage and Wi-Fi loss

The transcript map lives in the Node process, not in browser storage or a file.
Currently Node runs on your laptop, so Recall delivers transcripts through ngrok
to your laptop. At takeover, the backend packages a recent transcript snapshot;
the bot page fetches it and sends it to ElevenLabs as dynamic variables.

Losing laptop Wi-Fi now breaks new webhook deliveries and access to that backend.
An already-connected bot voice session may continue its direct ElevenLabs audio
connection, but initiating takeover and controlling it cannot rely on the laptop.
Ngrok provides a public address; it does not host or copy the backend.

After deployment, Recall will deliver transcripts directly to our cloud backend.
The in-memory map will live there too. The future disconnect detector can then
start takeover using context already in the cloud, without waiting for an offline
laptop to send anything. The last words may still lag due to transcription timing.
Server restarts erase in-memory state; a database is not required for this demo.
