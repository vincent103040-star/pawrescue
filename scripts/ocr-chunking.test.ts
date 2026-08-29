// Does a chunk get labelled with the page it actually came from?
//
//   npm run check:ocr-chunking
//
// This is the part of the OCR import that has no visible failure mode. A wrong
// page number does not throw, does not look odd in the output, and is only
// discovered by somebody opening the PDF at the page a citation named and
// finding it says something else. So it gets checked against a document whose
// page boundaries are known by construction.
import { cleanWithOffsets, pageSpansFrom, planChunks } from './ocr-chunking';

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`); }
};

// A document built the way Azure hands one back: `content` is every page's text
// run together, and each page reports the span of `content` it occupies. The
// whitespace is deliberately messy -- a scan of Chinese slides comes back with
// spaces between individual characters and newlines mid-sentence.
const pageTexts = [
  '第一頁\n 大 狗 牽 繩 規 範 ',
  '\n\n第二頁   建 國 花 市  台北市大安區信義路三段\n',
  '第三頁 貓 舍 清 消 \t 每 日 兩 次'
];

let content = '';
const analyzePages: any[] = [];
pageTexts.forEach((text, index) => {
  analyzePages.push({ pageNumber: index + 1, spans: [{ offset: content.length, length: text.length }] });
  content += text;
});

const pages = pageSpansFrom(analyzePages);
const { text: cleaned, offsets } = cleanWithOffsets(content);

console.log('\n頁碼對照');

check(pages.length === 3, '三頁都讀進來了', `實際 ${pages.length}`);
check(offsets.length === cleaned.length, '每個保留下來的字都有原始位置', `${offsets.length} vs ${cleaned.length}`);
check(!/\s\s/.test(cleaned), '沒有連續空白殘留');
check(!cleaned.startsWith(' ') && !cleaned.endsWith(' '), '頭尾沒有空白');

// Every character of the cleaned text must point back at the same character in
// the raw text -- the whole page mapping rests on this.
const misaligned = [...cleaned].findIndex((ch, i) => ch !== ' ' && content[offsets[i]] !== ch);
check(misaligned === -1, '每個字的原始位置都對得上', misaligned >= 0 ? `第 ${misaligned} 個字對不上` : '');

// Small chunks so several fall inside one page and at least one straddles two.
const planned = planChunks(cleaned, offsets, pages, 6);
console.log(`\n  （切成 ${planned.length} 段，每段 6 字）`);
for (const piece of planned) console.log(`    ${piece.label}  ${JSON.stringify(piece.text)}`);

console.log('\n每一段的頁碼');

// The label a chunk carries must cover every page its text really came from.
// Derived from the text itself rather than from the same offsets the code used,
// so a mistake in the offset arithmetic cannot agree with itself.
let allCorrect = true;
for (const piece of planned) {
  const truly: number[] = [];
  pageTexts.forEach((text, index) => {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    // Which of this page's characters appear in this chunk, in order?
    if (collapsed && [...collapsed].some(ch => ch !== ' ' && piece.text.includes(ch))) {
      // Only count it if a distinctive marker of that page is present.
      if (piece.text.includes(`第${['一', '二', '三'][index]}頁`) ||
          collapsed.split(' ').some(word => word.length > 1 && piece.text.includes(word))) {
        truly.push(index + 1);
      }
    }
  });
  if (truly.length === 0) continue;
  const expected = truly.length === 1 || Math.min(...truly) === Math.max(...truly)
    ? `第 ${truly[0]} 頁`
    : `第 ${Math.min(...truly)}-${Math.max(...truly)} 頁`;
  if (piece.label !== expected) {
    allCorrect = false;
    console.log(`  FAIL  ${JSON.stringify(piece.text)} 標成 ${piece.label}，應為 ${expected}`);
  }
}
check(allCorrect, '每段標到的頁碼都涵蓋它真正的來源頁');

const first = planned[0];
const last = planned[planned.length - 1];
check(first.label === '第 1 頁', '第一段落在第 1 頁', first.label);
check(last.label === '第 3 頁', '最後一段落在第 3 頁', last.label);
check(planned.some(p => p.label.includes('-')), '有跨頁的段落被標成範圍',
  planned.map(p => p.label).join('、'));

console.log('\n沒有頁碼資訊時');

const noPages = planChunks(cleaned, offsets, [], 6);
check(noPages.every(p => /^第 \d+ 段$/.test(p.label)), '退回「第 N 段」，不編造頁碼',
  noPages.map(p => p.label).join('、'));
check(noPages[0].label === '第 1 段' && noPages[1].label === '第 2 段', '段號從 1 開始連續');

console.log('\n畸形輸入');

check(pageSpansFrom([{ pageNumber: 1 }, { spans: [{ offset: 0, length: 5 }] }, null]).length === 0,
  '缺少頁碼或 span 的資料被忽略，不會產生錯誤的對照');
check(planChunks('', [], pages, 6).length === 0, '空白文件產生 0 段');

console.log(`\n${'='.repeat(52)}\n${fail === 0 ? '全部通過' : '有失敗'}：${pass}/${pass + fail}\n`);
process.exit(fail === 0 ? 0 : 1);
