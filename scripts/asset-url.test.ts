// Can a volunteer's photograph still be fetched by someone who was never let in?
//
//   npm run check:asset-urls
//
// The hole this closes was not a weak check, it was no check at all. Avatars and
// check-out photographs are served by express.static from outside /api, so the
// default-deny rule never applied to them, and an avatar's filename is derived
// from the volunteer's email address -- which nobody at a shelter treats as a
// secret. Working out the URL of any volunteer's photograph was arithmetic.
//
// So the first two cases below are the ones that matter: an unsigned path is
// refused, and a signature minted for one file does not open another. The rest
// guard the ways a fix like this quietly stops fixing anything -- an expiry that
// is accepted after it passes, a signature that turns out not to cover the path,
// or a helper that starts mangling the external avatars it is supposed to leave
// alone.
//
// Runs against a throwaway database, never the shelter's; the signing secret is
// read from app_settings, so this needs a database at all. Hence DATA_DIR and
// the dynamic import -- db.ts resolves the path as it loads.
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const scratch = mkdtempSync(join(tmpdir(), 'pawrescue-asset-test-'));
process.env.DATA_DIR = scratch;

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`); }
};

/** Pulls a signed URL apart the way the Express middleware sees it. */
function parts(url: string): { pathname: string; exp: string; sig: string; v: string } {
  const [pathname, query = ''] = url.split('?');
  const q = new URLSearchParams(query);
  return { pathname, exp: q.get('exp') || '', sig: q.get('sig') || '', v: q.get('v') || '' };
}

async function main() {
  const { signAssetUrl, isValidAssetSignature } = await import('../db');

  const AVATAR = '/avatars/someone_gmail_com.jpg';
  const signed = signAssetUrl(AVATAR);
  const p = parts(signed);

  // ------------------------------------------------- the hole being closed
  console.log('\n沒有簽章就拿不到檔案');

  check(
    !isValidAssetSignature(AVATAR, '', ''),
    '直接猜出來的網址（無 exp、無 sig）被拒絕'
  );

  check(
    !isValidAssetSignature(AVATAR, p.exp, ''),
    '只帶到期時間、沒有簽章，被拒絕'
  );

  check(
    !isValidAssetSignature(AVATAR, p.exp, 'f'.repeat(32)),
    '自己編一組長度正確的簽章，被拒絕'
  );

  check(
    isValidAssetSignature(p.pathname, p.exp, p.sig),
    '我們自己簽出來的網址可以通過'
  );

  // ------------------------------------------------ the signature covers the path
  console.log('\n簽章綁的是這個檔案，不是任何檔案');

  check(
    !isValidAssetSignature('/avatars/somebody_else_gmail_com.jpg', p.exp, p.sig),
    '拿自己的有效簽章去換別人的頭像，不通 —— 只簽到期時間就會漏掉這關'
  );

  check(
    !isValidAssetSignature('/photos/att-1-abcdef12.jpg', p.exp, p.sig),
    '頭像的簽章不能拿去開簽退照片'
  );

  check(
    parts(signAssetUrl('/photos/att-1-abcdef12.jpg')).sig !== p.sig,
    '不同檔案簽出來的簽章不同'
  );

  // --------------------------------------------------------------- expiry
  console.log('\n到期就是到期');

  check(
    Number(p.exp) > Date.now() / 1000,
    '剛簽出來的網址還沒過期'
  );

  const expiredExp = Math.floor(Date.now() / 1000) - 60;
  const { createHmac } = await import('crypto');
  const { getAppSecret } = await import('../db');
  const expiredSig = createHmac('sha256', getAppSecret('asset_url_secret'))
    .update(`${AVATAR}:${expiredExp}`)
    .digest('hex')
    .slice(0, 32);

  check(
    !isValidAssetSignature(AVATAR, expiredExp, expiredSig),
    '簽章正確但已經過期，仍然被拒絕 —— 否則外流的網址就是永久的'
  );

  check(
    !isValidAssetSignature(p.pathname, Number(p.exp) + 6 * 60 * 60, p.sig),
    '把到期時間往後挪，簽章就對不上了'
  );

  check(
    !isValidAssetSignature(p.pathname, 'abc', p.sig),
    '到期時間不是數字，被拒絕'
  );

  check(
    !isValidAssetSignature(p.pathname, `${p.exp}.5`, p.sig),
    '到期時間不是整數，被拒絕'
  );

  // ------------------------------------------------------------- windowing
  console.log('\n同一個時間窗內簽出來的網址一模一樣（瀏覽器才快取得到）');

  check(
    signAssetUrl(AVATAR) === signed,
    '連續兩次簽同一個檔案，得到同一個網址'
  );

  const ttlHours = (Number(p.exp) - Date.now() / 1000) / 3600;
  check(
    ttlHours > 6 && ttlHours <= 12,
    `有效期落在 6–12 小時之間（實際 ${ttlHours.toFixed(1)} 小時）`,
    '太短會讓開著的頁面圖片變空白，太長等於沒有到期'
  );

  // ------------------------------------------------- leave other URLs alone
  console.log('\n不是我們服務的網址，原封不動');

  const external = 'https://api.dicebear.com/7.x/initials/svg?seed=%E5%B0%8F%E6%98%8E';
  check(signAssetUrl(external) === external, 'dicebear 的預設頭像不會被加上簽章');

  const unsplash = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format';
  check(signAssetUrl(unsplash) === unsplash, '示範資料的外部頭像不會被加上簽章');

  check(signAssetUrl('') === '', '空字串維持空字串，讓呼叫端的預設頭像照常生效');
  check(signAssetUrl(null) === '', 'null 維持空字串');
  check(signAssetUrl(undefined) === '', 'undefined 維持空字串');

  // ------------------------------------------- existing rows need no migration
  console.log('\n資料庫裡既有的值不必改寫');

  const legacy = signAssetUrl('/avatars/someone_gmail_com.jpg?v=1788400000');
  const lp = parts(legacy);
  check(lp.v === '1788400000', '既有的 ?v= 快取破壞參數被保留下來');
  check(
    isValidAssetSignature(lp.pathname, lp.exp, lp.sig),
    '帶著 ?v= 的舊值一樣簽得起來、驗得過 —— 所以不需要資料遷移'
  );
  check(
    lp.sig === p.sig,
    '簽章不含 ?v=，所以同一個檔案不論有沒有快取參數都是同一組簽章'
  );

  console.log(`\n${'='.repeat(52)}\n${fail === 0 ? '全部通過' : '有失敗'}：${pass}/${pass + fail}\n`);
  return fail === 0 ? 0 : 1;
}

/**
 * Same reasoning as status-db.test.ts: Windows will not remove a folder whose
 * SQLite file is still open, and this process never closes the connection -- it
 * exits instead. Cleaning up must not be able to replace the result the run was
 * there to report.
 */
function cleanup() {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    console.log(`（暫存資料庫留在 ${scratch}，Windows 還鎖著它，可以不管）`);
  }
}

main()
  .then(code => { cleanup(); process.exit(code); })
  .catch(err => { console.error(err); cleanup(); process.exit(1); });
