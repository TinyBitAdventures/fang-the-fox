// make watch: rebuild and copy the ROM to web/rom/ whenever a source changes; the web player
// on localhost reloads it by itself. Watches gbc/src, gbc/tools, gbc/art, gbc/overrides.js and ../js.
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const GBC = path.join(__dirname, '..'), ROOT = path.join(GBC, '..');
const dirs = ['src', 'tools', 'art'].map(d => path.join(GBC, d)).concat([path.join(ROOT, 'js')]);
const files = [path.join(GBC, 'overrides.js'), path.join(GBC, 'Makefile')];
let timer = null, running = false, again = false;
function build() {
  if (running) { again = true; return; }
  running = true;
  const started = Date.now();
  const make = spawn('make', ['run'], { cwd: GBC, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; make.stdout.on('data', d => { log += d; }); make.stderr.on('data', d => { log += d; });
  make.on('close', code => {
    const t = new Date().toLocaleTimeString();
    console.log(code === 0 ? `${t} built in ${((Date.now() - started) / 1000).toFixed(1)} s` : `${t} build failed:\n${log.trim()}\n`);
    running = false;
    if (again) { again = false; build(); }
  });
}
const kick = (file) => {
  if (file && (/[\\/]gen[\\/]/.test(file) || /(^|[\\/])\./.test(file))) return;   // generated files and dotfiles
  clearTimeout(timer); timer = setTimeout(build, 250);
};
for (const d of dirs) if (fs.existsSync(d)) fs.watch(d, { recursive: true }, (e, f) => kick(f && path.join(d, f)));
for (const f of files) fs.watch(f, () => kick(f));
console.log('watching for changes; the player at https://fangthefox.localhost/gbc/ reloads on each build (Ctrl-C to stop)');
build();
