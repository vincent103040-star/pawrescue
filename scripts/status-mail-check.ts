// Connects to the status mailbox and reports what is sitting in it.
//
//   npm run mail:check
//
// Read-only on purpose: it stores nothing and marks nothing as read, so it can
// be run as often as you like and the same messages keep showing up. Its job is
// to answer "is the credential right, and is the other side sending what we
// agreed?" before anything depends on the answer.
import '../env';
import { readMailConfig, withMailbox } from './status-mail';
import { parseStatusCsv } from './status-csv';

const line = () => console.log('-'.repeat(56));

/**
 * Turns an IMAP failure into something actionable.
 *
 * The library's own messages are accurate and useless -- "Invalid credentials
 * (Failure)" does not say which of the two fields to go and look at.
 */
function explain(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const text = raw.toUpperCase();

  if (text.includes('AUTHENTICATIONFAILED') || text.includes('INVALID CREDENTIALS')) {
    return '帳號或應用程式密碼不對。請確認 .env.local 裡的 STATUS_MAIL_USER 是完整地址' +
      '（含 @gmail.com），STATUS_MAIL_APP_PASSWORD 是那組 16 碼、不是帳號本身的密碼。';
  }
  if (text.includes('ENOTFOUND') || text.includes('EAI_AGAIN')) {
    return '找不到郵件主機。請確認 STATUS_MAIL_HOST 拼字正確，以及這台電腦連得上網路。';
  }
  if (text.includes('ECONNREFUSED')) {
    return '連不上郵件主機。可能是網路或防火牆擋住了 993 連接埠。';
  }
  // The connection was accepted and then went quiet. On this project that has
  // meant antivirus mail scanning sitting in the middle: it terminates the TLS
  // connection itself, so the handshake succeeds, and whatever it does upstream
  // never comes back.
  if (text.includes('TIMEOUT') || text.includes('ETIMEDOUT')) {
    return '連上了，但對方沒有回應（逾時）。\n' +
      '   最後印出的那一行「·」就是卡住的階段。\n' +
      '   如果卡在「連線到…」或「登入成功…」，通常是防毒軟體的郵件防護還開著 —— ' +
      '它會接下這條連線，但後面接不回真正的郵件主機。';
  }
  // Node ships its own CA list rather than using the operating system's. On a
  // network that re-signs TLS -- antivirus HTTPS scanning, a school or company
  // proxy -- the certificate Node is shown was issued by that intermediary,
  // whose CA is in the Windows store and not in Node's. Hence --use-system-ca
  // in the npm script; this branch is for anyone running the file directly.
  if (text.includes('UNABLE_TO_VERIFY_LEAF_SIGNATURE') ||
      text.includes('UNABLE TO VERIFY THE FIRST CERTIFICATE') ||
      text.includes('SELF_SIGNED_CERT_IN_CHAIN') ||
      text.includes('SELF-SIGNED CERTIFICATE IN CERTIFICATE CHAIN')) {
    return '驗不過郵件主機的憑證。請用 `npm run mail:check` 執行（它帶了 --use-system-ca，' +
      '會改用 Windows 的憑證清單）。\n' +
      '   會發生這件事，通常代表防毒軟體或所在網路在中間拆解 HTTPS 再重新簽章。';
  }
  return raw;
}

async function main() {
  const { config, errors, warnings } = readMailConfig();

  for (const warning of warnings) console.log(`  ⚠  ${warning}`);
  if (!config) {
    console.log('\n無法連線，設定還缺東西：');
    for (const error of errors) console.log(`  ✗  ${error}`);
    console.log('\n請把缺的項目填進 .env.local 之後再執行一次。\n');
    process.exit(1);
  }

  // The address is printed because it is the setting most likely to be wrong
  // and it is not a secret. The password is never printed, not even its length.
  console.log(`\n信箱：${config.user}`);

  const { batches, skipped } = await withMailbox(
    config,
    session => session.fetchUnread(),
    step => console.log(`  · ${step}`)
  );

  line();
  console.log(`連線成功。未讀郵件 ${batches.length + skipped.length} 封，` +
    `其中 ${batches.length} 封是狀態批次。\n`);

  // Summarised rather than listed. A real mailbox is mostly other people's
  // notifications, and one line each for twenty of them buries the one message
  // this tool exists to show. A few subjects are still printed: if a genuine
  // batch is being passed over, this is where it would show up.
  if (skipped.length > 0) {
    const byReason = new Map<string, string[]>();
    for (const message of skipped) {
      const list = byReason.get(message.reason) || [];
      list.push(message.subject || '(沒有主旨)');
      byReason.set(message.reason, list);
    }
    for (const [reason, subjects] of byReason) {
      console.log(`略過 ${subjects.length} 封（${reason}）`);
      for (const subject of subjects.slice(0, 3)) console.log(`  · ${subject}`);
      if (subjects.length > 3) console.log(`  · …另外 ${subjects.length - 3} 封`);
    }
    console.log('');
  }

  if (batches.length === 0) {
    console.log('沒有讀到任何狀態批次。寄一封主旨符合格式的測試信過來，再執行一次。\n');
    console.log('主旨格式：[StrayHub] 動物狀態 #1 2026-08-31T00:00+08:00 ~ 2026-08-31T06:00+08:00\n');
    return;
  }

  for (const batch of batches) {
    console.log(`【UID ${batch.uid}】${batch.subject || '(沒有主旨)'}`);
    console.log(`  寄件者：${batch.from || '(讀不到)'}`);
    console.log(`  收信時間：${batch.receivedAt || '(讀不到)'}`);

    if (batch.header) {
      console.log(`  批次 #${batch.header.sequence}：${batch.header.periodStart} ~ ${batch.header.periodEnd}`);
    }

    for (const attachment of batch.attachments) {
      const { rows, errors: rowErrors } = parseStatusCsv(attachment.text);
      console.log(`  附件「${attachment.filename}」：讀到 ${rows.length} 筆狀態`);
      // Enough to see the columns landed in the right places, not enough to
      // fill the terminal with animal records.
      if (rows.length > 0) {
        const first = rows[0];
        console.log(`    例：${first.shelterCode} / ${first.animalName || first.animalId} / ` +
          `${first.optionLabel || first.optionCode} @ ${first.observedAt}`);
      }
      for (const error of rowErrors) console.log(`    ✗  ${error}`);
    }

    for (const warning of batch.warnings) console.log(`  ⚠  ${warning}`);
    console.log('');
  }

  line();
  console.log('這支程式沒有存任何東西，也沒有把郵件標示為已讀 —— 可以重複執行。\n');
}

main().catch(error => {
  console.log(`\n✗  ${explain(error)}\n`);
  process.exit(1);
});
