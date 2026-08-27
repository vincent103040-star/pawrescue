// Checks that the API still refuses what it is supposed to refuse.
//
// The point of this file is that you should not have to read a diff, or take
// anyone's word for it, to know whether the authorization rules still hold.
// Run it against a running server and it tells you.
//
//   npm run check:security                  # against http://localhost:3000
//   BASE=http://localhost:3100 npm run check:security
//
// It only makes read-only or already-invalid requests: every write it attempts
// is one that is supposed to be rejected, and it uses ids that do not exist, so
// a passing run changes nothing and a failing run reveals a hole rather than
// creating one. It needs no credentials and no test data.
//
// One thing it deliberately cannot tell you: because the default-deny middleware
// runs before routing, a path that no longer exists answers 401 exactly like a
// protected one. So this list has to be kept in step with the routes by hand --
// a stale entry passes forever while testing nothing.
//
// A failure here means a route lost its protection. That is worth stopping for
// even when everything looks fine in the browser -- the browser only ever shows
// you the requests the app chooses to make.

const BASE = process.env.BASE || 'http://localhost:3000';
const DENY = '尚未登入或登入已逾期';

let passed = 0;
const failures: string[] = [];

function record(ok: boolean, label: string, detail: string) {
  if (ok) {
    passed++;
  } else {
    failures.push(`${label}\n      ${detail}`);
  }
}

async function call(method: string, path: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : '{}'
  });
  const text = await res.text();
  return { status: res.status, text };
}

/** Every route that must answer 401 when nobody is signed in. */
const PROTECTED: Array<[string, string]> = [
  ['POST', '/api/admin/attendance/does-not-exist/feedback-acknowledged'],
  ['POST', '/api/admin/volunteers/nobody@example.com/account-status'],
  ['GET', '/api/admin/roll-call'],
  ['GET', '/api/admin/reports/monthly.csv?month=2026-08'],
  ['GET', '/api/duty-items'],
  ['POST', '/api/admin/duty-items'],
  ['PUT', '/api/admin/duty-items/does-not-exist'],
  ['POST', '/api/admin/duty-items/does-not-exist/disable'],
  ['POST', '/api/admin/duty-items/does-not-exist/restore'],
  ['GET', '/api/duties/today'],
  ['POST', '/api/duties/does-not-exist/complete'],
  ['POST', '/api/duties/does-not-exist/uncomplete'],
  ['GET', '/api/admin/workload'],
  ['POST', '/api/admin/schedule/preview'],
  ['POST', '/api/admin/schedule/generate'],
  ['POST', '/api/admin/schedule/publish'],
  ['POST', '/api/admin/schedule/discard'],
  ['GET', '/api/zones'],
  ['POST', '/api/admin/zones'],
  ['PUT', '/api/admin/zones/does-not-exist'],
  ['GET', '/api/admin/zones/does-not-exist/usage'],
  ['POST', '/api/admin/zones/does-not-exist/disable'],
  ['POST', '/api/admin/zones/does-not-exist/restore'],
  ['GET', '/api/shifts'],
  ['POST', '/api/shifts'],
  ['PUT', '/api/shifts/does-not-exist'],
  ['DELETE', '/api/shifts/does-not-exist'],
  ['GET', '/api/shift-signups'],
  ['GET', '/api/substitutions'],
  ['POST', '/api/shift-signups/does-not-exist/substitution'],
  ['POST', '/api/substitutions/does-not-exist/take'],
  ['POST', '/api/substitutions/does-not-exist/withdraw'],
  ['POST', '/api/shift-signups'],
  ['PUT', '/api/shift-signups/does-not-exist/status'],
  ['DELETE', '/api/shift-signups/does-not-exist'],
  ['GET', '/api/volunteers'],
  ['GET', '/api/volunteers/profile?email=nobody@example.com'],
  ['POST', '/api/volunteers/profile-extras'],
  ['POST', '/api/volunteers/log-hours'],
  ['GET', '/api/volunteers/line-status?email=nobody@example.com'],
  ['GET', '/api/attendance'],
  ['POST', '/api/attendance/check-in'],
  ['POST', '/api/attendance/does-not-exist/check-out'],
  ['GET', '/api/admin/attendance/poster'],
  ['GET', '/api/admin/attendance/site-code'],
  ['POST', '/api/promotions/request'],
  ['GET', '/api/promotions'],
  ['POST', '/api/promotions/does-not-exist/approve'],
  ['POST', '/api/promotions/does-not-exist/reject'],
  ['GET', '/api/shift-templates'],
  ['POST', '/api/shift-templates/sync'],
  ['DELETE', '/api/admin/shift-templates/does-not-exist'],
  ['POST', '/api/line/push'],
  ['POST', '/api/line/broadcast'],
  ['GET', '/api/sop-content'],
  ['PUT', '/api/admin/sop-content'],
  ['POST', '/api/admin/sop-documents'],
  ['GET', '/api/sop-documents/does-not-exist/text'],
  ['DELETE', '/api/admin/sop-documents/does-not-exist'],
  ['POST', '/api/admin/sop-videos'],
  ['DELETE', '/api/admin/sop-videos/does-not-exist'],
  ['POST', '/api/ai/generate-post'],
  ['POST', '/api/ai/generate-urgent-push'],
  ['POST', '/api/ai/predict-resource-gaps'],
  ['POST', '/api/ai/generate-situational-question'],
  ['POST', '/api/ai/assess-situational-answer'],
  ['POST', '/api/ai/rag-ask'],
  ['POST', '/api/ai/caption-photo'],
  ['PUT', '/api/admin/volunteers/nobody@example.com'],
  ['DELETE', '/api/admin/volunteers/nobody@example.com'],
  ['POST', '/api/admin/change-password'],
  ['PUT', '/api/admin/line-official-account'],
  ['PUT', '/api/admin/shelter-location']
];

