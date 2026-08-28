/**
 * What this volunteer is here to do today.
 *
 * The duty board existed only inside the coordinator's dashboard, so a
 * volunteer standing in a kennel had no way to find out what the shelter
 * needed from them beyond asking somebody. The handbook told them they could
 * "在首頁看到當日值班要做的勤務項目" -- which was not true of any screen they
 * could reach.
 *
 * Scoped by the server to the zones of their own approved shifts today: every
 * zone's checklist would bury the three things that are actually theirs, and
 * invite them to tick off work in an area they never entered.
 */
import React, { useState, useEffect } from 'react';
import {
  ClipboardCheck, CheckSquare, Square, Clock, Loader2,
  PlayCircle, BookOpen, CheckCircle2
} from 'lucide-react';
import { authFetch } from '../utils/session';
import { resolveZone } from '../data/zones';
import { DutyMaterialModal, DutyMaterial } from './DutyMaterialModal';

interface Duty {
  id: string;
  zoneId: string;
  title: string;
  description: string;
  category: string;
  isRequired: boolean;
  timeWindow: string;
  isCompleted: boolean;
  completedBy?: string;
  completionShiftId: string;
  material?: DutyMaterial | null;
}

interface VolunteerDutyBoardProps {
  onToast: (message: string) => void;
}

export const VolunteerDutyBoard: React.FC<VolunteerDutyBoardProps> = ({ onToast }) => {
  const [duties, setDuties] = useState<Duty[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [viewing, setViewing] = useState<Duty | null>(null);

  const load = React.useCallback(() => {
    setIsLoading(true);
    return authFetch('/api/duties/today')
      .then(res => res.json())
      .then(data => { if (data.success) setDuties(data.duties); })
      .catch(() => { /* leave whatever is on screen */ })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (duty: Duty) => {
    if (busyIds.includes(duty.id)) return;
    setBusyIds(prev => [...prev, duty.id]);
    const path = duty.isCompleted ? 'uncomplete' : 'complete';
    try {
      const res = await authFetch(`/api/duties/${encodeURIComponent(duty.id)}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftId: duty.completionShiftId || '' })
      });
      const data = await res.json();
      if (!data.success) { onToast(`⚠️ ${data.error || '更新失敗'}`); return; }
      await load();
    } catch {
      onToast('⚠️ 無法連線，這次的核銷尚未儲存。');
    } finally {
      setBusyIds(prev => prev.filter(id => id !== duty.id));
    }
  };

  // Nothing to show is the normal case on a day off, and an empty checklist
  // saying "0 / 0 完成" would read like a failure rather than a rest day.
  if (!isLoading && duties.length === 0) return null;

  const done = duties.filter(d => d.isCompleted).length;

  return (
    <div className="bg-white p-6 rounded-[28px] border border-[#716053] shadow-xs space-y-4">

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#716053] text-white flex items-center justify-center shrink-0">
            <ClipboardCheck className="w-5 h-5 text-amber-300" />
          </div>
          <div>
            <h3 className="text-lg font-bold font-serif italic text-slate-900">今日勤務</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              您今天班次場域要做的工作。完成一項就勾一項，社工端會同步看到。
            </p>
          </div>
        </div>
        <span className={`shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full border ${
          done === duties.length
            ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
            : 'bg-slate-100 text-slate-700 border-slate-300'
        }`}>
          {done} / {duties.length} 完成
        </span>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-400 flex items-center gap-2 py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> 載入今日勤務…
        </p>
      ) : (
        <div className="space-y-2">
          {duties.map(duty => {
            const zone = resolveZone(duty.zoneId);
            const isBusy = busyIds.includes(duty.id);
            return (
              <div
                key={duty.id}
                className={`p-3 rounded-2xl border ${
                  duty.isCompleted ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => toggle(duty)}
                    disabled={isBusy}
                    className="shrink-0 mt-0.5 disabled:opacity-50 cursor-pointer"
                    aria-label={duty.isCompleted ? '取消核銷' : '標記完成'}
                  >
                    {isBusy
                      ? <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                      : duty.isCompleted
                        ? <CheckSquare className="w-5 h-5 text-emerald-600" />
                        : <Square className="w-5 h-5 text-slate-400" />}
                  </button>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>{zone.icon}</span>
                      <span className={`font-bold text-sm ${
                        duty.isCompleted ? 'line-through text-slate-400' : 'text-slate-900'
                      }`}>
                        {duty.title}
                      </span>
                      {duty.isRequired && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold">
                          必做
                        </span>
                      )}
                      {duty.timeWindow && (
                        <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />{duty.timeWindow}
                        </span>
                      )}
                    </div>

                    {duty.description && (
                      <p className="text-xs text-slate-600 leading-relaxed">{duty.description}</p>
                    )}

                    {duty.material && (duty.material.section || duty.material.video) && (
                      <button
                        type="button"
                        onClick={() => setViewing(duty)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 text-[11px] font-bold hover:bg-indigo-100 transition cursor-pointer"
                      >
                        {duty.material.video
                          ? <PlayCircle className="w-3.5 h-3.5" />
                          : <BookOpen className="w-3.5 h-3.5" />}
                        <span>{duty.material.video ? '先看示範（30 秒）' : '先看規範'}</span>
                      </button>
                    )}

                    {duty.isCompleted && duty.completedBy && (
                      <p className="text-[10px] text-emerald-700 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        由 {duty.completedBy} 核銷
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-slate-400 border-t border-slate-100 pt-3">
        現場如果有督導臨時交辦的任務，以督導的安排為準——這份清單只涵蓋固定登記的勤務。
      </p>

      {viewing?.material && (
        <DutyMaterialModal
          title={viewing.title}
          material={viewing.material}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
};
