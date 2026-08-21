import { Mesh, Vec3, vSub, vDot, vLength, vNormalize } from './mesh';

export interface Point2 {
  x: number;
  y: number;
}

export interface UnfoldedFace {
  id: string;
  /** Vertex indices into the original mesh, in winding order. */
  vertexIndices: [number, number, number];
  /** This face's own 3 vertices laid out flat in the net, same order as vertexIndices. */
  points2D: [Point2, Point2, Point2];
  parentId: string | null;
  /** Radians to rotate from "lying flat in the net" to "the real 3D shape". Unsigned magnitude; sign is chosen per-face at render time. Meaningless (0) for 'glue' faces, which aren't folded from anything. */
  foldAngle: number;
  /** Which two of this face's vertexIndices are the hinge shared with the parent (absent for the root or for a 'glue' face). */
  hinge: [number, number] | null;
  /** 'glue' faces are printed as a separate net piece with a glue tab, not connected by a fold line to the rest of the net. */
  attachment: 'fold' | 'glue';
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function sub2(a: Point2, b: Point2): Point2 {
  return { x: a.x - b.x, y: a.y - b.y };
}
function add2(a: Point2, b: Point2): Point2 {
  return { x: a.x + b.x, y: a.y + b.y };
}
function scale2(a: Point2, s: number): Point2 {
  return { x: a.x * s, y: a.y * s };
}
function len2(a: Point2): number {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}
function cross2(a: Point2, b: Point2): number {
  return a.x * b.y - a.y * b.x;
}

/** Places the third point of a triangle given the 2D positions of the other two and the real (3D) edge lengths, on the side of the p1-p2 line away from `awayFrom`. */
function thirdPoint2D(p1: Point2, p2: Point2, len1: number, len2: number, awayFrom: Point2): Point2 {
  const d = len2Points(p1, p2);
  const a = (len1 * len1 - len2 * len2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, len1 * len1 - a * a));
  const dir = normalize2(sub2(p2, p1));
  const perp = { x: -dir.y, y: dir.x };
  const base = add2(p1, scale2(dir, a));
  const cand1 = add2(base, scale2(perp, h));
  const cand2 = add2(base, scale2(perp, -h));
  const side = (pt: Point2) => cross2(sub2(p2, p1), sub2(pt, p1));
  const awaySide = side(awayFrom);
  return side(cand1) * awaySide < 0 ? cand1 : cand2;
}
function len2Points(a: Point2, b: Point2): number {
  return len2(sub2(a, b));
}
function normalize2(a: Point2): Point2 {
  const l = len2(a) || 1;
  return { x: a.x / l, y: a.y / l };
}

function dist3(mesh: Mesh, i: number, j: number): number {
  return vLength(vSub(mesh.positions[i], mesh.positions[j]));
}

