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

/** A message that was looked at and deliberately not opened. */
export interface SkippedMessage {
  uid: number;
  subject: string;
  from: string;
  reason: string;
}

export interface UnreadMail {
  batches: FetchedBatch[];
  /** Named rather than discarded, so "it ignored my batch" is answerable. */
  skipped: SkippedMessage[];
}

export interface MailSession {
  /** Unread messages in the mailbox. Marks nothing. */
  fetchUnread(limit?: number): Promise<UnreadMail>;
  /** Call once the batch's contents are stored -- not before. */
  markSeen(uid: number): Promise<void>;
}

/**
 * Opens the mailbox, runs `fn`, and closes it however `fn` ends.
 *
 * `onStep` is called as each stage begins. It exists because the failure this
 * has to survive is not an error -- it is silence. Something sitting between
 * here and the mail server (antivirus mail scanning, a proxy) can complete the
 * TLS handshake and then never deliver the server's greeting, and the whole
 * thing simply stops with nothing printed and no way to tell which stage it
 * stopped at. The timeouts below turn that into a failure with a name; `onStep`
 * says which name to expect.
 */
export async function withMailbox<T>(
  config: MailConfig,
  fn: (session: MailSession) => Promise<T>,
  onStep: (message: string) => void = () => {}
): Promise<T> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.password },
    logger: false,
    // ImapFlow's own defaults are 90s to connect and 5 minutes of socket
    // silence. Correct for a long-running service; far too patient for
    // something a person is watching a terminal for.
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 60000
  });

  onStep(`連線到 ${config.host}:${config.port}…`);
  await client.connect();

  try {
    onStep(`登入成功，開啟 ${config.mailbox}…`);
    const lock = await client.getMailboxLock(config.mailbox);
    try {
      onStep('讀取郵件…');
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
    /**
     * Two passes, because the mailbox is full of things that are not batches.
     *
     * The first run against a real mailbox found 22 unread messages, all of
     * them Google's own notifications, and downloaded every one in full to
     * conclude each had no CSV attached. Every six hours, forever. So the cheap
     * pass reads only envelopes, and a message's body is fetched only once its
     * sender and subject say it is worth fetching.
     */
    async fetchUnread(limit = 50): Promise<UnreadMail> {
      const batches: FetchedBatch[] = [];
      const skipped: SkippedMessage[] = [];

      const candidates: Array<{ uid: number; subject: string; from: string }> = [];
      for await (const message of client.fetch({ seen: false }, { uid: true, envelope: true })) {
        candidates.push({
          uid: message.uid,
          subject: message.envelope?.subject || '',
          from: message.envelope?.from?.[0]?.address || ''
        });
      }

      for (const candidate of candidates) {
        if (batches.length >= limit) break;
        const { uid, subject, from } = candidate;

        // Sender first: nothing from an unexpected address gets opened at all.
        // Refused messages are left unread on purpose. They will be reported
        // again next run, and they should be -- an unexpected sender in a
        // mailbox meant to receive from exactly one place deserves to keep
        // asking for attention until a person looks at it.
        if (config.allowedSender && from.toLowerCase() !== config.allowedSender.toLowerCase()) {
          skipped.push({ uid, subject, from, reason: `寄件者不是 ${config.allowedSender}` });
          continue;
        }

        const header = parseBatchSubject(subject);
        if (!header) {
          skipped.push({ uid, subject, from, reason: '主旨不是批次格式' });
          continue;
        }

        // Between listing the envelopes and asking for this body, the message
        // can be gone -- moved or deleted from another client, or by a filter.
        // Rare, but it returns `false` rather than throwing, so an unchecked
        // read here would crash the whole run over one absent message.
        const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!message) {
          skipped.push({ uid, subject, from, reason: '取內容時信件已不在信箱裡' });
          continue;
        }

        const parsed = await simpleParser(message.source);
        const warnings: string[] = [];

        const attachments: MailAttachment[] = [];
        for (const attachment of parsed.attachments || []) {
          const filename = attachment.filename || '(無檔名)';
          if (!/\.csv$/i.test(filename)) continue;
          const decoded = decodeCsvAttachment(attachment.content, filename);
          warnings.push(...decoded.warnings);
          attachments.push({ filename, text: decoded.text });
        }

        // A batch subject with nothing attached is a real problem, not noise --
        // the sender believed it sent something.
        if (attachments.length === 0) warnings.push('主旨是批次格式，但沒有 CSV 附件');

        batches.push({
          uid, subject, from,
          receivedAt: parsed.date?.toISOString() || '',
          header, attachments, warnings
        });
      }

      return { batches, skipped };
    },

    async markSeen(uid: number): Promise<void> {
      // Adds the \Seen flag and nothing else. Never \Deleted -- see the note at
      // the top of this file.
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
    }
  };
}
