import React, { useState } from 'react';
import { PositionShift } from '../types';
import { ZONE_CONFIGS } from '../data/mockData';
import { Sparkles, Copy, Check, X, RefreshCw, Share2, MessageSquare } from 'lucide-react';

interface AiPostModalProps {
  shift: PositionShift;
  locationName: string;
  onClose: () => void;
  onShareToLine: (content: string) => void;
}

export const AiPostModal: React.FC<AiPostModalProps> = ({
  shift,
  locationName,
  onClose,
  onShareToLine
}) => {
  const [loading, setLoading] = useState(false);
  const [postContent, setPostContent] = useState('');
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const zoneConfig = ZONE_CONFIGS[shift.zone];

  const handleGenerate = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/ai/generate-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: shift.title,
          zoneName: zoneConfig?.name || shift.zone,
          branchName: locationName || '浪浪家園園區',
          date: shift.date,
          timeRange: shift.timeRange,
          requiredCount: shift.requiredCount - shift.currentCount,
          tasks: shift.tasks
        })
      });

      const data = await res.json();
      if (data.success && data.postContent) {
        setPostContent(data.postContent);
      } else {
        throw new Error('Generate post failed');
      }
    } catch (err: any) {
      console.warn('Using client fallback for AI post generation', err);
      const fallbackPost = `🐾【志工急召！${locationName || '浪浪家園'} - ${shift.title}】🐶🐱\n\n` +
        `毛孩們需要你的神隊友救援！我們正在尋找溫暖有愛心的你～\n\n` +
        `📍 服務區域：${zoneConfig?.name || shift.zone}\n` +
        `📅 服務日期：${shift.date} (${shift.timeRange})\n` +
        `👥 尚缺名額：${Math.max(1, shift.requiredCount - shift.currentCount)} 位熱血志工\n\n` +
        `📋 任務內容：\n${(shift.tasks && shift.tasks.length) ? shift.tasks.map((t: string) => `• ${t}`).join('\n') : '• 陪伴毛孩放風、環境清潔與安撫'}\n\n` +
        `❤️ 一起用陪伴改變浪浪的一生！一鍵點擊連結登記預約，LINE 自動同步班表提醒喔！`;
      setPostContent(fallbackPost);
    } finally {
      setLoading(false);
    }
  };

  // Generate automatically on mount if empty
  React.useEffect(() => {
    handleGenerate();
  }, [shift.id]);

  const handleCopy = () => {
    navigator.clipboard.writeText(postContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#716053]/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-[32px] max-w-xl w-full shadow-2xl overflow-hidden border border-[#716053] animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="bg-[#716053] p-6 text-white flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-white/15 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-[#F5E6D0]" />
            </div>
            <div>
              <h3 className="font-bold font-serif italic text-lg text-white">Gemini AI 志工招募文案產生器</h3>
              <p className="text-xs text-[#F5E6D0] font-sans">一鍵生成適用於 LINE 社群、FB 粉絲頁與 Google 日曆說明</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/15 transition cursor-pointer text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Shift Summary Box */}
        <div className="p-4 bg-[#FAF6EE] border-b border-[#716053] flex items-center justify-between text-xs text-slate-700 font-sans">
          <div>
            <span className="font-bold text-slate-900 font-serif text-sm">{shift.title}</span>
            <p className="text-[#716053] mt-0.5 font-medium">
              📅 {shift.date} ({shift.timeRange}) • 尚缺 {shift.requiredCount - shift.currentCount} 人
            </p>
          </div>
          <span className={`px-3 py-1 rounded-full font-bold text-[10px] ${zoneConfig?.badgeBg}`}>
            {zoneConfig?.icon} {zoneConfig?.name}
          </span>
        </div>

        {/* Content Preview Body */}
        <div className="p-6 space-y-4 font-sans">
          {loading ? (
            <div className="py-12 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-[#716053] animate-spin mx-auto" />
              <p className="text-xs font-bold text-[#716053]">
                Gemini 正在撰寫溫暖吸引人的志工招募貼文...
              </p>
              <p className="text-[11px] text-slate-500">將自動嵌入 Google 地圖導航與 LINE 報名連結</p>
            </div>
          ) : errorMsg ? (
            <div className="p-4 bg-rose-50 text-rose-700 rounded-2xl text-xs space-y-2 border border-rose-200">
              <p className="font-bold">❌ {errorMsg}</p>
              <button
                onClick={handleGenerate}
                className="px-3 py-1 bg-rose-700 text-white rounded-full text-[11px] font-bold cursor-pointer"
              >
                重試一次
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[#716053] uppercase tracking-wider">生成之貼文內容預覽：</span>
                <button
                  onClick={handleGenerate}
                  className="text-xs text-[#716053] hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>重新生成</span>
                </button>
              </div>

              <textarea
                value={postContent}
                onChange={(e) => setPostContent(e.target.value)}
                rows={9}
                className="w-full p-4 border border-[#716053] rounded-2xl bg-[#FAF6EE] text-xs text-slate-800 font-sans focus:outline-none focus:ring-2 focus:ring-[#716053] leading-relaxed"
              />
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 bg-[#FAF6EE] border-t border-[#716053] flex flex-wrap items-center justify-between gap-3 font-sans">
          <div className="text-[11px] text-[#716053] font-medium">
            💡 可複製內容發送至 LINE 志工群組或 FB 粉絲頁
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleCopy}
              disabled={!postContent || loading}
              className="px-4 py-2.5 bg-white border border-[#716053] hover:bg-[#F5E6D0]/30 text-[#716053] rounded-full text-xs font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              {copied ? <Check className="w-4 h-4 text-[#716053]" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? '已複製！' : '複製貼文'}</span>
            </button>

            <button
              onClick={() => {
                onShareToLine(postContent);
                onClose();
              }}
              disabled={!postContent || loading}
              className="px-5 py-2.5 bg-[#716053] hover:bg-[#5A4A3F] text-white rounded-full text-xs font-bold flex items-center gap-1.5 shadow-xs transition cursor-pointer disabled:opacity-50"
            >
              <MessageSquare className="w-4 h-4 text-[#F5E6D0]" />
              <span>推播至 LINE 模擬器</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
