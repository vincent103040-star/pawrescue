import React, { useState, useEffect } from 'react';
import { PositionShift, SkillLevel, ZoneCategory, VolunteerProfile, VolunteerApplication, ApplicationStatus, ShiftTemplate } from '../types';
import { ZONE_CONFIGS } from '../data/mockData';
import { detectApplicationConflicts } from '../utils/conflictChecker';
import { ConflictCheckModal } from './ConflictCheckModal';
import { Plus, Sparkles, MapPin, Calendar, Clock, Users, FileText, Check, AlertCircle, Edit, Trash2, Link, FileCheck, Bot, UserCheck, ShieldAlert, AlertTriangle, LayoutGrid } from 'lucide-react';
import { AiScheduleModal } from './AiScheduleModal';
import { ShiftCalendarView } from './ShiftCalendarView';

interface PositionManagerProps {
  shifts: PositionShift[];
  volunteers: VolunteerProfile[];
  applications?: VolunteerApplication[];
  onCreateShift: (newShift: Omit<PositionShift, 'id' | 'createdAt'>) => void;
  onUpdateShift: (shift: PositionShift) => void;
  onDeleteShift: (id: string) => void;
  onOpenAiGenerator: (shift: PositionShift) => void;
  onSendLineToast: (msg: string) => void;
  onAssignVolunteer?: (shiftId: string, volunteer: VolunteerProfile) => void;
  onUpdateApplicationStatus?: (id: string, newStatus: ApplicationStatus, notes?: string) => void;
}

