import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildAnimalHeadMesh, EarStyle, Mesh, vCross, vNormalize, vSub, Vec3 } from '../utils/papercraft/mesh';
import { unfoldMesh, UnfoldedFace } from '../utils/papercraft/unfold';
import { loadImage, warpTriangleToDataUrl } from '../utils/papercraft/triangleWarp';
import { FACE_GUIDE_REGIONS, scaleGuidePoint, rotateGuidePoint } from '../utils/papercraft/faceRegions';
import { PetPhotoAligner, PhotoTransform } from './PetPhotoAligner';

const GUIDE_SIZE = 320;

/** Guide-space (0..1 within the 320x320 alignment square) -> the uploaded photo's own pixel space, using the user's pan/zoom/guide-scale from PetPhotoAligner. */
function guideToImageSpace(pt: { x: number; y: number }, t: PhotoTransform) {
  const scaled = rotateGuidePoint(scaleGuidePoint(pt, t.guideScale), t.guideRotation);
  const containerX = scaled.x * GUIDE_SIZE;
  const containerY = scaled.y * GUIDE_SIZE;
  return {
    x: (containerX - t.panX) / t.zoom,
    y: (containerY - t.panY) / t.zoom,
  };
}

/** A normalized (0..1 of the photo's own width/height) bounding box, as returned by /api/ai/detect-pet-ears. */
interface EarBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Turns an AI-detected ear bounding box into a source triangle, in the
 * photo's actual pixel space, ready for warpTriangleToDataUrl.
 *
 * The destination slot order matters: slot 1 must land on whichever corner
 * is visually the ear's tip (top-center of the box), because in the mesh
 * both earLeft=[cheekL, earTipL, crown] and earRight=[crown, earTipR,
 * cheekR] put their tip vertex in that same middle position -- despite the
 * two faces otherwise listing cheek/crown in opposite order (a mirrored
 * pair, not a rotation). Using the same [bottomLeft, topMid, bottomRight]
 * mapping for both sides keeps "up" pointing up on both ears; using raw
 * [topLeft, topRight, bottomLeft] corners (the previous version) matched
 * one ear's vertex order but landed upside-down on the other.
 */
function earBoxToTriangle(box: EarBox, naturalWidth: number, naturalHeight: number): [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }] {
  const x0 = box.x * naturalWidth;
  const y0 = box.y * naturalHeight;
  const x1 = (box.x + box.width) * naturalWidth;
  const y1 = (box.y + box.height) * naturalHeight;
  const bottomLeft = { x: x0, y: y1 };
  const topMid = { x: (x0 + x1) / 2, y: y0 };
  const bottomRight = { x: x1, y: y1 };
  return [bottomLeft, topMid, bottomRight];
}

const FACE_COLOR: Record<string, string> = {
  noseTopLeft: '#F4D9B8',
  noseLeftBottom: '#F0CFA0',
  noseBottomRight: '#F0CFA0',
  noseRightTop: '#F4D9B8',
  crownTopLeft: '#E8B87A',
  crownLeftBottom: '#E2AD6B',
  crownBottomRight: '#E2AD6B',
  crownRightTop: '#E8B87A',
  earLeft: '#D99A6C',
  earRight: '#D99A6C',
};

// CSS px per mesh unit. The mesh's coordinates are roughly in the -1..1
// range, so this gives a comfortably large on-screen model.
const SCALE = 130;

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/**
 * Builds a CSS matrix3d() string that maps a local unit triangle
 * ((0,0,0), (1,0,0), (0,1,0)) onto the given 3 target points -- i.e. an
 * affine frame defined by "P0 is the origin, P1-P0 is the local x-axis,
 * P2-P0 is the local y-axis". The face's own normal fills in the otherwise
 * unused local z-axis so the matrix stays well-formed.
 */
// The div this matrix is applied to is BASE_PX x BASE_PX before transform
// (not 1x1) -- rasterizing a 1x1px element and then scaling it ~100x via
// the matrix produces a blurry upscaled blob, since the browser paints the
// element at its laid-out size first. A larger base size gives it a crisp
// raster to scale from.
const BASE_PX = 200;

