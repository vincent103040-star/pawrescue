/**
 * Turning what the main system observed about the animals into a headcount.
 *
 * One screen because it is one argument, read top to bottom: this many animals
 * need this much work, at this much per person, so this many people. Split
 * across three tabs it would be three numbers nobody can join up.
 *
 * The mapping is edited here rather than inferred anywhere. A coordinator told
 * to staff two extra people on Tuesday is entitled to ask why, and every number
 * on this screen traces back to a row on it -- which status, which duty, how
 * many minutes, set by a person who can change it. A figure produced by a model
 * could not be questioned and could not be corrected, because there would be
 * nothing to edit.
 *
 * The table starts empty on purpose. The observation vocabulary upstream is
 * still placeholder data, so pre-filled minutes would be guesses wearing the
 * clothes of configuration. 「還沒設定的狀態」 below lists what has actually
 * been observed with no rule yet, so the shelter prices what its own animals
 * turn out to need. An unpriced status counts as zero minutes -- the right
 * answer to an unanswered question, but only while the question stays visible.
 */
import React, { useEffect, useState } from 'react';
import {
  Mail, Loader2, Plus, Pencil, EyeOff, Eye, Check, X, AlertTriangle,
  Users, Clock, Inbox, PawPrint, Settings2
} from 'lucide-react';
import { authFetch } from '../utils/session';

interface Mapping {
  id: string;
  categoryCode: string;
  optionCode: string;
  optionLabel: string;
  dutyItemId: string;
  minutesPerAnimal: number;
  requiredTier: string;
  note: string;
  status: 'active' | 'disabled';
}

interface UnmappedStatus {
  categoryCode: string;
  optionCode: string;
  optionLabel: string;
  animalCount: number;
  lastObservedAt: string;
}

/** `unreachableReason` empty means the roster generator can actually reach it. */
interface DutyOption { id: string; title: string; zoneId: string; unreachableReason: string; }

interface Workload {
  shiftCapacityMinutes: number;
  totalMinutes: number;
  skilledMinutes: number;
  suggestedPeople: number;
  suggestedSkilledPeople: number;
  animalCount: number;
  byDuty: Array<{
    dutyItemId: string; dutyTitle: string; animalCount: number;
    minutes: number; requiredTier: string;
  }>;
  unmapped: Array<{ optionLabel: string; optionCode: string; animalCount: number }>;
  sinceDays: number;
}

interface Batch {
  id: string;
  sequence: number;
  periodStart: string;
  periodEnd: string;
  subject: string;
  sender: string;
  recordCount: number;
  skippedCount: number;
  importedAt: string;
}

const TIERS = ['', '正式志工', '資深志工', '志工隊長'] as const;

const blankForm = {
  categoryCode: '', optionCode: '', optionLabel: '',
  dutyItemId: '', minutesPerAnimal: 10, requiredTier: '', note: ''
};

