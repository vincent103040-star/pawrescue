/**
 * End-of-day roll call: who was expected, and who actually turned up.
 *
 * The shelter's rulebook says two unexplained absences cost a volunteer their
 * booking rights for thirty days. Nothing in the system had ever set the
 * 'absent' status, so that count was permanently zero and the rule applied to
 * nobody -- a promise printed in the handbook that the software could not keep.
 *
 * This screen reports; the coordinator decides. A missing check-in is evidence
 * somebody did not check in, which is not evidence they did not come: phones
 * lose signal inside kennel buildings and people forget. Marking an unpaid
 * volunteer absent by inference, when the rule ends in losing their place, is
 * not a judgement worth automating to save a click.
 *
 * The running absence count travels with each row on purpose, so the person
 * deciding can see that this would be someone's second miss before making it
 * their second -- and when a click does cross the threshold, the answer says so,
 * because a suspension the coordinator did not notice causing is one they cannot
 * reconsider.
 */
import React, { useEffect, useState } from 'react';
import { ClipboardCheck, Loader2, Check, UserX, AlertTriangle, CalendarDays, Handshake } from 'lucide-react';
import { authFetch } from '../utils/session';
import { resolveZone } from '../data/zones';

interface ExpectedPerson {
  signupId: string;
  volunteerName: string;
  volunteerEmail: string;
  status: string;
  checkedIn: boolean;
  checkInTime?: string;
  reviewedBy?: string;
  absencesSoFar: number;
  /** Set when this person asked for a substitute and nobody took it. */
  unfilledRequest?: { reason: string; raisedLate: boolean; createdAtUtc: string };
}

interface RollCallShift {
  shiftId: string;
  shiftTitle: string;
  zoneId: string;
  timeRange: string;
  expected: ExpectedPerson[];
}

interface RollCallPanelProps {
  onToast: (message: string) => void;
  /** Lets App re-pull shifts and signups after an outcome is recorded. */
  onChanged?: () => void;
}

/** Taiwan-local YYYY-MM-DD, matching how shifts store their date. */
const shelterToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });

