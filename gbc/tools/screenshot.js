// Screenshots of the ROM running in the web player, driven frame by frame (the emulator is paused, so
// runs are repeatable). Writes s0.png (the screen after boot) and one sN.png per step with "shot".
// usage: PW=/path/to/node_modules/playwright OUT=dir STEPS='[{"hold":["right"],"frames":40,"shot":1}]' node gbc/tools/screenshot.js
//   step keys: press (a button, held 2 frames), hold ([buttons] for "frames"), frames (run N frames),
//              eval (JS in the page), shot (1 = the 160x144 screen at 3x, "page" = the whole page)
//   Buttons: up down left right A B start select. URL=... to test another copy; KEEP_SAVE=1 keeps the save.
const { chromium } = require(process.env.PW);
const fs = require('fs'), out = process.env.OUT || 'shots';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1024, height: 900 }, ignoreHTTPSErrors: true });
  const errs = []; p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); }); p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await p.goto((process.env.URL || 'https://fangthefox.localhost/gbc/') + '?live=0');
  if (!process.env.KEEP_SAVE) { await p.evaluate(() => localStorage.clear()); await p.reload(); }
  await p.evaluate(() => window.fangEmu.ready);
  await p.evaluate(() => { fangEmu.pause(); fangEmu.step(90); });
  let n = 0;
  const shot = async kind => {
    const file = `${out}/s${n++}.png`;
    if (kind === 'page') await p.screenshot({ path: file });
    else {   // the canvas itself, scaled 3x with no smoothing
      const data = await p.evaluate(() => { const src = document.querySelector('#screen'), c = document.createElement('canvas'); c.width = 480; c.height = 432; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(src, 0, 0, 480, 432); return c.toDataURL('image/png'); });
      fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
    }
  };
  await shot(1);
  for (const st of JSON.parse(process.env.STEPS || '[]')) {
    if (st.eval) await p.evaluate(st.eval);
    if (st.press) await p.evaluate(b => { fangEmu.hold(b); fangEmu.step(2); fangEmu.hold(b, false); fangEmu.step(1); }, st.press);
    if (st.hold) await p.evaluate(([b, f]) => { fangEmu.hold(b); fangEmu.step(f); fangEmu.hold(b, false); }, [st.hold, st.frames || 30]);
    else if (st.frames) await p.evaluate(f => fangEmu.step(f), st.frames);
    if (st.shot) await shot(st.shot);
  }
  console.log(`${n} screenshots in ${out}`);
  console.log(errs.slice(0, 30).join('\n') || 'no errors');
  await b.close();
})();
