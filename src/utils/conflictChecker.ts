import { VolunteerApplication, PositionShift } from '../types';

export interface ApplicationConflict {
  id: string;
  volunteerName: string;
  volunteerPhone: string;
  volunteerEmail: string;
  lineId: string;
  app1: VolunteerApplication;
  shift1: PositionShift;
  app2: VolunteerApplication;
  shift2: PositionShift;
  overlapMinutes: number;
  overlapDescription: string;
  suggestedDeleteAppId: string;
  suggestedKeepAppId: string;
  suggestedReason: string;
}

/**
 * Parses time string like "10:00 - 13:00" into start and end in minutes from midnight.
 */
export function parseTimeRangeToMinutes(timeRange: string): { start: number; end: number } | null {
  if (!timeRange) return null;
  const parts = timeRange.split(/[-~–—]/).map(p => p.trim());
  if (parts.length < 2) return null;

  const parseSingle = (str: string) => {
    const match = str.match(/(\d{1,2}):(\d{2})/);
    if (!match) return 0;
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  };

  const start = parseSingle(parts[0]);
  let end = parseSingle(parts[1]);
  if (end <= start && end !== 0) {
    end += 24 * 60; // Crosses midnight
  }
  return { start, end };
}

/**
 * Checks if two shifts overlap in time on the same date.
 */
export function checkShiftTimeOverlap(shiftA: PositionShift, shiftB: PositionShift): { isOverlapping: boolean; overlapMinutes: number } {
  if (shiftA.date !== shiftB.date) {
    return { isOverlapping: false, overlapMinutes: 0 };
  }

  const rangeA = parseTimeRangeToMinutes(shiftA.timeRange);
  const rangeB = parseTimeRangeToMinutes(shiftB.timeRange);

  if (!rangeA || !rangeB) {
    // If times can't be parsed, fallback to comparing date & shift type or exact string match
    if (shiftA.shiftType === shiftB.shiftType || shiftA.timeRange === shiftB.timeRange) {
      return { isOverlapping: true, overlapMinutes: 180 };
    }
    return { isOverlapping: false, overlapMinutes: 0 };
  }

  const overlapStart = Math.max(rangeA.start, rangeB.start);
  const overlapEnd = Math.min(rangeA.end, rangeB.end);
  const overlapMinutes = Math.max(0, overlapEnd - overlapStart);

  return {
    isOverlapping: overlapMinutes > 0,
    overlapMinutes
  };
}

/**
 * Scans all applications and returns list of conflicting pairs.
 */
export function detectApplicationConflicts(
  applications: VolunteerApplication[],
  shifts: PositionShift[]
): ApplicationConflict[] {
  const activeApps = applications.filter(a => a.status !== 'rejected' && a.status !== 'absent');
  const conflicts: ApplicationConflict[] = [];

  // Group by volunteer key (lineId or email or phone or name)
  const appByVolunteer: Record<string, VolunteerApplication[]> = {};

  activeApps.forEach(app => {
    const key = (app.lineId || app.volunteerEmail || app.volunteerPhone || app.volunteerName).trim().toLowerCase();
    if (!appByVolunteer[key]) {
      appByVolunteer[key] = [];
    }
    appByVolunteer[key].push(app);
  });

  const processedPairKeys = new Set<string>();

  Object.values(appByVolunteer).forEach(group => {
    if (group.length < 2) return;

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const app1 = group[i];
        const app2 = group[j];

        const shift1 = shifts.find(s => s.id === app1.shiftId);
        const shift2 = shifts.find(s => s.id === app2.shiftId);

        if (!shift1 || !shift2) continue;

        const { isOverlapping, overlapMinutes } = checkShiftTimeOverlap(shift1, shift2);

        if (isOverlapping) {
          const pairKey = [app1.id, app2.id].sort().join('___');
          if (processedPairKeys.has(pairKey)) continue;
          processedPairKeys.add(pairKey);

          // Recommendation logic:
          // 1. If one is approved and the other is pending -> suggest keeping approved, deleting pending.
          // 2. If both are pending / approved -> suggest keeping the one with higher shortage rate (needs volunteer more)
          let suggestedDeleteAppId = app2.id;
          let suggestedKeepAppId = app1.id;
          let suggestedReason = '';

          if (app1.status === 'approved' && app2.status === 'pending') {
            suggestedDeleteAppId = app2.id;
            suggestedKeepAppId = app1.id;
            suggestedReason = `【${shift1.title}】已完成審核錄取，建議退回後續重複報名之待審班次【${shift2.title}】。`;
          } else if (app2.status === 'approved' && app1.status === 'pending') {
            suggestedDeleteAppId = app1.id;
            suggestedKeepAppId = app2.id;
            suggestedReason = `【${shift2.title}】已完成審核錄取，建議退回後續重複報名之待審班次【${shift1.title}】。`;
          } else {
            // Compare shift gap
            const gap1 = shift1.requiredCount - shift1.currentCount;
            const gap2 = shift2.requiredCount - shift2.currentCount;

            if (gap1 >= gap2) {
              suggestedDeleteAppId = app2.id;
              suggestedKeepAppId = app1.id;
              suggestedReason = `【${shift1.title}】目前尚缺 ${gap1} 人（急需人力），建議保留該班次，並退回【${shift2.title}】（尚缺 ${gap2} 人）。`;
            } else {
              suggestedDeleteAppId = app1.id;
              suggestedKeepAppId = app2.id;
              suggestedReason = `【${shift2.title}】目前尚缺 ${gap2} 人（急需人力），建議保留該班次，並退回【${shift1.title}】（尚缺 ${gap1} 人）。`;
            }
          }

          const hours = Math.floor(overlapMinutes / 60);
          const mins = overlapMinutes % 60;
          const timeStr = hours > 0 ? `${hours} 小時 ${mins > 0 ? `${mins} 分鐘` : ''}` : `${mins} 分鐘`;

          conflicts.push({
            id: `conflict-${pairKey}`,
            volunteerName: app1.volunteerName,
            volunteerPhone: app1.volunteerPhone,
            volunteerEmail: app1.volunteerEmail,
            lineId: app1.lineId,
            app1,
            shift1,
            app2,
            shift2,
            overlapMinutes,
            overlapDescription: `同日 (${shift1.date}) 時段重疊 ${timeStr}（${shift1.timeRange} vs ${shift2.timeRange}）`,
            suggestedDeleteAppId,
            suggestedKeepAppId,
            suggestedReason
          });
        }
      }
    }
  });

  return conflicts;
}
