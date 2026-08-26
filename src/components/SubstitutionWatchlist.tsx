/**
 * Shifts that are asking for cover and have not found any.
 *
 * The volunteers' own board (SubstitutionBoard) is where a request gets
 * answered. This is where it gets noticed: without it a coordinator's first
 * sight of an unanswered request is the roll call, which happens on the day,
 * by which point the only thing left to decide is whether to record an absence.
 *
 * Read-only on purpose. Filling the gap is a phone call, a message to the
 * group, or the urgent-callout broadcast that already exists -- all of which a
 * coordinator does better than a button would.
 */
import React from 'react';
import { Handshake, AlertTriangle, Clock, CalendarDays } from 'lucide-react';
import { resolveZone } from '../data/zones';
import { timeUntilLabel } from '../utils/shiftTime';
import type { OpenSubstitution } from './SubstitutionBoard';

interface SubstitutionWatchlistProps {
  requests: OpenSubstitution[];
}

export const SubstitutionWatchlist: React.FC<SubstitutionWatchlistProps> = ({ requests }) => {
  // Soonest first: the one starting in three hours is the one to act on, not
  // the one raised earliest.
  const sorted = [...requests].sort((a, b) => (a.hoursUntil ?? 1e9) - (b.hoursUntil ?? 1e9));
  const urgent = sorted.filter(r => r.raisedLate).length;

  return (
    <div className="bg-white p-6 rounded-[28px] border border-[#716053] shadow-xs space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-[#716053] text-white flex items-center justify-center shrink-0">
          <Handshake className="w-5 h-5 text-amber-300" />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-bold font-serif italic text-slate-900">待接手的代班請求</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            志工已提出無法出席，但還沒有夥伴接手的班次。志工端看得到這些，還缺人時可以再推一次急召。
          </p>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-6">
          目前沒有待接手的代班請求。
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
              <p className="text-[11px] text-slate-500 font-bold">待接手</p>
              <p className="text-lg font-bold tabular-nums text-slate-900">{sorted.length}</p>
            </div>
            <div className={`rounded-xl p-3 border ${urgent > 0 ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-200'}`}>
              <p className={`text-[11px] font-bold ${urgent > 0 ? 'text-amber-800' : 'text-slate-500'}`}>
                未滿 24 小時
              </p>
              <p className={`text-lg font-bold tabular-nums ${urgent > 0 ? 'text-amber-900' : 'text-slate-900'}`}>
                {urgent}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {sorted.map(request => {
              const zone = resolveZone(request.shift.zone);
              return (
                <div
                  key={request.id}
                  className={`p-3 rounded-2xl border ${
                    request.raisedLate ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base">{zone.icon}</span>
                    <span className="font-bold text-sm text-slate-800">{request.shift.title}</span>
                    <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1">
                      <CalendarDays className="w-3 h-3" />
                      {request.shift.date}
                    </span>
                    <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {request.shift.timeRange}
                    </span>
                    {request.hoursUntil !== null && (
                      <span className={`text-[11px] font-bold ${
                        request.raisedLate ? 'text-amber-800' : 'text-slate-500'
                      }`}>
                        {timeUntilLabel(request.hoursUntil)}
                      </span>
                    )}
                    {request.raisedLate && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 font-bold flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        未滿 24 小時
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1">
                    由 <strong>{request.requesterName}</strong> 提出
                    {request.reason && <span>：{request.reason}</span>}
                  </p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
