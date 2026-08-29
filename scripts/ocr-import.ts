// Re-reads the scanned training PDFs with Azure Document Intelligence.
//
//   npm run ocr:pdfs -- --dry-run        # analyse and report, write nothing
//   npm run ocr:pdfs                     # analyse and replace the chunks
//   npm run ocr:pdfs -- --relabel        # ...even if the text came back ~equal
//   npm run ocr:pdfs -- --only=doc-1787414465485
//
// This was written to fix a problem that turned out not to exist, and the
// finding is worth keeping.
//
// The three manuals are 50-88MB and were assumed to be scans whose text layer
// covered only some pages -- 67, 42 and 21 pages had produced just 16, 11 and 6
// chunks, which looked like most of the content was pixels. Running OCR settled
// it: all three came back at ~290 characters per page, within 4% of what the
// upload path had already extracted. They are PowerPoint exports, large because
// of embedded photographs, and their text layer was complete all along. The
// original figure was an assumption dressed up as evidence; dividing by the
// page count would have shown it.
//
// What remains is worth having anyway: chunks re-indexed from here are cited by
// page. Everything else is deliberately identical to the upload path -- same
// table, same chunk size, same embedding model -- so the retrieval side needs
// no changes to use them.
//
// One thing does change, and for the better: these chunks are cited by page.
// "東森寵物假日送養志工 工作內容（第 24-25 頁）" can be checked by opening the
// PDF at that page; "（第 7 段）" cannot be checked at all. Azure reports which
// span of the extracted text belongs to which page, so the page a chunk came
// from is known rather than guessed -- and when it is not reported, the label
// falls back to the old ordinal rather than inventing a number.
//
// Azure is used once, here. Nothing at request time touches it: a volunteer's
// question is embedded and answered by the same Google models as before,
// against text that now lives in the shelter's own database. If the Azure
// subscription lapses, the assistant is unaffected -- only OCR of a *new*
// upload would be.
//
// It runs as a script rather than inside the server because analysing a 67-page
// scan takes minutes, and the deploy VM has 1GB of memory to spend on serving
// the site. Nothing here touches the running service; restart it afterwards so
// it re-reads the chunk table into memory (it caches the embeddings at boot).
import '../env';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { getAllSopDocuments, getAllRagChunks, replaceRagChunks } from '../db';
import { PageSpan, cleanWithOffsets, pageSpansFrom, planChunks } from './ocr-chunking';

const ENDPOINT = (process.env.AZURE_DOC_ENDPOINT || '').replace(/\/+$/, '');
const KEY = process.env.AZURE_DOC_KEY || '';
const API_VERSION = process.env.AZURE_DOC_API_VERSION || '2024-11-30';
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';

// Matches the upload path in server.ts, so the same document is not chunked one
// way today and another way tomorrow.
const CHUNK_SIZE = 1200;

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || '';

/**
 * Re-index a document whose OCR text is merely *comparable* to what is already
 * there, rather than longer.
 *
 * The default refuses to shrink an index, because a partial read or the wrong
 * file is the likely reason a result comes back smaller. That guard did its job
 * on the shelter's three manuals -- they turned out to be PowerPoint exports
 * with a complete text layer, not scans, so OCR found the same text and in two
 * cases a few percent less of it.
 *
 * But there is still a reason to re-index them: the chunks would then be cited
 * by page. So this flag lowers the bar from "longer" to "within 10%", which
 * still catches a read that failed halfway while allowing one that merely
 * tokenised the whitespace differently.
 */
const RELABEL = process.argv.includes('--relabel');
const SHRINK_TOLERANCE = RELABEL ? 0.9 : 1.0;

const sopDocsDir = path.join(process.cwd(), 'data', 'sop-docs');

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Node's fetch reports every network problem as "fetch failed" and puts the
// actual reason -- DNS, TLS, refused connection -- in .cause. On a VM that is
// the difference between a diagnosable error and a shrug.
function describe(error: any): string {
  const message = String(error?.message || error);
  const cause = error?.cause ? String(error.cause?.message || error.cause) : '';
  return cause && !message.includes(cause) ? `${message}（${cause}）` : message;
}

// ---------------------------------------------------------------- Azure OCR

