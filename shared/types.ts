export type TranscriptLine = {
  id: string;
  speaker: string;
  participantId: number | null;
  text: string;
  start: number;
};
