'use strict';
/* High-resolution procedural creature renderer.
   Each family has a designed body plan (LOOKS). Stages grow the same plan: bigger bodies,
   longer ears that become horns, arms with claws, wings, fiercer eyes. Mega forms add
   armour, glowing markings, a crest gem and a mega-coloured eye glow. Everything is drawn
   as shaded vector shapes (radial-gradient "3D" lighting + outlines + specular highlights)
   at 512px and cached, so it stays crisp at any size. */
const Sprites = (() => {
  const RES = 512, cache = new Map(), urls = new Map();

  /* ---------- colour helpers ---------- */
  function hex2rgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgb2hex(r, g, b) {
    return '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  }
  function mix(a, b, t) {
    const A = hex2rgb(a), B = hex2rgb(b);
    return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }
  function hueShift(hex, deg) {
    let [r, g, b] = hex2rgb(hex).map(v => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    h = (h + deg + 360) % 360;
    const f = n => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return rgb2hex(f(0) * 255, f(8) * 255, f(4) * 255);
  }

  /* ---------- body plans ---------- */
  // body: head (head + body), blob (one round body), tall (slender humanoid)
  const LOOKS = {
    ember:  { body: 'head', ears: 'horn',    tail: 'flame',   arms: true, pattern: 'none', iris: '#ffb703', muzzle: true, extra: 'flame', mane: true },
    aqua:   { body: 'head', ears: 'fin',     tail: 'fin',     arms: true, pattern: 'spots',   iris: '#023e8a', extra: 'shell' },
    sprout: { body: 'head', ears: 'leaf',    tail: 'leaf',    arms: true, pattern: 'spots',   iris: '#2d6a4f', extra: 'sprout' },
    zap:    { body: 'head', ears: 'antenna', tail: 'bolt',    arms: true, pattern: 'stripes', iris: '#1d6fa3' },
    pebble: { body: 'blob', ears: 'none',    tail: 'none',    arms: true, pattern: 'cracks',  iris: '#3e2a1a', extra: 'crystals' },
    gust:   { body: 'head', ears: 'crest',   tail: 'feather', wings: 'feather', wingsAt: 0, arms: false, pattern: 'none', iris: '#3d3f9e', beak: true },
    shade:  { body: 'head', ears: 'pointy',  tail: 'wisp',    wings: 'membrane', wingsAt: 2, arms: true, pattern: 'none', iris: '#ff0a54', glowEyes: true },
    frost:  { body: 'head', ears: 'crystal', tail: 'crystal', arms: true, pattern: 'spots',   iris: '#0077b6' },
    blob:   { body: 'blob', ears: 'round',   tail: 'none',    arms: true, pattern: 'none',    iris: '#5c0a2a', cheeks: '#ff8fab' },
    prism:  { body: 'head', ears: 'crystal', tail: 'orb',     wings: 'feather', wingsAt: 0, arms: true, pattern: 'none', iris: '#00b8a0', halo: true },
    mind:   { body: 'tall', ears: 'horn',    tail: 'orb',     arms: true, pattern: 'none',    iris: '#c2007a', ridge: true },
  };

  function levelOf(spc, mega) { return spc.stage - 1 + (mega ? 1 : 0) + (spc.legendary ? 1 : 0); }
  function scaleFor(spc, mega) { return Math.min(1.1, 0.625 + 0.125 * levelOf(spc, mega)); }

  // Pure geometry (no canvas) so it can be unit-tested.
  function layout(spc, mega) {
    const look = LOOKS[spc.family], L = levelOf(spc, mega), S = RES, gnd = S * 0.95;
    const r = mulberry32(hashStr(spc.family + '#look'));
    const plump = r(), earVar = r(), spotSeed = (r() * 1e9) | 0;
    const g = { S, L, look, gnd, mega: !!mega, plump, earVar, spotSeed, cx: S / 2 };
    if (look.body === 'blob') {
      g.bodyRx = S * (0.2 + 0.026 * L + plump * 0.03); g.bodyRy = S * (0.17 + 0.03 * L);
      g.footRx = g.bodyRx * 0.3; g.footRy = S * 0.045;
      g.bodyCy = gnd - g.footRy * 0.6 - g.bodyRy;
      g.head = null;
      g.face = { x: S / 2, y: g.bodyCy - g.bodyRy * 0.22, r: g.bodyRx * 0.72 };
    } else if (look.body === 'tall') {
      g.bodyRx = S * (0.105 + 0.008 * L); g.bodyRy = S * (0.15 + 0.012 * L);
      g.footRx = S * 0.055; g.footRy = S * 0.04; g.legLen = S * (0.13 + 0.01 * L);
      g.bodyCy = gnd - g.footRy - g.legLen - g.bodyRy * 0.75;
      const hr = S * 0.088;
      g.head = { x: S / 2, y: g.bodyCy - g.bodyRy - hr * 0.55, r: hr };
      g.face = { x: S / 2, y: g.head.y + hr * 0.18, r: hr };
    } else {
      g.bodyRx = S * (0.135 + 0.024 * L + plump * 0.03); g.bodyRy = S * (0.12 + 0.032 * L);
      g.footRx = g.bodyRx * 0.36; g.footRy = S * 0.045;
      g.bodyCy = gnd - g.footRy * 0.7 - g.bodyRy;
      const hr = S * (0.16 - 0.011 * L);
      g.head = { x: S / 2, y: g.bodyCy - g.bodyRy * 0.85 - hr * 0.5, r: hr };
      g.face = { x: S / 2, y: g.head.y + hr * 0.12, r: hr };
    }
    const fr = g.face.r;
    g.eye = { dx: fr * 0.41, rx: fr * (0.2 - 0.02 * Math.min(L, 3)), y: g.face.y - fr * 0.05 };
    g.eye.ry = g.eye.rx * (1.3 - 0.1 * Math.min(L, 3));
    g.fierce = Math.min(1, L / 3 + (mega ? 0.25 : 0));
    g.earLen = (g.head ? g.head.r : g.bodyRx * 0.55) * (0.55 + 0.22 * L + (mega ? 0.2 : 0));
    g.wings = !!look.wings && L >= look.wingsAt;
    g.tailLen = S * (0.11 + 0.035 * L);
    g.top = g.head ? g.head.y - g.head.r : g.bodyCy - g.bodyRy;
    // fit everything inside the canvas (horns/crest on top, wings/tail to the sides)
    const top = g.top - g.earLen * 0.95 - (look.ridge ? S * 0.08 : 0) - (look.halo ? S * 0.05 : 0);
    const halfW = Math.max(g.bodyRx + g.tailLen * 0.95, g.wings ? g.bodyRx + S * (0.16 + 0.05 * L) : 0, (g.head ? g.head.r : 0) + g.earLen);
    g.fit = Math.min(1, (gnd - S * 0.03) / (gnd - top), (S * 0.48) / halfW);
    return g;
  }

  /* ---------- drawing primitives ---------- */
  let c, OL;
  const P = () => new Path2D();
  function ellipse(x, y, rx, ry, rot) { const p = P(); p.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2); return p; }
  function poly(pts) { const p = P(); p.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]); p.closePath(); return p; }
  const outline = base => mix(base, '#140f22', 0.68);
  // "3D" fill: light from the upper left, darker toward the lower right
  function shade(path, base, x, y, r, opts) {
    opts = opts || {};
    const gr = c.createRadialGradient(x - r * 0.38, y - r * 0.45, r * 0.05, x, y, r * 1.25);
    gr.addColorStop(0, mix(base, '#ffffff', opts.hi ?? 0.38));
    gr.addColorStop(0.5, base);
    gr.addColorStop(1, mix(base, '#000000', opts.lo ?? 0.34));
    c.fillStyle = gr; c.fill(path);
    if (opts.noStroke) return;
    c.lineWidth = opts.lw || OL; c.lineJoin = 'round'; c.strokeStyle = opts.stroke || outline(base); c.stroke(path);
  }
  function specular(x, y, rx, ry, a) {
    c.save(); c.globalAlpha = a ?? 0.32; c.fillStyle = '#ffffff';
    c.beginPath(); c.ellipse(x, y, rx, ry, -0.5, 0, Math.PI * 2); c.fill(); c.restore();
  }
  function glowStroke(path, color, w) {
    c.save(); c.shadowColor = color; c.shadowBlur = 24; c.strokeStyle = color; c.lineWidth = w; c.lineCap = 'round'; c.stroke(path);
    c.shadowBlur = 8; c.strokeStyle = '#ffffff'; c.lineWidth = w * 0.35; c.stroke(path); c.restore();
  }
  // a curved, tapered limb/tail between points, as a filled polygon
  function taper(x0, y0, cx, cy, x1, y1, w0, w1) {
    const L = [], R = [], N = 18;
    for (let i = 0; i <= N; i++) {
      const t = i / N, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t;
      const x = a * x0 + b * cx + d * x1, y = a * y0 + b * cy + d * y1;
      const dx = 2 * (1 - t) * (cx - x0) + 2 * t * (x1 - cx), dy = 2 * (1 - t) * (cy - y0) + 2 * t * (y1 - cy);
      const len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, w = (w0 + (w1 - w0) * t) / 2;
      L.push([x + nx * w, y + ny * w]); R.push([x - nx * w, y - ny * w]);
    }
    return poly(L.concat(R.reverse()));
  }
  function teardrop(x, y, w, h) { // flame-like, pointing up, base at (x, y)
    const p = P();
    p.moveTo(x, y - h);
    p.bezierCurveTo(x + w * 0.2, y - h * 0.6, x + w, y - h * 0.35, x + w * 0.55, y - h * 0.05);
    p.quadraticCurveTo(x, y + h * 0.12, x - w * 0.55, y - h * 0.05);
    p.bezierCurveTo(x - w, y - h * 0.35, x - w * 0.2, y - h * 0.6, x, y - h);
    p.closePath(); return p;
  }
  function leafPath(x, y, ang, len, w) {
    const ex = x + Math.sin(ang) * len, ey = y - Math.cos(ang) * len, nx = Math.cos(ang) * w, ny = Math.sin(ang) * w;
    const mx = (x + ex) / 2, my = (y + ey) / 2;
    const p = P(); p.moveTo(x, y); p.quadraticCurveTo(mx + nx, my + ny, ex, ey); p.quadraticCurveTo(mx - nx, my - ny, x, y); p.closePath();
    return { p, ex, ey };
  }
  function crystal(x, y, ang, len, w, col) {
    const dx = Math.sin(ang), dy = -Math.cos(ang), nx = -dy, ny = dx;
    const pts = [[x + nx * w, y + ny * w], [x + dx * len * 0.75 + nx * w, y + dy * len * 0.75 + ny * w], [x + dx * len, y + dy * len],
      [x + dx * len * 0.75 - nx * w, y + dy * len * 0.75 - ny * w], [x - nx * w, y - ny * w]];
    shade(poly(pts), col, x + dx * len * 0.5, y + dy * len * 0.5, len * 0.6, { hi: 0.6 });
    c.save(); c.globalAlpha = 0.55; c.fillStyle = '#ffffff';
    c.fill(poly([[x + nx * w * 0.2, y + ny * w * 0.2], [x + dx * len * 0.72 + nx * w * 0.2, y + dy * len * 0.72 + ny * w * 0.2], [x + dx * len * 0.95, y + dy * len * 0.95], [x + dx * len * 0.7 - nx * w * 0.25, y + dy * len * 0.7 - ny * w * 0.25]]));
    c.restore();
  }

  /* ---------- parts ---------- */
  function earAnchor(g, side) {
    const hx = g.head ? g.head.x : g.cx, hy = g.head ? g.head.y : g.bodyCy, hr = g.head ? g.head.r : g.bodyRx * 0.85;
    const a0 = side * (0.6 - 0.12 * g.earVar), k = g.head ? 0.86 : 0.8;
    return { x: hx + Math.sin(a0) * hr * k, y: hy - Math.cos(a0) * hr * (g.head ? k : 0.95 * g.bodyRy / g.bodyRx), a: a0 * 1.3, hr };
  }
  function drawEars(g, pal) {
    const kind = g.look.ears;
    if (kind === 'none') return;
    if (kind === 'crest') { // bird crest: fanned feathers on top of the head
      const hx = g.head.x, ty = g.head.y - g.head.r * 0.85;
      for (let i = -1; i <= 1; i++) {
        const lf = leafPath(hx + i * g.head.r * 0.12, ty, i * 0.35, g.earLen * (i === 0 ? 1.1 : 0.85), g.head.r * 0.16);
        shade(lf.p, i === 0 ? pal.accent : pal.prim, hx, ty - g.earLen * 0.5, g.earLen * 0.6);
      }
      return;
    }
    for (const side of [-1, 1]) {
      const A = earAnchor(g, side), len = g.earLen, w = A.hr * 0.42;
      const dx = Math.sin(A.a), dy = -Math.cos(A.a), nx = -dy, ny = dx;
      const tx = A.x + dx * len, ty = A.y + dy * len;
      if (kind === 'pointy' || kind === 'horn') {
        const ww = kind === 'horn' ? w * 0.45 : w, bow = kind === 'horn' ? len * 0.25 * side : 0;
        const p = P();
        p.moveTo(A.x - nx * ww, A.y - ny * ww);
        p.quadraticCurveTo(A.x + dx * len * 0.55 - nx * ww * 0.9 + bow, A.y + dy * len * 0.55 - ny * ww * 0.9, tx + bow * 0.6, ty);
        p.quadraticCurveTo(A.x + dx * len * 0.5 + nx * ww * 1.1 + bow, A.y + dy * len * 0.5 + ny * ww * 1.1, A.x + nx * ww, A.y + ny * ww);
        p.closePath();
        const col = kind === 'horn' ? pal.horn : pal.prim;
        shade(p, col, A.x + dx * len * 0.4, A.y + dy * len * 0.4, len * 0.6);
        if (kind === 'pointy') {
          const q = P();
          q.moveTo(A.x - nx * w * 0.45 + dx * len * 0.1, A.y - ny * w * 0.45 + dy * len * 0.1);
          q.lineTo(A.x + dx * len * 0.7, A.y + dy * len * 0.7);
          q.lineTo(A.x + nx * w * 0.45 + dx * len * 0.1, A.y + ny * w * 0.45 + dy * len * 0.1); q.closePath();
          c.fillStyle = mix(pal.sec, pal.prim, 0.25); c.fill(q);
        }
        if (g.look.earTip || (g.mega && pal.mega)) { c.save(); c.clip(p); c.fillStyle = g.mega && pal.mega ? pal.mega : pal.dark; c.globalAlpha = 0.9; c.beginPath(); c.arc(tx, ty, len * 0.42, 0, 7); c.fill(); c.restore(); c.lineWidth = OL; c.strokeStyle = outline(pal.prim); c.stroke(p); }
      } else if (kind === 'antenna') { // springy stalks with glowing bulbs
        const bx2 = A.x + dx * len * 0.9 + side * len * 0.25, by2 = A.y + dy * len * 0.9;
        c.strokeStyle = outline(pal.prim); c.lineWidth = OL * 2.6; c.lineCap = 'round';
        c.beginPath(); c.moveTo(A.x, A.y); c.quadraticCurveTo(A.x + dx * len * 0.5 - side * len * 0.2, A.y + dy * len * 0.6, bx2, by2); c.stroke();
        c.strokeStyle = pal.prim; c.lineWidth = OL * 1.4; c.stroke();
        const r = A.hr * 0.2 * (1 + g.L * 0.15), col = g.mega && pal.mega ? pal.mega : '#7ee0ff';
        c.save(); c.shadowColor = col; c.shadowBlur = 20; shade(ellipse(bx2, by2, r, r), col, bx2, by2, r, { hi: 0.6 }); c.restore();
        specular(bx2 - r * 0.3, by2 - r * 0.35, r * 0.3, r * 0.18, 0.8);
      } else if (kind === 'round') {
        const p = ellipse(A.x + dx * w * 0.6, A.y + dy * w * 0.6, w * 0.75, w * 0.75);
        shade(p, pal.prim, A.x, A.y, w);
        c.fillStyle = mix(pal.sec, pal.prim, 0.3); c.fill(ellipse(A.x + dx * w * 0.6, A.y + dy * w * 0.6, w * 0.4, w * 0.4));
      } else if (kind === 'fin') {
        const p = P();
        p.moveTo(A.x - nx * w * 0.6, A.y - ny * w * 0.6);
        p.quadraticCurveTo(A.x + dx * len * 0.3 + side * len * 0.5, A.y + dy * len * 0.3, tx + side * len * 0.45, ty + len * 0.15);
        p.quadraticCurveTo(A.x + dx * len * 0.2, A.y + dy * len * 0.2, A.x + nx * w * 0.6, A.y + ny * w * 0.6);
        p.closePath();
        shade(p, pal.sec, A.x + side * len * 0.3, A.y - len * 0.4, len * 0.7);
        c.save(); c.clip(p); c.strokeStyle = mix(pal.sec, pal.dark, 0.35); c.lineWidth = OL * 0.6;
        for (let i = 1; i <= 3; i++) { c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(A.x + dx * len * i * 0.4 + side * len * 0.35 * i * 0.35, A.y + dy * len * i * 0.35); c.stroke(); }
        c.restore();
      } else if (kind === 'leaf') {
        const lf = leafPath(A.x, A.y, A.a, len * 1.1, w * 0.9);
        shade(lf.p, pal.leaf, (A.x + lf.ex) / 2, (A.y + lf.ey) / 2, len * 0.6);
        c.strokeStyle = mix(pal.leaf, '#000000', 0.35); c.lineWidth = OL * 0.6;
        c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(lf.ex, lf.ey); c.stroke();
      } else if (kind === 'bolt') {
        const pts = [], seg = 4;
        for (let i = 0; i <= seg; i++) { const t = i / seg, o = (i % 2 ? 1 : -1) * w * 0.5 * (1 - t); pts.push([A.x + dx * len * t + nx * o + nx * w * 0.35 * (1 - t), A.y + dy * len * t + ny * o + ny * w * 0.35 * (1 - t)]); }
        for (let i = seg; i >= 0; i--) { const t = i / seg, o = (i % 2 ? 1 : -1) * w * 0.5 * (1 - t); pts.push([A.x + dx * len * t + nx * o - nx * w * 0.35 * (1 - t), A.y + dy * len * t + ny * o - ny * w * 0.35 * (1 - t)]); }
        shade(poly(pts), pal.prim, A.x + dx * len * 0.4, A.y + dy * len * 0.4, len * 0.6);
        c.save(); c.clip(poly(pts)); c.fillStyle = pal.dark; c.beginPath(); c.arc(tx, ty, len * 0.3, 0, 7); c.fill(); c.restore();
      } else if (kind === 'crystal') {
        crystal(A.x, A.y, A.a, len * 1.05, w * 0.4, pal.crystal);
        crystal(A.x - side * w * 0.3, A.y + w * 0.2, A.a - side * 0.45, len * 0.6, w * 0.28, pal.crystal);
      }
    }
  }
  function drawTail(g, pal) {
    const kind = g.look.tail;
    if (kind === 'none') return;
    const bx = g.cx + g.bodyRx * 0.55, by = g.bodyCy + g.bodyRy * 0.35, len = g.tailLen;
    const tx = g.cx + g.bodyRx + len * 0.75, ty = g.bodyCy - g.bodyRy * 0.15 - len * 0.55;
    const cx = g.cx + g.bodyRx + len * 0.7, cy = g.bodyCy + g.bodyRy * 0.55;
    const w0 = g.bodyRx * (g.look.body === 'tall' ? 0.45 : 0.32);
    if (kind === 'bolt') { // a chunky lightning-bolt tail
      const k = len * 1.7, ox = bx, oy = by;
      const shape = [[0, -0.12], [0.45, -0.36], [0.36, -0.52], [1.0, -0.98], [0.6, -0.44], [0.7, -0.3], [0.08, 0.1]];
      const pts = shape.map(([x, y]) => [ox + x * k, oy + y * k]);
      shade(poly(pts), g.mega && pal.mega ? mix(pal.prim, pal.mega, 0.3) : pal.prim, ox + k * 0.5, oy - k * 0.5, k * 0.7);
      c.save(); c.clip(poly(pts)); c.fillStyle = pal.dark; c.fillRect(ox - k, oy - k * 0.16, k * 0.5 + k, k * 0.5); c.restore();
      c.lineWidth = OL; c.strokeStyle = outline(pal.prim); c.stroke(poly(pts));
      return;
    }
    if (kind === 'wisp') {
      for (let i = 0; i < 6; i++) {
        const t = i / 5, x = bx + (tx - bx) * t + Math.sin(t * 5) * len * 0.12, y = by + (ty - by) * t;
        c.save(); c.globalAlpha = 1 - t * 0.65;
        shade(ellipse(x, y, w0 * (0.75 - t * 0.45), w0 * (0.75 - t * 0.45)), mix(pal.prim, pal.dark, t * 0.5), x, y, w0, { noStroke: t > 0.5 });
        c.restore();
      }
      return;
    }
    shade(taper(bx, by, cx, cy, tx, ty, w0, kind === 'flame' ? w0 * 0.55 : w0 * 0.3), pal.prim, (bx + tx) / 2, (by + ty) / 2, len * 0.7);
    if (kind === 'flame') {
      const s = g.L >= 1 ? 1.2 + g.L * 0.15 : 1, w = w0 * 1.1 * s, h = w0 * 2.4 * s;
      shade(teardrop(tx, ty + h * 0.15, w, h), g.mega && pal.mega ? pal.mega : '#ff4d1a', tx, ty - h * 0.5, h * 0.7, { hi: 0.3 });
      c.fillStyle = '#ff9f1c'; c.fill(teardrop(tx, ty + h * 0.12, w * 0.68, h * 0.75));
      c.fillStyle = '#ffe66d'; c.fill(teardrop(tx, ty + h * 0.1, w * 0.36, h * 0.45));
    } else if (kind === 'fin') {
      shade(poly([[tx, ty], [tx + len * 0.55, ty - len * 0.45], [tx + len * 0.25, ty + len * 0.05], [tx + len * 0.6, ty + len * 0.35]]), pal.sec, tx + len * 0.3, ty, len * 0.5);
    } else if (kind === 'leaf') {
      const lf = leafPath(tx, ty, 0.5, len * 0.95, len * 0.32);
      shade(lf.p, pal.leaf, (tx + lf.ex) / 2, (ty + lf.ey) / 2, len * 0.6);
      c.strokeStyle = mix(pal.leaf, '#000000', 0.35); c.lineWidth = OL * 0.6; c.beginPath(); c.moveTo(tx, ty); c.lineTo(lf.ex, lf.ey); c.stroke();
    } else if (kind === 'feather') {
      for (let i = -1; i <= 1; i++) {
        const lf = leafPath(tx, ty, 0.9 + i * 0.35, len * (i === 0 ? 0.9 : 0.75), len * 0.18);
        shade(lf.p, i === 0 ? pal.accent : pal.prim, tx + len * 0.3, ty - len * 0.2, len * 0.5);
      }
    } else if (kind === 'crystal') {
      crystal(tx, ty, 0.6, len * 0.6, w0 * 0.35, pal.crystal);
      crystal(tx, ty, 1.3, len * 0.42, w0 * 0.25, pal.crystal);
    } else if (kind === 'orb') {
      const r = w0 * (g.mega ? 1.0 : 0.8), col = g.mega && pal.mega ? pal.mega : pal.sec;
      c.save(); c.shadowColor = col; c.shadowBlur = 30; shade(ellipse(tx, ty, r, r), col, tx, ty, r, { hi: 0.6 }); c.restore();
      specular(tx - r * 0.3, ty - r * 0.35, r * 0.3, r * 0.18, 0.7);
    }
  }
  function drawWings(g, pal) {
    if (!g.wings) return;
    const span = g.S * (0.15 + 0.05 * g.L) * (g.mega ? 1.15 : 1);
    for (const side of [-1, 1]) {
      const sx = g.cx + side * g.bodyRx * 0.5, sy = g.bodyCy - g.bodyRy * 0.55;
      if (g.look.wings === 'membrane') {
        const tipX = sx + side * span, tipY = sy - span * 0.75;
        const p = P();
        p.moveTo(sx, sy);
        p.quadraticCurveTo(sx + side * span * 0.4, tipY - span * 0.1, tipX, tipY);
        for (let i = 1; i <= 3; i++) {
          const t = i / 3, px = tipX - side * span * 0.85 * t, py = tipY + span * (0.55 + 0.25 * t);
          p.quadraticCurveTo(px + side * span * 0.15, py - span * 0.32, px, py);
        }
        p.closePath();
        const col = g.mega && pal.mega ? mix(pal.wing, pal.mega, 0.35) : pal.wing;
        shade(p, col, sx + side * span * 0.5, sy - span * 0.3, span * 0.8);
        c.strokeStyle = outline(col); c.lineWidth = OL * 0.7;
        for (let i = 1; i <= 2; i++) { const t = i / 3; c.beginPath(); c.moveTo(tipX, tipY); c.lineTo(tipX - side * span * 0.85 * t, tipY + span * (0.55 + 0.25 * t)); c.stroke(); }
      } else {
        for (let i = 3; i >= 0; i--) {
          const lf = leafPath(sx, sy, side * (0.75 + i * 0.32), span * (1.05 - i * 0.12), span * 0.2);
          shade(lf.p, i % 2 ? pal.wing : mix(pal.wing, '#ffffff', 0.25), sx + side * span * 0.5, sy - span * 0.3, span * 0.7);
        }
      }
    }
  }
  function drawBackExtras(g, pal, rnd) {
    const ex = g.look.extra;
    if (ex === 'shell' && g.L >= 2) {
      const p = ellipse(g.cx, g.bodyCy - g.bodyRy * 0.15, g.bodyRx * 1.2, g.bodyRy * 1.05);
      shade(p, pal.shell, g.cx, g.bodyCy - g.bodyRy * 0.4, g.bodyRx * 1.2);
      c.save(); c.clip(p); c.strokeStyle = mix(pal.shell, '#000000', 0.35); c.lineWidth = OL * 0.7;
      for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(g.cx + i * g.bodyRx * 0.45, g.bodyCy - g.bodyRy * 1.3); c.lineTo(g.cx + i * g.bodyRx * 0.55, g.bodyCy + g.bodyRy); c.stroke(); }
      c.restore();
      for (const side of [-1, 1]) crystal(g.cx + side * g.bodyRx * 0.9, g.bodyCy - g.bodyRy * 0.7, side * 0.7, g.bodyRx * 0.55, g.bodyRx * 0.12, pal.shell);
    }
    if (ex === 'crystals') {
      const n = 2 + g.L;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1) - 0.5, a = t * 1.6;
        const x = g.cx + Math.sin(a) * g.bodyRx * 0.8, y = g.bodyCy - Math.cos(a) * g.bodyRy * 0.75;
        crystal(x, y, a * 1.1, g.bodyRx * (0.45 + 0.15 * rnd()), g.bodyRx * 0.12, g.mega && pal.mega ? pal.mega : pal.crystal);
      }
    }
    if (ex === 'sprout' && g.L >= 2) { // a big flower blooming behind the head
      const fx = g.head.x, fy = g.head.y - g.head.r * 0.2, pr = g.head.r * 0.75;
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2 + 0.3, x = fx + Math.cos(a) * g.head.r * 1.15, y = fy + Math.sin(a) * g.head.r * 0.95;
        shade(ellipse(x, y, pr * 0.6, pr * 0.45, a), g.mega && pal.mega ? pal.mega : '#ff8fc8', x, y, pr * 0.6);
      }
    }
    if (g.look.mane && g.head && g.L >= 1) { // ring of flames framing the head
      const h = g.head, n = 7 + g.L * 2;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI * 0.85 + (i / (n - 1)) * Math.PI * 1.7, r = h.r * 1.02;
        const x = h.x + Math.sin(a) * r, y = h.y - Math.cos(a) * r * 0.95, fh = h.r * (0.45 + 0.12 * g.L) * (1 - Math.abs(a) * 0.18);
        c.save(); c.translate(x, y); c.rotate(a * 0.8);
        shade(teardrop(0, fh * 0.3, fh * 0.42, fh), g.mega && pal.mega ? pal.mega : '#ff4d1a', 0, -fh * 0.4, fh * 0.6, { hi: 0.3 });
        c.fillStyle = '#ffb703'; c.fill(teardrop(0, fh * 0.25, fh * 0.22, fh * 0.6));
        c.restore();
      }
    }
    if (g.look.ridge && g.head) { // psychic cranial ridge sweeping up and back
      const h = g.head, len = g.S * (0.1 + (g.mega ? 0.06 : 0));
      shade(taper(h.x + h.r * 0.1, h.y - h.r * 0.2, h.x + h.r * 0.4, h.y - h.r - len * 0.5, h.x + h.r * 0.9 + (g.mega ? len * 0.4 : 0), h.y - h.r - len * (g.mega ? 0.6 : 0.35), h.r * 0.9, h.r * 0.2), pal.prim, h.x + h.r * 0.4, h.y - h.r, len);
      if (g.mega && pal.mega) glowStroke(taper(h.x + h.r * 0.2, h.y - h.r * 0.5, h.x + h.r * 0.45, h.y - h.r - len * 0.4, h.x + h.r * 1.1, h.y - h.r - len * 0.55, 2, 1), pal.mega, OL * 0.8);
    }
    if (g.look.halo) {
      const hy = (g.head ? g.head.y - g.head.r * 1.15 : g.top) - g.S * 0.02;
      c.save(); c.shadowColor = pal.mega || '#ffffff'; c.shadowBlur = 20; c.strokeStyle = '#ffe66d'; c.lineWidth = OL * 1.4;
      c.beginPath(); c.ellipse(g.cx, hy, g.S * 0.11, g.S * 0.03, 0, 0, Math.PI * 2); c.stroke(); c.restore();
    }
  }
  function drawLegs(g, pal) {
    for (const side of [-1, 1]) {
      if (g.look.body === 'tall') {
        const hipX = g.cx + side * g.bodyRx * 0.45, hipY = g.bodyCy + g.bodyRy * 0.5;
        shade(taper(hipX, hipY, hipX + side * g.S * 0.05, hipY + g.legLen * 0.5, g.cx + side * g.bodyRx * 0.55, g.gnd - g.footRy, g.bodyRx * 0.75, g.bodyRx * 0.35), pal.prim, hipX, hipY + g.legLen * 0.4, g.legLen);
      }
      const fx = g.cx + side * (g.look.body === 'tall' ? g.bodyRx * 0.6 : g.bodyRx * 0.5), fy = g.gnd - g.footRy;
      shade(ellipse(fx, fy, g.footRx, g.footRy), mix(pal.prim, pal.dark, 0.15), fx, fy, g.footRx);
      if (g.L >= 1) {
        c.fillStyle = '#fbf6ee';
        for (let i = -1; i <= 1; i++) c.fill(poly([[fx + i * g.footRx * 0.45 - g.footRx * 0.12, fy + g.footRy * 0.4], [fx + i * g.footRx * 0.45, fy + g.footRy * 1.05], [fx + i * g.footRx * 0.45 + g.footRx * 0.12, fy + g.footRy * 0.4]]));
      }
    }
  }
  function bodyPath(g) {
    if (g.look.body === 'tall') { // V-shaped torso: broad chest, narrow waist
      const p = P(), x = g.cx, y = g.bodyCy, rx = g.bodyRx, ry = g.bodyRy;
      p.moveTo(x - rx * 1.25, y - ry * 0.75);
      p.quadraticCurveTo(x, y - ry * 1.15, x + rx * 1.25, y - ry * 0.75);
      p.quadraticCurveTo(x + rx * 0.9, y + ry * 0.2, x + rx * 0.8, y + ry * 0.75);
      p.quadraticCurveTo(x, y + ry * 1.05, x - rx * 0.8, y + ry * 0.75);
      p.quadraticCurveTo(x - rx * 0.9, y + ry * 0.2, x - rx * 1.25, y - ry * 0.75);
      p.closePath(); return p;
    }
    return ellipse(g.cx, g.bodyCy, g.bodyRx, g.bodyRy);
  }
  function patternOn(g, pal, rnd, x, y, rx, ry) {
    const pat = g.look.pattern;
    if (pat === 'spots') {
      c.fillStyle = pal.spot;
      for (let i = 0; i < 6; i++) { const a = rnd() * Math.PI * 2, d = 0.45 + rnd() * 0.45; c.fill(ellipse(x + Math.cos(a) * rx * d, y + Math.sin(a) * ry * d * 0.9 - ry * 0.2, rx * 0.12, rx * 0.09, a)); }
    } else if (pat === 'stripes') {
      c.strokeStyle = pal.dark; c.lineWidth = rx * 0.12; c.lineCap = 'round';
      for (const side of [-1, 1]) for (let i = 0; i < 2; i++) { c.beginPath(); c.moveTo(x + side * rx, y - ry * (0.5 - i * 0.35)); c.lineTo(x + side * rx * 0.55, y - ry * (0.35 - i * 0.35)); c.stroke(); }
    } else if (pat === 'cracks') {
      c.strokeStyle = pal.dark; c.lineWidth = OL * 0.6;
      for (let i = 0; i < 4; i++) { let px = x + (rnd() - 0.5) * rx * 1.4, py = y + rnd() * ry * 0.5; c.beginPath(); c.moveTo(px, py); for (let k = 0; k < 3; k++) { px += (rnd() - 0.5) * rx * 0.4; py += rnd() * ry * 0.25; c.lineTo(px, py); } c.stroke(); }
    }
  }
  function drawBody(g, pal, rnd) {
    const bp = bodyPath(g);
    shade(bp, pal.prim, g.cx, g.bodyCy, Math.max(g.bodyRx, g.bodyRy));
    c.save(); c.clip(bp);
    shade(ellipse(g.cx, g.bodyCy + g.bodyRy * 0.25, g.bodyRx * 0.62, g.bodyRy * 0.72), pal.sec, g.cx, g.bodyCy + g.bodyRy * 0.2, g.bodyRx * 0.7, { noStroke: true, hi: 0.3, lo: 0.15 });
    patternOn(g, pal, rnd, g.cx, g.bodyCy, g.bodyRx, g.bodyRy);
    if (g.mega && pal.mega) { // glowing mega markings
      for (const side of [-1, 1]) {
        const p = P(); p.moveTo(g.cx + side * g.bodyRx * 0.95, g.bodyCy - g.bodyRy * 0.5); p.lineTo(g.cx + side * g.bodyRx * 0.45, g.bodyCy - g.bodyRy * 0.1); p.lineTo(g.cx + side * g.bodyRx * 0.9, g.bodyCy + g.bodyRy * 0.3);
        glowStroke(p, pal.mega, OL * 1.1);
      }
    }
    c.restore();
    c.lineWidth = OL; c.strokeStyle = outline(pal.prim); c.stroke(bp);
    specular(g.cx - g.bodyRx * 0.45, g.bodyCy - g.bodyRy * 0.5, g.bodyRx * 0.25, g.bodyRy * 0.14);
  }
  function drawArms(g, pal) {
    if (!g.look.arms || (g.look.body === 'blob' && g.L === 0)) return;
    for (const side of [-1, 1]) {
      if (g.look.body === 'tall') {
        const shX = g.cx + side * g.bodyRx * 1.1, shY = g.bodyCy - g.bodyRy * 0.6;
        const hx = g.cx + side * g.bodyRx * 1.55, hy = g.bodyCy + g.bodyRy * 0.55;
        shade(taper(shX, shY, shX + side * g.bodyRx * 0.8, shY + g.bodyRy * 0.6, hx, hy, g.bodyRx * 0.42, g.bodyRx * 0.26), pal.prim, shX, shY + g.bodyRy * 0.6, g.bodyRy);
        for (let i = -1; i <= 1; i++) shade(ellipse(hx + i * g.bodyRx * 0.16, hy + g.bodyRx * 0.18, g.bodyRx * 0.12, g.bodyRx * 0.12), pal.prim, hx, hy, g.bodyRx * 0.2);
        continue;
      }
      const ax = g.cx + side * g.bodyRx * 0.88, ay = g.bodyCy - g.bodyRy * 0.05;
      const rx = g.bodyRx * (0.2 + 0.03 * g.L), ry = rx * 1.55;
      shade(ellipse(ax, ay, rx, ry, -side * 0.55), pal.prim, ax, ay, ry);
      if (g.L >= 2) {
        c.fillStyle = '#fbf6ee';
        const hx = ax + side * rx * 0.55, hy = ay + ry * 0.75;
        for (let i = -1; i <= 1; i++) c.fill(poly([[hx + i * rx * 0.35 - rx * 0.1, hy], [hx + i * rx * 0.4 + side * rx * 0.1, hy + rx * 0.45], [hx + i * rx * 0.35 + rx * 0.1, hy]]));
      }
      if (g.mega && pal.mega) { // shoulder armour
        shade(poly([[ax - rx * 1.1, ay - ry * 0.55], [ax + side * rx * 0.2, ay - ry * 1.25], [ax + rx * 1.1, ay - ry * 0.55], [ax + side * rx * 0.3, ay - ry * 0.2]]), pal.dark, ax, ay - ry * 0.7, rx * 1.2);
        glowStroke(poly([[ax - rx * 0.6, ay - ry * 0.6], [ax + side * rx * 0.2, ay - ry * 1.05], [ax + rx * 0.6, ay - ry * 0.6]]), pal.mega, OL * 0.5);
      }
    }
  }
  function drawHead(g, pal) {
    if (!g.head) return;
    const h = g.head, hp = ellipse(h.x, h.y, h.r * (g.look.body === 'tall' ? 0.95 : 1.05), h.r);
    shade(hp, pal.prim, h.x, h.y, h.r);
    c.save(); c.clip(hp);
    if (g.look.muzzle) shade(ellipse(h.x, h.y + h.r * 0.5, h.r * 0.62, h.r * 0.42), pal.sec, h.x, h.y + h.r * 0.45, h.r * 0.6, { noStroke: true, hi: 0.25, lo: 0.12 });
    if (g.look.pattern === 'spots') { c.fillStyle = pal.spot; c.fill(ellipse(h.x - h.r * 0.55, h.y - h.r * 0.45, h.r * 0.12, h.r * 0.09)); c.fill(ellipse(h.x + h.r * 0.6, h.y - h.r * 0.35, h.r * 0.1, h.r * 0.08)); }
    if (g.look.pattern === 'stripes') { c.fillStyle = pal.dark; c.fill(poly([[h.x - h.r * 0.15, h.y - h.r], [h.x, h.y - h.r * 0.55], [h.x + h.r * 0.15, h.y - h.r]])); }
    c.restore();
    c.lineWidth = OL; c.strokeStyle = outline(pal.prim); c.stroke(hp);
    specular(h.x - h.r * 0.45, h.y - h.r * 0.5, h.r * 0.28, h.r * 0.15);
    if (g.look.extra === 'flame' && g.L >= 1) {
      const s = h.r * (0.35 + 0.1 * g.L);
      shade(teardrop(h.x, h.y - h.r * 0.82, s * 0.6, s * 1.4), g.mega && pal.mega ? pal.mega : '#ff4d1a', h.x, h.y - h.r - s * 0.6, s);
      c.fillStyle = '#ffe66d'; c.fill(teardrop(h.x, h.y - h.r * 0.85, s * 0.28, s * 0.8));
    }
    if (g.look.extra === 'sprout' && g.L < 2) {
      c.strokeStyle = mix(pal.leaf, '#000000', 0.3); c.lineWidth = OL;
      const top = h.y - h.r - h.r * 0.35;
      c.beginPath(); c.moveTo(h.x, h.y - h.r * 0.95); c.lineTo(h.x, top); c.stroke();
      for (const side of [-1, 1]) { const lf = leafPath(h.x, top, side * 1.0, h.r * (0.5 + g.L * 0.2), h.r * 0.18); shade(lf.p, pal.leaf, h.x + side * h.r * 0.2, top, h.r * 0.4); }
    }
    if (g.mega && pal.mega) { // crest gem
      const gx = h.x, gy = h.y - h.r * 0.62, s = h.r * 0.17;
      c.save(); c.shadowColor = pal.mega; c.shadowBlur = 22;
      shade(poly([[gx, gy - s * 1.4], [gx + s, gy], [gx, gy + s * 1.1], [gx - s, gy]]), pal.mega, gx, gy, s * 1.3, { hi: 0.65 });
      c.restore();
    }
  }
  function drawFace(g, pal, blink) {
    const f = g.face, e = g.eye, look = g.look;
    const irisCol = g.mega && pal.mega ? pal.mega : pal.iris;
    for (const side of [-1, 1]) {
      const ex = f.x + side * e.dx, ey = e.y;
      if (blink) {
        c.strokeStyle = '#1a1226'; c.lineWidth = OL * 1.1; c.lineCap = 'round';
        c.beginPath(); c.moveTo(ex - e.rx, ey); c.quadraticCurveTo(ex, ey + e.ry * 0.5, ex + e.rx, ey); c.stroke();
        continue;
      }
      const sclera = ellipse(ex, ey, e.rx, e.ry);
      c.fillStyle = look.glowEyes ? '#2a0a1a' : '#ffffff'; c.fill(sclera);
      c.save(); c.clip(sclera);
      const ir = e.rx * 0.78, ix = ex + side * e.rx * 0.08, iy = ey + e.ry * 0.12;
      const ig = c.createRadialGradient(ix, iy - ir * 0.3, ir * 0.1, ix, iy, ir);
      ig.addColorStop(0, mix(irisCol, '#ffffff', 0.45)); ig.addColorStop(1, mix(irisCol, '#000000', 0.25));
      if (look.glowEyes || g.mega) { c.shadowColor = irisCol; c.shadowBlur = 18; }
      c.fillStyle = ig; c.beginPath(); c.ellipse(ix, iy, ir, ir * 1.15, 0, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0;
      c.fillStyle = '#0b0712'; c.beginPath(); c.ellipse(ix, iy + ir * 0.1, ir * (0.48 - g.fierce * 0.18), ir * 0.6, 0, 0, Math.PI * 2); c.fill();
      // fierce upper lid: a skin-coloured wedge slanting toward the nose
      if (g.fierce > 0.1) {
        c.fillStyle = pal.prim;
        c.beginPath(); c.moveTo(ex - e.rx * 1.2, ey - e.ry * 1.2); c.lineTo(ex + e.rx * 1.2, ey - e.ry * 1.2);
        c.lineTo(ex + e.rx * 1.2, ey - e.ry * (1 - g.fierce * (side < 0 ? 0.35 : 0.9)));
        c.lineTo(ex - e.rx * 1.2, ey - e.ry * (1 - g.fierce * (side < 0 ? 0.9 : 0.35))); c.closePath(); c.fill();
      }
      c.restore();
      c.lineWidth = OL * 0.9; c.strokeStyle = '#1a1226'; c.stroke(sclera);
      c.fillStyle = '#ffffff';
      c.beginPath(); c.ellipse(ex - e.rx * 0.25, ey - e.ry * 0.2, e.rx * 0.22, e.ry * 0.17, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(ex + e.rx * 0.25, ey + e.ry * 0.35, e.rx * 0.1, 0, 7); c.fill();
      if (g.L >= 2) { // brows
        c.strokeStyle = mix(pal.prim, '#000000', 0.55); c.lineWidth = OL * 1.3; c.lineCap = 'round';
        c.beginPath(); c.moveTo(ex - side * e.rx * 1.0, ey - e.ry * 1.35); c.lineTo(ex + side * e.rx * 0.9, ey - e.ry * 0.95); c.stroke();
      }
    }
    const my = f.y + f.r * (g.head ? 0.5 : 0.42);
    if (look.beak) {
      const w = f.r * 0.22;
      shade(poly([[f.x - w, my - w * 0.6], [f.x + w, my - w * 0.6], [f.x, my + w * (0.9 + g.L * 0.2)]]), '#ffb703', f.x, my, w);
    } else {
      c.strokeStyle = '#1a1226'; c.lineWidth = OL * 0.9; c.lineCap = 'round';
      const w = f.r * 0.13;
      c.beginPath(); c.moveTo(f.x - w * 1.4, my - w * 0.2); c.quadraticCurveTo(f.x - w * 0.7, my + w * 0.6, f.x, my); c.quadraticCurveTo(f.x + w * 0.7, my + w * 0.6, f.x + w * 1.4, my - w * 0.2); c.stroke();
      if (g.L >= 2) { c.fillStyle = '#ffffff'; for (const side of [-1, 1]) c.fill(poly([[f.x + side * w * 0.9, my + w * 0.05], [f.x + side * w * 0.6, my + w * 0.75], [f.x + side * w * 0.35, my + w * 0.15]])); }
    }
    if (g.L === 0 || look.cheeks) {
      c.save(); c.globalAlpha = look.cheeks ? 0.75 : 0.35; c.fillStyle = look.cheeks || '#ff8fab';
      for (const side of [-1, 1]) c.fill(ellipse(f.x + side * f.r * 0.62, my - f.r * 0.08, f.r * 0.14, f.r * 0.09));
      c.restore();
    }
  }

  /* ---------- render ---------- */
  function palette(spc, mega, shiny) {
    const fam = FAMILIES[spc.family], look = LOOKS[spc.family];
    const shift = shiny ? 150 + (hashStr(spc.family) % 60) : 0;
    const hs = col => shift ? hueShift(col, shift) : col;
    const dark = hs(fam.colors[2]), sec = hs(fam.colors[1]);
    const prim = mix(hs(fam.colors[0]), dark, (spc.stage - 1) * 0.08);
    return {
      prim, sec, dark, mega: mega ? fam.megaColor : null, iris: look.iris,
      accent: mix(prim, dark, 0.3), spot: mix(prim, dark, 0.3), horn: mix(sec, '#fff8e8', 0.4),
      leaf: hs(spc.family === 'sprout' ? '#4caf50' : '#57cc99'), crystal: mix(sec, '#cff6ff', 0.5),
      wing: mix(prim, sec, 0.3), shell: mix(dark, prim, 0.35),
    };
  }
  function render(spc, mega, shiny, blink) {
    const key = spc.id + (mega ? '*' : '') + (shiny ? '$' : '') + (blink ? '-' : '');
    if (cache.has(key)) return cache.get(key);
    if (blink) render(spc, mega, shiny, false);
    const cv = document.createElement('canvas');
    cv.width = cv.height = RES;
    c = cv.getContext('2d');
    const g = layout(spc, mega), pal = palette(spc, mega, shiny);
    const rnd = mulberry32(g.spotSeed);
    OL = RES * 0.011 / Math.sqrt(Math.max(0.6, g.fit));
    c.save();
    c.translate(g.cx, g.gnd); c.scale(g.fit, g.fit); c.translate(-g.cx, -g.gnd);
    drawWings(g, pal);
    drawTail(g, pal);
    drawBackExtras(g, pal, rnd);
    drawLegs(g, pal);
    drawBody(g, pal, rnd);
    drawArms(g, pal);
    if (g.head) drawEars(g, pal);
    drawHead(g, pal);
    if (!g.head) drawEars(g, pal);
    drawFace(g, pal, blink);
    c.restore();
    const out = cropToContent(cv, spc, mega, shiny);
    cache.set(key, out);
    return out;
  }
  // Tight square crop with the feet on the bottom edge. The crop box is computed once per
  // form (open eyes) and reused for the blink frame so blinking never shifts the sprite.
  const boxes = new Map();
  function cropToContent(cv, spc, mega, shiny) {
    const bk = spc.id + (mega ? '*' : '') + (shiny ? '$' : '');
    let box = boxes.get(bk);
    if (!box) {
      let x0 = RES, y0 = RES, x1 = 0, y1 = 0;
      try {
        const d = cv.getContext('2d').getImageData(0, 0, RES, RES).data;
        for (let y = 0; y < RES; y += 2) for (let x = 0; x < RES; x += 2) {
          if (d[(y * RES + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
      } catch (e) { /* unreadable canvas: keep the full frame */ }
      if (x1 <= x0) { x0 = 0; y0 = 0; x1 = RES; y1 = RES; }
      const side = Math.ceil(Math.max(x1 - x0, y1 - y0) * 1.06 + 8);
      box = { sx: Math.round((x0 + x1) / 2 - side / 2), sy: Math.round(y1 + 4 - side), side };
      boxes.set(bk, box);
    }
    const out = document.createElement('canvas');
    out.width = out.height = box.side;
    out.getContext('2d').drawImage(cv, box.sx, box.sy, box.side, box.side, 0, 0, box.side, box.side);
    return out;
  }

  /* ---------- drawing API ---------- */
  function size(spc, mega, unit) { return unit * scaleFor(spc, mega); }
  function aura(ctx, color, cx, cy, s) {
    const t = performance.now() / 1000;
    const r = s * (0.7 + Math.sin(t * 3) * 0.05);
    const g = ctx.createRadialGradient(cx, cy, s * 0.1, cx, cy, r);
    g.addColorStop(0, color + 'aa'); g.addColorStop(0.6, color + '44'); g.addColorStop(1, color + '00');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }
  const tmp = document.createElement('canvas');
  function tinted(src, color, amt) {
    tmp.width = src.width; tmp.height = src.height;
    const t = tmp.getContext('2d');
    t.globalCompositeOperation = 'source-over'; t.globalAlpha = 1;
    t.clearRect(0, 0, tmp.width, tmp.height);
    t.drawImage(src, 0, 0);
    t.globalCompositeOperation = 'source-atop'; t.globalAlpha = clamp(amt, 0, 1);
    t.fillStyle = color; t.fillRect(0, 0, tmp.width, tmp.height);
    t.globalCompositeOperation = 'source-over'; t.globalAlpha = 1;
    return tmp;
  }
  /* opts: fit, shiny, blink, aura, sx/sy (squash & stretch, anchored at the feet),
     rot (lean around the feet), flip, tint {color, amt} */
  function draw(ctx, spc, mega, cx, cy, unit, opts) {
    opts = opts || {};
    let img = render(spc, mega, opts.shiny, opts.blink);
    const s = opts.fit ? unit : size(spc, mega, unit);
    const col = FAMILIES[spc.family].megaColor;
    if (mega && col && opts.aura !== false) aura(ctx, col, cx, cy, s);
    if (opts.tint && opts.tint.amt > 0) img = tinted(img, opts.tint.color, opts.tint.amt);
    const sx = opts.sx || 1, sy = opts.sy || 1;
    ctx.save();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.translate(cx, cy + s / 2);
    if (opts.rot) ctx.rotate(opts.rot);
    if (opts.flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -s * sx / 2, -s * sy, s * sx, s * sy);
    ctx.restore();
  }
  function drawTint(ctx, spc, mega, cx, cy, unit, color, amt, shiny) {
    draw(ctx, spc, mega, cx, cy, unit, { shiny, tint: { color, amt }, aura: false });
  }
  function url(spc, mega, shiny) {
    const key = spc.id + (mega ? '*' : '') + (shiny ? '$' : '');
    if (!urls.has(key)) {
      const small = document.createElement('canvas');
      small.width = small.height = 256;
      const s = small.getContext('2d');
      s.imageSmoothingQuality = 'high';
      s.drawImage(render(spc, mega, shiny), 0, 0, 256, 256);
      urls.set(key, small.toDataURL());
    }
    return urls.get(key);
  }
  function monUrl(mon) { return url(SPECIES_BY_ID[mon.speciesId], mon.mega, mon.shiny); }

  /* ---------- creature motion helpers (shared by map, catch screen and battles) ---------- */
  // idle: slow breathing squash + periodic blinks, de-synced per creature by seed
  function idle(t, seed) {
    const b = Math.sin(t * 2.4 + seed);
    return { sx: 1 - b * 0.025, sy: 1 + b * 0.035, blink: ((t + seed * 1.37) % 3.6) < 0.13 };
  }
  // hop with anticipation squat, stretched take-off, airborne, squash landing. p in [0,1]
  function hop(p) {
    if (p < 0.18) { const k = Math.sin(p / 0.18 * Math.PI / 2); return { dy: 0, sx: 1 + 0.14 * k, sy: 1 - 0.16 * k, air: false }; }
    if (p < 0.82) {
      const u = (p - 0.18) / 0.64;
      return { dy: Math.sin(u * Math.PI), sx: 0.9 + 0.1 * u, sy: 1.14 - 0.14 * u, air: true };
    }
    const k = Math.sin((p - 0.82) / 0.18 * Math.PI);
    return { dy: 0, sx: 1 + 0.16 * k, sy: 1 - 0.18 * k, air: false };
  }
  const easeOutBack = t => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
  const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  /* ---------- the capture block (stays blocky on purpose) ---------- */
  function cube(ctx, x, y, s, col, rot, lid, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(x, y); ctx.rotate(rot || 0);
    const h = s / 2, q = s / 4;
    const face = (pts, fill) => {
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = Math.max(1, s * 0.035); ctx.strokeStyle = '#121225'; ctx.stroke();
    };
    face([[-h, -q], [0, 0], [0, h], [-h, q]], col[1]);
    face([[0, 0], [h, -q], [h, q], [0, h]], col[2]);
    ctx.beginPath(); ctx.moveTo(-h, 0); ctx.lineTo(0, q); ctx.lineTo(h, 0);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = Math.max(1, s * 0.05); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-s * 0.07, q - s * 0.07, s * 0.14, s * 0.14);
    ctx.translate(0, -(lid || 0) * s * 0.5);
    face([[0, -h], [h, -q], [0, 0], [-h, -q]], col[0]);
    ctx.globalAlpha *= 0.35; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(-h * 0.55, -q * 1.05); ctx.lineTo(0, -h * 0.82); ctx.lineTo(h * 0.15, -h * 0.72); ctx.lineTo(-h * 0.4, -q * 0.75); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  return { draw, drawTint, size, url, monUrl, cube, mix, aura, render, layout, scaleFor, idle, hop, easeOutBack, easeInOut, LOOKS };
})();
