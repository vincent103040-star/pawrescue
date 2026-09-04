/**
 * Shifts other volunteers cannot make, and the button that covers one.
 *
 * The rulebook told volunteers to raise a substitution request 24 hours before
 * a shift they could not attend. There was nowhere to raise one and nowhere to
 * answer one, so in practice the only route out of a booking was to cancel it:
 * the place came free silently, nobody was asked, and the shelter found out
 * when it found out.
 *
 * This is the answering half. Taking a shift here is immediate rather than
 * queued for approval, because a substitution is usually short notice, and a
 * cover that waits on a coordinator checking their phone is a cover that
 * arrives after the shift.
 */
import React from 'react';
import { Handshake, Clock, AlertTriangle, Loader2, CalendarDays } from 'lucide-react';
import { SubstitutionRequest } from '../types';
import { resolveZone } from '../data/zones';
import { timeUntilLabel } from '../utils/shiftTime';
import { ListSkeleton } from './ListSkeleton';

/**
 * A request as the list endpoint sends it: the stored record plus the bits of
 * the shift needed to draw it.
 *
 * It extends the stored shape rather than restating a subset, so that fields
 * the board does not draw -- signupId, which the volunteer's own shift list
 * matches on -- are still carried and still typed. Declaring a narrower shape
 * here meant passing this to that list needed a cast, and a cast is how the
 * field goes missing later without anything complaining.
 */
export interface OpenSubstitution extends SubstitutionRequest {
  hoursUntil: number | null;
  shift: { id: string; title: string; zone: string; date: string; timeRange: string };
}

interface SubstitutionBoardProps {
  requests: OpenSubstitution[];
  /** The signed-in volunteer, so their own requests are not offered back to them. */
  myEmail: string;
  busyId?: string | null;
  onTake: (requestId: string) => void;
  /** 初次載入還沒有結果——用來避免在資料回來之前就宣告「沒有代班請求」。 */
  isLoading?: boolean;
}

export const SubstitutionBoard: React.FC<SubstitutionBoardProps> = ({
  requests, myEmail, busyId, onTake, isLoading = false
}) => {
  const mine = String(myEmail || '').trim().toLowerCase();
  const takeable = requests.filter(r => r.requesterEmail !== mine);

  return (
    <div className="bg-white rounded-[28px] p-6 border border-[#716053] shadow-xs space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-[#716053] text-white flex items-center justify-center shrink-0">
          <Handshake className="w-5 h-5 text-amber-300" />
        </div>
        <div>
          <h3 className="text-lg font-bold font-serif italic text-slate-900">夥伴需要代班</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            這些班次原本有人報名，但臨時無法出席。接下來的話，班次會直接加進您的排班。
          </p>
        </div>
      </div>

      {isLoading ? (
        <ListSkeleton count={2} columns={1} />
      ) : takeable.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">
          目前沒有待接手的代班請求 —— 大家的班都有人顧著 🐾
        </p>
      ) : (
        <div className="space-y-3">
          {takeable.map(request => {
            const zone = resolveZone(request.shift.zone);
            const isBusy = busyId === request.id;
            return (
              <div
                key={request.id}
                className={`p-4 rounded-2xl border ${
                  request.raisedLate ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg">{zone.icon}</span>
                      <span className="font-bold text-sm text-slate-900">{request.shift.title}</span>
                      {request.raisedLate && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 font-bold flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          急件
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-slate-600 flex-wrap">
                      <span className="flex items-center gap-1">
                        <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
                        {request.shift.date}
                      </span>
                      <span className="flex items-center gap-1 font-mono">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        {request.shift.timeRange}
                      </span>
                      {request.hoursUntil !== null && (
                        <span className={request.raisedLate ? 'text-amber-800 font-bold' : 'text-slate-500'}>
                          {timeUntilLabel(request.hoursUntil)}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-500">
                      由 <strong className="text-slate-700">{request.requesterName}</strong> 發起
                      {request.reason && <span>：{request.reason}</span>}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onTake(request.id)}
                    disabled={isBusy}
                    className="shrink-0 px-4 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold shadow-2xs transition flex items-center gap-1.5 cursor-pointer"
                  >
                    {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Handshake className="w-3.5 h-3.5" />}
                    <span>我可以代</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-slate-400 border-t border-slate-100 pt-3">
        接下代班後會直接錄取，不需要再等審核，發起的夥伴也會收到 LINE 通知。請記得當天準時到場並掃碼簽到。
      </p>
    </div>
  );
};
