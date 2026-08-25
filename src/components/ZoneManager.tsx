/**
 * Editing the shelter's own areas.
 *
 * The five areas used to be compiled into the frontend, which meant a shelter
 * with an aviary, or without a puppy nursery, could not describe itself. They
 * are rows in a table now.
 *
 * Two things this screen deliberately does not do:
 *
 * It offers no colour picker, only a fixed palette. Tailwind ships CSS for the
 * class names it finds in the source at build time, so a colour typed in here
 * and stored in the database would render as no colour at all -- see the note
 * at the top of data/zones.
 *
 * It offers no delete, only disable. Shifts, signups and attendance rows all
 * store a zone, so removing one would leave records pointing at nothing. The
 * count of what a zone already carries is shown before disabling it, so the
 * decision is made with that in view.
 */
import React, { useEffect, useState } from 'react';
import { MapPin, Plus, Pencil, EyeOff, Eye, Loader2, X, Check, AlertTriangle } from 'lucide-react';
import { authFetch } from '../utils/session';
import { ZONE_PALETTES, paletteFor, type ZoneRecord } from '../data/zones';

interface ZoneManagerProps {
  onToast: (message: string) => void;
  /** Lets App refresh its own copy of the zones after any change here. */
  onZonesChanged: () => void;
}

const EMPTY_DRAFT = { name: '', code: '', palette: 'sky', icon: '📍', description: '' };
/** A small set that covers the usual areas; anything else can be pasted in. */
const ICON_SUGGESTIONS = ['🐱', '🐕', '🐾', '🏥', '📦', '🦜', '🐰', '🏠', '🌳', '🚿', '🍽️', '📍'];

