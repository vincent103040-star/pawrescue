// Can every duty that exists actually reach somebody?
//
//   npm run check:duty-visibility
//
// The failure this guards against is silence. A one-off duty attached to a
// shift in one zone while labelled with another reached exactly the wrong
// people: it appeared for volunteers rostered into the zone on the label, who
// are not on that shift, and not for the volunteers on the shift it names.
//
// Both halves are quiet. The wrong volunteer sees a task that looks like any
// other; the right volunteer sees nothing missing. Only running the old filter
// against these cases showed which way round it was -- the first guess was
// that the duty was invisible to everyone, which was wrong, and would have
// been believed if this file's expectations had been the only judge.
import { isDutyOnTodaysList, type VisibilityDuty, type VisibilityContext } from '../src/utils/dutyVisibility';

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

const SHIFTS = [
  { id: 'auto-medical-1000', zone: 'medical' },
  { id: 'auto-dog-0900', zone: 'dog' }
];

const ctx = (over: Partial<VisibilityContext> = {}): VisibilityContext => ({
  shiftsToday: SHIFTS,
  requestedShiftId: '',
  myZones: null,
  myShiftIds: null,
  ...over
});

const duty = (over: Partial<VisibilityDuty> = {}): VisibilityDuty => ({
  triggerType: 'daily',
  zoneId: 'dog',
  shiftId: '',
  ...over
});

// ------------------------------------------------------- the reported bug
console.log('\n一次性勤務：場域跟班次不一致（實際踩到的情況）');

// TEST: zoneId 'dog', attached to the medical shift.
const crossZone = duty({ triggerType: 'specific_shift', zoneId: 'dog', shiftId: 'auto-medical-1000' });

check(
  isDutyOnTodaysList(crossZone, ctx({
    myZones: new Set(['medical']),
    myShiftIds: new Set(['auto-medical-1000'])
  })),
  '排在那個班次上的志工看得到 —— 即使勤務標的場域是別區'
);

check(
  !isDutyOnTodaysList(crossZone, ctx({
    myZones: new Set(['dog']),
    myShiftIds: new Set(['auto-dog-0900'])
  })),
  '沒排那個班次的志工看不到 —— 即使場域剛好對得上'
);

check(
  isDutyOnTodaysList(crossZone, ctx()),
  '管理員看得到（不套用個人過濾）'
);

console.log('\n一次性勤務：一般情況');

const onShift = duty({ triggerType: 'specific_shift', zoneId: 'medical', shiftId: 'auto-medical-1000' });

check(
  isDutyOnTodaysList(onShift, ctx({
    myZones: new Set(['medical']),
    myShiftIds: new Set(['auto-medical-1000'])
  })),
  '場域一致時當然也看得到'
);

check(
  !isDutyOnTodaysList(duty({ triggerType: 'specific_shift', shiftId: 'auto-medical-1000' }),
    ctx({ requestedShiftId: 'auto-dog-0900' })),
  '指定看某個班次時，不屬於那個班次的不會混進來'
);

check(
  !isDutyOnTodaysList(duty({ triggerType: 'specific_shift', shiftId: 'shift-已刪除' }), ctx()),
  '綁在今天沒有的班次上的勤務不會出現'
);

// A volunteer with no shift today is an empty Set, not null. If those were
// conflated, someone who is not working would see the entire shelter's list.
check(
  !isDutyOnTodaysList(onShift, ctx({ myZones: new Set(), myShiftIds: new Set() })),
  '今天沒班的志工看不到任何一次性勤務（空集合不等於「不限制」）'
);

// ------------------------------------------------------------- recurring
console.log('\n每天／每次進場的勤務：場域仍然要擋');

check(
  isDutyOnTodaysList(duty({ triggerType: 'daily', zoneId: 'dog' }),
    ctx({ myZones: new Set(['dog']), myShiftIds: new Set(['auto-dog-0900']) })),
  '每天的勤務，場域對得上就看得到'
);

check(
  !isDutyOnTodaysList(duty({ triggerType: 'daily', zoneId: 'dog' }),
    ctx({ myZones: new Set(['medical']), myShiftIds: new Set(['auto-medical-1000']) })),
  '每天的勤務，別區的志工看不到 —— 這一關不能因為上面的修正被拿掉'
);

check(
  isDutyOnTodaysList(duty({ triggerType: 'zone_shift', zoneId: 'medical' }),
    ctx({ myZones: new Set(['medical']), myShiftIds: new Set(['auto-medical-1000']) })),
  '每次進場的勤務，該場域今天有班就看得到'
);

check(
  !isDutyOnTodaysList(duty({ triggerType: 'zone_shift', zoneId: 'puppy' }), ctx()),
  '每次進場的勤務，該場域今天沒班就不出現'
);

console.log(`\n${'='.repeat(52)}\n${fail === 0 ? '全部通過' : '有失敗'}：${pass}/${pass + fail}\n`);
process.exit(fail === 0 ? 0 : 1);
