/**
 * Whether the AI is working, and on what.
 *
 * Embedding failure is silent by design: saving SOP content succeeds whether or
 * not the vectors update, because volunteers must see the shelter's words even
 * when the AI is down. That is right for the save and wrong for the shelter --
 * without this panel, the day the quota runs out is the day the assistant
 * quietly starts answering from material that was replaced weeks ago, and
 * nothing anywhere says so.
 *
 * Read-only, and it never shows the API key -- only whether one is set. A key
 * attached to somebody's billing account does not belong in a web page.
 */
import React, { useEffect, useState } from 'react';
import { Sparkles, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Loader2 } from 'lucide-react';
import { authFetch } from '../utils/session';

interface AiStatus {
  keyConfigured: boolean;
  textModel: string;
  embedModel: string;
  lastEmbedding: { at: string; ok: boolean; error?: string } | null;
  chunks: { total: number; bySource: Record<string, number> };
  sections: { total: number; embedded: number };
}

const SOURCE_LABELS: Record<string, string> = {
  section: '手冊章節',
  emergency: '緊急處理',
  pdf: '上傳的 PDF',
  video: '教學影片',
  static: '系統內建'
};

export const AiServiceStatus: React.FC = () => {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = () => {
    setIsLoading(true);
    authFetch('/api/admin/ai-status')
      .then(res => res.json())
      .then(data => { if (data.success) setStatus(data); })
      .catch(() => { /* leave the last known state on screen */ })
      .finally(() => setIsLoading(false));
  };

  useEffect(load, []);

  if (!status) {
    return (
      <div className="bg-white p-6 rounded-[28px] border border-[#716053] shadow-xs">
        <p className="text-sm text-slate-400 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> 讀取 AI 服務狀態…
        </p>
      </div>
    );
  }

  const sectionsBehind = status.sections.total - status.sections.embedded;
  const healthy = status.keyConfigured && sectionsBehind === 0 && status.lastEmbedding?.ok !== false;

  return (
    <div className="bg-white p-6 rounded-[28px] border border-[#716053] shadow-xs space-y-4">

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#716053] text-white flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-amber-300" />
          </div>
          <div>
            <h3 className="text-lg font-bold font-serif italic text-slate-900">AI 服務狀態</h3>
            <p className="text-xs text-slate-500 mt-0.5 max-w-xl">
              「問手冊 AI 小幫手」靠的是把手冊內容轉成向量。轉換失敗時內容照樣儲存、志工照樣看得到，
              但 AI 會繼續用舊的內容回答——這裡就是唯一看得出來的地方。
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={isLoading}
          className="shrink-0 px-3 py-1.5 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
        >
          {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          <span>重新檢查</span>
        </button>
      </div>

      <div className={`rounded-2xl p-4 border flex items-start gap-2 ${
        healthy ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-300'
      }`}>
        {healthy
          ? <CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" />
          : <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />}
        <p className={`text-xs ${healthy ? 'text-emerald-900' : 'text-amber-900'}`}>
          {!status.keyConfigured
            ? <><strong>尚未設定 API 金鑰。</strong>AI 問答會退回關鍵字比對，只找得到手冊裡最接近的原文段落，而且會明說「AI 暫時無法使用」。</>
            : sectionsBehind > 0
              ? <><strong>有 {sectionsBehind} 個手冊章節還沒進入 AI 索引。</strong>AI 回答時看不到那些章節的內容。到「手冊與 SOP 內容管理」按一次儲存即可重新嘗試。</>
              : status.lastEmbedding?.ok === false
                ? <><strong>最近一次轉換失敗。</strong>目前的索引仍然可用，但新的編輯不會進去。</>
                : <>一切正常。社工寫進手冊的內容，AI 都看得到。</>}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
          <p className="text-[11px] text-slate-500 font-bold">API 金鑰</p>
          <p className="font-bold text-slate-900 flex items-center gap-1 mt-0.5">
            {status.keyConfigured
              ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />已設定</>
              : <><XCircle className="w-3.5 h-3.5 text-rose-600" />未設定</>}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">內容不顯示</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
          <p className="text-[11px] text-slate-500 font-bold">文字模型</p>
          <p className="font-mono text-[11px] text-slate-800 mt-0.5 break-all">{status.textModel}</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
          <p className="text-[11px] text-slate-500 font-bold">向量模型</p>
          <p className="font-mono text-[11px] text-slate-800 mt-0.5 break-all">{status.embedModel}</p>
        </div>
      </div>

      <div className="border border-slate-200 rounded-2xl overflow-hidden">
        <p className="text-[11px] font-bold text-slate-500 bg-slate-50 px-3 py-2 border-b border-slate-200">
          AI 目前看得到的內容（共 {status.chunks.total} 段）
        </p>
        <div className="divide-y divide-slate-100">
          {Object.entries(status.chunks.bySource).map(([source, count]) => (
            <div key={source} className="px-3 py-2 flex items-center justify-between text-xs">
              <span className="text-slate-700">{SOURCE_LABELS[source] || source}</span>
              <span className="font-bold tabular-nums text-slate-900">{count}</span>
            </div>
          ))}
          <div className="px-3 py-2 flex items-center justify-between text-xs bg-slate-50/60">
            <span className="text-slate-700 font-bold">手冊章節已進索引</span>
            <span className={`font-bold tabular-nums ${sectionsBehind > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
              {status.sections.embedded} / {status.sections.total}
            </span>
          </div>
        </div>
      </div>

      {status.lastEmbedding && (
        <p className="text-[11px] text-slate-500">
          最後一次向量轉換：{new Date(status.lastEmbedding.at).toLocaleString('zh-TW', { hour12: false })}
          {status.lastEmbedding.ok
            ? <span className="text-emerald-700 font-bold">　成功</span>
            : <span className="text-rose-700 font-bold">　失敗：{status.lastEmbedding.error}</span>}
        </p>
      )}

      <p className="text-[11px] text-slate-400 border-t border-slate-100 pt-3">
        要更換金鑰或模型，請編輯伺服器上的 <code className="font-mono">.env.local</code> 後重新啟動服務。
        金鑰綁著 Google 帳單，<strong>刻意不做成後台可編輯</strong>——存進資料庫就會進到每日備份，
        而拿到管理端的人就等於拿到那把鑰匙。換完之後記得回「手冊與 SOP 內容管理」按一次儲存，讓章節重新進索引。
      </p>
    </div>
  );
};
