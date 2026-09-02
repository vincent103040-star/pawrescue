// 把備份送到這台機器以外的地方。
//
//   npm run backup:offsite            實際上傳
//   npm run backup:offsite -- --dry-run   只做本地的部分，不碰網路
//
// data/backups/ 已經有每日快照了，但它們跟正本躺在同一顆磁碟上。備份最常見的
// 失效方式不是沒有備份，是備份跟正本一起沒了 —— 機器故障、誤刪整個目錄、或是
// 有人拿到這台機器。所以這支腳本只做一件事：把已經正確產生的快照，複製到別的
// 地方去。
//
// ---------------------------------------------------------------------------
// 它刻意不做的事
//
// 不自己複製 data/volunteers.db。那個檔案開著 WAL，跑著的時候直接 cp 會拿到
// 不一致的快照，而且壞掉的備份跟好的長得一模一樣 —— 要等到還原那天才會發現。
// db.ts 的 backupDatabase() 用 VACUUM INTO 產生 data/backups/ 裡的快照，那是
// 執行中取用安全的做法，伺服器每次啟動和每天都會跑一次。這支腳本挑最新的那一
// 份來上傳，不自己再實作一次正確的事。
//
// 代價是備份的新鮮度取決於那個機制，所以下面會檢查快照的年齡，太舊就明講。
// ---------------------------------------------------------------------------
//
// 需要 BACKUP_BUCKET（例如 gs://pawrescue-backups）。VM 上的服務帳號需要對該
// bucket 有寫入權限；建議只給 roles/storage.objectCreator —— 能寫、不能讀、
// 不能刪，這樣萬一這台機器被入侵，歷史備份也拿不走、刪不掉。
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const CONFIGURED_BUCKET = (process.env.BACKUP_BUCKET || '').replace(/\/+$/, '');
// dry-run 沒設 bucket 時用佔位字串，否則印出來的目的地會是 "/db/..."，看起來
// 像個本機路徑而不是一個還沒設定的值。
const BUCKET = CONFIGURED_BUCKET || (DRY_RUN ? 'gs://YOUR-BUCKET' : '');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), 'data');

/** 快照超過這個時數就警告 —— 表示產生它的機制沒在跑。 */
const STALE_HOURS = 36;

/** 隨資料庫一起走的使用者上傳內容。這些重建不出來。 */
const MEDIA_DIRS = ['avatars', 'photos', 'sop-docs', 'sop-videos'];

const log = (msg = '') => console.log(msg);
const fail = (msg: string): never => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

/** data/backups/ 裡最新的一份，連同它的年齡。 */
function newestSnapshot(): { file: string; bytes: number; ageHours: number } {
  const dir = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(dir)) fail(`找不到 ${dir} —— 伺服器還沒產生過任何快照？`);

  // backupDatabase() 用 ISO 時間戳當檔名，所以字串排序就是時間排序。
  const names = fs.readdirSync(dir)
    .filter(n => n.startsWith('volunteers-') && n.endsWith('.db'))
    .sort();
  if (names.length === 0) fail(`${dir} 裡沒有 volunteers-*.db —— 伺服器還沒產生過快照。`);

  const file = path.join(dir, names[names.length - 1]);
  const stat = fs.statSync(file);
  return { file, bytes: stat.size, ageHours: (Date.now() - stat.mtimeMs) / 3_600_000 };
}

/**
 * 快照裡各資料表的筆數。
 *
 * 這是 manifest 最重要的部分：檔案大小和雜湊只能證明「檔案沒有損壞」，證明不了
 * 「裡面有東西」。一個結構完整但資料表全空的資料庫，大小和雜湊都很正常。
 */
function rowCounts(dbFile: string): Record<string, number> {
  const db = new DatabaseSync(dbFile);
  try {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all() as Array<{ name: string }>;

    const counts: Record<string, number> = {};
    for (const { name } of tables) {
      // 資料表名稱來自 sqlite_master，不是外部輸入。
      counts[name] = (db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get() as { c: number }).c;
    }
    return counts;
  } finally {
    db.close();
  }
}

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function run(cmd: string, args: string[]) {
  if (DRY_RUN) {
    log(`  [dry-run] ${cmd} ${args.join(' ')}`);
    return;
  }
  execFileSync(cmd, args, { stdio: 'inherit' });
}

