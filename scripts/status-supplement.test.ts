// Does the roster's animal-driven column say what it means?
//
//   npm run check:status-supplement
//
// Four promises are checked here, and each one is a mistake this feature could
// make silently:
//
//   1. requiredCount does not move. The animal figure is reported beside the
//      baseline, never folded into it unless somebody asks -- because a
//      published shift that changes under a volunteer costs the trust the
//      whole system is built to earn.
//   2. Extra people go through peakConcurrent, not a sum. Two status-driven
//      duties running one after the other need one extra person, not two --
//      the same rule the baseline already uses.
//   3. A zero says which zero it is. No observations, no rules, no affected
//      animals and "priced but unreachable" look identical on screen and need
//      four different repairs. Right now the second is the true answer, since
//      the mapping table ships empty on purpose.
//   4. Priced minutes the roster cannot reach are reported, not dropped. A
//      rule pointing at a one-off duty, a disabled duty or a duty with no end
//      time contributes nothing to the plan, and saying nothing about that is
//      how it stays broken.
//
// Runs against a throwaway database in the system temp folder, created fresh
// each run and never the shelter's. That is what DATA_DIR is for, and why the
// import below is dynamic: db.ts reads the path as it loads, and a static
// import would be evaluated before the line that sets it.
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const scratch = mkdtempSync(join(tmpdir(), 'pawrescue-supplement-test-'));
process.env.DATA_DIR = scratch;

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`); }
};

/** Shelter-local today, which is what planShiftsForRange counts days from. */
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
/** Recent enough that getAnimalConcerns' seven-day window keeps it. */
const observedAt = new Date(Date.now() - 3600_000).toISOString();

const batch = (sequence: number, rows: any[]) => ({
  sequence,
  periodStart: observedAt,
  periodEnd: observedAt,
  mailUid: 900 + sequence,
  subject: `[StrayHub] 動物狀態 #${sequence}`,
  sender: 'noreply@strayhub.example',
  sentAt: observedAt,
  skippedCount: 0,
  rows
});

const seen = (animalId: string, categoryCode: string, optionCode: string, optionLabel: string) => ({
  shelterCode: 'xindian',
  animalId,
  shelterNumber: `A-114-${animalId}`,
  animalName: `動物${animalId}`,
  observedAt,
  categoryCode,
  optionCode,
  optionLabel
});

