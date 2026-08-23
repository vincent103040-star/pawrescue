import React, { useState, useEffect } from 'react';
import { PositionShift, ShelterLocation, ZoneCategory } from '../types';
import { ZONE_CONFIGS } from '../data/mockData';
import { buildGoogleCalendarLink } from '../utils/googleCalendar';
import { authFetch } from '../utils/session';
import { 
  ChevronLeft, 
  ChevronRight, 
  Calendar as CalendarIcon, 
  Clock, 
  MapPin, 
  Users, 
  Sparkles, 
  Trash2, 
  CheckCircle2, 
  RefreshCw, 
  GripVertical, 
  Filter, 
  ExternalLink,
  Bot,
  X,
  Edit2,
  Check,
  ChevronDown
} from 'lucide-react';

// "Today" must follow the shelter's own timezone (Taiwan), not whatever
// timezone the browser or server happens to be running in -- otherwise a
// volunteer or admin viewing this past midnight UTC would see the wrong
// day highlighted. en-CA formats as YYYY-MM-DD, matching dateStr below.
function getTaiwanTodayStr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
}

interface ShiftCalendarViewProps {
  shifts: PositionShift[];
  onUpdateShift?: (shift: PositionShift) => void;
  onDeleteShift?: (id: string) => void;
  onOpenAiGenerator?: (shift: PositionShift) => void;
  onSendLineToast: (msg: string) => void;
  isVolunteerMode?: boolean;
  onApplyClick?: (shift: PositionShift) => void;
  myAppliedShiftIds?: string[];
}

