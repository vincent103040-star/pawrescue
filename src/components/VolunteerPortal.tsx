import React, { useState, useMemo } from 'react';
import { PositionShift, Branch, BranchId, SkillLevel, ZoneCategory, LineNotificationPreferences, VolunteerUserSession, AttendanceRecord, VolunteerApplication } from '../types';
import { ZONE_CONFIGS } from '../data/mockData';
import { VolunteerWelcomeCard } from './VolunteerWelcomeCard';
import { ShiftCalendarView } from './ShiftCalendarView';
import { Heart, MapPin, Calendar, Clock, Check, Users, ExternalLink, Sparkles, AlertCircle, ArrowUpRight, CheckCircle2, QrCode, Settings, Bell, BellRing, User, Save, Send, Smartphone, ShieldCheck, ToggleLeft, ToggleRight, Sparkle, TrendingUp, Award, CheckSquare, Square, Crown, Medal, Star, Trophy, BookOpen, Zap, ChevronRight, LayoutGrid, MessageSquare } from 'lucide-react';
import { buildGoogleCalendarLink } from '../utils/googleCalendar';
import { buildLineLoginUrl } from '../utils/lineLogin';

export interface GrowthChecklistItem {
  id: string;
  title: string;
  category: '講習課程' | '服務時數' | '出勤紀律' | '技能檢定' | '專業認證';
  description: string;
  completed: boolean;
  requiredForTier: '正式志工' | '資深志工' | '志工隊長';
}

const INITIAL_GROWTH_ITEMS: GrowthChecklistItem[] = [
  {
    id: 'item_1',
    title: '【講習課程】完成基礎浪浪安全防護與衛教課程 (2小時)',
    category: '講習課程',
    description: '完成線上講習課程與實體園區安全防護簡報考核。',
    completed: true,
    requiredForTier: '正式志工'
  },
  {
    id: 'item_2',
    title: '【服務時數】實習階段服務累計滿 10 小時 (目前 24 小時)',
    category: '服務時數',
    description: '參與至少 3 次園區照護班次，累計簽到服務滿 10 小時。',
    completed: true,
    requiredForTier: '正式志工'
  },
  {
    id: 'item_3',
    title: '【出勤紀律】班次簽到率維持 90% 以上 (目前 96%)',
    category: '出勤紀律',
    description: '近半年無無故缺席紀錄，皆準時簽到簽退。',
    completed: true,
    requiredForTier: '資深志工'
  },
  {
    id: 'item_4',
    title: '【技能檢定】大狗牽繩放風與性格安撫實作考核',
    category: '技能檢定',
    description: '經資深志工隊長評定，能獨立掌握大型犬牽引散步與防爆衝操作。',
    completed: false,
    requiredForTier: '資深志工'
  },
  {
    id: 'item_5',
    title: '【專業認證】貓舍環境清消與幼犬照護急救 SOP 檢定',
    category: '專業認證',
    description: '通曉 M 棟醫療區環境消毒規範與幼犬泡奶保暖衛教步驟。',
    completed: false,
    requiredForTier: '資深志工'
  }
];

interface VolunteerPortalProps {
  shifts: PositionShift[];
  branches: Branch[];
  selectedBranch: BranchId | 'all';
  onApplySubmit: (
    shiftId: string,
    name: string,
    email: string,
    phone: string,
    lineId: string,
    notes: string,
    situational?: {
      question: string;
      answer: string;
      assessment?: { score: number; feedback: string; flags: string[]; isFallback?: boolean };
    }
  ) => void;
  onSendLineToast: (msg: string) => void;
  onOpenCheckInModal?: () => void;
  activeSection?: 'shifts' | 'growth' | 'settings';
  currentUser?: VolunteerUserSession | null;
  attendanceRecords?: AttendanceRecord[];
  applications?: VolunteerApplication[];
  onNavigateToTab?: (tab: 'shifts' | 'myshifts' | 'growth' | 'settings' | 'sop') => void;
  onCancelApplication?: (appId: string) => void;
  onUpdateProfile?: (updates: Partial<VolunteerUserSession>) => void;
}

