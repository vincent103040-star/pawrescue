/**
 * The manual section and video for one duty, shown at the moment it is needed.
 *
 * The plan's argument for putting training here rather than on a page of its
 * own: people do not watch a demonstration to learn, they watch it because they
 * are about to do the thing. So it opens over the checklist and closes back
 * onto the tick box, rather than navigating anybody away from their work.
 *
 * Shared by the coordinator's board and the volunteer's, because the same
 * material shown two ways eventually becomes two different things -- and this
 * week has already produced two bugs from writing the same logic twice.
 */
import React from 'react';
import { PlayCircle, BookOpen, CheckCircle2, X } from 'lucide-react';

export interface DutyMaterial {
  section: { id: string; title: string; items: Array<{ label: string; text: string }> } | null;
  video: { id: string; title: string; description: string; fileUrl: string } | null;
}

interface DutyMaterialModalProps {
  title: string;
  material: DutyMaterial;
  onClose: () => void;
}

export const DutyMaterialModal: React.FC<DutyMaterialModalProps> = ({ title, material, onClose }) => (
  <div
    className="fixed inset-0 z-50 bg-[#333322]/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
    onClick={onClose}
  >
    <div
      className="bg-white rounded-[28px] border border-[#716053] shadow-2xl max-w-2xl w-full max-h-[88vh] overflow-y-auto"
      onClick={e => e.stopPropagation()}
    >
      <div className="bg-[#716053] text-white p-5 flex items-start justify-between gap-3 sticky top-0">
        <div>
          <p className="text-[11px] text-amber-200 font-bold">出勤前先看一下</p>
          <h3 className="text-base font-bold font-serif italic">{title}</h3>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 p-1.5 rounded-full hover:bg-white/20 transition cursor-pointer"
          aria-label="關閉"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-5 space-y-5">
        {material.video && (
          <div className="space-y-2">
            <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <PlayCircle className="w-4 h-4 text-rose-600" />
              {material.video.title}
            </p>
            {/* preload="none": volunteers open this on a phone at the shelter
                gate, and a video that downloads itself before anyone presses
                play spends their data for nothing. */}
            <video
              src={material.video.fileUrl}
              controls
              preload="none"
              className="w-full rounded-2xl bg-black max-h-72"
            />
            {material.video.description && (
              <p className="text-xs text-slate-600 leading-relaxed">{material.video.description}</p>
            )}
          </div>
        )}

        {material.section && (
          <div className="space-y-2">
            <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-indigo-600" />
              {material.section.title}
            </p>
            <ul className="space-y-2">
              {material.section.items.map((entry, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-slate-700 leading-relaxed">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                  <span><strong>{entry.label}</strong>：{entry.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="px-5 pb-5">
        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-2xl bg-[#716053] hover:bg-[#5A4A3F] text-white text-sm font-bold transition cursor-pointer"
        >
          看完了，回到勤務清單
        </button>
      </div>
    </div>
  </div>
);
