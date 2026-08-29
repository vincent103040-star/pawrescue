// Turning one OCR result into citable chunks.
//
// Split out of ocr-import.ts so it can be tested without an Azure key: the
// offset arithmetic below is the part most likely to be quietly wrong, and a
// chunk labelled with the wrong page is worse than one labelled "第 N 段" --
// it sends someone to a page that does not say what the answer claimed.

/** Where one page's text sits inside the whole document's extracted text. */
export interface PageSpan { page: number; start: number; end: number }

/**
 * Collapses runs of whitespace, remembering where every surviving character
 * came from.
 *
 * The page spans Azure reports are offsets into the *raw* text, so cleaning it
 * first would throw away the only thing that connects a chunk to a page.
 * Keeping a parallel offset array costs one number per character and lets the
 * chunk boundaries be translated back.
 */
export function cleanWithOffsets(raw: string): { text: string; offsets: number[] } {
  const chars: string[] = [];
  const offsets: number[] = [];
  let lastWasSpace = true; // starts true so leading whitespace is dropped
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v') {
      if (!lastWasSpace) { chars.push(' '); offsets.push(i); lastWasSpace = true; }
    } else {
      chars.push(ch); offsets.push(i); lastWasSpace = false;
    }
  }
  while (chars.length && chars[chars.length - 1] === ' ') { chars.pop(); offsets.pop(); }
  return { text: chars.join(''), offsets };
}

/** "第 12 頁" / "第 12-14 頁", or the ordinal when no page covers this chunk. */
export function chunkLabel(pages: PageSpan[], rawStart: number, rawEnd: number, ordinal: number): string {
  const covering = pages.filter(p => p.start <= rawEnd && p.end >= rawStart).map(p => p.page);
  if (covering.length === 0) return `第 ${ordinal} 段`;
  const first = Math.min(...covering);
  const last = Math.max(...covering);
  return first === last ? `第 ${first} 頁` : `第 ${first}-${last} 頁`;
}

/** Reads the Azure `pages` array into spans, ignoring anything malformed. */
export function pageSpansFrom(analyzePages: any[]): PageSpan[] {
  const spans: PageSpan[] = [];
  for (const page of analyzePages || []) {
    const list = Array.isArray(page?.spans) ? page.spans : [];
    if (!list.length || typeof page?.pageNumber !== 'number') continue;
    spans.push({
      page: page.pageNumber,
      start: Math.min(...list.map((s: any) => Number(s?.offset) || 0)),
      end: Math.max(...list.map((s: any) => (Number(s?.offset) || 0) + (Number(s?.length) || 0)))
    });
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** The chunks one document becomes, each already knowing which page it is on. */
export function planChunks(
  cleaned: string,
  offsets: number[],
  pages: PageSpan[],
  chunkSize: number
): { label: string; text: string }[] {
  const planned: { label: string; text: string }[] = [];
  let ordinal = 0;
  for (let i = 0; i < cleaned.length; i += chunkSize) {
    const slice = cleaned.slice(i, i + chunkSize);
    if (!slice.trim()) continue;
    ordinal++;
    const rawStart = offsets[i] ?? 0;
    const rawEnd = offsets[Math.min(i + slice.length, offsets.length) - 1] ?? rawStart;
    planned.push({ label: chunkLabel(pages, rawStart, rawEnd, ordinal), text: slice });
  }
  return planned;
}
