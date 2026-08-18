import React, { useState } from 'react';
import { 
  SlidersHorizontal, 
  Check, 
  Eye, 
  EyeOff, 
  RotateCcw, 
  Sparkles, 
  ChevronUp, 
  ChevronDown, 
  Layers, 
  CheckSquare, 
  Square,
  HelpCircle,
  X
} from 'lucide-react';

export type DashboardModuleId = 
  | 'overview_stats'
  | 'heatmap'
  | 'ai_warning_map'
  | 'daily_duty'
  | 'monthly_report'
  | 'feedback_hub'
  | 'zone_shortage';

export interface ModuleDefinition {
  id: DashboardModuleId;
  name: string;
  category: 'core' | 'ai_d3' | 'operations';
  categoryLabel: string;
  icon: string;
  description: string;
  badge?: string;
  badgeColor?: string;
  defaultVisible: boolean;
}

export const DASHBOARD_MODULE_DEFS: ModuleDefinition[] = [
  {
    id: 'overview_stats',
    name: '1. 關鍵招募與排班指標 (KPI 統計總覽)',
    category: 'core',
    categoryLabel: '📊 基礎核心數據',
    icon: '📊',
    description: '即時計算缺工人數、排班達成率 (%)、待審核申請件數與據點總覽。',
    badge: '即時數據',
    badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    defaultVisible: true
  },
  {
    id: 'heatmap',
    name: '2. 志工參與與缺工『D3.js 熱力圖』分析',
    category: 'ai_d3',
    categoryLabel: '📈 圖表與視覺化',
    icon: '📈',
    description: 'D3.js 矩陣視覺化一週 7 天 x 4 個時段或各據點的缺工尖峰與到勤密度。',
    badge: 'D3.js 動態',
    badgeColor: 'bg-rose-100 text-rose-800 border-rose-300',
    defaultVisible: true
  },
  {
    id: 'ai_warning_map',
    name: '3. 資源需求預警 & 雙週物資人力 AI 預測地圖',
    category: 'ai_d3',
    categoryLabel: '📈 圖表與視覺化',
    icon: '🔮',
    description: 'Gemini AI 運算 434 隻收容動物與缺工率，自動推估次週糧食、醫療耗材與人力缺口。',
    badge: 'Gemini 3.6 Flash',
    badgeColor: 'bg-amber-100 text-amber-900 border-amber-300',
    defaultVisible: true
  },
  {
    id: 'daily_duty',
    name: '4. 每日志工勤務看板 & SOP 執行追蹤',
    category: 'operations',
    categoryLabel: '📋 營運與現場管理',
    icon: '📋',
    description: '現場值日組長專用 SOP 檢核表，包含清潔消毒、散步放風、醫療照護與安全叮嚀。',
    badge: 'SOP 檢核',
    badgeColor: 'bg-indigo-100 text-indigo-800 border-indigo-300',
    defaultVisible: true
  },
  {
    id: 'monthly_report',
    name: '5. 月度據點績效統計與報表匯出 (CSV / PDF)',
    category: 'operations',
    categoryLabel: '📋 營運與現場管理',
    icon: '📑',
    description: '統計當月各分院志工人數、總服務時數與缺工率，支援一鍵下載 CSV 與 PDF 報表。',
    badge: 'CSV / PDF',
    badgeColor: 'bg-teal-100 text-teal-800 border-teal-300',
    defaultVisible: true
  },
  {
    id: 'feedback_hub',
    name: '6. 志工服務回饋與滿意度彙整中心 (SMS Feedback)',
    category: 'operations',
    categoryLabel: '📋 營運與現場管理',
    icon: '⭐️',
    description: '志工離場簽退時簡訊收集 1-5 星評分與改善建議，提供社工團隊即時審閱參採。',
    badge: '簡訊回饋',
    badgeColor: 'bg-amber-100 text-amber-900 border-amber-300',
    defaultVisible: true
  },
  {
    id: 'zone_shortage',
    name: '7. 動物之家場域 (Zone) 色標管理與即時排班卡片',
    category: 'core',
    categoryLabel: '📊 基礎核心數據',
    icon: '🎨',
    description: '依貓舍(粉)、犬舍(棕)、幼犬隔離(綠)、醫療(藍)、後勤(金)分區色標檢視人力。',
    badge: '場域色彩',
    badgeColor: 'bg-[#E6E2D3] text-[#5A5A40] border-[#5A5A40]/30',
    defaultVisible: true
  }
];

export const DASHBOARD_MODULE_CONFIGS = DASHBOARD_MODULE_DEFS;

