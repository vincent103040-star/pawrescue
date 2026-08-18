import React, { useState } from 'react';
import { VolunteerApplication, PositionShift, Branch } from '../types';
import { detectApplicationConflicts, ApplicationConflict } from '../utils/conflictChecker';
import { ZONE_CONFIGS } from '../data/mockData';
import { ShieldAlert, AlertTriangle, CheckCircle2, Trash2, X, Sparkles, ArrowRight, UserCheck, Clock, RefreshCw, Send, Check } from 'lucide-react';

interface ConflictCheckModalProps {
  applications: VolunteerApplication[];
  shifts: PositionShift[];
  branches: Branch[];
  onClose: () => void;
  onRejectApplication: (appId: string, reviewNotes?: string) => void;
  onSendLineToast: (msg: string) => void;
}

export const ConflictCheckModal: React.FC<ConflictCheckModalProps> = ({
  applications,
  shifts,
  branches,
  onClose,
  onRejectApplication,
  onSendLineToast
}) => {
  const conflicts = detectApplicationConflicts(applications, shifts);
  const [resolvedConflictIds, setResolvedConflictIds] = useState<Set<string>>(new Set());

  const activeConflicts = conflicts.filter(c => !resolvedConflictIds.has(c.id));

  // Single resolve action
  const handleResolveConflict = (conflict: ApplicationConflict, appIdToDelete: string, appToKeepId: string) => {
    const appToDelete = appIdToDelete === conflict.app1.id ? conflict.app1 : conflict.app2;
    const shiftToDelete = appIdToDelete === conflict.app1.id ? conflict.shift1 : conflict.shift2;
    const shiftToKeep = appToKeepId === conflict.app1.id ? conflict.shift1 : conflict.shift2;

    const note = `【衝突自動刪除/退回】該志工同日已報名時間重疊之【${shiftToKeep.title}】，系統協助取消衝突報名。`;
    onRejectApplication(appToDelete.id, note);

    setResolvedConflictIds(prev => new Set(prev).add(conflict.id));
    onSendLineToast(
      `🚨 已自動退回【${conflict.volunteerName}】重疊之【${shiftToDelete.title}】報名，並發送 LINE 班表調整通知！`
    );
  };

  // Batch resolve all conflicts with system suggestion
  const handleBatchResolveAll = () => {
    let count = 0;
    activeConflicts.forEach(c => {
      const appToDelete = c.suggestedDeleteAppId === c.app1.id ? c.app1 : c.app2;
      const shiftToDelete = c.suggestedDeleteAppId === c.app1.id ? c.shift1 : c.shift2;
      const shiftToKeep = c.suggestedKeepAppId === c.app1.id ? c.shift1 : c.shift2;

      const note = `【AI 衝突檢查批量自動退回】同日時間重疊【${shiftToKeep.title}】，已保留首要班次。`;
      onRejectApplication(appToDelete.id, note);
      count++;
    });

    setResolvedConflictIds(new Set(conflicts.map(c => c.id)));
    onSendLineToast(`✅ 已一鍵採納建議，批量自動處理並退回 ${count} 筆時間衝突之重複申請！`);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#5A5A40]/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-[32px] max-w-4xl w-full shadow-2xl p-6 sm:p-8 border border-[#5A5A40]/20 my-8 space-y-6 text-slate-800 font-sans">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#5A5A40]/10 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-rose-600 text-white flex items-center justify-center shadow-xs shrink-0">
              <ShieldAlert className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-bold font-serif italic text-rose-900">
                  志工重複報名『時間衝突檢查與自動清查儀表板』
                </h3>
                <span className="bg-rose-100 text-rose-800 border border-rose-300 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full">
                  AUTO CONFLICT AUDIT
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                自動交叉比對同一志工於同日報名之時間重疊班次，系統將發出警示並智慧建議建議保留/刪除之申請。
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Counter & Batch Action Bar */}
        <div className="bg-[#f5f5f0] border border-[#5A5A40]/15 p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <div>
              <span className="font-bold text-slate-900">
                目前審核佇列衝突數：
              </span>
              <span className="font-extrabold text-rose-700 ml-1 text-sm">
                {activeConflicts.length} 筆衝突待處理
              </span>
              <span className="text-slate-500 text-[11px] block sm:inline sm:ml-2">
                (已即時排除 {resolvedConflictIds.size} 筆)
              </span>
            </div>
          </div>

          {activeConflicts.length > 0 && (
            <button
              onClick={handleBatchResolveAll}
              className="bg-rose-700 hover:bg-rose-800 text-white font-extrabold py-2 px-4 rounded-xl text-xs shadow-xs transition flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <Sparkles className="w-4 h-4 text-amber-300 fill-amber-300" />
              <span>⚡ 一鍵採納 AI 建議（批量自動退回衝突申請）</span>
            </button>
          )}
        </div>

        {/* Conflicts List */}
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {activeConflicts.length === 0 ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-8 text-center space-y-3">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
              <h4 className="font-bold text-emerald-900 text-base">太棒了！無任何志工重複報名重疊時間班次</h4>
              <p className="text-xs text-emerald-700 max-w-md mx-auto">
                所有志工目前的審核中與已錄取班次時段均無衝突，全園區班表排程順暢！
              </p>
            </div>
          ) : (
            activeConflicts.map(conflict => {
              const zone1 = ZONE_CONFIGS[conflict.shift1.zone];
              const zone2 = ZONE_CONFIGS[conflict.shift2.zone];
              const branch1 = branches.find(b => b.id === conflict.shift1.branchId);
              const branch2 = branches.find(b => b.id === conflict.shift2.branchId);

              const isSuggestedDelete1 = conflict.suggestedDeleteAppId === conflict.app1.id;

              return (
                <div
                  key={conflict.id}
                  className="bg-white rounded-2xl border-2 border-rose-300 shadow-md p-5 space-y-4 relative overflow-hidden"
                >
                  {/* Top Conflict Info Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-rose-100 pb-3 gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-full bg-rose-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                        🚨
                      </span>
                      <div>
                        <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                          <span>志工：{conflict.volunteerName}</span>
                          <span className="text-[10px] bg-[#E6E2D3] text-[#5A5A40] px-2 py-0.5 rounded-full font-bold">
                            LINE: @{conflict.lineId}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          📞 {conflict.volunteerPhone} ｜ ✉️ {conflict.volunteerEmail}
                        </div>
                      </div>
                    </div>

                    <div className="bg-rose-100 text-rose-900 border border-rose-300 text-xs font-extrabold px-3 py-1 rounded-full flex items-center gap-1.5 self-start sm:self-auto">
                      <Clock className="w-3.5 h-3.5 text-rose-700" />
                      <span>{conflict.overlapDescription}</span>
                    </div>
                  </div>

                  {/* Side by Side Comparison of Conflicting Shifts */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    
                    {/* Shift 1 Card */}
                    <div className={`p-3.5 rounded-xl border ${
                      isSuggestedDelete1
                        ? 'bg-rose-50/70 border-rose-200'
                        : 'bg-emerald-50/70 border-emerald-300'
                    } space-y-2 relative`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${zone1?.badgeBg}`}>
                          {zone1?.icon} {zone1?.name}
                        </span>
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                          conflict.app1.status === 'approved' ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'
                        }`}>
                          {conflict.app1.status === 'approved' ? '已錄取' : '待審核'}
                        </span>
                      </div>

                      <h5 className="font-bold text-slate-900 text-xs">{conflict.shift1.title}</h5>
                      <div className="text-[11px] text-slate-600 space-y-0.5">
                        <div>📍 {branch1?.name}</div>
                        <div>📅 {conflict.shift1.date} ({conflict.shift1.timeRange})</div>
                        <div>👥 人力：{conflict.shift1.currentCount} / {conflict.shift1.requiredCount} 人</div>
                      </div>

                      {isSuggestedDelete1 && (
                        <div className="mt-2 text-[10px] font-extrabold text-rose-700 bg-rose-200/60 px-2 py-1 rounded-lg text-center">
                          ⚠️ 系統建議刪除 / 退回此申請
                        </div>
                      )}
                    </div>

                    {/* Shift 2 Card */}
                    <div className={`p-3.5 rounded-xl border ${
                      !isSuggestedDelete1
                        ? 'bg-rose-50/70 border-rose-200'
                        : 'bg-emerald-50/70 border-emerald-300'
                    } space-y-2 relative`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${zone2?.badgeBg}`}>
                          {zone2?.icon} {zone2?.name}
                        </span>
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                          conflict.app2.status === 'approved' ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'
                        }`}>
                          {conflict.app2.status === 'approved' ? '已錄取' : '待審核'}
                        </span>
                      </div>

                      <h5 className="font-bold text-slate-900 text-xs">{conflict.shift2.title}</h5>
                      <div className="text-[11px] text-slate-600 space-y-0.5">
                        <div>📍 {branch2?.name}</div>
                        <div>📅 {conflict.shift2.date} ({conflict.shift2.timeRange})</div>
                        <div>👥 人力：{conflict.shift2.currentCount} / {conflict.shift2.requiredCount} 人</div>
                      </div>

                      {!isSuggestedDelete1 && (
                        <div className="mt-2 text-[10px] font-extrabold text-rose-700 bg-rose-200/60 px-2 py-1 rounded-lg text-center">
                          ⚠️ 系統建議刪除 / 退回此申請
                        </div>
                      )}
                    </div>

                  </div>

                  {/* AI Recommendation Explanation Box */}
                  <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-xs text-amber-900 space-y-1">
                    <div className="font-bold flex items-center gap-1 text-amber-800">
                      <Sparkles className="w-3.5 h-3.5 text-amber-600 fill-amber-500" />
                      <span>AI 衝突調度分析建議：</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-amber-950">
                      {conflict.suggestedReason}
                    </p>
                  </div>

                  {/* Action Buttons */}
                  <div className="pt-1 flex flex-wrap items-center justify-end gap-2">
                    
                    {/* Primary Suggested Action Button */}
                    <button
                      onClick={() => handleResolveConflict(conflict, conflict.suggestedDeleteAppId, conflict.suggestedKeepAppId)}
                      className="bg-rose-700 hover:bg-rose-800 text-white font-extrabold py-2 px-4 rounded-xl text-xs shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-200" />
                      <span>
                        採納建議：自動退回【{isSuggestedDelete1 ? conflict.shift1.title : conflict.shift2.title}】
                      </span>
                    </button>

                    <button
                      onClick={() => handleResolveConflict(conflict, conflict.app1.id, conflict.app2.id)}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2 px-3 rounded-xl text-xs transition cursor-pointer border border-slate-200"
                    >
                      退回 班次 1 申請
                    </button>

                    <button
                      onClick={() => handleResolveConflict(conflict, conflict.app2.id, conflict.app1.id)}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2 px-3 rounded-xl text-xs transition cursor-pointer border border-slate-200"
                    >
                      退回 班次 2 申請
                    </button>

                  </div>

                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex justify-between items-center pt-4 border-t border-[#5A5A40]/10">
          <div className="text-xs text-slate-500 font-medium">
            💡 說明：退回申請時，系統會自動給志工發送 LINE 說明訊息並恢復班次名額。
          </div>

          <button
            onClick={onClose}
            className="bg-[#5A5A40] hover:bg-[#484833] text-white font-bold text-xs px-6 py-2.5 rounded-full shadow-xs transition cursor-pointer"
          >
            完成審核與衝突清查
          </button>
        </div>

      </div>
    </div>
  );
};
