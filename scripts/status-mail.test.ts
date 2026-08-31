// Does the mail side read the settings correctly, and refuse to read bytes it
// cannot actually read?
//
//   npm run check:status-mail
//
// Everything here runs with no mailbox, no credential and no network. Connecting
// is not what tends to break -- it either works or it says so loudly. What
// breaks quietly is a setting read wrong (an app password pasted with spaces,
// rejected with nothing but "authentication failed") or an encoding decoded
// wrong (a file that is not UTF-8 still produces text, just the wrong text).
import { readMailConfig, decodeCsvAttachment } from './status-mail';

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`); }
};

const FULL = {
  STATUS_MAIL_USER: 'paw.status@gmail.com',
  STATUS_MAIL_APP_PASSWORD: 'abcdefghijklmnop',
  STATUS_MAIL_ALLOWED_SENDER: 'noreply@strayhub.example'
} as NodeJS.ProcessEnv;

// --------------------------------------------------------------- settings
console.log('\n讀設定');

const ok = readMailConfig(FULL);
check(ok.errors.length === 0, '完整的設定沒有錯誤', ok.errors.join('；'));
check(ok.config?.host === 'imap.gmail.com', '沒填主機時預設用 Gmail', ok.config?.host);
check(ok.config?.port === 993, '沒填連接埠時預設 993', String(ok.config?.port));
check(ok.config?.mailbox === 'INBOX', '沒填資料夾時預設收件匣', ok.config?.mailbox);

// Google displays the password as four groups of four. Pasting it as shown is
// the obvious thing to do, and IMAP would just answer "authentication failed".
const spaced = readMailConfig({ ...FULL, STATUS_MAIL_APP_PASSWORD: 'abcd efgh ijkl mnop' });
check(spaced.config?.password === 'abcdefghijklmnop',
  '應用程式密碼中間的空格會被去掉 —— 照 Google 顯示的樣子貼也能用',
  spaced.config?.password);
check(spaced.warnings.length === 0, '而且去掉空格後不會誤判長度', spaced.warnings.join('；'));

console.log('\n設定不完整時要說清楚少了什麼');

const noUser = readMailConfig({ ...FULL, STATUS_MAIL_USER: '' });
check(noUser.config === null, '缺信箱地址時不回傳設定');
check(noUser.errors.some(e => e.includes('STATUS_MAIL_USER')),
  '而且錯誤訊息裡有變數名稱，照著填就好', noUser.errors.join('；'));

const noPassword = readMailConfig({ ...FULL, STATUS_MAIL_APP_PASSWORD: '' });
check(noPassword.errors.some(e => e.includes('STATUS_MAIL_APP_PASSWORD')),
  '缺密碼時同樣指名變數', noPassword.errors.join('；'));

const badPort = readMailConfig({ ...FULL, STATUS_MAIL_PORT: '不是數字' });
check(badPort.config === null && badPort.errors.some(e => e.includes('STATUS_MAIL_PORT')),
  '連接埠填錯會被擋下來', badPort.errors.join('；'));

console.log('\n該提醒的要提醒，但不擋住執行');

// The likely mistake is pasting the account's own password. It would be sent
// over the wire before anything noticed.
//
// The first value tried here was 'my-real-password', which happens to be
// exactly 16 characters long -- so the test failed while the code was doing
// precisely what it should. Hence the length assertion below: a fixture that
// quietly stops testing what it claims to test is worse than no fixture.
const WRONG_LENGTH = 'my-account-password';
check(WRONG_LENGTH.length !== 16, '（前提）這個測試值本身不是 16 碼', `實際 ${WRONG_LENGTH.length}`);

const accountPassword = readMailConfig({ ...FULL, STATUS_MAIL_APP_PASSWORD: WRONG_LENGTH });
check(accountPassword.config !== null, '長度不對還是能執行 —— 別家信箱不一定是 16 碼');
check(accountPassword.warnings.some(w => w.includes('16')),
  '但會提醒可能填成帳號密碼了', accountPassword.warnings.join('；'));

const noSender = readMailConfig({ ...FULL, STATUS_MAIL_ALLOWED_SENDER: '' });
check(noSender.config !== null, '沒設定寄件者限制仍可執行');
check(noSender.warnings.some(w => w.includes('STATUS_MAIL_ALLOWED_SENDER')),
  '但會說「任何人寄的都會被讀進來」', noSender.warnings.join('；'));

// ---------------------------------------------------------------- decoding
console.log('\n附件編碼');

const utf8 = decodeCsvAttachment(Buffer.from('動物,狀態\n小黑,便便正常\n', 'utf8'), 'a.csv');
check(utf8.text.includes('小黑') && utf8.text.includes('便便正常'),
  'UTF-8 的中文原樣讀出來', JSON.stringify(utf8.text));
check(utf8.warnings.length === 0, '而且沒有多餘的警告', utf8.warnings.join('；'));

// 0xA4 is a continuation byte where a lead byte belongs, so this is not valid
// UTF-8 whatever encoding it came from. Decoding it does not throw -- it
// produces U+FFFD, which is exactly the silent corruption being guarded against.
const notUtf8 = decodeCsvAttachment(Buffer.from([0xA4, 0x70, 0x2C, 0x78]), 'b.csv');
check(notUtf8.warnings.some(w => w.includes('UTF-8')),
  '不是 UTF-8 的位元組會被指出來，不是安靜地變成亂碼', notUtf8.warnings.join('；'));
check(notUtf8.warnings.some(w => w.includes('b.csv')), '而且說得出是哪個附件');

const empty = decodeCsvAttachment(Buffer.from(''), 'c.csv');
check(empty.warnings.some(w => w.includes('空')), '空附件會回報，不會當成 0 筆資料');

console.log(`\n${'='.repeat(52)}\n${fail === 0 ? '全部通過' : '有失敗'}：${pass}/${pass + fail}\n`);
process.exit(fail === 0 ? 0 : 1);
