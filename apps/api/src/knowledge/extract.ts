import { inflateRawSync } from 'node:zlib';
import mammoth from 'mammoth';

export class ExtractError extends Error {}

const MAX_PDF_PAGES = 300;
const TIMEOUT_MS = 60_000;
/** A real .docx unpacks to a few MB. Anything near this is a "zip bomb" built to exhaust the worker's memory. */
export const MAX_DOCX_UNPACKED_BYTES = 64 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 2000;

const tooBig = () => new ExtractError('This Word file unpacks to far more than a normal document, so it wasn’t read.');

/**
 * Checks a .docx (a zip) BEFORE the Word reader unpacks it in memory, by actually inflating every entry with a hard
 * output limit (declared sizes in a zip can lie). The reader can't stop mid-way, so this is the only safe point.
 */
export const checkDocxSize = (buf: Buffer, budget = MAX_DOCX_UNPACKED_BYTES): void => {
  // End of central directory: the last record, within the final 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ExtractError('The file couldn’t be read. Is it damaged or password-protected?');
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (entries > MAX_DOCX_ENTRIES || entries === 0xffff || p === 0xffffffff) throw tooBig(); // zip64: no real .docx needs it
  let left = budget;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ExtractError('The file couldn’t be read. Is it damaged?');
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const local = buf.readUInt32LE(p + 42);
    const next = p + 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new ExtractError('The file couldn’t be read. Is it damaged?');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compressed);
    let size: number;
    if (method === 0) size = data.length;
    else if (method === 8) {
      try {
        size = inflateRawSync(data, { maxOutputLength: Math.max(1, left) }).length;
      } catch (err) {
        if (err instanceof RangeError) throw tooBig();
        throw new ExtractError('The file couldn’t be read. Is it damaged?');
      }
    } else throw new ExtractError('The file couldn’t be read. Is it damaged?');
    left -= size;
    if (left < 0) throw tooBig();
    p = next;
  }
};

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ExtractError('The file took too long to read.')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof ExtractError ? e : new ExtractError('The file couldn’t be read. Is it damaged or password-protected?'));
      },
    );
  });

/** Plain text from a PDF or DOCX. Runs in the worker only, with a page limit and a timeout. */
export const extractText = async (buf: Buffer, mimeType: string): Promise<string> => {
  if (mimeType === 'application/pdf') {
    return withTimeout(
      (async () => {
        const { getDocumentProxy, extractText: pdfText } = await import('unpdf');
        const pdf = await getDocumentProxy(new Uint8Array(buf));
        if (pdf.numPages > MAX_PDF_PAGES) throw new ExtractError(`PDFs can have at most ${MAX_PDF_PAGES} pages.`);
        const { text } = await pdfText(pdf, { mergePages: false });
        return (Array.isArray(text) ? text : [text]).join('\n\n');
      })(),
      TIMEOUT_MS,
    );
  }
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    checkDocxSize(buf);
    return withTimeout(
      mammoth.extractRawText({ buffer: buf }).then((r) => r.value),
      TIMEOUT_MS,
    );
  }
  throw new ExtractError('Only PDF and Word (.docx) files are supported.');
};
