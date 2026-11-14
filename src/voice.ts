import { Conversation } from '@elevenlabs/client';

const token = location.hash.slice(1);
const endpoint = `/voice/${encodeURIComponent(token)}`;
const label = document.querySelector<HTMLParagraphElement>('#status')!;
let conversation: Awaited<ReturnType<typeof Conversation.startSession>> | undefined;
let stopped = false;

async function report(status: string, error = '') {
  label.textContent = error || status;
  await fetch(`${endpoint}/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, error }),
  }).catch(() => { label.textContent = 'Connection to control server lost'; });
}

const commands = new EventSource(`${endpoint}/commands`);
commands.onmessage = async (event) => {
  const { command } = JSON.parse(event.data);
  if (command === 'stop') {
    stopped = true;
    commands.close();
    await conversation?.endSession();
    await report('stopped');
  } else if (command === 'continue' && conversation && !stopped) {
    await report('thinking');
    conversation.sendUserMessage('Continue with the next uncovered section of the notes. Do not greet, recap, or ask permission. If all material is covered, say so briefly.');
  }
};

async function start() {
  try {
    const response = await fetch(`${endpoint}/config`);
    if (!response.ok) throw new Error('Voice session expired. Stop and start takeover again.');
    const config = await response.json();
    conversation = await Conversation.startSession({
      ...(config.signedUrl ? { signedUrl: config.signedUrl } : { agentId: config.agentId }),
      connectionType: 'websocket',
      dynamicVariables: config.dynamicVariables,
      // Enable First message overrides in the agent's Security settings.
      overrides: { agent: { firstMessage: '' } },
      onModeChange: ({ mode }) => { if (!stopped) void report(mode); },
      onDisconnect: () => { if (!stopped) void report('disconnected'); },
      onError: (message) => { void report('error', message); },
    });
    if (stopped) { await conversation.endSession(); return; }
    await report('thinking');
    conversation.sendUserMessage(
      'Take over now. In a single response, briefly identify yourself as Ahsan’s AI stand-in, then immediately continue his unfinished point using the handoff transcript and knowledge base. '
      + 'This is a manual handoff: do not claim his connection dropped. Explain one coherent section, around 60–90 seconds. '
      + 'Do not greet, check whether anyone is there, ask permission to proceed, or output stage directions. Then listen for audience questions.'
    );
  } catch (error) {
    commands.close();
    await report('error', error instanceof Error ? error.message : 'Voice connection failed.');
  }
}
void start();
