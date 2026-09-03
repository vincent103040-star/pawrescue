import React, { useState, useEffect, Suspense } from 'react';
import { PositionShift, ShiftSignup, ShelterLocation, AttendanceRecord } from '../types';
import { AlertCircle, CheckCircle2, Users, Calendar, MapPin, ArrowRight, ShieldAlert, Sparkles, Filter, Eye, ChevronRight, QrCode, LogOut, Send, Zap, FileSpreadsheet, FileText, Download, Building2, Clock, BarChart3, Star, Smartphone, MessageSquare, ThumbsUp, Search, RefreshCw, SlidersHorizontal, LayoutGrid, EyeOff, Megaphone } from 'lucide-react';
import { DashboardModuleCard } from './DashboardModuleCard';
import { lazyScreen } from './lazyScreen';
import { calculateShiftDurationHours } from '../utils/shiftHours';
import { authFetch } from '../utils/session';
import { resolveZone } from '../data/zones';
import { 
  DashboardModuleCustomizer, 
  DashboardModuleId, 
  DEFAULT_VISIBLE_MODULES, 
  DEFAULT_COLLAPSED_MODULES,
  DASHBOARD_MODULE_CONFIGS
} from './DashboardModuleCustomizer';

// 看板最重的五塊，改成用到才載入。
//
// 三個模組多半是關著的（熱力圖、AI 預測地圖、月報預設就不顯示），兩個 modal 要
// 點了才會開，但在這之前它們全都躺在主 bundle 裡，每個開啟看板的人都得先下載。
// 熱力圖還帶著 d3。
//
// 月報那個之所以切得出去，是因為 calculateShiftDurationHours 先被搬到
// utils/shiftHours。只要這裡還從 MonthlyReportModal import 任何東西——哪怕只是
// 一個純函式——整個檔案就會留在主 bundle，lazy 會安靜地失效。
const HeatmapChart = lazyScreen(() => import('./HeatmapChart').then(m => ({ default: m.HeatmapChart })));
const ResourceWarningMap = lazyScreen(() => import('./ResourceWarningMap').then(m => ({ default: m.ResourceWarningMap })));
const DailyDutyTaskboard = lazyScreen(() => import('./DailyDutyTaskboard').then(m => ({ default: m.DailyDutyTaskboard })));
const UrgentShortageModal = lazyScreen(() => import('./UrgentShortageModal').then(m => ({ default: m.UrgentShortageModal })));
const MonthlyReportModal = lazyScreen(() => import('./MonthlyReportModal').then(m => ({ default: m.MonthlyReportModal })));

/**
 * 模組載入中的佔位。
 *
 * 邊框和圓角刻意跟 DashboardModuleCard 一致，讓載入完成的那一刻只是內容填進來，
 * 而不是整個版面往下跳。
 */
const ModuleLoading: React.FC = () => (
  <div className="bg-white rounded-[32px] border border-[#716053] p-10 flex items-center justify-center gap-2 text-xs text-slate-400 font-sans">
    <RefreshCw className="w-4 h-4 animate-spin" />
    <span>載入模組中...</span>
  </div>
);

