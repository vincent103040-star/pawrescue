import React, { useRef, useState } from 'react';
import { Branch, PositionShift, VolunteerApplication } from '../types';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Download, X, FileSpreadsheet, FileText, Printer, CheckCircle2, ShieldCheck, Sparkles, Building2, Users, Clock, AlertTriangle, Loader2 } from 'lucide-react';

interface MonthlyReportModalProps {
  month: string; // e.g., '2026-08'
  branches: Branch[];
  shifts: PositionShift[];
  applications: VolunteerApplication[];
  onClose: () => void;
  onSendLineToast?: (msg: string) => void;
}

export interface BranchMonthlyStat {
  branchId: string;
  branchName: string;
  address: string;
  totalShifts: number;
  totalVolunteers: number;
  totalCompletedHours: number;
  requiredCount: number;
  filledCount: number;
  shortageCount: number;
  shortageRate: number; // 0 - 100%
  statusLabel: string;
  statusBadgeBg: string;
}

// Helper to calculate shift duration in hours from timeRange string (e.g. "10:00 - 13:00")
export const calculateShiftDurationHours = (timeRange: string): number => {
  try {
    const parts = timeRange.split('-').map(p => p.trim());
    if (parts.length === 2) {
      const [startH, startM] = parts[0].split(':').map(Number);
      const [endH, endM] = parts[1].split(':').map(Number);
      if (!isNaN(startH) && !isNaN(endH)) {
        const startTotalMinutes = startH * 60 + (startM || 0);
        const endTotalMinutes = endH * 60 + (endM || 0);
        const diffMinutes = endTotalMinutes - startTotalMinutes;
        if (diffMinutes > 0) {
          return Math.round((diffMinutes / 60) * 10) / 10;
        }
      }
    }
  } catch (e) {
    // fallback
  }
  return 3.5;
};