export const VolunteerPortal: React.FC<VolunteerPortalProps> = ({
  shifts,
  branches,
  selectedBranch,
  onApplySubmit,
  onSendLineToast,
  onOpenCheckInModal,
  activeSection = 'shifts',
  currentUser,
  attendanceRecords = [],
  applications = [],
  onNavigateToTab,
  onCancelApplication,
  onUpdateProfile
}) => {
  const [activePortalTab, setActivePortalTab] = useState<'shifts' | 'growth' | 'settings'>(activeSection);
  const [viewMode, setViewMode] = useState<'calendar' | 'grid'>('calendar');

  // Synchronize when activeSection prop changes
  React.useEffect(() => {
    if (activeSection) {
      setActivePortalTab(activeSection);
    }
  }, [activeSection]);

  const [activeShiftForApply, setActiveShiftForApply] = useState<PositionShift | null>(null);
  const [selectedZoneFilter, setSelectedZoneFilter] = useState<string>('all');

  // Compute shift IDs that current volunteer has applied for
  const myAppliedShiftIds = useMemo(() => {
    const vName = currentUser?.name || localStorage.getItem('volunteer_profile_name') || '林小明';
    const vEmail = currentUser?.email || localStorage.getItem('volunteer_profile_email') || 'xiaoming@gmail.com';
    const vPhone = currentUser?.phone || localStorage.getItem('volunteer_profile_phone') || '0912-345-678';
    const vLineId = currentUser?.lineId || localStorage.getItem('volunteer_profile_lineid') || 'xiaoming_line';

    return applications
      .filter(a => 
        a.status !== 'rejected' && (
          (a.volunteerName && a.volunteerName.trim() === vName.trim()) ||
          (a.volunteerEmail && a.volunteerEmail.toLowerCase() === vEmail.toLowerCase()) ||
          (a.volunteerPhone && a.volunteerPhone === vPhone) ||
          (a.lineId && a.lineId === vLineId)
        )
      )
      .map(a => a.shiftId);
  }, [applications, currentUser]);


  // LINE Notification Preferences State
  const [linePreferences, setLinePreferences] = useState<LineNotificationPreferences>(() => {
    const saved = localStorage.getItem('volunteer_line_preferences');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // fallback
      }
    }
    return {
      shiftChanges: true,      // 班次異動
      urgentRecruitment: true, // 緊急招募
      checkInReminder: true,   // 簽到提醒
      reminderTimingHours: 1
    };
  });

  // Profile Form states
  const [profileName, setProfileName] = useState(() => localStorage.getItem('volunteer_profile_name') || '林小明');
  const [profilePhone, setProfilePhone] = useState(() => localStorage.getItem('volunteer_profile_phone') || '0912-345-678');
  const [profileEmail, setProfileEmail] = useState(() => localStorage.getItem('volunteer_profile_email') || 'xiaoming@gmail.com');
  const [profileLineId, setProfileLineId] = useState(() => localStorage.getItem('volunteer_profile_lineid') || 'xiaoming_line');
  const [isSavedSuccess, setIsSavedSuccess] = useState(false);

  // Real LINE Login link status
  const [lineLinkStatus, setLineLinkStatus] = useState<{ linked: boolean; displayName: string | null } | null>(null);

  const refreshLineLinkStatus = React.useCallback(() => {
    if (!profileEmail) return;
    fetch(`/api/volunteers/line-status?email=${encodeURIComponent(profileEmail)}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setLineLinkStatus({ linked: data.linked, displayName: data.lineDisplayName });
        }
      })
      .catch(() => { /* ignore */ });
  }, [profileEmail]);

  React.useEffect(() => {
    refreshLineLinkStatus();
  }, [refreshLineLinkStatus]);

  // Handle the redirect back from LINE Login (?lineLinked=1|0)
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('lineLinked')) {
      if (params.get('lineLinked') === '1') {
        const lineName = params.get('lineName') || '';
        onSendLineToast(`✅ LINE 帳號連結成功！${lineName ? `(LINE 顯示名稱：${lineName})` : ''}`);
        refreshLineLinkStatus();
      } else {
        onSendLineToast(`⚠️ LINE 帳號連結失敗，請重試 (${params.get('error') || 'unknown'})`);
      }
      params.delete('lineLinked');
      params.delete('lineName');
      params.delete('error');
      const newSearch = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (newSearch ? `?${newSearch}` : ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Volunteer Growth Pathway State
  const [growthItems, setGrowthItems] = useState<GrowthChecklistItem[]>(() => {
    const saved = localStorage.getItem('volunteer_growth_items');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // fallback
      }
    }
    return INITIAL_GROWTH_ITEMS;
  });

  const [hasAutoNotifiedAdmin, setHasAutoNotifiedAdmin] = useState<boolean>(() => {
    return localStorage.getItem('volunteer_growth_notified') === 'true';
  });

  const completedGrowthCount = growthItems.filter(i => i.completed).length;
  const totalGrowthCount = growthItems.length;
  const growthProgressPercent = Math.round((completedGrowthCount / totalGrowthCount) * 100);
  const isGrowthThresholdReached = completedGrowthCount === totalGrowthCount;

  const handleToggleGrowthItem = (itemId: string) => {
    setGrowthItems(prev => {
      const updated = prev.map(item => item.id === itemId ? { ...item, completed: !item.completed } : item);
      localStorage.setItem('volunteer_growth_items', JSON.stringify(updated));

      const comp = updated.filter(i => i.completed).length;
      if (comp === updated.length && !hasAutoNotifiedAdmin) {
        setHasAutoNotifiedAdmin(true);
        localStorage.setItem('volunteer_growth_notified', 'true');
        onSendLineToast(
          `🚨 [系統自動通知管理員] 志工【${profileName}】已達標【資深志工】升級門檻（5/5 項考核全數完成 100%）！已自動通報管理員後台核發晉升認證。`
        );
      }
      return updated;
    });
  };

  const handleSimulateAllCompleted = () => {
    const allCompleted = growthItems.map(item => ({ ...item, completed: true }));
    setGrowthItems(allCompleted);
    localStorage.setItem('volunteer_growth_items', JSON.stringify(allCompleted));
    setHasAutoNotifiedAdmin(true);
    localStorage.setItem('volunteer_growth_notified', 'true');

    onSendLineToast(
      `🎉 [全數考核達成] 志工【${profileName}】已完成 100% 資深志工考核！已自動推播 LINE 通知與社工管理員後台，等待核發【資深志工】徽章！`
    );
  };

  const handleManualNotifyAdmin = () => {
    setHasAutoNotifiedAdmin(true);
    localStorage.setItem('volunteer_growth_notified', 'true');
    onSendLineToast(
      `🚨 [手動通知管理員] 志工【${profileName}】向管理員送出【資深志工】晉升審核！目前完成率：${growthProgressPercent}% (${completedGrowthCount}/${totalGrowthCount}項)。`
    );
  };

  // Apply Form states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [lineId, setLineId] = useState('');
  const [notes, setNotes] = useState('');
  const [submittedSuccess, setSubmittedSuccess] = useState(false);

  // AI situational readiness quiz states
  const [situationalQuestion, setSituationalQuestion] = useState('');
  const [isLoadingQuestion, setIsLoadingQuestion] = useState(false);
  const [situationalAnswer, setSituationalAnswer] = useState('');
  const [aiAssessment, setAiAssessment] = useState<{ score: number; feedback: string; flags: string[]; isFallback?: boolean } | null>(null);
  const [isAssessing, setIsAssessing] = useState(false);

  const tierToExperienceLevel = (tier?: string): SkillLevel => {
    if (tier === '資深志工' || tier === '志工隊長') return 'experienced';
    if (tier === '正式志工') return 'intermediate';
    return 'beginner';
  };

  const handleGenerateSituationalQuestion = async (shift: PositionShift) => {
    setIsLoadingQuestion(true);
    setSituationalQuestion('');
    setSituationalAnswer('');
    setAiAssessment(null);
    try {
      const res = await fetch('/api/ai/generate-situational-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone: shift.zone, experienceLevel: tierToExperienceLevel(currentUser?.tier) })
      });
      const data = await res.json();
      setSituationalQuestion(data.question || '');
    } catch (err) {
      console.warn('Situational question fetch failed', err);
      setSituationalQuestion('');
    } finally {
      setIsLoadingQuestion(false);
    }
  };

  const handleAssessSituationalAnswer = async (shift: PositionShift) => {
    if (!situationalAnswer.trim()) return;
    setIsAssessing(true);
    try {
      const res = await fetch('/api/ai/assess-situational-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zone: shift.zone,
          question: situationalQuestion,
          answer: situationalAnswer,
          experienceLevel: tierToExperienceLevel(currentUser?.tier)
        })
      });
      const data = await res.json();
      setAiAssessment({ score: data.score, feedback: data.feedback, flags: data.flags || [], isFallback: data.isFallback });
    } catch (err) {
      console.warn('Situational answer assessment failed', err);
    } finally {
      setIsAssessing(false);
    }
  };

  const filteredShifts = shifts.filter(s => {
    if (selectedBranch !== 'all' && s.branchId !== selectedBranch) return false;
    if (selectedZoneFilter !== 'all' && s.zone !== selectedZoneFilter) return false;
    return true;
  });

  // Open apply modal prefilled with profile info
  const handleOpenApply = (shift: PositionShift) => {
    setActiveShiftForApply(shift);
    setName(profileName);
    setEmail(profileEmail);
    setPhone(profilePhone);
    setLineId(profileLineId);
    handleGenerateSituationalQuestion(shift);
  };

  const handleConfirmApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShiftForApply) return;

    onApplySubmit(
      activeShiftForApply.id, name, email, phone, lineId, notes,
      situationalQuestion
        ? { question: situationalQuestion, answer: situationalAnswer, assessment: aiAssessment || undefined }
        : undefined
    );
    setSubmittedSuccess(true);

    setTimeout(() => {
      setSubmittedSuccess(false);
      setActiveShiftForApply(null);
      setName('');
      setEmail('');
      setPhone('');
      setLineId('');
      setNotes('');
      setSituationalQuestion('');
      setSituationalAnswer('');
      setAiAssessment(null);
    }, 2000);
  };

  const handleTogglePreference = (key: keyof LineNotificationPreferences) => {
    if (key === 'reminderTimingHours') return;
    setLinePreferences(prev => {
      const updated = { ...prev, [key]: !prev[key] };
      localStorage.setItem('volunteer_line_preferences', JSON.stringify(updated));
      return updated;
    });
  };

  const handleSaveProfileAndPrefs = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('volunteer_line_preferences', JSON.stringify(linePreferences));
    localStorage.setItem('volunteer_profile_name', profileName);
    localStorage.setItem('volunteer_profile_phone', profilePhone);
    localStorage.setItem('volunteer_profile_email', profileEmail);
    localStorage.setItem('volunteer_profile_lineid', profileLineId);

    onUpdateProfile?.({ name: profileName, phone: profilePhone, email: profileEmail, lineId: profileLineId });

    // Sync the updated contact info to the backend volunteer DB
    fetch('/api/auth/google-phone-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken: 'volunteer-self-update',
        googleProfile: {
          uid: `google-uid-${profileEmail.replace(/[@.]/g, '_')}`,
          email: profileEmail,
          name: profileName
        },
        phoneNumber: profilePhone,
        lineId: profileLineId,
        tier: currentUser?.tier || '新進志工',
        totalHours: currentUser?.totalHours || 0,
        linePreferences: {
          shiftChanges: linePreferences.shiftChanges,
          urgentRecruitment: linePreferences.urgentRecruitment,
          checkInReminder: linePreferences.checkInReminder
        }
      })
    }).catch(() => { /* best-effort sync, ignore network errors */ });

    setIsSavedSuccess(true);
    setTimeout(() => setIsSavedSuccess(false), 3000);

    const enabledList = [];
    if (linePreferences.shiftChanges) enabledList.push('班次異動');
    if (linePreferences.urgentRecruitment) enabledList.push('緊急招募');
    if (linePreferences.checkInReminder) enabledList.push('簽到提醒');

    onSendLineToast(
      `⚙️ 已更新個人設定與 LINE 通知偏好！目前接收項目：【${enabledList.length > 0 ? enabledList.join('、') : '全部關閉'}】`
    );
  };

  const handleTestPushNotification = async (type: 'shiftChanges' | 'urgentRecruitment' | 'checkInReminder') => {
    const messages: Record<typeof type, string> = {
      shiftChanges: `💬 [LINE 班次異動測試推播] 您報名的【喵星人貓砂鏟除與安撫】班次集合地點已更新至「A棟2樓貓舍」，社工已通過審核！`,
      urgentRecruitment: `🚨 [LINE 緊急招募測試推播] 【大浪園區】明日上午班急需 2 位汪星人陪伴志工！點擊可線上搶班報名。`,
      checkInReminder: `⏰ [LINE 簽到提醒測試推播] 距離您的志工班次剩餘 ${linePreferences.reminderTimingHours || 1} 小時！已準備導航路線與簽到 QR Code。`
    };
    const text = messages[type];

    try {
      const res = await fetch('/api/line/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: profileEmail, message: text, notificationType: type })
      });
      const data = await res.json();

      if (data.success && !data.isFallback) {
        onSendLineToast(`✅ 已真的發送到你的 LINE：${text}`);
      } else if (data.note && data.note.includes('通知偏好')) {
        onSendLineToast(`⚠️ 未發送 — 你已在上方把「這類通知」關閉了，系統依你的偏好設定不會發送。`);
      } else {
        onSendLineToast(`${text}\n\n(模擬效果 — 尚未連結真實 LINE 帳號或未設定 Token)`);
      }
    } catch {
      onSendLineToast(text);
    }
  };

  return (
    <div className="space-y-8 py-6 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      
      {/* Volunteer Welcome Card with Accumulated Hours & Next Tier Milestone Progress */}
      <VolunteerWelcomeCard
        currentUser={currentUser || null}
        attendanceRecords={attendanceRecords}
        onOpenCheckInModal={onOpenCheckInModal}
        onNavigateTab={(tab) => {
          if (tab === 'growth' || tab === 'settings' || tab === 'shifts') {
            setActivePortalTab(tab);
          }
          if (onNavigateToTab) {
            onNavigateToTab(tab);
          }
        }}
      />

      {/* Sub Navigation Bar for Volunteer Portal */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-2.5 rounded-[24px] border border-[#5A5A40]/15 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActivePortalTab('shifts')}
            className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
              activePortalTab === 'shifts'
                ? 'bg-[#5A5A40] text-white shadow-xs'
                : 'bg-transparent text-slate-700 hover:bg-[#f5f5f0]'
            }`}
          >
            <Heart className="w-4 h-4 text-[#E6E2D3]" />
            <span>線上預約報名班次 ({shifts.length})</span>
          </button>

          <button
            onClick={() => setActivePortalTab('growth')}
            className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
              activePortalTab === 'growth'
                ? 'bg-[#5A5A40] text-white shadow-xs'
                : 'bg-transparent text-slate-700 hover:bg-[#f5f5f0]'
            }`}
          >
            <TrendingUp className="w-4 h-4 text-amber-300" />
            <span>志工成長晉升歷程 ({growthProgressPercent}%)</span>
          </button>

          <button
            onClick={() => setActivePortalTab('settings')}
            className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition flex items-center gap-2 cursor-pointer relative ${
              activePortalTab === 'settings'
                ? 'bg-[#5A5A40] text-white shadow-xs'
                : 'bg-transparent text-slate-700 hover:bg-[#f5f5f0]'
            }`}
          >
            <Settings className="w-4 h-4 text-amber-300" />
            <span>個人設定與 LINE 通知</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-ping"></span>
          </button>
        </div>

        <div className="text-xs text-slate-600 font-semibold px-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span>預設 LINE ID：@{profileLineId}</span>
        </div>
      </div>

      {activePortalTab === 'shifts' && (
        <div className="space-y-6">
          {/* Top Bar with Mode Switch and Stats */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 sm:p-5 rounded-[24px] border border-[#5A5A40]/15 shadow-xs">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold font-serif text-slate-900">
                  📅 職位與班次時間表
                </span>
                <span className="bg-amber-100 text-amber-900 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border border-amber-300">
                  志工專屬排班
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                可切換月曆視圖或卡片清單，點選班次可查看工作說明並進行線上預約搶班（報名後自動同步 Google 日曆）。
              </p>
            </div>

            {/* View Mode Switcher */}
            <div className="flex items-center bg-[#f5f5f0] p-1.5 rounded-2xl border border-[#5A5A40]/15 shrink-0 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setViewMode('calendar')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  viewMode === 'calendar'
                    ? 'bg-[#5A5A40] text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Calendar className="w-3.5 h-3.5 text-amber-300" />
                <span>月曆排班視圖</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  viewMode === 'grid'
                    ? 'bg-[#5A5A40] text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5 text-sky-300" />
                <span>卡片清單視圖</span>
              </button>
            </div>
          </div>

          {/* Render Calendar View or Grid View */}
          {viewMode === 'calendar' ? (
            <ShiftCalendarView
              shifts={shifts}
              branches={branches}
              selectedBranch={selectedBranch}
              isVolunteerMode={true}
              onApplyClick={handleOpenApply}
              myAppliedShiftIds={myAppliedShiftIds}
              onSendLineToast={onSendLineToast}
            />
          ) : (
            <div className="space-y-6">
              {/* Zone Filter Tabs for Grid View */}
              <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 sm:p-5 rounded-[24px] border border-[#5A5A40]/12">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-[#5A5A40] uppercase tracking-wider mr-1">場域分類：</span>
                  <button
                    onClick={() => setSelectedZoneFilter('all')}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold transition cursor-pointer ${
                      selectedZoneFilter === 'all'
                        ? 'bg-[#5A5A40] text-white shadow-xs'
                        : 'bg-[#f5f5f0] text-slate-600 hover:bg-[#E6E2D3]/40'
                    }`}
                  >
                    全部場域 (All)
                  </button>

                  {Object.keys(ZONE_CONFIGS).map(zKey => {
                    const zConf = ZONE_CONFIGS[zKey];
                    return (
                      <button
                        key={zKey}
                        onClick={() => setSelectedZoneFilter(zKey)}
                        className={`px-4 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                          selectedZoneFilter === zKey
                            ? 'bg-[#5A5A40] text-white shadow-xs'
                            : 'bg-[#f5f5f0] text-slate-600 hover:bg-[#E6E2D3]/40'
                        }`}
                      >
                        <span>{zConf.icon}</span>
                        <span>{zConf.name}</span>
                      </button>
                    );
                  })}
                </div>

                <span className="text-xs text-[#5A5A40] font-semibold">
                  共 {filteredShifts.length} 個開放預約班次
                </span>
              </div>

              {/* Shift Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredShifts.map(shift => {
                  const zoneConf = ZONE_CONFIGS[shift.zone];
                  const branch = branches.find(b => b.id === shift.branchId);
                  const remaining = shift.requiredCount - shift.currentCount;
                  const isFull = remaining <= 0;
                  const isApplied = myAppliedShiftIds.includes(shift.id);

                  return (
                    <div
                      key={shift.id}
                      className={`rounded-[28px] border bg-white p-6 shadow-xs flex flex-col justify-between transition hover:shadow-md ${
                        isApplied 
                          ? 'border-emerald-400 bg-emerald-50/20' 
                          : isFull 
                          ? 'border-slate-200 opacity-80' 
                          : 'border-[#5A5A40]/15'
                      }`}
                    >
                      <div className="space-y-4">
                        
                        {/* Header Tag */}
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1.5 ${zoneConf?.badgeBg}`}>
                            <span>{zoneConf?.icon}</span>
                            <span>{zoneConf?.name}</span>
                          </span>

                          {isApplied ? (
                            <span className="text-xs font-extrabold px-3 py-1 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-full flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>已報名參加</span>
                            </span>
                          ) : isFull ? (
                            <span className="text-xs font-bold px-3 py-1 bg-slate-100 text-slate-500 rounded-full">
                              🐱 喵力滿點 (已額滿)
                            </span>
                          ) : (
                            <span className="text-xs font-bold px-3 py-1 bg-[#5A5A40] text-white rounded-full shadow-2xs">
                              🐶 尚缺 {remaining} 人 (急召中)
                            </span>
                          )}
                        </div>

                        {/* Shift Title */}
                        <h3 className="font-bold font-serif text-slate-900 text-lg leading-snug">
                          {shift.title}
                        </h3>

                        {/* Info List */}
                        <div className="space-y-2 text-xs text-slate-600 font-sans">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-[#5A5A40] shrink-0" />
                            <span className="font-bold text-slate-800">{branch?.name}</span>
                          </div>

                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-[#5A5A40] shrink-0" />
                            <span className="font-semibold text-[#5A5A40]">
                              {shift.date} ({shift.timeRange})
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-[#5A5A40] shrink-0" />
                            <span>需求與現有：{shift.currentCount} / {shift.requiredCount} 人</span>
                          </div>
                        </div>

                        {/* Tasks list */}
                        {shift.tasks && shift.tasks.length > 0 && (
                          <div className="bg-[#fdfdfb] p-3 rounded-2xl border border-slate-200 text-xs space-y-1">
                            <span className="font-bold text-[#5A5A40] text-[11px] block">🐾 服務任務：</span>
                            {shift.tasks.map((task, idx) => (
                              <div key={idx} className="flex items-center gap-1.5 text-slate-700 text-xs">
                                <span className="text-amber-500 font-bold">•</span>
                                <span>{task}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Description */}
                        <p className="text-xs text-slate-600 bg-[#f5f5f0] p-3.5 rounded-2xl leading-relaxed border border-[#5A5A40]/10 font-sans">
                          {shift.description}
                        </p>

                        {/* Location trigger simulator */}
                        <div className="bg-[#fdfdfb] p-3.5 rounded-2xl border border-[#5A5A40]/12 text-xs space-y-1 font-sans">
                          <div className="flex items-center justify-between font-bold text-[#5A5A40]">
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3.5 h-3.5 text-[#5A5A40]" /> Google 地圖導航
                            </span>
                            <a
                              href={branch?.googleMapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-[#5A5A40] hover:underline flex items-center gap-0.5"
                            >
                              <span>打開 Google Maps</span>
                              <ArrowUpRight className="w-3 h-3" />
                            </a>
                          </div>
                          <p className="text-[11px] text-slate-600">
                            集合點：{shift.locationDetails} ({branch?.address})
                          </p>
                        </div>

                      </div>

                      {/* Apply Button */}
                      <div className="mt-6 pt-4 border-t border-[#5A5A40]/10">
                        {isApplied ? (
                          <div className="space-y-2">
                            <div className="w-full py-2.5 rounded-full font-bold text-xs bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center justify-center gap-2">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              <span>您已報名此班次 (行程已同步)</span>
                            </div>
                            {onNavigateToTab && (
                              <button
                                type="button"
                                onClick={() => onNavigateToTab('myshifts')}
                                className="w-full text-center text-xs text-[#5A5A40] hover:text-[#3e3e2b] font-bold hover:underline py-1 cursor-pointer flex items-center justify-center gap-1"
                              >
                                <span>前往「我的排班」查看詳情或取消報名</span>
                                <ArrowUpRight className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => handleOpenApply(shift)}
                            disabled={isFull}
                            className={`w-full py-3 rounded-full font-bold text-xs shadow-xs transition flex items-center justify-center gap-2 cursor-pointer ${
                              isFull
                                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                : 'bg-[#5A5A40] hover:bg-[#484833] text-white'
                            }`}
                          >
                            <Heart className="w-4 h-4 text-[#E6E2D3]" />
                            <span>{isFull ? '本班次已滿班' : '一鍵搶班 / 線上登記報名'}</span>
                          </button>
                        )}
                      </div>

                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Growth Tab Section */}
      {activePortalTab === 'growth' && (
        <div className="space-y-6 font-sans">
          
          {/* Header Banner */}
          <div className="bg-white rounded-[28px] p-6 border border-[#5A5A40]/15 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-[#5A5A40] text-white flex items-center justify-center shrink-0 shadow-xs">
                <TrendingUp className="w-6 h-6 text-amber-200" />
              </div>
              <div>
                <h3 className="text-xl font-bold font-serif italic text-slate-900">
                  🌱 志工成長軌跡與等級晉升考核
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  追蹤您的實習、正式、資深志工與志工隊長晉升清單，達標自動通報管理員核發徽章。
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
              <button
                type="button"
                onClick={handleSimulateAllCompleted}
                className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <Zap className="w-3.5 h-3.5 text-amber-600" />
                <span>一鍵「模擬全數通過考核」</span>
              </button>

              {isGrowthThresholdReached && (
                <button
                  type="button"
                  onClick={handleManualNotifyAdmin}
                  className="px-3 py-2 bg-[#5A5A40] hover:bg-[#484833] text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <Bell className="w-3.5 h-3.5 text-amber-300" />
                  <span>通知管理員審核</span>
                </button>
              )}
            </div>
          </div>

          {/* 志工成長軌跡 (Growth Pathway Card) */}
          <div className="bg-white rounded-[28px] p-6 border border-[#5A5A40]/15 shadow-xs space-y-6">
            
            {/* Progress Bar & Stage Milestones */}
            <div className="bg-[#fdfdfb] p-5 rounded-2xl border border-[#5A5A40]/12 space-y-4">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 font-bold text-slate-800">
                  <Award className="w-4 h-4 text-[#5A5A40]" />
                  <span>晉升【資深志工】解鎖門檻進度：</span>
                  <span className="text-[#5A5A40] text-sm font-extrabold">{growthProgressPercent}%</span>
                  <span className="text-slate-500 font-normal">({completedGrowthCount} / {totalGrowthCount} 項目達成)</span>
                </div>

                <div className="text-slate-500 font-medium text-[11px]">
                  目標：資深志工認證 🌟
                </div>
              </div>

              {/* Dynamic Progress Bar */}
              <div className="w-full bg-slate-200 h-3.5 rounded-full overflow-hidden p-0.5 shadow-inner relative">
                <div
                  className="bg-gradient-to-r from-[#5A5A40] via-amber-600 to-amber-500 h-full rounded-full transition-all duration-500 shadow-xs"
                  style={{ width: `${growthProgressPercent}%` }}
                />
              </div>

              {/* Stage Milestones Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                {/* Stage 1 */}
                <div className="bg-white p-3 rounded-xl border border-emerald-300 bg-emerald-50/50 flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 text-xs font-bold">
                    ✓
                  </div>
                  <div className="text-xs">
                    <div className="font-bold text-emerald-900">🐣 實習志工</div>
                    <div className="text-[10px] text-emerald-700 font-medium">講習課程 (已解鎖)</div>
                  </div>
                </div>

                {/* Stage 2 */}
                <div className="bg-white p-3 rounded-xl border border-emerald-400 bg-emerald-100/60 flex items-center gap-2.5 shadow-2xs">
                  <div className="w-8 h-8 rounded-full bg-[#5A5A40] text-white flex items-center justify-center shrink-0 text-xs font-bold">
                    ★
                  </div>
                  <div className="text-xs">
                    <div className="font-bold text-slate-900">🌿 正式志工</div>
                    <div className="text-[10px] text-[#5A5A40] font-bold">目前位階 (24h)</div>
                  </div>
                </div>

                {/* Stage 3 (Target) */}
                <div className={`p-3 rounded-xl border transition flex items-center gap-2.5 ${
                  isGrowthThresholdReached
                    ? 'bg-amber-100 border-amber-400 text-amber-900 shadow-xs'
                    : 'bg-white border-amber-300/80 text-slate-800'
                }`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                    isGrowthThresholdReached ? 'bg-amber-500 text-white animate-bounce' : 'bg-amber-100 text-amber-700 border border-amber-300'
                  }`}>
                    {isGrowthThresholdReached ? '🎉' : '3'}
                  </div>
                  <div className="text-xs">
                    <div className="font-bold text-amber-900">🌟 資深志工</div>
                    <div className="text-[10px] text-amber-700 font-medium">
                      {isGrowthThresholdReached ? '已達標! 等待發牌' : `考核中 (${growthProgressPercent}%)`}
                    </div>
                  </div>
                </div>

                {/* Stage 4 */}
                <div className="bg-white p-3 rounded-xl border border-slate-200 text-slate-400 opacity-60 flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center shrink-0 text-xs font-bold border border-slate-200">
                    👑
                  </div>
                  <div className="text-xs">
                    <div className="font-bold text-slate-600">志工隊長</div>
                    <div className="text-[10px] text-slate-400">時數 &gt; 80h</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Auto Admin Notification Banner */}
            {isGrowthThresholdReached && (
              <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in shadow-2xs">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-xs">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="font-bold text-emerald-950 text-sm flex items-center gap-1.5">
                      <span>🎉 恭喜！您已 100% 達成『資深志工』晉升門檻</span>
                    </h4>
                    <p className="text-xs text-emerald-800 mt-0.5">
                      {hasAutoNotifiedAdmin
                        ? '✅ 系統已自動發送 LINE 通知給社工管理員！管理員將審核並發放【資深志工】認證徽章。'
                        : '點擊下方按鈕將立即發送升級申請至管理員後台。'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleManualNotifyAdmin}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold px-4 py-2 rounded-xl text-xs transition flex items-center gap-1.5 shrink-0 shadow-2xs cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>再次通知管理員審核</span>
                </button>
              </div>
            )}

            {/* Assessment Checklist Items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold font-serif text-slate-900 text-sm flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-[#5A5A40]" />
                  <span>『資深志工』晉升考核項目清單 (點擊項目切換完成狀態)</span>
                </h4>
                <span className="text-xs text-[#5A5A40] font-bold bg-[#f5f5f0] px-3 py-1 rounded-full border border-[#5A5A40]/10">
                  達成項目：{completedGrowthCount} / {totalGrowthCount}
                </span>
              </div>

              <div className="space-y-2">
                {growthItems.map(item => (
                  <div
                    key={item.id}
                    onClick={() => handleToggleGrowthItem(item.id)}
                    className={`p-4 rounded-2xl border transition flex items-start justify-between gap-4 cursor-pointer ${
                      item.completed
                        ? 'bg-emerald-50/70 border-emerald-200 hover:bg-emerald-50'
                        : 'bg-white border-slate-200 hover:border-[#5A5A40]/30 hover:bg-[#f5f5f0]/50'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition ${
                          item.completed
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'border-2 border-slate-300 bg-white text-transparent'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md ${
                            item.category === '講習課程' ? 'bg-sky-100 text-sky-800' :
                            item.category === '服務時數' ? 'bg-purple-100 text-purple-800' :
                            item.category === '出勤紀律' ? 'bg-emerald-100 text-emerald-800' :
                            item.category === '技能檢定' ? 'bg-amber-100 text-amber-800' :
                            'bg-rose-100 text-rose-800'
                          }`}>
                            {item.category}
                          </span>

                          <span className={`font-bold text-xs ${item.completed ? 'text-slate-900 line-through decoration-emerald-600/60' : 'text-slate-900'}`}>
                            {item.title}
                          </span>
                        </div>

                        <p className="text-xs text-slate-500 leading-relaxed">
                          {item.description}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 pt-0.5">
                      {item.completed ? (
                        <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2.5 py-1 rounded-full flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>已合格</span>
                        </span>
                      ) : (
                        <span className="bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                          <span>點擊解鎖</span>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Settings Tab Section */}
      {activePortalTab === 'settings' && (
        <div className="space-y-6 font-sans">
          
          {/* Header Banner */}
          <div className="bg-white rounded-[28px] p-6 border border-[#5A5A40]/15 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[#5A5A40] text-white flex items-center justify-center shrink-0 shadow-xs">
                <BellRing className="w-6 h-6 text-amber-300" />
              </div>
              <div>
                <h3 className="text-xl font-bold font-serif italic text-slate-900">
                  志工個人設定與 LINE 通知偏好
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  自訂您的預設個人資料，並選擇是否接收『班次異動』、『緊急招募』或『簽到提醒』的 LINE 機器人推播通知。
                </p>
              </div>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-extrabold px-3.5 py-1.5 rounded-full flex items-center gap-1.5 self-start sm:self-auto">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>LINE 機器人服務連線中</span>
            </div>
          </div>

          <form onSubmit={handleSaveProfileAndPrefs} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left Column: Personal Profile Form */}
            <div className="bg-white rounded-[28px] p-6 border border-[#5A5A40]/15 shadow-xs space-y-4">
              <div className="flex items-center gap-2 font-bold font-serif text-slate-900 border-b border-[#5A5A40]/10 pb-3 text-sm">
                <User className="w-4 h-4 text-[#5A5A40]" />
                <span>志工預設基本資料</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#5A5A40] mb-1">真實姓名 *</label>
                <input
                  type="text"
                  required
                  value={profileName}
                  onChange={e => setProfileName(e.target.value)}
                  className="w-full p-3 bg-[#f5f5f0] border border-[#5A5A40]/15 rounded-2xl text-xs font-medium focus:ring-2 focus:ring-[#5A5A40] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#5A5A40] mb-1">行動電話 *</label>
                <input
                  type="tel"
                  required
                  value={profilePhone}
                  onChange={e => setProfilePhone(e.target.value)}
                  className="w-full p-3 bg-[#f5f5f0] border border-[#5A5A40]/15 rounded-2xl text-xs font-medium focus:ring-2 focus:ring-[#5A5A40] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#5A5A40] mb-1">電子郵件 *</label>
                <input
                  type="email"
                  required
                  value={profileEmail}
                  onChange={e => setProfileEmail(e.target.value)}
                  className="w-full p-3 bg-[#f5f5f0] border border-[#5A5A40]/15 rounded-2xl text-xs font-medium focus:ring-2 focus:ring-[#5A5A40] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#5A5A40] mb-1">LINE ID (帳號綁定) *</label>
                <input
                  type="text"
                  required
                  value={profileLineId}
                  onChange={e => setProfileLineId(e.target.value)}
                  className="w-full p-3 bg-[#f5f5f0] border border-[#5A5A40]/15 rounded-2xl text-xs font-medium focus:ring-2 focus:ring-[#5A5A40] focus:outline-none"
                />
              </div>

              <div className="bg-[#fdfdfb] p-3 rounded-xl border border-[#5A5A40]/12 text-[11px] text-[#5A5A40] space-y-1">
                <div className="font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>LINE @浪浪家園 服務號帳號連線</span>
                </div>
                <p className="text-slate-500">此資料在您報名班次時會自動填入，方便快捷完成線上預約。</p>
              </div>

              {/* Real LINE Login link status */}
              <div className={`p-3.5 rounded-xl border text-[11px] space-y-2 ${
                lineLinkStatus?.linked ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
              }`}>
                <div className={`font-bold flex items-center gap-1.5 ${lineLinkStatus?.linked ? 'text-emerald-800' : 'text-amber-900'}`}>
                  {lineLinkStatus?.linked ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <AlertCircle className="w-3.5 h-3.5 text-amber-600" />}
                  <span>
                    {lineLinkStatus?.linked
                      ? `已連結真實 LINE 帳號${lineLinkStatus.displayName ? `（${lineLinkStatus.displayName}）` : ''}`
                      : '尚未連結真實 LINE 帳號'}
                  </span>
                </div>
                <p className={lineLinkStatus?.linked ? 'text-emerald-700' : 'text-amber-800'}>
                  {lineLinkStatus?.linked
                    ? '個別測試推播現在會真的發送到你的 LINE。'
                    : '連結後，下方「班次異動 / 緊急招募 / 簽到提醒」測試推播才會真的發送給你本人，而不是站內模擬效果。'}
                </p>
                <a
                  href={buildLineLoginUrl(profileEmail)}
                  className="inline-flex items-center gap-1.5 bg-[#06C755] hover:brightness-95 text-white font-bold text-xs px-3.5 py-2 rounded-full transition"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>{lineLinkStatus?.linked ? '重新連結 LINE 帳號' : '連結真實 LINE 帳號'}</span>
                </a>
              </div>
            </div>

            {/* Right 2 Columns: LINE Notification Preferences & Test Push */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* LINE Notification Preferences Box */}
              <div className="bg-white rounded-[28px] p-6 border border-[#5A5A40]/15 shadow-xs space-y-5">
                <div className="flex items-center justify-between border-b border-[#5A5A40]/10 pb-3 gap-3 flex-wrap">
                  <div className="flex items-center gap-2 font-bold font-serif text-slate-900 text-sm">
                    <Bell className="w-4.5 h-4.5 text-amber-600" />
                    <span>『LINE 通知偏好』切換選項</span>
                  </div>

                  <button
                    type="submit"
                    className="bg-[#5A5A40] hover:bg-[#484833] text-white font-extrabold px-5 py-2 rounded-full text-xs shadow-md transition flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <Save className="w-3.5 h-3.5 text-amber-300" />
                    <span>儲存設定</span>
                  </button>

                  {isSavedSuccess ? (
                    <span className="text-[11px] font-bold text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>偏好設定已儲存！</span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-500">
                      設定您希望接收的 LINE 機器人訊息類型
                    </span>
                  )}
                </div>

                <div className="space-y-4">
                  
                  {/* Toggle 1: 班次異動 */}
                  <div className="bg-[#f5f5f0]/80 hover:bg-[#f5f5f0] p-4 rounded-2xl border border-[#5A5A40]/12 flex items-start justify-between gap-4 transition">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🔄</span>
                        <span className="font-bold text-slate-900 text-sm">班次異動推播通知</span>
                        {linePreferences.shiftChanges ? (
                          <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                            已開啟 (ON)
                          </span>
                        ) : (
                          <span className="bg-slate-200 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                            已停用 (OFF)
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        當您已報名的班次時間調整、集合地點變更、或社工完成審核錄取 / 婉拒時，發送 LINE 訊息通知。
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleTogglePreference('shiftChanges')}
                      className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 mt-1 ${
                        linePreferences.shiftChanges ? 'bg-emerald-500' : 'bg-slate-300'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow-xs absolute top-0.5 transition-transform ${
                        linePreferences.shiftChanges ? 'right-0.5' : 'left-0.5'
                      }`} />
                    </button>
                  </div>

                  {/* Toggle 2: 緊急招募 */}
                  <div className="bg-[#f5f5f0]/80 hover:bg-[#f5f5f0] p-4 rounded-2xl border border-[#5A5A40]/12 flex items-start justify-between gap-4 transition">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🚨</span>
                        <span className="font-bold text-slate-900 text-sm">緊急招募與缺額大補帖</span>
                        {linePreferences.urgentRecruitment ? (
                          <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                            已開啟 (ON)
                          </span>
                        ) : (
                          <span className="bg-slate-200 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                            已停用 (OFF)
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        當各分區園區物資搬運、犬隻運動空檔突發缺額，社工發出緊急搶班公告時優先推播。
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleTogglePreference('urgentRecruitment')}
                      className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 mt-1 ${
                        linePreferences.urgentRecruitment ? 'bg-emerald-500' : 'bg-slate-300'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow-xs absolute top-0.5 transition-transform ${
                        linePreferences.urgentRecruitment ? 'right-0.5' : 'left-0.5'
                      }`} />
                    </button>
                  </div>

                  {/* Toggle 3: 簽到提醒 */}
                  <div className="bg-[#f5f5f0]/80 hover:bg-[#f5f5f0] p-4 rounded-2xl border border-[#5A5A40]/12 flex items-start justify-between gap-4 transition">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base">⏰</span>
                        <span className="font-bold text-slate-900 text-sm">簽到提醒與導航指南</span>
                        {linePreferences.checkInReminder ? (
                          <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                            已開啟 (ON)
                          </span>
                        ) : (
                          <span className="bg-slate-200 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                            已停用 (OFF)
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        於您已預約之志工班次開始前，自動發送地點 Google Maps 開啟導航與現場簽到 QR Code 連結。
                      </p>

                      {linePreferences.checkInReminder && (
                        <div className="pt-2 flex items-center gap-2 text-xs">
                          <span className="text-slate-500 font-bold">提醒時機設定：</span>
                          <select
                            value={linePreferences.reminderTimingHours || 1}
                            onChange={e => {
                              const val = parseInt(e.target.value, 10);
                              setLinePreferences(prev => {
                                const updated = { ...prev, reminderTimingHours: val };
                                localStorage.setItem('volunteer_line_preferences', JSON.stringify(updated));
                                return updated;
                              });
                            }}
                            className="p-1.5 bg-white border border-[#5A5A40]/20 rounded-xl text-xs font-bold text-[#5A5A40]"
                          >
                            <option value={1}>出班前 1 小時</option>
                            <option value={2}>出班前 2 小時</option>
                            <option value={12}>出班前 12 小時</option>
                            <option value={24}>前一日晚間 20:00</option>
                          </select>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleTogglePreference('checkInReminder')}
                      className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 mt-1 ${
                        linePreferences.checkInReminder ? 'bg-emerald-500' : 'bg-slate-300'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow-xs absolute top-0.5 transition-transform ${
                        linePreferences.checkInReminder ? 'right-0.5' : 'left-0.5'
                      }`} />
                    </button>
                  </div>

                </div>
              </div>

              {/* Live Test Push Simulator Box */}
              <div className="bg-amber-50/70 rounded-[28px] p-6 border border-amber-200 space-y-4">
                <div className="flex items-center gap-2 text-amber-900 font-bold font-serif text-sm">
                  <Smartphone className="w-4 h-4 text-amber-700" />
                  <span>📱 LINE 機器人推播效果測試測試區</span>
                </div>
                <p className="text-xs text-amber-800 leading-relaxed">
                  點擊下方按鈕可立即觸發範例 LINE 通知快訊，體驗推播效果：
                </p>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleTestPushNotification('shiftChanges')}
                    className="bg-white hover:bg-amber-100 text-slate-800 border border-amber-300 font-bold py-2 px-3.5 rounded-xl text-xs transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                  >
                    <span>💬 測試「班次異動」推播</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleTestPushNotification('urgentRecruitment')}
                    className="bg-white hover:bg-amber-100 text-slate-800 border border-amber-300 font-bold py-2 px-3.5 rounded-xl text-xs transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                  >
                    <span>🚨 測試「緊急招募」推播</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleTestPushNotification('checkInReminder')}
                    className="bg-white hover:bg-amber-100 text-slate-800 border border-amber-300 font-bold py-2 px-3.5 rounded-xl text-xs transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                  >
                    <span>⏰ 測試「簽到提醒」推播</span>
                  </button>
                </div>
              </div>

              {/* Save hint (button now lives in the header above for visibility) */}
              <div className="text-xs text-slate-500 pt-2">
                💡 變更將立即儲存並應用於 LINE Bot 訊息推播。
              </div>

            </div>

          </form>
        </div>
      )}

      {/* Registration Form Modal */}
      {activeShiftForApply && (
        <div className="fixed inset-0 z-50 bg-[#5A5A40]/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-[32px] max-w-lg w-full shadow-2xl p-6 sm:p-8 border border-[#5A5A40]/20 space-y-5 my-8">
            
            <div className="flex items-center justify-between border-b border-[#5A5A40]/10 pb-3">
              <div>
                <h3 className="font-bold font-serif text-lg text-slate-900">
                  🐾 線上登記報名 - 志工班次
                </h3>
                <p className="text-xs text-[#5A5A40] font-sans mt-0.5">{activeShiftForApply.title}</p>
              </div>
              <button
                onClick={() => setActiveShiftForApply(null)}
                className="text-slate-400 hover:text-[#5A5A40] font-bold text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            {submittedSuccess ? (
              <div className="py-12 text-center space-y-4 font-sans">
                <CheckCircle2 className="w-12 h-12 text-[#5A5A40] mx-auto animate-bounce" />
                <h4 className="font-bold text-lg font-serif italic text-[#5A5A40]">報名資料已成功送出！</h4>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  社工審核後將透過 LINE 機器人自動發送提醒通知。
                </p>
                <a
                  href={buildGoogleCalendarLink({
                    title: `🐾 志工班次：${activeShiftForApply.title}`,
                    date: activeShiftForApply.date,
                    timeRange: activeShiftForApply.timeRange,
                    location: activeShiftForApply.locationDetails || branches.find(b => b.id === activeShiftForApply.branchId)?.name || '浪浪家園',
                    details: `浪浪家園志工服務班次\n任務：${(activeShiftForApply.tasks || []).join('、')}`
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-[#5A5A40] hover:bg-[#484833] text-white font-bold text-xs px-5 py-2.5 rounded-full shadow-xs transition cursor-pointer"
                >
                  <Calendar className="w-4 h-4 text-amber-300" />
                  <span>加入 Google 日曆</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </a>
              </div>
            ) : (
              <form onSubmit={handleConfirmApply} className="space-y-4 text-xs font-sans">
                
                <div>
                  <label className="block font-bold text-[#5A5A40] mb-1">您的真實姓名 *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="例如：林小明"
                    className="w-full p-3 bg-[#f5f5f0] border border-[#5A5A40]/15 rounded-2xl focus:ring-2 focus:ring-[#5A5A40] focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-bold text-[#5A5A40] mb-1">電話號碼 *</label>
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="0912-345-678"
                      className="w-full p-3 bg-[#f5f5f0] border border-[#5A5A40]/15 rounded-2xl focus:ring-2 focus:ring-[#5A5A40] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-[#5A5A40] mb-1">LINE ID (推播提醒用) *</label>
                    <input
                      type="text"
                      required
                      value={lineId}
                      onChange={e => setLineId(e.target.value)}
                      placeholder="e.g. xiaoming_line"
                      className="w-full p-3 bg-[#f5f5f0] border border-[#5A5A40]/15 rounded-2xl focus:ring-2 focus:ring-[#5A5A40] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-[#5A5A40] mb-1">電子郵件 Email *</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="xiaoming@gmail.com"
                    className="w-full p-3 bg-[#f5f5f0] border border-[#5A5A40]/15 rounded-2xl focus:ring-2 focus:ring-[#5A5A40] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold text-[#5A5A40] mb-1">過去志工經驗或特別說明 (選填)</label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="家中養貓3年，熟悉貓砂清潔與親人安撫..."
                    rows={3}
                    className="w-full p-3 bg-[#f5f5f0] border border-[#5A5A40]/15 rounded-2xl focus:ring-2 focus:ring-[#5A5A40] focus:outline-none"
                  />
                </div>

                <div className="p-4 bg-white border border-[#5A5A40]/15 rounded-2xl space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#5A5A40]">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AI 情境準備度小測驗（選填，僅供社工參考，不影響報名）</span>
                  </div>

                  {isLoadingQuestion ? (
                    <p className="text-[11px] text-slate-500">Gemini 正在為這個班次出情境題...</p>
                  ) : situationalQuestion ? (
                    <>
                      <p className="text-xs text-slate-700 bg-[#f5f5f0] p-3 rounded-xl leading-relaxed">
                        {situationalQuestion}
                      </p>
                      <textarea
                        value={situationalAnswer}
                        onChange={e => { setSituationalAnswer(e.target.value); setAiAssessment(null); }}
                        placeholder="想到什麼就寫什麼，沒有標準答案～"
                        rows={2}
                        className="w-full p-3 bg-[#f5f5f0] border border-[#5A5A40]/15 rounded-2xl focus:ring-2 focus:ring-[#5A5A40] focus:outline-none text-xs"
                      />

                      {aiAssessment ? (
                        <div className="p-3 bg-[#E6E2D3]/40 border border-[#5A5A40]/15 rounded-xl text-[11px] text-[#5A5A40] space-y-1">
                          <p className="font-bold">💬 AI 小回饋：{aiAssessment.feedback}</p>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleAssessSituationalAnswer(activeShiftForApply)}
                          disabled={!situationalAnswer.trim() || isAssessing}
                          className="text-[11px] font-bold text-[#5A5A40] hover:underline disabled:opacity-40 disabled:hover:no-underline cursor-pointer"
                        >
                          {isAssessing ? 'AI 思考中...' : '請 AI 幫我看看這個回答 →'}
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="text-[11px] text-slate-400">這次沒有出題，直接送出報名即可。</p>
                  )}
                </div>

                <div className="p-3.5 bg-[#f5f5f0] border border-[#5A5A40]/12 rounded-2xl text-[11px] text-[#5A5A40] space-y-1">
                  <p className="font-bold">✨ 自動整合叮嚀：</p>
                  <p>• 系統將自動把《園區 Google Maps 定位》嵌入您的預約卡片。</p>
                  <p>• 錄取後 LINE 機器人會於出班前 1 小時發送導航提醒小幫手。</p>
                </div>

                <div className="pt-2 flex justify-end space-x-3 border-t border-[#5A5A40]/10">
                  <button
                    type="button"
                    onClick={() => setActiveShiftForApply(null)}
                    className="px-5 py-2.5 rounded-full font-bold text-slate-600 hover:bg-[#f5f5f0] cursor-pointer"
                  >
                    取消
                  </button>

                  <button
                    type="submit"
                    className="px-6 py-2.5 rounded-full font-bold bg-[#5A5A40] hover:bg-[#484833] text-white shadow-xs cursor-pointer"
                  >
                    確認報名此班次
                  </button>
                </div>

              </form>
            )}

          </div>
        </div>
      )}

    </div>
  );
};