async function analyze(filePath: string, label: string): Promise<{ content: string; pages: PageSpan[] }> {
  const url = `${ENDPOINT}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=${API_VERSION}`;
  const bytes = readFileSync(filePath);

  let res = await fetch(url, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': KEY, 'Content-Type': 'application/pdf' },
    body: bytes
  });

  // Some API versions want the file wrapped in JSON rather than posted raw.
  // Base64 costs a third more memory, so it is the fallback, not the default.
  if (res.status === 415) {
    console.log(`      （改用 JSON base64 上傳）`);
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Source: bytes.toString('base64') })
    });
  }

  if (res.status !== 202) {
    throw new Error(`${label}：分析請求被拒絕（HTTP ${res.status}）${(await res.text()).slice(0, 300)}`);
  }

  const operation = res.headers.get('operation-location');
  if (!operation) throw new Error(`${label}：回應沒有 Operation-Location，無法追蹤進度`);

  // A scanned deck takes minutes. Poll rather than hold one long request open.
  const deadline = Date.now() + 20 * 60 * 1000;
  let waited = 0;
  while (Date.now() < deadline) {
    await sleep(5000);
    waited += 5;
    const poll = await fetch(operation, { headers: { 'Ocp-Apim-Subscription-Key': KEY } });
    if (!poll.ok) throw new Error(`${label}：查詢進度失敗（HTTP ${poll.status}）`);
    const data: any = await poll.json();

    if (data.status === 'succeeded') {
      const content = String(data.analyzeResult?.content || '');
      const pages = pageSpansFrom(data.analyzeResult?.pages);
      console.log(`      辨識完成：${data.analyzeResult?.pages?.length ?? '?'} 頁、${content.length.toLocaleString()} 字（耗時 ${waited} 秒）`);
      if (pages.length === 0) console.log(`      （沒有頁碼資訊，引用會退回「第 N 段」）`);
      return { content, pages };
    }
    if (data.status === 'failed') {
      throw new Error(`${label}：辨識失敗 ${JSON.stringify(data.error || {}).slice(0, 300)}`);
    }
    if (waited % 30 === 0) console.log(`      辨識中…（${waited} 秒）`);
  }
  throw new Error(`${label}：超過 20 分鐘仍未完成`);
}

// ------------------------------------------------------------- embeddings

// Built on first use, not at import: constructing it with an empty key prints
// a warning of its own, which would arrive before this script has had a chance
// to say which variable is actually missing.
let genai: GoogleGenAI | null = null;
const client = () => (genai ??= new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
  httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
}));

async function embed(text: string): Promise<number[] | null> {
  // One retry, because a rate limit part-way through would otherwise leave a
  // document indexed with a hole in it.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await client().models.embedContent({ model: EMBED_MODEL, contents: text });
      const values = res.embeddings?.[0]?.values;
      if (values?.length) return values;
    } catch (error: any) {
      if (attempt === 2) {
        console.warn(`      向量產生失敗：${String(error?.message || error).slice(0, 120)}`);
        return null;
      }
      await sleep(3000);
    }
  }
  return null;
}

// ------------------------------------------------------------------- main

