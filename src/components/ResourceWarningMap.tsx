import React, { useState, useEffect } from 'react';
import { Branch, PositionShift } from '../types';
import { 
  Bot, 
  Sparkles, 
  AlertTriangle, 
  ShieldAlert, 
  CheckCircle2, 
  MapPin, 
  Users, 
  Package, 
  Send, 
  RefreshCw, 
  TrendingUp, 
  Truck, 
  ExternalLink,
  ChevronRight,
  Info,
  ChevronDown,
  ChevronUp,
  EyeOff
} from 'lucide-react';

interface PredictionResult {
  branchId: string;
  branchName: string;
  riskLevel: 'critical' | 'warning' | 'normal';
  severityScore: number;
  animalCount: number;
  shortageRate: number;
  predictedManpowerGap: string;
  predictedMaterialGap: string;
  urgentActions: string[];
}

interface ResourceWarningMapProps {
  branches: Branch[];
  shifts: PositionShift[];
  onSendLineToast: (msg: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onHide?: () => void;
}

export const ResourceWarningMap: React.FC<ResourceWarningMapProps> = ({
  branches,
  shifts,
  onSendLineToast,
  isCollapsed = false,
  onToggleCollapse,
  onHide
}) => {
  const [selectedBranchId, setSelectedBranchId] = useState<string>('halfway'); // Default to critical risk branch
  const [isPredicting, setIsPredicting] = useState<boolean>(false);
  const [globalSummary, setGlobalSummary] = useState<string>(
    '根據 Gemini AI 分析全園區 3 個據點共 434 隻流浪動物與下週班次排程，草山狗園（陽明山）物資與志工人力正面臨顯著短缺預警，建議即刻啟動跨據點資源撥補。'
  );
  const [predictions, setPredictions] = useState<PredictionResult[]>([
    {
      branchId: 'halfway',
      branchName: '草山狗園中途之家 (陽明山)',
      riskLevel: 'critical',
      severityScore: 88,
      animalCount: 107,
      shortageRate: 62,
      predictedManpowerGap: '預測下週缺 18 人次（大狗運動場牽繩放風 10 人、醫療與復健照護 8 人），週末情況最為告急。',
      predictedMaterialGap: '大犬成犬飼料急缺 60 kg、傷口止血與無菌紗布短缺 30 包、大號胸背牽繩短缺 10 條。',
      urgentActions: [
        '即刻發送 LINE 官方帳號『陽明山假日大狗放風急召令』動員廣播',
        '請物資組由新店總部緊急調撥 30 kg 成犬乾糧與醫療包紮物資支援'
      ]
    },
    {
      branchId: 'cat_island',
      branchName: '貓島中途分院 (淡水館)',
      riskLevel: 'warning',
      severityScore: 65,
      animalCount: 80,
      shortageRate: 45,
      predictedManpowerGap: '預測下週缺 8 人次（幼貓親人與社會化陪伴 5 人、貓房環境清潔 3 人）。',
      predictedMaterialGap: '主食貓罐頭短缺 80 罐、無塵豆腐貓砂急缺 15 包、幼貓專用配方奶粉 5 罐。',
      urgentActions: [
        '啟動淡水分院假日參訪遊客『現場彈性體驗志工』招募方案',
        '優先安排新抵達之愛心捐贈貓砂轉運至淡水館倉庫'
      ]
    },
    {
      branchId: 'main',
      branchName: '浪浪總部園區 (新店本館)',
      riskLevel: 'normal',
      severityScore: 25,
      animalCount: 247,
      shortageRate: 28,
      predictedManpowerGap: '預測下週僅缺 5 人次（主要為醫療觀察區資深志工與幼犬溫室照顧班）。',
      predictedMaterialGap: '物資儲備充足，僅需補充幼犬尿墊 20 包與洗狗藥用泡泡露 5 瓶。',
      urgentActions: [
        '維持常態優良運作，作為大台北據點物資與人力支援樞紐',
        '規劃開辦二階段資深志工醫療照護認證培訓課程'
      ]
    }
  ]);

  const [lastPredictionTime, setLastPredictionTime] = useState<string>('11:48:00');

  // Trigger Gemini API Prediction
  const handleRunAiPrediction = async () => {
    setIsPredicting(true);

    // Prepare payload stats
    const branchStats = branches.map(b => {
      const bShifts = shifts.filter(s => s.branchId === b.id);
      const req = bShifts.reduce((acc, s) => acc + s.requiredCount, 0);
      const filled = bShifts.reduce((acc, s) => acc + s.currentCount, 0);
      const shortage = Math.max(0, req - filled);
      const shortageRate = req > 0 ? Math.round((shortage / req) * 100) : 0;
      
      let animalCount = 247;
      if (b.id === 'cat_island') animalCount = 80;
      if (b.id === 'halfway') animalCount = 107;

      return {
        branchId: b.id,
        branchName: b.name,
        animalCount,
        totalShiftsCount: bShifts.length,
        requiredVolunteers: req,
        currentVolunteers: filled,
        shortageRate
      };
    });

    try {
      const res = await fetch('/api/ai/predict-resource-gaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchData: branchStats })
      });

      const data = await res.json();
      if (data.success && data.predictions) {
        setPredictions(data.predictions);
        if (data.globalSummary) setGlobalSummary(data.globalSummary);
        const nowStr = new Date().toLocaleTimeString('zh-TW', { hour12: false });
        setLastPredictionTime(nowStr);
        onSendLineToast('🔮 Gemini 3.6 Flash 已完成全據點物資與人力缺口分析預測！');
      } else {
        onSendLineToast('⚠️ 預測回應異常，已套用預設高精度模型數據。');
      }
    } catch (err) {
      console.error(err);
      onSendLineToast('⚠️ 連線至 Gemini API 發生問題，套用預設系統預測。');
    } finally {
      setIsPredicting(false);
    }
  };