export const DEFAULT_VISIBLE_MODULES: Record<DashboardModuleId, boolean> = {
  overview_stats: true,
  heatmap: true,
  ai_warning_map: true,
  daily_duty: true,
  monthly_report: true,
  feedback_hub: true,
  zone_shortage: true
};

export const DEFAULT_COLLAPSED_MODULES: Record<DashboardModuleId, boolean> = {
  overview_stats: false,
  heatmap: false,
  ai_warning_map: false,
  daily_duty: false,
  monthly_report: false,
  feedback_hub: false,
  zone_shortage: false
};

interface DashboardModuleCustomizerProps {
  visibleModules: Record<DashboardModuleId, boolean>;
  collapsedModules: Record<DashboardModuleId, boolean>;
  onToggleModuleVisibility: (id: DashboardModuleId) => void;
  onSetAllModulesVisibility: (visible: boolean) => void;
  onApplyPreset: (preset: 'all' | 'focus_schedule' | 'focus_operations') => void;
  onToggleAllCollapse: (collapsed: boolean) => void;
}

export const DashboardModuleCustomizer: React.FC<DashboardModuleCustomizerProps> = ({
  visibleModules,
  collapsedModules,
  onToggleModuleVisibility,
  onSetAllModulesVisibility,
  onApplyPreset,
  onToggleAllCollapse
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  const totalCount = DASHBOARD_MODULE_DEFS.length;
  const visibleCount = DASHBOARD_MODULE_DEFS.filter(m => visibleModules[m.id]).length;
  const hiddenCount = totalCount - visibleCount;

  const totalCollapsedCount = DASHBOARD_MODULE_DEFS.filter(m => visibleModules[m.id] && collapsedModules[m.id]).length;

  return (
    <div className="relative z-20">
      {/* Trigger & Quick Status Bar */}
      <div className="bg-white/90 backdrop-blur-md p-3 sm:p-4 rounded-2xl border border-[#5A5A40]/15 shadow-xs flex flex-wrap items-center justify-between gap-3">
        
        {/* Left Status & Title */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-[#5A5A40] text-amber-300 flex items-center justify-center font-bold text-sm shadow-2xs">
            <SlidersHorizontal className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs sm:text-sm font-bold font-serif text-slate-900">
                看板模組個人化自訂
              </span>
              <span className="text-[11px] font-mono font-bold bg-[#E6E2D3] text-[#5A5A40] px-2 py-0.5 rounded-full">
                {visibleCount} / {totalCount} 模組啟用中
              </span>
            </div>
            <p className="text-[11px] text-slate-500 hidden sm:block">
              自由勾選開啟/隱藏子功能，或點擊各卡片右上角隨時展開/折疊
            </p>
          </div>
        </div>

        {/* Right Action Buttons */}
        <div className="flex items-center gap-2">
          
          {/* Quick Collapse / Expand All button */}
          <button
            type="button"
            onClick={() => onToggleAllCollapse(totalCollapsedCount === 0)}
            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#f5f5f0] hover:bg-[#E6E2D3] text-[#5A5A40] border border-[#5A5A40]/15 transition flex items-center gap-1 cursor-pointer active:scale-95"
            title={totalCollapsedCount === 0 ? '一鍵全部折疊' : '一鍵全部展開'}
          >
            {totalCollapsedCount === 0 ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>全部折疊</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>全部展開</span>
              </>
            )}
          </button>

          {/* Open Customizer Dropdown / Popover Button */}
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-2xs active:scale-95 ${
              isOpen
                ? 'bg-[#5A5A40] text-white ring-2 ring-[#5A5A40]/30'
                : 'bg-amber-600 hover:bg-amber-700 text-white'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>⚙️ 自訂顯示模組</span>
            {hiddenCount > 0 && (
              <span className="bg-white text-amber-900 font-mono text-[10px] font-extrabold px-1.5 py-0.2 rounded-full">
                隱藏 {hiddenCount}
              </span>
            )}
          </button>
        </div>

      </div>

      {/* Hidden Modules Floating Reminder Strip */}
      {hiddenCount > 0 && !isOpen && (
        <div className="mt-2 bg-amber-50 border border-amber-200 px-4 py-2 rounded-xl flex items-center justify-between text-xs text-amber-900 shadow-2xs animate-fadeIn">
          <div className="flex items-center gap-2">
            <EyeOff className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              目前已隱藏 <strong>{hiddenCount} 個子功能模組</strong>（
              {DASHBOARD_MODULE_DEFS.filter(m => !visibleModules[m.id]).map(m => m.name.split(' ')[0]).join('、')}
              ）
            </span>
          </div>
          <button
            type="button"
            onClick={() => onSetAllModulesVisibility(true)}
            className="text-[11px] font-bold text-amber-800 hover:text-amber-950 underline hover:no-underline ml-2 shrink-0 cursor-pointer"
          >
            一鍵全部恢復顯示 →
          </button>
        </div>
      )}

      {/* Popover / Customizer Drawer Modal */}
      {isOpen && (
        <div className="mt-3 bg-white rounded-3xl border-2 border-[#5A5A40]/20 shadow-xl p-5 sm:p-6 space-y-5 animate-fadeIn">
          
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#5A5A40]/10 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-900 flex items-center justify-center font-bold text-sm">
                ⚙️
              </div>
              <div>
                <h4 className="font-bold font-serif text-slate-900 text-base">
                  「1. 缺工統計看板」子功能顯示管理
                </h4>
                <p className="text-xs text-slate-500">
                  勾選要啟用的功能區塊，設定將自動儲存於瀏覽器，下次登入保持您的專屬配置。
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Quick Presets Bar */}
          <div className="flex flex-wrap items-center gap-2 bg-[#f5f5f0] p-3 rounded-2xl border border-[#5A5A40]/10">
            <span className="text-xs font-bold text-[#5A5A40] flex items-center gap-1 mr-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              快速預設模式：
            </span>
            
            <button
              type="button"
              onClick={() => onApplyPreset('all')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                visibleCount === totalCount
                  ? 'bg-[#5A5A40] text-white shadow-2xs'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              🌟 完整全覽模式 ({totalCount}個)
            </button>

            <button
              type="button"
              onClick={() => onApplyPreset('focus_schedule')}
              className="px-3 py-1 rounded-xl text-xs font-bold bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 transition cursor-pointer"
            >
              🎯 排班分析專注 (熱力圖+AI+場域)
            </button>

            <button
              type="button"
              onClick={() => onApplyPreset('focus_operations')}
              className="px-3 py-1 rounded-xl text-xs font-bold bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 transition cursor-pointer"
            >
              📋 現場營運專注 (SOP+績效+回饋)
            </button>

            <button
              type="button"
              onClick={() => onSetAllModulesVisibility(true)}
              className="ml-auto text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer py-1 px-2"
            >
              <RotateCcw className="w-3 h-3" />
              <span>重設預設</span>
            </button>
          </div>

          {/* Modules List Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            {DASHBOARD_MODULE_DEFS.map((mod) => {
              const isVisible = visibleModules[mod.id];
              const isCollapsed = collapsedModules[mod.id];

              return (
                <div
                  key={mod.id}
                  onClick={() => onToggleModuleVisibility(mod.id)}
                  className={`p-4 rounded-2xl border transition-all flex items-start gap-3 cursor-pointer select-none ${
                    isVisible
                      ? 'bg-white border-[#5A5A40]/25 shadow-xs hover:border-[#5A5A40]'
                      : 'bg-slate-50/70 border-slate-200 opacity-60 hover:opacity-90'
                  }`}
                >
                  {/* Checkbox */}
                  <div className="pt-0.5">
                    {isVisible ? (
                      <div className="w-5 h-5 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-lg border-2 border-slate-300 bg-white shrink-0"></div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="text-base">{mod.icon}</span>
                        <span className={`text-xs font-bold truncate ${isVisible ? 'text-slate-900' : 'text-slate-500'}`}>
                          {mod.name}
                        </span>
                      </div>
                      {mod.badge && (
                        <span className={`text-[10px] font-extrabold px-2 py-0.2 rounded-full border shrink-0 ${mod.badgeColor}`}>
                          {mod.badge}
                        </span>
                      )}
                    </div>
                    
                    <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                      {mod.description}
                    </p>

                    <div className="mt-2 flex items-center gap-2 text-[10px]">
                      <span className={`font-bold px-2 py-0.5 rounded-full ${
                        isVisible ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {isVisible ? '● 顯示中' : '○ 已隱藏'}
                      </span>
                      {isVisible && isCollapsed && (
                        <span className="bg-amber-50 text-amber-800 font-bold px-2 py-0.5 rounded-full border border-amber-200">
                          已收合
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-[#5A5A40]/10 pt-3">
            <span className="text-xs text-slate-500">
              💡 提示：您也可以在各模組卡片的右上角，隨時點選 <strong>「折疊」</strong> 或 <strong>「隱藏」</strong> 按鈕進行即時縮放。
            </span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="bg-[#5A5A40] hover:bg-[#484833] text-white font-bold px-5 py-2 rounded-xl text-xs shadow-xs transition cursor-pointer"
            >
              完成配置並返回
            </button>
          </div>

        </div>
      )}
    </div>
  );
};
