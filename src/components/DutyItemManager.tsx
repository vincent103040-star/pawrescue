/**
 * Editing the shelter's duty items, and reading the workload that falls out of
 * them.
 *
 * One screen for two things that are really the same data. A duty item says
 * what has to be done, where, by whom and how often; the same row's
 * requiredPeople and estimatedMinutes are what the roster calculation needs to
 * work out how many volunteers a fortnight takes. Asking the shelter to
 * describe its work once, rather than once as a checklist and again as a
 * staffing estimate, is the whole point.
 *
 * Like zones, items are disabled rather than deleted -- completion records
 * point at them and have to keep resolving.
 */
import React, { useEffect, useState } from 'react';
import {
  ClipboardList, Plus, Pencil, EyeOff, Eye, Loader2, X, Check,
  AlertTriangle, Users, Clock, CalendarRange
} from 'lucide-react';
import { authFetch } from '../utils/session';
import { parseWeekdays, describeWeekdays, WEEKDAY_NAMES, WEEKDAY_DISPLAY_ORDER } from '../utils/weekdays';
import { resolveZone, type ZoneRecord } from '../data/zones';

interface DutyItem {
  id: string;
  zoneId: string;
  title: string;
  description: string;
  category: string;
  triggerType: 'daily' | 'zone_shift' | 'specific_shift';
  /** Which shift a one-off duty belongs to. Empty for recurring ones. */
  shiftId: string;
  responsibleRole: 'staff' | 'volunteer';
  requiredPeople: number;
  estimatedMinutes: number;
  startTime: string;
  endTime: string;
  /** "0,6" -- 0 is Sunday. Empty means every day. */
  weekdays: string;
  /** Composed by the server from startTime/endTime, for display only. */
  timeWindow: string;
  /** Optional teaching material shown to the volunteer before they tick it off. */
  sopSectionId: string;
  sopVideoId: string;
  isRequired: boolean;
  status: 'active' | 'disabled';
  sortOrder: number;
}

interface WorkloadRow {
  zoneId: string;
  zoneName: string;
  zoneCode: string;
  items: number;
  personSlots: number;
  personHours: number;
}

interface DutyItemManagerProps {
  zones: ZoneRecord[];
  onToast: (message: string) => void;
}

const EMPTY_DRAFT = {
  zoneId: '',
  title: '',
  description: '',
  category: '',
  triggerType: 'daily' as DutyItem['triggerType'],
  responsibleRole: 'volunteer' as DutyItem['responsibleRole'],
  requiredPeople: 1,
  estimatedMinutes: 30,
  startTime: '',
  endTime: '',
  weekdays: '',
  timeWindow: '',
  sopSectionId: '',
  sopVideoId: '',
  shiftId: '',
  isRequired: true
};

const WEEKDAYS = WEEKDAY_DISPLAY_ORDER.map(value => ({ value, label: WEEKDAY_NAMES[value] }));

const TRIGGER_LABELS: Record<DutyItem['triggerType'], string> = {
  daily: '每天固定',
  zone_shift: '該場域有班次時',
  specific_shift: '指定班次'
};

const ROLE_LABELS: Record<DutyItem['responsibleRole'], string> = {
  staff: '管理端／督導',
  volunteer: '志工'
};

