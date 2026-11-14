import { useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorker;

export default function PdfNotes() {
  const [fileName, setFileName] = useState('');
  const [notes, setNotes] = useState('');
  const [reading, setReading] = useState(false);

  async function readPdf(file: File) {
    setFileName(file.name);
    setNotes('');
    setReading(true);
    let task: PDFDocumentLoadingTask | undefined;

    try {
      const bytes = await file.arrayBuffer();
      task = getDocument({ data: new Uint8Array(bytes) });
      const pdf = await task.promise;
      const pages: string[] = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items.map((item) => {
          if (!('str' in item)) return '';
          return item.str + (item.hasEOL ? '\n' : ' ');
        }).join('').trim();
        pages.push(text);
      }

      const text = pages.join('\n\n').trim();
      setNotes(text);
    } finally {
      void task?.destroy();
      setReading(false);
    }
  }

  return (
    <section aria-label="Conversation notes">
      <h2>Conversation notes</h2>
      <p>Local PDF text preview. For voice takeover, attach your PDF to the ElevenLabs agent’s knowledge base.</p>
      <label>
        PDF notes:  
        <input
          type="file"
          accept=".pdf,application/pdf"
          disabled={reading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void readPdf(file);
            event.target.value = '';
          }}
        />
      </label>
      {notes && (
        <section aria-label="Extracted notes">
          <h2>Text preview: {fileName}</h2>
          <pre>{notes}</pre>
        </section>
      )}
    </section>
  );
}
