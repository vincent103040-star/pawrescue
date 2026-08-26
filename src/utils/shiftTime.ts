/**
 * How long until a shift starts, for deciding what to put on screen.
 *
 * Shifts store a Taiwan-local date and a "09:00-11:00" range with no timezone,
 * because that is how the shelter writes them on the wall. Taiwan has had no
 * daylight saving since 1979, so pinning +08:00 turns that back into a real
 * instant without a timezone library -- the same arithmetic the server does in
 * hoursUntilShift.
 *
 * This copy exists so the page can label a button before asking. It is not the
 * authority: whether a booking may still be cancelled is decided on the server,
 * where a clock the volunteer cannot change is doing the deciding. If the two
 * ever disagree, the server's answer is the one that takes effect, and the page
 * shows what it said.
 */
export function hoursUntilShift(date?: string, timeRange?: string): number | null {
  if (!date || !timeRange) return null;
  const start = String(timeRange).split('-')[0].trim();
  if (!/^\d{1,2}:\d{2}$/.test(start)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const startsAt = new Date(`${date}T${start.padStart(5, '0')}:00+08:00`);
  if (Number.isNaN(startsAt.getTime())) return null;
  return (startsAt.getTime() - Date.now()) / 3_600_000;
}

/** The notice the rulebook asks for before a shift a volunteer cannot make. */
export const SUBSTITUTION_NOTICE_HOURS = 24;

/** Readable "還有 3 小時" / "還有 2 天", for telling somebody how much time is left. */
export function timeUntilLabel(hours: number | null): string {
  if (hours === null) return '';
  if (hours < 0) return '已開始';
  if (hours < 1) return `剩不到 1 小時`;
  if (hours < 24) return `剩 ${Math.floor(hours)} 小時`;
  return `剩 ${Math.floor(hours / 24)} 天`;
}
