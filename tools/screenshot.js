// usage: PW=/path/to/node_modules/playwright OUT=dir STEPS='[{"keys":["x","Enter"],"shot":1}]' node tools/screenshot.js
const { chromium } = require(process.env.PW);
const out = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1536, height: 960 }, ignoreHTTPSErrors: true });
  const errs = []; p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); }); p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await p.goto(process.env.URL || 'https://fangthefox.localhost/pixel/'); await p.evaluate(() => localStorage.clear());
  await p.reload(); await p.waitForTimeout(1200);
  const steps = JSON.parse(process.env.STEPS || '[]');
  let n = 0;
  await p.screenshot({ path: `${out}/s${n++}.png` });
  for (const st of steps) {
    if (st.eval) await p.evaluate(st.eval);
    for (const k of (st.keys || [])) { await p.keyboard.press(k); await p.waitForTimeout(st.gap || 180); }
    await p.waitForTimeout(st.wait || 600);
    if (st.shot) await p.screenshot({ path: `${out}/s${n++}.png` });
  }
  console.log(errs.slice(0, 30).join('\n') || 'no errors');
  await b.close();
})();
