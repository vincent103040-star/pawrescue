// Does the status pipeline read what was actually sent, and say so when it
// cannot?
//
//   npm run check:status-csv
//
// The CSV splitter is hand-written, so its expectations are not hand-written
// too: every case below was run through Python's `csv` module and this file
// records what that produced. A parser checked only against its author's idea
// of the answer shares whatever the author got wrong -- and the failure here
// is silent, because a row that splits one column short still parses, it just
// means something else.
import {
  splitCsv,
  parseStatusCsv,
  parseBatchSubject,
  findMissingSequences
} from './status-csv';

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`); }
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- splitting
console.log('\nCSV 切分（對照 Python csv 模組的結果）');

const csvCases: Array<[string, string, string[][]]> = [
  ['純文字', 'a,b\n1,2\n', [['a', 'b'], ['1', '2']]],
  ['引號內有逗號', 'name,note\n"小黑, 二號",乖\n', [['name', 'note'], ['小黑, 二號', '乖']]],
  ['引號內有引號', 'name,note\n"他叫""小黑""",好\n', [['name', 'note'], ['他叫"小黑"', '好']]],
  ['CRLF 換行', 'a,b\r\n1,2\r\n', [['a', 'b'], ['1', '2']]],
  ['沒有結尾換行', 'a,b\n1,2', [['a', 'b'], ['1', '2']]],
  ['空欄位', 'a,b,c\n1,,3\n', [['a', 'b', 'c'], ['1', '', '3']]],
  ['引號內有換行', 'name,note\n"第一行\n第二行",x\n', [['name', 'note'], ['第一行\n第二行', 'x']]],
  ['引號內保留空白', 'a,b\n"  留白  ",x\n', [['a', 'b'], ['  留白  ', 'x']]],
  ['中文欄位', '動物,狀態\n小黑,便便正常\n', [['動物', '狀態'], ['小黑', '便便正常']]]
];

for (const [label, text, expected] of csvCases) {
  check(eq(splitCsv(text), expected), label, JSON.stringify(splitCsv(text)));
}

check(eq(splitCsv('﻿a,b\n1,2\n'), [['a', 'b'], ['1', '2']]), 'BOM 開頭不會混進第一個欄位');

// ------------------------------------------------------------------ parsing
console.log('\n批次內容');

const HEADER = 'shelter_code,animal_id,shelter_number,animal_name,observed_at,category_code,option_code,option_label';
const good = `${HEADER}
xindian,a1b2,A-114-032,小黑,2026-08-30T09:15:00+08:00,excretion,normal,便便正常
xindian,c3d4,A-114-077,豆花,2026-08-30T09:40:00+08:00,excretion,loose,便便較軟
`;

const parsed = parseStatusCsv(good);
check(parsed.rows.length === 2, '兩列都讀進來了', `實際 ${parsed.rows.length}`);
check(parsed.errors.length === 0, '沒有錯誤', parsed.errors.join('；'));
check(parsed.rows[0].animalName === '小黑' && parsed.rows[0].optionLabel === '便便正常',
  '欄位對到正確的位置');

const reordered = parseStatusCsv(
  `animal_name,option_label,shelter_code,animal_id,shelter_number,observed_at,category_code,option_code
小黑,便便正常,xindian,a1b2,A-114-032,2026-08-30T09:15:00+08:00,excretion,normal
`);
check(reordered.rows.length === 1 && reordered.rows[0].animalId === 'a1b2',
  '欄位順序換了也讀得對 —— 靠標題名稱，不是靠位置');

const extra = parseStatusCsv(`${HEADER},remark
xindian,a1b2,A-114-032,小黑,2026-08-30T09:15:00+08:00,excretion,normal,便便正常,備註
`);
check(extra.rows.length === 1 && extra.errors.length === 0,
  '多出來的欄位被忽略，不會壞掉');

console.log('\n壞掉的輸入要出聲，不要靜默');

const missingCol = parseStatusCsv('animal_id,animal_name\na1b2,小黑\n');
check(missingCol.rows.length === 0, '欄位不足時不產生任何資料');
check(missingCol.errors.some(e => e.includes('缺少必要欄位')), '而且說出少了什麼',
  missingCol.errors.join('；'));

const partial = parseStatusCsv(`${HEADER}
xindian,,A-114-032,小黑,2026-08-30T09:15:00+08:00,excretion,normal,便便正常
xindian,c3d4,A-114-077,豆花,2026-08-30T09:40:00+08:00,excretion,loose,便便較軟
`);
check(partial.rows.length === 1, '缺 animal_id 的那列被略過，好的那列留下');
check(partial.errors.length === 1 && partial.errors[0].includes('第 2 列'),
  '而且指出是第幾列、少了什麼', partial.errors.join('；'));

check(parseStatusCsv('').errors.length > 0, '空檔案回報錯誤，不是回報成功');

// ------------------------------------------------------------------ subject
console.log('\n信件主旨');

const header = parseBatchSubject('[StrayHub] 動物狀態 #142 2026-08-30T06:00+08:00 ~ 2026-08-30T12:00+08:00');
check(header?.sequence === 142, '讀得出批次序號', String(header?.sequence));
check(header?.periodStart === '2026-08-30T06:00+08:00' && header?.periodEnd === '2026-08-30T12:00+08:00',
  '讀得出涵蓋的時間區間');
check(parseBatchSubject('一般的信件主旨') === null, '不是批次信就回 null，不會亂猜');

// ------------------------------------------------------------------- gaps
console.log('\n掉信偵測');

check(eq(findMissingSequences([140, 141], 142), []), '連號時沒有缺口');
check(eq(findMissingSequences([140, 141], 145), [142, 143, 144]), '跳號時指出漏了哪幾封',
  JSON.stringify(findMissingSequences([140, 141], 145)));
check(eq(findMissingSequences([], 1), []), '第一封信不算漏 —— 沒有前一封可以比');
check(eq(findMissingSequences([140, 141, 142], 141), []), '重複收到舊的一封不算漏');
check(eq(findMissingSequences([140, 143], 145), [144]),
  '已知的缺口不重複回報，只報這次新出現的',
  JSON.stringify(findMissingSequences([140, 143], 145)));

console.log(`\n${'='.repeat(52)}\n${fail === 0 ? '全部通過' : '有失敗'}：${pass}/${pass + fail}\n`);
process.exit(fail === 0 ? 0 : 1);