async function main() {
  if (!ENDPOINT || !KEY) {
    fail('缺少 AZURE_DOC_ENDPOINT 或 AZURE_DOC_KEY，請先寫進 .env.local');
  }
  if (!process.env.GEMINI_API_KEY) {
    fail('缺少 GEMINI_API_KEY —— 沒有它就無法產生向量，辨識出來的文字也進不了問答索引');
  }

  const documents = getAllSopDocuments().filter(doc => !ONLY || doc.id === ONLY);
  if (documents.length === 0) fail(ONLY ? `找不到文件 ${ONLY}` : '資料庫裡沒有任何 PDF 文件');

  console.log(`\n端點：${ENDPOINT}`);
  console.log(`模式：${DRY_RUN ? '試跑（不寫入資料庫）' : '正式匯入'}`);
  console.log(`文件：${documents.length} 份\n${'='.repeat(60)}`);

  const existing = getAllRagChunks();
  let written = 0;
  let skipped = 0;

  for (const doc of documents) {
    const filePath = path.join(sopDocsDir, `${doc.id}.pdf`);
    const before = existing.filter(c => c.sourceId === doc.id);
    const beforeChars = before.reduce((sum, c) => sum + c.text.length, 0);

    console.log(`\n${doc.title}`);
    console.log(`   目前索引：${before.length} 段、${beforeChars.toLocaleString()} 字`);

    if (!existsSync(filePath)) {
      console.log(`   ✗ 找不到檔案 ${filePath} —— 跳過`);
      skipped++;
      continue;
    }

    let content: string;
    let pages: PageSpan[];
    try {
      console.log(`   送出辨識…（${(doc.fileSize / 1048576).toFixed(1)} MB）`);
      ({ content, pages } = await analyze(filePath, doc.title));
    } catch (error: any) {
      console.log(`   ✗ ${describe(error)}`);
      skipped++;
      continue;
    }

    const { text: cleaned, offsets } = cleanWithOffsets(content);
    const gain = beforeChars > 0 ? `${(cleaned.length / beforeChars).toFixed(1)} 倍` : '（原本沒有索引）';
    console.log(`   辨識結果：${cleaned.length.toLocaleString()} 字 —— ${gain}`);

    // A shorter result usually means something went wrong -- a partial read,
    // the wrong file -- so keeping what is already indexed is safer than
    // replacing good chunks with worse ones. --relabel lowers the bar to
    // "within 10%" for the case where the point is the page numbers, not the
    // text.
    if (cleaned.length < beforeChars * SHRINK_TOLERANCE) {
      const shortfall = beforeChars > 0 ? Math.round((1 - cleaned.length / beforeChars) * 100) : 0;
      console.log(`   ✗ 辨識結果比現有索引少 ${shortfall}%，不覆蓋（保留原本的 ${before.length} 段）`);
      if (!RELABEL && shortfall <= 10) {
        console.log(`      字數相當，若只是想換成頁碼引用，可加上 --relabel`);
      }
      skipped++;
      continue;
    }
    if (cleaned.length < beforeChars) {
      console.log(`   （字數少 ${Math.round((1 - cleaned.length / beforeChars) * 100)}%，在 --relabel 容許範圍內，改用頁碼重建索引）`);
    }

    if (DRY_RUN) {
      const planned = planChunks(cleaned, offsets, pages, CHUNK_SIZE);
      console.log(`   → 正式執行會產生 ${planned.length} 段（目前 ${before.length} 段）`);
      console.log(`   → 引用會長這樣：${doc.title}（${planned[0]?.label ?? '第 1 段'}）、${doc.title}（${planned[planned.length - 1]?.label ?? '第 1 段'}）`);
      continue;
    }

    const planned = planChunks(cleaned, offsets, pages, CHUNK_SIZE);
    const chunks: { title: string; text: string; embedding: number[] }[] = [];
    for (const [index, piece] of planned.entries()) {
      const embedding = await embed(piece.text);
      if (embedding) chunks.push({ title: `${doc.title}（${piece.label}）`, text: piece.text, embedding });
      if ((index + 1) % 10 === 0) console.log(`      已處理 ${index + 1} / ${planned.length} 段…`);
    }

    if (chunks.length === 0) {
      console.log(`   ✗ 一段向量都沒產生出來（多半是 GEMINI_API_KEY 額度或網路問題）—— 不覆蓋`);
      skipped++;
      continue;
    }

    replaceRagChunks('pdf', doc.id, chunks);
    console.log(`   ✓ 已寫入 ${chunks.length} 段（原本 ${before.length} 段）`);
    console.log(`      例：${chunks[0].title}`);
    written++;
  }

  console.log(`\n${'='.repeat(60)}`);
  if (DRY_RUN) {
    console.log('試跑結束，資料庫沒有任何變動。');
    console.log('確認數字合理後，拿掉 --dry-run 再跑一次。');
  } else {
    console.log(`完成：${written} 份已更新${skipped > 0 ? `、${skipped} 份跳過` : ''}。`);
    if (written > 0) {
      console.log('\n伺服器在啟動時就把向量讀進記憶體了，所以要重新啟動才會用到新的索引：');
      console.log('  sudo systemctl restart pawrescue');
    }
  }
  console.log('');
}

main().catch(error => fail(describe(error)));
