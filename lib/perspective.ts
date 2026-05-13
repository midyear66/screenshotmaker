// Pseudo-3D perspective renderer for a rounded rectangular slab (the device).
//
// Instead of treating the device as a box with 4 axis-aligned side rectangles
// (which produced sharp corners that stuck out past the rounded front face),
// we sample the rounded-rect perimeter and extrude each sample backward by
// `depth`. A per-segment visibility test (sign of the rotated outward
// normal's z-component) carves out only the side faces actually facing the
// viewer, and the resulting polygon ribbon wraps cleanly around the corners.
//
// Conventions:
//   +X = right, +Y = down, +Z = away from viewer (into the screen).
//   tiltY > 0 => right side recedes (visible side becomes the LEFT edge).
//   tiltX > 0 => top recedes (visible side becomes the BOTTOM edge).

export type Point = { x: number; y: number };

export type SideQuad = {
  /** 4 projected corners forming a (trapezoidal) ribbon segment. */
  corners: [Point, Point, Point, Point];
  /** Fill color for this segment. */
  fill: string;
};

export type TiltedDevice = {
  /** Bounding-box width of the entire tilted device (front + side ribbon). */
  width: number;
  /** Bounding-box height. */
  height: number;
  /** Where the source rectangle's geometric center maps to in dest coords. */
  pivot: Point;
  /** Front face quad in [TL, TR, BR, BL] order, for warpCanvasToQuad. */
  frontQuad: [Point, Point, Point, Point];
  /** Visible side ribbon segments. */
  sideQuads: SideQuad[];
};

type PerimeterSample = { pos: Point; normal: Point };

/**
 * Sample the rounded-rect perimeter (centred at origin). Straight edges
 * contribute only their endpoints; corner arcs contribute `arcSamples`
 * intermediate points. The result is a cyclic, ordered, clockwise list of
 * sample positions paired with their outward 2D normals.
 */
function roundedRectPerimeter(
  W: number,
  H: number,
  r: number,
  arcSamples: number
): PerimeterSample[] {
  const halfW = W / 2;
  const halfH = H / 2;
  const out: PerimeterSample[] = [];

  // Top straight (left-to-right), normal (0,-1)
  out.push({ pos: { x: -halfW + r, y: -halfH }, normal: { x: 0, y: -1 } });
  out.push({ pos: { x: halfW - r, y: -halfH }, normal: { x: 0, y: -1 } });

  // TR arc
  pushArc(out, halfW - r, -halfH + r, r, -Math.PI / 2, 0, arcSamples);

  // Right straight (top-to-bottom)
  out.push({ pos: { x: halfW, y: halfH - r }, normal: { x: 1, y: 0 } });

  // BR arc
  pushArc(out, halfW - r, halfH - r, r, 0, Math.PI / 2, arcSamples);

  // Bottom straight (right-to-left)
  out.push({ pos: { x: -halfW + r, y: halfH }, normal: { x: 0, y: 1 } });

  // BL arc
  pushArc(out, -halfW + r, halfH - r, r, Math.PI / 2, Math.PI, arcSamples);

  // Left straight (bottom-to-top)
  out.push({ pos: { x: -halfW, y: -halfH + r }, normal: { x: -1, y: 0 } });

  // TL arc
  pushArc(out, -halfW + r, -halfH + r, r, Math.PI, (3 * Math.PI) / 2, arcSamples);

  return out;
}

function pushArc(
  out: PerimeterSample[],
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
  samples: number
) {
  // We include samples 1..samples so we don't duplicate the previous edge's
  // endpoint, but DO include the final point (so the next straight starts
  // exactly where this arc ended).
  for (let i = 1; i <= samples; i++) {
    const a = startAngle + (endAngle - startAngle) * (i / samples);
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    out.push({ pos: { x: cx + r * nx, y: cy + r * ny }, normal: { x: nx, y: ny } });
  }
}

/**
 * Compute the projected device geometry for a rounded rectangle (W × H, corner
 * radius `cornerRadius`) with the given depth, tilted around its X and Y axes.
 */
