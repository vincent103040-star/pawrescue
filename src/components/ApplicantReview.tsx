import React, { useState } from 'react';
import { ShiftSignup, PositionShift, SignupStatus } from '../types';
import { ZONE_CONFIGS } from '../data/mockData';
import { detectSignupConflicts } from '../utils/conflictChecker';
import { ConflictCheckModal } from './ConflictCheckModal';
import { Check, X, Search, Filter, ShieldCheck, Clock, Calendar, Phone, Mail, MessageSquare, Send, CheckCircle2, AlertCircle, Eye, ShieldAlert, AlertTriangle, Trash2, Sparkles, ArrowUpRight } from 'lucide-react';
import { buildGoogleCalendarLink } from '../utils/googleCalendar';
import { sendLinePush } from '../utils/linePush';

interface ApplicantReviewProps {
  shiftSignups: ShiftSignup[];
  shifts: PositionShift[];
  onUpdateStatus: (id: string, newStatus: SignupStatus, reviewNotes?: string) => void;
  onSendLineToast: (msg: string) => void;
}

export const ApplicantReview: React.FC<ApplicantReviewProps> = ({
  shiftSignups,
  shifts,
  onUpdateStatus,
  onSendLineToast
}) => {
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [activeAppModal, setActiveAppModal] = useState<ShiftSignup | null>(null);
  const [reviewNoteInput, setReviewNoteInput] = useState('');
  const [showConflictModal, setShowConflictModal] = useState(false);

  const conflicts = detectSignupConflicts(shiftSignups, shifts);

  const filteredApps = shiftSignups.filter(app => {
    if (selectedStatus !== 'all' && app.status !== selectedStatus) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return (
        app.volunteerName.toLowerCase().includes(term) ||
        app.lineId.toLowerCase().includes(term) ||
        app.volunteerPhone.includes(term)
      );
    }
    return true;
  });

  const handleApprove = async (app: ShiftSignup) => {
    const notes = reviewNoteInput || '審核通過！歡迎支援浪浪園區。';
    onUpdateStatus(app.id, 'approved', notes);
    setActiveAppModal(null);
    setReviewNoteInput('');

    const shift = shifts.find(s => s.id === app.shiftId);
    const text = `🎉【錄取通知】您報名的【${shift?.title || '志工班次'}】(${shift?.date || ''} ${shift?.timeRange || ''}) 已審核通過！\n社工回覆：${notes}`;

    const result = await sendLinePush(app.volunteerEmail, text, 'shiftChanges');
    onSendLineToast(
      result.ok && !result.simulated
        ? `✅ 已真的發送 LINE 錄取通知給【${app.volunteerName}】！`
        : `已向【${app.volunteerName}】(LINE ID: ${app.lineId}) 發送錄取通知（模擬效果 — 未真正送達，可能是該志工尚未連結 LINE、關閉了此類通知偏好、或未設定 Token）`
    );
  };

  const handleReject = async (app: ShiftSignup) => {
    const notes = reviewNoteInput || '抱歉，該班次名額暫滿或資格未符。';
    onUpdateStatus(app.id, 'rejected', notes);
    setActiveAppModal(null);
    setReviewNoteInput('');

    const shift = shifts.find(s => s.id === app.shiftId);
    const text = `您報名的【${shift?.title || '志工班次'}】審核結果：婉拒\n社工回覆：${notes}`;

    const result = await sendLinePush(app.volunteerEmail, text, 'shiftChanges');
    onSendLineToast(
      result.ok && !result.simulated
        ? `✅ 已真的發送 LINE 婉拒通知給【${app.volunteerName}】。`
        : `已向【${app.volunteerName}】發送婉拒訊息（模擬效果 — 未真正送達，可能是該志工尚未連結 LINE、關閉了此類通知偏好、或未設定 Token）`
    );
  };

  return (
    <div className="space-y-6 py-6 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 sm:p-8 rounded-[32px] border border-[#716053] shadow-xs">
        <div>
          <h2 className="text-2xl font-bold font-serif italic text-[#716053] flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-[#716053]" />
            <span>志工報名審核與名單派發中心</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1 font-sans">
            當社工審核通過報名，系統會自動喚醒 LINE Bot 發送【錄取成功通知】並將班次寫入志工的 Google 日曆與圖文選單。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto text-xs font-sans">
          <button
            onClick={() => setShowConflictModal(true)}
            className="bg-rose-600 hover:bg-rose-700 text-white font-extrabold px-4 py-2 rounded-full shadow-xs transition flex items-center gap-1.5 cursor-pointer"
          >
            <ShieldAlert className="w-4 h-4 text-rose-200 animate-pulse" />
            <span>🚨 衝突檢查儀表板</span>
            {conflicts.length > 0 && (
              <span className="bg-white text-rose-900 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                {conflicts.length} 筆重疊
              </span>
            )}
          </button>

          <span className="px-3.5 py-1.5 bg-[#F5E6D0] text-[#716053] font-bold rounded-full">
            待審核：{shiftSignups.filter(a => a.status === 'pending').length} 筆
          </span>
          <span className="px-3.5 py-1.5 bg-emerald-100 text-emerald-900 font-bold rounded-full">
            已錄取：{shiftSignups.filter(a => a.status === 'approved').length} 筆
          </span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 sm:p-5 rounded-[24px] border border-[#716053]">
        
        {/* Status Pills */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold w-full sm:w-auto">
          <button
            onClick={() => setSelectedStatus('all')}
            className={`px-4 py-1.5 rounded-full transition cursor-pointer ${
              selectedStatus === 'all'
                ? 'bg-[#716053] text-white shadow-xs font-bold'
                : 'bg-[#FAF6EE] text-slate-600 hover:bg-[#F5E6D0]/40'
            }`}
          >
            全部申請 ({shiftSignups.length})
          </button>

          <button
            onClick={() => setSelectedStatus('pending')}
            className={`px-4 py-1.5 rounded-full transition flex items-center gap-1.5 cursor-pointer ${
              selectedStatus === 'pending'
                ? 'bg-rose-600 text-white shadow-xs font-bold'
                : 'bg-rose-50 text-rose-800'
            }`}
          >
            <span>待審核</span>
            <span className="bg-white/30 px-2 py-0.5 rounded-full text-[10px]">
              {shiftSignups.filter(a => a.status === 'pending').length}
            </span>
          </button>

          <button
            onClick={() => setSelectedStatus('approved')}
            className={`px-4 py-1.5 rounded-full transition cursor-pointer ${
              selectedStatus === 'approved'
                ? 'bg-emerald-700 text-white shadow-xs font-bold'
                : 'bg-emerald-50 text-emerald-800'
            }`}
          >
            已錄取 ({shiftSignups.filter(a => a.status === 'approved').length})
          </button>

          <button
            onClick={() => setSelectedStatus('rejected')}
            className={`px-4 py-1.5 rounded-full transition cursor-pointer ${
              selectedStatus === 'rejected'
                ? 'bg-slate-700 text-white shadow-xs font-bold'
                : 'bg-[#FAF6EE] text-slate-600'
            }`}
          >
            已退回
          </button>
        </div>

        {/* Search input */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-[#716053] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="搜尋姓名、電話、LINE ID..."
            className="w-full pl-10 pr-4 py-2 bg-[#FAF6EE] border border-[#716053] rounded-full text-xs focus:ring-2 focus:ring-[#716053] focus:outline-none"
          />
        </div>

      </div>

      {/* Applications Table / Cards */}
      <div className="bg-white rounded-[28px] border border-[#716053] shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#FAF6EE] border-b border-[#716053] text-[11px] font-bold text-[#716053] uppercase tracking-wider">
                <th className="py-4 px-5">志工姓名 / 聯絡資訊</th>
                <th className="py-4 px-5">報名班次與場域</th>
                <th className="py-4 px-5">經驗等級</th>
                <th className="py-4 px-5">申請時間</th>
                <th className="py-4 px-5">審核狀態</th>
                <th className="py-4 px-5 text-right">審核操作</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#716053]/10 text-xs font-sans">
              {filteredApps.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    目前無對應的報名紀錄
                  </td>
                </tr>
              ) : (
                filteredApps.map(app => {
                  const shift = shifts.find(s => s.id === app.shiftId);
                  const zoneConf = ZONE_CONFIGS[app.appliedZone];
                  const conflictForApp = conflicts.find(c => c.app1.id === app.id || c.app2.id === app.id);
                  const hasConflict = !!conflictForApp;

                  return (
                    <tr key={app.id} className={`hover:bg-[#FAF6EE]/60 transition ${hasConflict ? 'bg-rose-50/40' : ''}`}>
                      
                      {/* Volunteer Info */}
                      <td className="py-4 px-5">
                        <div className="font-bold text-slate-900 flex flex-wrap items-center gap-2">
                          <span>{app.volunteerName}</span>
                          <span className="text-[10px] bg-[#F5E6D0] text-[#716053] px-2 py-0.5 rounded-full font-bold">
                            LINE: @{app.lineId}
                          </span>
                          {hasConflict && (
                            <button
                              onClick={() => setShowConflictModal(true)}
                              className="text-[10px] bg-rose-600 hover:bg-rose-700 text-white font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1 cursor-pointer animate-pulse"
                              title="檢視時間重疊衝突詳情"
                            >
                              <ShieldAlert className="w-3 h-3" />
                              <span>🚨 重複報名衝突</span>
                            </button>
                          )}
                          {app.aiReadinessAssessment && (
                            <span
                              className="text-[10px] bg-violet-100 text-violet-800 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 cursor-help"
                              title={
                                `AI 情境測驗準備度：${app.aiReadinessAssessment.score}/5\n` +
                                `回饋：${app.aiReadinessAssessment.feedback}` +
                                (app.aiReadinessAssessment.flags.length
                                  ? `\n觀察重點：${app.aiReadinessAssessment.flags.join('、')}`
                                  : '') +
                                `\n（僅供參考，不自動核准或拒絕）`
                              }
                            >
                              <Sparkles className="w-3 h-3" />
                              <span>AI 準備度 {app.aiReadinessAssessment.score}/5</span>
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-3 mt-1">
                          <span>📞 {app.volunteerPhone}</span>
                          <span>✉️ {app.volunteerEmail}</span>
                        </div>
                      </td>

                      {/* Shift & Zone */}
                      <td className="py-4 px-5">
                        <div className="font-semibold text-slate-800">
                          {shift?.title || '通用志工班次'}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${zoneConf?.badgeBg}`}>
                            {zoneConf?.icon} {zoneConf?.name}
                          </span>
                          <span className="text-[11px] text-slate-500">{shift?.date} ({shift?.timeRange})</span>
                        </div>
                      </td>

                      {/* Experience */}
                      <td className="py-4 px-5">
                        <span className="text-[11px] font-semibold bg-[#FAF6EE] border border-[#716053] px-2.5 py-1 rounded-full text-[#716053]">
                          {app.experienceLevel === 'beginner' ? '🐣 新手' : app.experienceLevel === 'intermediate' ? '🐕 中階經驗' : '🏥 資深醫護'}
                        </span>
                      </td>

                      {/* Applied At */}
                      <td className="py-4 px-5 text-slate-500 text-[11px]">
                        {app.appliedAt}
                      </td>

                      {/* Status */}
                      <td className="py-4 px-5">
                        {app.status === 'pending' && (
                          <span className="bg-rose-100 text-rose-800 px-3 py-1 rounded-full text-[11px] font-bold flex items-center gap-1 w-fit animate-pulse">
                            <Clock className="w-3 h-3" /> 待審核
                          </span>
                        )}
                        {app.status === 'approved' && (
                          <div className="space-y-1">
                            <span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full text-[11px] font-bold flex items-center gap-1 w-fit">
                              <CheckCircle2 className="w-3 h-3" /> 已通過
                            </span>
                            {shift && (
                              <a
                                href={buildGoogleCalendarLink({
                                  title: `🐾 志工班次：${shift.title}`,
                                  date: shift.date,
                                  timeRange: shift.timeRange,
                                  location: shift.locationDetails || '浪浪家園',
                                  details: `浪浪家園志工服務班次\n地點：${shift.locationDetails || ''}\n任務：${(shift.tasks || []).join('、')}`
                                })}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="text-[10px] text-[#716053] font-bold hover:underline flex items-center gap-0.5 w-fit"
                              >
                                <Calendar className="w-3 h-3" />
                                <span>加入日曆</span>
                                <ArrowUpRight className="w-2.5 h-2.5" />
                              </a>
                            )}
                          </div>
                        )}
                        {app.status === 'rejected' && (
                          <span className="bg-slate-200 text-slate-600 px-3 py-1 rounded-full text-[11px] font-medium w-fit">
                            已退回
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="py-4 px-5 text-right">
                        <button
                          onClick={() => setActiveAppModal(app)}
                          className="bg-[#716053] hover:bg-[#5A4A3F] text-white font-bold text-[11px] px-3.5 py-1.5 rounded-full shadow-2xs transition cursor-pointer"
                        >
                          審核詳情
                        </button>
                      </td>

                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Review Modal */}
      {activeAppModal && (() => {
        const modalConflict = conflicts.find(c => c.app1.id === activeAppModal.id || c.app2.id === activeAppModal.id);
        const otherApp = modalConflict ? (modalConflict.app1.id === activeAppModal.id ? modalConflict.app2 : modalConflict.app1) : null;
        const otherShift = modalConflict ? (modalConflict.app1.id === activeAppModal.id ? modalConflict.shift2 : modalConflict.shift1) : null;
        const isSuggestedDeleteThis = modalConflict ? modalConflict.suggestedDeleteAppId === activeAppModal.id : false;

        return (
          <div className="fixed inset-0 z-50 bg-[#716053]/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-[32px] max-w-lg w-full shadow-2xl p-6 sm:p-8 border border-[#716053] space-y-5">
              
              <div className="flex items-center justify-between border-b border-[#716053] pb-3">
                <h3 className="font-bold font-serif text-lg text-slate-900 flex items-center gap-1.5">
                  <span>審核志工報名：</span>
                  <span className="text-[#716053] italic">{activeAppModal.volunteerName}</span>
                </h3>
                <button
                  onClick={() => setActiveAppModal(null)}
                  className="text-slate-400 hover:text-[#716053] font-bold text-lg cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Conflict Alert Box inside Review Modal */}
              {modalConflict && otherShift && (
                <div className="bg-rose-50 border-2 border-rose-300 p-4 rounded-2xl text-xs space-y-2 text-rose-900">
                  <div className="flex items-center gap-2 font-extrabold text-rose-800 text-sm">
                    <ShieldAlert className="w-5 h-5 text-rose-600 animate-pulse" />
                    <span>🚨 系統偵測到時間重疊衝突！</span>
                  </div>
                  <p className="text-rose-950 font-medium leading-relaxed">
                    志工【{activeAppModal.volunteerName}】同時報名了同日 ({otherShift.date}) 時段重疊之【{otherShift.title}】({otherShift.timeRange})。
                  </p>
                  <div className="bg-white/80 p-2.5 rounded-xl border border-rose-200 text-[11px] font-semibold text-rose-950">
                    💡 系統建議處置：{modalConflict.suggestedReason}
                  </div>
                  {isSuggestedDeleteThis && (
                    <button
                      onClick={() => handleReject(activeAppModal)}
                      className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold rounded-xl text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
                    >
                      <Trash2 className="w-4 h-4 text-rose-100" />
                      <span>採納 AI 建議：自動退回/刪除此衝突申請</span>
                    </button>
                  )}
                </div>
              )}

              <div className="space-y-3 text-xs bg-[#FAF6EE] p-4 rounded-2xl border border-[#716053]">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-slate-500">電話：</span>
                    <span className="font-bold text-slate-800">{activeAppModal.volunteerPhone}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">LINE ID：</span>
                    <span className="font-bold text-[#716053]">{activeAppModal.lineId}</span>
                  </div>
                </div>

                <div>
                  <span className="text-slate-500">志工自我簡介與經驗：</span>
                  <p className="mt-1 bg-white p-3 rounded-xl border border-[#716053] font-medium text-slate-800">
                    {activeAppModal.notes || '無提供特別備註'}
                  </p>
                </div>

                <div className="flex items-center space-x-3 pt-2 text-[11px] text-[#716053] font-semibold">
                  <span>✅ 自動發送 LINE Notify 推播</span>
                  <span>✅ 同步至 Google 日曆</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#716053] mb-1">
                  給志工的回覆備註 (將同步顯示於志工 LINE 訊息)
                </label>
                <textarea
                  value={reviewNoteInput}
                  onChange={e => setReviewNoteInput(e.target.value)}
                  placeholder="例如：通過審核！請當天穿著平底鞋與方便運動的服裝，準時至 B 區草坪集合。"
                  rows={3}
                  className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl text-xs focus:ring-2 focus:ring-[#716053] focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-[#716053]">
                <button
                  onClick={() => handleReject(activeAppModal)}
                  className="px-5 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-800 font-bold text-xs rounded-full transition cursor-pointer"
                >
                  婉拒報名
                </button>

                <button
                  onClick={() => handleApprove(activeAppModal)}
                  className="px-6 py-2.5 bg-[#716053] hover:bg-[#5A4A3F] text-white font-bold text-xs rounded-full shadow-xs transition cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4 text-[#F5E6D0]" />
                  <span>通過審核 (發送 LINE 通知)</span>
                </button>
              </div>

            </div>
          </div>
        );
      })()}

      {/* Conflict Check Modal */}
      {showConflictModal && (
        <ConflictCheckModal
          shiftSignups={shiftSignups}
          shifts={shifts}
          onClose={() => setShowConflictModal(false)}
          onRejectSignup={(appId, notes) => {
            onUpdateStatus(appId, 'rejected', notes);
          }}
          onSendLineToast={onSendLineToast}
        />
      )}

    </div>
  );
};
