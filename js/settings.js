// Player options, kept apart from the save so a new game never resets them.
const SETTINGS_KEY = 'fangPixelSettings';
const Settings = {
  music: 7, sfx: 8, shake: true, flash: true, muted: false,
  load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) Object.assign(this, JSON.parse(raw));
      else if (localStorage.getItem('fangPixelMuted') === '1') this.muted = true; // older mute-only setting
    } catch (e) {}
  },
  save() {
    const { music, sfx, shake, flash, muted } = this;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ music, sfx, shake, flash, muted })); } catch (e) {}
  },
};
// volume steps 0-10 are 2.5 dB apart, so each press sounds like the same-sized change
const volumeGain = v => v <= 0 ? 0 : Math.pow(10, -(10 - v) * 2.5 / 20);
Settings.load();