function main() {
  log('異地備份');
  log('='.repeat(60));

  if (!CONFIGURED_BUCKET && !DRY_RUN) {
    fail('沒有設定 BACKUP_BUCKET。\n  例如：BACKUP_BUCKET=gs://pawrescue-backups npm run backup:offsite');
  }
  log(`  來源：${DATA_DIR}`);
  log(`  目的：${BUCKET}${CONFIGURED_BUCKET ? '' : '   ← 未設定 BACKUP_BUCKET，dry-run 用的佔位字串'}`);
  log();

  // ---------------------------------------------------------------- 快照
  const snap = newestSnapshot();
  log(`最新快照：${path.basename(snap.file)}`);
  log(`  大小 ${(snap.bytes / 1024).toFixed(0)} KB，產生於 ${snap.ageHours.toFixed(1)} 小時前`);

  if (snap.ageHours > STALE_HOURS) {
    log('');
    log(`  ⚠ 這份快照已經超過 ${STALE_HOURS} 小時。`);
    log('    伺服器每次啟動和每天都會產生一份，所以這通常表示服務停了、或是排程沒在跑。');
    log('    備份仍會上傳（舊的備份好過沒有備份），但請去看一下 pawrescue.service。');
  }

  const counts = rowCounts(snap.file);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  log(`  ${Object.keys(counts).length} 個資料表，共 ${total} 筆資料`);
  for (const key of ['volunteers', 'shifts', 'shift_signups', 'attendance_records']) {
    if (key in counts) log(`    ${key.padEnd(20)} ${counts[key]}`);
  }

  // ---------------------------------------------------------------- manifest
  //
  // 跟著備份一起走，因為還原的時候手上只有備份。沒有 manifest 的話，
  // 「這份檔案完整嗎」只能靠肉眼看大小合不合理。
  const stamp = path.basename(snap.file).replace(/^volunteers-|\.db$/g, '');
  const manifest = {
    createdAt: new Date().toISOString(),
    snapshot: {
      name: path.basename(snap.file),
      bytes: snap.bytes,
      sha256: sha256(snap.file),
      producedAtIso: new Date(fs.statSync(snap.file).mtimeMs).toISOString()
    },
    rowCounts: counts,
    mediaDirs: MEDIA_DIRS.filter(d => fs.existsSync(path.join(DATA_DIR, d)))
  };

  const backupDir = path.join(DATA_DIR, 'backups');
  const manifestFile = path.join(backupDir, `manifest-${stamp}.json`);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  log(`\nmanifest：${path.basename(manifestFile)}`);
  log(`  sha256 ${manifest.snapshot.sha256.slice(0, 16)}...`);

  // manifest 留在本地，因為 check:backup --local 會找它當對照組。但它得跟著
  // 它描述的那份快照一起活：backupDatabase() 只輪替 volunteers-*.db，沒有任何
  // 東西會回頭看 manifest，所以失去對象的那些會一天一個無限累積下去。
  const liveStamps = new Set(
    fs.readdirSync(backupDir)
      .filter(n => n.startsWith('volunteers-') && n.endsWith('.db'))
      .map(n => n.replace(/^volunteers-|\.db$/g, ''))
  );
  for (const name of fs.readdirSync(backupDir)) {
    const orphan = /^manifest-(.+)\.json$/.exec(name);
    if (orphan && !liveStamps.has(orphan[1])) {
      try {
        fs.unlinkSync(path.join(backupDir, name));
      } catch {
        /* 清不掉一個 manifest，不值得讓整次備份失敗 */
      }
    }
  }

  // ---------------------------------------------------------------- 上傳
  log('\n上傳');

  const dbDest = `${BUCKET}/db/volunteers-${stamp}.db`;
  const manifestDest = `${BUCKET}/db/manifest-${stamp}.json`;
  run('gcloud', ['storage', 'cp', snap.file, dbDest]);
  run('gcloud', ['storage', 'cp', manifestFile, manifestDest]);
  log(`  資料庫與 manifest -> ${BUCKET}/db/`);

  // 媒體用 rsync 而不是每天打包重傳。照片和頭像只會新增、不會被改寫，所以
  // 同步只送新的那些 —— 每天重傳整包會讓流量隨著服務時間線性成長，而內容
  // 其實幾乎沒變。這裡刻意不帶 --delete-unmatched-destination-objects：
  // 這邊刪掉的東西，異地那份應該留著。
  for (const dir of manifest.mediaDirs) {
    const src = path.join(DATA_DIR, dir);
    run('gcloud', ['storage', 'rsync', '--recursive', src, `${BUCKET}/media/${dir}`]);
    log(`  ${dir}/ -> ${BUCKET}/media/${dir}`);
  }

  log();
  log('='.repeat(60));
  if (DRY_RUN) {
    log('dry-run 完成 —— manifest 已在本地產生，沒有任何東西被上傳。');
  } else {
    log('完成。用 npm run check:backup 驗證這份備份真的還原得回來。');
  }
  log();
}

main();
