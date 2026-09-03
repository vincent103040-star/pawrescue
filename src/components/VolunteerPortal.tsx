import React, { useState, useMemo, useEffect } from 'react';
import { PositionShift, ShelterLocation, SkillLevel, ZoneCategory, LineNotificationPreferences, VolunteerUserSession, AttendanceRecord, ShiftSignup, PromotionRequest, LineOfficialAccount } from '../types';
import { ZONE_CONFIGS } from '../data/mockData';
import { VolunteerWelcomeCard } from './VolunteerWelcomeCard';
import { ShiftCalendarView } from './ShiftCalendarView';
import { Heart, MapPin, Calendar, Clock, Check, Users, ExternalLink, Sparkles, AlertCircle, ArrowUpRight, CheckCircle2, QrCode, Settings, Bell, BellRing, User, Save, Send, Smartphone, ShieldCheck, ToggleLeft, ToggleRight, Sparkle, TrendingUp, Award, CheckSquare, Square, Crown, Medal, Star, Trophy, BookOpen, Zap, ChevronRight, LayoutGrid, MessageSquare, Camera, ShieldAlert } from 'lucide-react';
import { buildGoogleCalendarLink } from '../utils/googleCalendar';
import { startLineBinding } from '../utils/lineLogin';
import { getLiffVolunteerIdentity } from '../utils/liff';

import { authFetch } from '../utils/session';
import { resolveZone } from '../data/zones';
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
  shelterLocation: ShelterLocation;
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
  shiftSignups?: ShiftSignup[];
  onNavigateToTab?: (tab: 'shifts' | 'myshifts' | 'growth' | 'settings' | 'sop') => void;
  onCancelSignup?: (appId: string) => void;
  onUpdateProfile?: (updates: Partial<VolunteerUserSession>) => void;
}

