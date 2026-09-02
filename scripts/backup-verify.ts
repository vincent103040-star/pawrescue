// 異地備份真的還原得回來嗎？
//
//   npm run check:backup                    抓最新的異地備份來驗
//   npm run check:backup -- --local <file>  驗一個本地的 .db（不碰網路）
//
// 沒有還原過的備份不算備份。備份最惡劣的失效方式不是備份失敗 —— 那會有錯誤訊息
// ——而是備份每天都成功，檔案每天都在，然後需要用的那天才發現它是空的、截斷的、
// 或根本不是資料庫。中間那段時間，備份看起來一直是好的。
//
// 所以這支腳本問的不是「檔案在不在」，是一連串會被真正的損壞絆倒的問題：雜湊對
// 不對、SQLite 自己認不認、資料表在不在、筆數跟當初寫下的一不一樣、以及最後能不
// 能真的讀出一筆資料。每一項都可能單獨失敗，而只檢查前一項的話後面那些都看不見。
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import fs from 'fs';
import path from 'path';

const BUCKET = (process.env.BACKUP_BUCKET || '').replace(/\/+$/, '');
const localFlag = process.argv.indexOf('--local');
const LOCAL_FILE = localFlag !== -1 ? process.argv[localFlag + 1] : null;

/** 一個空資料庫也能通過所有結構檢查，所以這些表必須真的有資料。 */
const MUST_HAVE_ROWS = ['volunteers', 'shifts'];

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`); }
};

const scratch = mkdtempSync(path.join(tmpdir(), 'pawrescue-restore-'));

/** 從 bucket 抓最新的一份快照與它的 manifest。 */
function fetchNewest(): { db: string; manifest: any | null } {
  const listing = execFileSync('gcloud', ['storage', 'ls', `${BUCKET}/db/`], { encoding: 'utf8' });

  // 檔名帶 ISO 時間戳，所以字串排序就是時間排序。
  const dbs = listing.split('\n').map(s => s.trim())
    .filter(s => s.endsWith('.db')).sort();
  if (dbs.length === 0) throw new Error(`${BUCKET}/db/ 裡沒有任何 .db`);

  const newest = dbs[dbs.length - 1];
  const stamp = path.basename(newest).replace(/^volunteers-|\.db$/g, '');
  console.log(`  最新備份：${path.basename(newest)}`);

  const dbLocal = path.join(scratch, 'restored.db');
  execFileSync('gcloud', ['storage', 'cp', newest, dbLocal], { stdio: 'pipe' });

  let manifest: any = null;
  try {
    const mLocal = path.join(scratch, 'manifest.json');
    execFileSync('gcloud', ['storage', 'cp', `${BUCKET}/db/manifest-${stamp}.json`, mLocal], { stdio: 'pipe' });
    manifest = JSON.parse(fs.readFileSync(mLocal, 'utf8'));
  } catch {
    // manifest 掉了不是致命傷 —— 少了它就少了對照組，其餘檢查照跑。
  }
  return { db: dbLocal, manifest };
}

function main(): number {
  console.log('\n備份還原演練');
  console.log('='.repeat(60));

  let dbFile: string;
  let manifest: any = null;

  if (LOCAL_FILE) {
    if (!fs.existsSync(LOCAL_FILE)) {
      console.error(`\n找不到 ${LOCAL_FILE}\n`);
      return 1;
    }
    dbFile = LOCAL_FILE;
    console.log(`  本地檔案：${LOCAL_FILE}`);
    const sidecar = path.join(
      path.dirname(LOCAL_FILE),
      `manifest-${path.basename(LOCAL_FILE).replace(/^volunteers-|\.db$/g, '')}.json`
    );
    if (fs.existsSync(sidecar)) manifest = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  } else {
    if (!BUCKET) {
      console.error('\n沒有設定 BACKUP_BUCKET。\n  BACKUP_BUCKET=gs://... npm run check:backup');
      console.error('  或用 npm run check:backup -- --local data/backups/volunteers-XXXX.db\n');
      return 1;
    }
    console.log(`  來源：${BUCKET}/db/`);
    const got = fetchNewest();
    dbFile = got.db;
    manifest = got.manifest;
  }

  console.log(`  manifest：${manifest ? '有' : '沒有（少了對照組，仍會做結構與內容檢查）'}`);

  // ------------------------------------------------------------ 檔案本身
  console.log('\n檔案完好');

  const bytes = fs.statSync(dbFile).size;
  check(bytes > 0, `檔案不是空的（${(bytes / 1024).toFixed(0)} KB）`);

  const digest = createHash('sha256').update(fs.readFileSync(dbFile)).digest('hex');
  if (manifest?.snapshot?.sha256) {
    check(
      digest === manifest.snapshot.sha256,
      '雜湊與 manifest 相符 —— 傳輸過程沒有損壞',
      `manifest ${manifest.snapshot.sha256.slice(0, 16)}... / 實際 ${digest.slice(0, 16)}...`
    );
  }

  const header = fs.readFileSync(dbFile).subarray(0, 15).toString();
  check(header === 'SQLite format 3', '確實是 SQLite 檔案，不是錯誤頁或半截的下載');

  // ------------------------------------------------------------ SQLite 自己怎麼說
  console.log('\nSQLite 認得它');

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbFile);
  } catch (e: any) {
    check(false, '資料庫打得開', e.message);
    return report();
  }
  check(true, '資料庫打得開');

  // 損壞的資料庫在這裡是「丟例外」，不是回報 not ok。當成一項 FAIL 處理而不是
  // 讓它炸掉整支腳本：一個用來驗證備份的工具，遇到真正損壞的備份就自己倒下的
  // 話，看到的人分不清是備份壞了還是工具壞了 —— 而那正是最需要看清楚的時刻。
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get() as any;
    const verdict = integrity?.integrity_check ?? Object.values(integrity || {})[0];
    check(verdict === 'ok', `PRAGMA integrity_check 通過（回報「${verdict}」）`);
  } catch (e: any) {
    check(false, 'PRAGMA integrity_check 通過', e.message);
  }

  // ------------------------------------------------------------ 裡面有東西
  console.log('\n裡面真的有資料');

  let tables: string[] = [];
  try {
    tables = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    ).all() as Array<{ name: string }>).map(r => r.name);
    check(tables.length > 0, `有 ${tables.length} 個資料表`);
  } catch (e: any) {
    check(false, '讀得出資料表清單', e.message);
  }

  const counts: Record<string, number> = {};
  for (const name of tables) {
    try {
      counts[name] = (db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get() as { c: number }).c;
    } catch {
      // 這張表讀不出來。不在這裡報，下面的必要資料表與 manifest 比對會顯示出來。
    }
  }

  // 結構完整但全空的資料庫，大小和雜湊都很正常 —— 只有筆數看得出來。
  for (const name of MUST_HAVE_ROWS) {
    check(
      (counts[name] ?? 0) > 0,
      `${name} 有資料（${counts[name] ?? 0} 筆）`,
      '資料表在但沒有資料 —— 備份到的可能是一個剛建好的空資料庫'
    );
  }

  if (manifest?.rowCounts) {
    const drifted = Object.entries(manifest.rowCounts as Record<string, number>)
      .filter(([t, n]) => counts[t] !== n)
      .map(([t, n]) => `${t}: manifest ${n} / 實際 ${counts[t] ?? '不存在'}`);
    check(
      drifted.length === 0,
      '每個資料表的筆數都與 manifest 相符',
      drifted.join('；')
    );
  }

  // 前面幾項都只碰 metadata。這一項真的讀出一列資料 —— 一個索引壞掉、或
  // 分頁損壞的資料庫，可以通過上面全部檢查，然後在這裡才倒下。
  try {
    const row = db.prepare('SELECT name, email FROM volunteers LIMIT 1').get() as any;
    check(!!row?.email, '真的讀得出一筆志工資料', '查詢成功但沒有回傳資料列');
  } catch (e: any) {
    check(false, '真的讀得出一筆志工資料', e.message);
  }

  db.close();
  return report();
}

/** 不論是走完全部檢查還是中途放棄，結尾都長一樣。 */
function report(): number {
  console.log(`\n${'='.repeat(60)}`);
  if (fail === 0) {
    console.log(`全部通過：${pass}/${pass} —— 這份備份還原得回來。`);
  } else {
    console.log(`有失敗：${pass}/${pass + fail} —— 在需要用到它之前先弄清楚。`);
  }
  console.log();
  return fail === 0 ? 0 : 1;
}

/**
 * 跟 asset-url.test.ts 同樣的理由：Windows 不會刪掉還開著 SQLite 檔案的資料夾，
 * 而這支程式從不關掉行程就結束。清理失敗不可以取代這次執行要回報的結果。
 */
function cleanup() {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    console.log(`（暫存目錄留在 ${scratch}，可以不管）`);
  }
}

let code = 1;
try {
  code = main();
} catch (err: any) {
  console.error(`\n✗ ${err.message}\n`);
} finally {
  cleanup();
}
process.exit(code);
