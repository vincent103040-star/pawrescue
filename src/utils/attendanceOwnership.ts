/**
 * Whether an attendance row belongs to the volunteer asking about it.
 *
 * Pulled out of the route so it can be tested without a session, a database or
 * a running server -- and, more to the point, so that the three places that
 * ask this question give the same answer. They did not.
 *
 * The bug was not a crash. Attendance rows identify their volunteer by *name*,
 * and the read path, the volunteer's screen and the check-out handler each
 * compared that name differently:
 *
 *   GET /api/attendance   exact name, OR the row's signup belongs to my email
 *   the check-out screen  name trimmed and lower-cased, no signup route
 *   POST .../check-out    exact name only
 *
 * So a name that differed by one trailing space landed in the gap between
 * them: the row came back from the server (via its signup), the screen matched
 * it loosely and drew the check-out form, the volunteer wrote their feedback,
 * and the write was refused with 「只能為自己簽退」. The coordinator's console
 * skips the check entirely, so the same feedback saved there -- which reads
 * exactly like "volunteers cannot write feedback, only admins can".
 *
 * Names drift for ordinary reasons: a coordinator typing a proxy check-in, a
 * full-width space, and Google login rewriting `volunteers.name` from the
 * account's display name on every sign-in -- so a volunteer who signs in again
 * between checking in and checking out can have the two spellings diverge with
 * nothing on screen to show it.
 *
 * Two rules, in this order:
 *
 *   1. The row's signup is one of mine. This is the reliable one, because a
 *      signup carries an email and an email is not rewritten at login.
 *   2. Failing that, the names match after normalisation.
 *
 * Normalisation deliberately stops at case, NFKC width and runs of whitespace.
 * It does not strip spaces from inside a name: 「陳 小美」 and 「陳小美」 are
 * almost certainly one person, but "almost certainly" is how two volunteers
 * get merged, and this decides who may write to a record.
 */

/** Case, width and surrounding whitespace are not identity. */
export function normalizeVolunteerName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')   // turns U+3000 and other full-width forms into plain ASCII
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** True when both spellings name the same volunteer as far as we can tell. */
export function sameVolunteerName(a: unknown, b: unknown): boolean {
  const left = normalizeVolunteerName(a);
  return left !== '' && left === normalizeVolunteerName(b);
}

export interface OwnableAttendanceRow {
  volunteerName: string;
  signupId?: string;
}

/**
 * `mySignupIds` is the set of signup ids belonging to this volunteer's email.
 * Pass an empty set when they cannot be looked up; the name rule still applies.
 */
export function attendanceBelongsTo(
  record: OwnableAttendanceRow,
  myName: unknown,
  mySignupIds: ReadonlySet<string>
): boolean {
  if (record.signupId && mySignupIds.has(record.signupId)) return true;
  return sameVolunteerName(record.volunteerName, myName);
}
