import React, { useState, useEffect } from 'react';
import { PositionShift, VolunteerApplication, BranchId, Branch, AttendanceRecord } from '../types';
import { ZONE_CONFIGS } from '../data/mockData';
import { AlertCircle, CheckCircle2, Users, Calendar, MapPin, ArrowRight, ShieldAlert, Sparkles, Filter, Eye, ChevronRight, QrCode, LogOut, Send, Zap, FileSpreadsheet, FileText, Download, Building2, Clock, BarChart3, Star, Smartphone, MessageSquare, ThumbsUp, Search, RefreshCw, SlidersHorizontal, LayoutGrid, EyeOff } from 'lucide-react';
import { UrgentShortageModal } from './UrgentShortageModal';
import { HeatmapChart } from './HeatmapChart';
import { MonthlyReportModal, calculateShiftDurationHours } from './MonthlyReportModal';
import { ResourceWarningMap } from './ResourceWarningMap';
import { DailyDutyTaskboard } from './DailyDutyTaskboard';
import { DashboardModuleCard } from './DashboardModuleCard';
import { 
  DashboardModuleCustomizer, 
  DashboardModuleId, 
  DEFAULT_VISIBLE_MODULES, 
  DEFAULT_COLLAPSED_MODULES,
  DASHBOARD_MODULE_CONFIGS
} from './DashboardModuleCustomizer';

