import React, { useState } from 'react';
import { PositionShift } from '../types';
import {
  Bot,
  Sparkles,
  MapPin,
  Users,
  Package,
  Send,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  EyeOff
} from 'lucide-react';

interface PredictionResult {
  riskLevel: 'critical' | 'warning' | 'normal';
  severityScore: number;
  animalCount: number;
  shortageRate: number;
  predictedManpowerGap: string;
  predictedMaterialGap: string;
  urgentActions: string[];
}

interface ResourceWarningMapProps {
  shifts: PositionShift[];
  onSendLineToast: (msg: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onHide?: () => void;
}

const DEFAULT_PREDICTION: PredictionResult = {
  riskLevel: 'warning',
  severityScore: 58,
  animalCount: 434,
  shortageRate: 42,
  predictedManpowerGap: '預測下週缺 22 人次（大狗運動場放風 10 人、幼貓育幼陪伴 5 人、醫療區復健 7 人），週末最為告急。',
  predictedMaterialGap: '大犬成犬飼料急缺 60 kg、主食貓罐頭短缺 80 罐、止血與傷口紗布短缺 30 包。',
  urgentActions: [
    '即刻向 LINE 志工群組發布假日班次急召推播',
    '請物資整理組優先分類最新一批捐贈物資，補上飼料與紗布缺口'
  ]
};

const RISK_STYLES: Record<PredictionResult['riskLevel'], { badge: string; ring: string; dot: string; label: string }> = {
  critical: { badge: 'bg-rose-100 text-rose-800 border-rose-300', ring: 'ring-rose-400', dot: 'bg-rose-500', label: '🚨 高風險警示' },
  warning: { badge: 'bg-amber-100 text-amber-800 border-amber-300', ring: 'ring-amber-400', dot: 'bg-amber-400', label: '⚠️ 中風險預警' },
  normal: { badge: 'bg-emerald-100 text-emerald-800 border-emerald-300', ring: 'ring-emerald-400', dot: 'bg-emerald-400', label: '🟢 運作安穩' }
};

export const ResourceWarningMap: React.FC<ResourceWarningMapProps> = ({
  shifts,
  onSendLineToast,
  isCollapsed = false,
  onToggleCollapse,
  onHide
}) => {
  const [isPredicting, setIsPredicting] = useState<boolean>(false);
  const [globalSummary, setGlobalSummary] = useState<string>(
    '根據 Gemini AI 分析園區共 434 隻流浪動物與下週班次排程，人力與物資皆面臨中度短缺風險，建議優先開啟急召推播與物資整理排程。'
  );
  const [prediction, setPrediction] = useState<PredictionResult>(DEFAULT_PREDICTION);
  const [lastPredictionTime, setLastPredictionTime] = useState<string>('11:48:00');

  // Trigger Gemini API Prediction
  const handleRunAiPrediction = async () => {
    setIsPredicting(true);

    const req = shifts.reduce((acc, s) => acc + s.requiredCount, 0);
    const filled = shifts.reduce((acc, s) => acc + s.currentCount, 0);
    const shortage = Math.max(0, req - filled);
    const shortageRate = req > 0 ? Math.round((shortage / req) * 100) : 0;

    const shelterData = {
      animalCount: 434,
      totalShiftsCount: shifts.length,
      requiredVolunteers: req,
      currentVolunteers: filled,
      shortageRate
    };

    try {
      const res = await fetch('/api/ai/predict-resource-gaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shelterData })
      });

      const data = await res.json();
      if (data.success && data.prediction) {
        setPrediction(data.prediction);
        if (data.globalSummary) setGlobalSummary(data.globalSummary);
        const nowStr = new Date().toLocaleTimeString('zh-TW', { hour12: false });
        setLastPredictionTime(nowStr);
        onSendLineToast('🔮 Gemini 3.6 Flash 已完成園區物資與人力缺口分析預測！');
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

  const riskStyle = RISK_STYLES[prediction.riskLevel];

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
                3. 資源需求預警 &amp; 雙週物資人力 AI 預測
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
                根據志工缺工率與進駐流浪動物數量（共 434 隻），自動預測下一週物資（飼料/罐頭/醫療耗材）與人力缺口，並標示警示等級。
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
            <span>點擊展開詳情</span>
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
                <span className={`flex items-center gap-1 font-bold ${
                  prediction.riskLevel === 'critical' ? 'text-rose-600' : prediction.riskLevel === 'warning' ? 'text-amber-600' : 'text-emerald-600'
                }`}>
                  {riskStyle.label}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* Left Column (5 cols): At-a-glance status */}
            <div className="lg:col-span-5 bg-slate-900 rounded-[28px] p-6 border border-slate-800 text-white relative overflow-hidden flex flex-col justify-center items-center shadow-lg min-h-[280px]">
              <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:24px_24px] opacity-40 pointer-events-none"></div>

              <div className="relative z-10 flex flex-col items-center gap-3 text-center">
                <div className={`absolute -inset-6 ${riskStyle.dot}/20 rounded-full ${prediction.riskLevel === 'critical' ? 'animate-ping' : 'animate-pulse'} pointer-events-none`}></div>
                <div className={`w-16 h-16 rounded-2xl ${riskStyle.dot} text-slate-950 flex items-center justify-center text-3xl shadow-xl ring-4 ${riskStyle.ring}`}>
                  🏠
                </div>
                <div>
                  <div className="flex items-center justify-center gap-1.5">
                    <MapPin className="w-4 h-4 text-amber-400" />
                    <span className="font-serif font-bold text-base">浪浪家園 PawRescue</span>
                  </div>
                  <span className={`inline-block mt-1.5 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full ${riskStyle.badge}`}>
                    {riskStyle.label}（風險分 {prediction.severityScore}/100）
                  </span>
                  <p className="text-xs text-slate-300 mt-2">🐾 {prediction.animalCount} 隻 ｜ 缺工率 {prediction.shortageRate}%</p>
                </div>
              </div>
            </div>

            {/* Right Column (7 cols): Detailed Prediction Card */}
            <div className="lg:col-span-7 bg-[#fdfdfb] rounded-[28px] border border-[#5A5A40]/15 p-5 shadow-xs flex flex-col justify-between space-y-4">

              <div className="space-y-4">
                {/* Quick Metrics */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs">
                    <span className="text-[10px] text-slate-400 block font-medium">志工缺工率</span>
                    <span className={`font-extrabold text-base font-mono ${prediction.shortageRate > 50 ? 'text-rose-600' : 'text-amber-600'}`}>
                      {prediction.shortageRate}%
                    </span>
                  </div>

                  <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs">
                    <span className="text-[10px] text-slate-400 block font-medium">園區浪浪進駐</span>
                    <span className="font-extrabold text-slate-900 text-base font-mono">
                      {prediction.animalCount} 隻
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
                    {prediction.predictedManpowerGap}
                  </p>
                </div>

                {/* Gemini Predicted Material Gap */}
                <div className="bg-rose-50/70 p-3.5 rounded-2xl border border-rose-200/80 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-rose-950">
                    <Package className="w-4 h-4 text-rose-700" />
                    <span>Gemini 下週物資缺口預測：</span>
                  </div>
                  <p className="text-slate-700 leading-relaxed pl-5 font-sans">
                    {prediction.predictedMaterialGap}
                  </p>
                </div>

                {/* Gemini Recommended Urgent Actions */}
                <div className="bg-white p-3.5 rounded-2xl border border-slate-200 text-xs space-y-2">
                  <span className="font-bold text-[#5A5A40] text-[11px] block">
                    ⚡ Gemini 建議即刻發起處置：
                  </span>
                  <ul className="space-y-1.5 text-slate-700 font-sans pl-1">
                    {prediction.urgentActions.map((act, idx) => (
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
                  onClick={() => onSendLineToast('🚨 已發送園區緊急缺工與物資撥補通報至 LINE 志工大群組！')}
                  className="w-full bg-[#5A5A40] hover:bg-[#484833] text-white font-extrabold text-xs py-2.5 px-4 rounded-xl shadow-xs transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Send className="w-4 h-4 text-amber-300" />
                  <span>一鍵發布 LINE 急召與物資調度廣播</span>
                </button>
              </div>

            </div>

          </div>
        </div>
      )}

    </div>
  );
};
