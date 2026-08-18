import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { PositionShift, Branch } from '../types';
import { ZONE_CONFIGS } from '../data/mockData';
import { Sparkles, AlertTriangle, TrendingUp, Calendar, Clock, MapPin, Zap, Info, ShieldAlert, CheckCircle2, ChevronRight, BarChart2, ChevronDown, ChevronUp, EyeOff } from 'lucide-react';

interface HeatmapChartProps {
  shifts: PositionShift[];
  branches: Branch[];
  onOpenUrgentModal?: () => void;
  onSendLineToast?: (msg: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onHide?: () => void;
}

interface HeatmapCellData {
  branchId: string;
  branchName: string;
  dayIndex: number; // 0=Mon, 6=Sun
  dayLabel: string; // e.g. "週一 (08/01)"
  timeSlotKey: string; // e.g. "08:00-11:00"
  timeSlotLabel: string;
  totalRequired: number;
  totalFilled: number;
  gap: number;
  fillRate: number; // 0 - 100
  shortageRate: number; // 0 - 100
  isPeakShortage: boolean;
}

const DAYS_OF_WEEK = [
  { key: 0, label: '週一 (08/04)' },
  { key: 1, label: '週二 (08/05)' },
  { key: 2, label: '週三 (08/06)' },
  { key: 3, label: '週四 (08/07)' },
  { key: 4, label: '週五 (08/08)' },
  { key: 5, label: '週六 (08/09)' },
  { key: 6, label: '週日 (08/10)' },
];

const TIME_SLOTS = [
  { key: 'morning', label: '早班 (08:00-11:00)' },
  { key: 'noon', label: '午班 (11:00-14:00)' },
  { key: 'afternoon', label: '下午班 (14:00-17:00)' },
  { key: 'evening', label: '晚班 (17:00-20:00)' },
];

export const HeatmapChart: React.FC<HeatmapChartProps> = ({
  shifts,
  branches,
  onOpenUrgentModal,
  onSendLineToast = () => {},
  isCollapsed = false,
  onToggleCollapse,
  onHide
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  // States
  const [metricMode, setMetricMode] = useState<'density' | 'shortage'>('shortage');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'days_x_time' | 'branches_x_days'>('days_x_time');
  const [hoveredCell, setHoveredCell] = useState<HeatmapCellData | null>(null);

  // Generate matrix data based on real shifts or generated historical density
  const heatmapData = useMemo(() => {
    const data: HeatmapCellData[] = [];

    // Helper mock base metrics according to real shifts + realistic volunteer attendance patterns
    branches.forEach(b => {
      DAYS_OF_WEEK.forEach(day => {
        TIME_SLOTS.forEach(slot => {
          // Find matching shifts
          const matchingShifts = shifts.filter(s => {
            if (s.branchId !== b.id) return false;
            if (slot.key === 'morning' && (s.timeRange.includes('08:') || s.timeRange.includes('09:') || s.timeRange.includes('10:'))) return true;
            if (slot.key === 'noon' && (s.timeRange.includes('11:') || s.timeRange.includes('12:') || s.timeRange.includes('13:'))) return true;
            if (slot.key === 'afternoon' && (s.timeRange.includes('14:') || s.timeRange.includes('15:') || s.timeRange.includes('16:'))) return true;
            if (slot.key === 'evening' && (s.timeRange.includes('17:') || s.timeRange.includes('18:') || s.timeRange.includes('19:'))) return true;
            return false;
          });

          let req = matchingShifts.reduce((acc, s) => acc + s.requiredCount, 0);
          let filled = matchingShifts.reduce((acc, s) => acc + s.currentCount, 0);

          // If no shifts matched directly in seed data, generate realistic baseline stats for smooth heatmap visualization
          if (req === 0) {
            // Weekend afternoon peak shortage scenario
            const isWeekend = day.key >= 5;
            const isAfternoon = slot.key === 'afternoon' || slot.key === 'evening';
            req = isWeekend ? 10 : 6;
            filled = isWeekend && isAfternoon ? 3 : (isWeekend ? 6 : (day.key % 2 === 0 ? 5 : 4));
            
            // Cat Island branch weekend afternoon high shortage
            if (b.id === 'cat_island' && isWeekend && isAfternoon) {
              filled = 2; // 2/10 -> 80% shortage
            }
          }

          const gap = Math.max(0, req - filled);
          const fillRate = req > 0 ? Math.round((filled / req) * 100) : 100;
          const shortageRate = req > 0 ? Math.round((gap / req) * 100) : 0;
          const isPeakShortage = shortageRate >= 50;

          data.push({
            branchId: b.id,
            branchName: b.name,
            dayIndex: day.key,
            dayLabel: day.label,
            timeSlotKey: slot.key,
            timeSlotLabel: slot.label,
            totalRequired: req,
            totalFilled: filled,
            gap,
            fillRate,
            shortageRate,
            isPeakShortage
          });
        });
      });
    });

    return data;
  }, [shifts, branches]);

  // Aggregate Top Peak Shortage slots
  const topShortagePeaks = useMemo(() => {
    return [...heatmapData]
      .filter(d => d.gap > 0)
      .sort((a, b) => b.shortageRate - a.shortageRate || b.gap - a.gap)
      .slice(0, 3);
  }, [heatmapData]);

  // Draw Heatmap with D3.js
  useEffect(() => {
    if (!svgRef.current) return;

    // Filter data if single branch selected
    let displayData = heatmapData;
    if (selectedBranchId !== 'all') {
      displayData = heatmapData.filter(d => d.branchId === selectedBranchId);
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove(); // Clear previous render

    const margin = { top: 40, right: 30, bottom: 50, left: 110 };
    const width = 680 - margin.left - margin.right;
    const height = 320 - margin.top - margin.bottom;

    const chartGroup = svg
      .attr('viewBox', `0 0 680 320`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Define X and Y domains based on viewMode
    let xDomain: string[] = [];
    let yDomain: string[] = [];

    if (viewMode === 'days_x_time') {
      // X = Time slots, Y = Days
      xDomain = TIME_SLOTS.map(t => t.label.split(' ')[0]); // "早班", "午班", etc.
      yDomain = DAYS_OF_WEEK.map(d => d.label.split(' ')[0]); // "週一", "週二", etc.
    } else {
      // X = Days, Y = Branches
      xDomain = DAYS_OF_WEEK.map(d => d.label.split(' ')[0]);
      yDomain = branches.map(b => b.name);
    }

    // Scales
    const xScale = d3.scaleBand()
      .range([0, width])
      .domain(xDomain)
      .padding(0.08);

    const yScale = d3.scaleBand()
      .range([0, height])
      .domain(yDomain)
      .padding(0.08);

    // Color Scales
    // Shortage mode: Light Rose -> Bright Red -> Dark Crimson
    const shortageColorScale = d3.scaleLinear<string>()
      .domain([0, 30, 60, 100])
      .range(['#fef2f2', '#fca5a5', '#e11d48', '#881337']);

    // Density mode: Light Beige -> Sage Green -> Deep Forest
    const densityColorScale = d3.scaleLinear<string>()
      .domain([0, 40, 75, 100])
      .range(['#f5f5f0', '#a7f3d0', '#10b981', '#064e3b']);

    // X Axis
    chartGroup.append('g')
      .attr('transform', `translate(0, ${height})`)
      .call(d3.axisBottom(xScale).tickSize(0))
      .select('.domain').remove();

    chartGroup.selectAll('.tick text')
      .attr('fill', '#475569')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .attr('dy', '1.2em');

    // Y Axis
    chartGroup.append('g')
      .call(d3.axisLeft(yScale).tickSize(0))
      .select('.domain').remove();

    chartGroup.selectAll('.tick text')
      .attr('fill', '#334155')
      .attr('font-size', '11px')
      .attr('font-weight', '700');

    // Aggregate values for matrix cells
    const cellAggregates: Map<string, { value: number; fillRate: number; gap: number; req: number; filled: number; items: HeatmapCellData[] }> = new Map();

    displayData.forEach(d => {
      let xKey = '';
      let yKey = '';

      if (viewMode === 'days_x_time') {
        xKey = d.timeSlotLabel.split(' ')[0];
        yKey = d.dayLabel.split(' ')[0];
      } else {
        xKey = d.dayLabel.split(' ')[0];
        yKey = d.branchName;
      }

      const cellKey = `${xKey}___${yKey}`;
      if (!cellAggregates.has(cellKey)) {
        cellAggregates.set(cellKey, { value: 0, fillRate: 0, gap: 0, req: 0, filled: 0, items: [] });
      }
      const agg = cellAggregates.get(cellKey)!;
      agg.req += d.totalRequired;
      agg.filled += d.totalFilled;
      agg.gap += d.gap;
      agg.items.push(d);
    });

    // Compute aggregated rates
    cellAggregates.forEach((agg) => {
      agg.fillRate = agg.req > 0 ? Math.round((agg.filled / agg.req) * 100) : 100;
      const shortageRate = agg.req > 0 ? Math.round((agg.gap / agg.req) * 100) : 0;
      agg.value = metricMode === 'shortage' ? shortageRate : agg.fillRate;
    });

    // Render Rectangles (Heatmap Cells)
    const cellsData: Array<{ xKey: string; yKey: string; val: number; agg: any }> = [];
    xDomain.forEach(xKey => {
      yDomain.forEach(yKey => {
        const cellKey = `${xKey}___${yKey}`;
        const agg = cellAggregates.get(cellKey) || { value: 0, fillRate: 100, gap: 0, req: 0, filled: 0, items: [] };
        cellsData.push({
          xKey,
          yKey,
          val: agg.value,
          agg
        });
      });
    });

    const cells = chartGroup.selectAll('.heatmap-cell')
      .data(cellsData)
      .enter()
      .append('g')
      .attr('class', 'heatmap-cell')
      .attr('transform', d => `translate(${xScale(d.xKey) || 0}, ${yScale(d.yKey) || 0})`);

    // Rect shape
    cells.append('rect')
      .attr('width', xScale.bandwidth())
      .attr('height', yScale.bandwidth())
      .attr('rx', 6)
      .attr('ry', 6)
      .attr('fill', d => metricMode === 'shortage' ? shortageColorScale(d.val) : densityColorScale(d.val))
      .attr('stroke', d => (metricMode === 'shortage' && d.val >= 50) ? '#be123c' : '#ffffff')
      .attr('stroke-width', d => (metricMode === 'shortage' && d.val >= 50) ? 2 : 1)
      .style('cursor', 'pointer')
      .style('transition', 'all 0.2s ease');

    // Text inside rect
    cells.append('text')
      .attr('x', xScale.bandwidth() / 2)
      .attr('y', yScale.bandwidth() / 2)
      .attr('dy', '.35em')
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('font-weight', '800')
      .attr('fill', d => {
        if (metricMode === 'shortage') return d.val >= 50 ? '#ffffff' : '#475569';
        return d.val >= 60 ? '#ffffff' : '#1e293b';
      })
      .text(d => {
        if (metricMode === 'shortage') {
          return d.val > 0 ? `缺${d.agg.gap}人` : '滿班';
        }
        return `${d.val}%`;
      });

    // Peak badge indicator for severe shortages
    cells.filter(d => metricMode === 'shortage' && d.val >= 50)
      .append('text')
      .attr('x', xScale.bandwidth() - 4)
      .attr('y', 10)
      .attr('text-anchor', 'end')
      .attr('font-size', '9px')
      .text('🔥');

    // Hover interactions & Tooltip
    cells.on('mouseover', (event, d) => {
      d3.select(event.currentTarget).select('rect')
        .attr('stroke', '#0f172a')
        .attr('stroke-width', 2.5);

      if (d.agg.items.length > 0) {
        setHoveredCell(d.agg.items[0]);
      }
    })
    .on('mouseout', (event, d) => {
      d3.select(event.currentTarget).select('rect')
        .attr('stroke', (metricMode === 'shortage' && d.val >= 50) ? '#be123c' : '#ffffff')
        .attr('stroke-width', (metricMode === 'shortage' && d.val >= 50) ? 2 : 1);

      setHoveredCell(null);
    });

  }, [heatmapData, metricMode, selectedBranchId, viewMode, branches]);

  return (
    <div
      id="module-heatmap"
      className="bg-white rounded-[32px] p-6 sm:p-8 shadow-xs border border-[#5A5A40]/15 space-y-6 font-sans transition-all duration-300 overflow-hidden"
    >
      {/* Top Header & Controls */}
      <div className={`flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${isCollapsed ? '' : 'border-b border-[#5A5A40]/10 pb-5'}`}>
        <div
          onClick={onToggleCollapse}
          className="flex items-start gap-3 cursor-pointer select-none group"
        >
          <div className="w-10 h-10 rounded-2xl bg-[#5A5A40] text-[#E6E2D3] flex items-center justify-center shrink-0 shadow-xs group-hover:scale-105 transition-transform">
            <BarChart2 className="w-5 h-5 text-amber-300" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-bold font-serif italic text-slate-900 group-hover:text-[#5A5A40] transition-colors">
                2. 志工參與與缺工『D3.js 熱力圖』分析
              </h3>
              <span className="bg-[#E6E2D3] text-[#5A5A40] text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border border-[#5A5A40]/20">
                D3.js Powered
              </span>
              {isCollapsed && (
                <span className="text-[10px] bg-slate-200 text-slate-700 font-bold px-2 py-0.5 rounded-full">
                  已收合折疊
                </span>
              )}
            </div>
            {!isCollapsed && (
              <p className="text-xs text-slate-500 mt-1">
                視覺化展示近一週各據點、時段的志工排班到勤率與缺工高峰趨勢，輔助社工進行高精準度調度。
              </p>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2 text-xs self-end lg:self-auto">
          {!isCollapsed && (
            <>
              {/* Branch Filter Dropdown */}
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="bg-[#f5f5f0] border border-[#5A5A40]/20 text-slate-800 font-bold px-3 py-1.5 rounded-xl text-xs focus:outline-hidden"
              >
                <option value="all">🏢 所有據點總覽</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>📍 {b.name}</option>
                ))}
              </select>

              {/* Matrix Dimension Toggle */}
              <div className="flex items-center bg-slate-100 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setViewMode('days_x_time')}
                  className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                    viewMode === 'days_x_time' ? 'bg-white text-[#5A5A40] shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  📅 一週各天 x 時段
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('branches_x_days')}
                  className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                    viewMode === 'branches_x_days' ? 'bg-white text-[#5A5A40] shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  🏢 各據點 x 一週
                </button>
              </div>

              {/* Metric Mode Toggle */}
              <div className="flex items-center bg-slate-100 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setMetricMode('shortage')}
                  className={`px-3 py-1 rounded-lg font-extrabold transition flex items-center gap-1 cursor-pointer ${
                    metricMode === 'shortage' ? 'bg-rose-600 text-white shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>🚨 缺工高峰</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMetricMode('density')}
                  className={`px-3 py-1 rounded-lg font-extrabold transition flex items-center gap-1 cursor-pointer ${
                    metricMode === 'density' ? 'bg-emerald-600 text-white shadow-2xs' : 'text-slate-600'
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>🟢 到勤密集度</span>
                </button>
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
            <span className="font-bold text-[#5A5A40] shrink-0">📌 熱力圖摘要：</span>
            <span className="text-slate-600 truncate">
              {topShortagePeaks.length > 0 
                ? `🚨 尖峰缺工：${topShortagePeaks[0].branchName} ${topShortagePeaks[0].dayLabel} (${topShortagePeaks[0].timeSlotLabel} 缺 ${topShortagePeaks[0].gap} 人，缺額率 ${topShortagePeaks[0].shortageRate}%)`
                : '全園區時段人力充足'}
            </span>
          </div>
          <span className="text-[11px] font-bold text-[#5A5A40] hover:underline shrink-0 flex items-center gap-0.5">
            <span>點擊展開完整 D3 互動矩陣</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </span>
        </div>
      )}

      {/* Main Heatmap Visual Container (Only when expanded) */}
      {!isCollapsed && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center animate-fadeIn">
        
        {/* SVG Chart Box */}
        <div className="lg:col-span-8 bg-[#fafaf7] p-3 rounded-2xl border border-[#5A5A40]/15 relative overflow-x-auto">
          <svg ref={svgRef} className="w-full h-auto min-w-[540px]"></svg>

          {/* Color Scale Legend Bar */}
          <div className="flex items-center justify-between px-4 pt-2 border-t border-[#5A5A40]/10 text-[11px] text-slate-600">
            <span className="font-bold">圖例熱力指標：</span>
            {metricMode === 'shortage' ? (
              <div className="flex items-center gap-2">
                <span>🟢 滿班 (0% 缺額)</span>
                <div className="w-24 h-2.5 rounded-full bg-gradient-to-r from-rose-100 via-rose-400 to-rose-800"></div>
                <span className="font-bold text-rose-700">🚨 重度缺工 (&gt; 50%)</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span>⚪ 低到勤率 (&lt; 30%)</span>
                <div className="w-24 h-2.5 rounded-full bg-gradient-to-r from-[#f5f5f0] via-emerald-300 to-emerald-800"></div>
                <span className="font-bold text-emerald-800">🟢 高密集到勤 (100%)</span>
              </div>
            )}
          </div>
        </div>

        {/* Hovered Cell Details & AI Insights Panel */}
        <div className="lg:col-span-4 space-y-4">
          
          {/* Active Hover Cell Card */}
          <div className="bg-[#f5f5f0] border border-[#5A5A40]/20 p-4 rounded-2xl space-y-2">
            <div className="text-[11px] font-bold text-[#5A5A40] flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-[#5A5A40]" />
                鼠標焦點指標詳情
              </span>
              <span className="text-[10px] text-slate-400">移至矩陣查看</span>
            </div>

            {hoveredCell ? (
              <div className="space-y-2 pt-1">
                <div className="font-bold text-slate-900 text-sm">{hoveredCell.branchName}</div>
                <div className="text-xs text-slate-600 space-y-1">
                  <div>📅 日期時間：<strong>{hoveredCell.dayLabel}</strong> ({hoveredCell.timeSlotLabel})</div>
                  <div>👥 志工需求：需求 <strong>{hoveredCell.totalRequired}</strong> 人 / 已到 <strong>{hoveredCell.totalFilled}</strong> 人</div>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-rose-700 font-extrabold text-xs">
                      🚨 缺額：{hoveredCell.gap} 人 ({hoveredCell.shortageRate}%)
                    </span>
                    <span className="text-emerald-700 font-extrabold text-xs">
                      🟢 到勤率：{hoveredCell.fillRate}%
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-400 italic py-2">
                將滑鼠游標移至左側 D3 熱力圖方格上，即可查看該時段之排班與缺工精確數值。
              </div>
            )}
          </div>

          {/* AI Shortage Peak Ranking Summary */}
          <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-rose-900">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                <span>全區 TOP 3 最緊迫缺工時段</span>
              </div>
              <span className="bg-rose-600 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                AI 警訊
              </span>
            </div>

            <div className="space-y-2 text-xs">
              {topShortagePeaks.map((peak, pIdx) => (
                <div key={pIdx} className="bg-white p-2.5 rounded-xl border border-rose-200 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900 flex items-center gap-1">
                      <span className="text-rose-600 font-extrabold">#{pIdx + 1}</span>
                      <span>{peak.branchName}</span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {peak.dayLabel} ({peak.timeSlotLabel.split(' ')[0]})
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-xs font-extrabold text-rose-700 block">
                      缺 {peak.gap} 人 ({peak.shortageRate}%)
                    </span>
                    <span className="text-[9px] text-rose-500 font-semibold bg-rose-50 px-1.5 py-0.5 rounded-md">
                      緊急補班
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {onOpenUrgentModal && (
              <button
                onClick={onOpenUrgentModal}
                className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs py-2 rounded-xl transition shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer mt-1"
              >
                <Zap className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
                <span>一鍵啟動 LINE 缺工緊急廣播推播</span>
              </button>
            )}
          </div>

        </div>

      </div>
      )}

    </div>
  );
};
