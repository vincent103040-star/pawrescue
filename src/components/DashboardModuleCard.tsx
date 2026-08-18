import React from 'react';
import { ChevronDown, ChevronUp, EyeOff, Maximize2, Minimize2 } from 'lucide-react';

export interface DashboardModuleCardProps {
  id: string;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  badge?: string;
  badgeColor?: string;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onHide: () => void;
  collapsedSummary?: React.ReactNode;
  children: React.ReactNode;
  extraHeaderActions?: React.ReactNode;
  className?: string;
}

export const DashboardModuleCard: React.FC<DashboardModuleCardProps> = ({
  id,
  title,
  subtitle,
  icon,
  badge,
  badgeColor = 'bg-amber-100 text-amber-900 border-amber-300',
  isCollapsed,
  onToggleCollapse,
  onHide,
  collapsedSummary,
  children,
  extraHeaderActions,
  className = ''
}) => {
  return (
    <div
      id={`module-${id}`}
      className={`bg-white rounded-[32px] border border-[#5A5A40]/15 shadow-xs transition-all duration-300 overflow-hidden ${className}`}
    >
      {/* Module Header Bar */}
      <div className={`p-5 sm:p-6 transition-colors ${isCollapsed ? 'bg-[#fafaf7] hover:bg-[#f5f5f0]/80' : 'border-b border-[#5A5A40]/10'}`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          
          {/* Left Title & Status Section (Clickable to toggle collapse) */}
          <div
            onClick={onToggleCollapse}
            className="flex items-start sm:items-center gap-3.5 cursor-pointer select-none group flex-1"
          >
            {icon && (
              <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-[#5A5A40] text-amber-300 flex items-center justify-center shrink-0 shadow-xs group-hover:scale-105 transition-transform">
                {icon}
              </div>
            )}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg sm:text-xl font-bold font-serif italic text-slate-900 group-hover:text-[#5A5A40] transition-colors">
                  {title}
                </h3>
                {badge && (
                  <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border ${badgeColor}`}>
                    {badge}
                  </span>
                )}
                {isCollapsed && (
                  <span className="text-[10px] bg-slate-200 text-slate-700 font-bold px-2 py-0.5 rounded-full">
                    已收合折疊
                  </span>
                )}
              </div>
              {subtitle && !isCollapsed && (
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed font-sans">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          {/* Right Action Tools */}
          <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
            {/* Custom Extra Header Actions (Only when expanded) */}
            {!isCollapsed && extraHeaderActions && (
              <div className="flex items-center gap-2 mr-2">
                {extraHeaderActions}
              </div>
            )}

            {/* Collapse / Expand Button */}
            <button
              type="button"
              onClick={onToggleCollapse}
              title={isCollapsed ? '展開此模組' : '折疊收合此模組'}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#f5f5f0] hover:bg-[#E6E2D3] text-[#5A5A40] border border-[#5A5A40]/15 transition flex items-center gap-1.5 cursor-pointer shadow-2xs active:scale-95"
            >
              {isCollapsed ? (
                <>
                  <ChevronDown className="w-4 h-4 text-[#5A5A40]" />
                  <span>展開</span>
                </>
              ) : (
                <>
                  <ChevronUp className="w-4 h-4 text-[#5A5A40]" />
                  <span>折疊</span>
                </>
              )}
            </button>

            {/* Hide Module Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onHide();
              }}
              title="從看板暫時隱藏（可隨時於自訂模組選單中重新開啟）"
              className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition cursor-pointer"
            >
              <EyeOff className="w-4 h-4" />
            </button>
          </div>

        </div>

        {/* Collapsed State Quick Preview Line */}
        {isCollapsed && (
          <div
            onClick={onToggleCollapse}
            className="mt-3 pt-3 border-t border-[#5A5A40]/10 flex items-center justify-between text-xs text-slate-600 cursor-pointer"
          >
            <div className="flex items-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap">
              <span className="font-bold text-[#5A5A40] shrink-0">📌 模組摘要：</span>
              <span className="text-slate-600 truncate">
                {collapsedSummary || '點擊展開以檢視此功能之完整互動數據與排班細節'}
              </span>
            </div>
            <span className="text-[11px] font-bold text-[#5A5A40] hover:underline shrink-0 ml-3 flex items-center gap-0.5">
              <span>點擊展開檢視</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </span>
          </div>
        )}
      </div>

      {/* Main Module Content Body */}
      {!isCollapsed && (
        <div className="p-6 sm:p-8 space-y-6 animate-fadeIn">
          {children}
        </div>
      )}
    </div>
  );
};