function matrix3dForTriangle(p0: Vec3, p1: Vec3, p2: Vec3): string {
  const xAxis = vSub(p1, p0);
  const yAxis = vSub(p2, p0);
  const zAxis = vNormalize(vCross(xAxis, yAxis));
  const m = [
    xAxis.x / BASE_PX, xAxis.y / BASE_PX, xAxis.z / BASE_PX, 0,
    yAxis.x / BASE_PX, yAxis.y / BASE_PX, yAxis.z / BASE_PX, 0,
    zAxis.x, zAxis.y, zAxis.z, 0,
    p0.x, p0.y, p0.z, 1,
  ];
  return `matrix3d(${m.map(v => v.toFixed(4)).join(',')})`;
}

function flatPointOf(face: UnfoldedFace, vertexIndex: number): Vec3 {
  const localIdx = face.vertexIndices.indexOf(vertexIndex as any);
  const p = face.points2D[localIdx];
  return { x: p.x * SCALE, y: p.y * SCALE, z: 0 };
}

function foldedPointOf(mesh: Mesh, vertexIndex: number): Vec3 {
  const p = mesh.positions[vertexIndex];
  return { x: p.x * SCALE, y: p.y * SCALE, z: p.z * SCALE };
}

const FaceTriangle: React.FC<{ face: UnfoldedFace; mesh: Mesh; progress: number; textureUrl?: string }> = ({ face, mesh, progress, textureUrl }) => {
  const [i0, i1, i2] = face.vertexIndices;
  const flat0 = flatPointOf(face, i0), flat1 = flatPointOf(face, i1), flat2 = flatPointOf(face, i2);
  const folded0 = foldedPointOf(mesh, i0), folded1 = foldedPointOf(mesh, i1), folded2 = foldedPointOf(mesh, i2);

  const p0 = lerpVec3(flat0, folded0, progress);
  const p1 = lerpVec3(flat1, folded1, progress);
  const p2 = lerpVec3(flat2, folded2, progress);

  const matrix = matrix3dForTriangle(p0, p1, p2);
  const color = FACE_COLOR[face.id] ?? '#ccc';
  // 'glue' pieces (ears) are cut apart from the rest of the net, so their
  // border reads differently in the flat/unfolded state -- a plain thin
  // border would look like just another fold line, implying (wrongly) that
  // it's still attached to its neighbor.
  const isGlueFlat = face.attachment === 'glue' && progress < 0.05;
  const borderShadow = isGlueFlat
    ? 'inset 0 0 0 3px rgba(180,80,40,0.9)'
    : 'inset 0 0 0 1px rgba(90,90,64,0.6)';

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: BASE_PX,
        height: BASE_PX,
        transformOrigin: '0 0 0',
        transform: matrix,
        backgroundColor: textureUrl ? undefined : color,
        backgroundImage: textureUrl ? `url(${textureUrl})` : undefined,
        backgroundSize: 'cover',
        clipPath: 'polygon(0 0, 100% 0, 0 100%)',
        boxShadow: borderShadow,
      }}
    />
  );
};

