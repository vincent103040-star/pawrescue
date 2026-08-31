/**
 * Which duties belong on someone's list today.
 *
 * Pulled out of the route so it can be tested without a session, a database or
 * a running server. The bug that prompted this was not a crash: a one-off duty
 * whose zone differed from its shift's zone went to precisely the wrong people.
 * The zone gate ran first and admitted anyone rostered into the zone written on
 * the duty -- who are not on that shift and have no reason to do it -- while
 * excluding the people actually on the shift it named, because their zone did
 * not match the label. The shift check that followed then passed for the first
 * group, since the shift existed somewhere in the day.
 *
 * So it appeared on strangers' lists and never on the right one, and both
 * halves were silent: the wrong volunteer sees a plausible-looking task, and
 * the right volunteer sees nothing missing.
 *
 * Shared with the server rather than reimplemented, in the same way
 * `weekdays.ts` is shared with the duty form.
 */

export interface VisibilityContext {
  /** Every shift on the day being asked about. */
  shiftsToday: Array<{ id: string; zone: string }>;
  /** Narrows to one shift when the caller asked for one; '' means the day. */
  requestedShiftId: string;
  /**
   * Zones the viewer is rostered into today, or null for a coordinator.
   *
   * Null means "no restriction", not "no zones" -- an empty Set is a volunteer
   * with no shift today, which is a different answer.
   */
  myZones: Set<string> | null;
  /** Shifts the viewer is rostered onto, or null for a coordinator. */
  myShiftIds: Set<string> | null;
}

export interface VisibilityDuty {
  triggerType: 'daily' | 'zone_shift' | 'specific_shift';
  zoneId: string;
  shiftId: string;
}

export function isDutyOnTodaysList(duty: VisibilityDuty, ctx: VisibilityContext): boolean {
  // A one-off duty is scoped by the shift it names, so the zone gate below must
  // not also apply. Being on the shift is the whole qualification; the zone on
  // the duty is a label for where the work happens, and the two are chosen
  // separately in the form, so they can legitimately differ.
  if (duty.triggerType === 'specific_shift') {
    if (ctx.myShiftIds && !ctx.myShiftIds.has(duty.shiftId)) return false;
    return ctx.requestedShiftId
      ? duty.shiftId === ctx.requestedShiftId
      : ctx.shiftsToday.some(shift => shift.id === duty.shiftId);
  }

  // Recurring duties have no shift to scope them, so the zone is what keeps a
  // volunteer's list to the area they actually walked into.
  if (ctx.myZones && !ctx.myZones.has(duty.zoneId)) return false;
  if (duty.triggerType === 'daily') return true;
  return ctx.shiftsToday.some(shift => shift.zone === duty.zoneId);
}
