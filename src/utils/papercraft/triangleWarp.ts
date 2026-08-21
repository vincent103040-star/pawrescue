export interface Point2 {
  x: number;
  y: number;
}

/**
 * Computes the 6 affine-matrix coefficients (as used by
 * CanvasRenderingContext2D.transform(a,b,c,d,e,f)) that map `src0/1/2` onto
 * `dst0/1/2`. Three point-pairs fully determine an affine transform.
 */
function affineFromTriangles(
  src0: Point2, src1: Point2, src2: Point2,
  dst0: Point2, dst1: Point2, dst2: Point2
): [number, number, number, number, number, number] {
  const ux = src1.x - src0.x, uy = src1.y - src0.y;
  const vx = src2.x - src0.x, vy = src2.y - src0.y;
  const det = ux * vy - uy * vx || 1e-6;

  const dux = dst1.x - dst0.x, duy = dst1.y - dst0.y;
  const dvx = dst2.x - dst0.x, dvy = dst2.y - dst0.y;

  const a = (dux * vy - dvx * uy) / det;
  const c = (ux * dvx - vx * dux) / det;
  const b = (duy * vy - dvy * uy) / det;
  const d = (ux * dvy - vx * duy) / det;
  const e = dst0.x - (a * src0.x + c * src0.y);
  const f = dst0.y - (b * src0.x + d * src0.y);
  return [a, b, c, d, e, f];
}

/**
 * Warps the triangular region `srcTri` of `image` onto a `size x size`
 * canvas so it exactly fills the triangle (0,0)-(size,0)-(0,size) -- the
 * same corner triangle a CSS `clip-path: polygon(0 0, 100% 0, 0 100%)`
 * carves out of a square div. Returns a data URL so the result can be
 * dropped straight into a `background-image`.
 */
export function warpTriangleToDataUrl(
  image: HTMLImageElement,
  srcTri: [Point2, Point2, Point2],
  size: number
): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const dst0: Point2 = { x: 0, y: 0 };
  const dst1: Point2 = { x: size, y: 0 };
  const dst2: Point2 = { x: 0, y: size };

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dst0.x, dst0.y);
  ctx.lineTo(dst1.x, dst1.y);
  ctx.lineTo(dst2.x, dst2.y);
  ctx.closePath();
  ctx.clip();

  const [a, b, c, d, e, f] = affineFromTriangles(srcTri[0], srcTri[1], srcTri[2], dst0, dst1, dst2);
  ctx.transform(a, b, c, d, e, f);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0);
  ctx.restore();

  return canvas.toDataURL('image/png');
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
