// Does storing a batch keep the two promises the pipeline is built on?
//
//   npm run check:status-db
//
//   1. The same batch delivered twice is stored once.
//   2. "This animal's latest status" is the latest one in real time.
//
// Runs against a throwaway database in the system temp folder, created fresh
// each run and never the shelter's. That is what DATA_DIR is for, and why the
// import below is dynamic: db.ts reads the path as it loads, and a static
// import would be evaluated before the line that sets it.
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findMissingSequences } from './status-csv';

const scratch = mkdtempSync(join(tmpdir(), 'pawrescue-status-test-'));
process.env.DATA_DIR = scratch;

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`); }
};

const batch = (sequence: number, rows: any[]) => ({
  sequence,
  periodStart: '2026-08-31T00:00+08:00',
  periodEnd: '2026-08-31T06:00+08:00',
  mailUid: 100 + sequence,
  subject: `[StrayHub] 動物狀態 #${sequence}`,
  sender: 'noreply@strayhub.example',
  sentAt: '2026-08-31T06:05:00.000Z',
  skippedCount: 0,
  rows
});

const observation = (over: Partial<Record<string, string>> = {}) => ({
  shelterCode: 'xindian',
  animalId: 'a1b2c3',
  shelterNumber: 'A-114-032',
  animalName: '小黑',
  observedAt: '2026-08-31T09:15:00+08:00',
  categoryCode: 'excretion',
  optionCode: 'normal',
  optionLabel: '便便正常',
  ...over
});

async function main() {
  const db = await import('../db');

  // ------------------------------------------------------------- storing
  console.log('\n收下一個批次');

  const first = db.recordStatusBatch(batch(140, [
    observation(),
    observation({ animalId: 'd4e5f6', animalName: '豆花', optionCode: 'loose', optionLabel: '便便較軟' })
  ]));
  check(!('error' in first), '第一次匯入成功', 'error' in first ? first.error : '');

  const batchId = 'error' in first ? '' : first.batchId;
  const stored = db.getStatusRecordsForBatch(batchId);
  check(stored.length === 2, '兩筆觀察都存進去了', `實際 ${stored.length}`);
  check(stored.some(r => r.animalName === '小黑' && r.optionLabel === '便便正常'),
    '欄位存到正確的位置');

  const recorded = db.getStatusBatchBySequence(140);
  check(recorded?.recordCount === stored.length,
    '批次上記的筆數，跟實際存下來的筆數一致',
    `批次說 ${recorded?.recordCount}，實際 ${stored.length}`);

  // The failure this prevents is invisible: email redelivers, the batch is
  // imported again, and every animal in that period counts twice. Nothing
  // errors, the roster is just wrong.
  console.log('\n同一批送兩次');

  const again = db.recordStatusBatch(batch(140, [observation()]));
  check('error' in again, '重複的批次序號被拒絕', JSON.stringify(again));
  check('error' in again && again.error.includes('140'), '而且說得出是哪一批',
    'error' in again ? again.error : '');
  check(db.getStatusRecordsForBatch(batchId).length === 2,
    '被拒絕之後，原本的資料沒有被動到');

  console.log('\n掉批次看得出來');

  db.recordStatusBatch(batch(143, [observation({ animalId: 'g7h8i9', animalName: '阿財' })]));
  const seen = db.getImportedBatchSequences();
  check(JSON.stringify(seen) === JSON.stringify([140, 143]),
    '存過的序號讀得回來', JSON.stringify(seen));
  check(JSON.stringify(findMissingSequences(seen, 145)) === JSON.stringify([144]),
    '接上掉信偵測後，指得出漏了哪一批',
    JSON.stringify(findMissingSequences(seen, 145)));

  // --------------------------------------------------------------- latest
  //
  // Timestamps arrive as text and may carry any offset. Compared as text --
  // which is what MAX() does -- "2026-08-31T13:00:00Z" sorts BEFORE
  // "2026-08-31T20:00:00+08:00" because "1" precedes "2", while in real time it
  // is an hour later. So the naive version picks the older reading and calls it
  // current, silently, forever.
  console.log('\n哪一筆才是「最新」');

  db.recordStatusBatch(batch(144, [
    observation({ animalId: 'zz9', animalName: '花花', observedAt: '2026-08-31T20:00:00+08:00', optionCode: 'early', optionLabel: '較早的' }),
    observation({ animalId: 'zz9', animalName: '花花', observedAt: '2026-08-31T13:00:00Z', optionCode: 'later', optionLabel: '較晚的' })
  ]));

  const latest = db.getLatestAnimalStatuses().filter(r => r.animalId === 'zz9');
  check(latest.length === 1, '同一隻動物、同一個類別只留一筆', `實際 ${latest.length}`);
  check(latest[0]?.optionCode === 'later',
    '而且是真正時間較晚的那筆（+08:00 與 Z 混用也判斷得對）',
    `讀到的是「${latest[0]?.optionLabel}」，observedAt=${latest[0]?.observedAt}`);

  // -------------------------------------------------------------- mapping
  console.log('\n狀態→勤務對照表');

  const unmappedBefore = db.getUnmappedStatuses();
  check(unmappedBefore.some(s => s.optionCode === 'normal'),
    '有觀察到但還沒設規則的狀態，會被列出來',
    JSON.stringify(unmappedBefore.map(s => s.optionCode)));

  const created = db.upsertStatusDutyMapping({
    categoryCode: 'excretion', optionCode: 'normal', optionLabel: '便便正常',
    dutyItemId: 'duty-test', minutesPerAnimal: 5
  });
  check(created.minutesPerAnimal === 5, '規則建立成功');

  const edited = db.upsertStatusDutyMapping({
    categoryCode: 'excretion', optionCode: 'normal', optionLabel: '便便正常',
    dutyItemId: 'duty-test', minutesPerAnimal: 8
  });
  check(edited.id === created.id, '同一條規則再設一次是「修改」，不是新增一筆',
    `${created.id} vs ${edited.id}`);
  check(edited.minutesPerAnimal === 8, '而且分鐘數真的改了', String(edited.minutesPerAnimal));
  check(db.getAllStatusDutyMappings().length === 1, '表裡只有一條規則',
    String(db.getAllStatusDutyMappings().length));

  check(!db.getUnmappedStatuses().some(s => s.optionCode === 'normal'),
    '設好規則之後就不再列為未設定');

  // Disabled rules stop counting but stay readable, so a past roster's numbers
  // can still be explained. Which means the status becomes unanswered again --
  // and that has to be visible, not silently worth zero minutes.
  db.setStatusDutyMappingStatus(created.id, 'disabled');
  check(db.getUnmappedStatuses().some(s => s.optionCode === 'normal'),
    '規則停用後，那個狀態重新變回「未設定」');
  check(db.getAllStatusDutyMappings().length === 1, '停用不是刪除，規則還在');
  check(db.getActiveStatusDutyMappings().length === 0, '但不再列入生效中的規則');

  console.log(`\n${'='.repeat(52)}\n${fail === 0 ? '全部通過' : '有失敗'}：${pass}/${pass + fail}\n`);
}

/**
 * Best-effort, and after the error is printed.
 *
 * Windows will not remove a folder whose SQLite file is still open, and this
 * process never closes the connection -- it exits instead. The first version
 * cleaned up before printing, so an EPERM here replaced whatever the test had
 * actually failed on, and the run reported the wrong problem. A leftover folder
 * in the system temp directory costs nothing; a hidden failure costs the run.
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
