// Does "is this attendance row mine?" give the same answer everywhere?
//
//   npm run check:attendance-ownership
//
// The bug this guards was silent on both sides. Attendance rows name their
// volunteer by a *name string*, and the read path, the volunteer's screen and
// the check-out handler each compared that string differently -- exact, then
// trimmed-and-lower-cased, then exact again but without the signup fallback.
// A name differing by one trailing space fell into the gap: the row was
// returned, the phone drew the check-out form, the volunteer wrote their
// reflection, and the save was refused with 「只能為自己簽退」. The
// coordinator's console skips the ownership check entirely, so the identical
// feedback saved there -- which from the outside reads as "volunteers can't
// write feedback, only admins can".
//
// So these checks are in two halves:
//
//   1. The spellings that must still count as the same person.
//   2. The ones that must NOT -- because a rule loose enough to fix the first
//      half by itself would let one volunteer write to another's record.
//
// No database, no server, no session: the rule is a pure function on purpose.
import {
  normalizeVolunteerName, sameVolunteerName, attendanceBelongsTo
} from '../src/utils/attendanceOwnership';

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`); }
};

const row = (volunteerName: string, signupId?: string) => ({ volunteerName, signupId });
const none = new Set<string>();

console.log('\n同一個人的不同寫法');
check(sameVolunteerName('陳小美 ', '陳小美'), '尾端空白 —— 這就是實際踩到的那一個');
check(sameVolunteerName(' 陳小美', '陳小美'), '開頭空白');
check(sameVolunteerName('陳小美　', '陳小美'), '全形空白（U+3000）');
check(sameVolunteerName('陳  小美', '陳 小美'), '連續空白收成一個');
check(sameVolunteerName('Mary Chen', 'mary chen'), '英文大小寫');
check(sameVolunteerName('ＭＡＲＹ', 'MARY'), '全形英數字（NFKC）');
check(sameVolunteerName('陳小美', '陳小美'), '完全一樣的當然算');

console.log('\n不是同一個人 —— 規則不能寬到把人合併');
check(!sameVolunteerName('陳 小美', '陳小美'),
  '名字「中間」的空白不會被吃掉：兩個人就是兩個人');
check(!sameVolunteerName('陳小美', '陳小明'), '不同的名字');
check(!sameVolunteerName('', '陳小美'), '空字串不等於任何人');
check(!sameVolunteerName('   ', '陳小美'), '只有空白也不等於任何人');
check(!sameVolunteerName('', ''), '兩邊都空也不算相符 —— 否則沒有名字的紀錄人人可寫');
check(normalizeVolunteerName(null) === '' && normalizeVolunteerName(undefined) === '',
  'null / undefined 正規化成空字串，不會炸掉');

console.log('\n報名紀錄是比姓名更可靠的那條路');
check(attendanceBelongsTo(row('舊名字', 'sg-1'), '新名字', new Set(['sg-1'])),
  '名字對不上，但報名紀錄是我的 —— 算我的',
  '登入時 Google 會改寫 volunteers.name，簽到後改過名的人就靠這條');
check(!attendanceBelongsTo(row('別人', 'sg-9'), '我', new Set(['sg-1'])),
  '報名紀錄不是我的、名字也不是我的 —— 不算我的');
check(attendanceBelongsTo(row('陳小美 '), '陳小美', none),
  '沒有報名紀錄可依靠時，正規化後的姓名仍然算數',
  '代理簽到產生的紀錄沒有 signupId，只能靠這條');
check(!attendanceBelongsTo(row('陳小明', 'sg-2'), '陳小美', none),
  '兩條路都不通就是不通');
check(!attendanceBelongsTo(row('陳小美'), '', none),
  '沒有登入姓名時不會通吃');

console.log('\n讀和寫問的是同一題');
// 這是整個 bug 的形狀：讀得到卻寫不進去。同一個 predicate 就不可能再發生。
const listed = row('陳小美 ', 'sg-1');
const mine = new Set(['sg-1']);
const canRead = attendanceBelongsTo(listed, '陳小美', mine);
const canWrite = attendanceBelongsTo(listed, '陳小美', mine);
check(canRead === canWrite && canRead,
  '同一筆紀錄：列得出來，就寫得進去',
  `讀=${canRead} 寫=${canWrite}`);

const notMine = row('別人', 'sg-9');
check(attendanceBelongsTo(notMine, '陳小美', mine) === false,
  '同一筆紀錄：列不出來，也寫不進去');

console.log(`\n${'='.repeat(52)}\n${fail === 0 ? '全部通過' : '有失敗'}：${pass}/${pass + fail}\n`);
process.exit(fail === 0 ? 0 : 1);
