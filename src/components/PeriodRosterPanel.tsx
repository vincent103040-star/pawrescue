/**
 * Produces a whole period's shifts from the shelter's daily care work.
 *
 * The plan calls this the main source of relief. Before it, publishing a
 * fortnight meant filling in one form per shift per day; the numbers were
 * already written down as duty items, but nothing turned them into a roster.
 *
 * The flow is deliberately three steps -- 試算 / 產生草稿 / 發布 -- rather than
 * one button. Volunteers must not see a shift the shelter has not agreed to
 * run: a booking that is later withdrawn costs exactly the trust the whole
 * system is trying to build. So generation stops at drafts, and publishing is
 * a separate decision somebody makes on purpose.
 */
import React, { useState } from 'react';
import {
  CalendarRange, Sparkles, Send, Trash2, Loader2, AlertTriangle, Clock, Users
} from 'lucide-react';
import { authFetch } from '../utils/session';
import { resolveZone } from '../data/zones';

interface PlannedShift {
  zoneId: string;
  zoneName: string;
  date: string;
  timeRange: string;
  requiredCount: number;
  tasks: string[];
  personHours: number;
}

interface PeriodRosterPanelProps {
  onToast: (message: string) => void;
  /** Lets App re-pull shifts once drafts are created or published. */
  onChanged?: () => void;
  /** Drafts already sitting in the system, so the panel can offer to publish them. */
  draftCount: number;
}

const shelterToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });

