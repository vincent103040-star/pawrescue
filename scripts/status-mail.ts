// Fetching the animal-status batches out of the mailbox they are sent to.
//
// This half owns the transport; `status-csv.ts` owns what the file says. Kept
// apart because the CSV parser can be tested against text alone, with no
// mailbox, no credential and no network -- and most of what can go wrong is in
// the text.
//
// Three rules this module does not bend:
//
//   1. It never deletes anything. The email is the only evidence of what the
//      other system actually sent; if our parsing turns out to be wrong we have
//      to be able to go back and read it again.
//   2. It marks a message read only when the caller says the contents are
//      safely stored. Marking on arrival would mean a crash one line later
//      loses that batch for good, with nothing left to show a batch went
//      missing.
//   3. It reports rather than guesses. A message it cannot use is described,
//      not silently skipped.

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { parseBatchSubject, type BatchHeader } from './status-csv';

export interface MailConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  mailbox: string;
  /**
   * When set, batches from any other address are refused.
   *
   * This guards against accidents -- a stray newsletter, a test sent from the
   * wrong account -- not against an attacker. A From header is trivial to
   * forge, so it must not be treated as authentication. Real assurance would
   * mean checking the DKIM signature, which is worth doing if this mailbox ever
   * carries anything that matters.
   */
  allowedSender: string;
}

export interface MailConfigResult {
  config: MailConfig | null;
  /** Reasons it cannot run at all. */
  errors: string[];
  /** Things worth knowing that are not fatal. */
  warnings: string[];
}

export interface MailAttachment {
  filename: string;
  text: string;
}

export interface FetchedBatch {
  /** IMAP UID -- stable across connections, unlike the sequence number. */
  uid: number;
  subject: string;
  from: string;
  receivedAt: string;
  /** Null when the subject is not in the agreed format. */
  header: BatchHeader | null;
  attachments: MailAttachment[];
  warnings: string[];
}

/** Reads the mailbox settings out of the environment, saying what is missing. */
export function readMailConfig(env: NodeJS.ProcessEnv = process.env): MailConfigResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const user = (env.STATUS_MAIL_USER || '').trim();
  // Google shows the app password in four groups of four, so pasting it with
  // the spaces is the natural thing to do. Accept it either way rather than
  // failing with "authentication failed" and no hint as to why.
  const password = (env.STATUS_MAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  const host = (env.STATUS_MAIL_HOST || 'imap.gmail.com').trim();
  const mailbox = (env.STATUS_MAIL_MAILBOX || 'INBOX').trim();
  const allowedSender = (env.STATUS_MAIL_ALLOWED_SENDER || '').trim();

  const portRaw = (env.STATUS_MAIL_PORT || '993').trim();
  const port = Number(portRaw);

  if (!user) errors.push('缺少 STATUS_MAIL_USER（收信的信箱地址）');
  if (!password) errors.push('缺少 STATUS_MAIL_APP_PASSWORD（Google 應用程式密碼）');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    errors.push(`STATUS_MAIL_PORT 不是有效的連接埠：${portRaw}`);
  }

  if (password && password.length !== 16) {
    // Not fatal -- other mail providers exist -- but on Gmail a length other
    // than 16 almost always means the account's own password went in by
    // mistake, and that is worth catching before it goes over the wire.
    warnings.push(
      `STATUS_MAIL_APP_PASSWORD 是 ${password.length} 碼；Google 應用程式密碼是 16 碼，` +
      '請確認填的不是帳號本身的密碼'
    );
  }

  if (!allowedSender) {
    warnings.push(
      '沒有設定 STATUS_MAIL_ALLOWED_SENDER —— 任何人寄到這個信箱的 CSV 都會被讀進來。' +
      '確定寄件地址後請補上。'
    );
  }

  if (errors.length > 0) return { config: null, errors, warnings };
  return { config: { host, port, user, password, mailbox, allowedSender }, errors, warnings };
}

/**
 * Turns an attachment's bytes into text, flagging encodings we cannot read.
 *
 * The dangerous case is not a decode that fails -- it is one that succeeds into
 * nonsense. Text that is not UTF-8 still decodes, with every unreadable byte
 * becoming U+FFFD, so a Big5 file would parse cleanly with every Chinese animal
 * name replaced by garbage, and nothing downstream could tell. So the
 * replacement character is treated as a defect, not as content.
 */
export function decodeCsvAttachment(
  content: Buffer | Uint8Array,
  filename: string
): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  const text = new TextDecoder('utf-8').decode(content);

  if (text.includes('�')) {
    warnings.push(
      `附件「${filename}」不是 UTF-8 編碼，中文會變成亂碼。請寄件方改用 UTF-8 輸出 CSV。`
    );
  }
  if (text.trim() === '') {
    warnings.push(`附件「${filename}」是空的`);
  }

  return { text, warnings };
}

export interface MailSession {
  /** Unread messages in the mailbox. Marks nothing. */
  fetchUnread(limit?: number): Promise<FetchedBatch[]>;
  /** Call once the batch's contents are stored -- not before. */
  markSeen(uid: number): Promise<void>;
}

/** Opens the mailbox, runs `fn`, and closes it however `fn` ends. */
export async function withMailbox<T>(
  config: MailConfig,
  fn: (session: MailSession) => Promise<T>
): Promise<T> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.password },
    logger: false
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock(config.mailbox);
    try {
      return await fn(session(client, config));
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => { /* the work is already done */ });
  }
}

function session(client: ImapFlow, config: MailConfig): MailSession {
  return {
    async fetchUnread(limit = 50): Promise<FetchedBatch[]> {
      const batches: FetchedBatch[] = [];

      for await (const message of client.fetch({ seen: false }, { uid: true, source: true })) {
        if (batches.length >= limit) break;

        const parsed = await simpleParser(message.source);
        const uid = message.uid;
        const subject = parsed.subject || '';
        const from = parsed.from?.value?.[0]?.address || '';
        const receivedAt = parsed.date?.toISOString() || '';
        const warnings: string[] = [];

        // A refused sender is left unread on purpose. It will be reported again
        // on the next run, and it should be: an unexpected sender in a mailbox
        // meant to receive from exactly one place deserves to keep asking for
        // attention until a person looks at it.
        if (config.allowedSender && from.toLowerCase() !== config.allowedSender.toLowerCase()) {
          batches.push({
            uid, subject, from, receivedAt,
            header: null,
            attachments: [],
            warnings: [
              `寄件者是 ${from || '（讀不到）'}，不是設定的 ${config.allowedSender}，未讀取內容`
            ]
          });
          continue;
        }

        const attachments: MailAttachment[] = [];
        for (const attachment of parsed.attachments || []) {
          const filename = attachment.filename || '(無檔名)';
          if (!/\.csv$/i.test(filename)) continue;
          const decoded = decodeCsvAttachment(attachment.content, filename);
          warnings.push(...decoded.warnings);
          attachments.push({ filename, text: decoded.text });
        }

        const header = parseBatchSubject(subject);
        if (!header) warnings.push(`主旨讀不出批次序號：「${subject}」`);
        if (attachments.length === 0) warnings.push('這封信沒有 CSV 附件');

        batches.push({ uid, subject, from, receivedAt, header, attachments, warnings });
      }

      return batches;
    },

    async markSeen(uid: number): Promise<void> {
      // Adds the \Seen flag and nothing else. Never \Deleted -- see the note at
      // the top of this file.
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
    }
  };
}