export const VolunteerPortal: React.FC<VolunteerPortalProps> = ({
  shifts,
  shelterLocation,
  onApplySubmit,
  onSendLineToast,
  onOpenCheckInModal,
  activeSection = 'shifts',
  currentUser,
  attendanceRecords = [],
  shiftSignups = [],
  onNavigateToTab,
  onCancelSignup,
  onUpdateProfile
}) => {
  const [activePortalTab, setActivePortalTab] = useState<'shifts' | 'growth' | 'settings'>(activeSection);
  const [viewMode, setViewMode] = useState<'calendar' | 'grid'>('calendar');

  // The LINE official account to add as a friend for push notifications --
  // admin-editable (see AdminSopManager's settings card), so this always
  // matches whichever channel is actually configured instead of a hardcoded
  // claim in the JSX.
  const [lineOfficialAccount, setLineOfficialAccount] = useState<LineOfficialAccount | null>(null);
  useEffect(() => {
    fetch('/api/line-official-account')
      .then(res => res.json())
      .then(data => { if (data.success) setLineOfficialAccount(data.account); })
      .catch(() => { /* best-effort */ });
  }, []);

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
    // Which shifts already have my name on them -- used to grey out the
    // sign-up button. Matched by email alone, from the session and nowhere
    // else: the old version fell back to a demo identity whose phone number
    // the sample bookings share, so a shift somebody else had taken showed up
    // as already booked by me.
    const vEmail = (currentUser?.email || '').trim().toLowerCase();
    if (!vEmail) return [];

    return shiftSignups
      .filter(a =>
        a.status !== 'rejected' &&
        (a.volunteerEmail || '').trim().toLowerCase() === vEmail
      )
      .map(a => a.shiftId);
  }, [shiftSignups, currentUser]);


  // LINE Notification Preferences State
  // 預設值單獨拉出來，因為它有兩個用途：沒有任何儲存紀錄時的初始值，以及舊紀錄
  // 的補漏底稿。在某個開關被加進來之前存下的偏好不會有那個鍵，若直接回傳
  // JSON.parse 的結果，該開關會停在 undefined —— 而 undefined 的第一次切換算出來
  // 是 !undefined，正好等於它畫面上已經顯示的值，於是那顆開關按了不會動。
  const DEFAULT_PREFERENCES: LineNotificationPreferences = {
    shiftChanges: true,      // 班次異動
    urgentRecruitment: true, // 緊急招募
    checkInReminder: true,   // 簽到提醒
    sopReminder: true,       // 簽到後的工作清單要不要附教材提醒
    // 唯一預設關閉的一項。這是關於動物的訊息，不是志工自己的事，
    // 替所有人預設開啟等於替他們決定要收。
    animalStatusAlerts: false,
    feedbackReply: true,     // 社工回覆自己留下的服務回饋
    reminderTimingHours: 1
  };

  const [linePreferences, setLinePreferences] = useState<LineNotificationPreferences>(() => {
    const saved = localStorage.getItem('volunteer_line_preferences');
    if (saved) {
      try {
        return { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) };
      } catch (e) {
        // fallback
      }
    }
    return DEFAULT_PREFERENCES;
  });

  /**
   * 本週需要留意的動物。
   *
   * 只有志工自己打開開關之後才會去要。伺服器端也會再檢查一次同一個開關 ——
   * 這裡不去打它只是省一次沒必要的請求，真正決定給不給看的是伺服器。
   */
  interface AnimalConcern {
    animalName: string;
    shelterNumber: string;
    optionLabel: string;
    dutyTitle: string;
    observedAt: string;
    requiredTier: string;
  }
  const [animalConcerns, setAnimalConcerns] = useState<AnimalConcern[]>([]);
  const [animalConcernsLoading, setAnimalConcernsLoading] = useState(false);

  useEffect(() => {
    if (linePreferences.animalStatusAlerts !== true) {
      setAnimalConcerns([]);
      return;
    }
    let cancelled = false;
    setAnimalConcernsLoading(true);
    authFetch('/api/animal-concerns')
      .then(res => res.json())
      .then(data => {
        if (cancelled) return;
        setAnimalConcerns(data?.success && data.enabled ? (data.concerns || []) : []);
      })
      .catch(() => { /* 讀不到就當作沒有，不要用錯誤訊息蓋掉整個設定頁 */ })
      .finally(() => { if (!cancelled) setAnimalConcernsLoading(false); });
    return () => { cancelled = true; };
  }, [linePreferences.animalStatusAlerts]);

  // Profile Form states
  const [profileName, setProfileName] = useState(() => localStorage.getItem('volunteer_profile_name') || '林小明');
  // Phone/email have no meaningful mock fallback -- pre-filling a fake number/address
  // for a volunteer who hasn't actually entered one is misleading, so these default to
  // empty and show a "未有資料" placeholder instead (see the input elements below).
  const [profilePhone, setProfilePhone] = useState(() => localStorage.getItem('volunteer_profile_phone') || '');
  const [profileEmail, setProfileEmail] = useState(() => localStorage.getItem('volunteer_profile_email') || '');
  const [profileLineId, setProfileLineId] = useState(() => localStorage.getItem('volunteer_profile_lineid') || 'xiaoming_line');
  const [isSavedSuccess, setIsSavedSuccess] = useState(false);

  // Emergency contact + avatar photo -- both live server-side on the volunteer's DB
  // row (see updateVolunteerProfileExtras in db.ts) rather than localStorage, since
  // an admin needs to see them too (roster card's "緊急聯絡人" / avatar image).
  const [profileEmergencyContact, setProfileEmergencyContact] = useState('');
  const [profileAvatarUrl, setProfileAvatarUrl] = useState('');
  const [pendingAvatar, setPendingAvatar] = useState<{ previewUrl: string; base64: string; mimeType: string } | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  // Seed the two DB-only fields above from the volunteer's actual saved record
  // (not just this browser's localStorage) whenever we know their email.
  React.useEffect(() => {
    if (!profileEmail) return;
    authFetch(`/api/volunteers/profile?email=${encodeURIComponent(profileEmail)}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.volunteer) {
          setProfileEmergencyContact(data.volunteer.emergencyContact || '');
          setProfileAvatarUrl(data.volunteer.avatar || '');
        }
      })
      .catch(() => { /* best-effort -- form still works without a saved record yet */ });
  }, [profileEmail]);

  // Downscale + compress client-side before ever touching the network -- an avatar
  // is only ever shown as a small circle, so there's no reason to upload a multi-MB
  // phone photo. Mirrors VolunteerCheckInModal's check-out photo handling, just with
  // a much smaller target size since this never needs to be full-resolution.
  const handleAvatarSelected = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 320;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setPendingAvatar({
          previewUrl: dataUrl,
          base64: dataUrl.split(',')[1],
          mimeType: 'image/jpeg'
        });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Real LINE Login link status
  const [lineLinkStatus, setLineLinkStatus] = useState<{ linked: boolean; displayName: string | null } | null>(null);

  const refreshLineLinkStatus = React.useCallback(() => {
    if (!profileEmail) return;
    authFetch(`/api/volunteers/line-status?email=${encodeURIComponent(profileEmail)}`)
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

  // Auto-suggest a "稱謂" (display name) from whichever real identity source is
  // available, preferring the volunteer's actual LINE display name (from real LINE
  // Login) over their Google account name -- but only while nothing's been
  // customized yet, so this never clobbers a name the volunteer already saved.
  React.useEffect(() => {
    if (profileName && profileName !== '林小明') return;
    const suggested =
      (lineLinkStatus?.linked && lineLinkStatus.displayName) ||
      (currentUser?.name && currentUser.name !== '林小明' ? currentUser.name : null);
    if (suggested) setProfileName(suggested);
  }, [lineLinkStatus, currentUser]);

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

  const [promotionStatus, setPromotionStatus] = useState<PromotionRequest | null>(null);

  const completedGrowthCount = growthItems.filter(i => i.completed).length;
  const totalGrowthCount = growthItems.length;
  const growthProgressPercent = Math.round((completedGrowthCount / totalGrowthCount) * 100);
  const isGrowthThresholdReached = completedGrowthCount === totalGrowthCount;

  useEffect(() => {
    if (!profileEmail) return;
    authFetch(`/api/promotions?volunteerEmail=${encodeURIComponent(profileEmail)}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.request) {
          setPromotionStatus(data.request);
          if (data.request.status === 'pending') {
            setHasAutoNotifiedAdmin(true);
          }
        }
      })
      .catch(() => { /* best-effort */ });
  }, [profileEmail]);

  const submitPromotionRequest = (items: GrowthChecklistItem[]) => {
    if (!profileEmail) {
      onSendLineToast(`🚨 [通知管理員] 志工【${profileName}】向管理員送出【資深志工】晉升審核！`);
      return;
    }
    authFetch('/api/promotions/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        volunteerEmail: profileEmail,
        volunteerName: profileName,
        currentTier: currentUser?.tier || '正式志工',
        requestedTier: '資深志工',
        completedItems: items.filter(i => i.completed).map(i => i.title)
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setPromotionStatus(data.request);
          onSendLineToast(
            `🚨 [已送出] 志工【${profileName}】向管理員送出【資深志工】晉升審核申請，已記錄於管理後台，請等待審核。`
          );
        } else {
          onSendLineToast(`⚠️ 送出晉升申請失敗，請稍後再試。`);
        }
      })
      .catch(() => onSendLineToast(`⚠️ 送出晉升申請失敗，請確認網路連線後再試。`));
  };

  const handleToggleGrowthItem = (itemId: string) => {
    setGrowthItems(prev => {
      const updated = prev.map(item => item.id === itemId ? { ...item, completed: !item.completed } : item);
      localStorage.setItem('volunteer_growth_items', JSON.stringify(updated));

      const comp = updated.filter(i => i.completed).length;
      if (comp === updated.length && !hasAutoNotifiedAdmin) {
        setHasAutoNotifiedAdmin(true);
        localStorage.setItem('volunteer_growth_notified', 'true');
        submitPromotionRequest(updated);
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
    submitPromotionRequest(allCompleted);
  };

  const handleManualNotifyAdmin = () => {
    setHasAutoNotifiedAdmin(true);
    localStorage.setItem('volunteer_growth_notified', 'true');
    submitPromotionRequest(growthItems);
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
      const res = await authFetch('/api/ai/generate-situational-question', {
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
      const res = await authFetch('/api/ai/assess-situational-answer', {
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

    // When opened inside LINE via LIFF, trust the real LINE profile over whatever
    // was typed/saved before -- it's a more reliable source for name + LINE ID.
    getLiffVolunteerIdentity().then(identity => {
      if (identity) {
        setName(identity.name);
        setLineId(identity.lineId);
      }
    });
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

    // Sync the updated contact info to the backend volunteer DB. This endpoint
    // requires a real phone number (it's shared with actual Google login), so only
    // call it once the volunteer has entered one -- an empty phone just means the
    // name/lineId edits above stay local until they fill it in.
    if (profilePhone) {
      // authFetch, not fetch: this is a signed-in volunteer editing their own
      // contact details, and the session is what tells the server whose record
      // to write. It used to send the email in the body, which meant the same
      // call could have rewritten anybody's.
      authFetch('/api/auth/google-phone-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          googleProfile: { name: profileName },
          phoneNumber: profilePhone,
          lineId: profileLineId,
          tier: currentUser?.tier || '新進志工',
          totalHours: currentUser?.totalHours || 0,
          linePreferences: {
            shiftChanges: linePreferences.shiftChanges,
            urgentRecruitment: linePreferences.urgentRecruitment,
            checkInReminder: linePreferences.checkInReminder,
            sopReminder: linePreferences.sopReminder !== false,
            // `=== true`, not `!== false`: this one is opt-in, so a preferences
            // object saved before the switch existed must stay off rather than
            // being read as consent.
            animalStatusAlerts: linePreferences.animalStatusAlerts === true,
            // 預設開啟，所以缺少欄位視為要收 —— 與伺服器端的判讀一致。
            feedbackReply: linePreferences.feedbackReply !== false,
            // Sent now. This choice used to stay in localStorage, so it was lost
            // on a new device -- and nothing on the server read it anyway.
            reminderTimingHours: linePreferences.reminderTimingHours || 1
          }
        })
      }).catch(() => { /* best-effort sync, ignore network errors */ });
    }

    // Sync emergency contact + avatar (the two fields the login-sync call above
    // deliberately never touches) via the dedicated extras endpoint.
    if (profileEmail && (profileEmergencyContact || pendingAvatar)) {
      setIsUploadingAvatar(!!pendingAvatar);
      authFetch('/api/volunteers/profile-extras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: profileEmail,
          emergencyContact: profileEmergencyContact,
          avatarBase64: pendingAvatar?.base64,
          avatarMimeType: pendingAvatar?.mimeType
        })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success && data.volunteer) {
            setProfileAvatarUrl(data.volunteer.avatar || '');
            setPendingAvatar(null);
          }
        })
        .catch(() => { /* best-effort sync, ignore network errors */ })
        .finally(() => setIsUploadingAvatar(false));
    }

    setIsSavedSuccess(true);
    setTimeout(() => setIsSavedSuccess(false), 3000);

    const enabledList = [];
    if (linePreferences.shiftChanges) enabledList.push('班次異動');
    if (linePreferences.urgentRecruitment) enabledList.push('緊急招募');
    if (linePreferences.checkInReminder) enabledList.push('簽到提醒');
    if (linePreferences.feedbackReply !== false) enabledList.push('社工回覆');

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
      const res = await authFetch('/api/line/push', {
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
      
      {/* 累積時數與晉升進度只跟「志工成長晉升歷程」這個分頁有關，放在班次瀏覽
          或設定分頁上只是重複資訊、多佔一屏。簽到按鈕與晉升清單捷徑都不是這裡
          唯一的入口：簽到在最上方的 VolunteerNavbar 已經有獨立按鈕，晉升清單
          本來就只是切到 growth 分頁的捷徑，而 growth 分頁本身在頂部分頁列隨時
          點得到 —— 所以只在這裡顯示不會少任何功能。 */}
      {activePortalTab === 'growth' && (
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
      )}

      {/* Sub Navigation Bar for Volunteer Portal */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-2.5 rounded-[24px] border border-[#716053] shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActivePortalTab('shifts')}
            className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
              activePortalTab === 'shifts'
                ? 'bg-[#716053] text-white shadow-xs'
                : 'bg-transparent text-slate-700 hover:bg-[#FAF6EE]'
            }`}
          >
            <Heart className="w-4 h-4 text-[#F5E6D0]" />
            <span>線上預約報名班次 ({shifts.length})</span>
          </button>

          <button
            onClick={() => setActivePortalTab('growth')}
            className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
              activePortalTab === 'growth'
                ? 'bg-[#716053] text-white shadow-xs'
                : 'bg-transparent text-slate-700 hover:bg-[#FAF6EE]'
            }`}
          >
            <TrendingUp className="w-4 h-4 text-amber-300" />
            <span>志工成長晉升歷程 ({growthProgressPercent}%)</span>
          </button>

          <button
            onClick={() => setActivePortalTab('settings')}
            className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition flex items-center gap-2 cursor-pointer relative ${
              activePortalTab === 'settings'
                ? 'bg-[#716053] text-white shadow-xs'
                : 'bg-transparent text-slate-700 hover:bg-[#FAF6EE]'
            }`}
          >
            <Settings className="w-4 h-4 text-amber-300" />
            <span>個人設定與 LINE 通知</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-ping"></span>
          </button>
        </div>

        <div className="text-xs text-slate-600 font-semibold px-3 flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${lineLinkStatus?.linked ? 'bg-emerald-500' : 'bg-slate-300'}`}></span>
          <span>
            {lineLinkStatus?.linked
              ? `已連結 LINE 帳號：${lineLinkStatus.displayName || '已連結'}`
              : '尚未連結真實 LINE 帳號'}
          </span>
        </div>
      </div>

      {activePortalTab === 'shifts' && (
        <div className="space-y-6">
          {/* 切換按鈕抽出來共用，理由跟管理端的 PositionManager 一樣：月曆模式
              下這個按鈕會被塞進 ShiftCalendarView，跟同步狀態、地點合併成一列
              （見該元件的 viewModeSwitcher prop）；月曆模式時這裡不會掛載它，
              所以按鈕只能由這一層準備好，卡片模式與月曆模式共用同一份 JSX。 */}
          {(() => {
            const viewToggleButtons = (
              <div className="flex items-center bg-[#FAF6EE] p-1.5 rounded-2xl border border-[#716053] shrink-0 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setViewMode('calendar')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    viewMode === 'calendar'
                      ? 'bg-[#716053] text-white shadow-2xs'
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
                      ? 'bg-[#716053] text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5 text-sky-300" />
                  <span>卡片清單視圖</span>
                </button>
              </div>
            );

            return (
              <>
                {/* Top Bar with Mode Switch and Stats */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 sm:p-5 rounded-[24px] border border-[#716053] shadow-xs">
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

                  {/* 卡片模式才在這裡畫切換按鈕；月曆模式已經交給 ShiftCalendarView
                      跟同步狀態、地點合併顯示，這裡不重複畫一次。 */}
                  {viewMode === 'grid' && viewToggleButtons}
                </div>

                {/* Render Calendar View or Grid View */}
                {viewMode === 'calendar' ? (
                  <ShiftCalendarView
                    shifts={shifts}
                    isVolunteerMode={true}
                    onApplyClick={handleOpenApply}
                    myAppliedShiftIds={myAppliedShiftIds}
                    onSendLineToast={onSendLineToast}
                    viewModeSwitcher={viewToggleButtons}
                  />
                ) : (
            <div className="space-y-6">
              {/* Zone Filter Tabs for Grid View */}
              <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 sm:p-5 rounded-[24px] border border-[#716053]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-[#716053] uppercase tracking-wider mr-1">場域分類：</span>
                  <button
                    onClick={() => setSelectedZoneFilter('all')}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold transition cursor-pointer ${
                      selectedZoneFilter === 'all'
                        ? 'bg-[#716053] text-white shadow-xs'
                        : 'bg-[#FAF6EE] text-slate-600 hover:bg-[#F5E6D0]/40'
                    }`}
                  >
                    全部場域 (All)
                  </button>

                  {Object.keys(ZONE_CONFIGS).map(zKey => {
                    const zConf = resolveZone(zKey);
                    return (
                      <button
                        key={zKey}
                        onClick={() => setSelectedZoneFilter(zKey)}
                        className={`px-4 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                          selectedZoneFilter === zKey
                            ? 'bg-[#716053] text-white shadow-xs'
                            : 'bg-[#FAF6EE] text-slate-600 hover:bg-[#F5E6D0]/40'
                        }`}
                      >
                        <span>{zConf.icon}</span>
                        <span>{zConf.name}</span>
                      </button>
                    );
                  })}
                </div>

                <span className="text-xs text-[#716053] font-semibold">
                  共 {filteredShifts.length} 個開放預約班次
                </span>
              </div>

              {/* Shift Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredShifts.map(shift => {
                  const zoneConf = resolveZone(shift.zone);
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
                          : 'border-[#716053]'
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
                            <span className="text-xs font-bold px-3 py-1 bg-[#716053] text-white rounded-full shadow-2xs">
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
                            <MapPin className="w-4 h-4 text-[#716053] shrink-0" />
                            <span className="font-bold text-slate-800">{shift.locationDetails}</span>
                          </div>

                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-[#716053] shrink-0" />
                            <span className="font-semibold text-[#716053]">
                              {shift.date} ({shift.timeRange})
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-[#716053] shrink-0" />
                            <span>需求與現有：{shift.currentCount} / {shift.requiredCount} 人</span>
                          </div>
                        </div>

                        {/* Tasks list */}
                        {shift.tasks && shift.tasks.length > 0 && (
                          <div className="bg-[#FFFDF7] p-3 rounded-2xl border border-slate-200 text-xs space-y-1">
                            <span className="font-bold text-[#716053] text-[11px] block">🐾 服務任務：</span>
                            {shift.tasks.map((task, idx) => (
                              <div key={idx} className="flex items-center gap-1.5 text-slate-700 text-xs">
                                <span className="text-amber-500 font-bold">•</span>
                                <span>{task}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Description */}
                        <p className="text-xs text-slate-600 bg-[#FAF6EE] p-3.5 rounded-2xl leading-relaxed border border-[#716053] font-sans">
                          {shift.description}
                        </p>

                        {/* Location trigger simulator */}
                        <div className="bg-[#FFFDF7] p-3.5 rounded-2xl border border-[#716053] text-xs space-y-1 font-sans">
                          <div className="flex items-center justify-between font-bold text-[#716053]">
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3.5 h-3.5 text-[#716053]" /> Google 地圖導航
                            </span>
                            <a
                              href={shelterLocation.googleMapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-[#716053] hover:underline flex items-center gap-0.5"
                            >
                              <span>打開 Google Maps</span>
                              <ArrowUpRight className="w-3 h-3" />
                            </a>
                          </div>
                          <p className="text-[11px] text-slate-600">
                            集合點：{shift.locationDetails} ({shelterLocation.address})
                          </p>
                        </div>

                      </div>

                      {/* Apply Button */}
                      <div className="mt-6 pt-4 border-t border-[#716053]">
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
                                className="w-full text-center text-xs text-[#716053] hover:text-[#3e3e2b] font-bold hover:underline py-1 cursor-pointer flex items-center justify-center gap-1"
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
                                : 'bg-[#716053] hover:bg-[#5A4A3F] text-white'
                            }`}
                          >
                            <Heart className="w-4 h-4 text-[#F5E6D0]" />
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
              </>
            );
          })()}
        </div>
      )}

      {/* Growth Tab Section */}
      {activePortalTab === 'growth' && (
        <div className="space-y-6 font-sans">
          
          {/* Header Banner */}
          <div className="bg-white rounded-[28px] p-6 border border-[#716053] shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-[#716053] text-white flex items-center justify-center shrink-0 shadow-xs">
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
                  className="px-3 py-2 bg-[#716053] hover:bg-[#5A4A3F] text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <Bell className="w-3.5 h-3.5 text-amber-300" />
                  <span>通知管理員審核</span>
                </button>
              )}
            </div>
          </div>

          {/* 志工成長軌跡 (Growth Pathway Card) */}
          <div className="bg-white rounded-[28px] p-6 border border-[#716053] shadow-xs space-y-6">
            
            {/* Progress Bar & Stage Milestones */}
            <div className="bg-[#FFFDF7] p-5 rounded-2xl border border-[#716053] space-y-4">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 font-bold text-slate-800">
                  <Award className="w-4 h-4 text-[#716053]" />
                  <span>晉升【資深志工】解鎖門檻進度：</span>
                  <span className="text-[#716053] text-sm font-extrabold">{growthProgressPercent}%</span>
                  <span className="text-slate-500 font-normal">({completedGrowthCount} / {totalGrowthCount} 項目達成)</span>
                </div>

                <div className="text-slate-500 font-medium text-[11px]">
                  目標：資深志工認證 🌟
                </div>
              </div>

              {/* Dynamic Progress Bar */}
              <div className="w-full bg-slate-200 h-3.5 rounded-full overflow-hidden p-0.5 shadow-inner relative">
                <div
                  className="bg-gradient-to-r from-[#716053] via-amber-600 to-amber-500 h-full rounded-full transition-all duration-500 shadow-xs"
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
                  <div className="w-8 h-8 rounded-full bg-[#716053] text-white flex items-center justify-center shrink-0 text-xs font-bold">
                    ★
                  </div>
                  <div className="text-xs">
                    <div className="font-bold text-slate-900">🌿 正式志工</div>
                    <div className="text-[10px] text-[#716053] font-bold">目前位階 (24h)</div>
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
              <div className={`rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in shadow-2xs border ${
                promotionStatus?.status === 'approved'
                  ? 'bg-amber-50 border-amber-300'
                  : promotionStatus?.status === 'rejected'
                  ? 'bg-rose-50 border-rose-300'
                  : 'bg-emerald-50 border-emerald-300'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full text-white flex items-center justify-center shrink-0 shadow-xs ${
                    promotionStatus?.status === 'approved'
                      ? 'bg-amber-500'
                      : promotionStatus?.status === 'rejected'
                      ? 'bg-rose-500'
                      : 'bg-emerald-500'
                  }`}>
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="font-bold text-emerald-950 text-sm flex items-center gap-1.5">
                      <span>
                        {promotionStatus?.status === 'approved'
                          ? '🏆 恭喜！管理員已審核通過您的『資深志工』晉升申請'
                          : promotionStatus?.status === 'rejected'
                          ? '📋 您的『資深志工』晉升申請尚未通過審核'
                          : '🎉 恭喜！您已 100% 達成『資深志工』晉升門檻'}
                      </span>
                    </h4>
                    <p className="text-xs text-emerald-800 mt-0.5">
                      {promotionStatus?.status === 'approved'
                        ? '✅ 您的志工等級已正式晉升為「資深志工」，感謝您的長期付出！'
                        : promotionStatus?.status === 'rejected'
                        ? `${promotionStatus?.reviewNote ? `管理員回覆：${promotionStatus.reviewNote}` : '請聯繫管理員了解詳情，或持續累積服務紀錄後再次提出申請。'}`
                        : hasAutoNotifiedAdmin
                        ? '✅ 已送出申請至社工管理員後台，等待審核中。管理員將審核並發放【資深志工】認證徽章。'
                        : '點擊下方按鈕將立即發送升級申請至管理員後台。'}
                    </p>
                  </div>
                </div>

                {promotionStatus?.status !== 'approved' && (
                  <button
                    type="button"
                    onClick={handleManualNotifyAdmin}
                    className="bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold px-4 py-2 rounded-xl text-xs transition flex items-center gap-1.5 shrink-0 shadow-2xs cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{hasAutoNotifiedAdmin ? '再次通知管理員審核' : '通知管理員審核'}</span>
                  </button>
                )}
              </div>
            )}

            {/* Assessment Checklist Items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold font-serif text-slate-900 text-sm flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-[#716053]" />
                  <span>『資深志工』晉升考核項目清單 (點擊項目切換完成狀態)</span>
                </h4>
                <span className="text-xs text-[#716053] font-bold bg-[#FAF6EE] px-3 py-1 rounded-full border border-[#716053]">
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
                        : 'bg-white border-slate-200 hover:border-[#716053] hover:bg-[#FAF6EE]/50'
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
          <div className="bg-white rounded-[28px] p-6 border border-[#716053] shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[#716053] text-white flex items-center justify-center shrink-0 shadow-xs">
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
            <div className="bg-white rounded-[28px] p-6 border border-[#716053] shadow-xs space-y-4">
              <div className="flex items-center gap-2 font-bold font-serif text-slate-900 border-b border-[#716053] pb-3 text-sm">
                <User className="w-4 h-4 text-[#716053]" />
                <span>志工預設基本資料</span>
              </div>

              {/* Avatar upload -- compressed to a small JPEG client-side (see
                  handleAvatarSelected) before ever hitting the network/disk. */}
              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  <img
                    src={pendingAvatar?.previewUrl || profileAvatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(profileName || '志工')}`}
                    alt="大頭照"
                    className="w-16 h-16 rounded-2xl object-cover border-2 border-[#716053] shadow-xs bg-[#FAF6EE]"
                  />
                  <label
                    className="absolute -bottom-1.5 -right-1.5 bg-[#716053] hover:bg-[#5A4A3F] text-white rounded-full p-1.5 shadow-xs cursor-pointer transition"
                    title="上傳大頭照"
                  >
                    <Camera className="w-3.5 h-3.5 text-amber-300" />
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => e.target.files?.[0] && handleAvatarSelected(e.target.files[0])}
                    />
                  </label>
                </div>
                <div className="text-[11px] text-slate-500">
                  <p className="font-bold text-[#716053]">大頭照</p>
                  <p>點擊右下角相機圖示更換，會自動壓縮成小檔案上傳。</p>
                  {pendingAvatar && <p className="text-amber-700 font-bold mt-0.5">已選好新照片，按下方「儲存」才會真的上傳。</p>}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#716053] mb-1">稱謂</label>
                <input
                  type="text"
                  required
                  value={profileName}
                  onChange={e => setProfileName(e.target.value)}
                  className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl text-xs font-medium focus:ring-2 focus:ring-[#716053] focus:outline-none"
                />
                <p className="text-[10px] text-slate-400 mt-1">預設帶入您的 LINE 顯示名稱（若尚未連結則帶入 Google 帳號名稱），也可自行修改。</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#716053] mb-1">行動電話</label>
                <input
                  type="tel"
                  placeholder="未有資料"
                  value={profilePhone}
                  onChange={e => setProfilePhone(e.target.value)}
                  className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl text-xs font-medium focus:ring-2 focus:ring-[#716053] focus:outline-none placeholder:text-slate-400"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#716053] mb-1">電子郵件</label>
                <input
                  type="email"
                  placeholder="未有資料"
                  value={profileEmail}
                  onChange={e => setProfileEmail(e.target.value)}
                  className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl text-xs font-medium focus:ring-2 focus:ring-[#716053] focus:outline-none placeholder:text-slate-400"
                />
              </div>

              <div>
                <label className="flex items-center gap-1 text-xs font-bold text-[#716053] mb-1">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
                  <span>緊急聯絡人</span>
                </label>
                <input
                  type="text"
                  placeholder="例：張太太 (配偶) 0933-221-101"
                  value={profileEmergencyContact}
                  onChange={e => setProfileEmergencyContact(e.target.value)}
                  className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl text-xs font-medium focus:ring-2 focus:ring-[#716053] focus:outline-none placeholder:text-slate-400"
                />
                <p className="text-[10px] text-slate-400 mt-1">發生意外時，社工督導會依此聯絡資訊通知您的家人。</p>
              </div>

              <div className="bg-[#FFFDF7] p-3 rounded-xl border border-[#716053] text-[11px] text-[#716053] space-y-2">
                <div className="font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{lineOfficialAccount?.displayName || '浪浪家園'} LINE 官方帳號</span>
                </div>
                <p className="text-slate-500">此資料在您報名班次時會自動填入，方便快捷完成線上預約。</p>
                {lineOfficialAccount && (
                  <a
                    href={`https://line.me/R/ti/p/${encodeURIComponent(lineOfficialAccount.basicId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 bg-[#06C755] hover:brightness-95 text-white font-bold px-3 py-1.5 rounded-full transition"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>加入好友（{lineOfficialAccount.basicId}）</span>
                  </a>
                )}
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
                <button
                  type="button"
                  onClick={() => {
                    startLineBinding(profileEmail).catch(err =>
                      onSendLineToast(`⚠️ 無法開啟 LINE 授權：${err.message || '請稍後再試'}`)
                    );
                  }}
                  className="inline-flex items-center gap-1.5 bg-[#06C755] hover:brightness-95 text-white font-bold text-xs px-3.5 py-2 rounded-full transition cursor-pointer"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>{lineLinkStatus?.linked ? '重新連結 LINE 帳號' : '連結真實 LINE 帳號'}</span>
                </button>
              </div>
            </div>

            {/* Right 2 Columns: LINE Notification Preferences & Test Push */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* LINE Notification Preferences Box */}
              <div className="bg-white rounded-[28px] p-6 border border-[#716053] shadow-xs space-y-5">
                <div className="flex items-center justify-between border-b border-[#716053] pb-3 gap-3 flex-wrap">
                  <div className="flex items-center gap-2 font-bold font-serif text-slate-900 text-sm">
                    <Bell className="w-4.5 h-4.5 text-amber-600" />
                    <span>『LINE 通知偏好』切換選項</span>
                  </div>

                  <button
                    type="submit"
                    className="bg-[#716053] hover:bg-[#5A4A3F] text-white font-extrabold px-5 py-2 rounded-full text-xs shadow-md transition flex items-center gap-1.5 cursor-pointer shrink-0"
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
                  <div className="bg-[#FAF6EE]/80 hover:bg-[#FAF6EE] p-4 rounded-2xl border border-[#716053] flex items-start justify-between gap-4 transition">
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

                  {/* Toggle: 社工回覆我的服務回饋 */}
                  <div className="bg-[#FAF6EE]/80 hover:bg-[#FAF6EE] p-4 rounded-2xl border border-[#716053] flex items-start justify-between gap-4 transition">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base">💬</span>
                        <span className="font-bold text-slate-900 text-sm">社工回覆我的服務回饋</span>
                        {linePreferences.feedbackReply !== false ? (
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
                        您在服務結束後留下的評分與建議，社工團隊讀過並親自回覆時，發送 LINE 訊息通知您。
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleTogglePreference('feedbackReply')}
                      className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 mt-1 ${
                        linePreferences.feedbackReply !== false ? 'bg-emerald-500' : 'bg-slate-300'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow-xs absolute top-0.5 transition-transform ${
                        linePreferences.feedbackReply !== false ? 'right-0.5' : 'left-0.5'
                      }`} />
                    </button>
                  </div>

                  {/* Toggle 2: 緊急招募 */}
                  <div className="bg-[#FAF6EE]/80 hover:bg-[#FAF6EE] p-4 rounded-2xl border border-[#716053] flex items-start justify-between gap-4 transition">
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
                  <div className="bg-[#FAF6EE]/80 hover:bg-[#FAF6EE] p-4 rounded-2xl border border-[#716053] flex items-start justify-between gap-4 transition">
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
                            className="p-1.5 bg-white border border-[#716053] rounded-xl text-xs font-bold text-[#716053]"
                          >
                            <option value={1}>出班前 1 小時</option>
                            <option value={2}>出班前 2 小時</option>
                            <option value={12}>出班前 12 小時</option>
                            <option value={24}>出班前 24 小時</option>
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

                  {/* Toggle 4: 簽到後的教材提醒 */}
                  <div className="bg-[#FAF6EE]/80 hover:bg-[#FAF6EE] p-4 rounded-2xl border border-[#716053] flex items-start justify-between gap-4 transition">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base">📖</span>
                        <span className="font-bold text-slate-900 text-sm">簽到後附上教材提醒</span>
                        {linePreferences.sopReminder !== false ? (
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
                        簽到成功後，LINE 會列出您今天班次場域的工作內容。
                        這個開關控制的是<strong>要不要一併提醒哪幾項有出勤前教材</strong>——
                        <strong className="text-slate-800">工作內容本身一定會列出</strong>，那是您今天來做的事。
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleTogglePreference('sopReminder')}
                      className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 mt-1 ${
                        linePreferences.sopReminder !== false ? 'bg-emerald-500' : 'bg-slate-300'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow-xs absolute top-0.5 transition-transform ${
                        linePreferences.sopReminder !== false ? 'right-0.5' : 'left-0.5'
                      }`} />
                    </button>
                  </div>

                  {/* Toggle 5: 本週動物狀態 -- the only one that starts off */}
                  <div className="bg-[#FAF6EE]/80 hover:bg-[#FAF6EE] p-4 rounded-2xl border border-[#716053] flex items-start justify-between gap-4 transition">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🐾</span>
                        <span className="font-bold text-slate-900 text-sm">本週動物狀態提醒</span>
                        {linePreferences.animalStatusAlerts === true ? (
                          <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                            已開啟 (ON)
                          </span>
                        ) : (
                          <span className="bg-slate-200 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                            預設關閉 (OFF)
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        收容所主系統每天回報動物狀況。開啟後，這裡會列出<strong>本週需要多留意的動物</strong>，
                        LINE 也會一併通知。
                        <strong className="text-slate-800">一切正常時完全不會發訊息</strong>——
                        每週固定跳出來的通知，久了就沒有人在看了。
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleTogglePreference('animalStatusAlerts')}
                      className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 mt-1 ${
                        linePreferences.animalStatusAlerts === true ? 'bg-emerald-500' : 'bg-slate-300'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow-xs absolute top-0.5 transition-transform ${
                        linePreferences.animalStatusAlerts === true ? 'right-0.5' : 'left-0.5'
                      }`} />
                    </button>
                  </div>

                </div>
              </div>

              {/* ---------------------------------------------------------------
                  本週動物狀態
                  Only rendered once the volunteer has opted in. The server
                  decides what counts as needing attention -- a status the
                  shelter priced above zero minutes -- so nothing here is this
                  component's judgement about an animal.
                  --------------------------------------------------------------- */}
              {linePreferences.animalStatusAlerts === true && (
                <div className="bg-white rounded-[28px] p-6 border border-[#716053] space-y-3">
                  <div className="flex items-center gap-2 text-slate-900 font-bold font-serif text-sm">
                    <span className="text-base">🐾</span>
                    <span>本週需要留意的動物</span>
                  </div>

                  {animalConcernsLoading ? (
                    <p className="text-xs text-slate-500">讀取中…</p>
                  ) : animalConcerns.length === 0 ? (
                    <div className="bg-emerald-50/70 rounded-2xl p-4 border border-emerald-200">
                      <p className="text-sm font-bold text-emerald-900">本週目前沒有需要特別留意的動物。</p>
                      <p className="text-xs text-emerald-800 mt-1 leading-relaxed">
                        這是好消息，不是還沒載入。狀況正常時這裡就是空的，LINE 也不會發任何訊息。
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {animalConcerns.map((c, i) => (
                        <div key={`${c.animalName}-${c.optionLabel}-${i}`}
                          className="bg-[#FAF6EE]/80 rounded-2xl px-4 py-3 border border-[#716053]">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-900 text-sm">{c.animalName || '（未命名）'}</span>
                            {c.shelterNumber && (
                              <span className="text-[10px] text-slate-400">{c.shelterNumber}</span>
                            )}
                            <span className="bg-amber-100 text-amber-900 text-[10px] font-bold px-2 py-0.5 rounded-full">
                              {c.optionLabel}
                            </span>
                            {c.requiredTier && (
                              <span className="bg-sky-100 text-sky-900 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                需 {c.requiredTier}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 mt-1">
                            要做的事：{c.dutyTitle}
                          </p>
                        </div>
                      ))}
                      <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
                        以上由收容所設定的「狀態 → 勤務」對照表判定，不是 AI 判斷的。
                        覺得哪一項不合理，可以直接跟社工反映。
                      </p>
                    </div>
                  )}
                </div>
              )}

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
        <div className="fixed inset-0 z-50 bg-[#716053]/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-[32px] max-w-lg w-full shadow-2xl p-6 sm:p-8 border border-[#716053] space-y-5 my-8">
            
            <div className="flex items-center justify-between border-b border-[#716053] pb-3">
              <div>
                <h3 className="font-bold font-serif text-lg text-slate-900">
                  🐾 線上登記報名 - 志工班次
                </h3>
                <p className="text-xs text-[#716053] font-sans mt-0.5">{activeShiftForApply.title}</p>
              </div>
              <button
                onClick={() => setActiveShiftForApply(null)}
                className="text-slate-400 hover:text-[#716053] font-bold text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            {submittedSuccess ? (
              <div className="py-12 text-center space-y-4 font-sans">
                <CheckCircle2 className="w-12 h-12 text-[#716053] mx-auto animate-bounce" />
                <h4 className="font-bold text-lg font-serif italic text-[#716053]">報名資料已成功送出！</h4>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  社工審核後將透過 LINE 機器人自動發送提醒通知。
                </p>
                <a
                  href={buildGoogleCalendarLink({
                    title: `🐾 志工班次：${activeShiftForApply.title}`,
                    date: activeShiftForApply.date,
                    timeRange: activeShiftForApply.timeRange,
                    location: activeShiftForApply.locationDetails || '浪浪家園',
                    details: `浪浪家園志工服務班次\n任務：${(activeShiftForApply.tasks || []).join('、')}`
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-[#716053] hover:bg-[#5A4A3F] text-white font-bold text-xs px-5 py-2.5 rounded-full shadow-xs transition cursor-pointer"
                >
                  <Calendar className="w-4 h-4 text-amber-300" />
                  <span>加入 Google 日曆</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </a>
              </div>
            ) : (
              <form onSubmit={handleConfirmApply} className="space-y-4 text-xs font-sans">
                
                <div>
                  <label className="block font-bold text-[#716053] mb-1">您的真實姓名</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="例如：林小明"
                    className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl focus:ring-2 focus:ring-[#716053] focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-bold text-[#716053] mb-1">電話號碼</label>
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="0912-345-678"
                      className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl focus:ring-2 focus:ring-[#716053] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-[#716053] mb-1">LINE ID (推播提醒用)</label>
                    <input
                      type="text"
                      required
                      value={lineId}
                      onChange={e => setLineId(e.target.value)}
                      placeholder="e.g. xiaoming_line"
                      className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl focus:ring-2 focus:ring-[#716053] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-[#716053] mb-1">電子郵件 Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="xiaoming@gmail.com"
                    className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl focus:ring-2 focus:ring-[#716053] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold text-[#716053] mb-1">過去志工經驗或特別說明 (選填)</label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="家中養貓3年，熟悉貓砂清潔與親人安撫..."
                    rows={3}
                    className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl focus:ring-2 focus:ring-[#716053] focus:outline-none"
                  />
                </div>

                <div className="p-4 bg-white border border-[#716053] rounded-2xl space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#716053]">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AI 情境準備度小測驗（選填，僅供社工參考，不影響報名）</span>
                  </div>

                  {isLoadingQuestion ? (
                    <p className="text-[11px] text-slate-500">Gemini 正在為這個班次出情境題...</p>
                  ) : situationalQuestion ? (
                    <>
                      <p className="text-xs text-slate-700 bg-[#FAF6EE] p-3 rounded-xl leading-relaxed">
                        {situationalQuestion}
                      </p>
                      <textarea
                        value={situationalAnswer}
                        onChange={e => { setSituationalAnswer(e.target.value); setAiAssessment(null); }}
                        placeholder="想到什麼就寫什麼，沒有標準答案～"
                        rows={2}
                        className="w-full p-3 bg-[#FAF6EE] border border-[#716053] rounded-2xl focus:ring-2 focus:ring-[#716053] focus:outline-none text-xs"
                      />

                      {aiAssessment ? (
                        <div className="p-3 bg-[#F5E6D0]/40 border border-[#716053] rounded-xl text-[11px] text-[#716053] space-y-1">
                          <p className="font-bold">💬 AI 小回饋：{aiAssessment.feedback}</p>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleAssessSituationalAnswer(activeShiftForApply)}
                          disabled={!situationalAnswer.trim() || isAssessing}
                          className="text-[11px] font-bold text-[#716053] hover:underline disabled:opacity-40 disabled:hover:no-underline cursor-pointer"
                        >
                          {isAssessing ? 'AI 思考中...' : '請 AI 幫我看看這個回答 →'}
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="text-[11px] text-slate-400">這次沒有出題，直接送出報名即可。</p>
                  )}
                </div>

                <div className="p-3.5 bg-[#FAF6EE] border border-[#716053] rounded-2xl text-[11px] text-[#716053] space-y-1">
                  <p className="font-bold">✨ 自動整合叮嚀：</p>
                  <p>• 系統將自動把《園區 Google Maps 定位》嵌入您的預約卡片。</p>
                  <p>• 錄取後 LINE 機器人會於出班前 1 小時發送導航提醒小幫手。</p>
                </div>

                <div className="pt-2 flex justify-end space-x-3 border-t border-[#716053]">
                  <button
                    type="button"
                    onClick={() => setActiveShiftForApply(null)}
                    className="px-5 py-2.5 rounded-full font-bold text-slate-600 hover:bg-[#FAF6EE] cursor-pointer"
                  >
                    取消
                  </button>

                  <button
                    type="submit"
                    className="px-6 py-2.5 rounded-full font-bold bg-[#716053] hover:bg-[#5A4A3F] text-white shadow-xs cursor-pointer"
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