export const RollCallPanel: React.FC<RollCallPanelProps> = ({ onToast, onChanged }) => {
  const [date, setDate] = useState(shelterToday);
  const [shifts, setShifts] = useState<RollCallShift[]>([]);
  const [summary, setSummary] = useState({ expected: 0, arrived: 0, unresolved: 0 });
  const [threshold, setThreshold] = useState(2);
  const [isLoading, setIsLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<string[]>([]);

  const load = React.useCallback((forDate: string) => {
    setIsLoading(true);
    return authFetch(`/api/admin/roll-call?date=${encodeURIComponent(forDate)}`)
      .then(res => res.json())
      .then(data => {
        if (!data.success) return;
        setShifts(data.shifts);
        setSummary(data.summary);
        if (typeof data.absenceThreshold === 'number') setThreshold(data.absenceThreshold);
      })
      .catch(() => onToast('⚠️ 讀取點名表失敗，請稍後再試。'))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const record = async (person: ExpectedPerson, status: 'attended' | 'absent') => {
    if (busyIds.includes(person.signupId)) return;
    setBusyIds(prev => [...prev, person.signupId]);
    try {
      const res = await authFetch(`/api/shift-signups/${encodeURIComponent(person.signupId)}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          reviewNotes: status === 'absent' ? '點名確認未到' : '點名確認到勤'
        })
      });
      const data = await res.json();
      if (!data.success) { onToast(`⚠️ ${data.error || '記錄失敗'}`); return; }
      // Whether the rule fired is the server's answer, not this screen's guess
      // from the count it happens to be holding.
      if (data.suspension) {
        onToast(
          `已記錄【${person.volunteerName}】未到（累計 ${data.suspension.absences} 次），` +
          `依規章已暫停其搶班權限並以 LINE 通知本人。可到「志工名冊」恢復。`
        );
      } else {
        onToast(status === 'absent'
          ? `已記錄【${person.volunteerName}】未到（累計第 ${person.absencesSoFar + 1} 次）`
          : `已記錄【${person.volunteerName}】到勤`);
      }
      await load(date);
      onChanged?.();
    } catch {
      onToast('⚠️ 無法連線，這次的記錄尚未儲存。');
    } finally {
      setBusyIds(prev => prev.filter(id => id !== person.signupId));
    }
  };

  const totalRows = shifts.reduce((n, s) => n + s.expected.length, 0);

  return (
    <div className="bg-white p-6 rounded-[28px] border border-[#716053] shadow-xs space-y-5">

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#716053] text-white flex items-center justify-center shrink-0">
            <ClipboardCheck className="w-5 h-5 text-amber-300" />
          </div>
          <div>
            <h3 className="text-lg font-bold font-serif italic text-slate-900">當日點名與出勤確認</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              確認錄取的志工是否到場。未簽到不等於未到場——手機在園區內常常沒訊號，請由督導判斷後再記錄。
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 shrink-0">
          <CalendarDays className="w-4 h-4 text-slate-400" />
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-300 text-sm"
          />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
          <p className="text-[11px] text-slate-500 font-bold">應到</p>
          <p className="text-lg font-bold tabular-nums text-slate-900">{summary.expected}</p>
        </div>
        <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-200">
          <p className="text-[11px] text-emerald-700 font-bold">已簽到</p>
          <p className="text-lg font-bold tabular-nums text-emerald-900">{summary.arrived}</p>
        </div>
        <div className={`rounded-xl p-3 border ${summary.unresolved > 0 ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-200'}`}>
          <p className={`text-[11px] font-bold ${summary.unresolved > 0 ? 'text-amber-800' : 'text-slate-500'}`}>待確認</p>
          <p className={`text-lg font-bold tabular-nums ${summary.unresolved > 0 ? 'text-amber-900' : 'text-slate-900'}`}>
            {summary.unresolved}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="py-10 flex items-center justify-center text-slate-400 text-sm gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>載入點名表中...</span>
        </div>
      ) : totalRows === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">
          這一天沒有錄取的志工，不需要點名。
        </p>
      ) : (
        <div className="space-y-4">
          {shifts.filter(shift => shift.expected.length > 0).map(shift => {
            const zone = resolveZone(shift.zoneId);
            return (
              <div key={shift.shiftId} className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-lg">{zone.icon}</span>
                  <span className="font-bold text-sm text-slate-800">{shift.shiftTitle}</span>
                  <span className="text-[11px] font-mono text-slate-500">{shift.timeRange}</span>
                </div>

                {shift.expected.map(person => {
                  const isBusy = busyIds.includes(person.signupId);
                  const settled = person.status === 'attended' || person.status === 'absent';
                  return (
                    <div
                      key={person.signupId}
                      className={`flex items-center gap-3 p-3 rounded-2xl border ${
                        person.status === 'absent'
                          ? 'border-rose-200 bg-rose-50'
                          : person.status === 'attended'
                            ? 'border-emerald-200 bg-emerald-50'
                            : person.checkedIn
                              ? 'border-emerald-200 bg-white'
                              : 'border-amber-300 bg-amber-50/50'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-slate-800">{person.volunteerName}</span>
                          {person.checkedIn ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold">
                              已簽到 {person.checkInTime?.slice(11, 16)}
                            </span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">
                              無簽到紀錄
                            </span>
                          )}
                          {person.status === 'absent' && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-600 text-white font-bold">
                              已記錄未到
                            </span>
                          )}
                          {person.status === 'attended' && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-600 text-white font-bold">
                              已確認到勤
                            </span>
                          )}
                        </div>
                        {person.unfilledRequest && (
                          <div className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-violet-50 border border-violet-200">
                            <p className="text-[11px] text-violet-900 font-bold flex items-center gap-1 flex-wrap">
                              <Handshake className="w-3 h-3 shrink-0" />
                              <span>曾發起代班請求，但沒有夥伴接手</span>
                              {person.unfilledRequest.raisedLate && (
                                <span className="px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">
                                  未滿 24 小時
                                </span>
                              )}
                            </p>
                            {person.unfilledRequest.reason && (
                              <p className="text-[11px] text-violet-700 mt-0.5">
                                原因：{person.unfilledRequest.reason}
                              </p>
                            )}
                          </div>
                        )}

                        <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 flex-wrap">
                          {person.absencesSoFar > 0 && (
                            <span className={`flex items-center gap-1 font-bold ${
                              person.absencesSoFar >= 2 ? 'text-rose-700' : 'text-amber-700'
                            }`}>
                              <AlertTriangle className="w-3 h-3" />
                              累計未到 {person.absencesSoFar} 次
                            </span>
                          )}
                          {person.reviewedBy && <span>由 {person.reviewedBy} 記錄</span>}
                        </div>
                      </div>

                      {!settled && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => record(person, 'attended')}
                            disabled={isBusy}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 transition"
                          >
                            <Check className="w-3.5 h-3.5" /> 有到
                          </button>
                          <button
                            onClick={() => record(person, 'absent')}
                            disabled={isBusy}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white border border-rose-300 text-rose-700 text-xs font-bold hover:bg-rose-50 disabled:opacity-50 transition"
                          >
                            <UserX className="w-3.5 h-3.5" /> 未到
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-slate-400 border-t border-slate-100 pt-3">
        記錄為「未到」會累計在該志工的缺席次數上；累計滿 {threshold} 次會依規章自動暫停其搶班權限，並以 LINE 通知本人。
        停權為 30 天，期滿自動恢復，督導也可在「志工名冊」提早恢復；恢復時缺席次數會重新計算。停權不影響已累積的服務時數與出勤紀錄。
        標示「曾發起代班請求」的夥伴事先告知過但沒人接手 —— 這跟直接沒出現不是同一件事，請斟酌後再記錄。
      </p>
    </div>
  );
};
