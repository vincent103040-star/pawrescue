/**
 * Which weekdays a duty runs on.
 *
 * Shared by the server (db.ts) and the duty form, because the first version had
 * a copy in each and a bug in both: `''.split(',')` yields `['']`, `Number('')`
 * is `0`, and `0` is a valid weekday -- so an unrestricted duty parsed as
 * "Sundays only". Every duty that existed before this feature is unrestricted,
 * so that reading would have emptied the roster six days a week, and the form
 * showed a fresh entry as already set to Sunday.
 *
 * One implementation means the next mistake here can only be made once.
 *
 * Numbering is JavaScript's own: 0 = Sunday ... 6 = Saturday. An empty list
 * means every day.
 */

export const WEEKDAY_NAMES: Record<number, string> = {
  0: '日', 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六'
};

/** Monday first for display, which is how a Taiwanese calendar reads. */
export const WEEKDAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function parseWeekdays(value: unknown): number[] {
  const days = String(value ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(part => part !== '')
    .map(Number)
    .filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
  return [...new Set(days)].sort((a, b) => a - b);
}

/**
 * Normalises to the stored form.
 *
 * All seven selected is the same fact as no restriction, so it collapses to the
 * empty string -- two spellings of one thing eventually disagree.
 */
export function serializeWeekdays(value: unknown): string {
  const days = Array.isArray(value) ? parseWeekdays(value.join(',')) : parseWeekdays(value);
  return days.length === 7 ? '' : days.join(',');
}

/** "每天" when unrestricted, otherwise "週六" / "週六、日". */
export function describeWeekdays(value: unknown): string {
  const days = parseWeekdays(value);
  if (days.length === 0 || days.length === 7) return '每天';
  return '週' + WEEKDAY_DISPLAY_ORDER.filter(d => days.includes(d))
    .map(d => WEEKDAY_NAMES[d]).join('、');
}