async function main() {
  const db = await import('../db');

  const duty = (over: Record<string, unknown>) => db.createDutyItem({
    zoneId: '',
    title: '未命名',
    description: '',
    category: '',
    triggerType: 'daily',
    shiftId: '',
    responsibleRole: 'volunteer',
    requiredPeople: 1,
    estimatedMinutes: 30,
    startTime: '',
    endTime: '',
    weekdays: '',
    timeWindow: '',
    isRequired: true,
    sopSectionId: '',
    sopVideoId: '',
    ...over
  } as any);

  // --------------------------------------------------------------- the shelter
  // Two zones with deliberately different shapes: one where the duties overlap,
  // one where they run back to back. Those are the two cases the peak rule has
  // to tell apart, and summing would get exactly one of them wrong.
  const cats = db.createZone({ name: '貓舍區', code: 'CAT', palette: 'amber', icon: '🐱', description: '' });
  const dogs = db.createZone({ name: '大狗運動場', code: 'DOG', palette: 'emerald', icon: '🐕', description: '' });

  //  貓舍 09:00-11:00 -- both duties in the same window, so baseline peak is 2
  const clean = duty({ zoneId: cats.id, title: '貓舍清潔', startTime: '09:00', endTime: '11:00' });
  const meds = duty({ zoneId: cats.id, title: '貓舍投藥', startTime: '09:00', endTime: '11:00' });
  //  大狗 14:00-16:00 -- back to back, so baseline peak is 1
  const walk = duty({ zoneId: dogs.id, title: '大狗放風', startTime: '14:00', endTime: '15:00' });
  const wash = duty({ zoneId: dogs.id, title: '大狗清消', startTime: '15:00', endTime: '16:00' });

  const shiftOf = (plan: any[], zoneId: string) => plan.find(p => p.zoneId === zoneId);

  // ------------------------------------------------------ no rules written yet
  console.log('\n還沒有人設定規則');

  db.recordStatusBatch(batch(1, [
    seen('a1', 'excretion', 'loose', '便便較軟'),
    seen('a2', 'excretion', 'loose', '便便較軟'),
    seen('a3', 'excretion', 'loose', '便便較軟')
  ]));

  let plan = db.planShiftsForRange(today, 1);
  let summary = db.getStatusSupplementSummary();

  const mine = (p: any[]) => p.filter(s => s.zoneId === cats.id || s.zoneId === dogs.id);
  check(mine(plan).length === 2,
    '這個測試自己的兩個場域各排出一個班次', `實際 ${mine(plan).length}`);
  check(plan.every(p => p.status.extraPeople === 0), '沒有規則時不加任何人（含內建示範場域）');
  check(summary.observationCount === 3,
    '觀察筆數如實回報，不會因為沒有規則就變成 0', `實際 ${summary.observationCount}`);
  check(summary.activeRuleCount === 0, '規則數是 0');
  check(summary.unpricedStatuses.some(u => u.optionCode === 'loose'),
    '「還沒有人設定規則」的狀態被列出來，而不是安靜地當成不存在');
  check(summary.totalMinutes === 0, '沒有規則就沒有分鐘 —— 不猜一個數字出來');

  // ------------------------------------------------------- minutes find a zone
  console.log('\n設定規則之後，分鐘落到對的場域與時段');

  // 3 隻 × 40 分鐘 = 120 分鐘，貓舍時窗 120 分鐘 → 每人 120 → 加 1 人
  db.upsertStatusDutyMapping({
    categoryCode: 'excretion', optionCode: 'loose', optionLabel: '便便較軟',
    dutyItemId: clean.id, minutesPerAnimal: 40
  });

  plan = db.planShiftsForRange(today, 1);
  summary = db.getStatusSupplementSummary();
  let catShift = shiftOf(plan, cats.id);
  let dogShift = shiftOf(plan, dogs.id);

  check(catShift.status.minutes === 120,
    '3 隻 × 40 分鐘 = 120 分鐘算到貓舍', `實際 ${catShift.status.minutes}`);
  check(catShift.status.animalCount === 3, '動物數是不重複的 3 隻', `實際 ${catShift.status.animalCount}`);
  check(catShift.status.extraPeople === 1, '貓舍加 1 人', `實際 ${catShift.status.extraPeople}`);
  check(dogShift.status.extraPeople === 0,
    '大狗運動場不受影響 —— 規則指的是貓舍的勤務，工作量就只落在貓舍');
  check(catShift.status.duties[0]?.perPersonMinutes === 120,
    '除數跟著答案一起回報，數字才能被質疑', `實際 ${catShift.status.duties[0]?.perPersonMinutes}`);

  // -------------------------------------------------- requiredCount stays put
  console.log('\n基準人數不會被動到');

  check(catShift.requiredCount === 2,
    '貓舍兩項同時段勤務 → 基準仍是 2 人，沒有被偷偷加上去', `實際 ${catShift.requiredCount}`);
  check(dogShift.requiredCount === 1,
    '大狗兩項接續勤務 → 基準仍是 1 人', `實際 ${dogShift.requiredCount}`);

  // ------------------------------------------------- peak, not sum, for extras
  console.log('\n加出來的人也走「同時最多幾人」，不是相加');

  db.recordStatusBatch(batch(2, [
    seen('b1', 'mood', 'flat', '精神不振'),
    seen('b2', 'mood', 'flat', '精神不振'),
    seen('c1', 'skin', 'wound', '外傷'),
    seen('c2', 'skin', 'wound', '外傷')
  ]));
  // 放風與清消是接續的：各自加 1 人，但一個人做得完兩段
  db.upsertStatusDutyMapping({
    categoryCode: 'mood', optionCode: 'flat', optionLabel: '精神不振',
    dutyItemId: walk.id, minutesPerAnimal: 30
  });
  db.upsertStatusDutyMapping({
    categoryCode: 'skin', optionCode: 'wound', optionLabel: '外傷',
    dutyItemId: wash.id, minutesPerAnimal: 30
  });

  plan = db.planShiftsForRange(today, 1);
  dogShift = shiftOf(plan, dogs.id);

  check(dogShift.status.duties.length === 2, '兩項勤務各自算出加班人力', `實際 ${dogShift.status.duties.length}`);
  check(dogShift.status.duties.every((d: any) => d.extraPeople === 1), '每一項各加 1 人');
  check(dogShift.status.extraPeople === 1,
    '接續的兩項合起來只加 1 人（相加會得到 2，那是錯的）', `實際 ${dogShift.status.extraPeople}`);
  check(dogShift.status.minutes === 120, '分鐘仍然是加總的 120', `實際 ${dogShift.status.minutes}`);

  // 貓舍那兩項是重疊的，所以那裡才該相加
  db.upsertStatusDutyMapping({
    categoryCode: 'mood', optionCode: 'flat', optionLabel: '精神不振',
    dutyItemId: meds.id, minutesPerAnimal: 60
  });
  plan = db.planShiftsForRange(today, 1);
  catShift = shiftOf(plan, cats.id);
  check(catShift.status.extraPeople === 2,
    '重疊的兩項就會相加 —— 同一時刻真的需要兩個人', `實際 ${catShift.status.extraPeople}`);

  // ---------------------------------------------- priced but out of reach
  console.log('\n算得出來、但排班讀不到的分鐘');

  const oneOff = duty({
    zoneId: cats.id, title: '送養會佈置', triggerType: 'specific_shift',
    startTime: '13:00', endTime: '15:00'
  });
  const noClock = duty({ zoneId: cats.id, title: '巡場（沒填時間）' });
  db.recordStatusBatch(batch(3, [
    seen('d1', 'adoption', 'listed', '待送養'),
    seen('e1', 'weight', 'low', '體重偏低')
  ]));
  db.upsertStatusDutyMapping({
    categoryCode: 'adoption', optionCode: 'listed', optionLabel: '待送養',
    dutyItemId: oneOff.id, minutesPerAnimal: 45
  });
  db.upsertStatusDutyMapping({
    categoryCode: 'weight', optionCode: 'low', optionLabel: '體重偏低',
    dutyItemId: noClock.id, minutesPerAnimal: 25
  });

  plan = db.planShiftsForRange(today, 1);
  summary = db.getStatusSupplementSummary();
  const before = catShift.status.extraPeople;
  catShift = shiftOf(plan, cats.id);

  check(catShift.status.extraPeople === before,
    '讀不到的勤務不會憑空加人到別的班次', `實際 ${catShift.status.extraPeople}，先前 ${before}`);
  check(summary.offRosterMinutes === 45 + 25,
    '那 70 分鐘被記在「排班讀不到」而不是消失', `實際 ${summary.offRosterMinutes}`);
  check(summary.offRoster.some(o => o.dutyItemId === oneOff.id && o.reason.includes('每日')),
    '一次性勤務有說明是哪一種讀不到');
  check(summary.offRoster.some(o => o.dutyItemId === noClock.id && o.reason.includes('起訖時間')),
    '沒填時間的勤務也有它自己的說明');
  check(summary.rosterMinutes + summary.offRosterMinutes === summary.totalMinutes,
    '兩邊加起來等於總數 —— 沒有分鐘掉在中間');

  // 停用一個勤務，理由要跟著換
  db.setDutyItemStatus(noClock.id, 'disabled');
  summary = db.getStatusSupplementSummary();
  check(summary.offRoster.some(o => o.dutyItemId === noClock.id && o.reason.includes('停用')),
    '勤務停用之後，理由從「沒填時間」換成「已停用」');

  // -------------------------------------------------- applying it is opt-in
  console.log('\n要不要算進草稿，是一個要按下去的決定');

  plan = db.planShiftsForRange(today, 1);
  catShift = shiftOf(plan, cats.id);
  const expected = catShift.requiredCount + catShift.status.extraPeople;

  const plain = db.generateDraftShifts(today, 1);
  let drafted = db.getAllShifts().find(sh => sh.zone === cats.id && sh.date === today);
  check(plain.supplementedPeople === 0, '預設不套用，回報也說 0');
  check(drafted?.requiredCount === catShift.requiredCount,
    '預設產生的草稿人數就是基準人數', `實際 ${drafted?.requiredCount}，預期 ${catShift.requiredCount}`);

  db.discardDraftShifts(today, today);
  const applied = db.generateDraftShifts(today, 1, { includeStatusSupplement: true });
  drafted = db.getAllShifts().find(sh => sh.zone === cats.id && sh.date === today);

  check(applied.supplementedPeople > 0, '明確要求時才加', `實際 ${applied.supplementedPeople}`);
  check(drafted?.requiredCount === expected,
    '加進去之後的人數 = 基準 + 動物狀態', `實際 ${drafted?.requiredCount}，預期 ${expected}`);
  check(/依近期動物狀態加計/.test(drafted?.description || ''),
    '草稿自己說得出多的人是哪來的 —— 一週後看到它的人不必用猜的');

  // ------------------------------------------------------------ weekday still wins
  console.log('\n星期幾的限制仍然管用');

  const weekend = db.createZone({ name: '假日送養場', code: 'FRI', palette: 'sky', icon: '🏠', description: '' });
  const weekdayOfToday = new Date(`${today}T00:00:00+08:00`).getDay();
  const notToday = String((weekdayOfToday + 3) % 7);
  const seasonal = duty({
    zoneId: weekend.id, title: '送養日照護', startTime: '10:00', endTime: '12:00', weekdays: notToday
  });
  db.recordStatusBatch(batch(4, [seen('f1', 'adoption', 'ready', '可送養')]));
  db.upsertStatusDutyMapping({
    categoryCode: 'adoption', optionCode: 'ready', optionLabel: '可送養',
    dutyItemId: seasonal.id, minutesPerAnimal: 200
  });

  const todayOnly = db.planShiftsForRange(today, 1);
  check(!todayOnly.some(p => p.zoneId === weekend.id),
    '今天不是那個星期幾，就不會排出班次，那些分鐘也無處可加');

  const fortnight = db.planShiftsForRange(today, 14);
  const onItsDay = fortnight.filter(p => p.zoneId === weekend.id);
  check(onItsDay.length === 2, '兩週裡它只出現在自己的那兩天', `實際 ${onItsDay.length}`);
  check(onItsDay.every(p => p.status.extraPeople === 2),
    '出現的那幾天才加人（200 分鐘 ÷ 每人 120 = 2）',
    `實際 ${onItsDay.map(p => p.status.extraPeople).join(',')}`);

  console.log(`\n${'='.repeat(52)}\n${fail === 0 ? '全部通過' : '有失敗'}：${pass}/${pass + fail}\n`);
}

/**
 * Best-effort, and after the error is printed.
 *
 * Windows will not remove a folder whose SQLite file is still open, and this
 * process never closes the connection -- it exits instead. Cleaning up before
 * printing would let an EPERM here replace whatever the test actually failed
 * on, and the run would report the wrong problem.
 */
function cleanup() {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    console.log(`（暫存資料庫留在 ${scratch}，Windows 還鎖著它，可以不管）`);
  }
}

main()
  .then(() => {
    cleanup();
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(error => {
    console.error(error);
    cleanup();
    process.exit(1);
  });