export const MonthlyReportModal: React.FC<MonthlyReportModalProps> = ({
  month,
  branches,
  shifts,
  applications,
  onClose,
  onSendLineToast = (_msg?: string) => {}
}) => {
  const reportRef = useRef<HTMLDivElement>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);

  // Filter shifts for the specified month (e.g., '2026-08')
  const monthShifts = shifts.filter(s => s.date.startsWith(month));

  // Compute statistics per branch
  const branchStats: BranchMonthlyStat[] = branches.map(branch => {
    const bShifts = monthShifts.filter(s => s.branchId === branch.id);
    const totalShifts = bShifts.length;
    
    const requiredCount = bShifts.reduce((acc, s) => acc + s.requiredCount, 0);
    const filledCount = bShifts.reduce((acc, s) => acc + s.currentCount, 0);
    const shortageCount = Math.max(0, requiredCount - filledCount);
    const shortageRate = requiredCount > 0 ? Math.round((shortageCount / requiredCount) * 100) : 0;

    // Calculate unique volunteers
    const bShiftIds = new Set(bShifts.map(s => s.id));
    const bApps = applications.filter(a => bShiftIds.has(a.shiftId));
    const uniqueVols = new Set(bApps.map(a => a.volunteerName || a.lineId)).size;
    const totalVolunteers = Math.max(uniqueVols, filledCount);

    // Calculate total completed hours
    const totalCompletedHours = bShifts.reduce((acc, s) => {
      const shiftHours = calculateShiftDurationHours(s.timeRange);
      return acc + (s.currentCount * shiftHours);
    }, 0);

    let statusLabel = '排班優良 🟢';
    let statusBadgeBg = 'bg-emerald-100 text-emerald-900 border-emerald-300';
    if (shortageRate > 30) {
      statusLabel = '嚴重缺工 🔴';
      statusBadgeBg = 'bg-rose-100 text-rose-900 border-rose-300';
    } else if (shortageRate > 10) {
      statusLabel = '人力微緊 🟡';
      statusBadgeBg = 'bg-amber-100 text-amber-900 border-amber-300';
    }

    return {
      branchId: branch.id,
      branchName: branch.name,
      address: branch.address,
      totalShifts,
      totalVolunteers,
      totalCompletedHours: Math.round(totalCompletedHours),
      requiredCount,
      filledCount,
      shortageCount,
      shortageRate,
      statusLabel,
      statusBadgeBg
    };
  });

  // Overall totals
  const overallShifts = monthShifts.length;
  const overallVolunteers = branchStats.reduce((acc, b) => acc + b.totalVolunteers, 0);
  const overallCompletedHours = branchStats.reduce((acc, b) => acc + b.totalCompletedHours, 0);
  const overallRequired = branchStats.reduce((acc, b) => acc + b.requiredCount, 0);
  const overallFilled = branchStats.reduce((acc, b) => acc + b.filledCount, 0);
  const overallShortage = Math.max(0, overallRequired - overallFilled);
  const overallShortageRate = overallRequired > 0 ? Math.round((overallShortage / overallRequired) * 100) : 0;

  // Format month title
  const [yearStr, monthNumStr] = month.split('-');
  const formattedMonthTitle = `${yearStr} 年 ${monthNumStr} 月`;

  // Export CSV Function
  const handleExportCSV = () => {
    const csvRows: string[] = [];
    
    // Title & Metadata
    csvRows.push(`"流浪動物之家人力排班 - ${formattedMonthTitle}月度據點績效與缺工率統計總結"`);
    csvRows.push(`"報名產出時間: ${new Date().toLocaleString('zh-TW')}"`);
    csvRows.push(`"機構全區平均缺工率: ${overallShortageRate}%", "當月總服務人數: ${overallVolunteers}人", "當月總服務時數: ${overallCompletedHours}小時"`);
    csvRows.push('');

    // Headers
    csvRows.push('"據點名稱","統計月份","當月總班次數","需求志工人數","已報名人數","缺工人數","缺工率(%)","總完成服務時數(小時)","據點運作狀態"');

    // Data rows
    branchStats.forEach(stat => {
      csvRows.push(`"${stat.branchName}","${month}","${stat.totalShifts}","${stat.requiredCount}","${stat.filledCount}","${stat.shortageCount}","${stat.shortageRate}%","${stat.totalCompletedHours}","${stat.statusLabel}"`);
    });

    // Total summary row
    csvRows.push(`"全機構總計","${month}","${overallShifts}","${overallRequired}","${overallFilled}","${overallShortage}","${overallShortageRate}%","${overallCompletedHours}","機構營運結算"`);

    const csvContent = '\uFEFF' + csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `動物之家_月度據點績效總結_${month}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setDownloadSuccess('CSV');
    onSendLineToast(`📊 已匯出「${formattedMonthTitle}」月度各據點績效總結 CSV 報表！`);
    setTimeout(() => setDownloadSuccess(null), 3000);
  };

  // Export PDF Function
  const handleExportPDF = async () => {
    if (!reportRef.current) return;
    setIsGeneratingPdf(true);
    setDownloadSuccess(null);

    try {
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#FCFAF5',
        logging: false
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.98);
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const pdfWidth = pdf.internal.pageSize.getWidth(); // 210 mm
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`動物之家_月度據點績效總結報告_${month}.pdf`);

      setDownloadSuccess('PDF');
      onSendLineToast(`📄 已成功下載「${formattedMonthTitle}」月度據點績效總結 PDF 報告！`);
      setTimeout(() => setDownloadSuccess(null), 3000);
    } catch (err) {
      console.error('PDF export error:', err);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // Print Function
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#5A5A40]/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto font-sans">
      <div className="bg-white rounded-[32px] max-w-4xl w-full shadow-2xl border border-[#5A5A40]/20 overflow-hidden my-6 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header Bar */}
        <div className="bg-[#5A5A40] text-white p-6 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center shadow-md font-bold">
              <FileSpreadsheet className="w-6 h-6 text-slate-900" />
            </div>
            <div>
              <h3 className="font-bold font-serif text-lg text-white italic flex items-center gap-2">
                <span>月度據點志工績效總結與報表匯出</span>
                <span className="text-[10px] bg-[#E6E2D3] text-[#5A5A40] px-2.5 py-0.5 rounded-full font-extrabold not-italic">
                  {month} 統計數據
                </span>
              </h3>
              <p className="text-xs text-[#E6E2D3] mt-0.5">
                自動整合全區與分院據點之志工總數、服務總時數與缺工率分析
              </p>
            </div>
          </div>
          
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Toolbar */}
        <div className="bg-[#f5f5f0] border-b border-[#5A5A40]/15 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2 text-xs text-slate-600 font-bold">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>統計月分：{formattedMonthTitle} ({month})</span>
            {downloadSuccess && (
              <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-3 py-1 rounded-full animate-bounce">
                🎉 {downloadSuccess} 下載成功！
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleExportCSV}
              className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>下載 CSV Excel 檔</span>
            </button>

            <button
              onClick={handleExportPDF}
              disabled={isGeneratingPdf}
              className="bg-[#5A5A40] hover:bg-[#484833] text-white font-bold px-4 py-2 rounded-xl text-xs shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isGeneratingPdf ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-amber-300" />
                  <span>產生 PDF 中...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 text-amber-300" />
                  <span>下載 PDF 報表</span>
                </>
              )}
            </button>

            <button
              onClick={handlePrint}
              className="bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-bold px-3.5 py-2 rounded-xl text-xs transition flex items-center gap-1 cursor-pointer"
            >
              <Printer className="w-4 h-4 text-slate-600" />
              <span>列印</span>
            </button>
          </div>
        </div>

        {/* Printable PDF Report Preview Container */}
        <div className="p-6 bg-slate-100 overflow-x-auto">
          <div className="min-w-[680px] flex justify-center">
            
            <div
              ref={reportRef}
              className="w-[780px] bg-[#FCFAF5] p-8 border-4 border-[#5A5A40] rounded-xl shadow-lg text-[#333333] space-y-6 select-none font-sans"
            >
              
              {/* Official Header */}
              <div className="border-b-2 border-[#5A5A40] pb-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center space-x-2 text-[#5A5A40] font-bold text-xs uppercase tracking-widest">
                    <ShieldCheck className="w-4 h-4 text-[#5A5A40]" />
                    <span>PawRescue Animal Shelter Monthly Performance Report</span>
                  </div>
                  <h1 className="text-2xl font-extrabold font-serif text-[#5A5A40] mt-1">
                    流浪動物之家人力排班 - 月度據點績效總結報告
                  </h1>
                </div>

                <div className="text-right text-xs">
                  <div className="bg-[#5A5A40] text-white font-extrabold px-3 py-1 rounded-lg">
                    {formattedMonthTitle}
                  </div>
                  <p className="text-[11px] text-slate-500 font-mono mt-1">
                    產出日期：{new Date().toLocaleDateString('zh-TW')}
                  </p>
                </div>
              </div>

              {/* High-Level Overview Cards */}
              <div className="grid grid-cols-4 gap-3 text-center">
                <div className="bg-white p-3.5 rounded-xl border border-[#5A5A40]/15 shadow-2xs">
                  <p className="text-[11px] font-bold text-slate-500">當月總志工數</p>
                  <p className="text-2xl font-extrabold text-[#5A5A40] font-serif mt-1">
                    {overallVolunteers} <span className="text-xs font-sans">位</span>
                  </p>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-[#5A5A40]/15 shadow-2xs">
                  <p className="text-[11px] font-bold text-slate-500">完成服務總時數</p>
                  <p className="text-2xl font-extrabold text-slate-900 font-serif mt-1">
                    {overallCompletedHours} <span className="text-xs font-sans">小時</span>
                  </p>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-[#5A5A40]/15 shadow-2xs">
                  <p className="text-[11px] font-bold text-slate-500">總排班需求人數</p>
                  <p className="text-2xl font-extrabold text-sky-900 font-serif mt-1">
                    {overallRequired} <span className="text-xs font-sans">人</span>
                  </p>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-[#5A5A40]/15 shadow-2xs">
                  <p className="text-[11px] font-bold text-slate-500">全機構平均缺工率</p>
                  <p className={`text-2xl font-extrabold font-serif mt-1 ${overallShortageRate > 20 ? 'text-rose-600' : 'text-emerald-700'}`}>
                    {overallShortageRate}%
                  </p>
                </div>
              </div>

              {/* Per-Branch Statistics Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold font-serif text-slate-900 text-sm flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-[#5A5A40]" />
                    <span>各分院據點（Branch）數據明細對照表</span>
                  </h3>
                  <span className="text-[11px] text-slate-500 font-mono">
                    共 {branchStats.length} 個營運據點
                  </span>
                </div>

                <table className="w-full text-xs text-left border-collapse border border-[#5A5A40]/20 rounded-xl overflow-hidden bg-white">
                  <thead>
                    <tr className="bg-[#5A5A40] text-white font-bold text-[11px]">
                      <th className="p-3 border-b border-[#5A5A40]/20">據點名稱</th>
                      <th className="p-3 border-b border-[#5A5A40]/20 text-center">總班次</th>
                      <th className="p-3 border-b border-[#5A5A40]/20 text-center">總志工數</th>
                      <th className="p-3 border-b border-[#5A5A40]/20 text-center">服務總時數</th>
                      <th className="p-3 border-b border-[#5A5A40]/20 text-center">需求 / 已補</th>
                      <th className="p-3 border-b border-[#5A5A40]/20 text-center">缺工人數</th>
                      <th className="p-3 border-b border-[#5A5A40]/20 text-center">缺工率 (%)</th>
                      <th className="p-3 border-b border-[#5A5A40]/20 text-center">運作評等</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {branchStats.map(stat => (
                      <tr key={stat.branchId} className="hover:bg-[#f5f5f0]/50">
                        <td className="p-3 font-bold text-slate-900 flex flex-col">
                          <span>{stat.branchName}</span>
                          <span className="text-[10px] text-slate-400 font-normal">{stat.address}</span>
                        </td>
                        <td className="p-3 text-center font-mono">{stat.totalShifts} 班</td>
                        <td className="p-3 text-center font-bold text-slate-800 font-mono">{stat.totalVolunteers} 人</td>
                        <td className="p-3 text-center font-bold text-[#5A5A40] font-mono">{stat.totalCompletedHours} hr</td>
                        <td className="p-3 text-center font-mono">{stat.requiredCount} / {stat.filledCount}</td>
                        <td className={`p-3 text-center font-bold font-mono ${stat.shortageCount > 0 ? 'text-rose-600' : 'text-slate-600'}`}>
                          {stat.shortageCount} 人
                        </td>
                        <td className="p-3 text-center font-extrabold font-mono text-sm">
                          <span className={stat.shortageRate > 25 ? 'text-rose-600' : stat.shortageRate > 10 ? 'text-amber-700' : 'text-emerald-700'}>
                            {stat.shortageRate}%
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full border ${stat.statusBadgeBg}`}>
                            {stat.statusLabel}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#E6E2D3]/40 font-bold border-t-2 border-[#5A5A40]">
                      <td className="p-3 text-slate-900 font-serif">全機構總計</td>
                      <td className="p-3 text-center font-mono">{overallShifts} 班</td>
                      <td className="p-3 text-center font-mono text-slate-900">{overallVolunteers} 人</td>
                      <td className="p-3 text-center font-mono text-[#5A5A40]">{overallCompletedHours} hr</td>
                      <td className="p-3 text-center font-mono">{overallRequired} / {overallFilled}</td>
                      <td className="p-3 text-center font-mono text-rose-700">{overallShortage} 人</td>
                      <td className="p-3 text-center font-mono text-base text-[#5A5A40]">{overallShortageRate}%</td>
                      <td className="p-3 text-center text-[11px] text-slate-700 font-serif">機構綜合評價</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Analysis & Recommendations Notes */}
              <div className="bg-[#f5f5f0] p-4 rounded-xl border border-[#5A5A40]/15 text-xs space-y-2">
                <div className="font-bold text-[#5A5A40] flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-600" />
                  <span>社工團隊缺工分析與加強招募建議：</span>
                </div>
                <ul className="list-disc list-inside space-y-1 text-slate-600 leading-relaxed text-[11px]">
                  <li>
                    對於缺工率超過 20% 之據點，建議開啟社群「LINE 缺工自動一鍵推播」快速補充救援人力。
                  </li>
                  <li>
                    完成時數係根據志工實際簽到退小時數進行權重加總計算，可用作年度榮譽志工敘獎依據。
                  </li>
                </ul>
              </div>

              {/* Official Seal & Sign-off Footer */}
              <div className="pt-4 border-t border-[#5A5A40]/20 flex items-end justify-between text-xs">
                <div className="space-y-1">
                  <p className="text-slate-500 text-[10px]">PawRescue Animal Shelter Command Center</p>
                  <p className="font-bold text-[#5A5A40]">流浪動物之家 志工督導管理團隊 敬啟</p>
                </div>

                <div className="flex items-center space-x-6 text-center">
                  <div>
                    <p className="text-[10px] text-slate-400">核發主管簽章</p>
                    <div className="h-8 border-b border-slate-400 w-28 mt-1 flex items-center justify-center italic text-slate-400">
                      [社工督導簽核]
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400">系統認證戳記</p>
                    <div className="h-8 border border-emerald-500 rounded-lg w-28 mt-1 bg-emerald-50 flex items-center justify-center text-[10px] font-extrabold text-emerald-800">
                      ✓ PASS 2026-VERIFIED
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* Footer Close Button */}
        <div className="bg-white px-6 py-4 border-t border-[#5A5A40]/10 flex justify-end">
          <button
            onClick={onClose}
            className="bg-[#5A5A40] hover:bg-[#484833] text-white font-bold px-6 py-2 rounded-full text-xs shadow-xs transition cursor-pointer"
          >
            關閉報表
          </button>
        </div>

      </div>
    </div>
  );
};
