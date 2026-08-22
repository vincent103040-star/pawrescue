import { Point2 } from './triangleWarp';

/** Center the guide's face oval is drawn/scaled around (see PetPhotoAligner). */
export const GUIDE_CENTER: Point2 = { x: 0.5, y: 0.52 };

/** Scales a guide-space point outward/inward from GUIDE_CENTER by `scale` -- used to let the user resize the face guide to fit different pet face proportions instead of only panning/zooming the photo. */
export function scaleGuidePoint(pt: Point2, scale: number): Point2 {
  const s = Number.isFinite(scale) ? scale : 1;
  return {
    x: GUIDE_CENTER.x + (pt.x - GUIDE_CENTER.x) * s,
    y: GUIDE_CENTER.y + (pt.y - GUIDE_CENTER.y) * s,
  };
}

// The 5 landmarks the alignment guide shows the user (nose + 4 points
// around it), in guide-space (0..1 within the 320x320 alignment square).
// PetPhotoAligner draws these as the draggable-guide dots.
export const GUIDE_LANDMARKS = {
  nose: { x: 0.5, y: 0.62 },
  top: { x: 0.5, y: 0.35 },     // forehead ridge, between the eyes
  bottom: { x: 0.5, y: 0.78 },  // chin, below the mouth
  left: { x: 0.28, y: 0.48 },   // left eye / cheek
  right: { x: 0.72, y: 0.48 },  // right eye / cheek
};

/**
 * Crown faces' stand-in for a "back of head" landmark. A single front photo
 * has no actual back-of-head detail to sample, so this reuses the upper
 * forehead/hairline fur just past the `top` landmark -- close enough in
 * color/texture to read as head fur, but a visually different sample than
 * `nose`, so the back of the model doesn't come out looking like a mirror
 * copy of the front (see faceRegions history for the earlier version that
 * did exactly that).
 */
const crownPole: Point2 = { x: 0.5, y: 0.16 };

/**
 * Which triangular region of an aligned pet photo each mesh face samples.
 * Mirrors the mesh's own octahedron structure: 4 "nose-side" faces each use
 * (nose, landmark, landmark); the 4 "crown-side" faces behind them use
 * (crownPole, landmark, landmark) instead -- same equator landmarks, but a
 * different pole point, so front and back read as related but distinct.
 * Order matters -- it must match each face's own vertex order in mesh.ts
 * for the texture to land the right way up (see earBoxToTriangle's comment
 * in PetPapercraftMaker for why that bit specifically).
 */
export const FACE_GUIDE_REGIONS: Record<string, [Point2, Point2, Point2]> = {
  noseTopLeft: [GUIDE_LANDMARKS.nose, GUIDE_LANDMARKS.top, GUIDE_LANDMARKS.left],
  noseLeftBottom: [GUIDE_LANDMARKS.nose, GUIDE_LANDMARKS.left, GUIDE_LANDMARKS.bottom],
  noseBottomRight: [GUIDE_LANDMARKS.nose, GUIDE_LANDMARKS.bottom, GUIDE_LANDMARKS.right],
  noseRightTop: [GUIDE_LANDMARKS.nose, GUIDE_LANDMARKS.right, GUIDE_LANDMARKS.top],
  crownTopLeft: [crownPole, GUIDE_LANDMARKS.left, GUIDE_LANDMARKS.top],
  crownLeftBottom: [crownPole, GUIDE_LANDMARKS.bottom, GUIDE_LANDMARKS.left],
  crownBottomRight: [crownPole, GUIDE_LANDMARKS.right, GUIDE_LANDMARKS.bottom],
  crownRightTop: [crownPole, GUIDE_LANDMARKS.top, GUIDE_LANDMARKS.right],
  earLeft: [
    { x: 0.2, y: 0.16 },
    { x: 0.03, y: 0.2 },
    { x: 0.13, y: 0.01 },
  ],
  earRight: [
    { x: 0.8, y: 0.16 },
    { x: 0.87, y: 0.01 },
    { x: 0.97, y: 0.2 },
  ],
};