export const AnimalStatusManager: React.FC<{ onToast: (m: string) => void }> = ({ onToast }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [unmapped, setUnmapped] = useState<UnmappedStatus[]>([]);
  const [duties, setDuties] = useState<DutyOption[]>([]);
  /** Why each already-mapped duty is out of the roster's reach, keyed by id. */
  const [dutyReach, setDutyReach] = useState<Record<string, string>>({});
  const [workload, setWorkload] = useState<Workload | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [missing, setMissing] = useState<number[]>([]);

  const [form, setForm] = useState({ ...blankForm });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const [capacityDraft, setCapacityDraft] = useState('180');
  const [editingCapacity, setEditingCapacity] = useState(false);

  async function load() {
    try {
      const [mapRes, workRes, batchRes] = await Promise.all([
        authFetch('/api/admin/status-mappings'),
        authFetch('/api/admin/status-workload'),
        authFetch('/api/admin/status-batches')
      ]);
      const map = await mapRes.json();
      const work = await workRes.json();
      const batch = await batchRes.json();

      if (map.success) {
        setMappings(map.mappings || []);
        setUnmapped(map.unmapped || []);
        setDuties(map.dutyItems || []);
        setDutyReach(map.dutyReach || {});
        setCapacityDraft(String(map.shiftCapacityMinutes ?? 180));
      }
      if (work.success) setWorkload(work.workload);
      if (batch.success) { setBatches(batch.batches || []); setMissing(batch.missing || []); }
    } catch {
      onToast('⚠️ 讀取動物狀態資料失敗，請重新整理。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function startAdd(prefill?: UnmappedStatus) {
    setForm(prefill
      ? { ...blankForm, categoryCode: prefill.categoryCode, optionCode: prefill.optionCode, optionLabel: prefill.optionLabel }
      : { ...blankForm });
    setEditingId(null);
    setIsEditing(true);
  }

  function startEdit(mapping: Mapping) {
    setForm({
      categoryCode: mapping.categoryCode,
      optionCode: mapping.optionCode,
      optionLabel: mapping.optionLabel,
      dutyItemId: mapping.dutyItemId,
      minutesPerAnimal: mapping.minutesPerAnimal,
      requiredTier: mapping.requiredTier,
      note: mapping.note
    });
    setEditingId(mapping.id);
    setIsEditing(true);
  }

  async function save() {
    if (!form.optionCode.trim()) { onToast('⚠️ 請填狀態代碼。'); return; }
    if (!form.dutyItemId) { onToast('⚠️ 請選擇這個狀態要對應哪一項勤務。'); return; }

    setSaving(true);
    try {
      const res = await authFetch('/api/admin/status-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (!res.ok || !data.success) { onToast(`⚠️ ${data.error || '儲存失敗'}`); return; }
      onToast(`✅ 已儲存「${form.optionLabel || form.optionCode}」的對照規則。`);
      setIsEditing(false);
      await load();
    } catch {
      onToast('⚠️ 儲存失敗，請稍後再試。');
    } finally {
      setSaving(false);
    }
  }

  async function toggleMapping(mapping: Mapping) {
    const action = mapping.status === 'active' ? 'disable' : 'restore';
    const res = await authFetch(`/api/admin/status-mappings/${mapping.id}/${action}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.success) { onToast(`⚠️ ${data.error || '操作失敗'}`); return; }
    onToast(action === 'disable' ? '已停用這條規則（沒有刪除，歷史仍查得到）。' : '已恢復這條規則。');
    await load();
  }

  async function saveCapacity() {
    setSaving(true);
    try {
      const res = await authFetch('/api/admin/shift-capacity', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes: Number(capacityDraft) })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        onToast(`⚠️ ${data.error || '儲存失敗'}`);
        setCapacityDraft(String(data.shiftCapacityMinutes ?? 180));
        return;
      }
      onToast(`✅ 已改成「一個人一個班可做 ${data.shiftCapacityMinutes} 分鐘」，人力推算同步更新。`);
      setEditingCapacity(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  const dutyName = (id: string) => duties.find(d => d.id === id)?.title || '（勤務已停用或刪除）';
  /**
   * Why a rule pointing at this duty will never reach a shift. Empty when it
   * will. Checked against the picker first so a duty being edited right now
   * reads the fresh verdict, then against the map, which also covers the
   * disabled and deleted duties the picker no longer lists.
   */
  const unreachable = (id: string): string =>
    duties.find(d => d.id === id)?.unreachableReason ?? dutyReach[id] ?? '';
  const localTime = (iso: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-TW', { hour12: false });
  };

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-[28px] border border-[#716053] shadow-xs flex items-center gap-2 text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> 讀取動物狀態資料…
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-[28px] border border-[#716053] shadow-xs space-y-5">

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#716053] text-white flex items-center justify-center shrink-0">
            <PawPrint className="w-5 h-5 text-amber-300" />
          </div>
          <div>
            <h3 className="text-lg font-bold font-serif italic text-slate-900">動物狀態對照表</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              母系統傳來的動物狀態只是文字。在這裡定義「這個狀態＝哪項勤務＝一隻幾分鐘」，系統才算得出要多開幾個人。
            </p>
          </div>
        </div>
        {!isEditing && (
          <button
            onClick={() => startAdd()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-[#716053] text-white text-sm font-bold hover:bg-[#5d4f44] transition shrink-0"
          >
            <Plus className="w-4 h-4" /> 新增對照規則
          </button>
        )}
      </div>

      {/* ---------- derived headcount ---------- */}
      {workload && (
        <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/60 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-700" />
            <span className="text-sm font-bold text-emerald-900">
              由最近 {workload.sinceDays} 天的動物狀態推算出的人力需求
            </span>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <div className="bg-white rounded-xl p-3 border border-emerald-200">
              <p className="text-[11px] text-slate-500 font-bold">需要照顧的動物</p>
              <p className="text-lg font-bold text-slate-900 mt-0.5">
                {workload.animalCount} <span className="text-xs font-normal text-slate-500">隻</span>
              </p>
            </div>
            <div className="bg-white rounded-xl p-3 border border-emerald-200">
              <p className="text-[11px] text-slate-500 font-bold">合計工時</p>
              <p className="text-lg font-bold text-slate-900 mt-0.5">
                {workload.totalMinutes} <span className="text-xs font-normal text-slate-500">分鐘</span>
              </p>
            </div>
            <div className="bg-white rounded-xl p-3 border border-emerald-300">
              <p className="text-[11px] text-emerald-700 font-bold">建議加開人力</p>
              <p className="text-lg font-bold text-emerald-900 mt-0.5">
                {workload.suggestedPeople} <span className="text-xs font-normal text-emerald-600">人</span>
                {workload.suggestedSkilledPeople > 0 && (
                  <span className="text-xs font-normal text-emerald-600 ml-1.5">
                    （其中 {workload.suggestedSkilledPeople} 位需熟練）
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* The divisor, editable, next to the number it decides. */}
          <div className="bg-white rounded-xl p-3 border border-emerald-200 flex flex-wrap items-center gap-2">
            <Settings2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span className="text-xs font-bold text-slate-700">一個人、一個班可以做</span>
            {editingCapacity ? (
              <>
                <input
                  type="number" min={15} max={1440}
                  value={capacityDraft}
                  onChange={e => setCapacityDraft(e.target.value)}
                  className="w-24 px-2 py-1 rounded-lg border border-emerald-300 text-sm"
                />
                <span className="text-xs text-slate-600">分鐘</span>
                <button onClick={saveCapacity} disabled={saving}
                  className="px-3 py-1 rounded-lg bg-emerald-700 text-white text-xs font-bold disabled:opacity-50">
                  <Check className="w-3.5 h-3.5 inline" /> 儲存
                </button>
                <button onClick={() => { setEditingCapacity(false); setCapacityDraft(String(workload.shiftCapacityMinutes)); }}
                  className="px-3 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold">
                  取消
                </button>
              </>
            ) : (
              <>
                <span className="text-sm font-bold text-emerald-900">{workload.shiftCapacityMinutes} 分鐘</span>
                <button onClick={() => setEditingCapacity(true)}
                  className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 text-xs font-bold hover:bg-emerald-200">
                  <Pencil className="w-3 h-3 inline" /> 修改
                </button>
              </>
            )}
            <p className="text-[11px] text-slate-500 w-full mt-1">
              合計工時除以這個數字，就是上面的建議人力。三小時的班不等於三小時的照護時間 ——
              交接、移動、休息都要扣掉，所以這個數字由收容所自己決定。
            </p>
          </div>

          {workload.byDuty.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-emerald-200">
                    <th className="text-left py-1.5 font-bold">勤務</th>
                    <th className="text-right py-1.5 font-bold">動物數</th>
                    <th className="text-right py-1.5 font-bold">分鐘</th>
                    <th className="text-right py-1.5 font-bold">需求等級</th>
                  </tr>
                </thead>
                <tbody>
                  {workload.byDuty.map(row => (
                    <tr key={`${row.dutyItemId}-${row.requiredTier}`} className="border-b border-emerald-100 last:border-0">
                      <td className="py-1.5 text-slate-800">{row.dutyTitle}</td>
                      <td className="py-1.5 text-right font-bold text-slate-900">{row.animalCount}</td>
                      <td className="py-1.5 text-right text-slate-700">{row.minutes}</td>
                      <td className="py-1.5 text-right text-slate-500">{row.requiredTier || '不限'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {workload.totalMinutes === 0 && (
            <p className="text-xs text-slate-500 bg-white rounded-xl p-3 border border-emerald-100">
              目前推算為 0 —— 可能是還沒收到狀態資料，或是收到的狀態都還沒設定對照規則。
              兩種情況都不是錯誤，往下看就知道是哪一種。
            </p>
          )}
        </div>
      )}

      {/* ---------- editor ---------- */}
      {isEditing && (
        <div className="rounded-2xl border-2 border-[#716053] bg-[#FBF9F4] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-900">
              {editingId ? '修改對照規則' : '新增對照規則'}
            </span>
            <button onClick={() => setIsEditing(false)} className="text-slate-400 hover:text-slate-700">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-bold text-slate-600">狀態代碼 *</span>
              <input
                value={form.optionCode}
                onChange={e => setForm({ ...form, optionCode: e.target.value })}
                placeholder="例：loose"
                className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-slate-600">中文顯示名稱</span>
              <input
                value={form.optionLabel}
                onChange={e => setForm({ ...form, optionLabel: e.target.value })}
                placeholder="例：便便較軟"
                className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-slate-600">類別代碼</span>
              <input
                value={form.categoryCode}
                onChange={e => setForm({ ...form, categoryCode: e.target.value })}
                placeholder="例：excretion"
                className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-slate-600">對應勤務 *</span>
              <select
                value={form.dutyItemId}
                onChange={e => setForm({ ...form, dutyItemId: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
              >
                <option value="">請選擇…</option>
                {duties.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.title}{d.unreachableReason ? '（排班讀不到）' : ''}
                  </option>
                ))}
              </select>
              {/*
                Said at the moment the rule is written, not only when somebody
                later wonders why the roster did not change. The rule is still
                allowed -- the duty may be about to gain a time window, and
                refusing it would just move the problem -- but it must not look
                like it works.
              */}
              {unreachable(form.dutyItemId) && (
                <span className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-900 bg-amber-50 border border-amber-300 rounded-xl px-2.5 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>
                    <strong>整期排班讀不到這項勤務</strong>（{unreachable(form.dutyItemId)}）。
                    這條規則仍會算出分鐘數，但那些分鐘不會加到任何班次的人數上。
                    要讓它生效，請到上面「勤務項目」把它設成「每日固定」並填上起訖時間。
                  </span>
                </span>
              )}
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-slate-600">一隻要花幾分鐘 *</span>
              <input
                type="number" min={0} max={1440}
                value={form.minutesPerAnimal}
                onChange={e => setForm({ ...form, minutesPerAnimal: Number(e.target.value) })}
                className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
              <span className="text-[10px] text-slate-400">填 0 代表這個狀態不需要額外人力</span>
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-slate-600">需要的志工等級</span>
              <select
                value={form.requiredTier}
                onChange={e => setForm({ ...form, requiredTier: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
              >
                {TIERS.map(t => <option key={t} value={t}>{t || '不限（任何志工都可以）'}</option>)}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-[11px] font-bold text-slate-600">備註（為什麼是這個數字）</span>
            <input
              value={form.note}
              onChange={e => setForm({ ...form, note: e.target.value })}
              placeholder="例：含清潔與記錄，實測平均 15 分鐘"
              className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-300 text-sm"
            />
          </label>

          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
              className="px-4 py-2 rounded-2xl bg-[#716053] text-white text-sm font-bold disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : <Check className="w-4 h-4 inline" />} 儲存
            </button>
            <button onClick={() => setIsEditing(false)}
              className="px-4 py-2 rounded-2xl bg-slate-100 text-slate-600 text-sm font-bold">取消</button>
          </div>
        </div>
      )}

      {/* ---------- unmapped ---------- */}
      {unmapped.length > 0 && (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/60 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700" />
            <span className="text-sm font-bold text-amber-900">
              收到了、但還沒設定對照的狀態（{unmapped.length} 種）
            </span>
          </div>
          <p className="text-[11px] text-amber-800">
            這些狀態目前算 <strong>0 分鐘</strong>，不會影響人力推算。按「設定」把它變成一條規則。
          </p>
          <div className="space-y-1.5">
            {unmapped.map(s => (
              <div key={`${s.categoryCode}-${s.optionCode}`}
                className="bg-white rounded-xl px-3 py-2 border border-amber-200 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-sm font-bold text-slate-900">{s.optionLabel || s.optionCode}</span>
                  <span className="text-[11px] text-slate-400 ml-2">{s.categoryCode}/{s.optionCode}</span>
                  <span className="text-[11px] text-slate-500 ml-2">{s.animalCount} 隻動物</span>
                </div>
                <button onClick={() => startAdd(s)}
                  className="px-3 py-1 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 shrink-0">
                  設定
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------- rules ---------- */}
      <div className="space-y-2">
        <p className="text-xs font-bold text-slate-600">目前的對照規則（{mappings.length} 條）</p>
        {mappings.length === 0 && (
          <p className="text-xs text-slate-500 bg-slate-50 rounded-xl p-3 border border-slate-200">
            還沒有任何規則。這是正常的 —— 母系統那邊的狀態詞彙還沒定案，先不要憑空填數字。
            等真的狀態進來，上面的「還沒設定的狀態」會列出來，照著設定就好。
          </p>
        )}
        {mappings.map(m => (
          <div key={m.id}
            className={`rounded-2xl px-4 py-3 border flex items-center justify-between gap-3 ${
              m.status === 'active' ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-200 opacity-60'
            }`}>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-slate-900">{m.optionLabel || m.optionCode}</span>
                <span className="text-slate-300">→</span>
                <span className="text-sm text-slate-700">{dutyName(m.dutyItemId)}</span>
                {m.status === 'disabled' && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 font-bold">已停用</span>
                )}
                {m.status === 'active' && unreachable(m.dutyItemId) && (
                  <span
                    title={unreachable(m.dutyItemId)}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-bold flex items-center gap-1"
                  >
                    <AlertTriangle className="w-3 h-3" />排班讀不到
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-3 flex-wrap">
                <span><Clock className="w-3 h-3 inline" /> 一隻 {m.minutesPerAnimal} 分</span>
                <span><Users className="w-3 h-3 inline" /> {m.requiredTier || '不限等級'}</span>
                <span className="text-slate-400">{m.categoryCode}/{m.optionCode}</span>
                {m.note && <span className="text-slate-400">· {m.note}</span>}
              </div>
              {m.status === 'active' && unreachable(m.dutyItemId) && (
                <p className="text-[11px] text-amber-800 mt-1">
                  {unreachable(m.dutyItemId)} —— 這條規則算得出分鐘，但進不了任何班次。
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => startEdit(m)} title="修改"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={() => toggleMapping(m)} title={m.status === 'active' ? '停用' : '恢復'}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                {m.status === 'active' ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ---------- receiving log ---------- */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Inbox className="w-4 h-4 text-slate-600" />
          <span className="text-sm font-bold text-slate-800">收信紀錄</span>
          <span className="text-[11px] text-slate-500">母系統每 6 小時寄一次，系統自動收取</span>
        </div>

        {missing.length > 0 && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2">
            <p className="text-xs font-bold text-rose-800">
              <AlertTriangle className="w-3.5 h-3.5 inline" /> 中間有沒收到的批次：#{missing.join('、#')}
            </p>
            <p className="text-[11px] text-rose-700 mt-0.5">
              對方那邊還留著，可以請他們重寄。系統不會自己補。
            </p>
          </div>
        )}

        {batches.length === 0 ? (
          <p className="text-xs text-slate-500">
            還沒收到任何批次。這不一定是故障 —— 母系統那邊可能還沒開始寄。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200">
                  <th className="text-left py-1.5 font-bold">批次</th>
                  <th className="text-left py-1.5 font-bold">涵蓋區間</th>
                  <th className="text-right py-1.5 font-bold">筆數</th>
                  <th className="text-right py-1.5 font-bold">略過</th>
                  <th className="text-left py-1.5 font-bold pl-3">匯入時間</th>
                </tr>
              </thead>
              <tbody>
                {batches.map(b => (
                  <tr key={b.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 font-bold text-slate-900">#{b.sequence}</td>
                    <td className="py-1.5 text-slate-600">{b.periodStart} ~ {b.periodEnd}</td>
                    <td className="py-1.5 text-right font-bold text-slate-900">{b.recordCount}</td>
                    <td className={`py-1.5 text-right ${b.skippedCount > 0 ? 'text-rose-600 font-bold' : 'text-slate-400'}`}>
                      {b.skippedCount}
                    </td>
                    <td className="py-1.5 text-slate-500 pl-3">{localTime(b.importedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-400 flex items-start gap-1.5">
        <Mail className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          母系統目前不開放對外 API，所以動物狀態走 email 傳送。原始信件永遠不會被刪除 ——
          萬一解析有誤，還能回頭重讀。
        </span>
      </p>
    </div>
  );
};