  const selectedPrediction = predictions.find(p => p.branchId === selectedBranchId) || predictions[0];
  const selectedBranch = branches.find(b => b.id === selectedBranchId) || branches[0];

  return (
    <div
      id="module-ai_warning_map"
      className="bg-white rounded-[32px] border border-[#5A5A40]/15 p-6 sm:p-8 shadow-xs space-y-6 transition-all duration-300 overflow-hidden"
    >
      {/* Header & Gemini AI Prediction Trigger Bar */}
      <div className={`flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${isCollapsed ? '' : 'border-b border-[#5A5A40]/10 pb-5'}`}>
        <div
          onClick={onToggleCollapse}
          className="flex items-start gap-3 cursor-pointer select-none group"
        >
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 text-slate-950 flex items-center justify-center shrink-0 shadow-md font-bold group-hover:scale-105 transition-transform">
            <Bot className="w-6 h-6 text-slate-950" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-bold font-serif italic text-slate-900 group-hover:text-[#5A5A40] transition-colors">
                3. 資源需求預警 &amp; 雙週物資人力 AI 預測地圖
              </h3>
              <span className="bg-amber-100 text-amber-900 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border border-amber-300 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-600" />
                <span>Gemini 3.6 Flash 連線</span>
              </span>
              {isCollapsed && (
                <span className="text-[10px] bg-slate-200 text-slate-700 font-bold px-2 py-0.5 rounded-full">
                  已收合折疊
                </span>
              )}
            </div>
            {!isCollapsed && (
              <p className="text-xs text-slate-500 mt-1">
                根據各據點志工缺工率與進駐流浪動物數量（共 434 隻），自動預測下一週物資（飼料/罐頭/醫療耗材）與人力缺口，並標示警示區域。
              </p>
            )}
          </div>
        </div>

        {/* Prediction Trigger & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 self-end lg:self-auto shrink-0">
          {!isCollapsed && (
            <>
              <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">
                更新：{lastPredictionTime}
              </span>
              <button
                type="button"
                onClick={handleRunAiPrediction}
                disabled={isPredicting}
                className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-xs px-4 py-2 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-slate-950 ${isPredicting ? 'animate-spin' : ''}`} />
                <span>{isPredicting ? '預測中...' : '重新執行 AI 預測'}</span>
              </button>
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
            <span className="font-bold text-amber-700 shrink-0">🔮 AI 預測摘要：</span>
            <span className="text-slate-700 truncate">
              {globalSummary}
            </span>
          </div>
          <span className="text-[11px] font-bold text-[#5A5A40] hover:underline shrink-0 flex items-center gap-0.5">
            <span>點擊展開地圖與缺口明細</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </span>
        </div>
      )}

      {/* Main Expanded Content */}
      {!isCollapsed && (
        <div className="space-y-6 animate-fadeIn">
          {/* AI Global Summary Callout */}
          <div className="bg-[#fdfdfb] p-4 rounded-2xl border border-amber-300/80 shadow-2xs flex items-start gap-3 text-xs leading-relaxed text-slate-800">
            <div className="p-2 rounded-xl bg-amber-100 text-amber-800 shrink-0 font-bold">
              💡 AI 營運總結
            </div>
            <div className="flex-1">
              <p className="font-medium text-slate-900">{globalSummary}</p>
              <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500">
                <span>🐾 監測動物總數：<strong className="text-slate-900 font-mono">434 隻</strong></span>
                <span>📍 監測據點：<strong className="text-slate-900 font-mono">3 處園區</strong></span>
                <span>⚠️ 高風險警示區域：<strong className="text-rose-600 font-mono">草山狗園 (陽明山)</strong></span>
              </div>
            </div>
          </div>

      {/* Main Grid: Interactive Map + Branch Detailed Gap Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column (7 cols): Interactive Visual Map of Northern Taiwan Shelter Nodes */}
        <div className="lg:col-span-7 bg-slate-900 rounded-[28px] p-5 border border-slate-800 text-white relative overflow-hidden flex flex-col justify-between shadow-lg min-h-[420px]">
          
          {/* Map Header Overlay */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 z-10">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-amber-400" />
              <span className="font-serif font-bold text-sm text-slate-100">
                大台北流浪動物園區據點 資源警示即時地圖
              </span>
            </div>
            <span className="text-[10px] bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded-full font-mono border border-slate-700">
              點擊地圖圓點查看各區 AI 預報
            </span>
          </div>

          {/* Interactive Graphic Canvas Representation */}
          <div className="relative w-full h-[320px] my-2 bg-slate-950/60 rounded-2xl border border-slate-800/80 p-4 flex items-center justify-center">
            
            {/* Background Grid Lines representing map coordinates */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:24px_24px] opacity-40 rounded-2xl pointer-events-none"></div>

            {/* Inter-Branch Dispatch Route SVG Lines */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
              {/* Route line 1: Main (新店) -> Halfway (陽明山) */}
              <line 
                x1="68%" y1="75%" 
                x2="52%" y2="25%" 
                stroke="#f59e0b" 
                strokeWidth="2" 
                strokeDasharray="6 4"
                className="animate-pulse opacity-70"
              />
              {/* Route line 2: Main (新店) -> Cat Island (淡水) */}
              <line 
                x1="68%" y1="75%" 
                x2="22%" y2="30%" 
                stroke="#38bdf8" 
                strokeWidth="2" 
                strokeDasharray="6 4"
                className="opacity-50"
              />
            </svg>

            {/* NODE 1: 草山狗園 (陽明山) - Top Center (CRITICAL) */}
            <div 
              onClick={() => setSelectedBranchId('halfway')}
              className={`absolute top-[18%] left-[48%] -translate-x-1/2 cursor-pointer z-20 group transition transform hover:scale-110 ${
                selectedBranchId === 'halfway' ? 'scale-110' : ''
              }`}
            >
              {/* Pulsing Beacon Ring */}
              <div className="absolute -inset-4 bg-rose-500/30 rounded-full animate-ping pointer-events-none"></div>
              
              <div className={`p-2.5 rounded-2xl border flex items-center gap-2 shadow-xl backdrop-blur-md transition ${
                selectedBranchId === 'halfway' 
                  ? 'bg-rose-950/90 border-rose-400 text-white ring-2 ring-rose-400' 
                  : 'bg-rose-900/70 border-rose-500/60 text-rose-100 hover:bg-rose-900'
              }`}>
                <div className="w-7 h-7 rounded-xl bg-rose-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                  🐕
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-xs">草山狗園 (陽明山)</span>
                    <span className="bg-rose-500 text-slate-950 font-extrabold text-[9px] px-1.5 py-0.2 rounded-full">
                      高風險 88%
                    </span>
                  </div>
                  <p className="text-[10px] text-rose-200">🐕 107隻 ｜ 缺工率 62%</p>
                </div>
              </div>
            </div>

            {/* NODE 2: 貓島中途分院 (淡水館) - Top Left (WARNING) */}
            <div 
              onClick={() => setSelectedBranchId('cat_island')}
              className={`absolute top-[28%] left-[12%] cursor-pointer z-20 group transition transform hover:scale-110 ${
                selectedBranchId === 'cat_island' ? 'scale-110' : ''
              }`}
            >
              {/* Pulsing Beacon Ring */}
              <div className="absolute -inset-3 bg-amber-500/20 rounded-full animate-pulse pointer-events-none"></div>

              <div className={`p-2.5 rounded-2xl border flex items-center gap-2 shadow-xl backdrop-blur-md transition ${
                selectedBranchId === 'cat_island' 
                  ? 'bg-amber-950/90 border-amber-400 text-white ring-2 ring-amber-400' 
                  : 'bg-amber-900/70 border-amber-500/60 text-amber-100 hover:bg-amber-900'
              }`}>
                <div className="w-7 h-7 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                  🐈
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-xs">淡水貓島館</span>
                    <span className="bg-amber-400 text-slate-950 font-extrabold text-[9px] px-1.5 py-0.2 rounded-full">
                      預警 65%
                    </span>
                  </div>
                  <p className="text-[10px] text-amber-200">🐈 80隻 ｜ 缺工率 45%</p>
                </div>
              </div>
            </div>

            {/* NODE 3: 浪浪總部園區 (新店本館) - Bottom Right (NORMAL / HUB) */}
            <div 
              onClick={() => setSelectedBranchId('main')}
              className={`absolute top-[70%] left-[62%] cursor-pointer z-20 group transition transform hover:scale-110 ${
                selectedBranchId === 'main' ? 'scale-110' : ''
              }`}
            >
              <div className={`p-2.5 rounded-2xl border flex items-center gap-2 shadow-xl backdrop-blur-md transition ${
                selectedBranchId === 'main' 
                  ? 'bg-emerald-950/90 border-emerald-400 text-white ring-2 ring-emerald-400' 
                  : 'bg-emerald-900/70 border-emerald-500/60 text-emerald-100 hover:bg-emerald-900'
              }`}>
                <div className="w-7 h-7 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                  🏠
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-xs">新店總部 (資材樞紐)</span>
                    <span className="bg-emerald-400 text-slate-950 font-extrabold text-[9px] px-1.5 py-0.2 rounded-full">
                      安穩 25%
                    </span>
                  </div>
                  <p className="text-[10px] text-emerald-200">🐾 247隻 ｜ 缺工率 28%</p>
                </div>
              </div>
            </div>

            {/* Map Legend */}
            <div className="absolute bottom-3 left-3 bg-slate-900/90 backdrop-blur-md p-2 rounded-xl border border-slate-800 text-[10px] flex items-center gap-3">
              <span className="flex items-center gap-1 text-rose-400 font-bold">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
                高風險警示區
              </span>
              <span className="flex items-center gap-1 text-amber-400 font-bold">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                中風險預警區
              </span>
              <span className="flex items-center gap-1 text-emerald-400 font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                正常安穩樞紐
              </span>
            </div>

          </div>

          {/* Dispatch Notice Bar */}
          <div className="bg-slate-800/80 p-3 rounded-2xl border border-slate-700/80 text-xs flex items-center justify-between text-slate-300">
            <span className="flex items-center gap-1.5">
              <Truck className="w-4 h-4 text-amber-400" />
              <span>跨據點物資支援動線：<strong>新店總部物資倉 ➔ 草山狗園 &amp; 淡水館</strong></span>
            </span>
            <button
              onClick={() => onSendLineToast('🚚 已發起「跨據點急需物資撥補派送單」至物流專車與資材組 LINE 群組！')}
              className="text-amber-300 font-bold hover:underline flex items-center gap-1 text-[11px] cursor-pointer"
            >
              <span>建立物資派送單</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

        </div>

        {/* Right Column (5 cols): Detailed Prediction Card for Selected Branch */}
        <div className="lg:col-span-5 bg-[#fdfdfb] rounded-[28px] border border-[#5A5A40]/15 p-5 shadow-xs flex flex-col justify-between space-y-4">
          
          <div className="space-y-4">
            {/* Selected Branch Header */}
            <div className="flex items-start justify-between border-b border-[#5A5A40]/10 pb-3">
              <div>
                <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border ${
                  selectedPrediction.riskLevel === 'critical' 
                    ? 'bg-rose-100 text-rose-800 border-rose-300' 
                    : selectedPrediction.riskLevel === 'warning'
                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                    : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                }`}>
                  {selectedPrediction.riskLevel === 'critical' ? '🚨 高風險警示區域' : selectedPrediction.riskLevel === 'warning' ? '⚠️ 中風險預警區域' : '🟢 運作安穩據點'} (風險分 {selectedPrediction.severityScore}/100)
                </span>

                <h4 className="font-serif font-bold text-slate-900 text-lg mt-1.5">
                  {selectedPrediction.branchName}
                </h4>
              </div>

              <div className="text-right font-mono text-xs text-slate-500">
                <span className="block text-[10px]">浪浪頭數</span>
                <strong className="text-slate-900 text-base">{selectedPrediction.animalCount} 隻</strong>
              </div>
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs">
                <span className="text-[10px] text-slate-400 block font-medium">志工缺工率</span>
                <span className={`font-extrabold text-base font-mono ${selectedPrediction.shortageRate > 50 ? 'text-rose-600' : 'text-amber-600'}`}>
                  {selectedPrediction.shortageRate}%
                </span>
              </div>

              <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs">
                <span className="text-[10px] text-slate-400 block font-medium">園區浪浪進駐</span>
                <span className="font-extrabold text-slate-900 text-base font-mono">
                  {selectedPrediction.animalCount} 隻
                </span>
              </div>
            </div>

            {/* Gemini Predicted Manpower Gap */}
            <div className="bg-amber-50/70 p-3.5 rounded-2xl border border-amber-200/80 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-amber-900">
                <Users className="w-4 h-4 text-amber-700" />
                <span>Gemini 下週人力缺口預測：</span>
              </div>
              <p className="text-slate-700 leading-relaxed pl-5 font-sans">
                {selectedPrediction.predictedManpowerGap}
              </p>
            </div>

            {/* Gemini Predicted Material Gap */}
            <div className="bg-rose-50/70 p-3.5 rounded-2xl border border-rose-200/80 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-rose-950">
                <Package className="w-4 h-4 text-rose-700" />
                <span>Gemini 下週物資缺口預測：</span>
              </div>
              <p className="text-slate-700 leading-relaxed pl-5 font-sans">
                {selectedPrediction.predictedMaterialGap}
              </p>
            </div>

            {/* Gemini Recommended Urgent Actions */}
            <div className="bg-white p-3.5 rounded-2xl border border-slate-200 text-xs space-y-2">
              <span className="font-bold text-[#5A5A40] text-[11px] block">
                ⚡ Gemini 建議即刻發起處置：
              </span>
              <ul className="space-y-1.5 text-slate-700 font-sans pl-1">
                {selectedPrediction.urgentActions.map((act, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="text-amber-500 font-bold shrink-0">•</span>
                    <span>{act}</span>
                  </li>
                ))}
              </ul>
            </div>

          </div>

          {/* Direct LINE Mobilization Button */}
          <div className="pt-2 border-t border-[#5A5A40]/10 flex flex-col gap-2">
            <button
              onClick={() => onSendLineToast(`🚨 已發送【${selectedPrediction.branchName}】緊急缺工與物資撥補通報至 LINE 志工大群組！`)}
              className="w-full bg-[#5A5A40] hover:bg-[#484833] text-white font-extrabold text-xs py-2.5 px-4 rounded-xl shadow-xs transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <Send className="w-4 h-4 text-amber-300" />
              <span>一鍵發布【{selectedPrediction.branchName}】LINE 急召與調撥廣播</span>
            </button>
          </div>

        </div>

      </div>
        </div>
      )}

    </div>
  );
};
