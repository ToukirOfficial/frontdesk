import mammoth from 'mammoth';

export class ExtractError extends Error {}

const MAX_PDF_PAGES = 300;
const TIMEOUT_MS = 60_000;

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
    return withTimeout(
      mammoth.extractRawText({ buffer: buf }).then((r) => r.value),
      TIMEOUT_MS,
    );
  }
  throw new ExtractError('Only PDF and Word (.docx) files are supported.');
};
