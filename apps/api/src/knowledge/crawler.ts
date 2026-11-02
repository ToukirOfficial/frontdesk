import * as cheerio from 'cheerio';
import { safeFetch, type SafeFetchOptions, UrlRejectedError } from '../net/safe-fetch.js';

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
}

const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|css|js|json|xml|zip|mp4|mp3|docx?|xlsx?|pptx?)$/i;
const MAX_REDIRECTS = 3;

/** Visible text of an HTML page: scripts, styles, navigation and footers removed. */
export const pageText = (html: string): { title: string; text: string; links: string[] } => {
  const $ = cheerio.load(html);
  const links = $('a[href]')
    .map((_, a) => $(a).attr('href') ?? '')
    .get();
  $('script, style, noscript, template, svg, iframe, nav, footer, form, [aria-hidden="true"]').remove();
  const title = $('title').first().text().trim() || $('h1').first().text().trim();
  const root = $('main').length ? $('main') : $('body');
  root.find('br').replaceWith('\n');
  root.find('p, li, h1, h2, h3, h4, h5, h6, tr, div, section, article').each((_, el) => {
    $(el).append('\n\n');
  });
  const text = root
    .text()
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*(\n\s*)+/g, '\n\n')
    .trim();
  return { title, text, links };
};

/**
 * Imports up to `maxPages` pages from one website: the start page, then links on the same host, breadth first.
 * Every request (including each redirect hop) goes through safeFetch, which refuses private addresses.
 */
export const crawl = async (
  start: string,
  maxPages: number,
  opts: Pick<SafeFetchOptions, 'allowHttp' | 'allowPrivate'>,
): Promise<CrawledPage[]> => {
  const origin = new URL(start);
  const host = origin.hostname.replace(/^www\./, '');
  const sameSite = (u: URL) => u.hostname.replace(/^www\./, '') === host && (u.protocol === 'https:' || u.protocol === 'http:');
  const normal = (u: URL) => {
    u.hash = '';
    return u.toString();
  };

  const queue = [normal(origin)];
  const seen = new Set(queue);
  const pages: CrawledPage[] = [];
  let firstError: Error | undefined;
  let visited = 0;

  while (queue.length && pages.length < maxPages) {
    let url = queue.shift()!;
    const isStart = visited++ === 0;
    try {
      let res = await safeFetch(url, { ...opts, headers: { accept: 'text/html' } });
      for (let hops = 0; res.status >= 300 && res.status < 400 && hops < MAX_REDIRECTS; hops++) {
        const location = res.headers.location;
        if (!location) break;
        const next = new URL(location, url);
        if (!sameSite(next)) throw new UrlRejectedError('The page redirects to a different website.');
        url = normal(next);
        res = await safeFetch(url, { ...opts, headers: { accept: 'text/html' } });
      }
      if (res.status !== 200) throw new UrlRejectedError(`The page answered with status ${res.status}.`);
      const type = String(res.headers['content-type'] ?? '');
      if (!type.includes('text/html')) continue;

      const { title, text, links } = pageText(res.body.toString('utf8'));
      if (text) pages.push({ url, title: title || url, text });

      for (const href of links) {
        let link: URL;
        try {
          link = new URL(href, url);
        } catch {
          continue;
        }
        if (!sameSite(link) || SKIP_EXT.test(link.pathname)) continue;
        const key = normal(link);
        if (!seen.has(key) && seen.size < maxPages * 5) {
          seen.add(key);
          queue.push(key);
        }
      }
    } catch (err) {
      // A bad start page fails the import; a bad linked page is skipped.
      firstError ??= err instanceof Error ? err : new Error(String(err));
      if (isStart) throw firstError;
    }
  }
  if (!pages.length) throw firstError ?? new UrlRejectedError('No readable pages were found at that address.');
  return pages;
};
