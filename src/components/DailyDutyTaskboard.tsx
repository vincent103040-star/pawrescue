import React, { useState } from 'react';
import { PositionShift, Branch, BranchId, ZoneCategory } from '../types';
import { ZONE_CONFIGS } from '../data/mockData';
import { 
  ClipboardCheck, 
  CheckSquare, 
  Square, 
  Sparkles, 
  Clock, 
  Building2, 
  AlertCircle, 
  CheckCircle2, 
  RotateCcw, 
  ShieldCheck, 
  Zap, 
  ListChecks, 
  Award,
  ChevronRight,
  Info,
  ChevronDown,
  ChevronUp,
  EyeOff
} from 'lucide-react';

interface SopItem {
  id: string;
  shiftId: string;
  shiftTitle: string;
  zone: ZoneCategory;
  category: string;
  title: string;
  description: string;
  isRequired: boolean;
  timeWindow: string;
  isCompleted: boolean;
  completedBy?: string;
  completedAt?: string;
}

interface DailyDutyTaskboardProps {
  shifts: PositionShift[];
  branches: Branch[];
  selectedBranch: BranchId | 'all';
  onSendLineToast: (msg: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onHide?: () => void;
}

export const DailyDutyTaskboard: React.FC<DailyDutyTaskboardProps> = ({
  shifts,
  branches,
  selectedBranch,
  onSendLineToast,
  isCollapsed = false,
  onToggleCollapse,
  onHide
}) => {
  // Follows the shelter's own timezone (Taiwan), not the browser/server's --
  // en-CA formats as YYYY-MM-DD, matching the date strings used elsewhere.
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

  // Filter today's shifts or active shifts
  const todayShifts = shifts.filter(s => {
    if (selectedBranch !== 'all' && s.branchId !== selectedBranch) return false;
    return s.date === todayStr || true; // Show today's shifts or standard daily template
  });

  // Initial SOP Checklist items derived from shift zone SOPs
  const [sopItems, setSopItems] = useState<SopItem[]>([
    {
      id: 'sop-1',
      shiftId: 'shift-1',
      shiftTitle: '狗園晨間運動與散步夥伴',
      zone: 'dog',
      category: '🐶 大狗放風與防護',
      title: '檢視胸背帶與雙扣牽繩牢固度',
      description: '出犬前務必確認扣環無鬆脫，確認大狗配載黃色/紅色個性識別絲帶。',
      isRequired: true,
      timeWindow: '09:00 - 09:30',
      isCompleted: true,
      completedBy: '林志豪 (資深志工)',
      completedAt: '09:15'
    },
    {
      id: 'sop-2',
      shiftId: 'shift-1',
      shiftTitle: '狗園晨間運動與散步夥伴',
      zone: 'dog',
      category: '🐶 大狗放風與防護',
      title: '草地放風便便清除與水份補充',
      description: '帶狗至陽明山/草山運動場，隨身攜帶拾便袋與飲水碗，每15分鐘補充水分。',
      isRequired: true,
      timeWindow: '09:30 - 11:30',
      isCompleted: true,
      completedBy: '陳雅婷',
      completedAt: '10:40'
    },
    {
      id: 'sop-3',
      shiftId: 'shift-1',
      shiftTitle: '狗園晨間運動與散步夥伴',
      zone: 'dog',
      category: '🐶 大狗放風與防護',
      title: '歸房體表檢查與趾縫清潔',
      description: '返回犬舍後檢查是否有壁虱、雜草刺黏附，並使用微濕毛巾擦拭四肢趾縫。',
      isRequired: true,
      timeWindow: '11:30 - 12:00',
      isCompleted: false
    },
    {
      id: 'sop-4',
      shiftId: 'shift-2',
      shiftTitle: '貓島貓咪照護與社會化陪伴',
      zone: 'cat',
      category: '🐱 貓房照護與親人訓練',
      title: '貓砂盆與貓房地板深層清理',
      description: '清理便便與尿塊，補滿豆腐貓砂至 5cm 厚度，並以寵物專用次氯酸水擦拭層架。',
      isRequired: true,
      timeWindow: '13:30 - 14:30',
      isCompleted: true,
      completedBy: '張小美',
      completedAt: '14:10'
    },
    {
      id: 'sop-5',
      shiftId: 'shift-2',
      shiftTitle: '貓島貓咪照護與社會化陪伴',
      zone: 'cat',
      category: '🐱 貓房照護與親人訓練',
      title: '膽小貓肉泥互動與梳毛減壓',
      description: '使用肉泥棒與親人梳子進行 20 分鐘減敏陪伴，記錄貓咪進食與允許摸頭狀況。',
      isRequired: false,
      timeWindow: '14:30 - 16:00',
      isCompleted: false
    },
    {
      id: 'sop-6',
      shiftId: 'shift-3',
      shiftTitle: '醫療區術後照護與陪伴助理',
      zone: 'medical',
      category: '🏥 醫療觀察與處方紀錄',
      title: '術後犬貓伊莉莎白圈與傷口檢查',
      description: '核對醫療卡，確認頭套有無脫落，檢查傷口是否有滲血或異常紅腫並紀錄。',
      isRequired: true,
      timeWindow: '10:00 - 10:30',
      isCompleted: true,
      completedBy: '黃建宏 (獸醫助理)',
      completedAt: '10:20'
    },
    {
      id: 'sop-7',
      shiftId: 'shift-3',
      shiftTitle: '醫療區術後照護與陪伴助理',
      zone: 'medical',
      category: '🏥 醫療觀察與處方紀錄',
      title: '口服處方藥物與高營養罐頭發放',
      description: '協助社工/獸醫師發給每隻觀察區浪浪對應藥包，確認完整吞服後核銷系統。',
      isRequired: true,
      timeWindow: '11:00 - 12:00',
      isCompleted: false
    },
    {
      id: 'sop-8',
      shiftId: 'shift-4',
      shiftTitle: '幼犬溫室餵奶與生活訓練',
      zone: 'puppy',
      category: '🍼 幼犬育幼與溫室清消',
      title: '幼犬體重測量與配方奶粉餵食',
      description: '使用電子秤紀錄幼犬晨間體重，沖泡 38°C 專用奶粉，觀察吮吸反應與便溺情況。',
      isRequired: true,
      timeWindow: '08:30 - 09:30',
      isCompleted: true,
      completedBy: '李心怡',
      completedAt: '09:10'
    }
  ]);

  const [selectedZoneFilter, setSelectedZoneFilter] = useState<string>('all');

  // Toggle SOP completion
  const handleToggleSop = (id: string) => {
    setSopItems(prev => prev.map(item => {
      if (item.id === id) {
        const nextCompleted = !item.isCompleted;
        const nowStr = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
        
        if (nextCompleted) {
          onSendLineToast(`✅ 已完成 SOP 項目：【${item.title}】！已記錄於每日志工勤務日誌。`);
        }

        return {
          ...item,
          isCompleted: nextCompleted,
          completedBy: nextCompleted ? '當前勤務志工' : undefined,
          completedAt: nextCompleted ? nowStr : undefined
        };
      }
      return item;
    }));
  };

  // Reset all
  const handleResetAll = () => {
    setSopItems(prev => prev.map(item => ({
      ...item,
      isCompleted: false,
      completedBy: undefined,
      completedAt: undefined
    })));
    onSendLineToast('🔄 已重置本日 SOP 檢查清單。');
  };

  // Filtered items
  const filteredItems = sopItems.filter(item => {
    if (selectedZoneFilter !== 'all' && item.zone !== selectedZoneFilter) return false;
    return true;
  });

  const totalCount = filteredItems.length;
  const completedCount = filteredItems.filter(i => i.isCompleted).length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const requiredTotal = filteredItems.filter(i => i.isRequired).length;
  const requiredCompleted = filteredItems.filter(i => i.isRequired && i.isCompleted).length;

  return (
    <div
      id="module-daily_duty"
      className="bg-white rounded-[32px] border border-[#5A5A40]/15 p-6 sm:p-8 shadow-xs space-y-6 transition-all duration-300 overflow-hidden"
    >
      {/* Header Bar */}
      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 ${isCollapsed ? '' : 'border-b border-[#5A5A40]/10 pb-4'}`}>
        <div
          onClick={onToggleCollapse}
          className="flex items-start gap-3 cursor-pointer select-none group"
        >
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-[#5A5A40] text-amber-300 flex items-center justify-center shrink-0 shadow-xs font-bold group-hover:scale-105 transition-transform">
            <ClipboardCheck className="w-6 h-6 text-amber-300" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-bold font-serif italic text-slate-900 group-hover:text-[#5A5A40] transition-colors">
                4. 每日志工勤務看板 &amp; SOP 執行追蹤
              </h3>
              <span className="bg-[#E6E2D3] text-[#5A5A40] text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border border-[#5A5A40]/20">
                今日日期: {todayStr}
              </span>
              {isCollapsed && (
                <span className="text-[10px] bg-slate-200 text-slate-700 font-bold px-2 py-0.5 rounded-full">
                  已收合折疊
                </span>
              )}
            </div>
            {!isCollapsed && (
              <p className="text-xs text-slate-500 mt-1">
                自動根據當日排班與各場域（狗園放風、貓房清理、醫療發藥、幼犬餵食）產出標準作業程序 (SOP) 清單，由值班志工實時核銷防呆。
              </p>
            )}
          </div>
        </div>

        {/* Quick Reset & Status Badge & Action Controls */}
        <div className="flex flex-wrap items-center gap-2 self-end md:self-auto shrink-0">
          {!isCollapsed && (
            <>
              <button
                type="button"
                onClick={handleResetAll}
                className="text-xs font-bold text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>重置全清單</span>
              </button>

              <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-3 py-1.5 rounded-2xl flex items-center gap-2 text-xs font-bold">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>必做 SOP：{requiredCompleted}/{requiredTotal} 完成</span>
              </div>
            </>
          )}

          {/* Collapse/Expand Toggle Button */}
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title={isCollapsed ? '展開此模組' : '折疊收合此模組'}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#f5f5f0] hover:bg-[#E6E2D3] text-[#5A5A40] border border-[#5A5A40]/15 transition flex items-center gap-1 cursor-pointer active:scale-95 shadow-2xs"
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
          )}

          {/* Hide Module Button */}
          {onHide && (
            <button
              type="button"
              onClick={onHide}
              title="從看板暫時隱藏（可隨時於自訂模組選單中重新開啟）"
              className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition cursor-pointer"
            >
              <EyeOff className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Collapsed State Summary Row */}
      {isCollapsed && (
        <div
          onClick={onToggleCollapse}
          className="pt-2 border-t border-[#5A5A40]/10 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-600 cursor-pointer gap-2"
        >
          <div className="flex items-center gap-2 overflow-hidden text-ellipsis">
            <span className="font-bold text-[#5A5A40] shrink-0">📌 勤務 SOP 摘要：</span>
            <span className="text-slate-700 truncate">
              今日進度 {completedCount} / {totalCount} 項目（必做 SOP {requiredCompleted} / {requiredTotal} 完成，整體達成率 {progressPct}%）
            </span>
          </div>
          <span className="text-[11px] font-bold text-[#5A5A40] hover:underline shrink-0 flex items-center gap-0.5">
            <span>點擊展開檢核清單</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </span>
        </div>
      )}

      {/* Main Expanded Content */}
      {!isCollapsed && (
        <div className="space-y-6 animate-fadeIn">
          {/* Progress & Milestone Bar */}
          <div className="bg-[#fdfdfb] p-5 rounded-2xl border border-[#5A5A40]/15 shadow-2xs space-y-3">
        <div className="flex items-center justify-between text-xs font-bold">
          <div className="flex items-center gap-2 text-slate-800">
            <ListChecks className="w-4 h-4 text-[#5A5A40]" />
            <span>今日 SOP 總達成進度 ({completedCount}/{totalCount} 項)</span>
          </div>
          <span className="text-base font-extrabold font-mono text-[#5A5A40]">
            {progressPct}%
          </span>
        </div>

        {/* Progress Line */}
        <div className="w-full bg-slate-200 h-3 rounded-full overflow-hidden p-0.5 border border-slate-300/50">
          <div 
            className="bg-gradient-to-r from-[#5A5A40] to-amber-500 h-full rounded-full transition-all duration-500 shadow-xs"
            style={{ width: `${progressPct}%` }}
          ></div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
          <span>必要防範 SOP (必填)：<strong className="text-slate-900">{requiredCompleted} / {requiredTotal}</strong></span>
          {progressPct === 100 ? (
            <span className="text-emerald-700 font-extrabold flex items-center gap-1">
              <Award className="w-3.5 h-3.5 text-emerald-600" />
              🎉 太棒了！今日所有標準作業程序已全數高標準完成！
            </span>
          ) : (
            <span>提示：點擊核選方框即可更新值班紀錄</span>
          )}
        </div>
      </div>

      {/* Zone Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500 font-bold text-[11px] mr-1">場域 SOP 篩選：</span>
        <button
          onClick={() => setSelectedZoneFilter('all')}
          className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer border ${
            selectedZoneFilter === 'all'
              ? 'bg-[#5A5A40] text-white border-[#5A5A40]'
              : 'bg-white text-slate-700 hover:bg-slate-100 border-slate-200'
          }`}
        >
          全部項目 ({sopItems.length})
        </button>
        {Object.keys(ZONE_CONFIGS).map(zKey => {
          const z = ZONE_CONFIGS[zKey];
          const zCount = sopItems.filter(i => i.zone === zKey).length;
          return (
            <button
              key={zKey}
              onClick={() => setSelectedZoneFilter(zKey)}
              className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1 cursor-pointer border ${
                selectedZoneFilter === zKey
                  ? 'bg-[#5A5A40] text-white border-[#5A5A40]'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border-slate-200'
              }`}
            >
              <span>{z.icon}</span>
              <span>{z.name} ({zCount})</span>
            </button>
          );
        })}
      </div>

      {/* Checklist Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredItems.map(item => {
          const zoneConf = ZONE_CONFIGS[item.zone];

          return (
            <div
              key={item.id}
              onClick={() => handleToggleSop(item.id)}
              className={`p-4 rounded-2xl border transition cursor-pointer flex items-start gap-3.5 shadow-2xs hover:shadow-xs ${
                item.isCompleted
                  ? 'bg-slate-50/80 border-slate-300 opacity-90'
                  : 'bg-[#fdfdfb] border-[#5A5A40]/20 hover:border-[#5A5A40]'
              }`}
            >
              {/* Checkbox Icon */}
              <div className="pt-0.5 shrink-0">
                {item.isCompleted ? (
                  <CheckSquare className="w-5 h-5 text-emerald-600 fill-emerald-100" />
                ) : (
                  <Square className="w-5 h-5 text-slate-400 hover:text-[#5A5A40]" />
                )}
              </div>

              {/* Content Body */}
              <div className="flex-1 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-[#5A5A40] font-serif">
                      {item.category}
                    </span>
                    {item.isRequired && (
                      <span className="bg-rose-100 text-rose-800 text-[9px] font-extrabold px-1.5 py-0.2 rounded-full border border-rose-200">
                        關鍵必做
                      </span>
                    )}
                  </div>

                  <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded-full">
                    <Clock className="w-3 h-3 text-slate-400" />
                    {item.timeWindow}
                  </span>
                </div>

                <h4 className={`font-bold text-sm leading-snug ${
                  item.isCompleted ? 'line-through text-slate-400' : 'text-slate-900'
                }`}>
                  {item.title}
                </h4>

                <p className={`text-xs leading-relaxed ${
                  item.isCompleted ? 'text-slate-400' : 'text-slate-600'
                }`}>
                  {item.description}
                </p>

                {/* Footer status */}
                {item.isCompleted && (
                  <div className="pt-1 text-[10px] text-emerald-700 font-bold flex items-center gap-1.5 border-t border-slate-200/60 mt-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>核銷志工：{item.completedBy || '系統紀錄'} （{item.completedAt} 完成）</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
        </div>
      )}

    </div>
  );
};
