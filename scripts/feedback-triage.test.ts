// When does a volunteer's feedback pull a coordinator in?
//
//   npm run check:feedback-triage
//
// The rule is a pure function so that the server (which sets the flag) and the
// dashboard (which shows the banner) cannot disagree, and so that it can be
// stated here in full. The model only ever supplies the *category*; whether
// that category means "somebody must look" is decided below, not by the model.
//
// Three groups:
//
//   1. The attention rule itself, including the cases the model cannot see
//      (no text) and the ones only the model can see (five stars, injury).
//   2. The no-model fallback: stars read literally, never text guessed.
//   3. When an alert stops being open -- acting on it in either way clears it.
import {
  needsCoordinatorAttention, fallbackFeedbackCategory, isOpenFeedbackAlert,
  isFeedbackCategory, clampRating
} from '../src/utils/feedbackTriage';

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`); }
};

console.log('\n哪些回饋要拉社工進來');
check(needsCoordinatorAttention(1, 'praise'), '1 星，不管文字說什麼');
check(needsCoordinatorAttention(2, 'praise'), '2 星，不管文字說什麼');
check(needsCoordinatorAttention(2, undefined), '2 星，模型沒跑出結果');
check(needsCoordinatorAttention(5, 'dispute'), '5 星但文字是事故 —— 只有模型看得到的那種');
check(needsCoordinatorAttention(4, 'complaint'), '4 星但文字是不滿');
check(needsCoordinatorAttention(3, 'complaint'), '3 星、不滿');
check(!needsCoordinatorAttention(3, 'suggestion'), '3 星、建議 —— 是「需要回覆」，不是警報');
check(!needsCoordinatorAttention(3, undefined), '3 星、沒有讀法 —— 同上');
check(!needsCoordinatorAttention(4, 'suggestion'), '4 星、建議');
check(!needsCoordinatorAttention(5, 'praise'), '5 星好評');
check(!needsCoordinatorAttention(undefined, 'praise'), '沒給星（視為 5）、好評');
check(needsCoordinatorAttention('2', 'praise'), '星數以字串送來');
check(needsCoordinatorAttention(0, 'praise') === false, '0 星視為未評分（5），不是 1 星');

console.log('\n沒有模型時的讀法：只看星，不猜字');
check(fallbackFeedbackCategory(1) === 'complaint', '1 星 → 不滿');
check(fallbackFeedbackCategory(2) === 'complaint', '2 星 → 不滿');
check(fallbackFeedbackCategory(3) === 'suggestion', '3 星 → 建議');
check(fallbackFeedbackCategory(4) === 'praise', '4 星 → 好評');
check(fallbackFeedbackCategory(5) === 'praise', '5 星 → 好評');
check(fallbackFeedbackCategory(undefined) === 'praise', '沒給星 → 好評');
check(fallbackFeedbackCategory(9) === 'praise', '超出範圍往下夾');
check(clampRating(3.6) === 4, '小數四捨五入');

console.log('\n模型回傳的類別要驗過才收');
check(isFeedbackCategory('dispute'), '合法類別');
check(!isFeedbackCategory('DISPUTE'), '大小寫不對');
check(!isFeedbackCategory('urgent'), '模型自己發明的類別');
check(!isFeedbackCategory(undefined), 'undefined');

console.log('\n警報什麼時候算處理過了');
check(isOpenFeedbackAlert({ feedbackAlertAt: '2026-09-13T00:00:00Z' }), '有警報、沒人動過');
check(!isOpenFeedbackAlert({ feedbackAlertAt: '2026-09-13T00:00:00Z', feedbackAcknowledgedAt: 'x' }), '已參採 → 關閉');
check(!isOpenFeedbackAlert({ feedbackAlertAt: '2026-09-13T00:00:00Z', feedbackRepliedAt: 'x' }), '已回覆 → 關閉');
check(!isOpenFeedbackAlert({}), '從來沒有警報');
check(!isOpenFeedbackAlert({ feedbackAlertAt: '' }), '空字串（資料庫預設值）不算警報');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