export const ZoneManager: React.FC<ZoneManagerProps> = ({ onToast, onZonesChanged }) => {
  const [zones, setZones] = useState<ZoneRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [confirmDisable, setConfirmDisable] = useState<{ zone: ZoneRecord; usage: { shifts: number; signups: number; attendance: number } } | null>(null);

  const load = () => {
    setIsLoading(true);
    return authFetch('/api/zones')
      .then(res => res.json())
      .then(data => { if (data.success) setZones(data.zones); })
      .catch(() => onToast('⚠️ 讀取場域失敗，請稍後再試。'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const startAdd = () => { setDraft(EMPTY_DRAFT); setIsAdding(true); setEditingId(null); };
  const startEdit = (zone: ZoneRecord) => {
    setDraft({ name: zone.name, code: zone.code, palette: zone.palette, icon: zone.icon, description: zone.description });
    setEditingId(zone.id);
    setIsAdding(false);
  };
  const cancel = () => { setIsAdding(false); setEditingId(null); setDraft(EMPTY_DRAFT); };

  const save = async () => {
    setIsSaving(true);
    try {
      const url = isAdding ? '/api/admin/zones' : `/api/admin/zones/${encodeURIComponent(editingId!)}`;
      const res = await authFetch(url, {
        method: isAdding ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      });
      const data = await res.json();
      if (!data.success) { onToast(`⚠️ ${data.error}`); return; }
      onToast(isAdding ? `✅ 已新增場域【${data.zone.name}】` : `✅ 已更新【${data.zone.name}】`);
      cancel();
      await load();
      onZonesChanged();
    } catch {
      onToast('⚠️ 儲存失敗，請確認網路連線。');
    } finally {
      setIsSaving(false);
    }
  };

  /** Asks the server what a zone already carries, then shows the confirmation. */
  const askDisable = async (zone: ZoneRecord) => {
    try {
      const res = await authFetch(`/api/admin/zones/${encodeURIComponent(zone.id)}/usage`);
      const data = await res.json();
      setConfirmDisable({ zone, usage: data.usage || { shifts: 0, signups: 0, attendance: 0 } });
    } catch {
      onToast('⚠️ 無法查詢這個場域的使用狀況。');
    }
  };

  const applyStatus = async (zone: ZoneRecord, action: 'disable' | 'restore') => {
    setIsSaving(true);
    try {
      const res = await authFetch(`/api/admin/zones/${encodeURIComponent(zone.id)}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) { onToast(`⚠️ ${data.error}`); return; }
      onToast(action === 'disable' ? `已停用【${zone.name}】，既有紀錄不受影響。` : `✅ 已重新啟用【${zone.name}】`);
      setConfirmDisable(null);
      await load();
      onZonesChanged();
    } catch {
      onToast('⚠️ 操作失敗，請稍後再試。');
    } finally {
      setIsSaving(false);
    }
  };

  const isEditing = isAdding || editingId !== null;

  if (isLoading) {
    return (
      <div className="py-16 flex items-center justify-center text-slate-400 text-sm gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>載入場域設定中...</span>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-[28px] border border-[#716053] shadow-xs space-y-5">

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#716053] text-white flex items-center justify-center shrink-0">
            <MapPin className="w-5 h-5 text-amber-300" />
          </div>
          <div>
            <h3 className="text-lg font-bold font-serif italic text-slate-900">園區場域設定</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              新增或調整園區分區。停用的場域不會出現在新班次的選項裡，但既有的班次與出勤紀錄仍會正常顯示。
            </p>
          </div>
        </div>
        {!isEditing && (
          <button
            onClick={startAdd}
            className="flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-[#716053] text-white text-sm font-bold hover:bg-[#5d4f44] transition shrink-0"
          >
            <Plus className="w-4 h-4" /> 新增場域
          </button>
        )}
      </div>

      {/* ---------- add / edit form ---------- */}
      {isEditing && (
        <div className="border-2 border-amber-300 rounded-2xl p-4 bg-amber-50/60 space-y-3">
          <p className="text-sm font-bold text-slate-800">
            {isAdding ? '新增場域' : '編輯場域'}
          </p>

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-bold text-slate-600">場域名稱</span>
              <input
                value={draft.name}
                onChange={e => setDraft({ ...draft, name: e.target.value })}
                placeholder="例如：鳥類照護區 (D棟)"
                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-amber-400"
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-600">代碼（英數字，報表與匯出用）</span>
              <input
                value={draft.code}
                onChange={e => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                placeholder="BIRD"
                maxLength={12}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono focus:outline-hidden focus:ring-2 focus:ring-amber-400"
              />
            </label>
          </div>

          <div>
            <span className="text-xs font-bold text-slate-600">顏色</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {ZONE_PALETTES.map(palette => (
                <button
                  key={palette.key}
                  onClick={() => setDraft({ ...draft, palette: palette.key })}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition ${palette.badgeBg} ${
                    draft.palette === palette.key ? 'border-slate-800 scale-105' : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                >
                  {palette.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">
              顏色從固定清單選擇，這樣才能保證在正式環境顯示得出來。
            </p>
          </div>

          <div>
            <span className="text-xs font-bold text-slate-600">圖示</span>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {ICON_SUGGESTIONS.map(icon => (
                <button
                  key={icon}
                  onClick={() => setDraft({ ...draft, icon })}
                  className={`w-9 h-9 rounded-xl text-lg border-2 transition ${
                    draft.icon === icon ? 'border-slate-800 bg-white' : 'border-slate-200 hover:border-slate-400'
                  }`}
                >
                  {icon}
                </button>
              ))}
              <input
                value={draft.icon}
                onChange={e => setDraft({ ...draft, icon: e.target.value })}
                maxLength={4}
                aria-label="自訂圖示"
                className="w-16 px-2 py-1.5 rounded-xl border border-slate-300 text-center text-lg"
              />
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-bold text-slate-600">工作說明（志工會看到）</span>
            <textarea
              value={draft.description}
              onChange={e => setDraft({ ...draft, description: e.target.value })}
              rows={2}
              placeholder="這個場域的志工主要負責哪些工作？"
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
      <div className="space-y-2">
        {zones.map(zone => {
          const palette = paletteFor(zone.palette);
          const isDisabled = zone.status === 'disabled';
          return (
            <div
              key={zone.id}
              className={`flex items-center gap-3 p-3 rounded-2xl border transition ${
                isDisabled ? 'border-slate-200 bg-slate-50 opacity-60' : `${palette.borderClass} ${palette.bgLight}`
              }`}
            >
              <span className="text-2xl shrink-0">{zone.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-bold text-sm ${isDisabled ? 'text-slate-500' : palette.textClass}`}>
                    {zone.name}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/70 text-slate-500 border border-slate-200">
                    {zone.code}
                  </span>
                  {isDisabled && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">
                      已停用
                    </span>
                  )}
                </div>
                {zone.description && (
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{zone.description}</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => startEdit(zone)}
                  title="編輯"
                  className="p-2 rounded-xl hover:bg-white/80 text-slate-500 hover:text-slate-800 transition"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                {isDisabled ? (
                  <button
                    onClick={() => applyStatus(zone, 'restore')}
                    title="重新啟用"
                    className="p-2 rounded-xl hover:bg-white/80 text-emerald-600 transition"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => askDisable(zone)}
                    title="停用"
                    className="p-2 rounded-xl hover:bg-white/80 text-slate-400 hover:text-rose-600 transition"
                  >
                    <EyeOff className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
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
                <h4 className="font-bold text-slate-900">
                  要停用【{confirmDisable.zone.name}】嗎？
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  停用後這個場域不會再出現在新班次的選項裡。
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 p-3 text-sm space-y-1">
              <p className="text-xs font-bold text-slate-600 mb-1.5">這個場域目前的紀錄：</p>
              <div className="flex justify-between"><span className="text-slate-500">班次</span><span className="font-mono font-bold">{confirmDisable.usage.shifts}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">報名</span><span className="font-mono font-bold">{confirmDisable.usage.signups}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">出勤</span><span className="font-mono font-bold">{confirmDisable.usage.attendance}</span></div>
            </div>

            <p className="text-xs text-emerald-700 bg-emerald-50 rounded-xl p-2.5">
              這些紀錄<strong>不會被刪除</strong>，也會繼續正常顯示。停用只影響之後新開的班次，隨時可以重新啟用。
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => applyStatus(confirmDisable.zone, 'disable')}
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