export function computeTiltedDevice(
  sourceWidth: number,
  sourceHeight: number,
  cornerRadius: number,
  tiltXDegrees: number,
  tiltYDegrees: number,
  options: {
    depth?: number;
    focal?: number;
    sideFill?: string;
    arcSamples?: number;
  } = {}
): TiltedDevice {
  const depth = options.depth ?? 70;
  const focal = options.focal ?? 4000;
  const sideFill = options.sideFill ?? "#141414";
  const arcSamples = options.arcSamples ?? 14;

  const tX = (tiltXDegrees * Math.PI) / 180;
  const tY = (tiltYDegrees * Math.PI) / 180;
  const cX = Math.cos(tX);
  const sX = Math.sin(tX);
  const cY = Math.cos(tY);
  const sY = Math.sin(tY);

  // Apply Ry first (around vertical axis) then Rx (around horizontal).
  // Sign conventions chosen so positive tilt makes the relevant edge recede.
  function rotate(x: number, y: number, z: number) {
    const x1 = x * cY - z * sY;
    const y1 = y;
    const z1 = x * sY + z * cY;
    const x2 = x1;
    const y2 = y1 * cX + z1 * sX;
    const z2 = -y1 * sX + z1 * cX;
    return { x: x2, y: y2, z: z2 };
  }

  function project(x: number, y: number, z: number): Point {
    const r = rotate(x, y, z);
    const scale = focal / (focal + r.z);
    return { x: r.x * scale, y: r.y * scale };
  }

  // ---- Front face quad (for warping the front-face raster) ----
  const halfW = sourceWidth / 2;
  const halfH = sourceHeight / 2;
  const FTL = project(-halfW, -halfH, 0);
  const FTR = project(halfW, -halfH, 0);
  const FBR = project(halfW, halfH, 0);
  const FBL = project(-halfW, halfH, 0);

  // ---- Side ribbon ----
  const samples = roundedRectPerimeter(
    sourceWidth,
    sourceHeight,
    cornerRadius,
    arcSamples
  );
  const projected = samples.map((s) => {
    // Front and back face point at this perimeter location.
    const f = project(s.pos.x, s.pos.y, 0);
    const b = project(s.pos.x, s.pos.y, depth);
    // The side-face normal at this location is the perimeter's outward 2D
    // normal extended into 3D with z=0. Rotate it; visibility = sign of z.
    const n = rotate(s.normal.x, s.normal.y, 0);
    return { f, b, nz: n.z };
  });

  const sideQuads: SideQuad[] = [];
  const N = projected.length;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const midNz = (projected[i].nz + projected[j].nz) / 2;
    // Negative z => facing viewer => visible.
    if (midNz < -1e-3) {
      sideQuads.push({
        corners: [projected[i].f, projected[j].f, projected[j].b, projected[i].b],
        fill: sideFill,
      });
    }
  }

  // ---- Bounding box + centring ----
  const centerProj = project(0, 0, 0);
  const allPts: Point[] = [FTL, FTR, FBR, FBL, centerProj];
  for (const sq of sideQuads) allPts.push(...sq.corners);
  const xs = allPts.map((p) => p.x);
  const ys = allPts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  const offX = -minX;
  const offY = -minY;
  const shift = (p: Point): Point => ({ x: p.x + offX, y: p.y + offY });

  return {
    width: maxX - minX,
    height: maxY - minY,
    pivot: shift(centerProj),
    frontQuad: [shift(FTL), shift(FTR), shift(FBR), shift(FBL)],
    sideQuads: sideQuads.map((sq) => ({
      corners: [shift(sq.corners[0]), shift(sq.corners[1]), shift(sq.corners[2]), shift(sq.corners[3])],
      fill: sq.fill,
    })),
  };
}

/**
 * Warp a rectangular source canvas onto a destination quadrilateral via
 * triangle subdivision.
 */