/** True dihedral fold angle (0 = the two faces are coplanar, as in the flat net) between two triangles sharing an edge. */
function dihedralFoldAngle(mesh: Mesh, shared: [number, number], oppA: number, oppB: number): number {
  const p1 = mesh.positions[shared[0]];
  const p2 = mesh.positions[shared[1]];
  const e = vNormalize(vSub(p2, p1));
  const va = vSub(mesh.positions[oppA], p1);
  const vaPerp = vNormalize(vSub(va, scaleVec(e, vDot(va, e))));
  const vb = vSub(mesh.positions[oppB], p1);
  const vbPerp = vNormalize(vSub(vb, scaleVec(e, vDot(vb, e))));
  const angleBetween = Math.acos(clamp(vDot(vaPerp, vbPerp), -1, 1));
  return Math.PI - angleBetween;
}
function scaleVec(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Unfolds a small mesh into a flat 2D net via a BFS spanning tree of the
 * face-adjacency graph. Two faces are "adjacent" if they share exactly two
 * vertex indices (an edge). Any adjacency not used by the spanning tree is a
 * seam that gets cut apart in the net (and needs a glue tab to rejoin during
 * assembly).
 */
export function unfoldMesh(mesh: Mesh, rootFaceId: string): UnfoldedFace[] {
  const foldFaces = mesh.faces.filter(f => (f.attachment ?? 'fold') === 'fold');
  const glueFaces = mesh.faces.filter(f => f.attachment === 'glue');

  const edgeToFaces = new Map<string, string[]>();
  for (const face of foldFaces) {
    const [a, b, c] = face.vertices;
    for (const pair of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const key = edgeKey(pair[0], pair[1]);
      const list = edgeToFaces.get(key) ?? [];
      list.push(face.id);
      edgeToFaces.set(key, list);
    }
  }
  const facesById = new Map(foldFaces.map(f => [f.id, f]));

  function neighborsOf(faceId: string): { neighborId: string; shared: [number, number] }[] {
    const face = facesById.get(faceId)!;
    const [a, b, c] = face.vertices;
    const result: { neighborId: string; shared: [number, number] }[] = [];
    for (const pair of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const key = edgeKey(pair[0], pair[1]);
      const owners = edgeToFaces.get(key) ?? [];
      for (const owner of owners) {
        if (owner !== faceId) result.push({ neighborId: owner, shared: pair });
      }
    }
    return result;
  }

  const visited = new Set<string>([rootFaceId]);
  const result: UnfoldedFace[] = [];
  const placed2D = new Map<number, Point2>(); // vertex index -> 2D position (first placement wins)

  // Place the root flat, arbitrarily, with its first edge along +x.
  const rootFace = facesById.get(rootFaceId)!;
  const [r0, r1, r2] = rootFace.vertices;
  const len01 = dist3(mesh, r0, r1);
  const p0: Point2 = { x: 0, y: 0 };
  const p1: Point2 = { x: len01, y: 0 };
  const p2 = thirdPoint2D(p0, p1, dist3(mesh, r0, r2), dist3(mesh, r1, r2), { x: p0.x, y: p0.y - 1 });
  placed2D.set(r0, p0);
  placed2D.set(r1, p1);
  placed2D.set(r2, p2);
  result.push({
    id: rootFaceId,
    vertexIndices: [r0, r1, r2],
    points2D: [p0, p1, p2],
    parentId: null,
    foldAngle: 0,
    hinge: null,
    attachment: 'fold',
  });

  const queue: string[] = [rootFaceId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const { neighborId, shared } of neighborsOf(currentId)) {
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);
      queue.push(neighborId);

      const neighborFace = facesById.get(neighborId)!;
      const thirdIndex = neighborFace.vertices.find(v => v !== shared[0] && v !== shared[1])!;
      const sp1 = placed2D.get(shared[0])!;
      const sp2 = placed2D.get(shared[1])!;

      // "Away from" reference: the current (parent) face's own third vertex,
      // so the child unfolds outward instead of overlapping its parent.
      const parentUnfolded = result.find(f => f.id === currentId)!;
      const parentThirdIdx = parentUnfolded.vertexIndices.find(v => v !== shared[0] && v !== shared[1])!;
      const awayFrom = placed2D.get(parentThirdIdx)!;

      const newPoint = thirdPoint2D(
        sp1, sp2,
        dist3(mesh, shared[0], thirdIndex),
        dist3(mesh, shared[1], thirdIndex),
        awayFrom
      );
      placed2D.set(thirdIndex, newPoint);

      const orderedVerts = neighborFace.vertices;
      const points2D: [Point2, Point2, Point2] = orderedVerts.map(v => {
        if (v === shared[0]) return sp1;
        if (v === shared[1]) return sp2;
        return newPoint;
      }) as [Point2, Point2, Point2];

      const foldAngle = dihedralFoldAngle(mesh, shared, parentThirdIdx, thirdIndex);

      result.push({
        id: neighborId,
        vertexIndices: orderedVerts as [number, number, number],
        points2D,
        parentId: currentId,
        foldAngle,
        hinge: shared,
        attachment: 'fold',
      });
    }
  }

  // 'glue' faces (e.g. ears) aren't hinged from the shell at all -- lay each
  // one out as its own small independent triangle, offset well clear of the
  // main net (and of each other) so nothing overlaps. Their 3D position for
  // the assembled view comes from the mesh's real vertex coordinates
  // directly (see PetPapercraftMaker), not from anything computed here.
  let glueOffsetX = netMaxX(result) + 0.6;
  for (const face of glueFaces) {
    const [g0, g1, g2] = face.vertices;
    const glen01 = dist3(mesh, g0, g1);
    const gp0: Point2 = { x: glueOffsetX, y: 0 };
    const gp1: Point2 = { x: glueOffsetX + glen01, y: 0 };
    const gp2 = thirdPoint2D(gp0, gp1, dist3(mesh, g0, g2), dist3(mesh, g1, g2), { x: gp0.x, y: gp0.y - 1 });
    result.push({
      id: face.id,
      vertexIndices: [g0, g1, g2],
      points2D: [gp0, gp1, gp2],
      parentId: null,
      foldAngle: 0,
      hinge: null,
      attachment: 'glue',
    });
    glueOffsetX += Math.max(glen01, dist3(mesh, g0, g2), dist3(mesh, g1, g2)) + 0.4;
  }

  return result;
}

function netMaxX(faces: UnfoldedFace[]): number {
  let max = -Infinity;
  for (const f of faces) for (const p of f.points2D) max = Math.max(max, p.x);
  return Number.isFinite(max) ? max : 0;
}
