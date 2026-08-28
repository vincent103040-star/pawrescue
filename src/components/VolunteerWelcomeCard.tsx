import React from 'react';
import { VolunteerUserSession, AttendanceRecord } from '../types';
import { 
  Heart, 
  Clock, 
  Award, 
  TrendingUp, 
  CheckCircle2, 
  Sparkles, 
  QrCode, 
  ChevronRight, 
  Star, 
  Crown, 
  ShieldCheck,
  Target,
  ArrowRight
} from 'lucide-react';

interface VolunteerWelcomeCardProps {
  currentUser: VolunteerUserSession | null;
  attendanceRecords?: AttendanceRecord[];
  onOpenCheckInModal?: () => void;
  onNavigateTab?: (tab: 'shifts' | 'myshifts' | 'growth' | 'settings' | 'sop') => void;
}

export interface TierConfig {
  id: string;
  name: string;
  emoji: string;
  minHours: number;
  badgeClass: string;
  perks: string;
}

export const TIERS: TierConfig[] = [
  {
    id: 'intern',
    name: '實習志工',
    emoji: '🐣',
    minHours: 0,
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300',
    perks: '通曉入館安全宣導、貓房清潔與物資整理'
  },
  {
    id: 'official',
    name: '正式志工',
    emoji: '🌿',
    minHours: 10,
    badgeClass: 'bg-sky-50 text-sky-800 border-sky-300',
    perks: '親人犬貓互動撫摸、幼犬餵食、洗澡清潔'
  },
  {
    id: 'senior',
    name: '資深志工',
    emoji: '🌟',
    minHours: 40,
    badgeClass: 'bg-amber-50 text-amber-900 border-amber-300',
    perks: '大狗牽繩放風、醫療投藥支援、行為社會化訓練'
  },
  {
    id: 'leader',
    name: '志工隊長',
    emoji: '👑',
    minHours: 80,
    badgeClass: 'bg-purple-50 text-purple-900 border-purple-300',
    perks: '帶領新進志工、現場活動督導、志工培訓考核'
  }
];

