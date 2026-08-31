// Reads the status batches out of the mailbox and stores them.
//
//   npm run status:ingest -- --dry-run   # read and report, write nothing
//   npm run status:ingest                # store, and mark those mails read
//
// This is the piece that runs on a schedule. `mail:check` answers "can we
// connect"; this one is the actual job, and the difference between them is that
// this one changes things -- so the order it changes them in is the design.
//
// A batch is stored, and only then is its mail marked read. Marking first would
// mean a crash one line later loses that batch permanently, and worse, loses it
// invisibly: the sequence number would never be recorded, so the gap check
// would not see it missing either. Nothing is ever deleted, so a batch stored
// wrongly can always be read again from the mail itself.
import '../env';
import { readMailConfig, withMailbox } from './status-mail';
import { parseStatusCsv, findMissingSequences } from './status-csv';
import {
  recordStatusBatch,
  getImportedBatchSequences,
  getUnmappedStatuses
} from '../db';

const dryRun = process.argv.includes('--dry-run');
const line = () => console.log('-'.repeat(56));

async function main() {
  const { config, errors, warnings } = readMailConfig();
  for (const warning of warnings) console.log(`  ⚠  ${warning}`);
  if (!config) {
    for (const error of errors) console.log(`  ✗  ${error}`);
    process.exit(1);
  }

  if (dryRun) console.log('\n【試跑】不會寫入資料庫，也不會把郵件標示為已讀');
  console.log(`\n信箱：${config.user}`);

  let stored = 0;
  let storedRows = 0;
  const problems: string[] = [];

  await withMailbox(config, async session => {
    const { batches, skipped } = await session.fetchUnread();

    line();
    console.log(`未讀 ${batches.length + skipped.length} 封，其中 ${batches.length} 封是狀態批次。\n`);

    for (const batch of batches) {
      const label = `批次 #${batch.header?.sequence ?? '?'}`;
      console.log(`${label}（UID ${batch.uid}）`);
      for (const warning of batch.warnings) console.log(`  ⚠  ${warning}`);

      if (!batch.header) {
        problems.push(`${label}：讀不出序號，未匯入`);
        continue;
      }

      // Every CSV attached belongs to this batch. More than one is unlikely,
      // but taking only the first would drop data with nothing to show for it.
      const rows = [];
      let skippedRows = 0;
      for (const attachment of batch.attachments) {
        const parsed = parseStatusCsv(attachment.text);
        rows.push(...parsed.rows);
        skippedRows += parsed.errors.length;
        console.log(`  附件「${attachment.filename}」：${parsed.rows.length} 筆`);
        for (const error of parsed.errors) console.log(`    ✗  ${error}`);
      }

      // Nothing usable is left unread on purpose. A batch where every row
      // failed is a format problem, not a delivery problem, and once it is
      // fixed the mail should still be there to read again. Recording it would
      // also mark that sequence as received, so the gap check would stop
      // pointing at the one batch nobody has.
      if (rows.length === 0) {
        problems.push(`${label}：沒有任何一筆讀得進來，保留未讀`);
        console.log('  ✗  沒有可用的資料，這封信保持未讀\n');
        continue;
      }

      if (dryRun) {
        console.log(`  （試跑）會存入 ${rows.length} 筆\n`);
        continue;
      }

      const result = recordStatusBatch({
        sequence: batch.header.sequence,
        periodStart: batch.header.periodStart,
        periodEnd: batch.header.periodEnd,
        mailUid: batch.uid,
        subject: batch.subject,
        sender: batch.from,
        sentAt: batch.receivedAt,
        skippedCount: skippedRows,
        rows
      });

      if ('error' in result) {
        // A repeat delivery is a normal event, not a fault. Mark it read so it
        // stops coming round; the data from the first delivery is already in.
        console.log(`  ·  ${result.error}，標示已讀\n`);
        await session.markSeen(batch.uid);
        continue;
      }

      // Stored first, marked second. See the note at the top of this file.
      await session.markSeen(batch.uid);
      stored++;
      storedRows += result.recorded;
      console.log(`  ✓  存入 ${result.recorded} 筆，已標示已讀\n`);
    }

    if (skipped.length > 0) console.log(`（另外略過 ${skipped.length} 封非批次郵件）\n`);
  });

  // ------------------------------------------------------------- reporting
  line();
  console.log(dryRun
    ? '試跑結束，沒有寫入任何東西。'
    : `匯入 ${stored} 個批次，共 ${storedRows} 筆狀態。`);

  const sequences = getImportedBatchSequences();
  if (sequences.length > 0) {
    const highest = sequences[sequences.length - 1];
    const gaps = findMissingSequences(sequences.slice(0, -1), highest);
    if (gaps.length > 0) {
      console.log(`\n⚠  中間有沒收到的批次：#${gaps.join('、#')}`);
      console.log('   對方那邊還留著，可以請他們重寄。');
    }
  }

  for (const problem of problems) console.log(`\n⚠  ${problem}`);

  // The shelter cannot act on a status nobody has priced. Reported every run
  // rather than once, because an unmapped status contributes zero minutes to
  // the roster -- which is the right answer to an unanswered question, but only
  // while the question is still being asked.
  const unmapped = getUnmappedStatuses();
  if (unmapped.length > 0) {
    console.log(`\n還沒設定勤務對照的狀態（${unmapped.length} 種）：`);
    for (const status of unmapped.slice(0, 10)) {
      console.log(`  · ${status.optionLabel || status.optionCode}` +
        `（${status.categoryCode}/${status.optionCode}）—— ${status.animalCount} 隻動物`);
    }
    if (unmapped.length > 10) console.log(`  · …另外 ${unmapped.length - 10} 種`);
    console.log('\n這些狀態目前算 0 分鐘工時，設定對照表之後才會納入排班計算。');
  }

  console.log('');
}

main().catch(error => {
  console.error(`\n✗  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