export const PeriodRosterPanel: React.FC<PeriodRosterPanelProps> = ({
  onToast, onChanged, draftCount
}) => {
  const [startDate, setStartDate] = useState(shelterToday);
  const [days, setDays] = useState(14);
  const [planned, setPlanned] = useState<PlannedShift[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const call = async (path: string, label: string) => {
    setBusy(label);
    try {
      const res = await authFetch(`/api/admin/schedule/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, days })
      });
      return await res.json();
    } catch {
      onToast('⚠️ 無法連線，這次操作沒有完成。');
      return null;
    } finally {
      setBusy(null);
    }
  };

  const handlePreview = async () => {
    const data = await call('preview', 'preview');
    if (!data?.success) { if (data) onToast(`⚠️ ${data.error || '試算失敗'}`); return; }
    setPlanned(data.planned);
    if (data.planned.length === 0) {
      onToast('這段期間算不出任何班次 —— 請先在「勤務項目」為各場域設定每日工作與時間。');
    }
  };

  const handleGenerate = async () => {
    const data = await call('generate', 'generate');
    if (!data?.success) { if (data) onToast(`⚠️ ${data.error || '產生失敗'}`); return; }
    onToast(data.created.length === 0
      ? `這段期間的班次都已存在，沒有新增任何草稿（略過 ${data.skipped.length} 個）。`
      : `✅ 已產生 ${data.created.length} 個班次草稿${data.skipped.length ? `（略過已存在的 ${data.skipped.length} 個）` : ''}。志工還看不到，確認後再發布。`);
    setPlanned(null);
    onChanged?.();
  };

  const handlePublish = async () => {
    const data = await call('publish', 'publish');
    if (!data?.success) { if (data) onToast(`⚠️ ${data.error || '發布失敗'}`); return; }
    onToast(data.published === 0
      ? '這段期間沒有待發布的草稿。'
      : `📣 已發布 ${data.published} 個班次，志工現在看得到並可以報名了。`);
    onChanged?.();
  };

  const handleDiscard = async () => {
    const data = await call('discard', 'discard');
    if (!data?.success) { if (data) onToast(`⚠️ ${data.error || '清除失敗'}`); return; }
    onToast(data.discarded === 0
      ? '這段期間沒有草稿可以清除。'
      : `🗑️ 已清除 ${data.discarded} 個未發布的草稿。已發布的班次不受影響。`);
    setPlanned(null);
    onChanged?.();
  };

  const byDate = new Map<string, PlannedShift[]>();
  for (const shift of planned || []) {
    byDate.set(shift.date, [...(byDate.get(shift.date) || []), shift]);
  }
  const totalPeople = (planned || []).reduce((n, s) => n + s.requiredCount, 0);
  const totalHours = Math.round((planned || []).reduce((n, s) => n + s.personHours, 0) * 10) / 10;

  return (
    <div className="bg-white p-6 rounded-[28px] border border-[#716053] shadow-xs space-y-5">

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#716053] text-white flex items-center justify-center shrink-0">
            <CalendarRange className="w-5 h-5 text-amber-300" />
          </div>
          <div>
            <h3 className="text-lg font-bold font-serif italic text-slate-900">整期自動產生班表</h3>
            <p className="text-xs text-slate-500 mt-0.5 max-w-xl">
              依各場域「勤務項目」裡登記的每日工作、時間與人力，一次算出整期班表。
              產生的是<strong>草稿</strong>——志工看不到，也不能報名，確認後再發布。
            </p>
          </div>
        </div>

        {draftCount > 0 && (
          <span className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
            目前有 {draftCount} 個未發布草稿
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-slate-500">起始日期</span>
          <input
            type="date"
            value={startDate}
            onChange={e => { setStartDate(e.target.value); setPlanned(null); }}
            className="px-3 py-2 rounded-xl border border-slate-300 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-slate-500">期間長度</span>
          <select
            value={days}
            onChange={e => { setDays(Number(e.target.value)); setPlanned(null); }}
            className="px-3 py-2 rounded-xl border border-slate-300 text-sm font-bold"
          >
            <option value={7}>一週（7 天）</option>
            <option value={14}>兩週（14 天）</option>
            <option value={28}>四週（28 天）</option>
          </select>
        </label>

        <button
          type="button"
          onClick={handlePreview}
          disabled={!!busy}
          className="px-4 py-2 rounded-full bg-[#716053] hover:bg-[#5A4A3F] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
        >
          {busy === 'preview' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-amber-300" />}
          <span>先試算看看</span>
        </button>
      </div>

      {planned && planned.length > 0 && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
              <p className="text-[11px] text-slate-500 font-bold">班次數</p>
              <p className="text-lg font-bold tabular-nums text-slate-900">{planned.length}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
              <p className="text-[11px] text-slate-500 font-bold">需求人次</p>
              <p className="text-lg font-bold tabular-nums text-slate-900">{totalPeople}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
              <p className="text-[11px] text-slate-500 font-bold">預計工時</p>
              <p className="text-lg font-bold tabular-nums text-slate-900">{totalHours}h</p>
            </div>
          </div>

          {/* One day is enough to check the rule; the rest repeat it. */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <p className="text-[11px] font-bold text-slate-500 bg-slate-50 px-3 py-2 border-b border-slate-200">
              第一天（{[...byDate.keys()][0]}）的內容 —— 其餘每天相同
            </p>
            <div className="divide-y divide-slate-100">
              {(byDate.get([...byDate.keys()][0]) || []).map((shift, i) => {
                const zone = resolveZone(shift.zoneId);
                return (
                  <div key={i} className="p-3 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>{zone.icon}</span>
                      <span className="font-bold text-sm text-slate-800">{shift.zoneName}</span>
                      <span className="text-[11px] font-mono text-slate-600 flex items-center gap-1">
                        <Clock className="w-3 h-3" />{shift.timeRange}
                      </span>
                      <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                        <Users className="w-3 h-3" />{shift.requiredCount} 人
                      </span>
                      <span className="text-[11px] text-slate-400">實際工時 {shift.personHours}h</span>
                    </div>
                    <p className="text-[11px] text-slate-500">{shift.tasks.join('、')}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-[11px] text-slate-500">
            人數是「同一時刻最多需要幾人」，不是把各項勤務加總——依序進行的三項工作，一個人就做得完。
          </p>
        </div>
      )}

      {planned && planned.length === 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-900">
            算不出任何班次。請先到「勤務項目」為各場域登記每日工作，並且<strong>填寫時間範圍</strong>（例如 09:00 - 11:30）——
            沒有時間範圍的勤務無法排進班表。
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!!busy}
          className="px-4 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
        >
          {busy === 'generate' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarRange className="w-3.5 h-3.5" />}
          <span>產生草稿</span>
        </button>

        <button
          type="button"
          onClick={handlePublish}
          disabled={!!busy}
          className="px-4 py-2 rounded-full bg-[#716053] hover:bg-[#5A4A3F] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
        >
          {busy === 'publish' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5 text-amber-300" />}
          <span>發布這一期</span>
        </button>

        <button
          type="button"
          onClick={handleDiscard}
          disabled={!!busy}
          className="px-3 py-2 rounded-full bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
        >
          {busy === 'discard' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          <span>清除草稿</span>
        </button>
      </div>

      <p className="text-[11px] text-slate-400">
        重複產生不會建立重複的班次——同場域、同日期、同時段已經有班次的話會直接略過，
        所以您手動調整過的班次不會被蓋掉。「清除草稿」只會刪除尚未發布的，已發布或已有人報名的都不受影響。
      </p>
    </div>
  );
};