export const VolunteerWelcomeCard: React.FC<VolunteerWelcomeCardProps> = ({
  currentUser,
  attendanceRecords = [],
  onOpenCheckInModal,
  onNavigateTab
}) => {
  const volunteerName = currentUser?.name || localStorage.getItem('volunteer_profile_name') || '志工夥伴';
  
  // Calculate completed attendance hours
  const myCompletedAttendance = attendanceRecords.filter(r => 
    (r.volunteerName === volunteerName || 
     (currentUser?.phone && r.volunteerPhone === currentUser.phone) ||
     (currentUser?.lineId && r.lineId === currentUser.lineId)) && 
    r.status === 'completed'
  );
  
  const additionalHours = myCompletedAttendance.reduce((sum, r) => sum + (r.hoursLogged || 3), 0);
  const baseHours = currentUser?.totalHours || 24;
  const currentHours = baseHours + additionalHours;

  // Determine current tier & next tier
  let currentTierIndex = 0;
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (currentHours >= TIERS[i].minHours) {
      currentTierIndex = i;
      break;
    }
  }

  const currentTier = TIERS[currentTierIndex];
  const isMaxTier = currentTierIndex >= TIERS.length - 1;
  const nextTier = !isMaxTier ? TIERS[currentTierIndex + 1] : null;

  const currentTierMin = currentTier.minHours;
  const nextTierMin = nextTier ? nextTier.minHours : 80;
  
  const hoursNeeded = nextTier ? Math.max(0, nextTier.minHours - currentHours) : 0;
  
  // Progress in current step
  const stepSpan = nextTier ? (nextTier.minHours - currentTierMin) : 40;
  const stepProgress = nextTier ? Math.min(100, Math.max(0, Math.round(((currentHours - currentTierMin) / stepSpan) * 100))) : 100;
  
  // Total overall progress toward 80h (志工隊長)
  const overallProgress = Math.min(100, Math.round((currentHours / 80) * 100));

  return (
    <div className="bg-[#716053] rounded-[32px] p-6 sm:p-8 md:p-10 text-white shadow-lg relative overflow-hidden font-sans border border-[#716053]">
      {/* Subtle Background Decorative Circles */}
      <div className="absolute -right-16 -top-16 w-80 h-80 rounded-full bg-white/5 pointer-events-none blur-2xl" />
      <div className="absolute -left-16 -bottom-16 w-72 h-72 rounded-full bg-amber-400/10 pointer-events-none blur-2xl" />
      
      <div className="relative z-10 space-y-6">
        
        {/* Top Header Row */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2.5 max-w-2xl">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-md px-3.5 py-1 rounded-full text-xs font-bold text-[#F5E6D0] border border-white/10">
                <Heart className="w-3.5 h-3.5 text-amber-300 fill-amber-300 animate-pulse" />
                <span>浪浪家園 志工個人服務專區</span>
              </span>

              <span className="inline-flex items-center gap-1.5 bg-amber-400/20 text-amber-200 border border-amber-300/30 px-3 py-1 rounded-full text-xs font-bold">
                <Star className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
                <span>目前位階：{currentTier.emoji} {currentTier.name}</span>
              </span>

              {/* Google & Phone Dual-Verified Badge */}
              <span className="inline-flex items-center gap-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-3 py-1 rounded-full text-xs font-bold">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Google & 手機雙重認證已啟用</span>
              </span>
            </div>

            <h2 className="text-2xl sm:text-3xl md:text-4xl font-serif italic tracking-tight text-white font-bold leading-tight">
              歡迎回來，{volunteerName} 志工夥伴！🐾
            </h2>

            <p className="text-[#F5E6D0] text-xs sm:text-sm leading-relaxed font-sans">
              感謝您用愛心與耐心守護園區毛孩。您已累積服務 <strong className="text-white font-bold underline decoration-amber-400 decoration-2">{currentHours} 小時</strong>，每一分秒的陪伴都是浪浪重獲幸福家庭的溫暖力量。
            </p>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 shrink-0">
            {onOpenCheckInModal && (
              <button
                type="button"
                onClick={onOpenCheckInModal}
                className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-extrabold px-5 py-2.5 rounded-full text-xs shadow-md transition flex items-center gap-2 cursor-pointer transform hover:scale-105 active:scale-95"
              >
                <QrCode className="w-4 h-4 text-slate-950" />
                <span>📱 現場掃碼簽到 / 簽退</span>
              </button>
            )}

            {onNavigateTab && (
              <button
                type="button"
                onClick={() => onNavigateTab('growth')}
                className="bg-white/15 hover:bg-white/25 text-white border border-white/20 font-bold px-4 py-2.5 rounded-full text-xs transition flex items-center gap-1.5 cursor-pointer"
              >
                <TrendingUp className="w-4 h-4 text-amber-300" />
                <span>晉升考核清單</span>
              </button>
            )}
          </div>
        </div>

        {/* Dynamic Hours Progress & Next Milestone Card */}
        <div className="bg-black/20 backdrop-blur-md rounded-2xl p-5 sm:p-6 border border-white/15 space-y-4">
          
          {/* Progress Header & Target Metric */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-400/20 border border-amber-300/30 flex items-center justify-center shrink-0">
                <Target className="w-5 h-5 text-amber-300" />
              </div>
              <div>
                <div className="text-xs text-[#F5E6D0] font-medium flex items-center gap-2">
                  <span>累積服務時數進度：</span>
                  <span className="text-white font-extrabold text-sm">{currentHours} 小時</span>
                </div>
                <div className="text-xs font-bold text-amber-200 mt-0.5">
                  {nextTier ? (
                    <span>
                      🎯 下一目標：<strong className="text-white">{nextTier.emoji} {nextTier.name}</strong> (需累計滿 {nextTier.minHours} 小時)
                    </span>
                  ) : (
                    <span className="text-emerald-300">
                      👑 恭喜已達最高等級【志工隊長】！
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Distance to Next Goal Badge */}
            <div className="flex items-center gap-2 self-start sm:self-auto">
              {nextTier ? (
                <div className="bg-amber-400 text-slate-950 font-extrabold px-3.5 py-1.5 rounded-xl text-xs flex items-center gap-1.5 shadow-xs">
                  <Sparkles className="w-3.5 h-3.5 text-slate-950 fill-slate-950" />
                  <span>距離晉升還差：<strong className="text-slate-950 font-black">{hoursNeeded} 小時</strong></span>
                </div>
              ) : (
                <div className="bg-emerald-400 text-slate-950 font-extrabold px-3.5 py-1.5 rounded-xl text-xs flex items-center gap-1.5">
                  <Crown className="w-3.5 h-3.5 text-slate-950 fill-slate-950" />
                  <span>已達成榮譽殿堂</span>
                </div>
              )}
            </div>
          </div>

          {/* Animated Progress Bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] text-[#F5E6D0] font-medium">
              <span>{currentTier.emoji} {currentTier.name} ({currentTierMin}h)</span>
              <span>
                {nextTier ? `晉升達成率 ${stepProgress}% (總里程 ${overallProgress}%)` : '100% 達成'}
              </span>
              {nextTier && <span>{nextTier.emoji} {nextTier.name} ({nextTierMin}h)</span>}
            </div>

            <div className="w-full bg-black/40 h-4 rounded-full overflow-hidden p-0.5 border border-white/20 relative shadow-inner">
              <div 
                className="bg-gradient-to-r from-amber-300 via-amber-400 to-emerald-400 h-full rounded-full transition-all duration-700 shadow-sm relative"
                style={{ width: `${Math.max(6, overallProgress)}%` }}
              >
                <div className="absolute inset-0 bg-white/20 animate-pulse rounded-full" />
              </div>
            </div>
          </div>

          {/* Tier Milestones Roadmap Track */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 pt-2">
            {TIERS.map((tier, idx) => {
              const isPassed = currentHours >= tier.minHours;
              const isCurrent = currentTier.id === tier.id;
              const isNext = nextTier?.id === tier.id;

              return (
                <div 
                  key={tier.id}
                  className={`p-2.5 rounded-xl border transition-all ${
                    isCurrent 
                      ? 'bg-amber-400/25 border-amber-300 text-white shadow-xs' 
                      : isPassed
                        ? 'bg-white/10 border-white/20 text-[#F5E6D0]'
                        : isNext
                          ? 'bg-white/5 border-amber-400/40 text-amber-200/90'
                          : 'bg-black/20 border-white/10 text-white/50 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">{tier.emoji}</span>
                      <span className="font-bold text-xs">{tier.name}</span>
                    </div>

                    {isPassed ? (
                      <span className="bg-emerald-400/30 text-emerald-200 text-[10px] font-extrabold px-1.5 py-0.5 rounded-md flex items-center gap-0.5">
                        <CheckCircle2 className="w-3 h-3 text-emerald-300" />
                        <span>已達成</span>
                      </span>
                    ) : isNext ? (
                      <span className="bg-amber-400 text-slate-950 text-[10px] font-black px-1.5 py-0.5 rounded-md">
                        下一目標
                      </span>
                    ) : (
                      <span className="text-[10px] text-white/60">
                        {tier.minHours}h
                      </span>
                    )}
                  </div>

                  <p className="text-[10px] text-[#F5E6D0]/80 mt-1 line-clamp-1">
                    {tier.perks}
                  </p>
                </div>
              );
            })}
          </div>

        </div>

      </div>
    </div>
  );
};
