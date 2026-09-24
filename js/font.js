// Tiny bitmap font. Each glyph is rows of '#'/'.'; widths vary (3 or 5). Height 5.
const FONT = (() => {
  const g = {
    A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
    D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
    G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
    J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
    M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
    P: ['##.', '#.#', '##.', '#..', '#..'], Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
    S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
    V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
    Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
    0: ['.#.', '#.#', '#.#', '#.#', '.#.'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
    3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
    6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '.#.', '#.#', '###'],
    9: ['###', '#.#', '###', '..#', '##.'],
    ' ': ['..', '..', '..', '..', '..'], '.': ['.', '.', '.', '.', '#'], ',': ['.', '.', '.', '#', '#'], '!': ['#', '#', '#', '.', '#'],
    '?': ['##.', '..#', '.#.', '...', '.#.'], ':': ['.', '#', '.', '#', '.'], "'": ['#', '#', '.', '.', '.'], '-': ['...', '...', '###', '...', '...'],
    '+': ['...', '.#.', '###', '.#.', '...'], '/': ['..#', '..#', '.#.', '#..', '#..'], '(': ['.#', '#.', '#.', '#.', '.#'], ')': ['#.', '.#', '.#', '.#', '#.'],
    '%': ['#.#', '..#', '.#.', '#..', '#.#'], '>': ['#..', '.#.', '..#', '.#.', '#..'], '<': ['..#', '.#.', '#..', '.#.', '..#'],
    '=': ['...', '###', '...', '###', '...'], '#': ['#.#', '###', '#.#', '###', '#.#'], '&': ['.#.', '#.#', '.#.', '#.#', '.##'],
    '"': ['#.#', '#.#', '...', '...', '...'], '*': ['#.#', '.#.', '#.#', '...', '...'], '_': ['...', '...', '...', '...', '###'],
  };
  const glyphs = {};
  for (const [ch, rows] of Object.entries(g)) {
    const px = [];
    rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === '#') px.push(x, y); }));
    glyphs[ch] = { w: rows[0].length, px };
  }
  return glyphs;
})();

function textWidth(str, scale = 1) {
  let w = 0;
  for (const ch of String(str).toUpperCase()) w += ((FONT[ch] || FONT['?']).w + 1) * scale;
  return Math.max(0, w - scale);
}

// Draw text with a 1px drop outline for legibility. align: 'left' | 'center' | 'right'
function drawText(ctx, str, x, y, color = '#eef4ff', opts = {}) {
  const scale = opts.scale || 1, align = opts.align || 'left', shadow = opts.shadow === undefined ? '#0b0d1a' : opts.shadow;
  str = String(str).toUpperCase();
  let cx = Math.round(align === 'center' ? x - textWidth(str, scale) / 2 : align === 'right' ? x - textWidth(str, scale) : x);
  y = Math.round(y);
  const pass = (col, ox, oy) => {
    ctx.fillStyle = col;
    let px = cx;
    for (const ch of str) {
      const gl = FONT[ch] || FONT['?'];
      for (let i = 0; i < gl.px.length; i += 2) ctx.fillRect(px + gl.px[i] * scale + ox, y + gl.px[i + 1] * scale + oy, scale, scale);
      px += (gl.w + 1) * scale;
    }
  };
  if (shadow) { pass(shadow, 0, scale); pass(shadow, scale, 0); pass(shadow, scale, scale); pass(shadow, -scale, 0); pass(shadow, 0, -scale); }
  pass(color, 0, 0);
}

// Word-wrap to a pixel width; returns lines.
function wrapText(str, maxW, scale = 1) {
  const words = String(str).split(' '), lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (textWidth(test, scale) > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
