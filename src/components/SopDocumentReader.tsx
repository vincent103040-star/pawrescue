import React, { useState, useEffect, useMemo } from 'react';
import { X, Search, Loader2, Download, BookOpen, AlertTriangle } from 'lucide-react';
import { SopDocument } from '../types';

interface SopDocumentReaderProps {
  doc: SopDocument;
  onClose: () => void;
}

/**
 * Reads an uploaded manual as text instead of downloading the file.
 *
 * The shelter's manual is a stack of scanned pages -- 88MB, of which ~96% is
 * scanned images and only ~31KB is actual words. On a phone that's a download
 * nobody finishes. The text was already extracted at upload time to build the
 * AI index, so serving it costs nothing extra and arrives instantly.
 */
export const SopDocumentReader: React.FC<SopDocumentReaderProps> = ({ doc, onClose }) => {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sop-documents/${encodeURIComponent(doc.id)}/text`)
      .then(res => res.json())
      .then(data => {
        if (cancelled) return;
        if (data.success) setText(data.text);
        else setError(data.error || '讀取失敗');
      })
      .catch(() => { if (!cancelled) setError('網路連線異常，請稍後再試'); });
    return () => { cancelled = true; };
  }, [doc.id]);

  // Split into readable paragraphs, then filter by the search box. The text
  // comes out of a scanner, so paragraph breaks are approximate -- good enough
  // to find a section by keyword, which is what people actually do with a manual.
  const paragraphs = useMemo(() => {
    if (!text) return [];
    return text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  }, [text]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return paragraphs;
    return paragraphs.filter(p => p.toLowerCase().includes(q));
  }, [paragraphs, query]);

  /** Wraps every occurrence of the search term so the eye can find it. */
  const highlight = (paragraph: string) => {
    const q = query.trim();
    if (!q) return paragraph;
    const parts = paragraph.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase()
        ? <mark key={i} className="bg-amber-200 text-slate-900 rounded px-0.5">{part}</mark>
        : <React.Fragment key={i}>{part}</React.Fragment>
    );
  };

  const sizeLabel = doc.fileSize ? `${(doc.fileSize / 1048576).toFixed(1)} MB` : '';

  return (
    <div className="fixed inset-0 bg-[#716053]/60 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-6">
      <div className="bg-white w-full max-w-3xl max-h-[90vh] rounded-[28px] border border-[#716053] shadow-md flex flex-col overflow-hidden">

        <div className="p-5 border-b border-[#716053] flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="font-bold font-serif text-slate-900 text-base flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[#716053] shrink-0" />
              <span className="truncate">{doc.title}</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-1">
              📖 線上閱讀版 • 只載入文字，手機看不用等下載
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:bg-slate-100 p-1.5 rounded-lg transition cursor-pointer shrink-0"
            aria-label="關閉"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 border-b border-[#716053] shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜尋手冊內容，例如「打掃」「集合」"
              className="w-full pl-9 pr-3 py-2.5 rounded-2xl border border-[#716053] bg-[#FFFDF7] text-xs focus:outline-none"
            />
          </div>
          {query.trim() && text && (
            <p className="text-[11px] text-slate-500 mt-2">
              🔍 找到 {matches.length} 個段落
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {!text && !error && (
            <div className="flex items-center justify-center gap-2 text-slate-500 text-xs py-12">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>讀取中...</span>
            </div>
          )}

          {error && (
            <div className="bg-amber-50 border border-[#716053] rounded-2xl p-4 text-xs text-slate-700 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold mb-1">無法線上閱讀</p>
                <p>{error}</p>
                <p className="mt-2 text-slate-500">你仍然可以從下方下載原始檔案。</p>
              </div>
            </div>
          )}

          {text && matches.length === 0 && (
            <p className="text-xs text-slate-500 text-center py-12">
              🐾 這個關鍵字在手冊裡找不到，換個說法試試看。
            </p>
          )}

          {matches.map((paragraph, i) => (
            <p key={i} className="text-xs leading-relaxed text-slate-700 bg-[#FFFDF7] border border-[#716053] rounded-2xl p-4 whitespace-pre-wrap break-words">
              {highlight(paragraph)}
            </p>
          ))}
        </div>

        <div className="p-4 border-t border-[#716053] shrink-0 bg-[#FFFDF7]">
          <a
            href={doc.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 text-[11px] text-slate-600 hover:text-[#716053] font-bold"
          >
            <Download className="w-3.5 h-3.5" />
            <span>下載原始掃描檔{sizeLabel && `（${sizeLabel}，建議用 Wi-Fi）`}</span>
          </a>
        </div>
      </div>
    </div>
  );
};
