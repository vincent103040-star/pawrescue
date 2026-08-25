import React, { useState, useEffect } from 'react';
import { authFetch } from '../utils/session';
import { PositionShift, ZoneCategory } from '../types';
import { ZONE_CONFIGS } from '../data/mockData';
import { resolveZone } from '../data/zones';
import { 
  ClipboardCheck, 
  CheckSquare, 
  Square, 
  Sparkles, 
  Clock, 
  Building2, 
  AlertCircle, 
  CheckCircle2, 
  RotateCcw, 
  ShieldCheck, 
  Zap, 
  ListChecks, 
  Award,
  ChevronRight,
  Info,
  ChevronDown,
  ChevronUp,
  EyeOff
} from 'lucide-react';

interface SopItem {
  id: string;
  shiftId: string;
  shiftTitle: string;
  zone: ZoneCategory;
  category: string;
  title: string;
  description: string;
  isRequired: boolean;
  timeWindow: string;
  isCompleted: boolean;
  completedBy?: string;
  completedAt?: string;
}

interface DailyDutyTaskboardProps {
  shifts: PositionShift[];
  onSendLineToast: (msg: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onHide?: () => void;
}

export const DailyDutyTaskboard: React.FC<DailyDutyTaskboardProps> = ({
  shifts,
  onSendLineToast,
  isCollapsed = false,
  onToggleCollapse,
  onHide
}) => {
  // Follows the shelter's own timezone (Taiwan), not the browser/server's --
  // en-CA formats as YYYY-MM-DD, matching the date strings used elsewhere.
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

  // Filter today's shifts or active shifts
  const todayShifts = shifts.filter(s => {
    return s.date === todayStr || true; // Show today's shifts or standard daily template
  });

  /**
   * Today's duties, fetched rather than declared.
   *
   * This was a hardcoded array in useState, which meant the "5/7 完成" figure
   * reset to the same value on every reload and ticking an item recorded
   * nothing anywhere. The list now comes from the duty items an admin has
   * configured, joined with today's completion records on the server -- see the
   * comment on duty_items in db.ts for why those are two separate tables.
   */
  const [sopItems, setSopItems] = useState<SopItem[]>([]);
  const [isLoadingDuties, setIsLoadingDuties] = useState(true);
  const [busyIds, setBusyIds] = useState<string[]>([]);

  const loadDuties = React.useCallback(() => {
    setIsLoadingDuties(true);
    return authFetch('/api/duties/today')
      .then(res => res.json())
      .then(data => {
        if (!data.success) return;
        setSopItems(data.duties.map((duty: any) => ({
          id: duty.id,
          shiftId: duty.shiftId || '',
          shiftTitle: duty.timeWindow || '',
          zone: duty.zoneId,
          category: duty.category,
          title: duty.title,
          description: duty.description,
          isRequired: duty.isRequired,
          timeWindow: duty.timeWindow,
          isCompleted: duty.isCompleted,
          completedBy: duty.completedBy,
          // The server stores a UTC instant; the board only ever shows a time.
          completedAt: duty.completedAt
            ? new Date(duty.completedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
            : undefined
        })));
      })
      .catch(() => { /* leave whatever is on screen if the backend is unreachable */ })
      .finally(() => setIsLoadingDuties(false));
  }, []);

  useEffect(() => { loadDuties(); }, [loadDuties]);

  /**
   * Ticks or un-ticks a duty.
   *
   * Optimistic, then reconciled: the checkbox responds immediately because a
   * volunteer standing in a kennel should not wait on a round trip, and the
   * refresh afterwards makes the server's version the one that stays -- so two
   * coordinators ticking the same item converge instead of disagreeing.
   */
  const handleToggleSop = async (id: string) => {
    const item = sopItems.find(i => i.id === id);
    if (!item || busyIds.includes(id)) return;
    const next = !item.isCompleted;

    setBusyIds(prev => [...prev, id]);
    setSopItems(prev => prev.map(i => (i.id === id ? { ...i, isCompleted: next } : i)));

    try {
      const res = await authFetch(`/api/duties/${encodeURIComponent(id)}/${next ? 'complete' : 'uncomplete'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!data.success) {
        onSendLineToast(`⚠️ ${data.error || '儲存失敗'}`);
      } else if (next) {
        onSendLineToast(`✅ 已完成勤務：【${item.title}】`);
      }
    } catch {
      onSendLineToast('⚠️ 無法連線，這次的勾選尚未儲存。');
    } finally {
      setBusyIds(prev => prev.filter(i => i !== id));
      loadDuties();
    }
  };

  /** Clears every completion recorded for today. */
  const handleResetAll = async () => {
    const completed = sopItems.filter(item => item.isCompleted);
    if (!completed.length) return;
    await Promise.all(completed.map(item =>
      authFetch(`/api/duties/${encodeURIComponent(item.id)}/uncomplete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }).catch(() => {})
    ));
    await loadDuties();
    onSendLineToast('🔄 已重置本日勤務完成紀錄。');
  };

