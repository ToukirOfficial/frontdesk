const TARGET = 900;
const OVERLAP = 150;

/**
 * Splits text into ~900-character chunks on paragraph and sentence boundaries, with a little overlap so an answer
 * that straddles two chunks is still found.
 */
export const chunkText = (text: string): string[] => {
  const clean = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!clean) return [];

  // Paragraphs, and any paragraph still too long split into sentences.
  const pieces: string[] = [];
  for (const para of clean.split(/\n\s*\n/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= TARGET) {
      pieces.push(p);
      continue;
    }
    const sentences = p.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g) ?? [p];
    for (const s of sentences) {
      const t = s.trim();
      if (!t) continue;
      // A single huge "sentence" (a table, a list without full stops): hard-split it.
      for (let i = 0; i < t.length; i += TARGET) pieces.push(t.slice(i, i + TARGET));
    }
  }

  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > TARGET) {
      chunks.push(current);
      const tail = current.slice(-OVERLAP);
      const cut = tail.indexOf(' ');
      current = (cut >= 0 ? tail.slice(cut + 1) : tail) + '\n\n' + piece;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
};
