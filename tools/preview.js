// Render sprite files to a PNG contact sheet for visual checking.
// usage: node tools/preview.js out.png js/sprites-a.js [js/sprites-b.js ...] [--scale=6] [--only=prefix]
const fs = require('fs'), zlib = require('zlib'), path = require('path'), vm = require('vm');
const args = process.argv.slice(2);
const out = args.shift();
let scale = 6, only = null; const files = [];
for (const a of args) { if (a.startsWith('--scale=')) scale = +a.slice(8); else if (a.startsWith('--only=')) only = a.slice(7); else files.push(a); }
const ctx = { SPRITES: {}, module: undefined, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/palette.js'), 'utf8') + ';this.PAL=PAL;', ctx);
for (const f of files) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
const PAL = ctx.PAL, S = ctx.SPRITES;
const names = Object.keys(S).filter(n => !only || n.startsWith(only));
const errors = [];
for (const n of names) {
  const s = S[n];
  if (s.rows.length !== s.h) errors.push(`${n}: ${s.rows.length} rows, expected h=${s.h}`);
  s.rows.forEach((r, i) => { if (r.length !== s.w) errors.push(`${n} row ${i}: length ${r.length}, expected w=${s.w}`);
    for (const ch of r) if (ch !== '.' && !PAL[ch]) errors.push(`${n} row ${i}: unknown colour '${ch}'`); });
}
if (errors.length) { console.error(errors.slice(0, 40).join('\n')); }
// layout: cells of max 32x40 native, label strip under each
const cellW = 36, cellH = 44, cols = 8, rows = Math.ceil(names.length / cols) || 1;
const W = cols * cellW * scale, H = rows * cellH * scale;
const px = Buffer.alloc(W * H * 3);
const hex = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { // checker bg
  const c = (((x / (4*scale))|0) + ((y / (4*scale))|0)) % 2 ? 0x55 : 0x66; const o = (y*W+x)*3; px[o]=c-20; px[o+1]=c-10; px[o+2]=c+10; }
names.forEach((n, idx) => {
  const s = S[n], cx = (idx % cols) * cellW, cy = ((idx / cols) | 0) * cellH;
  const ox = cx + ((cellW - s.w) >> 1), oy = cy + 2 + (40 - 2 - s.h);
  s.rows.forEach((r, yy) => [...r].forEach((ch, xx) => {
    if (ch === '.' || !PAL[ch]) return; const [R,G,B] = hex(PAL[ch]);
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const X = (ox + xx) * scale + dx, Y = (oy + yy) * scale + dy; if (X>=W||Y>=H) continue; const o = (Y*W+X)*3; px[o]=R; px[o+1]=G; px[o+2]=B; }
  }));
});
// PNG encode
const raw = Buffer.alloc((W*3+1)*H); for (let y=0;y<H;y++){ raw[y*(W*3+1)]=0; px.copy(raw, y*(W*3+1)+1, y*W*3, (y+1)*W*3); }
const crcT = []; for (let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = c&1 ? 0xedb88320^(c>>>1) : c>>>1; crcT[n]=c>>>0; }
const crc = b => { let c=0xffffffff; for (const x of b) c = crcT[(c^x)&255]^(c>>>8); return (c^0xffffffff)>>>0; };
const chunk = (t, d) => { const l=Buffer.alloc(4); l.writeUInt32BE(d.length); const td=Buffer.concat([Buffer.from(t), d]); const c=Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4); ihdr[8]=8; ihdr[9]=2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`${names.length} sprites -> ${out} (${W}x${H})` + (errors.length ? `, ${errors.length} ERRORS` : ''));
console.log(names.map((n,i)=>`${i}:${n}`).join('  '));
