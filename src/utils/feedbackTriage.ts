/**
 * What a volunteer's post-shift feedback is, and whether a coordinator needs
 * to see it before anything else.
 *
 * Two things live here, and they are kept apart on purpose:
 *
 *   - the *category* is a reading of the text -- praise, a suggestion, a
 *     complaint, or a dispute (an injury, a conflict with a person, an animal
 *     hurt, an accusation). Gemini produces it on the server when it can; the
 *     rule-based fallback below produces it when it cannot.
 *
 *   - the *attention* decision is a rule, not a model output. Whether a
 *     coordinator is pulled in must be the same answer on the server that sets
 *     the flag and in the dashboard that shows it, and must not change because
 *     a model was rephrased. The model only ever widens the net: a five-star
 *     rating whose text says "被咬了" is a dispute and gets flagged; a two-star
 *     rating is flagged no matter what the text says.
 *
 * Nothing is sent to anyone. The flag becomes a banner on the coordinator's
 * dashboard, which they see when they next sit down to plan shifts -- not a
 * LINE message at 23:00 to somebody who was off duty.
 */

export type FeedbackCategory = 'praise' | 'suggestion' | 'complaint' | 'dispute';

export const FEEDBACK_CATEGORIES: readonly FeedbackCategory[] = ['praise', 'suggestion', 'complaint', 'dispute'];

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  praise: '好評',
  suggestion: '建議',
  complaint: '不滿',
  dispute: '爭議／事故'
};

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return typeof value === 'string' && (FEEDBACK_CATEGORIES as readonly string[]).includes(value);
}

/** Clamp whatever the client sent to the 1–5 the rest of the app assumes. */
export function clampRating(rating: unknown): number {
  const n = Number(rating);
  if (!Number.isFinite(n) || n <= 0) return 5;
  return Math.max(1, Math.min(5, Math.round(n)));
}

/**
 * The rule. Kept to two clauses so a coordinator can be told it in a sentence:
 * two stars or fewer, or anything the reading calls a complaint or a dispute.
 *
 * Three stars with a suggestion is *not* an alert. It still shows as
 * 「需要回覆」 in the feedback hub, which is the right weight for it; an alert
 * that fires on every lukewarm note trains people to dismiss the banner.
 */
export function needsCoordinatorAttention(rating: unknown, category: FeedbackCategory | undefined | null): boolean {
  if (clampRating(rating) <= 2) return true;
  return category === 'complaint' || category === 'dispute';
}

/**
 * The reading when there is no model: the stars, read literally. No text is
 * inspected -- guessing "dispute" from keywords would produce confident
 * nonsense on 「今天沒有被咬，很開心」, and a wrong dispute flag costs a
 * coordinator's trust in the banner. Without a model, the stars decide.
 */
export function fallbackFeedbackCategory(rating: unknown): FeedbackCategory {
  const stars = clampRating(rating);
  if (stars <= 2) return 'complaint';
  if (stars === 3) return 'suggestion';
  return 'praise';
}

/**
 * An alert that nobody has acted on yet. Acknowledging the feedback or
 * replying to it both count as acting -- the point of the banner is to get a
 * person to look, and either of those proves somebody did.
 */
export function isOpenFeedbackAlert(record: {
  feedbackAlertAt?: string;
  feedbackAcknowledgedAt?: string;
  feedbackRepliedAt?: string;
}): boolean {
  return !!record.feedbackAlertAt && !record.feedbackAcknowledgedAt && !record.feedbackRepliedAt;
}