interface DashboardProps {
  shifts: PositionShift[];
  shiftSignups: ShiftSignup[];
  shelterLocation: ShelterLocation;
  attendanceRecords?: AttendanceRecord[];
  onNavigateToTab: (tab: 'dashboard' | 'positions' | 'signups' | 'portal' | 'roster') => void;
  onApplyForShift: (shiftId: string) => void;
  onOpenCheckInModal?: () => void;
  checkedInCount?: number;
  onSendLineToast?: (msg: string) => void;
  /** Lets App re-pull attendance after feedback is marked as taken up. */
  onAttendanceChanged?: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  shifts,
  shiftSignups,
  shelterLocation,
  attendanceRecords = [],
  onNavigateToTab,
  onApplyForShift,
  onOpenCheckInModal,
  checkedInCount = 0,
  onSendLineToast = (_msg?: string) => {},
  onAttendanceChanged = () => {}
}) => {
  const [selectedDateFilter, setSelectedDateFilter] = useState<'all' | 'today' | 'upcoming'>('all');
  const [showUrgentModal, setShowUrgentModal] = useState<boolean>(false);
  const [showReportModal, setShowReportModal] = useState<boolean>(false);
  const [selectedExportMonth, setSelectedExportMonth] = useState<string>('2026-08');

  // Modular Dashboard Controls State
  const [visibleModules, setVisibleModules] = useState<Record<DashboardModuleId, boolean>>(() => {
    try {
      const saved = localStorage.getItem('pet_shelter_dashboard_visible_modules');
      if (saved) {
        return { ...DEFAULT_VISIBLE_MODULES, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.error(e);
    }
    return DEFAULT_VISIBLE_MODULES;
  });

  const [collapsedModules, setCollapsedModules] = useState<Record<DashboardModuleId, boolean>>(() => {
    try {
      const saved = localStorage.getItem('pet_shelter_dashboard_collapsed_modules');
      if (saved) {
        return { ...DEFAULT_COLLAPSED_MODULES, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.error(e);
    }
    return DEFAULT_COLLAPSED_MODULES;
  });

  // Sync to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('pet_shelter_dashboard_visible_modules', JSON.stringify(visibleModules));
    } catch (e) {
      console.error(e);
    }
  }, [visibleModules]);

  useEffect(() => {
    try {
      localStorage.setItem('pet_shelter_dashboard_collapsed_modules', JSON.stringify(collapsedModules));
    } catch (e) {
      console.error(e);
    }
  }, [collapsedModules]);

  // Real LINE broadcast composer state (moved here from IntegrationHub -- lives
  // directly under the key-metrics overview card now instead of a separate tab).
  const [broadcastText, setBroadcastText] = useState('');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleSendBroadcast = async () => {
    if (!broadcastText.trim()) return;
    setIsBroadcasting(true);
    setBroadcastResult(null);
    try {
      const res = await authFetch('/api/line/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: broadcastText })
      });
      const data = await res.json();
      if (!data.success) {
        setBroadcastResult({ ok: false, msg: data.error || '發送失敗' });
      } else if (data.isFallback) {
        setBroadcastResult({ ok: false, msg: data.note });
      } else {
        setBroadcastResult({ ok: true, msg: '✅ 已成功發送給所有加此官方帳號好友的志工！' });
        setBroadcastText('');
      }
    } catch (err: any) {
      setBroadcastResult({ ok: false, msg: err.message || '發送失敗，請確認網路連線' });
    } finally {
      setIsBroadcasting(false);
    }
  };

  // Modular Handlers
  const handleToggleModuleVisibility = (id: DashboardModuleId) => {
    setVisibleModules(prev => {
      const next = { ...prev, [id]: !prev[id] };
      const config = DASHBOARD_MODULE_CONFIGS.find(c => c.id === id);
      onSendLineToast(`⚙️ 已${next[id] ? '開啟顯示' : '隱藏'}模組：【${config?.name || id}】`);
      return next;
    });
  };

  const handleToggleModuleCollapse = (id: DashboardModuleId) => {
    setCollapsedModules(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleHideModule = (id: DashboardModuleId) => {
    setVisibleModules(prev => ({ ...prev, [id]: false }));
    const config = DASHBOARD_MODULE_CONFIGS.find(c => c.id === id);
    onSendLineToast(`👁️ 已隱藏【${config?.name || id}】（可隨時於自訂模組選單中重新開啟）`);
  };

  const handleShowAllModules = () => {
    const allVis = Object.keys(DEFAULT_VISIBLE_MODULES).reduce((acc, k) => {
      acc[k as DashboardModuleId] = true;
      return acc;
    }, {} as Record<DashboardModuleId, boolean>);
    setVisibleModules(allVis);
    onSendLineToast('✅ 已開啟看板全部 7 大功能模組顯示');
  };

  const handleCollapseAll = () => {
    const allCol = Object.keys(DEFAULT_COLLAPSED_MODULES).reduce((acc, k) => {
      acc[k as DashboardModuleId] = true;
      return acc;
    }, {} as Record<DashboardModuleId, boolean>);
    setCollapsedModules(allCol);
    onSendLineToast('📁 已全部折疊收合為精簡摘要模式');
  };

  const handleExpandAll = () => {
    const allExp = Object.keys(DEFAULT_COLLAPSED_MODULES).reduce((acc, k) => {
      acc[k as DashboardModuleId] = false;
      return acc;
    }, {} as Record<DashboardModuleId, boolean>);
    setCollapsedModules(allExp);
    onSendLineToast('📖 已全部展開看板模組完整視圖');
  };

  const handleResetModules = () => {
    setVisibleModules(DEFAULT_VISIBLE_MODULES);
    setCollapsedModules(DEFAULT_COLLAPSED_MODULES);
    onSendLineToast('🔄 已重置看板模組至預設顯示配置');
  };

  const handleApplyPreset = (preset: 'all' | 'focus_schedule' | 'focus_operations') => {
    if (preset === 'all') {
      handleShowAllModules();
      return;
    }
    const presetVisible: Record<'focus_schedule' | 'focus_operations', DashboardModuleId[]> = {
      focus_schedule: ['overview_stats', 'heatmap', 'ai_warning_map', 'zone_shortage'],
      focus_operations: ['overview_stats', 'daily_duty', 'monthly_report', 'feedback_hub']
    };
    const shown = new Set(presetVisible[preset]);
    const next = Object.keys(DEFAULT_VISIBLE_MODULES).reduce((acc, k) => {
      acc[k as DashboardModuleId] = shown.has(k as DashboardModuleId);
      return acc;
    }, {} as Record<DashboardModuleId, boolean>);
    setVisibleModules(next);
    onSendLineToast(preset === 'focus_schedule' ? '🎯 已切換為排班分析專注模式' : '📋 已切換為現場營運專注模式');
  };

  // Feedback Hub state
  const [feedbackRatingFilter, setFeedbackRatingFilter] = useState<'all' | '5' | '4' | 'low'>('all');
  const [feedbackSearchTerm, setFeedbackSearchTerm] = useState<string>('');
  // Which rows have a request in flight. Whether feedback *is* acknowledged is
  // not tracked here any more -- it comes from the record itself, so it
  // survives a reload and is the same for every coordinator looking at it.
  const [savingFeedbackIds, setSavingFeedbackIds] = useState<string[]>([]);

  const toggleFeedbackAcknowledged = async (record: AttendanceRecord) => {
    const next = !record.feedbackAcknowledgedAt;
    setSavingFeedbackIds(prev => [...prev, record.id]);
    try {
      const res = await authFetch(`/api/admin/attendance/${encodeURIComponent(record.id)}/feedback-acknowledged`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledged: next })
      });
      const data = await res.json();
      if (!data.success) {
        onSendLineToast(`⚠️ ${data.error || '更新失敗'}`);
        return;
      }
      onAttendanceChanged();
      if (next) {
        onSendLineToast(`💬 已將【${record.volunteerName}】之建議註記為社工團隊參採與歸檔！`);
      }
    } catch {
      onSendLineToast('⚠️ 無法連線，參採狀態尚未儲存。');
    } finally {
      setSavingFeedbackIds(prev => prev.filter(i => i !== record.id));
    }
  };

  // 回覆一則回饋：正在回哪一筆、草稿內容，以及兩種各自進行中的狀態。
  // 刻意和「已參採」分開：社工常常想標記讀過但不打算回（純好評回什麼都是廢話），
  // 也可能想回但還沒決定採不採納。綁成同一個動作會逼人每次都面對一個對話框，
  // 久了就固定按跳過。
  const [replyTarget, setReplyTarget] = useState<AttendanceRecord | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [isDraftingReply, setIsDraftingReply] = useState(false);
  const [isSendingReply, setIsSendingReply] = useState(false);

  /** 把伺服器回報的未送達原因，翻成社工看得懂的一句話。 */
  const replyDeliveryNote = (reason?: string) => {
    if (reason === 'preference-off') return '該志工已關閉此類通知';
    if (reason === 'not-linked') return '該志工尚未綁定 LINE';
    if (reason === 'no-token') return '系統尚未設定 LINE Token';
    return '推播未成功';
  };

  /**
   * 向 AI 要一份草稿填進編輯框。
   *
   * 失敗不擋路：伺服器在沒有金鑰或 Gemini 出錯時本來就會回一份罐頭範本，真的
   * 連不上就讓社工自己寫。這個框的重點是「有人讀過並回話」，草稿只是省下
   * 開頭那句的力氣，不是這件事的必要條件。
   */
  const draftReplyWithAi = async (record: AttendanceRecord) => {
    setIsDraftingReply(true);
    try {
      const res = await authFetch('/api/ai/generate-feedback-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          volunteerName: record.volunteerName,
          shiftTitle: record.shiftTitle,
          zoneName: resolveZone(record.zone).name,
          rating: record.rating,
          feedbackComment: record.feedbackComment
        })
      });
      const data = await res.json().catch(() => ({} as any));
      if (data?.success && data.replyContent) {
        setReplyDraft(data.replyContent);
      } else {
        onSendLineToast('⚠️ AI 草稿產生失敗，請直接輸入回覆內容。');
      }
    } catch {
      onSendLineToast('⚠️ 無法連線取得 AI 草稿，請直接輸入回覆內容。');
    } finally {
      setIsDraftingReply(false);
    }
  };

  const openReplyModal = (record: AttendanceRecord) => {
    setReplyTarget(record);
    // 回過的就把原文帶出來，讓社工看得到自己上次說了什麼，再決定要不要補充。
    setReplyDraft(record.feedbackReplyText || '');
    if (!record.feedbackReplyText) void draftReplyWithAi(record);
  };

  const sendReply = async () => {
    if (!replyTarget) return;
    const text = replyDraft.trim();
    if (!text) return;

    setIsSendingReply(true);
    try {
      const res = await authFetch(`/api/admin/attendance/${encodeURIComponent(replyTarget.id)}/feedback-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replyText: text })
      });
      const data = await res.json().catch(() => ({} as any));
      if (!data?.success) {
        onSendLineToast(`⚠️ ${data?.error || '回覆未能送出，請重新整理後再試一次。'}`);
        return;
      }

      const who = replyTarget.volunteerName;
      onAttendanceChanged();
      setReplyTarget(null);
      setReplyDraft('');

      // 「存下來了」和「送到了」是兩件事，分開講。志工可能關掉了這類通知、或還
      // 沒綁 LINE —— 那時回覆仍然留在紀錄上，只是沒有推播出去，社工該知道差別。
      onSendLineToast(
        data.delivered
          ? `💬 已回覆【${who}】，並透過 LINE 送達。`
          : `💬 已回覆【${who}】並存入紀錄，但未送出 LINE（${replyDeliveryNote(data.deliveryReason)}）。`
      );
    } catch {
      onSendLineToast('⚠️ 無法連線，回覆尚未送出。');
    } finally {
      setIsSendingReply(false);
    }
  };

  const todayStr = new Date().toISOString().split('T')[0];

  // Export CSV Helper Function
  const handleDirectExportCSV = (monthToExport: string) => {
    const monthShifts = shifts.filter(s => s.date.startsWith(monthToExport));
    const csvRows: string[] = [];

    const [yStr, mStr] = monthToExport.split('-');
    const formattedMonth = `${yStr} 年 ${mStr} 月`;

    // Overall monthly stats (single shelter, no more per-branch breakdown)
    const totalShiftsCount = monthShifts.length;
    const requiredCount = monthShifts.reduce((acc, s) => acc + s.requiredCount, 0);
    const filledCount = monthShifts.reduce((acc, s) => acc + s.currentCount, 0);
    const shortageCount = Math.max(0, requiredCount - filledCount);
    const shortageRate = requiredCount > 0 ? Math.round((shortageCount / requiredCount) * 100) : 0;

    const monthShiftIds = new Set(monthShifts.map(s => s.id));
    const monthApps = shiftSignups.filter(a => monthShiftIds.has(a.shiftId));
    const uniqueVols = new Set(monthApps.map(a => a.volunteerName || a.lineId)).size;
    const totalVolunteers = Math.max(uniqueVols, filledCount);

    const totalCompletedHours = Math.round(monthShifts.reduce((acc, s) => {
      const shiftHours = calculateShiftDurationHours(s.timeRange);
      return acc + (s.currentCount * shiftHours);
    }, 0));

    let statusLabel = '排班優良';
    if (shortageRate > 30) statusLabel = '嚴重缺工';
    else if (shortageRate > 10) statusLabel = '人力微緊';

    // Title rows
    csvRows.push(`"流浪動物之家人力排班 - ${formattedMonth}月度績效與缺工率統計總結"`);
    csvRows.push(`"匯出時間: ${new Date().toLocaleString('zh-TW')}"`);
    csvRows.push(`"當月缺工率: ${shortageRate}%", "當月總志工數: ${totalVolunteers}人", "當月完成總時數: ${totalCompletedHours}小時"`);
    csvRows.push('');

    // Headers
    csvRows.push('"園區名稱","統計月份","當月總班次數","需求志工人數","已報名人數","缺工人數","缺工率(%)","總完成服務時數(小時)","運作評估"');

    csvRows.push(`"${shelterLocation.name}","${monthToExport}","${totalShiftsCount}","${requiredCount}","${filledCount}","${shortageCount}","${shortageRate}%","${totalCompletedHours}","${statusLabel}"`);

    const csvContent = '\uFEFF' + csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `動物之家_月度據點績效總結_${monthToExport}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    onSendLineToast(`📊 已匯出「${formattedMonth}」月度各據點績效總結 CSV 報表！`);
  };

  // Filter shifts based on date
  const filteredShifts = shifts.filter(shift => {
    if (selectedDateFilter === 'today' && shift.date !== todayStr) return false;
    if (selectedDateFilter === 'upcoming' && shift.date < todayStr) return false;
    return true;
  });

  // Calculate statistics
  const totalRequired = filteredShifts.reduce((acc, s) => acc + s.requiredCount, 0);
  const totalFilled = filteredShifts.reduce((acc, s) => acc + s.currentCount, 0);
  const totalGap = totalRequired - totalFilled;
  const fillRate = totalRequired > 0 ? Math.round((totalFilled / totalRequired) * 100) : 100;

  // Filter shifts where shortage rate > 50%
  const urgentShortageShifts = filteredShifts.filter(s => {
    if (s.requiredCount === 0) return false;
    return (s.requiredCount - s.currentCount) / s.requiredCount > 0.5;
  });

  // 尚未補滿人力的班次。清單本身、模組的徽章與收合摘要都讀這一份，免得同一個
  // 條件寫三次然後各自漂移 —— 那種不一致沒有錯誤訊息，只會讓徽章上的數字跟底下
  // 列出來的筆數對不起來。
  const understaffedShifts = filteredShifts.filter(s => s.requiredCount > s.currentCount);
  const totalMissingPeople = understaffedShifts.reduce(
    (acc, s) => acc + (s.requiredCount - s.currentCount),
    0
  );

  const pendingApps = shiftSignups.filter(a => a.status === 'pending');

  return (
    <div className="bg-[#FAF6EE] min-h-screen py-6 px-4 sm:px-6 lg:px-8 space-y-8 max-w-7xl mx-auto">
      
      {/* Hero Welcome Banner */}
      <div className="bg-[#716053] rounded-[32px] p-6 sm:p-8 text-white shadow-md relative overflow-hidden border border-[#716053]">
        <div className="absolute right-0 top-0 bottom-0 opacity-10 flex items-center pointer-events-none pr-8">
          <span className="text-[180px]">🐾</span>
        </div>
        
        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="inline-flex items-center space-x-2 bg-white/15 backdrop-blur-xs px-3.5 py-1 rounded-full text-xs font-semibold text-[#F5E6D0]">
            <Sparkles className="w-3.5 h-3.5 text-amber-200" />
            <span className="font-sans uppercase tracking-wider">流浪動物之家人力即時控制台</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold font-serif italic tracking-tight text-white">
            今日缺工即時數據看板 &amp; 據點色標管理
          </h2>
          <p className="text-[#F5E6D0] text-sm leading-relaxed font-sans">
            串聯 Google 地圖場域定位、Google 日曆色彩分類與 LINE 班表提醒。為社工與志工隊長打造最省時、最直覺的排班指揮中心。
          </p>

          <div className="pt-2 flex flex-wrap gap-3">
            <button
              onClick={() => setShowUrgentModal(true)}
              className="bg-rose-500 hover:bg-rose-600 text-white font-extrabold px-5 py-2.5 rounded-full text-xs shadow-md transition flex items-center gap-2 cursor-pointer transform hover:scale-105"
            >
              <Send className="w-4 h-4 text-amber-200 fill-amber-200" />
              <span>🚨 缺工自動發送 (LINE 預覽)</span>
              {urgentShortageShifts.length > 0 && (
                <span className="bg-white text-rose-800 px-2 py-0.5 rounded-full text-[10px] font-extrabold">
                  {urgentShortageShifts.length} 班缺額 &gt; 50%
                </span>
              )}
            </button>

            {onOpenCheckInModal && (
              <button
                onClick={onOpenCheckInModal}
                className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-extrabold px-5 py-2.5 rounded-full text-xs shadow-md transition flex items-center gap-2 cursor-pointer transform hover:scale-105"
              >
                <QrCode className="w-4 h-4 text-slate-950" />
                <span>📱 志工 LINE 掃碼簽到 / 離場核銷</span>
                {checkedInCount > 0 && (
                  <span className="bg-slate-950 text-emerald-400 px-2 py-0.5 rounded-full text-[10px] font-mono">
                    {checkedInCount}人在場
                  </span>
                )}
              </button>
            )}

            <button
              onClick={() => setShowReportModal(true)}
              className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold px-5 py-2.5 rounded-full text-xs shadow-md transition flex items-center gap-2 cursor-pointer transform hover:scale-105"
            >
              <FileSpreadsheet className="w-4 h-4 text-slate-950" />
              <span>📊 匯出月度據點績效 (CSV/PDF)</span>
            </button>

            <button
              onClick={() => onNavigateToTab('portal')}
              className="bg-white text-[#716053] hover:bg-[#F5E6D0] px-5 py-2.5 rounded-full font-bold text-xs shadow-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>🐾 模擬志工視角報名</span>
              <ArrowRight className="w-4 h-4" />
            </button>

          </div>
        </div>
      </div>

      {/* Quick Check-in Prompt Bar */}
      {onOpenCheckInModal && (
        <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-[24px] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h4 className="font-bold text-emerald-900 text-sm">LINE 掃碼簽到與離場核銷模組</h4>
                <span className="text-[10px] bg-emerald-200 text-emerald-900 font-extrabold px-2 py-0.5 rounded-full">
                  即時時數紀錄
                </span>
              </div>
              <p className="text-xs text-emerald-700 mt-0.5">
                志工到場掃描 LINE QR Code 即完成『抵達簽到』與『離場簽退』，自動核銷計算服務時數！
              </p>
            </div>
          </div>
          <button
            onClick={onOpenCheckInModal}
            className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs px-5 py-2.5 rounded-full shadow-xs transition flex items-center gap-1.5 shrink-0 self-start sm:self-auto cursor-pointer"
          >
            <QrCode className="w-4 h-4" />
            <span>開啟 LINE 掃碼簽到界面</span>
          </button>
        </div>
      )}

      {/* 🎛️ 自訂模組開關選單與隨手折疊控制列 */}
      <DashboardModuleCustomizer
        visibleModules={visibleModules}
        collapsedModules={collapsedModules}
        onToggleModuleVisibility={handleToggleModuleVisibility}
        onSetAllModulesVisibility={(visible) => { if (visible) handleShowAllModules(); }}
        onApplyPreset={handleApplyPreset}
        onToggleAllCollapse={(collapsed) => { if (collapsed) handleCollapseAll(); else handleExpandAll(); }}
        onResetToDefault={handleResetModules}
      />

      {/* 1. 關鍵指標與即時告警卡片 (Overview Stats) */}
      {visibleModules.overview_stats && (
        <DashboardModuleCard
          moduleId="overview_stats"
          title="1. 關鍵指標與即時告警卡片"
          subtitle="實時統計缺工總額、排班達成率、待審核報名及涵蓋園區"
          icon={<ShieldAlert className="w-5 h-5 text-amber-500" />}
          badgeText="即時監控"
          badgeColor="bg-amber-100 text-amber-900 border-amber-300"
          isCollapsed={collapsedModules.overview_stats}
          onToggleCollapse={() => handleToggleModuleCollapse('overview_stats')}
          onHide={() => handleHideModule('overview_stats')}
          collapsedSummary={
            <span>
              當前缺工：<strong className={totalGap > 0 ? 'text-rose-600' : 'text-emerald-600'}>{totalGap > 0 ? `缺 ${totalGap} 人` : '全數補滿'}</strong> | 達成率：<strong>{fillRate}%</strong> ({totalFilled} / {totalRequired} 人) | 待審核：<strong>{pendingApps.length} 筆</strong>
            </span>
          }
        >
          {/* Main Stats Counter Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* Total Gap Card */}
            <div className="bg-[#FAF6EE] border border-[#716053] p-5 rounded-[24px] shadow-2xs flex items-center space-x-4">
              <div className={`p-3.5 rounded-2xl ${totalGap > 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                {totalGap > 0 ? <AlertCircle className="w-7 h-7 animate-bounce" /> : <CheckCircle2 className="w-7 h-7" />}
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">當前招募缺工總數</p>
                <div className="flex items-baseline space-x-2">
                  <span className={`text-3xl font-bold font-serif ${totalGap > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                    {totalGap > 0 ? `缺 ${totalGap} 人` : '人力補滿'}
                  </span>
                  <span className="text-xs text-slate-400">/ 需求 {totalRequired} 人</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {totalGap > 0 ? '🐶 尚需救援志工到位' : '🐱 喵力滿點班次全滿'}
                </p>
              </div>
            </div>

            {/* Fill Rate Card */}
            <div className="bg-[#FAF6EE] border border-[#716053] p-5 rounded-[24px] shadow-2xs flex items-center space-x-4">
              <div className="p-3.5 rounded-2xl bg-[#F5E6D0] text-[#716053]">
                <Users className="w-7 h-7" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">排班達成率</p>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-serif text-[#716053]">
                    {fillRate}%
                  </span>
                  <span className="text-xs text-[#716053] font-bold">{totalFilled} / {totalRequired} 人</span>
                </div>
                {/* Progress Bar */}
                <div className="w-full bg-[#FAF6EE] rounded-full h-2 mt-2 overflow-hidden">
                  <div
                    className="bg-[#716053] h-2 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(fillRate, 100)}%` }}
                  ></div>
                </div>
              </div>
            </div>

            {/* Pending Approval Card */}
            <div className="bg-[#FAF6EE] border border-[#716053] p-5 rounded-[24px] shadow-2xs flex items-center space-x-4">
              <div className="p-3.5 rounded-2xl bg-sky-50 text-sky-700 relative">
                <ShieldAlert className="w-7 h-7" />
                {pendingApps.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-rose-500 rounded-full animate-ping"></span>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">待審核報名申請</p>
                <span className="text-2xl font-bold font-serif text-sky-800">
                  {pendingApps.length} 筆
                </span>
                <button
                  onClick={() => onNavigateToTab('signups')}
                  className="text-xs text-[#716053] hover:underline block font-bold mt-1 cursor-pointer"
                >
                  前往審核與聯繫 →
                </button>
              </div>
            </div>

            {/* Shelter Location Card */}
            <div className="bg-[#FAF6EE] border border-[#716053] p-5 rounded-[24px] shadow-2xs flex items-center space-x-4">
              <div className="p-3.5 rounded-2xl bg-purple-50 text-purple-700">
                <MapPin className="w-7 h-7" />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">園區地點</p>
                <span className="text-lg font-bold font-serif text-purple-900">
                  {shelterLocation.name}
                </span>
                <p className="text-[11px] text-slate-500 mt-0.5">{shelterLocation.openHours}</p>
              </div>
            </div>

          </div>
        </DashboardModuleCard>
      )}

      {/* Real LINE Broadcast Composer -- moved here from the Integration Hub tab so
          it sits directly under the key-metrics/alerts card instead of buried in a
          separate tab. */}
      <div className="bg-white p-6 sm:p-8 rounded-[32px] border-2 border-[#716053] shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold font-serif text-xl text-[#716053] flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-amber-600" />
            <span>發送官方 LINE 廣播訊息</span>
          </h3>
          <span className="text-[10px] bg-[#F5E6D0] text-[#716053] px-2.5 py-0.5 rounded-full font-bold">
            LINE Messaging API
          </span>
        </div>
        <p className="text-xs text-slate-500 -mt-2">
          送出後會真的推播給所有加過本官方帳號好友的志工，用於招募貼文、緊急缺工通知等官方消息。
        </p>

        <textarea
          value={broadcastText}
          onChange={e => setBroadcastText(e.target.value)}
          rows={5}
          placeholder="輸入要發送給所有志工好友的官方訊息內容..."
          className="w-full p-3.5 bg-[#FAF6EE] border border-[#716053] rounded-2xl text-xs focus:ring-2 focus:ring-[#716053] focus:outline-none font-sans"
        />

        {broadcastResult && (
          <div className={`p-3 rounded-xl text-xs font-semibold flex items-start gap-2 ${
            broadcastResult.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-900 border border-amber-200'
          }`}>
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{broadcastResult.msg}</span>
          </div>
        )}

        <button
          type="button"
          onClick={handleSendBroadcast}
          disabled={isBroadcasting || !broadcastText.trim()}
          className="w-full py-3 bg-[#716053] hover:bg-[#5A4A3F] disabled:opacity-50 text-white font-extrabold rounded-2xl text-xs shadow-xs transition flex items-center justify-center gap-2 cursor-pointer"
        >
          {isBroadcasting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 text-amber-300" />}
          <span>{isBroadcasting ? '發送中...' : '發送給所有 LINE 好友'}</span>
        </button>
      </div>

      {(() => {
      // 2. D3.js Volunteer Engagement Heatmap
      const mod2 = visibleModules.heatmap && (
        <Suspense fallback={<ModuleLoading />}>
        <HeatmapChart
          shifts={shifts}
          onOpenUrgentModal={() => setShowUrgentModal(true)}
          onSendLineToast={onSendLineToast}
          isCollapsed={collapsedModules.heatmap}
          onToggleCollapse={() => handleToggleModuleCollapse('heatmap')}
          onHide={() => handleHideModule('heatmap')}
        />
        </Suspense>
      );

      // 3. 🔮 Gemini 3.6 Flash AI 資源需求預警與雙週物資人力缺口地圖
      const mod3 = visibleModules.ai_warning_map && (
        <Suspense fallback={<ModuleLoading />}>
        <ResourceWarningMap
          shifts={shifts}
          onSendLineToast={onSendLineToast}
          isCollapsed={collapsedModules.ai_warning_map}
          onToggleCollapse={() => handleToggleModuleCollapse('ai_warning_map')}
          onHide={() => handleHideModule('ai_warning_map')}
        />
        </Suspense>
      );

      // 4. 📋 每日志工勤務看板 & SOP 執行追蹤
      const mod4 = visibleModules.daily_duty && (
        <Suspense fallback={<ModuleLoading />}>
        <DailyDutyTaskboard
          shifts={shifts}
          onSendLineToast={onSendLineToast}
          isCollapsed={collapsedModules.daily_duty}
          onToggleCollapse={() => handleToggleModuleCollapse('daily_duty')}
          onHide={() => handleHideModule('daily_duty')}
        />
        </Suspense>
      );

      // 5. 📊 月度據點績效統計與總結匯出中心 (CSV / PDF)
      const mod5 = visibleModules.monthly_report && (() => {
        const mShiftsAll = shifts.filter(s => s.date.startsWith(selectedExportMonth));
        const totalReqMonth = mShiftsAll.reduce((acc, s) => acc + s.requiredCount, 0);
        const totalFilledMonth = mShiftsAll.reduce((acc, s) => acc + s.currentCount, 0);
        const totalShortageMonth = Math.max(0, totalReqMonth - totalFilledMonth);
        const shortagePctMonth = totalReqMonth > 0 ? Math.round((totalShortageMonth / totalReqMonth) * 100) : 0;
        const totalHoursMonth = Math.round(mShiftsAll.reduce((acc, s) => acc + (s.currentCount * calculateShiftDurationHours(s.timeRange)), 0));

        return (
          <DashboardModuleCard
            moduleId="monthly_report"
            title="5. 月度據點績效統計與總結報表匯出"
            subtitle="自動統計當月各據點總志工數、完成服務總時數與缺工率 (%)，可快速下載 CSV 試算表或 PDF 績效報告"
            icon={<FileSpreadsheet className="w-5 h-5 text-amber-400" />}
            badgeText="各據點指標"
            badgeColor="bg-[#F5E6D0] text-[#716053]"
            isCollapsed={collapsedModules.monthly_report}
            onToggleCollapse={() => handleToggleModuleCollapse('monthly_report')}
            onHide={() => handleHideModule('monthly_report')}
            headerRightExtras={
              <div className="flex flex-wrap items-center gap-2">
                {/* Month Selector */}
                <div className="flex items-center gap-1.5 bg-[#FAF6EE] px-3 py-1.5 rounded-2xl border border-[#716053] text-xs font-bold text-[#716053]">
                  <Calendar className="w-3.5 h-3.5 text-[#716053]" />
                  <span>月份：</span>
                  <select
                    value={selectedExportMonth}
                    onChange={e => setSelectedExportMonth(e.target.value)}
                    className="bg-white border border-[#716053] rounded-xl px-2 py-0.5 text-xs font-bold text-slate-900 focus:outline-none cursor-pointer"
                  >
                    <option value="2026-08">2026 年 8 月 (當月)</option>
                    <option value="2026-07">2026 年 7 月</option>
                    <option value="2026-06">2026 年 6 月</option>
                  </select>
                </div>

                <button
                  onClick={() => handleDirectExportCSV(selectedExportMonth)}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-3 py-1.5 rounded-xl text-xs shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-200" />
                  <span>匯出 CSV</span>
                </button>

                <button
                  onClick={() => setShowReportModal(true)}
                  className="bg-[#716053] hover:bg-[#5A4A3F] text-white font-bold px-3 py-1.5 rounded-xl text-xs shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-amber-300" />
                  <span>PDF 報表</span>
                </button>
              </div>
            }
            collapsedSummary={
              <span>
                {selectedExportMonth} 月統計：總班次需求 <strong>{totalReqMonth} 人</strong> / 實到 <strong>{totalFilledMonth} 人</strong> | 缺工率：<strong className={shortagePctMonth > 20 ? 'text-rose-600' : 'text-emerald-700'}>{shortagePctMonth}%</strong> | 累積服務時數：<strong>{totalHoursMonth} hr</strong>
              </span>
            }
          >
            {/* Monthly Performance Summary (single shelter, replaced the old per-branch comparison grid) */}
            {(() => {
              const mShifts = shifts.filter(s => s.date.startsWith(selectedExportMonth));
              const req = mShifts.reduce((acc, s) => acc + s.requiredCount, 0);
              const filled = mShifts.reduce((acc, s) => acc + s.currentCount, 0);
              const shortage = Math.max(0, req - filled);
              const shortageRate = req > 0 ? Math.round((shortage / req) * 100) : 0;

              const mShiftIds = new Set(mShifts.map(s => s.id));
              const mApps = shiftSignups.filter(a => mShiftIds.has(a.shiftId));
              const uniqueVols = new Set(mApps.map(a => a.volunteerName || a.lineId)).size;
              const totalVols = Math.max(uniqueVols, filled);

              const totalHours = Math.round(mShifts.reduce((acc, s) => {
                return acc + (s.currentCount * calculateShiftDurationHours(s.timeRange));
              }, 0));

              return (
                <div className="bg-[#FFFDF7] p-5 rounded-2xl border border-[#716053] space-y-3">
                  <div className="flex items-center justify-between border-b border-[#716053] pb-2">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-[#716053]" />
                      <span className="font-bold font-serif text-slate-900 text-sm">{shelterLocation.name}</span>
                    </div>
                    <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border ${
                      shortageRate > 30 ? 'bg-rose-100 text-rose-800 border-rose-300' :
                      shortageRate > 10 ? 'bg-amber-100 text-amber-800 border-amber-300' :
                      'bg-emerald-100 text-emerald-800 border-emerald-300'
                    }`}>
                      缺工率 {shortageRate}%
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1">
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
                      <span className="text-[10px] text-slate-400 block font-medium">總志工數</span>
                      <span className="font-extrabold text-slate-900 font-mono text-base">{totalVols} <span className="text-[10px] font-sans font-normal">位</span></span>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
                      <span className="text-[10px] text-slate-400 block font-medium">完成總時數</span>
                      <span className="font-extrabold text-[#716053] font-mono text-base">{totalHours} <span className="text-[10px] font-sans font-normal">hr</span></span>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
                      <span className="text-[10px] text-slate-400 block font-medium">缺工人數</span>
                      <span className={`font-extrabold font-mono text-base ${shortage > 0 ? 'text-rose-600' : 'text-slate-700'}`}>{shortage} <span className="text-[10px] font-sans font-normal">人</span></span>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-500 flex justify-between items-center pt-1">
                    <span>共 {mShifts.length} 個班次 (需求 {req} 人)</span>
                    <button
                      onClick={() => setShowReportModal(true)}
                      className="text-[#716053] font-bold hover:underline flex items-center gap-0.5 cursor-pointer"
                    >
                      <span>開啟詳細報表</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })()}
          </DashboardModuleCard>
        );
      })();

      // 6. ⭐️ 志工離場服務回饋與滿意度彙整中心 (LINE Feedback Hub)
      const mod6 = visibleModules.feedback_hub && (() => {
        const feedbackRecords = attendanceRecords.filter(r => r.rating || r.feedbackComment);
        const totalCount = feedbackRecords.length;
        const ratingSum = feedbackRecords.reduce((acc, r) => acc + (r.rating || 5), 0);
        const avgRating = totalCount > 0 ? (ratingSum / totalCount).toFixed(1) : '5.0';
        const highRatingCount = feedbackRecords.filter(r => (r.rating || 5) >= 4).length;
        const highRatingPct = totalCount > 0 ? Math.round((highRatingCount / totalCount) * 100) : 100;

        return (
          <DashboardModuleCard
            moduleId="feedback_hub"
            title="6. 志工服務回饋與滿意度彙整中心"
            subtitle="志工完成簽退離場時自動透過 LINE 發送提醒收集 1-5 星好評與改善建議，提供社工團隊即時數據以優化園區動線與衛教流程"
            icon={<Star className="w-5 h-5 text-amber-500 fill-amber-500" />}
            badgeText="離場 LINE 即時提醒"
            badgeColor="bg-amber-100 text-amber-900 border-amber-300"
            isCollapsed={collapsedModules.feedback_hub}
            onToggleCollapse={() => handleToggleModuleCollapse('feedback_hub')}
            onHide={() => handleHideModule('feedback_hub')}
            headerRightExtras={
              <button
                onClick={() => {
                  if (onOpenCheckInModal) onOpenCheckInModal();
                  onSendLineToast('📱 請至【簽到與離場核銷系統】點選志工「離場簽退 & 收集回饋」進行測試！');
                }}
                className="bg-[#716053] hover:bg-[#5A4A3F] text-white font-bold px-3 py-1.5 rounded-xl text-xs shadow-xs transition flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <Smartphone className="w-3.5 h-3.5 text-amber-300" />
                <span>簽到/離場測試</span>
              </button>
            }
            collapsedSummary={
              <span>
                全機構均分：<strong className="text-amber-600 font-mono">{avgRating} / 5.0 ⭐</strong> | 已收集回饋：<strong>{totalCount} 筆</strong> | 優良好評率：<strong className="text-emerald-700">{highRatingPct}%</strong>
              </span>
            }
          >
            <div className="space-y-6">
              {/* Top KPI Metrics Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Average Rating */}
                <div className="bg-[#FFFDF7] p-4 rounded-2xl border border-amber-200/80 shadow-2xs space-y-1">
                  <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1">
                    <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />
                    全機構平均滿意度
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold text-slate-900 font-mono">{avgRating}</span>
                    <span className="text-xs text-amber-600 font-bold">/ 5.0 分</span>
                  </div>
                  <div className="flex items-center gap-0.5 text-amber-400 text-xs pt-0.5">
                    {[1, 2, 3, 4, 5].map(s => (
                      <Star key={s} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                </div>

                {/* Total Feedbacks */}
                <div className="bg-[#FFFDF7] p-4 rounded-2xl border border-[#716053] shadow-2xs space-y-1">
                  <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1">
                    <MessageSquare className="w-3.5 h-3.5 text-[#716053]" />
                    已收集 LINE 回饋數
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold text-[#716053] font-mono">{totalCount}</span>
                    <span className="text-xs text-slate-500 font-bold">筆心得建議</span>
                  </div>
                  <span className="text-[10px] text-emerald-700 font-semibold block pt-0.5">
                    🟢 回應回收率 100%
                  </span>
                </div>

                {/* High Rating Percentage */}
                <div className="bg-[#FFFDF7] p-4 rounded-2xl border border-emerald-200/80 shadow-2xs space-y-1">
                  <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1">
                    <ThumbsUp className="w-3.5 h-3.5 text-emerald-600" />
                    優良好評率 (4-5星)
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold text-emerald-700 font-mono">{highRatingPct}%</span>
                    <span className="text-xs text-slate-500 font-bold">極佳滿意度</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium block pt-0.5">
                    共 {highRatingCount} 筆評分在 4 星以上
                  </span>
                </div>

                {/* LINE Reminder Dispatch Status */}
                <div className="bg-[#FFFDF7] p-4 rounded-2xl border border-emerald-200/80 shadow-2xs space-y-1">
                  <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1">
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                    離場 LINE 提醒發送狀態
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold text-emerald-700 font-mono">100%</span>
                    <span className="text-xs text-emerald-600 font-bold">成功送達</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium block pt-0.5">
                    已連結 LINE 帳號者會收到真實推播
                  </span>
                </div>
              </div>

              {/* Filter and Search Toolbar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#FAF6EE]/80 p-3 rounded-2xl border border-[#716053]">
                {/* Search Input */}
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={feedbackSearchTerm}
                    onChange={e => setFeedbackSearchTerm(e.target.value)}
                    placeholder="搜尋志工姓名、回饋關鍵字..."
                    className="w-full pl-8 pr-3 py-1.5 bg-white border border-[#716053] rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#716053]"
                  />
                </div>

                {/* Rating Filter Pills */}
                <div className="flex items-center gap-1.5 self-start sm:self-auto text-xs font-bold">
                  <span className="text-slate-500 text-[11px] mr-1">篩選評分：</span>
                  <button
                    onClick={() => setFeedbackRatingFilter('all')}
                    className={`px-3 py-1 rounded-xl transition cursor-pointer border ${
                      feedbackRatingFilter === 'all'
                        ? 'bg-[#716053] text-white border-[#716053]'
                        : 'bg-white text-slate-700 hover:bg-slate-100 border-slate-200'
                    }`}
                  >
                    全部 ({totalCount})
                  </button>
                  <button
                    onClick={() => setFeedbackRatingFilter('5')}
                    className={`px-3 py-1 rounded-xl transition cursor-pointer border ${
                      feedbackRatingFilter === '5'
                        ? 'bg-amber-500 text-slate-950 font-extrabold border-amber-500'
                        : 'bg-white text-slate-700 hover:bg-slate-100 border-slate-200'
                    }`}
                  >
                    ⭐⭐⭐⭐⭐ 5星
                  </button>
                  <button
                    onClick={() => setFeedbackRatingFilter('4')}
                    className={`px-3 py-1 rounded-xl transition cursor-pointer border ${
                      feedbackRatingFilter === '4'
                        ? 'bg-amber-500 text-slate-950 font-extrabold border-amber-500'
                        : 'bg-white text-slate-700 hover:bg-slate-100 border-slate-200'
                    }`}
                  >
                    ⭐⭐⭐⭐ 4星
                  </button>
                  <button
                    onClick={() => setFeedbackRatingFilter('low')}
                    className={`px-3 py-1 rounded-xl transition cursor-pointer border ${
                      feedbackRatingFilter === 'low'
                        ? 'bg-rose-600 text-white border-rose-600'
                        : 'bg-white text-slate-700 hover:bg-slate-100 border-slate-200'
                    }`}
                  >
                    3星以下
                  </button>
                </div>
              </div>

              {/* Feedback Records Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(() => {
                  const filtered = feedbackRecords.filter(r => {
                    const rating = r.rating || 5;
                    if (feedbackRatingFilter === '5' && rating !== 5) return false;
                    if (feedbackRatingFilter === '4' && rating !== 4) return false;
                    if (feedbackRatingFilter === 'low' && rating > 3) return false;

                    if (feedbackSearchTerm.trim()) {
                      const q = feedbackSearchTerm.toLowerCase();
                      const matchName = r.volunteerName.toLowerCase().includes(q);
                      const matchComment = (r.feedbackComment || '').toLowerCase().includes(q);
                      const matchShift = r.shiftTitle.toLowerCase().includes(q);
                      return matchName || matchComment || matchShift;
                    }
                    return true;
                  });

                  if (filtered.length === 0) {
                    return (
                      <div className="col-span-2 bg-[#FFFDF7] p-8 text-center rounded-2xl border border-dashed border-[#716053] text-slate-400 italic text-xs">
                        尚無符合條件的志工回饋紀錄，請至「簽到系統」完成一次離場簽退以測試 LINE 提醒收集功能！
                      </div>
                    );
                  }

                  return filtered.map(item => {
                    const ratingVal = item.rating || 5;
                    const isAcknowledged = !!item.feedbackAcknowledgedAt;
                    const isSavingAck = savingFeedbackIds.includes(item.id);
                    const hasReplied = !!item.feedbackRepliedAt;
                    // 低星回饋才是真正需要有人親自回話的那些。五星好評不回也不會
                    // 少什麼，回了反而像罐頭 —— 所以只有這些會被標成待辦。
                    const needsReply = !hasReplied && (item.rating || 5) <= 3;

                    return (
                      <div
                        key={item.id}
                        className="bg-[#FFFDF7] p-5 rounded-2xl border border-[#716053] shadow-2xs hover:shadow-xs transition space-y-3 flex flex-col justify-between"
                      >
                        <div className="space-y-2.5">
                          {/* Header Line */}
                          <div className="flex items-start justify-between gap-2 border-b border-[#716053] pb-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900 text-sm font-serif">{item.volunteerName}</span>
                                <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-mono">
                                  LINE: @{item.lineId || '已驗證'}
                                </span>
                              </div>
                              <span className="text-[11px] text-[#716053] font-medium block mt-0.5">
                                📍 {item.shiftTitle}
                              </span>
                            </div>

                            {/* Rating Display */}
                            <div className="flex flex-col items-end shrink-0">
                              <div className="flex items-center gap-0.5 text-amber-400">
                                {[1, 2, 3, 4, 5].map(star => (
                                  <Star
                                    key={star}
                                    className={`w-3.5 h-3.5 ${
                                      star <= ratingVal ? 'fill-amber-400 text-amber-400' : 'text-slate-200'
                                    }`}
                                  />
                                ))}
                              </div>
                              <span className="text-[10px] font-extrabold text-amber-600 font-mono mt-0.5">
                                {ratingVal}.0 星好評
                              </span>
                            </div>
                          </div>

                          {/* Feedback Text Quote Box (+ check-out photo, if the volunteer attached one) */}
                          <div className="bg-white p-3 rounded-xl border border-slate-200/80 text-xs text-slate-800 leading-relaxed relative font-sans shadow-2xs flex gap-3">
                            {item.photoUrl && (
                              <img
                                src={item.photoUrl}
                                alt="志工服務照片"
                                className="w-16 h-16 rounded-lg object-cover border border-slate-200 shrink-0"
                              />
                            )}
                            <div className="relative flex-1">
                              <span className="text-amber-500 font-serif text-lg leading-none absolute -top-1 left-2">"</span>
                              <p className="pl-3 pr-1 pt-1 italic text-slate-700">
                                {item.feedbackComment || '完成志工服務，環境與動線說明十分清晰！'}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* 回覆過的話，內容直接攤在卡片上。這是下一個打開同一則回饋
                            的人最需要先知道的事 —— 藏在 hover 提示裡等於沒說，手機
                            上更是完全碰不到。 */}
                        {hasReplied && (
                          <div className="bg-sky-50/70 border border-sky-200 rounded-xl p-2.5 space-y-1">
                            <div className="text-[10px] font-bold text-sky-900 flex items-center gap-1">
                              <MessageSquare className="w-3 h-3 shrink-0" />
                              <span>
                                {item.feedbackRepliedBy || '社工'} 已於 {new Date(item.feedbackRepliedAt!).toLocaleString('zh-TW', { hour12: false })} 回覆
                              </span>
                            </div>
                            <p className="text-[11px] text-sky-950/80 leading-relaxed whitespace-pre-wrap">
                              {item.feedbackReplyText}
                            </p>
                          </div>
                        )}

                        {/* Footer Status and Actions */}
                        <div className="flex items-center justify-between gap-2 flex-wrap text-[11px] pt-1 border-t border-slate-100 text-slate-500">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="inline-flex items-center gap-1 text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-bold text-[10px]">
                              <MessageSquare className="w-3 h-3 text-emerald-600" />
                              <span>回饋收集時間: {item.feedbackSubmittedAt || item.checkOutTime || '今天'}</span>
                            </span>
                            {isAcknowledged && item.feedbackAcknowledgedBy && (
                              <span className="inline-flex items-center gap-1 text-emerald-900 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full font-bold text-[10px]">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>{item.feedbackAcknowledgedBy} 已參採</span>
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => openReplyModal(item)}
                              className={`px-2.5 py-1 rounded-xl font-bold transition flex items-center gap-1 cursor-pointer border ${
                                hasReplied
                                  ? 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100'
                                  : needsReply
                                    ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600'
                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                              }`}
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>{hasReplied ? '再回覆一次' : needsReply ? '需要回覆' : '回覆志工'}</span>
                            </button>

                            <button
                              onClick={() => toggleFeedbackAcknowledged(item)}
                              disabled={isSavingAck}
                              className={`px-2.5 py-1 rounded-xl font-bold transition flex items-center gap-1 cursor-pointer border disabled:opacity-50 ${
                                isAcknowledged
                                  ? 'bg-emerald-700 text-white border-emerald-700'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                              }`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>
                                {isSavingAck ? '儲存中...' : isAcknowledged ? '社工已參採 👍' : '標記為已參採'}
                              </span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </DashboardModuleCard>
        );
      })();

      // 7. 依「動物之家場域 (Zone)」分類之人力缺口與色彩管理 (Zone Shortage & Shifts)
      const mod7 = visibleModules.zone_shortage && (
        <DashboardModuleCard
          moduleId="zone_shortage"
          title="7. 急缺志工班次與招募推播"
          subtitle="人力尚未補齊的班次，可直接發布 LINE 招募或代志工報名"
          icon={<Megaphone className="w-5 h-5 text-amber-300" />}
          badgeText={`${understaffedShifts.length} 個缺額班次`}
          badgeColor="bg-[#F5E6D0] text-[#716053]"
          isCollapsed={collapsedModules.zone_shortage}
          onToggleCollapse={() => handleToggleModuleCollapse('zone_shortage')}
          onHide={() => handleHideModule('zone_shortage')}
          headerRightExtras={
            <div className="flex items-center space-x-1.5 text-xs font-sans">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <button
                onClick={() => setSelectedDateFilter('all')}
                className={`px-3 py-1 rounded-xl font-bold transition cursor-pointer ${
                  selectedDateFilter === 'all'
                    ? 'bg-[#716053] text-white shadow-2xs'
                    : 'bg-[#FAF6EE] text-slate-600 hover:bg-[#F5E6D0]'
                }`}
              >
                全部
              </button>
              <button
                onClick={() => setSelectedDateFilter('today')}
                className={`px-3 py-1 rounded-xl font-bold transition cursor-pointer ${
                  selectedDateFilter === 'today'
                    ? 'bg-[#716053] text-white shadow-2xs'
                    : 'bg-[#FAF6EE] text-slate-600 hover:bg-[#F5E6D0]'
                }`}
              >
                今日
              </button>
              <button
                onClick={() => setSelectedDateFilter('upcoming')}
                className={`px-3 py-1 rounded-xl font-bold transition cursor-pointer ${
                  selectedDateFilter === 'upcoming'
                    ? 'bg-[#716053] text-white shadow-2xs'
                    : 'bg-[#FAF6EE] text-slate-600 hover:bg-[#F5E6D0]'
                }`}
              >
                未來班次
              </button>
            </div>
          }
          collapsedSummary={
            <span>
              {understaffedShifts.length === 0
                ? '目前所有班次的人力都已補齊'
                : `${understaffedShifts.length} 個班次尚缺人力，合計還需 ${totalMissingPeople} 人`}
            </span>
          }
        >
          <div className="space-y-6">
      {/* Staffing Gap Immediate Attention List */}
      <div className="bg-white rounded-[32px] border border-[#716053] p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-[#716053] gap-2">
          <div>
            <h3 className="text-xl font-bold font-serif italic text-[#716053] flex items-center gap-2">
              <span>🚨 急缺志工班次清單 (Urgent Shift Gap)</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">這些班次人力尚缺，需快速透過 LINE 志工群組發布招募推播。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <button
              onClick={() => setShowUrgentModal(true)}
              className="bg-rose-700 hover:bg-rose-800 text-white px-4 py-2 rounded-full font-bold text-xs shadow-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5 text-white" />
              <span>📢 缺工自動發送推播 (LINE 預覽)</span>
            </button>

            <button
              onClick={() => onNavigateToTab('positions')}
              className="text-xs bg-[#FAF6EE] hover:bg-[#F5E6D0] text-[#716053] px-4 py-2 rounded-full font-bold transition cursor-pointer"
            >
              檢視全部 {shifts.length} 個班次
            </button>
          </div>
        </div>

        <div className="mt-4 divide-y divide-[#716053]/10">
          {understaffedShifts
            .map(shift => {
              const zoneConf = resolveZone(shift.zone);
              const remaining = shift.requiredCount - shift.currentCount;

              return (
                <div key={shift.id} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-[#FAF6EE]/60 p-3 rounded-2xl transition">
                  <div className="flex items-start space-x-3">
                    <span className="text-2xl p-2.5 bg-[#FAF6EE] border border-[#716053] rounded-2xl">
                      {zoneConf?.icon || '🐾'}
                    </span>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${zoneConf?.badgeBg}`}>
                          {zoneConf?.name}
                        </span>
                      </div>
                      <h4 className="font-bold text-slate-800 text-base mt-1">
                        {shift.title}
                      </h4>
                      <div className="flex items-center space-x-3 text-xs text-slate-500 mt-1">
                        <span className="flex items-center gap-1 font-bold text-[#716053]">
                          <Calendar className="w-3.5 h-3.5" />
                          {shift.date} ({shift.timeRange})
                        </span>
                        <span>• 集合地點：{shift.locationDetails}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3 self-end md:self-auto">
                    <div className="text-right">
                      <span className="text-xs font-bold text-rose-700 bg-rose-50 px-3 py-1 rounded-full border border-rose-200">
                        尚缺 {remaining} 人
                      </span>
                      <p className="text-[10px] text-slate-400 mt-1">目前 {shift.currentCount} / {shift.requiredCount} 人</p>
                    </div>

                    <button
                      onClick={() => onApplyForShift(shift.id)}
                      className="bg-[#716053] hover:bg-[#5A4A3F] text-white font-bold text-xs px-4 py-2.5 rounded-full shadow-xs transition cursor-pointer whitespace-nowrap"
                    >
                      手動幫志工報名
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
          </div>
        </DashboardModuleCard>
      );

      return (
        <>
          {mod7}
          {mod6}
          {mod4}
          {mod5}
          {mod3}
          {mod2}
        </>
      );
      })()}

      {/* Modal: Urgent Shortage Auto Push */}
      {showUrgentModal && (
        <Suspense fallback={null}>
        <UrgentShortageModal
          shifts={shifts}
          shelterLocation={shelterLocation}
          onClose={() => setShowUrgentModal(false)}
          onSendLineToast={onSendLineToast}
          onApplyForShift={onApplyForShift}
        />
        </Suspense>
      )}

      {/* Modal: Monthly Report PDF / CSV Preview */}
      {showReportModal && (
        <Suspense fallback={null}>
        <MonthlyReportModal
          month={selectedExportMonth}
          shelterLocation={shelterLocation}
          shifts={shifts}
          shiftSignups={shiftSignups}
          onClose={() => setShowReportModal(false)}
          onSendLineToast={onSendLineToast}
        />
        </Suspense>
      )}

      {/* Modal: 回覆志工的服務回饋 */}
      {replyTarget && (
        <div className="fixed inset-0 z-50 bg-[#716053]/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-[32px] max-w-2xl w-full shadow-2xl p-6 sm:p-8 border border-[#716053] my-8 space-y-5 text-slate-800 font-sans">

            <div className="flex items-start justify-between border-b border-[#716053] pb-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-[#716053] text-[#F5E6D0] flex items-center justify-center shrink-0">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold font-serif italic text-[#716053]">回覆志工的服務回饋</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    給【{replyTarget.volunteerName}】 · {replyTarget.shiftTitle}
                  </p>
                </div>
              </div>
              <button
                onClick={() => { setReplyTarget(null); setReplyDraft(''); }}
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer text-lg leading-none"
              >
                ✕
              </button>
            </div>

            {/* 志工的原話。回覆的時候看得到自己在回什麼，才不會寫出罐頭。 */}
            <div className="bg-[#FAF6EE] border border-[#716053]/30 rounded-2xl p-4 space-y-1.5">
              <div className="flex items-center gap-2 text-[11px] font-bold text-[#716053]">
                <span>{'⭐'.repeat(Math.max(1, Math.min(5, replyTarget.rating || 5)))}</span>
                <span>{replyTarget.rating || 5}.0 星</span>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed italic">
                {replyTarget.feedbackComment || '（這位志工只給了評分，沒有留下文字）'}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="text-xs font-bold text-[#716053]">回覆內容（送出前可自由修改）</label>
                <button
                  onClick={() => void draftReplyWithAi(replyTarget)}
                  disabled={isDraftingReply}
                  className="text-[11px] font-bold text-[#716053] hover:text-[#5a4d42] flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isDraftingReply ? 'animate-pulse' : ''}`} />
                  <span>{isDraftingReply ? 'AI 草擬中...' : '重新產生 AI 草稿'}</span>
                </button>
              </div>

              <textarea
                value={replyDraft}
                onChange={e => setReplyDraft(e.target.value)}
                rows={8}
                placeholder={isDraftingReply ? 'AI 正在草擬回覆...' : '寫下要傳給這位志工的話...'}
                className="w-full p-3 bg-white border border-[#716053] rounded-2xl text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#716053] resize-none"
              />

              <p className="text-[10px] text-slate-500 leading-relaxed">
                這段文字會原封不動透過 LINE 傳給志工，並存進這筆出勤紀錄。若志工關閉了此類通知或尚未綁定 LINE，回覆仍會存檔，只是不會推播出去。
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => { setReplyTarget(null); setReplyDraft(''); }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={() => void sendReply()}
                disabled={isSendingReply || !replyDraft.trim()}
                className="px-5 py-2 rounded-xl text-xs font-extrabold bg-[#716053] text-[#F5E6D0] hover:bg-[#5a4d42] transition flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
                <span>{isSendingReply ? '送出中...' : '送出回覆'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