function computeNetBounds(net: UnfoldedFace[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of net) {
    for (const p of f.points2D) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

function easeOutBack(t: number): number {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

const DEFAULT_ROTATE_X = -28;
const DEFAULT_ROTATE_Y = -50;

export const PetPapercraftMaker: React.FC = () => {
  const [earStyle, setEarStyle] = useState<EarStyle>('cat');
  const [progress, setProgress] = useState(0); // 0 = flat net, 1 = fully assembled
  const [dragRotate, setDragRotate] = useState({ x: 0, y: 0 });
  const [photoTransform, setPhotoTransform] = useState<PhotoTransform | null>(null);
  const [textures, setTextures] = useState<Record<string, string>>({});
  const [earBoxes, setEarBoxes] = useState<{ earLeft: EarBox | null; earRight: EarBox | null }>({ earLeft: null, earRight: null });
  const rafRef = useRef<number | null>(null);
  const dragState = useRef<{ startX: number; startY: number; base: { x: number; y: number } } | null>(null);

  // AI ear detection runs once per uploaded photo (not per pan/zoom/guide-scale
  // tweak) -- it's keyed on imageSrc alone so re-aligning the same photo
  // doesn't re-call the API.
  useEffect(() => {
    if (!photoTransform) {
      setEarBoxes({ earLeft: null, earRight: null });
      return;
    }
    let cancelled = false;
    const match = photoTransform.imageSrc.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return;
    const [, mimeType, imageBase64] = match;
    fetch('/api/ai/detect-pet-ears', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, mimeType }),
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        setEarBoxes({ earLeft: data.earLeft ?? null, earRight: data.earRight ?? null });
      })
      .catch(() => { if (!cancelled) setEarBoxes({ earLeft: null, earRight: null }); });
    return () => { cancelled = true; };
  }, [photoTransform?.imageSrc]);

  useEffect(() => {
    if (!photoTransform) {
      setTextures({});
      return;
    }
    let cancelled = false;
    loadImage(photoTransform.imageSrc).then(img => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const [faceId, region] of Object.entries(FACE_GUIDE_REGIONS)) {
        const detectedBox = faceId === 'earLeft' ? earBoxes.earLeft : faceId === 'earRight' ? earBoxes.earRight : null;
        const srcTri = detectedBox
          ? earBoxToTriangle(detectedBox, img.naturalWidth, img.naturalHeight)
          : region.map(pt => guideToImageSpace(pt, photoTransform)) as [
              { x: number; y: number }, { x: number; y: number }, { x: number; y: number }
            ];
        next[faceId] = warpTriangleToDataUrl(img, srcTri, BASE_PX);
      }
      if (!cancelled) setTextures(next);
    });
    return () => { cancelled = true; };
  }, [photoTransform, earBoxes]);

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, base: dragRotate };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setDragRotate({
      x: dragState.current.base.x - dy * 0.4,
      y: dragState.current.base.y + dx * 0.4,
    });
  }
  function onPointerUp() {
    dragState.current = null;
  }

  const mesh = useMemo(() => buildAnimalHeadMesh(earStyle), [earStyle]);
  const net = useMemo(() => unfoldMesh(mesh, 'noseTopLeft'), [mesh]);
  const bounds = useMemo(() => computeNetBounds(net), [net]);

  function animateTo(target: number) {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const start = progress;
    const startTime = performance.now();
    const duration = 1200;
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = easeOutBack(t);
      setProgress(start + (target - start) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }

  // The 3D "folded" model needs breathing room beyond the flat net's own
  // bounds (folding brings faces closer together in x/y but adds z depth),
  // so pad generously and center the whole scene in the viewport.
  const sceneWidth = (bounds.maxX - bounds.minX) * SCALE + 260;
  const sceneHeight = (bounds.maxY - bounds.minY) * SCALE + 260;
  const originX = -bounds.minX * SCALE + 130;
  const originY = -bounds.minY * SCALE + 130;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h2 className="text-xl font-bold text-[#5A5A40] mb-1">🧩 摺紙寵物頭像</h2>
      <p className="text-sm text-slate-500 mb-4">上傳毛孩照片,生成專屬配色的低多邊形摺紙頭像,可列印帶回家組裝。</p>

      <div className="flex gap-3 mb-4">
        <button
          onClick={() => setEarStyle('cat')}
          className={`px-4 py-2 rounded-full text-sm font-bold ${earStyle === 'cat' ? 'bg-[#5A5A40] text-white' : 'bg-gray-100'}`}
        >
          貓耳
        </button>
        <button
          onClick={() => setEarStyle('dog')}
          className={`px-4 py-2 rounded-full text-sm font-bold ${earStyle === 'dog' ? 'bg-[#5A5A40] text-white' : 'bg-gray-100'}`}
        >
          狗耳
        </button>
        <button
          onClick={() => animateTo(progress > 0.5 ? 0 : 1)}
          className="px-4 py-2 rounded-full text-sm font-bold bg-amber-500 text-white ml-auto"
        >
          {progress > 0.5 ? '攤平 ↺' : '組裝動畫 ▶'}
        </button>
      </div>

      <div className="grid md:grid-cols-[320px_1fr] gap-4 mb-4">
        <PetPhotoAligner onChange={setPhotoTransform} />
      </div>

      <div
        className="border rounded-xl bg-slate-50 overflow-hidden flex items-center justify-center touch-none cursor-grab active:cursor-grabbing"
        style={{ height: 460 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div style={{ perspective: 1400, width: sceneWidth, height: sceneHeight, position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              left: originX,
              top: originY,
              transformStyle: 'preserve-3d',
              transform: `rotateX(${DEFAULT_ROTATE_X * progress + dragRotate.x}deg) rotateY(${DEFAULT_ROTATE_Y * progress + dragRotate.y}deg)`,
            }}
          >
            {net.map(face => (
              <FaceTriangle key={face.id} face={face} mesh={mesh} progress={progress} textureUrl={textures[face.id]} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