export const PositionManager: React.FC<PositionManagerProps> = ({
  shifts,
  volunteers,
  applications = [],
  onCreateShift,
  onUpdateShift,
  onDeleteShift,
  onOpenAiGenerator,
  onSendLineToast,
  onAssignVolunteer,
  onUpdateApplicationStatus
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [viewMode, setViewMode] = useState<'calendar' | 'grid'>('calendar');
  const [filterZone, setFilterZone] = useState<string>('all');
  const [aiScheduleModalShift, setAiScheduleModalShift] = useState<PositionShift | null>(null);
  const [showConflictModal, setShowConflictModal] = useState(false);

  // Reusable "班次範本" cards (auto-synced from past published shifts, see
  // AdminSopManager) -- lets the create-shift form prefill from a past shift
  // instead of retyping every field.
  const [shiftTemplates, setShiftTemplates] = useState<ShiftTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  useEffect(() => {
    fetch('/api/shift-templates')
      .then(res => res.json())
      .then(data => { if (data.success) setShiftTemplates(data.templates || []); })
      .catch(() => { /* best-effort */ });
  }, []);

  const conflicts = detectApplicationConflicts(applications, shifts);

  // Form state for creating a shift.
  const [formData, setFormData] = useState({
    title: '',
    zone: 'dog' as ZoneCategory,
    date: new Date().toISOString().split('T')[0],
    timeRange: '10:00 - 13:00',
    shiftType: 'morning' as 'morning' | 'afternoon' | 'full_day',
    requiredCount: 4,
    skillRequired: 'beginner' as SkillLevel,
    description: '',
    tasks: '帶狗狗散步、清理便便、陪伴互動',
    locationDetails: 'B戶外運動場入口',
    attachmentUrl: ''
  });

  const filteredShifts = shifts.filter(s => {
    if (filterZone !== 'all' && s.zone !== filterZone) return false;
    return true;
  });

  const handleSubmitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const taskArray = formData.tasks.split('、').map(t => t.trim()).filter(Boolean);

    onCreateShift({
      title: formData.title || `${ZONE_CONFIGS[formData.zone]?.name || '園區'}志工班次`,
      zone: formData.zone,
      date: formData.date,
      timeRange: formData.timeRange,
      shiftType: formData.shiftType,
      requiredCount: Number(formData.requiredCount) || 1,
      currentCount: 0,
      skillRequired: formData.skillRequired,
      description: formData.description || '歡迎前來支援流浪動物之家志工服務！',
      tasks: taskArray.length > 0 ? taskArray : ['動物環境照護', '互動陪伴'],
      locationDetails: formData.locationDetails || '動物之家園區大廳集合',
      attachmentUrl: formData.attachmentUrl || undefined,
      status: 'active'
    });

    setShowCreateModal(false);
    setSelectedTemplateId('');
  };

  const handleApplyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = shiftTemplates.find(t => t.id === templateId);
    if (!template) return;
    setFormData(prev => ({
      ...prev,
      title: template.title,
      zone: template.zone,
      timeRange: template.timeRange,
      requiredCount: template.requiredCount,
      skillRequired: template.skillRequired,
      description: template.description,
      tasks: template.tasks.join('、'),
      locationDetails: template.locationDetails,
      attachmentUrl: template.attachmentUrl || ''
      // date is deliberately left untouched -- a template has no meaningful
      // "next occurrence" date, so the admin picks that fresh each time.
    }));
  };

  return (
    <div className="space-y-6 py-6 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 sm:p-8 rounded-[32px] border border-[#716053] shadow-xs">
        <div>
          <h2 className="text-2xl font-bold font-serif italic text-[#716053] flex items-center gap-2">
            <span>職位發布與排班時間表管理</span>
            <span className="text-xs font-semibold font-sans bg-[#F5E6D0] text-[#716053] px-3 py-1 rounded-full">
              共 {filteredShifts.length} 班次
            </span>
          </h2>
          <p className="text-xs text-slate-500 mt-1 font-sans">
            發布新班次時，系統會自動生成對應的 Google 地圖 GPS 據點、Google 日曆 Appointment Schedule 時間區塊與 LINE 推播網址。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => setShowConflictModal(true)}
            className="bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs px-5 py-3 rounded-full shadow-xs transition flex items-center gap-2 cursor-pointer relative"
          >
            <ShieldAlert className="w-4 h-4 text-rose-200 animate-pulse" />
            <span>🚨 衝突檢查</span>
            {conflicts.length > 0 && (
              <span className="bg-white text-rose-950 font-black text-[10px] px-2 py-0.5 rounded-full animate-pulse">
                {conflicts.length} 筆重疊
              </span>
            )}
          </button>

          <button
            onClick={() => {
              if (filteredShifts.length > 0) {
                setAiScheduleModalShift(filteredShifts[0]);
              } else {
                onSendLineToast('⚠️ 目前尚無開放之志工班次');
              }
            }}
            className="bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs px-5 py-3 rounded-full shadow-xs transition flex items-center gap-2 cursor-pointer"
          >
            <Bot className="w-4 h-4 text-slate-950" />
            <span>🤖 AI 全局自動排班建議</span>
          </button>

          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-[#716053] hover:bg-[#5A4A3F] text-white font-extrabold text-lg px-24 py-4 rounded-full shadow-md transition flex items-center gap-2.5 cursor-pointer"
          >
            <Plus className="w-6 h-6 text-emerald-300" />
            <span>發布全新志工班次</span>
          </button>
        </div>
      </div>

      {/* Conflict Alert Banner when conflicts are detected */}
      {conflicts.length > 0 && (
        <div className="bg-rose-50 border-2 border-rose-300 p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="font-extrabold text-rose-900 text-sm flex items-center gap-2">
                <span>🚨 衝突檢查系統警告：發現 {conflicts.length} 組志工時間重疊重複報名！</span>
              </div>
              <p className="text-rose-800 text-xs mt-0.5">
                志工於同日重複報名了時間重疊之班次。點擊審核與自動建議按鈕，一鍵採納 AI 處置並刪除多餘申請。
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowConflictModal(true)}
            className="bg-rose-700 hover:bg-rose-800 text-white font-extrabold px-4 py-2 rounded-xl transition cursor-pointer shrink-0 shadow-xs flex items-center gap-1.5"
          >
            <Sparkles className="w-4 h-4 text-amber-300 fill-amber-300" />
            <span>檢視衝突與自動建議刪除</span>
          </button>
        </div>
      )}

      {/* Mode Switcher & Zone Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-[#716053] shadow-2xs">
        {/* View Mode Tabs */}
        <div className="flex items-center gap-1.5 bg-[#FAF6EE] p-1 rounded-xl border border-[#716053]">
          <button
            onClick={() => setViewMode('calendar')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              viewMode === 'calendar'
                ? 'bg-[#716053] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 text-amber-300" />
            <span>📅 全頁拖曳月曆視圖 (Google Calendar 雙向同步)</span>
          </button>

          <button
            onClick={() => setViewMode('grid')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              viewMode === 'grid'
                ? 'bg-[#716053] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>🎴 卡片清單視圖</span>
          </button>
        </div>

        {/* Zone Filter Pills for Grid Mode */}
        {viewMode === 'grid' && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-[#716053] mr-1 uppercase tracking-wider">區域：</span>
            <button
              onClick={() => setFilterZone('all')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition cursor-pointer ${
                filterZone === 'all'
                  ? 'bg-[#716053] text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-[#716053] hover:bg-[#F5E6D0]/40'
              }`}
            >
              全部
            </button>

            {Object.keys(ZONE_CONFIGS).map(zKey => {
              const zConf = ZONE_CONFIGS[zKey];
              return (
                <button
                  key={zKey}
                  onClick={() => setFilterZone(zKey)}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    filterZone === zKey
                      ? 'bg-[#716053] text-white shadow-xs'
                      : 'bg-white text-slate-600 border border-[#716053] hover:bg-[#F5E6D0]/40'
                  }`}
                >
                  <span>{zConf.icon}</span>
                  <span>{zConf.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Main View Content: Full Calendar or Grid List */}
      {viewMode === 'calendar' ? (
        <ShiftCalendarView
          shifts={shifts}
          onUpdateShift={onUpdateShift}
          onDeleteShift={onDeleteShift}
          onOpenAiGenerator={onOpenAiGenerator}
          onSendLineToast={onSendLineToast}
        />
      ) : (
        /* Shifts Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredShifts.map(shift => {
            const zoneConf = ZONE_CONFIGS[shift.zone];
            const isFull = shift.currentCount >= shift.requiredCount;

            return (
              <div
                key={shift.id}
                className="bg-white rounded-[28px] border border-[#716053] p-6 shadow-xs flex flex-col justify-between hover:border-[#716053] transition space-y-4"
              >
                <div className="space-y-4">
                  
                  {/* Zone & Status Badges */}
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1.5 ${zoneConf?.badgeBg}`}>
                      <span>{zoneConf?.icon}</span>
                      <span>{zoneConf?.name}</span>
                    </span>

                    <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                      isFull
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-[#F5E6D0] text-[#716053]'
                    }`}>
                      {isFull ? '已滿班' : `缺 ${shift.requiredCount - shift.currentCount} 人`}
                    </span>
                  </div>

                  {/* Shift Title */}
                  <h3 className="font-bold font-serif text-slate-900 text-lg leading-snug">
                    {shift.title}
                  </h3>

                  {/* Info List */}
                  <div className="space-y-2 text-xs text-slate-600 font-sans">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-[#716053] shrink-0" />
                      <span className="font-bold text-slate-800">{shift.locationDetails}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-[#716053] shrink-0" />
                      <span>日期：{shift.date}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-[#716053] shrink-0" />
                      <span>時段：{shift.timeRange}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Users className="w-3.5 h-3.5 text-[#716053] shrink-0" />
                      <span>名額：已報名 {shift.currentCount} / 目標 {shift.requiredCount} 人</span>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-[10px] font-bold bg-[#FAF6EE] border border-[#716053] px-2.5 py-0.5 rounded-full text-[#716053]">
                        經驗門檻：{shift.skillRequired === 'beginner' ? '新手皆可' : shift.skillRequired === 'intermediate' ? '需具備基礎散步經驗' : '需資深志工/專業'}
                      </span>
                    </div>
                  </div>

                  {/* Tasks List */}
                  <div className="bg-[#FFFDF7] p-3.5 rounded-2xl border border-[#716053] text-xs space-y-1">
                    <p className="font-bold text-[#716053] text-[11px] mb-1">任務範疇：</p>
                    {shift.tasks.map((task, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 text-slate-600">
                        <span className="text-[#716053] font-bold">•</span>
                        <span>{task}</span>
                      </div>
                    ))}
                  </div>

                  {/* Location Note & Attachment */}
                  <div className="text-[11px] text-slate-500 space-y-1 border-t border-[#716053] pt-2">
                    <p>📌 集合據點：{shift.locationDetails}</p>
                    {shift.attachmentUrl && (
                      <p className="text-[#716053] font-semibold flex items-center gap-1">
                        <FileCheck className="w-3 h-3 text-[#716053]" />
                        <span>含園區配置圖附件</span>
                      </p>
                    )}
                  </div>

                </div>

                {/* Action Buttons */}
                <div className="mt-6 pt-4 border-t border-[#716053] flex flex-wrap items-center justify-between gap-2">
                  
                  {/* AI Schedule Suggestion Button */}
                  <button
                    onClick={() => setAiScheduleModalShift(shift)}
                    className="flex-1 bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs py-2.5 px-3 rounded-full shadow-2xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Bot className="w-4 h-4 text-slate-950" />
                    <span>AI 自動排班建議</span>
                  </button>

                  {/* AI Recruitment Post Button */}
                  <button
                    onClick={() => onOpenAiGenerator(shift)}
                    className="bg-[#716053] hover:bg-[#5A4A3F] text-white font-bold text-xs py-2.5 px-3 rounded-full shadow-2xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                    title="產出宣傳推播文案"
                  >
                    <Sparkles className="w-4 h-4 text-[#F5E6D0]" />
                    <span>招募貼文</span>
                  </button>

                  <button
                    onClick={() => onDeleteShift(shift.id)}
                    className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-full transition cursor-pointer"
                    title="刪除班次"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: AI Schedule Recommendation */}
      {aiScheduleModalShift && (
        <AiScheduleModal
          shift={aiScheduleModalShift}
          volunteers={volunteers}
          onClose={() => setAiScheduleModalShift(null)}
          onSendLineToast={onSendLineToast}
          onAssignVolunteer={onAssignVolunteer}
        />
      )}

      {/* Modal: Create New Shift */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-[#716053]/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-[32px] max-w-xl w-full shadow-2xl p-6 sm:p-8 border border-[#716053] my-8 space-y-5">
            
            <div className="flex items-center justify-between border-b border-[#716053] pb-4">
              <div>
                <h3 className="text-xl font-bold font-serif italic text-[#716053]">發布全新志工需求班次</h3>
                <p className="text-xs text-slate-500 font-sans mt-0.5">將自動嵌入 Google 地圖據點與 LINE 報名推播</p>
              </div>
              <button
                onClick={() => { setShowCreateModal(false); setSelectedTemplateId(''); }}
                className="text-slate-400 hover:text-[#716053] text-xl font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitCreate} className="space-y-4 text-xs font-sans">

              {shiftTemplates.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3">
                  <label className="block font-bold text-amber-900 mb-1">套用過去班次範本 (選填，可省去重新輸入)</label>
                  <select
                    value={selectedTemplateId}
                    onChange={e => handleApplyTemplate(e.target.value)}
                    className="w-full p-3 bg-white border border-amber-300 rounded-2xl focus:ring-2 focus:ring-amber-400 focus:outline-none"
                  >
                    <option value="">— 從空白表單開始 —</option>
                    {shiftTemplates.map(t => (
                      <option key={t.id} value={t.id}>
                        {ZONE_CONFIGS[t.zone]?.icon} {t.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block font-bold text-[#716053] mb-1">班次招募名稱</label>
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={e => setFormData({ ...formData, title: e.target.value })}
                  placeholder="例如：大狗運動場假日牽繩放風與洗澡"
                  className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl focus:ring-2 focus:ring-[#716053] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-[#716053] mb-1">志工門檻</label>
                  <select
                    value={formData.skillRequired}
                    onChange={e => setFormData({ ...formData, skillRequired: e.target.value as SkillLevel })}
                    className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl focus:ring-2 focus:ring-[#716053] focus:outline-none"
                  >
                    <option value="beginner">🌱 新手皆可</option>
                    <option value="intermediate">🌿 需具備基礎散步經驗</option>
                    <option value="experienced">🌟 需資深志工/專業認證</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-[#716053] mb-1">場域類別 (日曆色彩)</label>
                  <select
                    value={formData.zone}
                    onChange={e => setFormData({ ...formData, zone: e.target.value as ZoneCategory })}
                    className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl focus:ring-2 focus:ring-[#716053] focus:outline-none"
                  >
                    {Object.keys(ZONE_CONFIGS).map(zKey => (
                      <option key={zKey} value={zKey}>
                        {ZONE_CONFIGS[zKey].icon} {ZONE_CONFIGS[zKey].name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-bold text-[#716053] mb-1">日期</label>
                  <input
                    type="date"
                    required
                    value={formData.date}
                    onChange={e => setFormData({ ...formData, date: e.target.value })}
                    className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl focus:ring-2 focus:ring-[#716053] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold text-[#716053] mb-1">服務時段</label>
                  <input
                    type="text"
                    required
                    value={formData.timeRange}
                    onChange={e => setFormData({ ...formData, timeRange: e.target.value })}
                    placeholder="10:00 - 13:00"
                    className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl focus:ring-2 focus:ring-[#716053] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold text-[#716053] mb-1">需求志工名額</label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    required
                    value={formData.requiredCount}
                    onChange={e => setFormData({ ...formData, requiredCount: Number(e.target.value) })}
                    className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl focus:ring-2 focus:ring-[#716053] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-[#716053] mb-1">詳細任務與規定 (請用頓號分隔)</label>
                <input
                  type="text"
                  value={formData.tasks}
                  onChange={e => setFormData({ ...formData, tasks: e.target.value })}
                  placeholder="貓砂清理、飼料補滿、親人安撫"
                  className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl focus:ring-2 focus:ring-[#716053] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-[#716053] mb-1">園區內部詳細集合點</label>
                <input
                  type="text"
                  value={formData.locationDetails}
                  onChange={e => setFormData({ ...formData, locationDetails: e.target.value })}
                  placeholder="如：總部 A棟2樓貓房大廳"
                  className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl focus:ring-2 focus:ring-[#716053] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-[#716053] mb-1">園區配置圖 / PDF 須知連結 (選填)</label>
                <input
                  type="url"
                  value={formData.attachmentUrl}
                  onChange={e => setFormData({ ...formData, attachmentUrl: e.target.value })}
                  placeholder="https://drive.google.com/..."
                  className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl focus:ring-2 focus:ring-[#716053] focus:outline-none"
                />
              </div>

              <div className="pt-4 flex justify-end space-x-3 border-t border-[#716053]">
                <button
                  type="button"
                  onClick={() => { setShowCreateModal(false); setSelectedTemplateId(''); }}
                  className="px-5 py-2.5 rounded-full font-bold text-slate-600 hover:bg-[#FAF6EE] cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-full font-bold bg-[#716053] hover:bg-[#5A4A3F] text-white shadow-xs cursor-pointer"
                >
                  確認發布班次
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* Modal: Application Conflict Check & Auto-Suggestion */}
      {showConflictModal && (
        <ConflictCheckModal
          applications={applications}
          shifts={shifts}
          onClose={() => setShowConflictModal(false)}
          onRejectApplication={(appId, notes) => {
            if (onUpdateApplicationStatus) {
              onUpdateApplicationStatus(appId, 'rejected', notes);
            }
          }}
          onSendLineToast={onSendLineToast}
        />
      )}

    </div>
  );
};