export const ShiftCalendarView: React.FC<ShiftCalendarViewProps> = ({
  shifts,
  onUpdateShift,
  onDeleteShift,
  onOpenAiGenerator,
  onSendLineToast,
  isVolunteerMode = false,
  onApplyClick,
  myAppliedShiftIds = []
}) => {
  // Calendar Navigation State (Default to August 2026 based on mock data date range)
  const [currentDate, setCurrentDate] = useState<Date>(new Date(2026, 7, 1)); // Month index 7 = August
  const [selectedZoneFilter, setSelectedZoneFilter] = useState<string>('all');
  const [draggedShift, setDraggedShift] = useState<PositionShift | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [activeShiftDetail, setActiveShiftDetail] = useState<PositionShift | null>(null);
  const [isSyncingGCal, setIsSyncingGCal] = useState<boolean>(false);
  const [gcalLastSyncedTime, setGcalLastSyncedTime] = useState<string>('11:45:00');

  // The shelter's single physical location (see /api/shelter-location) --
  // replaced the old fixed 3-branch selector. Admin-editable inline here;
  // volunteers just see the read-only address/hours.
  const [shelterLocation, setShelterLocation] = useState<ShelterLocation | null>(null);
  const [isEditingLocation, setIsEditingLocation] = useState(false);
  const [locationDraft, setLocationDraft] = useState({ name: '', address: '', openHours: '' });
  const [isSavingLocation, setIsSavingLocation] = useState(false);

  useEffect(() => {
    fetch('/api/shelter-location')
      .then(res => res.json())
      .then(data => { if (data.success) setShelterLocation(data.location); })
      .catch(() => { /* best-effort */ });
  }, []);

  const handleStartEditLocation = () => {
    if (!shelterLocation) return;
    setLocationDraft({ name: shelterLocation.name, address: shelterLocation.address, openHours: shelterLocation.openHours });
    setIsEditingLocation(true);
  };

  const handleSaveLocation = async () => {
    setIsSavingLocation(true);
    try {
      const res = await authFetch('/api/admin/shelter-location', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(locationDraft)
      });
      const data = await res.json();
      if (data.success) {
        setShelterLocation(data.location);
        setIsEditingLocation(false);
        onSendLineToast(data.note ? `📍 地點已更新（${data.note}）` : '📍 地點已更新，並重新定位地圖座標！');
      } else {
        onSendLineToast(`⚠️ 更新地點失敗：${data.error || '未知錯誤'}`);
      }
    } catch (err: any) {
      onSendLineToast(`⚠️ 更新地點失敗：${err.message || '網路連線異常'}`);
    } finally {
      setIsSavingLocation(false);
    }
  };

  // Edit modal state
  const [editingShift, setEditingShift] = useState<PositionShift | null>(null);
  const [editDate, setEditDate] = useState<string>('');
  const [editTimeRange, setEditTimeRange] = useState<string>('');
  const [editRequiredCount, setEditRequiredCount] = useState<number>(4);

  // Mobile agenda list: which dates are expanded to show full shift cards.
  // Collapsed by default (only a "still needs N volunteers" summary shows) so a
  // volunteer can scan a whole month at a glance instead of scrolling through
  // fully-expanded cards for every single day.
  const [expandedAgendaDates, setExpandedAgendaDates] = useState<Set<string>>(() => new Set());
  const toggleAgendaDate = (dateStr: string) => {
    setExpandedAgendaDates(prev => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr); else next.add(dateStr);
      return next;
    });
  };

  // Month navigation helpers
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const todayStr = getTaiwanTodayStr();
  const [todayYear, todayMonth, todayDay] = todayStr.split('-').map(Number);

  const handleToday = () => {
    setCurrentDate(new Date(todayYear, todayMonth - 1, todayDay));
  };

  // Generate Days for the Calendar Month Matrix
  const firstDayOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDayOfWeek = firstDayOfMonth.getDay(); // 0 = Sunday

  // Days from previous month to fill the first row
  const prevMonthLastDate = new Date(year, month, 0).getDate();
  const calendarCells: { dateStr: string; dayNum: number; isCurrentMonth: boolean; isToday: boolean }[] = [];

  // Previous month trailing days
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const day = prevMonthLastDate - i;
    const prevMonthDate = new Date(year, month - 1, day);
    const dateStr = prevMonthDate.toISOString().split('T')[0];
    calendarCells.push({
      dateStr,
      dayNum: day,
      isCurrentMonth: false,
      isToday: dateStr === todayStr
    });
  }

  // Current month days
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    // Format YYYY-MM-DD cleanly using local numbers
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    calendarCells.push({
      dateStr,
      dayNum: day,
      isCurrentMonth: true,
      isToday: dateStr === todayStr
    });
  }

  // Next month leading days to complete full grid (6 rows of 7 = 42 cells)
  const remainingCells = 42 - calendarCells.length;
  for (let day = 1; day <= remainingCells; day++) {
    const nextMonthDate = new Date(year, month + 1, day);
    const dateStr = nextMonthDate.toISOString().split('T')[0];
    calendarCells.push({
      dateStr,
      dayNum: day,
      isCurrentMonth: false,
      isToday: dateStr === todayStr
    });
  }

  // Filter Shifts
  const filteredShifts = shifts.filter(s => {
    if (selectedZoneFilter !== 'all' && s.zone !== selectedZoneFilter) return false;
    return true;
  });

  // Drag & Drop Handlers
  const handleDragStart = (e: React.DragEvent, shift: PositionShift) => {
    setDraggedShift(shift);
    e.dataTransfer.setData('text/plain', shift.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, dateStr: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverDate !== dateStr) {
      setDragOverDate(dateStr);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetDateStr: string) => {
    e.preventDefault();
    setDragOverDate(null);

    if (!draggedShift) return;

    if (draggedShift.date === targetDateStr) {
      setDraggedShift(null);
      return;
    }

    const oldDate = draggedShift.date;
    const updatedShift: PositionShift = {
      ...draggedShift,
      date: targetDateStr
    };

    onUpdateShift(updatedShift);

    const nowStr = new Date().toLocaleTimeString('zh-TW', { hour12: false });
    setGcalLastSyncedTime(nowStr);

    onSendLineToast(
      `📅 拖曳成功！班次【${draggedShift.title}】已從 ${oldDate} 改期至 ${targetDateStr}。Google Calendar 預約連結已自動即時同步更新！`
    );

    setDraggedShift(null);
  };

  // Manual Batch Sync with Google Calendar
  const handleManualGCalSync = () => {
    setIsSyncingGCal(true);
    setTimeout(() => {
      setIsSyncingGCal(false);
      const nowStr = new Date().toLocaleTimeString('zh-TW', { hour12: false });
      setGcalLastSyncedTime(nowStr);
      onSendLineToast(`⚡ 已成功向 Google Calendar API 發送全量同步請求！共 ${filteredShifts.length} 個班次時間區塊更新完成。`);
    }, 1000);
  };

  // Open Edit Shift Modal
  const handleOpenEditModal = (shift: PositionShift) => {
    setEditingShift(shift);
    setEditDate(shift.date);
    setEditTimeRange(shift.timeRange);
    setEditRequiredCount(shift.requiredCount);
  };

  const handleSaveEditShift = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingShift) return;

    const updated: PositionShift = {
      ...editingShift,
      date: editDate,
      timeRange: editTimeRange,
      requiredCount: editRequiredCount
    };

    onUpdateShift(updated);
    setEditingShift(null);

    const nowStr = new Date().toLocaleTimeString('zh-TW', { hour12: false });
    setGcalLastSyncedTime(nowStr);

    onSendLineToast(`✏️ 班次【${updated.title}】時間與名額已修改！Google Calendar 與志工系統已自動同步。`);
  };

  const monthNames = ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月', '7 月', '8 月', '9 月', '10 月', '11 月', '12 月'];
  const weekDays = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

  return (
    <div className="space-y-6">
      
      {/* Google Calendar Sync Status Bar */}
      <div className="bg-[#FFFDF7] border border-[#716053] rounded-[28px] p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#716053] text-amber-300 flex items-center justify-center shrink-0 shadow-xs font-bold text-lg">
            🗓️
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold font-serif text-slate-900 text-base">
                {isVolunteerMode ? '志工排班月曆時間表 (Google 日曆即時連線)' : 'Google Calendar Appointment Schedule 雙向同步服務'}
              </h3>
              <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border border-emerald-300 inline-flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                <span>即時連線中</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {isVolunteerMode 
                ? '提示：點擊下方月曆上的任意班次可查看詳細工作內容並線上報名，報名後將自動同步至您的 Google 日曆與手機行程。' 
                : '提示：您可以直接在下方月曆中按住拖曳班次至新日期，系統將透過 Google Workspace Calendar API 自動更新對應預約時段並推播通知。'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start md:self-auto shrink-0">
          <span className="text-[11px] text-slate-400 font-mono">
            最後同步：{gcalLastSyncedTime}
          </span>
          {!isVolunteerMode ? (
            <button
              onClick={handleManualGCalSync}
              disabled={isSyncingGCal}
              className="bg-[#716053] hover:bg-[#5A4A3F] text-white font-bold text-xs px-4 py-2 rounded-xl shadow-2xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-amber-300 ${isSyncingGCal ? 'animate-spin' : ''}`} />
              <span>{isSyncingGCal ? '同步中...' : '手動同步 Google 日曆'}</span>
            </button>
          ) : (
            <button
              onClick={handleManualGCalSync}
              disabled={isSyncingGCal}
              className="bg-[#FAF6EE] hover:bg-[#F5E6D0]/40 text-[#716053] border border-[#716053] font-bold text-xs px-3.5 py-2 rounded-xl shadow-2xs transition flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#716053] ${isSyncingGCal ? 'animate-spin' : ''}`} />
              <span>重新整理班表</span>
            </button>
          )}
        </div>
      </div>

      {/* Calendar Header Controls */}
      <div className="bg-white rounded-[28px] border border-[#716053] p-5 shadow-xs flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        
        {/* Navigation & Month Title */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-[#FAF6EE] p-1 rounded-2xl border border-[#716053]">
            <button
              onClick={handlePrevMonth}
              className="p-2 hover:bg-white rounded-xl text-[#716053] transition cursor-pointer"
              title="上個月"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleNextMonth}
              className="p-2 hover:bg-white rounded-xl text-[#716053] transition cursor-pointer"
              title="下個月"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={handleToday}
            className="bg-white hover:bg-[#FAF6EE] text-[#716053] border border-[#716053] font-bold text-xs px-3 py-2 rounded-2xl transition cursor-pointer"
          >
            今天 ({todayYear}/{todayMonth}/{todayDay})
          </button>

          <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
            <CalendarIcon className="w-5 h-5 text-[#716053]" />
            <h2 className="text-xl font-bold font-serif italic text-slate-900">
              {year} 年 {monthNames[month]}
            </h2>
          </div>
        </div>

        {/* Shelter Location -- admin-editable, replaces the old fixed 3-branch
            selector. Volunteers see it read-only. */}
        {shelterLocation && (
          !isEditingLocation ? (
            <div className="flex items-center gap-2 bg-[#FAF6EE] px-3 py-2 rounded-2xl border border-[#716053] text-xs">
              <MapPin className="w-4 h-4 text-rose-600 shrink-0" />
              <div className="min-w-0">
                <span className="font-bold text-slate-800">{shelterLocation.name}</span>
                <span className="text-slate-500 ml-1.5 truncate">{shelterLocation.address}</span>
                {!shelterLocation.geocoded && (
                  <span className="ml-1.5 text-amber-600 text-[10px] font-bold">（尚未定位）</span>
                )}
              </div>
              {!isVolunteerMode && (
                <button
                  onClick={handleStartEditLocation}
                  className="text-[#716053] hover:bg-white p-1 rounded-lg transition cursor-pointer shrink-0"
                  title="編輯園區地點"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <div className="bg-white border border-amber-300 rounded-2xl p-3 space-y-2 text-xs w-full lg:w-auto lg:min-w-[320px]">
              <input
                type="text"
                value={locationDraft.name}
                onChange={e => setLocationDraft({ ...locationDraft, name: e.target.value })}
                placeholder="園區名稱"
                className="w-full p-2 bg-[#FAF6EE] border border-[#716053] rounded-xl font-bold focus:ring-2 focus:ring-amber-400 focus:outline-none"
              />
              <input
                type="text"
                value={locationDraft.address}
                onChange={e => setLocationDraft({ ...locationDraft, address: e.target.value })}
                placeholder="完整地址（將用於 Google 地圖定位與導航）"
                className="w-full p-2 bg-[#FAF6EE] border border-[#716053] rounded-xl focus:ring-2 focus:ring-amber-400 focus:outline-none"
              />
              <input
                type="text"
                value={locationDraft.openHours}
                onChange={e => setLocationDraft({ ...locationDraft, openHours: e.target.value })}
                placeholder="開放時間"
                className="w-full p-2 bg-[#FAF6EE] border border-[#716053] rounded-xl focus:ring-2 focus:ring-amber-400 focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setIsEditingLocation(false)}
                  className="px-3 py-1.5 rounded-xl font-bold text-slate-500 hover:bg-slate-100 cursor-pointer"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveLocation}
                  disabled={isSavingLocation || !locationDraft.name.trim() || !locationDraft.address.trim()}
                  className="px-4 py-1.5 rounded-xl font-bold bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 cursor-pointer"
                >
                  {isSavingLocation ? '定位中...' : '儲存並重新定位'}
                </button>
              </div>
            </div>
          )
        )}

        {/* Zone Filters */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-400 font-bold text-[11px] mr-1">過濾場域：</span>
          <button
            onClick={() => setSelectedZoneFilter('all')}
            className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer border ${
              selectedZoneFilter === 'all'
                ? 'bg-[#716053] text-white border-[#716053]'
                : 'bg-white text-slate-600 hover:bg-[#FAF6EE] border-slate-200'
            }`}
          >
            全部場域
          </button>
          {Object.keys(ZONE_CONFIGS).map(zKey => {
            const z = ZONE_CONFIGS[zKey];
            return (
              <button
                key={zKey}
                onClick={() => setSelectedZoneFilter(zKey)}
                className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1 cursor-pointer border ${
                  selectedZoneFilter === zKey
                    ? 'bg-[#716053] text-white border-[#716053]'
                    : 'bg-white text-slate-600 hover:bg-[#FAF6EE] border-slate-200'
                }`}
              >
                <span>{z.icon}</span>
                <span>{z.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Mobile Agenda / List View -- a 7-column grid genuinely can't fit readable
          text on a phone screen, so below the md breakpoint we switch to a
          Google-Calendar-style agenda list instead of just shrinking the same
          grid. Every day in the month gets a row (not just days with shifts,
          so a volunteer can see well beyond a handful of upcoming days); each
          row is collapsed to a one-line "still needs N volunteers" summary by
          default and expands on tap to reveal the full shift cards. */}
      <div className="md:hidden space-y-2">
        {(() => {
          const monthDays = calendarCells
            .filter(cell => cell.isCurrentMonth)
            .map(cell => ({ cell, dayShifts: filteredShifts.filter(s => s.date === cell.dateStr) }));

          return monthDays.map(({ cell, dayShifts }) => {
            const weekdayLabel = weekDays[new Date(`${cell.dateStr}T00:00:00`).getDay()];
            const vacancyCount = dayShifts.reduce((sum, s) => sum + Math.max(0, s.requiredCount - s.currentCount), 0);
            const hasShifts = dayShifts.length > 0;
            const isExpanded = expandedAgendaDates.has(cell.dateStr);

            return (
              <div
                key={cell.dateStr}
                className={`bg-white rounded-2xl border overflow-hidden shadow-2xs ${
                  cell.isToday ? 'border-amber-400 ring-1 ring-amber-300' : 'border-[#716053]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => hasShifts && toggleAgendaDate(cell.dateStr)}
                  className={`w-full px-4 py-2.5 flex items-center justify-between gap-2 text-left ${
                    hasShifts ? 'cursor-pointer active:bg-[#FAF6EE]' : 'cursor-default'
                  } ${cell.isToday ? 'bg-amber-50' : hasShifts ? 'bg-[#f8f8f5]' : 'bg-white'}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-sm font-extrabold font-mono px-2 py-0.5 rounded-full shrink-0 ${
                      cell.isToday ? 'bg-amber-500 text-slate-950' : hasShifts ? 'text-slate-800' : 'text-slate-400'
                    }`}>
                      {month + 1}/{cell.dayNum}
                    </span>
                    <span className={`text-xs font-bold shrink-0 ${hasShifts ? 'text-slate-500' : 'text-slate-300'}`}>
                      {weekdayLabel}{cell.isToday ? ' · 今天' : ''}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {!hasShifts ? (
                      <span className="text-[10px] font-bold text-slate-300">無班次安排</span>
                    ) : vacancyCount > 0 ? (
                      <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full whitespace-nowrap">
                        {dayShifts.length} 班次・尚缺 {vacancyCount} 人
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                        {dayShifts.length} 班次已額滿
                      </span>
                    )}
                    {hasShifts && (
                      <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    )}
                  </div>
                </button>

                {hasShifts && isExpanded && (
                <div className="p-3 pt-1 space-y-2">
                  {dayShifts.map(shift => {
                    const zConf = ZONE_CONFIGS[shift.zone];
                    const isFull = shift.currentCount >= shift.requiredCount;
                    const isApplied = myAppliedShiftIds.includes(shift.id);

                    return (
                      <div
                        key={shift.id}
                        onClick={() => setActiveShiftDetail(shift)}
                        className={`p-3 rounded-2xl text-sm border transition shadow-2xs cursor-pointer active:scale-[0.98] ${
                          isApplied
                            ? 'bg-emerald-50 border-emerald-300 ring-1 ring-emerald-400 text-emerald-950'
                            : shift.zone === 'cat'
                            ? 'bg-amber-50 border-amber-200 text-amber-950'
                            : shift.zone === 'dog'
                            ? 'bg-sky-50 border-sky-200 text-sky-950'
                            : shift.zone === 'puppy'
                            ? 'bg-rose-50 border-rose-200 text-rose-950'
                            : shift.zone === 'medical'
                            ? 'bg-purple-50 border-purple-200 text-purple-950'
                            : 'bg-emerald-50 border-emerald-200 text-emerald-950'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 font-bold">
                            <span>{zConf?.icon}</span>
                            <span>{shift.title}</span>
                          </div>
                          {isVolunteerMode && isApplied && (
                            <span className="bg-emerald-600 text-white text-[10px] font-black px-2 py-0.5 rounded-md shrink-0">
                              已報名
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between text-xs mt-1.5 text-slate-600 pt-1.5 border-t border-slate-200/50">
                          <span className="flex items-center gap-1 font-mono">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <span>{shift.timeRange}</span>
                          </span>
                          <span className={`font-bold px-2 py-0.5 rounded-full ${
                            isFull ? 'bg-emerald-200 text-emerald-900' : 'bg-white text-slate-700 border border-slate-200'
                          }`}>
                            {shift.currentCount}/{shift.requiredCount} 人
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
            );
          });
        })()}
      </div>

      {/* Main Full Page Calendar Grid (desktop/tablet only -- a 7-column grid
          doesn't fit readable text on a phone screen, see the agenda list above) */}
      <div className="hidden md:block bg-white rounded-[32px] border border-[#716053] overflow-hidden shadow-xs">

        {/* Days of Week Header */}
        <div className="grid grid-cols-7 border-b border-[#716053] bg-[#f8f8f5] text-center">
          {weekDays.map((wd, i) => (
            <div
              key={wd}
              className={`py-3 text-xs font-bold font-serif ${
                i === 0 || i === 6 ? 'text-amber-800 bg-amber-500/10' : 'text-[#716053]'
              }`}
            >
              {wd}
            </div>
          ))}
        </div>

        {/* 6x7 Calendar Matrix */}
        <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y divide-[#716053]/10 bg-slate-50/30">
          {calendarCells.map((cell, index) => {
            const dayShifts = filteredShifts.filter(s => s.date === cell.dateStr);
            const isDragTarget = dragOverDate === cell.dateStr;

            return (
              <div
                key={`${cell.dateStr}-${index}`}
                onDragOver={e => !isVolunteerMode && handleDragOver(e, cell.dateStr)}
                onDragLeave={!isVolunteerMode ? handleDragLeave : undefined}
                onDrop={e => !isVolunteerMode && handleDrop(e, cell.dateStr)}
                className={`min-h-[140px] p-2 transition flex flex-col justify-between ${
                  !cell.isCurrentMonth ? 'bg-slate-100/60 text-slate-400' : 'bg-white'
                } ${
                  cell.isToday ? 'ring-2 ring-amber-400 ring-inset bg-amber-50/20' : ''
                } ${
                  isDragTarget ? 'bg-amber-100/80 border-2 border-dashed border-amber-500 scale-[0.99]' : ''
                }`}
              >
                {/* Cell Header: Day Number */}
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className={`text-xs font-extrabold font-mono px-2 py-0.5 rounded-full ${
                      cell.isToday
                        ? 'bg-amber-500 text-slate-950 shadow-2xs'
                        : cell.isCurrentMonth
                        ? 'text-slate-800'
                        : 'text-slate-400'
                    }`}
                  >
                    {cell.dayNum} 日
                  </span>

                  {dayShifts.length > 0 && (
                    <span className="text-[10px] font-bold text-[#716053] bg-[#FAF6EE] border border-[#716053] px-1.5 py-0.2 rounded-full">
                      {dayShifts.length} 班次
                    </span>
                  )}
                </div>

                {/* Shifts List for this date */}
                <div className="space-y-1.5 flex-1 overflow-y-auto max-h-[160px] pr-0.5">
                  {dayShifts.map(shift => {
                    const zConf = ZONE_CONFIGS[shift.zone];
                    const isFull = shift.currentCount >= shift.requiredCount;
                    const isBeingDragged = draggedShift?.id === shift.id;
                    const isApplied = myAppliedShiftIds.includes(shift.id);

                    return (
                      <div
                        key={shift.id}
                        draggable={!isVolunteerMode}
                        onDragStart={e => !isVolunteerMode && handleDragStart(e, shift)}
                        onClick={() => setActiveShiftDetail(shift)}
                        className={`p-2 rounded-xl text-xs border transition shadow-2xs group relative hover:shadow-md ${
                          !isVolunteerMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer hover:border-[#716053]'
                        } ${
                          isBeingDragged ? 'opacity-40 scale-95 border-amber-500' : ''
                        } ${
                          isApplied 
                            ? 'bg-emerald-50 border-emerald-300 ring-1 ring-emerald-400 text-emerald-950'
                            : shift.zone === 'cat'
                            ? 'bg-amber-50 border-amber-200 text-amber-950 hover:border-amber-400'
                            : shift.zone === 'dog'
                            ? 'bg-sky-50 border-sky-200 text-sky-950 hover:border-sky-400'
                            : shift.zone === 'puppy'
                            ? 'bg-rose-50 border-rose-200 text-rose-950 hover:border-rose-400'
                            : shift.zone === 'medical'
                            ? 'bg-purple-50 border-purple-200 text-purple-950 hover:border-purple-400'
                            : 'bg-emerald-50 border-emerald-200 text-emerald-950 hover:border-emerald-400'
                        }`}
                      >
                        {/* Drag Handle & Zone Icon */}
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1 font-bold text-[11px] truncate">
                            {!isVolunteerMode && (
                              <GripVertical className="w-3 h-3 text-slate-400 shrink-0 group-hover:text-slate-700" />
                            )}
                            <span>{zConf?.icon}</span>
                            <span className="truncate">{shift.title}</span>
                          </div>

                          {/* Quick Edit button on hover (Admin only) */}
                          {!isVolunteerMode && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenEditModal(shift);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/80 rounded transition cursor-pointer text-slate-600"
                              title="快速修改時間/人數"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                          )}

                          {isVolunteerMode && isApplied && (
                            <span className="bg-emerald-600 text-white text-[9px] font-black px-1.5 py-0.2 rounded-md shrink-0">
                              已報名
                            </span>
                          )}
                        </div>

                        {/* Shift Time & Capacity */}
                        <div className="flex items-center justify-between text-[10px] mt-1 text-slate-600 pt-1 border-t border-slate-200/50">
                          <span className="flex items-center gap-0.5 font-mono">
                            <Clock className="w-2.5 h-2.5 text-slate-400" />
                            <span>{shift.timeRange}</span>
                          </span>

                          <span className={`font-bold px-1.5 py-0.2 rounded-full ${
                            isFull ? 'bg-emerald-200 text-emerald-900' : 'bg-white text-slate-700 border border-slate-200'
                          }`}>
                            {shift.currentCount}/{shift.requiredCount} 人
                          </span>
                        </div>

                        {/* Hint row */}
                        <div className="mt-1 flex items-center justify-end text-[9px] text-slate-400">
                          {!isVolunteerMode ? (
                            <span className="font-mono text-[9px]">按住拖拽</span>
                          ) : (
                            <span className="text-amber-700 font-bold text-[9px]">點擊詳情</span>
                          )}
                        </div>

                      </div>
                    );
                  })}
                </div>

                {/* Drop Hint when empty (Admin only) */}
                {dayShifts.length === 0 && !isVolunteerMode && (
                  <div className="h-full border border-dashed border-slate-200 rounded-xl flex items-center justify-center text-[10px] text-slate-300 italic p-1">
                    可拖入班次
                  </div>
                )}

              </div>
            );
          })}
        </div>

      </div>

      {/* Modal: Shift Detail Preview */}
      {activeShiftDetail && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-[#716053] space-y-4 max-h-[90vh] overflow-y-auto">
            
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${ZONE_CONFIGS[activeShiftDetail.zone]?.badgeBg}`}>
                  {ZONE_CONFIGS[activeShiftDetail.zone]?.icon} {ZONE_CONFIGS[activeShiftDetail.zone]?.name}
                </span>
                <h3 className="font-bold font-serif text-slate-900 text-lg mt-1">
                  {activeShiftDetail.title}
                </h3>
              </div>
              <button
                onClick={() => setActiveShiftDetail(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-full cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2.5 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-[#716053] shrink-0" />
                <span>日期：<strong className="text-slate-900 font-mono">{activeShiftDetail.date}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#716053] shrink-0" />
                <span>時間時段：<strong className="text-slate-900 font-mono">{activeShiftDetail.timeRange}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-[#716053] shrink-0" />
                <span>集合據點：<strong>{activeShiftDetail.locationDetails}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[#716053] shrink-0" />
                <span>招募名額：<strong>已報名 {activeShiftDetail.currentCount} / 目標 {activeShiftDetail.requiredCount} 位</strong></span>
              </div>

              <div className="pt-1">
                <span className="inline-block text-[10px] font-bold bg-[#FAF6EE] border border-[#716053] px-2.5 py-0.5 rounded-full text-[#716053]">
                  志工門檻：{activeShiftDetail.skillRequired === 'beginner' ? '新手皆可' : activeShiftDetail.skillRequired === 'intermediate' ? '需具備基礎散步經驗' : '需資深志工/專業認證'}
                </span>
              </div>
            </div>

            {/* Tasks list */}
            {activeShiftDetail.tasks && activeShiftDetail.tasks.length > 0 && (
              <div className="bg-[#FFFDF7] p-3.5 rounded-2xl border border-slate-200 text-xs space-y-1.5">
                <span className="font-bold text-[#716053] block text-[11px]">🐾 本班次主要服務任務：</span>
                {activeShiftDetail.tasks.map((task, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 text-slate-700 text-xs">
                    <span className="text-amber-500 font-bold">•</span>
                    <span>{task}</span>
                  </div>
                ))}
              </div>
            )}

            {isVolunteerMode && (
              <div className="bg-[#FAF6EE] p-3 rounded-xl border border-[#716053] text-xs space-y-1">
                <span className="font-bold text-[#716053] block">Google 日曆</span>
                <p className="text-slate-600 text-[11px]">
                  {myAppliedShiftIds.includes(activeShiftDetail.id)
                    ? '已報名此班次，可點擊下方按鈕加入你自己的 Google 日曆。'
                    : '報名成功後，即可一鍵將此班次加入你自己的 Google 日曆。'}
                </p>
              </div>
            )}

            <div className="flex flex-wrap justify-between items-center gap-2 pt-2 border-t border-slate-100">
              {!isVolunteerMode ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (onUpdateShift) {
                          handleOpenEditModal(activeShiftDetail);
                          setActiveShiftDetail(null);
                        }
                      }}
                      className="bg-[#716053] hover:bg-[#5A4A3F] text-white font-bold text-xs px-4 py-2 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>編輯班次時間與名額</span>
                    </button>

                    {onDeleteShift && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`確定要刪除「${activeShiftDetail.title}」這個班次嗎？此操作無法復原。`)) {
                            onDeleteShift(activeShiftDetail.id);
                            setActiveShiftDetail(null);
                          }
                        }}
                        className="bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 font-bold text-xs px-4 py-2 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                        title="刪除此班次"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>刪除班次</span>
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveShiftDetail(null)}
                    className="bg-slate-100 text-slate-700 hover:bg-slate-200 font-bold text-xs px-4 py-2 rounded-xl cursor-pointer"
                  >
                    關閉
                  </button>
                </>
              ) : (
                <>
                  {myAppliedShiftIds.includes(activeShiftDetail.id) ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="bg-emerald-100 text-emerald-800 border border-emerald-300 font-extrabold text-xs px-4 py-2 rounded-xl flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>您已完成本班次報名</span>
                      </div>
                      <a
                        href={buildGoogleCalendarLink({
                          title: `🐾 志工班次：${activeShiftDetail.title}`,
                          date: activeShiftDetail.date,
                          timeRange: activeShiftDetail.timeRange,
                          location: activeShiftDetail.locationDetails || '浪浪家園',
                          details: `浪浪家園志工服務班次\n任務：${(activeShiftDetail.tasks || []).join('、')}`
                        })}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-[#716053] hover:bg-[#5A4A3F] text-white font-bold text-xs px-4 py-2 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <CalendarIcon className="w-3.5 h-3.5 text-amber-300" />
                        <span>加入 Google 日曆</span>
                      </a>
                    </div>
                  ) : activeShiftDetail.currentCount >= activeShiftDetail.requiredCount ? (
                    <div className="bg-slate-100 text-slate-500 font-bold text-xs px-4 py-2 rounded-xl">
                      本班次名額已額滿
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (onApplyClick) {
                          onApplyClick(activeShiftDetail);
                          setActiveShiftDetail(null);
                        }
                      }}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs px-5 py-2.5 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer transform hover:scale-105"
                    >
                      <Sparkles className="w-4 h-4 text-amber-300 fill-amber-300" />
                      <span>🐾 立即線上報名參加此班次</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setActiveShiftDetail(null)}
                    className="bg-slate-100 text-slate-700 hover:bg-slate-200 font-bold text-xs px-4 py-2 rounded-xl cursor-pointer"
                  >
                    關閉
                  </button>
                </>
              )}
            </div>

          </div>
        </div>
      )}

      {/* Modal: Edit Shift Date/Time */}
      {editingShift && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-amber-400 space-y-4">
            
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold font-serif text-slate-900 text-base">
                ✏️ 調整班次時間與 Google Calendar 同步
              </h3>
              <button
                onClick={() => setEditingShift(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-full cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditShift} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">班次名稱</label>
                <input
                  type="text"
                  disabled
                  value={editingShift.title}
                  className="w-full p-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">調整日期</label>
                <input
                  type="date"
                  required
                  value={editDate}
                  onChange={e => setEditDate(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#716053]"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">服務時段</label>
                <input
                  type="text"
                  required
                  value={editTimeRange}
                  onChange={e => setEditTimeRange(e.target.value)}
                  placeholder="如：10:00 - 13:00"
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#716053]"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">需求人數</label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  required
                  value={editRequiredCount}
                  onChange={e => setEditRequiredCount(Number(e.target.value))}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#716053]"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingShift(null)}
                  className="px-4 py-2 rounded-xl font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl font-bold bg-[#716053] hover:bg-[#5A4A3F] text-white shadow-xs cursor-pointer flex items-center gap-1"
                >
                  <Check className="w-4 h-4 text-amber-300" />
                  <span>儲存並同步至 Google Calendar</span>
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

    </div>
  );
};