interface DashboardProps {
  shifts: PositionShift[];
  applications: VolunteerApplication[];
  branches: Branch[];
  selectedBranch: BranchId | 'all';
  attendanceRecords?: AttendanceRecord[];
  onNavigateToTab: (tab: 'dashboard' | 'positions' | 'applications' | 'portal' | 'integration' | 'roster') => void;
  onApplyForShift: (shiftId: string) => void;
  onOpenCheckInModal?: () => void;
  checkedInCount?: number;
  onSendLineToast?: (msg: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  shifts,
  applications,
  branches,
  selectedBranch,
  attendanceRecords = [],
  onNavigateToTab,
  onApplyForShift,
  onOpenCheckInModal,
  checkedInCount = 0,
  onSendLineToast = (_msg?: string) => {}
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
  const [acknowledgedFeedbackIds, setAcknowledgedFeedbackIds] = useState<string[]>([]);

  const todayStr = new Date().toISOString().split('T')[0];

  // Export CSV Helper Function
  const handleDirectExportCSV = (monthToExport: string) => {
    const monthShifts = shifts.filter(s => s.date.startsWith(monthToExport));
    const csvRows: string[] = [];

    const [yStr, mStr] = monthToExport.split('-');
    const formattedMonth = `${yStr} 年 ${mStr} 月`;

    // Calculate per-branch stats for CSV
    const branchStats = branches.map(branch => {
      const bShifts = monthShifts.filter(s => s.branchId === branch.id);
      const totalShifts = bShifts.length;
      const requiredCount = bShifts.reduce((acc, s) => acc + s.requiredCount, 0);
      const filledCount = bShifts.reduce((acc, s) => acc + s.currentCount, 0);
      const shortageCount = Math.max(0, requiredCount - filledCount);
      const shortageRate = requiredCount > 0 ? Math.round((shortageCount / requiredCount) * 100) : 0;

      const bShiftIds = new Set(bShifts.map(s => s.id));
      const bApps = applications.filter(a => bShiftIds.has(a.shiftId));
      const uniqueVols = new Set(bApps.map(a => a.volunteerName || a.lineId)).size;
      const totalVolunteers = Math.max(uniqueVols, filledCount);

      const totalCompletedHours = Math.round(bShifts.reduce((acc, s) => {
        const shiftHours = calculateShiftDurationHours(s.timeRange);
        return acc + (s.currentCount * shiftHours);
      }, 0));

      let statusLabel = '排班優良';
      if (shortageRate > 30) statusLabel = '嚴重缺工';
      else if (shortageRate > 10) statusLabel = '人力微緊';

      return {
        branchName: branch.name,
        totalShifts,
        requiredCount,
        filledCount,
        shortageCount,
        shortageRate,
        totalVolunteers,
        totalCompletedHours,
        statusLabel
      };
    });

    const overallRequired = branchStats.reduce((acc, b) => acc + b.requiredCount, 0);
    const overallFilled = branchStats.reduce((acc, b) => acc + b.filledCount, 0);
    const overallShortage = Math.max(0, overallRequired - overallFilled);
    const overallShortageRate = overallRequired > 0 ? Math.round((overallShortage / overallRequired) * 100) : 0;
    const overallVolunteers = branchStats.reduce((acc, b) => acc + b.totalVolunteers, 0);
    const overallHours = branchStats.reduce((acc, b) => acc + b.totalCompletedHours, 0);

    // Title rows
    csvRows.push(`"流浪動物之家人力排班 - ${formattedMonth}月度據點績效與缺工率統計總結"`);
    csvRows.push(`"匯出時間: ${new Date().toLocaleString('zh-TW')}"`);
    csvRows.push(`"全機構平均缺工率: ${overallShortageRate}%", "當月總志工數: ${overallVolunteers}人", "當月完成總時數: ${overallHours}小時"`);
    csvRows.push('');

    // Headers
    csvRows.push('"據點名稱","統計月份","當月總班次數","需求志工人數","已報名人數","缺工人數","缺工率(%)","總完成服務時數(小時)","據點運作評估"');

    // Branch data rows
    branchStats.forEach(stat => {
      csvRows.push(`"${stat.branchName}","${monthToExport}","${stat.totalShifts}","${stat.requiredCount}","${stat.filledCount}","${stat.shortageCount}","${stat.shortageRate}%","${stat.totalCompletedHours}","${stat.statusLabel}"`);
    });

    // Total row
    csvRows.push(`"全機構總計","${monthToExport}","${monthShifts.length}","${overallRequired}","${overallFilled}","${overallShortage}","${overallShortageRate}%","${overallHours}","營運總結"`);

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

  // Filter shifts based on branch and date
  const filteredShifts = shifts.filter(shift => {
    if (selectedBranch !== 'all' && shift.branchId !== selectedBranch) return false;
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

  // Group by zone
  const zoneStats = Object.keys(ZONE_CONFIGS).map(zoneKey => {
    const config = ZONE_CONFIGS[zoneKey];
    const zoneShifts = filteredShifts.filter(s => s.zone === zoneKey);
    const required = zoneShifts.reduce((acc, s) => acc + s.requiredCount, 0);
    const filled = zoneShifts.reduce((acc, s) => acc + s.currentCount, 0);
    const gap = required - filled;
    return {
      config,
      shifts: zoneShifts,
      required,
      filled,
      gap,
      isFull: gap <= 0 && required > 0
    };
  });

  const pendingApps = applications.filter(a => a.status === 'pending');

  return (
    <div className="bg-[#f5f5f0] min-h-screen py-6 px-4 sm:px-6 lg:px-8 space-y-8 max-w-7xl mx-auto">
      
      {/* Hero Welcome Banner */}
      <div className="bg-[#5A5A40] rounded-[32px] p-6 sm:p-8 text-white shadow-md relative overflow-hidden border border-[#5A5A40]/20">
        <div className="absolute right-0 top-0 bottom-0 opacity-10 flex items-center pointer-events-none pr-8">
          <span className="text-[180px]">🐾</span>
        </div>
        
        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="inline-flex items-center space-x-2 bg-white/15 backdrop-blur-xs px-3.5 py-1 rounded-full text-xs font-semibold text-[#E6E2D3]">
            <Sparkles className="w-3.5 h-3.5 text-amber-200" />
            <span className="font-sans uppercase tracking-wider">流浪動物之家人力即時控制台</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold font-serif italic tracking-tight text-white">
            今日缺工即時數據看板 &amp; 據點色標管理
          </h2>
          <p className="text-[#E6E2D3] text-sm leading-relaxed font-sans">
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
              className="bg-white text-[#5A5A40] hover:bg-[#E6E2D3] px-5 py-2.5 rounded-full font-bold text-xs shadow-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>🐾 模擬志工視角報名</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => onNavigateToTab('integration')}
              className="bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-full font-semibold text-xs border border-white/20 transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>🗺️ 查看 Google 地圖/日曆串聯教學</span>
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
              當前缺工：<strong className={totalGap > 0 ? 'text-rose-600' : 'text-emerald-600'}>{totalGap > 0 ? `缺 ${totalGap} 人` : '全數補滿'}</strong> | 達成率：<strong>{fillRate}%</strong> ({totalFilled} / {totalRequired} 人) | 待審核：<strong>{pendingApps.length} 筆</strong> | 園區：<strong>{branches.length} 處</strong>
            </span>
          }
        >
          {/* Main Stats Counter Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* Total Gap Card */}
            <div className="bg-[#fafaf7] border border-[#5A5A40]/12 p-5 rounded-[24px] shadow-2xs flex items-center space-x-4">
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
            <div className="bg-[#fafaf7] border border-[#5A5A40]/12 p-5 rounded-[24px] shadow-2xs flex items-center space-x-4">
              <div className="p-3.5 rounded-2xl bg-[#E6E2D3] text-[#5A5A40]">
                <Users className="w-7 h-7" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">排班達成率</p>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-serif text-[#5A5A40]">
                    {fillRate}%
                  </span>
                  <span className="text-xs text-[#5A5A40] font-bold">{totalFilled} / {totalRequired} 人</span>
                </div>
                {/* Progress Bar */}
                <div className="w-full bg-[#f5f5f0] rounded-full h-2 mt-2 overflow-hidden">
                  <div
                    className="bg-[#5A5A40] h-2 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(fillRate, 100)}%` }}
                  ></div>
                </div>
              </div>
            </div>

            {/* Pending Approval Card */}
            <div className="bg-[#fafaf7] border border-[#5A5A40]/12 p-5 rounded-[24px] shadow-2xs flex items-center space-x-4">
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
                  onClick={() => onNavigateToTab('applications')}
                  className="text-xs text-[#5A5A40] hover:underline block font-bold mt-1 cursor-pointer"
                >
                  前往審核與聯繫 →
                </button>
              </div>
            </div>

            {/* Active Branches Card */}
            <div className="bg-[#fafaf7] border border-[#5A5A40]/12 p-5 rounded-[24px] shadow-2xs flex items-center space-x-4">
              <div className="p-3.5 rounded-2xl bg-purple-50 text-purple-700">
                <MapPin className="w-7 h-7" />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">涵蓋動物之家據點</p>
                <span className="text-2xl font-bold font-serif text-purple-900">
                  {branches.length} 個分院
                </span>
                <p className="text-[11px] text-slate-500 mt-0.5">內建 Google Maps 據點導航</p>
              </div>
            </div>

          </div>
        </DashboardModuleCard>
      )}

      {(() => {
      // 2. D3.js Volunteer Engagement Heatmap
      const mod2 = visibleModules.heatmap && (
        <HeatmapChart
          shifts={shifts}
          branches={branches}
          onOpenUrgentModal={() => setShowUrgentModal(true)}
          onSendLineToast={onSendLineToast}
          isCollapsed={collapsedModules.heatmap}
          onToggleCollapse={() => handleToggleModuleCollapse('heatmap')}
          onHide={() => handleHideModule('heatmap')}
        />
      );

      // 3. 🔮 Gemini 3.6 Flash AI 資源需求預警與雙週物資人力缺口地圖
      const mod3 = visibleModules.ai_warning_map && (
        <ResourceWarningMap
          branches={branches}
          shifts={shifts}
          onSendLineToast={onSendLineToast}
          isCollapsed={collapsedModules.ai_warning_map}
          onToggleCollapse={() => handleToggleModuleCollapse('ai_warning_map')}
          onHide={() => handleHideModule('ai_warning_map')}
        />
      );

      // 4. 📋 每日志工勤務看板 & SOP 執行追蹤
      const mod4 = visibleModules.daily_duty && (
        <DailyDutyTaskboard
          shifts={shifts}
          branches={branches}
          selectedBranch={selectedBranch}
          onSendLineToast={onSendLineToast}
          isCollapsed={collapsedModules.daily_duty}
          onToggleCollapse={() => handleToggleModuleCollapse('daily_duty')}
          onHide={() => handleHideModule('daily_duty')}
        />
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
            badgeColor="bg-[#E6E2D3] text-[#5A5A40]"
            isCollapsed={collapsedModules.monthly_report}
            onToggleCollapse={() => handleToggleModuleCollapse('monthly_report')}
            onHide={() => handleHideModule('monthly_report')}
            headerRightExtras={
              <div className="flex flex-wrap items-center gap-2">
                {/* Month Selector */}
                <div className="flex items-center gap-1.5 bg-[#f5f5f0] px-3 py-1.5 rounded-2xl border border-[#5A5A40]/15 text-xs font-bold text-[#5A5A40]">
                  <Calendar className="w-3.5 h-3.5 text-[#5A5A40]" />
                  <span>月份：</span>
                  <select
                    value={selectedExportMonth}
                    onChange={e => setSelectedExportMonth(e.target.value)}
                    className="bg-white border border-[#5A5A40]/20 rounded-xl px-2 py-0.5 text-xs font-bold text-slate-900 focus:outline-none cursor-pointer"
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
                  className="bg-[#5A5A40] hover:bg-[#484833] text-white font-bold px-3 py-1.5 rounded-xl text-xs shadow-xs transition flex items-center gap-1.5 cursor-pointer"
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
            {/* Per Branch Monthly Performance Summary Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {branches.map(branch => {
                const mShifts = shifts.filter(s => s.date.startsWith(selectedExportMonth) && s.branchId === branch.id);
                const req = mShifts.reduce((acc, s) => acc + s.requiredCount, 0);
                const filled = mShifts.reduce((acc, s) => acc + s.currentCount, 0);
                const shortage = Math.max(0, req - filled);
                const shortageRate = req > 0 ? Math.round((shortage / req) * 100) : 0;
                
                const bShiftIds = new Set(mShifts.map(s => s.id));
                const bApps = applications.filter(a => bShiftIds.has(a.shiftId));
                const uniqueVols = new Set(bApps.map(a => a.volunteerName || a.lineId)).size;
                const totalVols = Math.max(uniqueVols, filled);

                const totalHours = Math.round(mShifts.reduce((acc, s) => {
                  return acc + (s.currentCount * calculateShiftDurationHours(s.timeRange));
                }, 0));

                return (
                  <div key={branch.id} className="bg-[#fdfdfb] p-5 rounded-2xl border border-[#5A5A40]/15 space-y-3 hover:shadow-xs transition">
                    <div className="flex items-center justify-between border-b border-[#5A5A40]/10 pb-2">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-[#5A5A40]" />
                        <span className="font-bold font-serif text-slate-900 text-sm">{branch.name}</span>
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
                        <span className="font-extrabold text-[#5A5A40] font-mono text-base">{totalHours} <span className="text-[10px] font-sans font-normal">hr</span></span>
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
                        className="text-[#5A5A40] font-bold hover:underline flex items-center gap-0.5 cursor-pointer"
                      >
                        <span>開啟詳細報表</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
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
                className="bg-[#5A5A40] hover:bg-[#484833] text-white font-bold px-3 py-1.5 rounded-xl text-xs shadow-xs transition flex items-center gap-1.5 shrink-0 cursor-pointer"
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
                <div className="bg-[#fdfdfb] p-4 rounded-2xl border border-amber-200/80 shadow-2xs space-y-1">
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
                <div className="bg-[#fdfdfb] p-4 rounded-2xl border border-[#5A5A40]/15 shadow-2xs space-y-1">
                  <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1">
                    <MessageSquare className="w-3.5 h-3.5 text-[#5A5A40]" />
                    已收集 LINE 回饋數
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold text-[#5A5A40] font-mono">{totalCount}</span>
                    <span className="text-xs text-slate-500 font-bold">筆心得建議</span>
                  </div>
                  <span className="text-[10px] text-emerald-700 font-semibold block pt-0.5">
                    🟢 回應回收率 100%
                  </span>
                </div>

                {/* High Rating Percentage */}
                <div className="bg-[#fdfdfb] p-4 rounded-2xl border border-emerald-200/80 shadow-2xs space-y-1">
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
                <div className="bg-[#fdfdfb] p-4 rounded-2xl border border-emerald-200/80 shadow-2xs space-y-1">
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

              {/* Per-Branch Breakdown Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {branches.map(branch => {
                  const bFeedbacks = feedbackRecords.filter(r => r.branchId === branch.id);
                  const bSum = bFeedbacks.reduce((acc, r) => acc + (r.rating || 5), 0);
                  const bAvg = bFeedbacks.length > 0 ? (bSum / bFeedbacks.length).toFixed(1) : '5.0';

                  return (
                    <div key={branch.id} className="bg-[#f5f5f0]/60 p-3.5 rounded-2xl border border-[#5A5A40]/12 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-[#5A5A40]" />
                        <div>
                          <span className="font-bold text-slate-900 block">{branch.name}</span>
                          <span className="text-[10px] text-slate-500">已收集 {bFeedbacks.length} 筆回饋</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-extrabold text-amber-600 text-sm font-mono flex items-center gap-1">
                          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                          <span>{bAvg}</span>
                        </div>
                        <span className="text-[10px] text-slate-400 font-normal">據點均分</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Filter and Search Toolbar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#f5f5f0]/80 p-3 rounded-2xl border border-[#5A5A40]/12">
                {/* Search Input */}
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={feedbackSearchTerm}
                    onChange={e => setFeedbackSearchTerm(e.target.value)}
                    placeholder="搜尋志工姓名、回饋關鍵字..."
                    className="w-full pl-8 pr-3 py-1.5 bg-white border border-[#5A5A40]/20 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#5A5A40]"
                  />
                </div>

                {/* Rating Filter Pills */}
                <div className="flex items-center gap-1.5 self-start sm:self-auto text-xs font-bold">
                  <span className="text-slate-500 text-[11px] mr-1">篩選評分：</span>
                  <button
                    onClick={() => setFeedbackRatingFilter('all')}
                    className={`px-3 py-1 rounded-xl transition cursor-pointer border ${
                      feedbackRatingFilter === 'all'
                        ? 'bg-[#5A5A40] text-white border-[#5A5A40]'
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
                    if (selectedBranch !== 'all' && r.branchId !== selectedBranch) return false;
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
                      <div className="col-span-2 bg-[#fdfdfb] p-8 text-center rounded-2xl border border-dashed border-[#5A5A40]/20 text-slate-400 italic text-xs">
                        尚無符合條件的志工回饋紀錄，請至「簽到系統」完成一次離場簽退以測試 LINE 提醒收集功能！
                      </div>
                    );
                  }

                  return filtered.map(item => {
                    const branchName = branches.find(b => b.id === item.branchId)?.name || '總部園區';
                    const ratingVal = item.rating || 5;
                    const isAcknowledged = acknowledgedFeedbackIds.includes(item.id);

                    return (
                      <div
                        key={item.id}
                        className="bg-[#fdfdfb] p-5 rounded-2xl border border-[#5A5A40]/15 shadow-2xs hover:shadow-xs transition space-y-3 flex flex-col justify-between"
                      >
                        <div className="space-y-2.5">
                          {/* Header Line */}
                          <div className="flex items-start justify-between gap-2 border-b border-[#5A5A40]/10 pb-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900 text-sm font-serif">{item.volunteerName}</span>
                                <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-mono">
                                  LINE: @{item.lineId || '已驗證'}
                                </span>
                              </div>
                              <span className="text-[11px] text-[#5A5A40] font-medium block mt-0.5">
                                📍 {branchName} ｜ {item.shiftTitle}
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

                        {/* Footer Status and Actions */}
                        <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-100 text-slate-500">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-bold text-[10px]">
                              <MessageSquare className="w-3 h-3 text-emerald-600" />
                              <span>回饋收集時間: {item.feedbackSubmittedAt || item.checkOutTime || '今天'}</span>
                            </span>
                          </div>

                          <button
                            onClick={() => {
                              if (isAcknowledged) {
                                setAcknowledgedFeedbackIds(prev => prev.filter(i => i !== item.id));
                              } else {
                                setAcknowledgedFeedbackIds(prev => [...prev, item.id]);
                                onSendLineToast(`💬 已將【${item.volunteerName}】之建議註記為社工團隊參採與歸檔！`);
                              }
                            }}
                            className={`px-2.5 py-1 rounded-xl font-bold transition flex items-center gap-1 cursor-pointer border ${
                              isAcknowledged
                                ? 'bg-emerald-700 text-white border-emerald-700'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                            }`}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>{isAcknowledged ? '社工已參採 👍' : '標記為已參採'}</span>
                          </button>
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
          title="7. 場域色標與分區排班卡片列表"
          subtitle="依據場域屬性（狗園放風、貓舍清潔、幼犬餵食、醫療協助）進行即時招募與報名管理"
          icon={<Building2 className="w-5 h-5 text-amber-300" />}
          badgeText="5 大場域"
          badgeColor="bg-[#E6E2D3] text-[#5A5A40]"
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
                    ? 'bg-[#5A5A40] text-white shadow-2xs'
                    : 'bg-[#f5f5f0] text-slate-600 hover:bg-[#E6E2D3]'
                }`}
              >
                全部
              </button>
              <button
                onClick={() => setSelectedDateFilter('today')}
                className={`px-3 py-1 rounded-xl font-bold transition cursor-pointer ${
                  selectedDateFilter === 'today'
                    ? 'bg-[#5A5A40] text-white shadow-2xs'
                    : 'bg-[#f5f5f0] text-slate-600 hover:bg-[#E6E2D3]'
                }`}
              >
                今日
              </button>
              <button
                onClick={() => setSelectedDateFilter('upcoming')}
                className={`px-3 py-1 rounded-xl font-bold transition cursor-pointer ${
                  selectedDateFilter === 'upcoming'
                    ? 'bg-[#5A5A40] text-white shadow-2xs'
                    : 'bg-[#f5f5f0] text-slate-600 hover:bg-[#E6E2D3]'
                }`}
              >
                未來班次
              </button>
            </div>
          }
          collapsedSummary={
            <span>
              5大場域排班概況：{zoneStats.map(z => `${z.config.name} (${z.filled}/${z.required}人)`).join('、')}
            </span>
          }
        >
          <div className="space-y-6">
            {/* Zone-based Staffing Cards (Red, Green, Blue, Yellow, Purple) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {zoneStats.map(({ config, shifts: zShifts, required, filled, gap, isFull }) => (
          <div
            key={config.id}
            className={`rounded-[28px] border border-[#5A5A40]/12 bg-white p-6 transition shadow-xs hover:border-[#5A5A40]/30 flex flex-col justify-between space-y-4`}
          >
            <div>
              {/* Card Title & Icon */}
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <span className="text-3xl p-2.5 bg-[#f5f5f0] rounded-2xl shadow-2xs border border-[#5A5A40]/10">
                    {config.icon}
                  </span>
                  <div>
                    <h4 className="font-bold font-serif text-[#5A5A40] text-base">
                      {config.name}
                    </h4>
                    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full inline-block mt-1 ${config.badgeBg}`}>
                      日曆色彩標籤: {config.color}
                    </span>
                  </div>
                </div>

                {/* Status Badge */}
                {gap > 0 ? (
                  <span className="bg-rose-500 text-white text-[11px] font-bold px-3 py-1 rounded-full animate-pulse shadow-2xs">
                    缺 {gap} 人 (救援中)
                  </span>
                ) : required > 0 ? (
                  <span className="bg-emerald-700 text-white text-[11px] font-bold px-3 py-1 rounded-full shadow-2xs">
                    喵力滿點 (已滿班)
                  </span>
                ) : (
                  <span className="bg-slate-100 text-slate-500 text-[11px] font-medium px-3 py-1 rounded-full">
                    無排班
                  </span>
                )}
              </div>

              {/* Description */}
              <p className="text-xs text-slate-600 mt-3 leading-relaxed font-sans">
                {config.description}
              </p>

              {/* Progress */}
              <div className="mt-4 pt-3 border-t border-[#5A5A40]/10">
                <div className="flex justify-between text-xs font-medium mb-1.5 text-slate-700">
                  <span className="font-sans text-slate-500">登記入數狀態</span>
                  <span className="font-bold text-[#5A5A40]">{filled} / {required} 人 ({required > 0 ? Math.round((filled / required) * 100) : 0}%)</span>
                </div>
                <div className="w-full bg-[#f5f5f0] rounded-full h-2.5 overflow-hidden">
                  <div
                    className="h-2.5 rounded-full transition-all duration-500"
                    style={{
                      width: `${required > 0 ? Math.min((filled / required) * 100, 100) : 0}%`,
                      backgroundColor: config.color
                    }}
                  ></div>
                </div>
              </div>

              {/* Shifts in this zone */}
              <div className="mt-4 space-y-2">
                <p className="text-[11px] font-bold text-[#5A5A40] uppercase tracking-wider">
                  本區待補班次 ({zShifts.length})：
                </p>
                {zShifts.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">目前該區域尚無發布班次</p>
                ) : (
                  zShifts.slice(0, 2).map(s => (
                    <div
                      key={s.id}
                      className="bg-[#fdfdfb] p-3 rounded-2xl border border-[#5A5A40]/10 text-xs flex justify-between items-center"
                    >
                      <div>
                        <p className="font-semibold text-slate-800 line-clamp-1">{s.title}</p>
                        <p className="text-[11px] text-slate-500">{s.date} ({s.timeRange})</p>
                      </div>
                      <button
                        onClick={() => onApplyForShift(s.id)}
                        disabled={s.currentCount >= s.requiredCount}
                        className={`px-3 py-1 rounded-full text-[11px] font-bold cursor-pointer transition ${
                          s.currentCount >= s.requiredCount
                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            : 'bg-[#5A5A40] hover:bg-[#484833] text-white shadow-2xs'
                        }`}
                      >
                        {s.currentCount >= s.requiredCount ? '已滿班' : '報名支援'}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-[#5A5A40]/10 flex justify-between items-center text-xs">
              <span className="text-slate-500">自動綁定 Google 地圖據點</span>
              <button
                onClick={() => onNavigateToTab('positions')}
                className="font-bold text-[#5A5A40] hover:underline flex items-center gap-0.5 cursor-pointer"
              >
                <span>管理本區班次</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Staffing Gap Immediate Attention List */}
      <div className="bg-white rounded-[32px] border border-[#5A5A40]/12 p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-[#5A5A40]/10 gap-2">
          <div>
            <h3 className="text-xl font-bold font-serif italic text-[#5A5A40] flex items-center gap-2">
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
              className="text-xs bg-[#f5f5f0] hover:bg-[#E6E2D3] text-[#5A5A40] px-4 py-2 rounded-full font-bold transition cursor-pointer"
            >
              檢視全部 {shifts.length} 個班次
            </button>
          </div>
        </div>

        <div className="mt-4 divide-y divide-[#5A5A40]/10">
          {filteredShifts
            .filter(s => s.requiredCount > s.currentCount)
            .map(shift => {
              const zoneConf = ZONE_CONFIGS[shift.zone];
              const branch = branches.find(b => b.id === shift.branchId);
              const remaining = shift.requiredCount - shift.currentCount;

              return (
                <div key={shift.id} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-[#f5f5f0]/60 p-3 rounded-2xl transition">
                  <div className="flex items-start space-x-3">
                    <span className="text-2xl p-2.5 bg-[#f5f5f0] border border-[#5A5A40]/10 rounded-2xl">
                      {zoneConf?.icon || '🐾'}
                    </span>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${zoneConf?.badgeBg}`}>
                          {zoneConf?.name}
                        </span>
                        <span className="text-xs text-slate-500 flex items-center gap-1 font-medium">
                          <MapPin className="w-3 h-3 text-[#5A5A40]" />
                          {branch?.name}
                        </span>
                      </div>
                      <h4 className="font-bold text-slate-800 text-base mt-1">
                        {shift.title}
                      </h4>
                      <div className="flex items-center space-x-3 text-xs text-slate-500 mt-1">
                        <span className="flex items-center gap-1 font-bold text-[#5A5A40]">
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
                      className="bg-[#5A5A40] hover:bg-[#484833] text-white font-bold text-xs px-4 py-2.5 rounded-full shadow-xs transition cursor-pointer whitespace-nowrap"
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
        <UrgentShortageModal
          shifts={shifts}
          branches={branches}
          onClose={() => setShowUrgentModal(false)}
          onSendLineToast={onSendLineToast}
          onApplyForShift={onApplyForShift}
        />
      )}

      {/* Modal: Monthly Report PDF / CSV Preview */}
      {showReportModal && (
        <MonthlyReportModal
          month={selectedExportMonth}
          branches={branches}
          shifts={shifts}
          applications={applications}
          onClose={() => setShowReportModal(false)}
          onSendLineToast={onSendLineToast}
        />
      )}

    </div>
  );
};
