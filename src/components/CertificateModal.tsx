import React, { useRef, useState } from 'react';
import { VolunteerProfile } from '../types';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Download, X, Award, ShieldCheck, Sparkles, CheckCircle2, FileText, Loader2 } from 'lucide-react';

interface CertificateModalProps {
  volunteer: VolunteerProfile;
  onClose: () => void;
}

export const CertificateModal: React.FC<CertificateModalProps> = ({ volunteer, onClose }) => {
  const certificateRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  // Generate today's date string in Traditional Chinese format
  const today = new Date();
  const yearStr = today.getFullYear();
  const monthStr = String(today.getMonth() + 1).padStart(2, '0');
  const dateStr = String(today.getDate()).padStart(2, '0');
  const formattedDate = `${yearStr} 年 ${monthStr} 月 ${dateStr} 日`;

  const certNumber = `PAW-CERT-2026-${volunteer.id.replace(/[^0-9]/g, '') || '888'}`;

  const handleDownloadPdf = async () => {
    if (!certificateRef.current) return;
    setIsGenerating(true);
    setDownloadSuccess(false);

    try {
      // Use html2canvas to convert DOM to canvas with high resolution
      const canvas = await html2canvas(certificateRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#FAF6EE',
        logging: false
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.98);

      // Create landscape A4 PDF document
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });

      const pdfWidth = pdf.internal.pageSize.getWidth(); // 297 mm
      const pdfHeight = pdf.internal.pageSize.getHeight(); // 210 mm

      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`浪浪家園_志工服務證明書_${volunteer.name}.pdf`);

      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 4000);
    } catch (err) {
      console.error('PDF generation error:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#716053]/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto font-sans">
      <div className="bg-white rounded-[32px] max-w-4xl w-full shadow-2xl border border-[#716053] overflow-hidden my-6 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header Bar */}
        <div className="bg-[#716053] text-white p-6 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center shadow-md font-bold">
              <Award className="w-6 h-6 text-slate-900" />
            </div>
            <div>
              <h3 className="font-bold font-serif text-lg text-white italic flex items-center gap-2">
                <span>浪浪家園 志工服務榮譽證明書下載</span>
                <span className="text-[10px] bg-[#F5E6D0] text-[#716053] px-2.5 py-0.5 rounded-full font-extrabold not-italic">
                  PDF 官方認證格式
                </span>
              </h3>
              <p className="text-xs text-[#F5E6D0] mt-0.5">
                可作為服務證明、學校抵免時數或志工榮譽敘獎之正式文件
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

        {/* Certificate Preview Printable Frame */}
        <div className="p-6 bg-[#FAF6EE] overflow-x-auto">
          
          <div className="min-w-[700px] flex justify-center">
            {/* Real printable container for html2canvas capture */}
            <div
              ref={certificateRef}
              className="w-[842px] h-[595px] bg-[#FAF6EE] p-10 border-[12px] border-[#716053] rounded-xl shadow-xl relative flex flex-col justify-between text-[#716053] select-none"
              style={{
                boxSizing: 'border-[#716053]'
              }}
            >
              {/* Decorative Double Border */}
              <div className="absolute inset-3 border-2 border-dashed border-[#716053] rounded-lg pointer-events-none"></div>

              {/* Watermark Logo Background */}
              <div className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none">
                <div className="text-[160px] font-black font-serif text-[#716053]">🐾 PAW</div>
              </div>

              {/* Certificate Header */}
              <div className="text-center space-y-2 pt-2 relative z-10">
                <div className="flex items-center justify-center space-x-2 text-[#716053] font-bold text-xs uppercase tracking-widest">
                  <ShieldCheck className="w-4 h-4 text-[#716053]" />
                  <span>PawRescue Animal Shelter Volunteer Certificate</span>
                  <ShieldCheck className="w-4 h-4 text-[#716053]" />
                </div>
                <h1 className="text-3xl font-extrabold font-serif text-[#716053] tracking-wider italic">
                  浪浪家園 志工服務榮譽證明書
                </h1>
                <p className="text-[11px] text-slate-500 font-mono tracking-widest">
                  證書編號：{certNumber}
                </p>
              </div>

              {/* Main Body Statement */}
              <div className="space-y-6 my-auto text-center px-8 relative z-10">
                <p className="text-base text-slate-700 leading-relaxed font-serif">
                  茲證明志工 <strong className="text-2xl text-[#716053] underline decoration-[#716053]/30 underline-offset-8 px-2">{volunteer.name}</strong> 君（LINE 帳號：@{volunteer.lineId}），
                  熱心投入浪浪家園園區保護流浪動物、洗澡放風、貓舍照護與園區運作之志工服務。
                  服務期間盡心盡力，特頒此證以資感謝與鼓勵！
                </p>

                {/* Key Stats Banner */}
                <div className="bg-[#F5E6D0]/40 border border-[#716053] rounded-2xl p-5 grid grid-cols-3 gap-4 max-w-xl mx-auto shadow-2xs">
                  <div className="text-center">
                    <p className="text-xs text-[#716053] font-bold">累積服務時數</p>
                    <p className="text-2xl font-extrabold text-[#716053] font-serif mt-1">
                      {volunteer.totalHours} <span className="text-xs font-sans">小時</span>
                    </p>
                  </div>
                  <div className="text-center border-x border-[#716053]">
                    <p className="text-xs text-[#716053] font-bold">完成班次總數</p>
                    <p className="text-2xl font-extrabold text-slate-900 font-serif mt-1">
                      {volunteer.completedShiftsCount} <span className="text-xs font-sans">次</span>
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-[#716053] font-bold">志工榮譽階級</p>
                    <p className="text-lg font-extrabold text-amber-800 font-serif mt-1.5">
                      {volunteer.tier}
                    </p>
                  </div>
                </div>

                <div className="text-xs text-slate-500">
                  專長服務項目：{volunteer.skills.join('、')}
                </div>
              </div>

              {/* Certificate Footer with Stamp / Signature */}
              <div className="flex justify-between items-end pb-2 px-6 relative z-10 font-serif">
                <div className="text-left space-y-1">
                  <p className="text-xs text-slate-600 font-bold">發證單位：浪浪家園 志工管理委員會</p>
                  <p className="text-xs text-slate-500">發證日期：{formattedDate}</p>
                </div>

                {/* Simulated Red Official Stamp */}
                <div className="relative">
                  <div className="w-24 h-24 border-4 border-rose-700/80 rounded-full flex flex-col items-center justify-center text-rose-700 font-bold text-[10px] transform -rotate-12 select-none opacity-85 shadow-2xs">
                    <div className="border-t border-b border-rose-700/80 my-0.5 px-1 py-0.5">浪浪家園</div>
                    <span className="font-serif">志工審核章</span>
                    <span className="text-[8px] font-mono">OFFICIAL SEAL</span>
                  </div>
                </div>
              </div>

            </div>
          </div>

        </div>

        {/* Action Controls */}
        <div className="bg-[#FAF6EE] p-5 border-t border-[#716053] flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="flex items-center space-x-2 text-xs text-slate-600 font-sans">
            <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
            <span>點擊下方按鈕，系統將自動繪製向量頁面並下載為《{volunteer.name}_志工服務證明書.pdf》</span>
          </div>

          <div className="flex items-center space-x-3">
            {downloadSuccess && (
              <span className="text-xs text-emerald-700 font-bold flex items-center gap-1 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>PDF 下載成功！</span>
              </span>
            )}

            <button
              onClick={onClose}
              className="px-4 py-2 bg-white border border-[#716053] text-slate-700 rounded-full font-bold text-xs hover:bg-slate-100 transition cursor-pointer"
            >
              取消
            </button>

            <button
              onClick={handleDownloadPdf}
              disabled={isGenerating}
              className="bg-[#716053] hover:bg-[#5A4A3F] text-white font-extrabold px-6 py-2.5 rounded-full text-xs shadow-md transition flex items-center space-x-2 cursor-pointer disabled:opacity-50"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-amber-300" />
                  <span>繪製 PDF 檔案中...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 text-amber-300" />
                  <span>下載 PDF 志工服務證書</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