  const [selectedZoneFilter, setSelectedZoneFilter] = useState<string>('all');

  // Filtered items
  const filteredItems = sopItems.filter(item => {
    if (selectedZoneFilter !== 'all' && item.zone !== selectedZoneFilter) return false;
    return true;
  });

  const totalCount = filteredItems.length;
  const completedCount = filteredItems.filter(i => i.isCompleted).length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const requiredTotal = filteredItems.filter(i => i.isRequired).length;
  const requiredCompleted = filteredItems.filter(i => i.isRequired && i.isCompleted).length;

  return (
    <div
      id="module-daily_duty"
      className="bg-white rounded-[32px] border border-[#716053] p-6 sm:p-8 shadow-xs space-y-6 transition-all duration-300 overflow-hidden"
    >
      {/* Header Bar */}
      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 ${isCollapsed ? '' : 'border-b border-[#716053] pb-4'}`}>
        <div
          onClick={onToggleCollapse}
          className="flex items-start gap-3 cursor-pointer select-none group"
        >
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-[#716053] text-amber-300 flex items-center justify-center shrink-0 shadow-xs font-bold group-hover:scale-105 transition-transform">
            <ClipboardCheck className="w-6 h-6 text-amber-300" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-bold font-serif italic text-slate-900 group-hover:text-[#716053] transition-colors">
                4. 每日志工勤務看板 &amp; SOP 執行追蹤
              </h3>
              <span className="bg-[#F5E6D0] text-[#716053] text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border border-[#716053]">
                今日日期: {todayStr}
              </span>
              {isCollapsed && (
                <span className="text-[10px] bg-slate-200 text-slate-700 font-bold px-2 py-0.5 rounded-full">
                  已收合折疊
                </span>
              )}
            </div>
            {!isCollapsed && (
              <p className="text-xs text-slate-500 mt-1">
                自動根據當日排班與各場域（狗園放風、貓房清理、醫療發藥、幼犬餵食）產出標準作業程序 (SOP) 清單，由值班志工實時核銷防呆。
              </p>
            )}
          </div>
        </div>

        {/* Quick Reset & Status Badge & Action Controls */}
        <div className="flex flex-wrap items-center gap-2 self-end md:self-auto shrink-0">
          {!isCollapsed && (
            <>
              <button
                type="button"
                onClick={handleResetAll}
                className="text-xs font-bold text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>重置全清單</span>
              </button>

              <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-3 py-1.5 rounded-2xl flex items-center gap-2 text-xs font-bold">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>必做 SOP：{requiredCompleted}/{requiredTotal} 完成</span>
              </div>
            </>
          )}

          {/* Collapse/Expand Toggle Button */}
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title={isCollapsed ? '展開此模組' : '折疊收合此模組'}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#FAF6EE] hover:bg-[#F5E6D0] text-[#716053] border border-[#716053] transition flex items-center gap-1 cursor-pointer active:scale-95 shadow-2xs"
            >
              {isCollapsed ? (
                <>
                  <ChevronDown className="w-4 h-4 text-[#716053]" />
                  <span>展開</span>
                </>
              ) : (
                <>
                  <ChevronUp className="w-4 h-4 text-[#716053]" />
                  <span>折疊</span>
                </>
              )}
            </button>
          )}

          {/* Hide Module Button */}
          {onHide && (
            <button
              type="button"
              onClick={onHide}
              title="從看板暫時隱藏（可隨時於自訂模組選單中重新開啟）"
              className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition cursor-pointer"
            >
              <EyeOff className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Collapsed State Summary Row */}
      {isCollapsed && (
        <div
          onClick={onToggleCollapse}
          className="pt-2 border-t border-[#716053] flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-600 cursor-pointer gap-2"
        >
          <div className="flex items-center gap-2 overflow-hidden text-ellipsis">
            <span className="font-bold text-[#716053] shrink-0">📌 勤務 SOP 摘要：</span>
            <span className="text-slate-700 truncate">
              今日進度 {completedCount} / {totalCount} 項目（必做 SOP {requiredCompleted} / {requiredTotal} 完成，整體達成率 {progressPct}%）
            </span>
          </div>
          <span className="text-[11px] font-bold text-[#716053] hover:underline shrink-0 flex items-center gap-0.5">
            <span>點擊展開檢核清單</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </span>
        </div>
      )}

      {/* Main Expanded Content */}
      {!isCollapsed && (
        <div className="space-y-6 animate-fadeIn">
          {/* Progress & Milestone Bar */}
          <div className="bg-[#FFFDF7] p-5 rounded-2xl border border-[#716053] shadow-2xs space-y-3">
        <div className="flex items-center justify-between text-xs font-bold">
          <div className="flex items-center gap-2 text-slate-800">
            <ListChecks className="w-4 h-4 text-[#716053]" />
            <span>今日 SOP 總達成進度 ({completedCount}/{totalCount} 項)</span>
          </div>
          <span className="text-base font-extrabold font-mono text-[#716053]">
            {progressPct}%
          </span>
        </div>

        {/* Progress Line */}
        <div className="w-full bg-slate-200 h-3 rounded-full overflow-hidden p-0.5 border border-slate-300/50">
          <div 
            className="bg-gradient-to-r from-[#716053] to-amber-500 h-full rounded-full transition-all duration-500 shadow-xs"
            style={{ width: `${progressPct}%` }}
          ></div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
          <span>必要防範 SOP (必填)：<strong className="text-slate-900">{requiredCompleted} / {requiredTotal}</strong></span>
          {progressPct === 100 ? (
            <span className="text-emerald-700 font-extrabold flex items-center gap-1">
              <Award className="w-3.5 h-3.5 text-emerald-600" />
              🎉 太棒了！今日所有標準作業程序已全數高標準完成！
            </span>
          ) : (
            <span>提示：點擊核選方框即可更新值班紀錄</span>
          )}
        </div>
      </div>

      {/* Zone Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500 font-bold text-[11px] mr-1">場域 SOP 篩選：</span>
        <button
          onClick={() => setSelectedZoneFilter('all')}
          className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer border ${
            selectedZoneFilter === 'all'
              ? 'bg-[#716053] text-white border-[#716053]'
              : 'bg-white text-slate-700 hover:bg-slate-100 border-slate-200'
          }`}
        >
          全部項目 ({sopItems.length})
        </button>
        {Object.keys(ZONE_CONFIGS).map(zKey => {
          const z = resolveZone(zKey);
          const zCount = sopItems.filter(i => i.zone === zKey).length;
          return (
            <button
              key={zKey}
              onClick={() => setSelectedZoneFilter(zKey)}
              className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1 cursor-pointer border ${
                selectedZoneFilter === zKey
                  ? 'bg-[#716053] text-white border-[#716053]'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border-slate-200'
              }`}
            >
              <span>{z.icon}</span>
              <span>{z.name} ({zCount})</span>
            </button>
          );
        })}
      </div>

      {/* Checklist Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredItems.map(item => {
          const zoneConf = resolveZone(item.zone);

          return (
            <div
              key={item.id}
              onClick={() => handleToggleSop(item.id)}
              className={`p-4 rounded-2xl border transition cursor-pointer flex items-start gap-3.5 shadow-2xs hover:shadow-xs ${
                item.isCompleted
                  ? 'bg-slate-50/80 border-slate-300 opacity-90'
                  : 'bg-[#FFFDF7] border-[#716053] hover:border-[#716053]'
              }`}
            >
              {/* Checkbox Icon */}
              <div className="pt-0.5 shrink-0">
                {item.isCompleted ? (
                  <CheckSquare className="w-5 h-5 text-emerald-600 fill-emerald-100" />
                ) : (
                  <Square className="w-5 h-5 text-slate-400 hover:text-[#716053]" />
                )}
              </div>

              {/* Content Body */}
              <div className="flex-1 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-[#716053] font-serif">
                      {item.category}
                    </span>
                    {item.isRequired && (
                      <span className="bg-rose-100 text-rose-800 text-[9px] font-extrabold px-1.5 py-0.2 rounded-full border border-rose-200">
                        關鍵必做
                      </span>
                    )}
                  </div>

                  <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded-full">
                    <Clock className="w-3 h-3 text-slate-400" />
                    {item.timeWindow}
                  </span>
                </div>

                <h4 className={`font-bold text-sm leading-snug ${
                  item.isCompleted ? 'line-through text-slate-400' : 'text-slate-900'
                }`}>
                  {item.title}
                </h4>

                <p className={`text-xs leading-relaxed ${
                  item.isCompleted ? 'text-slate-400' : 'text-slate-600'
                }`}>
                  {item.description}
                </p>

                {/* Footer status */}
                {item.isCompleted && (
                  <div className="pt-1 text-[10px] text-emerald-700 font-bold flex items-center gap-1.5 border-t border-slate-200/60 mt-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>核銷志工：{item.completedBy || '系統紀錄'} （{item.completedAt} 完成）</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
        </div>
      )}

    </div>
  );
};