export function warpCanvasToQuad(
  src: HTMLCanvasElement,
  destQuad: [Point, Point, Point, Point],
  destCanvas: HTMLCanvasElement,
  opts: { subdivisions?: number } = {}
): void {
  const subs = Math.max(2, opts.subdivisions ?? 40);
  const ctx = destCanvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  const [TL, TR, BR, BL] = destQuad;
  const sW = src.width;
  const sH = src.height;

  function dstAt(u: number, v: number): Point {
    const top = lerp(TL, TR, u);
    const bot = lerp(BL, BR, u);
    return lerp(top, bot, v);
  }

  for (let row = 0; row < subs; row++) {
    for (let col = 0; col < subs; col++) {
      const u0 = col / subs;
      const u1 = (col + 1) / subs;
      const v0 = row / subs;
      const v1 = (row + 1) / subs;

      const s00 = { x: u0 * sW, y: v0 * sH };
      const s10 = { x: u1 * sW, y: v0 * sH };
      const s11 = { x: u1 * sW, y: v1 * sH };
      const s01 = { x: u0 * sW, y: v1 * sH };

      const d00 = dstAt(u0, v0);
      const d10 = dstAt(u1, v0);
      const d11 = dstAt(u1, v1);
      const d01 = dstAt(u0, v1);

      drawTriangle(ctx, src, s00, s10, s11, d00, d10, d11);
      drawTriangle(ctx, src, s00, s11, s01, d00, d11, d01);
    }
  }
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  s0: Point,
  s1: Point,
  s2: Point,
  d0: Point,
  d1: Point,
  d2: Point
) {
  const sx0 = s0.x, sy0 = s0.y;
  const sx1 = s1.x, sy1 = s1.y;
  const sx2 = s2.x, sy2 = s2.y;
  const det = sx0 * (sy1 - sy2) - sx1 * (sy0 - sy2) + sx2 * (sy0 - sy1);
  if (Math.abs(det) < 1e-9) return;

  const dx0 = d0.x, dy0 = d0.y;
  const dx1 = d1.x, dy1 = d1.y;
  const dx2 = d2.x, dy2 = d2.y;

  const a = (dx0 * (sy1 - sy2) - dx1 * (sy0 - sy2) + dx2 * (sy0 - sy1)) / det;
  const c = (sx0 * (dx1 - dx2) - sx1 * (dx0 - dx2) + sx2 * (dx0 - dx1)) / det;
  const e =
    (sx0 * (sy1 * dx2 - sy2 * dx1) -
      sx1 * (sy0 * dx2 - sy2 * dx0) +
      sx2 * (sy0 * dx1 - sy1 * dx0)) /
    det;

  const b = (dy0 * (sy1 - sy2) - dy1 * (sy0 - sy2) + dy2 * (sy0 - sy1)) / det;
  const d = (sx0 * (dy1 - dy2) - sx1 * (dy0 - dy2) + sx2 * (dy0 - dy1)) / det;
  const f =
    (sx0 * (sy1 * dy2 - sy2 * dy1) -
      sx1 * (sy0 * dy2 - sy2 * dy0) +
      sx2 * (sy0 * dy1 - sy1 * dy0)) /
    det;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y);
  ctx.lineTo(d1.x, d1.y);
  ctx.lineTo(d2.x, d2.y);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(a, b, c, d, e, f);
  ctx.drawImage(src, 0, 0);
  ctx.restore();
}

/**
 * Render the side ribbon (filled polygons) + the warped front face into a
 * single HTMLCanvasElement sized to the device's bounding box.
 */
export function renderTiltedDevice(
  flatFront: HTMLCanvasElement,
  device: TiltedDevice,
  opts: { subdivisions?: number } = {}
): HTMLCanvasElement {
  const dst = document.createElement("canvas");
  dst.width = Math.max(1, Math.ceil(device.width));
  dst.height = Math.max(1, Math.ceil(device.height));
  const ctx = dst.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  for (const sq of device.sideQuads) {
    ctx.beginPath();
    ctx.moveTo(sq.corners[0].x, sq.corners[0].y);
    ctx.lineTo(sq.corners[1].x, sq.corners[1].y);
    ctx.lineTo(sq.corners[2].x, sq.corners[2].y);
    ctx.lineTo(sq.corners[3].x, sq.corners[3].y);
    ctx.closePath();
    ctx.fillStyle = sq.fill;
    ctx.fill();
  }

  warpCanvasToQuad(flatFront, device.frontQuad, dst, opts);

  return dst;
}
