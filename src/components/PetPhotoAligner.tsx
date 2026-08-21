import React, { useRef, useState } from 'react';
import { GUIDE_CENTER, GUIDE_LANDMARKS, scaleGuidePoint } from '../utils/papercraft/faceRegions';

export interface PhotoTransform {
  imageSrc: string;
  naturalWidth: number;
  naturalHeight: number;
  /** Displayed image width in container px = naturalWidth * zoom. */
  zoom: number;
  /** Top-left of the displayed image, in container px. */
  panX: number;
  panY: number;
  /** How much the face guide (oval + landmarks) is scaled from its default size, around GUIDE_CENTER. 1 = default. */
  guideScale: number;
}

const GUIDE_SIZE = 320;

interface PetPhotoAlignerProps {
  onChange: (t: PhotoTransform | null) => void;
}

export const PetPhotoAligner: React.FC<PetPhotoAlignerProps> = ({ onChange }) => {
  const [transform, setTransform] = useState<PhotoTransform | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragState = useRef<{ startX: number; startY: number; basePanX: number; basePanY: number } | null>(null);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => {
        // Start centered, scaled so the image's shorter side fills the guide.
        const baseZoom = GUIDE_SIZE / Math.min(img.naturalWidth, img.naturalHeight);
        const next: PhotoTransform = {
          imageSrc: src,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          zoom: baseZoom,
          panX: (GUIDE_SIZE - img.naturalWidth * baseZoom) / 2,
          panY: (GUIDE_SIZE - img.naturalHeight * baseZoom) / 2,
          guideScale: 1,
        };
        setTransform(next);
        onChange(next);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!transform) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, basePanX: transform.panX, basePanY: transform.panY };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragState.current || !transform) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    const next = { ...transform, panX: dragState.current.basePanX + dx, panY: dragState.current.basePanY + dy };
    setTransform(next);
    onChange(next);
  }
  function onPointerUp() {
    dragState.current = null;
  }

  function onGuideScaleChange(newScale: number) {
    if (!transform) return;
    const next = { ...transform, guideScale: newScale };
    setTransform(next);
    onChange(next);
  }

  function onZoomChange(newZoom: number) {
    if (!transform) return;
    // Zoom around the guide's center so the subject doesn't drift while scaling.
    const cx = GUIDE_SIZE / 2, cy = GUIDE_SIZE / 2;
    const scaleRatio = newZoom / transform.zoom;
    const next = {
      ...transform,
      zoom: newZoom,
      panX: cx - (cx - transform.panX) * scaleRatio,
      panY: cy - (cy - transform.panY) * scaleRatio,
    };
    setTransform(next);
    onChange(next);
  }

  const minZoom = transform ? GUIDE_SIZE / Math.max(transform.naturalWidth, transform.naturalHeight) * 0.6 : 0.1;
  const maxZoom = transform ? GUIDE_SIZE / Math.min(transform.naturalWidth, transform.naturalHeight) * 3 : 3;

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {!transform ? (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-[320px] h-[320px] border-2 border-dashed border-amber-300 rounded-xl flex flex-col items-center justify-center gap-2 text-slate-500 hover:bg-amber-50"
        >
          <span className="text-3xl">📷</span>
          <span className="text-sm font-bold">上傳毛孩正面照片</span>
        </button>
      ) : (
        <div>
          <div
            className="relative overflow-hidden rounded-xl border border-amber-200 touch-none cursor-grab active:cursor-grabbing"
            style={{ width: GUIDE_SIZE, height: GUIDE_SIZE }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            <img
              src={transform.imageSrc}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                left: transform.panX,
                top: transform.panY,
                width: transform.naturalWidth * transform.zoom,
                height: transform.naturalHeight * transform.zoom,
                pointerEvents: 'none',
              }}
            />
            {/* Guide overlay: nose + eye landmarks, matching FACE_GUIDE_REGIONS. Resizable via guideScale so it can fit different pet face proportions instead of forcing the photo to match one fixed oval. */}
            <svg width={GUIDE_SIZE} height={GUIDE_SIZE} className="absolute inset-0 pointer-events-none">
              <ellipse
                cx={GUIDE_CENTER.x * GUIDE_SIZE}
                cy={GUIDE_CENTER.y * GUIDE_SIZE}
                rx={GUIDE_SIZE * 0.26 * transform.guideScale}
                ry={GUIDE_SIZE * 0.34 * transform.guideScale}
                fill="none" stroke="white" strokeWidth={2} strokeDasharray="6 5" opacity={0.85}
              />
              {Object.entries(GUIDE_LANDMARKS).map(([key, pt]) => {
                const scaled = scaleGuidePoint(pt, transform.guideScale);
                return <circle key={key} cx={scaled.x * GUIDE_SIZE} cy={scaled.y * GUIDE_SIZE} r={5} fill="#F59E0B" stroke="white" strokeWidth={1.5} />;
              })}
            </svg>
          </div>
          <p className="text-xs text-slate-500 mt-2">拖曳照片 + 縮放,讓毛孩的鼻子、額頭、下巴與雙頰對準 5 個黃點;圈圈大小也可以調整,配合毛孩臉型比例</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-slate-400 w-10">照片</span>
            <input
              type="range"
              min={minZoom}
              max={maxZoom}
              step={(maxZoom - minZoom) / 200}
              value={transform.zoom}
              onChange={e => onZoomChange(Number(e.target.value))}
              className="flex-1"
            />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-slate-400 w-10">圈圈</span>
            <input
              type="range"
              min={0.6}
              max={1.6}
              step={0.01}
              value={Number.isFinite(transform.guideScale) ? transform.guideScale : 1}
              onChange={e => onGuideScaleChange(Number(e.target.value))}
              className="flex-1"
            />
          </div>
          <button
            onClick={() => { setTransform(null); onChange(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
            className="mt-2 text-xs text-slate-500 underline"
          >
            換一張照片
          </button>
        </div>
      )}
    </div>
  );
};