export const DutyItemManager: React.FC<DutyItemManagerProps> = ({ zones, onToast }) => {
  const [items, setItems] = useState<DutyItem[]>([]);
  const [workload, setWorkload] = useState<WorkloadRow[]>([]);
  const [totals, setTotals] = useState({ personSlots: 0, personHours: 0 });
  const [fortnight, setFortnight] = useState({ personSlots: 0, personHours: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [confirmDisable, setConfirmDisable] = useState<DutyItem | null>(null);
  const [showFinishedOneOffs, setShowFinishedOneOffs] = useState(false);

  /**
   * The material a duty can point at.
   *
   * Fetched here so the picker offers what actually exists rather than asking
   * a coordinator to remember ids. A duty whose material was later deleted
   * still stores the id; the server resolves it to null, so the volunteer sees
   * no link rather than a broken one.
   */
  const [materials, setMaterials] = useState<{
    sections: Array<{ id: string; title: string }>;
    videos: Array<{ id: string; title: string }>;
  }>({ sections: [], videos: [] });

  /**
   * Shifts, so a one-off duty can name the one it belongs to and the list can
   * tell a task that is still coming from one whose day has passed.
   */
  const [shifts, setShifts] = useState<Array<{ id: string; title: string; date: string; timeRange: string; zone: string }>>([]);

  useEffect(() => {
    authFetch('/api/shifts')
      .then(res => res.json())
      .then(data => { if (data.success) setShifts(data.shifts); })
      .catch(() => { /* the picker just stays empty */ });
  }, []);

  useEffect(() => {
    authFetch('/api/sop-content')
      .then(res => res.json())
      .then(data => {
        if (!data.success) return;
        setMaterials({
          sections: (data.content?.sections || []).map((x: any) => ({ id: x.id, title: x.title })),
          videos: (data.videos || []).map((x: any) => ({ id: x.id, title: x.title }))
        });
      })
      .catch(() => { /* the pickers just stay empty */ });
  }, []);

  const load = async () => {
    setIsLoading(true);
    try {
      const [itemsRes, workloadRes] = await Promise.all([
        authFetch('/api/duty-items').then(r => r.json()),
        authFetch('/api/admin/workload').then(r => r.json())
      ]);
      if (itemsRes.success) setItems(itemsRes.dutyItems);
      if (workloadRes.success) {
        setWorkload(workloadRes.workload);
        setTotals(workloadRes.daily);
        setFortnight(workloadRes.fortnight);
      }
    } catch {
      onToast('⚠️ 讀取勤務項目失敗，請稍後再試。');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const startAdd = () => { setDraft(EMPTY_DRAFT); setIsAdding(true); setEditingId(null); };
  const startEdit = (item: DutyItem) => {
    setDraft({
      zoneId: item.zoneId, title: item.title, description: item.description,
      category: item.category, triggerType: item.triggerType,
      responsibleRole: item.responsibleRole, requiredPeople: item.requiredPeople,
      estimatedMinutes: item.estimatedMinutes,
      startTime: item.startTime || '', endTime: item.endTime || '',
      weekdays: item.weekdays || '', timeWindow: item.timeWindow,
      sopSectionId: item.sopSectionId || '', sopVideoId: item.sopVideoId || '',
      shiftId: item.shiftId || '',
      isRequired: item.isRequired
    });
    setEditingId(item.id);
    setIsAdding(false);
  };
  const cancel = () => { setIsAdding(false); setEditingId(null); setDraft(EMPTY_DRAFT); };

  const save = async () => {
    setIsSaving(true);
    try {
      const url = isAdding ? '/api/admin/duty-items' : `/api/admin/duty-items/${encodeURIComponent(editingId!)}`;
      const res = await authFetch(url, {
        method: isAdding ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      });
      const data = await res.json();
      if (!data.success) { onToast(`⚠️ ${data.error}`); return; }
      onToast(isAdding ? `✅ 已新增勤務【${data.dutyItem.title}】` : `✅ 已更新【${data.dutyItem.title}】`);
      cancel();
      await load();
    } catch {
      onToast('⚠️ 儲存失敗，請確認網路連線。');
    } finally {
      setIsSaving(false);
    }
  };

  const applyStatus = async (item: DutyItem, action: 'disable' | 'restore') => {
    setIsSaving(true);
    try {
      const res = await authFetch(`/api/admin/duty-items/${encodeURIComponent(item.id)}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) { onToast(`⚠️ ${data.error}`); return; }
      onToast(action === 'disable'
        ? `已停用【${item.title}】，既有完成紀錄不受影響。`
        : `✅ 已重新啟用【${item.title}】`);
      setConfirmDisable(null);
      await load();
    } catch {
      onToast('⚠️ 操作失敗，請稍後再試。');
    } finally {
      setIsSaving(false);
    }
  };

  const isEditing = isAdding || editingId !== null;
  const activeZones = zones.filter(zone => zone.status === 'active');
  const everythingIsOnePerson = items.every(item => item.requiredPeople === 1);

  if (isLoading) {
    return (
      <div className="py-16 flex items-center justify-center text-slate-400 text-sm gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>載入勤務設定中...</span>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-[28px] border border-[#716053] shadow-xs space-y-5">

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#716053] text-white flex items-center justify-center shrink-0">
            <ClipboardList className="w-5 h-5 text-amber-300" />
          </div>
          <div>
            <h3 className="text-lg font-bold font-serif italic text-slate-900">勤務項目與照護量</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              登記每個場域固定要做的工作。這份清單同時是志工的今日勤務，也是排班推算人力需求的依據。
            </p>
          </div>
        </div>
        {!isEditing && (
          <button
            onClick={startAdd}
            className="flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-[#716053] text-white text-sm font-bold hover:bg-[#5d4f44] transition shrink-0"
          >
            <Plus className="w-4 h-4" /> 新增勤務
          </button>
        )}
      </div>

      {/* ---------- workload readout ---------- */}
      <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/60 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarRange className="w-4 h-4 text-emerald-700" />
          <span className="text-sm font-bold text-emerald-900">由上面的勤務項目推算出的照護量</span>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="bg-white rounded-xl p-3 border border-emerald-200">
            <p className="text-[11px] text-slate-500 font-bold">平均每日</p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">
              {totals.personSlots} <span className="text-xs font-normal text-slate-500">人次</span>
              <span className="mx-1.5 text-slate-300">/</span>
              {totals.personHours} <span className="text-xs font-normal text-slate-500">小時</span>
            </p>
          </div>
          <div className="bg-white rounded-xl p-3 border border-emerald-300">
            <p className="text-[11px] text-emerald-700 font-bold">兩週合計（班表發布區間）</p>
            <p className="text-lg font-bold text-emerald-900 mt-0.5">
              {fortnight.personSlots} <span className="text-xs font-normal text-emerald-600">人次</span>
              <span className="mx-1.5 text-emerald-300">/</span>
              {fortnight.personHours} <span className="text-xs font-normal text-emerald-600">小時</span>
            </p>
          </div>
        </div>

        {workload.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-emerald-200">
                  <th className="text-left py-1.5 font-bold">場域</th>
                  <th className="text-right py-1.5 font-bold">勤務數</th>
                  <th className="text-right py-1.5 font-bold">兩週人次</th>
                  <th className="text-right py-1.5 font-bold">兩週時數</th>
                </tr>
              </thead>
              <tbody>
                {workload.map(row => (
                  <tr key={row.zoneId || 'all'} className="border-b border-emerald-100 last:border-0">
                    <td className="py-1.5 font-bold text-slate-700">{row.zoneName}</td>
                    <td className="py-1.5 text-right tabular-nums">{row.items}</td>
                    <td className="py-1.5 text-right tabular-nums font-bold">{row.personSlots}</td>
                    <td className="py-1.5 text-right tabular-nums">{row.personHours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {everythingIsOnePerson && items.length > 0 && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
            <strong>目前每項勤務的需求人數都是 1</strong>，那是匯入舊清單時的預設值，不是收容所實際填的。
            填上真實人數之前，上面的合計只是下限而不是估算值。
          </p>
        )}
      </div>

      {/* ---------- add / edit form ---------- */}
      {isEditing && (
        <div className="border-2 border-amber-300 rounded-2xl p-4 bg-amber-50/60 space-y-3">
          <p className="text-sm font-bold text-slate-800">{isAdding ? '新增勤務項目' : '編輯勤務項目'}</p>

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block sm:col-span-2">
              <span className="text-xs font-bold text-slate-600">勤務名稱</span>
              <input
                value={draft.title}
                onChange={e => setDraft({ ...draft, title: e.target.value })}
                placeholder="例如：貓砂盆與貓房地板深層清理"
                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-400"
              />
            </label>

            <label className="block">
              <span className="text-xs font-bold text-slate-600">場域</span>
              <select
                value={draft.zoneId}
                onChange={e => setDraft({ ...draft, zoneId: e.target.value })}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
              >
                <option value="">全園區（不分場域）</option>
                {activeZones.map(zone => (
                  <option key={zone.id} value={zone.id}>{zone.icon} {zone.name}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-bold text-slate-600">分類（顯示用）</span>
              <input
                value={draft.category}
                onChange={e => setDraft({ ...draft, category: e.target.value })}
                placeholder="🐱 貓房照護與親人訓練"
                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-400"
              />
            </label>

            {draft.triggerType === 'specific_shift' && (
              <label className="block sm:col-span-2">
                <span className="text-xs font-bold text-slate-600">屬於哪一個班次</span>
                <select
                  value={draft.shiftId}
                  onChange={e => setDraft({ ...draft, shiftId: e.target.value })}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
                >
                  <option value="">請選擇班次</option>
                  {[...shifts]
                    .filter(shift => shift.date >= new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }))
                    .sort((a, b) => (a.date + a.timeRange).localeCompare(b.date + b.timeRange))
                    .map(shift => (
                      <option key={shift.id} value={shift.id}>
                        {shift.date} {shift.timeRange}・{shift.title}
                      </option>
                    ))}
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  只會在這一個班次出現一次，班次過了就不再出現——<strong>不需要記得回來停用它</strong>。
                </p>
              </label>
            )}

            <div className="block sm:col-span-2 space-y-1">
              <span className="text-xs font-bold text-slate-600">
                出勤前要看的教材 <span className="font-normal text-slate-400">（選填）</span>
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select
                  value={draft.sopSectionId}
                  onChange={e => setDraft({ ...draft, sopSectionId: e.target.value })}
                  className="px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
                >
                  <option value="">不指定手冊章節</option>
                  {materials.sections.map(section => (
                    <option key={section.id} value={section.id}>📖 {section.title}</option>
                  ))}
                </select>
                <select
                  value={draft.sopVideoId}
                  onChange={e => setDraft({ ...draft, sopVideoId: e.target.value })}
                  className="px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
                >
                  <option value="">不指定教學影片</option>
                  {materials.videos.map(video => (
                    <option key={video.id} value={video.id}>🎬 {video.title}</option>
                  ))}
                </select>
              </div>
              <p className="text-[11px] text-slate-400">
                指定之後，志工在勤務看板上打勾前會看到「先看示範」——
                <strong>人不會為了學而學，但會為了「等一下就要做」而看</strong>。
                {materials.videos.length === 0 && '（目前還沒有上傳任何教學影片）'}
              </p>
            </div>

            <label className="block">
              <span className="text-xs font-bold text-slate-600">什麼時候要做</span>
              <select
                value={draft.triggerType}
                onChange={e => setDraft({ ...draft, triggerType: e.target.value as DutyItem['triggerType'] })}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
              >
                <option value="daily">每天固定（不論有無班次）</option>
                <option value="zone_shift">該場域有班次時才出現</option>
                <option value="specific_shift">只有這一次（指定班次）</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-bold text-slate-600">誰負責</span>
              <select
                value={draft.responsibleRole}
                onChange={e => setDraft({ ...draft, responsibleRole: e.target.value as DutyItem['responsibleRole'] })}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
              >
                <option value="volunteer">志工</option>
                <option value="staff">管理端／督導</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-bold text-slate-600">需要幾個人</span>
              <input
                type="number" min={1} max={50}
                value={draft.requiredPeople}
                onChange={e => setDraft({ ...draft, requiredPeople: Number(e.target.value) })}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm tabular-nums"
              />
            </label>

            <label className="block">
              <span className="text-xs font-bold text-slate-600">預估幾分鐘</span>
              <input
                type="number" min={5} max={720} step={5}
                value={draft.estimatedMinutes}
                onChange={e => setDraft({ ...draft, estimatedMinutes: Number(e.target.value) })}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm tabular-nums"
              />
            </label>

            <div className="block sm:col-span-2 space-y-1">
              <span className="text-xs font-bold text-slate-600">
                時段 <span className="font-normal text-slate-400">（排班依據；留空的勤務不會被排進班表）</span>
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Native time inputs: a wheel picker on phones, typeable on a
                    keyboard, and no extra dependency to keep working. */}
                <input
                  type="time"
                  value={draft.startTime}
                  onChange={e => setDraft({ ...draft, startTime: e.target.value })}
                  className="px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono"
                />
                <span className="text-slate-400 text-sm">到</span>
                <input
                  type="time"
                  value={draft.endTime}
                  onChange={e => setDraft({ ...draft, endTime: e.target.value })}
                  className="px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono"
                />
                {draft.startTime && draft.endTime && draft.endTime <= draft.startTime && (
                  <span className="text-[11px] text-rose-700 font-bold">結束時間要晚於開始時間</span>
                )}
              </div>
            </div>

            <div className={`block sm:col-span-2 space-y-1 ${
              draft.triggerType === 'specific_shift' ? 'hidden' : ''
            }`}>
              <span className="text-xs font-bold text-slate-600">
                星期幾要做 <span className="font-normal text-slate-400">（不選＝每天）</span>
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {WEEKDAYS.map(day => {
                  const days = parseWeekdays(draft.weekdays);
                  const on = days.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => {
                        const next = on ? days.filter(d => d !== day.value) : [...days, day.value];
                        setDraft({ ...draft, weekdays: next.sort((a, b) => a - b).join(',') });
                      }}
                      className={`w-9 h-9 rounded-full text-xs font-bold border transition cursor-pointer ${
                        on
                          ? 'bg-[#716053] text-white border-[#716053]'
                          : 'bg-white text-slate-500 border-slate-300 hover:border-[#716053]'
                      }`}
                    >
                      {day.label}
                    </button>
                  );
                })}
                <span className="text-[11px] text-slate-500 ml-1">
                  目前：<strong>{describeWeekdays(draft.weekdays)}</strong>
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                只在特定日子做的工作（例如週六的送養活動）務必選起來——
                不選的話系統會當成每天都要做，人力需求會被高估好幾倍。
              </p>
            </div>

            <label className="flex items-center gap-2 sm:col-span-2 pt-1">
              <input
                type="checkbox"
                checked={draft.isRequired}
                onChange={e => setDraft({ ...draft, isRequired: e.target.checked })}
                className="w-4 h-4 rounded"
              />
              <span className="text-xs font-bold text-slate-600">必做項目（未完成會顯示為缺漏）</span>
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-bold text-slate-600">操作說明（志工會看到）</span>
            <textarea
              value={draft.description}
              onChange={e => setDraft({ ...draft, description: e.target.value })}
              rows={2}
              placeholder="這項工作要注意什麼？"
              className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            />
          </label>

          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 transition"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              儲存
            </button>
            <button
              onClick={cancel}
              className="flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition"
            >
              <X className="w-4 h-4" /> 取消
            </button>
          </div>
        </div>
      )}

      {/* ---------- list ---------- */}
      {(() => {
        // One-off tasks pile up: every "today the yard flooded" ever recorded
        // would sit in this list forever, burying the standing duties that
        // actually describe how the shelter runs. They are kept -- the record
        // of what was asked and whether it was done still matters -- just
        // folded away once their day has passed.
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
        const shiftDate = (id: string) => shifts.find(x => x.id === id)?.date || '';
        const isFinishedOneOff = (item: DutyItem) =>
          item.triggerType === 'specific_shift' &&
          !!item.shiftId &&
          !!shiftDate(item.shiftId) &&
          shiftDate(item.shiftId) < today;
        const finished = items.filter(isFinishedOneOff);
        if (finished.length > 0 && !showFinishedOneOffs) {
          return (
            <button
              type="button"
              onClick={() => setShowFinishedOneOffs(true)}
              className="w-full text-left text-[11px] text-slate-500 hover:text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 cursor-pointer transition"
            >
              已結束的一次性任務（{finished.length}）——點此展開
            </button>
          );
        }
        return null;
      })()}

      <div className="space-y-2">
        {items.filter(item => {
          if (showFinishedOneOffs) return true;
          if (item.triggerType !== 'specific_shift' || !item.shiftId) return true;
          const date = shifts.find(x => x.id === item.shiftId)?.date || '';
          return !date || date >= new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
        }).map(item => {
          const zone = resolveZone(item.zoneId);
          const isDisabled = item.status === 'disabled';
          return (
            <div
              key={item.id}
              className={`flex items-start gap-3 p-3 rounded-2xl border transition ${
                isDisabled ? 'border-slate-200 bg-slate-50 opacity-60' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <span className="text-xl shrink-0 mt-0.5">{item.zoneId ? zone.icon : '🏠'}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-bold text-sm text-slate-800">{item.title}</span>
                  {!item.isRequired && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">選做</span>
                  )}
                  {isDisabled && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">已停用</span>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-wrap mt-1 text-[11px] text-slate-500">
                  <span>{item.zoneId ? zone.name : '全園區'}</span>
                  <span className="flex items-center gap-0.5"><Users className="w-3 h-3" />{item.requiredPeople} 人</span>
                  <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" />{item.estimatedMinutes} 分</span>
                  <span>{TRIGGER_LABELS[item.triggerType]}</span>
                  <span>{ROLE_LABELS[item.responsibleRole]}</span>
                  {item.timeWindow && <span className="font-mono">{item.timeWindow}</span>}
                  <span className={parseWeekdays(item.weekdays).length ? 'font-bold text-[#716053]' : ''}>
                    {describeWeekdays(item.weekdays)}
                  </span>
                  {item.triggerType === 'specific_shift' && item.shiftId && (
                    <span className="font-bold text-amber-800">
                      一次性・{shifts.find(x => x.id === item.shiftId)?.date || '班次已刪除'}
                    </span>
                  )}
                  {(item.sopSectionId || item.sopVideoId) && (
                    <span className="text-indigo-700 font-bold">
                      {item.sopSectionId && '📖'}{item.sopVideoId && '🎬'} 附教材
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => startEdit(item)}
                  title="編輯"
                  className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                {isDisabled ? (
                  <button onClick={() => applyStatus(item, 'restore')} title="重新啟用"
                    className="p-2 rounded-xl hover:bg-slate-100 text-emerald-600 transition">
                    <Eye className="w-4 h-4" />
                  </button>
                ) : (
                  <button onClick={() => setConfirmDisable(item)} title="停用"
                    className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-rose-600 transition">
                    <EyeOff className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {items.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-6">
            還沒有勤務項目。新增之後，志工的今日勤務清單與排班人力推算都會以此為準。
          </p>
        )}
      </div>

      {/* ---------- disable confirmation ---------- */}
      {confirmDisable && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-[24px] max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-700" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900">要停用【{confirmDisable.title}】嗎？</h4>
                <p className="text-xs text-slate-500 mt-1">
                  停用後不會再出現在今日勤務清單，照護量合計也會扣掉這一項。
                </p>
              </div>
            </div>

            <p className="text-xs text-emerald-700 bg-emerald-50 rounded-xl p-2.5">
              既有的完成紀錄<strong>不會被刪除</strong>，歷史查詢仍然看得到。隨時可以重新啟用。
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => applyStatus(confirmDisable, 'disable')}
                disabled={isSaving}
                className="flex-1 px-4 py-2.5 rounded-2xl bg-[#716053] text-white text-sm font-bold hover:bg-[#5d4f44] disabled:opacity-50 transition"
              >
                {isSaving ? '處理中...' : '確定停用'}
              </button>
              <button
                onClick={() => setConfirmDisable(null)}
                className="flex-1 px-4 py-2.5 rounded-2xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