/**
 * Routes that must stay reachable without a session, because they are what the
 * signed-out page shows or what issues a session in the first place. They are
 * allowed to answer 400/401/503 from their own logic -- what they must not do
 * is come back with the middleware's deny message, which would mean the
 * allowlist has drifted and nobody can sign in any more.
 */
const PUBLIC: Array<[string, string]> = [
  ['GET', '/api/health'],
  ['GET', '/api/shelter-location'],
  ['GET', '/api/line-official-account'],
  ['POST', '/api/auth/admin-login'],
  ['POST', '/api/auth/google-userinfo'],
  ['POST', '/api/auth/google-phone-login'],
  ['POST', '/api/auth/line-login-url'],
  ['POST', '/api/auth/line-session'],
  ['GET', '/api/auth/me'],
  ['POST', '/api/auth/logout'],
  ['POST', '/api/line/webhook']
];

async function checkProtected() {
  console.log('\n受保護的端點（未帶 token 應回 401）');
  for (const [method, path] of PROTECTED) {
    const { status, text } = await call(method, path);
    record(
      status === 401 && text.includes(DENY),
      `${method} ${path}`,
      `預期 401 + 拒絕訊息，實際 ${status}：${text.slice(0, 120)}`
    );
  }
  console.log(`  ${PROTECTED.length} 條路由已檢查`);
}

async function checkPublic() {
  console.log('\n白名單端點（必須維持可達）');
  for (const [method, path] of PUBLIC) {
    const { status, text } = await call(method, path);
    record(
      !text.includes(DENY),
      `${method} ${path}`,
      `被預設拒絕中介層擋下了（${status}），登入流程會因此中斷`
    );
  }
  console.log(`  ${PUBLIC.length} 條路由已檢查`);
}

/**
 * The sign-in endpoint has to stay open, so it is the one place where getting
 * the identity from the request body is fatal: it used to hand back a working
 * session for whatever email you typed. This is the specific request that used
 * to work.
 */
async function checkForgedLogin() {
  console.log('\n偽造登入');
  const res = await fetch(`${BASE}/api/auth/google-phone-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken: 'google-oauth-verified',
      googleProfile: { email: 'victim@example.com', name: 'x' },
      phoneNumber: '0912345678'
    })
  });
  const data: any = await res.json().catch(() => ({}));
  record(
    !data?.token,
    'POST /api/auth/google-phone-login（body 帶 email，沒有真實 Google token）',
    '伺服器發出了 session token —— 任何人都能冒充任意志工登入'
  );

  const bind = await fetch(`${BASE}/api/auth/line-login-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'bind', email: 'victim@example.com' })
  });
  record(
    bind.status === 401,
    'POST /api/auth/line-login-url（未登入卻要求綁定他人帳號）',
    `預期 401，實際 ${bind.status} —— 可把自己的 LINE 綁到別人的志工紀錄`
  );
  console.log('  2 項已檢查');
}

async function main() {
  console.log(`目標：${BASE}`);

  try {
    const health = await fetch(`${BASE}/api/health`);
    if (!health.ok) throw new Error(`健康檢查回應 ${health.status}`);
  } catch (error: any) {
    console.error(`\n連不上 ${BASE} —— 伺服器沒在跑嗎？（${error.message}）`);
    console.error('先執行 npm run dev，或用 BASE=http://localhost:3100 指向別的埠。');
    process.exit(2);
  }

  await checkProtected();
  await checkPublic();
  await checkForgedLogin();

  const total = passed + failures.length;
  console.log('\n' + '='.repeat(60));
  if (failures.length === 0) {
    console.log(`全部通過：${passed}/${total} 項檢查`);
    console.log('='.repeat(60));
    console.log(
      '\n提醒：這支腳本只檢查「該擋的有沒有擋住」。真實的 Google／LINE 登入、\n' +
      '現場簽到與 LINE 推播需要真的走一次，它驗不到。'
    );
    return;
  }

  console.log(`失敗：${failures.length}/${total} 項`);
  console.log('='.repeat(60));
  for (const failure of failures) {
    console.log(`\n  ✗ ${failure}`);
  }
  console.log('\n每一項失敗都代表一條路由失去保護。先修好再部署。');
  process.exit(1);
}

main().catch(error => {
  console.error('腳本本身出錯：', error);
  process.exit(2);
});
