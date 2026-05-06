// Offscreen document for PDF parsing using PDF.js
import { getDocument, GlobalWorkerOptions } from '../lib/pdf.min.js';

GlobalWorkerOptions.workerSrc = '../lib/pdf.worker.min.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_PARSE_PDF') {
    parsePdf(message.payload.base64Data)
      .then(text => sendResponse({ text }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

async function parsePdf(base64Data) {
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const pdf = await getDocument({ data: bytes }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }

  return fullText.trim();
}
