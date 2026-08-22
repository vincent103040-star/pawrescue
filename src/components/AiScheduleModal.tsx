import React, { useState } from 'react';
import { PositionShift, VolunteerProfile } from '../types';
import { ZONE_CONFIGS } from '../data/mockData';
import { Sparkles, Users, Award, Clock, Send, CheckCircle2, Trophy, Star, Shield, Filter, ArrowRight, Zap, Check, MessageSquare, AlertCircle, X } from 'lucide-react';

interface AiScheduleModalProps {
  shift: PositionShift;
  volunteers: VolunteerProfile[];
  onClose: () => void;
  onSendLineToast: (msg: string) => void;
  onAssignVolunteer?: (shiftId: string, volunteer: VolunteerProfile) => void;
}

export const AiScheduleModal: React.FC<AiScheduleModalProps> = ({
  shift,
  volunteers,
  onClose,
  onSendLineToast,
  onAssignVolunteer
}) => {
  const [invitedVolIds, setInvitedVolIds] = useState<string[]>([]);
  const [assignedVolIds, setAssignedVolIds] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'ai_score' | 'hours_desc' | 'shifts_desc'>('ai_score');

  const zoneConf = ZONE_CONFIGS[shift.zone];

  // AI Matching Algorithm calculating match score for each volunteer
  const rankedVolunteers = volunteers.map(vol => {
    let score = 50; // base score

    // 1. Total Hours score (max +25 points)
    const hoursBonus = Math.min(25, Math.round((vol.totalHours / 100) * 25));
    score += hoursBonus;

    // 2. Completed Shifts Count score (max +20 points)
    const shiftsBonus = Math.min(20, Math.round((vol.completedShiftsCount / 30) * 20));
    score += shiftsBonus;

    // 3. Zone Preference bonus (+15 points if preferred zone matches shift zone)
    const isPreferredZone = vol.preferredZones.includes(shift.zone);
    if (isPreferredZone) {
      score += 15;
    }

    // 4. Tier bonus
    if (vol.tier === '志工隊長') score += 10;
    else if (vol.tier === '資深志工') score += 5;

    // 5. Skill keyword match (+10 points if any skill matches shift title/tasks)
    const shiftTaskText = (shift.title + ' ' + shift.tasks.join(' ')).toLowerCase();
    const hasMatchingSkill = vol.skills.some(skill => 
      shiftTaskText.includes(skill.toLowerCase()) || 
      (shift.zone === 'dog' && (skill.includes('犬') || skill.includes('狗'))) ||
      (shift.zone === 'cat' && skill.includes('貓')) ||
      (shift.zone === 'medical' && (skill.includes('獸醫') || skill.includes('給藥') || skill.includes('消毒')))
    );
    if (hasMatchingSkill) score += 10;

    // Cap at 99% max score
    const finalScore = Math.min(99, Math.max(65, score));

    // Generate AI recommendation reason
    let aiReason = '';
    if (finalScore >= 90) {
      aiReason = `⭐ 累積服務時數達 ${vol.totalHours} 小時（已完成 ${vol.completedShiftsCount} 班次），具備高階領域經驗，過往到勤紀錄優良，與【${zoneConf?.name || '本場域'}】需求高度匹配！`;
    } else if (finalScore >= 80) {
      aiReason = `🎯 已累積 ${vol.totalHours} 小時（${vol.completedShiftsCount} 班次），包含【${vol.skills[0] || '專業技能'}】，極適合參與排班協同支援。`;
    } else {
      aiReason = `👍 累積 ${vol.totalHours} 小時與 ${vol.completedShiftsCount} 次服務經驗，適合做為增援與培訓幹部。`;
    }

    return {
      volunteer: vol,
      score: finalScore,
      aiReason,
      isPreferredZone,
      hasMatchingSkill
    };
  });

  // Sort candidates based on user selection
  const sortedCandidates = [...rankedVolunteers].sort((a, b) => {
    if (sortBy === 'ai_score') return b.score - a.score;
    if (sortBy === 'hours_desc') return b.volunteer.totalHours - a.volunteer.totalHours;
    if (sortBy === 'shifts_desc') return b.volunteer.completedShiftsCount - a.volunteer.completedShiftsCount;
    return 0;
  });

  // Handle single LINE invitation
  const handleSendLineInvite = (vol: VolunteerProfile) => {
    if (invitedVolIds.includes(vol.id)) return;
    setInvitedVolIds(prev => [...prev, vol.id]);
    onSendLineToast(`📲【LINE 邀約已送出】成功對志工【${vol.name}】（累積 ${vol.totalHours} 小時）發送【${shift.title}】的智慧排班邀請訊息！`);
  };

  // Handle one-click invite ALL top candidates
  const handleSendAllLineInvites = () => {
    const topCandidates = sortedCandidates.slice(0, Math.max(1, shift.requiredCount - shift.currentCount));
    const newInvited = topCandidates.map(c => c.volunteer.id);
    setInvitedVolIds(prev => Array.from(newSet(prev, newInvited)));
    onSendLineToast(`🚀【AI 批量推播成功】已透過 LINE 官方帳號對前 ${topCandidates.length} 位推薦志工批次發送排班邀請！`);
  };

  // Helper set merger
  function newSet(arr1: string[], arr2: string[]) {
    return Array.from(new Set([...arr1, ...arr2]));
  }

  // Handle assign volunteer to shift
  const handleAssignVolunteer = (vol: VolunteerProfile) => {
    if (assignedVolIds.includes(vol.id)) return;
    setAssignedVolIds(prev => [...prev, vol.id]);
    if (onAssignVolunteer) {
      onAssignVolunteer(shift.id, vol);
    }
    onSendLineToast(`✅【排班成功】志工【${vol.name}】已成功排入【${shift.title}】班次（名額更新）。`);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#5A5A40]/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-[32px] max-w-3xl w-full shadow-2xl p-6 sm:p-8 border border-[#5A5A40]/20 my-8 space-y-6 text-slate-800 font-sans">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#5A5A40]/10 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#5A5A40] text-[#E6E2D3] flex items-center justify-center shadow-xs shrink-0">
              <Sparkles className="w-6 h-6 text-amber-300 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-bold font-serif italic text-[#5A5A40]">AI 自動排班建議與推薦</h3>
                <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <Zap className="w-3 h-3 text-amber-600 fill-amber-500" />
                  累積時數與完成班次算力匹配
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                根據志工全勤率、累積服務時數、完成班次量及場域技能專長，智慧計算契合度評分。
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

        {/* Selected Shift Target Card */}
        <div className="bg-[#f5f5f0] border border-[#5A5A40]/15 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${zoneConf?.badgeBg}`}>
                {zoneConf?.icon} {zoneConf?.name}
              </span>
              <span className="text-xs font-bold text-slate-700">{shift.locationDetails}</span>
            </div>
            <h4 className="font-bold text-slate-900 text-base">{shift.title}</h4>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
              <span>📅 日期：{shift.date}</span>
              <span>⏰ 時段：{shift.timeRange}</span>
              <span>🎓 門檻：{shift.skillRequired === 'beginner' ? '新手皆可' : shift.skillRequired === 'intermediate' ? '中級經驗' : '資深/專業'}</span>
            </div>
          </div>

          <div className="bg-white rounded-xl p-3 border border-[#5A5A40]/10 text-center shrink-0 min-w-[140px]">
            <span className="text-[11px] font-semibold text-slate-500 block">目前缺額</span>
            <div className="text-lg font-extrabold text-[#5A5A40]">
              {shift.requiredCount - shift.currentCount} <span className="text-xs font-normal text-slate-600">/ {shift.requiredCount} 人</span>
            </div>
            <span className="text-[10px] text-emerald-700 bg-emerald-50 font-bold px-2 py-0.5 rounded-full border border-emerald-200">
              {shift.currentCount >= shift.requiredCount ? '已滿班' : '開放邀約中'}
            </span>
          </div>
        </div>

        {/* Filter and Sorting Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#5A5A40]/10 pb-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-700 flex items-center gap-1">
              <Filter className="w-3.5 h-3.5 text-[#5A5A40]" />
              推薦排序依據：
            </span>
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
              <button
                onClick={() => setSortBy('ai_score')}
                className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                  sortBy === 'ai_score' ? 'bg-white text-[#5A5A40] shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                🧠 AI 契合度綜合權重
              </button>
              <button
                onClick={() => setSortBy('hours_desc')}
                className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                  sortBy === 'hours_desc' ? 'bg-white text-[#5A5A40] shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ⏱️ 累積服務時數最高
              </button>
              <button
                onClick={() => setSortBy('shifts_desc')}
                className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                  sortBy === 'shifts_desc' ? 'bg-white text-[#5A5A40] shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                📋 完成班次數量最多
              </button>
            </div>
          </div>

          {/* Batch Invite Button */}
          <button
            onClick={handleSendAllLineInvites}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3.5 py-2 rounded-xl text-xs transition shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span>一鍵批次發送 LINE 邀約推播</span>
          </button>
        </div>

        {/* Ranked Candidate List */}
        <div className="space-y-4 max-h-[440px] overflow-y-auto pr-1">
          {sortedCandidates.map((item, idx) => {
            const vol = item.volunteer;
            const isInvited = invitedVolIds.includes(vol.id);
            const isAssigned = assignedVolIds.includes(vol.id);

            return (
              <div
                key={vol.id}
                className="bg-white rounded-2xl border border-[#5A5A40]/15 p-4 shadow-xs hover:border-[#5A5A40]/30 transition space-y-3 relative"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  
                  {/* Left: Volunteer Info & Ranking */}
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <img
                        src={vol.avatar}
                        alt={vol.name}
                        className="w-12 h-12 rounded-2xl object-cover border-2 border-[#5A5A40]/20 shadow-xs"
                      />
                      <span className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full text-[10px] font-extrabold text-white flex items-center justify-center shadow-xs ${
                        idx === 0 ? 'bg-amber-500' : idx === 1 ? 'bg-slate-400' : idx === 2 ? 'bg-amber-700' : 'bg-[#5A5A40]'
                      }`}>
                        #{idx + 1}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-base">{vol.name}</span>
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                          vol.tier === '志工隊長'
                            ? 'bg-amber-100 text-amber-900 border border-amber-300'
                            : vol.tier === '資深志工'
                            ? 'bg-[#E6E2D3] text-[#5A5A40]'
                            : 'bg-slate-100 text-slate-700'
                        }`}>
                          {vol.tier}
                        </span>
                      </div>

                      {/* Key Stats Pill: Hours & Completed Shifts */}
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="bg-[#f5f5f0] border border-[#5A5A40]/15 px-2.5 py-0.5 rounded-full text-[#5A5A40] font-bold flex items-center gap-1">
                          <Clock className="w-3 h-3 text-[#5A5A40]" />
                          累積時數：<strong className="text-slate-900">{vol.totalHours}</strong> 小時
                        </span>

                        <span className="bg-[#f5f5f0] border border-[#5A5A40]/15 px-2.5 py-0.5 rounded-full text-[#5A5A40] font-bold flex items-center gap-1">
                          <Award className="w-3 h-3 text-[#5A5A40]" />
                          完成班次：<strong className="text-slate-900">{vol.completedShiftsCount}</strong> 班
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: AI Score Meter */}
                  <div className="flex items-center gap-3 self-start sm:self-center">
                    <div className="text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <Sparkles className="w-4 h-4 text-amber-500 fill-amber-400" />
                        <span className="text-lg font-black text-slate-900">{item.score}%</span>
                      </div>
                      <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        {item.score >= 90 ? '🔥 超高契合度' : item.score >= 80 ? '⭐ 強力推薦' : '👍 適合支援'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* AI Reason Box */}
                <div className="bg-[#fdfdfb] p-3 rounded-xl border border-[#5A5A40]/10 text-xs text-slate-700 space-y-1">
                  <p className="leading-relaxed">{item.aiReason}</p>
                  
                  {/* Skills tags */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] text-slate-400 font-medium">具備專長：</span>
                    {vol.skills.map((sk, sIdx) => (
                      <span
                        key={sIdx}
                        className="bg-white border border-[#5A5A40]/15 text-[#5A5A40] font-semibold text-[10px] px-2 py-0.5 rounded-md"
                      >
                        {sk}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Actions: Send LINE Invite & Assign */}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    onClick={() => handleSendLineInvite(vol)}
                    disabled={isInvited}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      isInvited
                        ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-default'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs'
                    }`}
                  >
                    {isInvited ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>已送出 LINE 邀約</span>
                      </>
                    ) : (
                      <>
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>📲 LINE 發送邀約</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => handleAssignVolunteer(vol)}
                    disabled={isAssigned}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                      isAssigned
                        ? 'bg-amber-100 text-amber-800 border border-amber-300 cursor-default'
                        : 'bg-[#5A5A40] hover:bg-[#484833] text-white shadow-2xs'
                    }`}
                  >
                    {isAssigned ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-amber-700" />
                        <span>已排入班次</span>
                      </>
                    ) : (
                      <>
                        <Users className="w-3.5 h-3.5 text-[#E6E2D3]" />
                        <span>✅ 直接排入此班次</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-3 border-t border-[#5A5A40]/10">
          <button
            onClick={onClose}
            className="bg-[#5A5A40] hover:bg-[#484833] text-white font-bold text-xs px-6 py-2.5 rounded-full shadow-xs transition cursor-pointer"
          >
            完成排班建議檢視
          </button>
        </div>

      </div>
    </div>
  );
};
