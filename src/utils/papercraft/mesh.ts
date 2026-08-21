// Low-poly animal head mesh -- an octahedron-shaped core (nose tip + crown
// tip, joined by a 4-point "equator" ring of forehead/cheekL/chin/cheekR)
// plus two triangular ears. 8 core faces instead of a bare minimum 3-4 gives
// the head distinct top/bottom/left/right facets instead of two flat wings,
// so it reads as a head rather than a wedge -- and unlike the earlier
// 3-face "bust" version, this core is fully closed (solid from every
// angle), since the crown tip gives the back its own proper faces instead
// of being left open.
//
// The ears are still "glue" attachments rather than folded flaps: every
// edge around the equator ring is already shared by exactly 2 faces (one
// nose-side, one crown-side) -- the maximum -- so there's no free hinge
// edge left to fold an ear from. Real papercraft solves this the same way:
// the ear is a separate small piece, cut apart in the net and glued on,
// not creased into the main shell.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type FaceAttachment = 'fold' | 'glue';

export interface Face {
  id: string;
  /** Vertex indices, in winding order. */
  vertices: [number, number, number];
  /** 'fold' (default) hinges off its net-neighbor; 'glue' is a separate net piece attached with a glue tab, not a fold line. */
  attachment?: FaceAttachment;
}

export interface Mesh {
  positions: Vec3[];
  faces: Face[];
}

export type EarStyle = 'cat' | 'dog';

/**
 * Builds the head mesh. `earStyle` only changes where the ear tip vertices
 * sit -- 'cat' points them up and out, 'dog' droops them down and out --
 * everything else (topology, core head shape) is identical.
 */
export function buildAnimalHeadMesh(earStyle: EarStyle): Mesh {
  // The nose/crown pair is deliberately asymmetric, not a mirrored gem: a
  // real cat/dog head reads as "muzzle sticking out the front, head rounding
  // off flat-ish at the back" -- so the nose sits much further forward of
  // the equator ring than the crown sits behind it.
  const nose: Vec3 = { x: 0, y: -0.12, z: 1.45 };
  const crown: Vec3 = { x: 0, y: 0.3, z: -0.45 };
  const top: Vec3 = { x: 0, y: 0.58, z: 0.15 };      // forehead ridge, between the eyes
  const bottom: Vec3 = { x: 0, y: -0.5, z: 0.1 };    // chin / underside of jaw
  const cheekL: Vec3 = { x: -0.68, y: 0.05, z: 0.0 };
  const cheekR: Vec3 = { x: 0.68, y: 0.05, z: 0.0 };

  const earTipL: Vec3 = earStyle === 'cat'
    ? { x: -0.85, y: 1.1, z: 0.05 }
    : { x: -0.95, y: 0.15, z: 0.25 };
  const earTipR: Vec3 = earStyle === 'cat'
    ? { x: 0.85, y: 1.1, z: 0.05 }
    : { x: 0.95, y: 0.15, z: 0.25 };

  // Index order: 0 nose, 1 crown, 2 top, 3 bottom, 4 cheekL, 5 cheekR, 6 earTipL, 7 earTipR
  const positions: Vec3[] = [nose, crown, top, bottom, cheekL, cheekR, earTipL, earTipR];

  const faces: Face[] = [
    // Nose-side facets (front half), going around the equator ring top -> left -> bottom -> right -> top
    { id: 'noseTopLeft', vertices: [0, 2, 4] },
    { id: 'noseLeftBottom', vertices: [0, 4, 3] },
    { id: 'noseBottomRight', vertices: [0, 3, 5] },
    { id: 'noseRightTop', vertices: [0, 5, 2] },
    // Crown-side facets (back half), same ring, opposite pole
    { id: 'crownTopLeft', vertices: [1, 4, 2] },
    { id: 'crownLeftBottom', vertices: [1, 3, 4] },
    { id: 'crownBottomRight', vertices: [1, 5, 3] },
    { id: 'crownRightTop', vertices: [1, 2, 5] },
    // Ears, glued on near the forehead/cheek corner rather than folded
    { id: 'earLeft', vertices: [4, 6, 2], attachment: 'glue' },
    { id: 'earRight', vertices: [2, 7, 5], attachment: 'glue' },
  ];

  return { positions, faces };
}

export function vSub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function vAdd(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
export function vScale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
export function vDot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function vCross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
export function vLength(a: Vec3): number {
  return Math.sqrt(vDot(a, a));
}
export function vNormalize(a: Vec3): Vec3 {
  const len = vLength(a) || 1;
  return vScale(a, 1 / len);
}

export function faceNormal(mesh: Mesh, face: Face): Vec3 {
  const [ia, ib, ic] = face.vertices;
  const a = mesh.positions[ia];
  const b = mesh.positions[ib];
  const c = mesh.positions[ic];
  return vNormalize(vCross(vSub(b, a), vSub(c, a)));
}
