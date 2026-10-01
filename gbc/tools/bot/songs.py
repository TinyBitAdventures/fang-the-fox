#!/usr/bin/env python3
# Records every Game Boy song as the ROM plays it: picks each one in the pause screen's SOUND TEST and
# captures the emulated sound chip for one pass of the song (PyBoy; binjgb in the web player may differ
# a little). A song that loops back to a point (loopFrom: a recreation) plays its loop twice and fades out, as a
# soundtrack does. Writes build/songs/<song>.wav as the chip made it, and a mono .mp3 for listening when ffmpeg is there.
# usage: gbc/.venv/bin/python gbc/tools/bot/songs.py [song ...]
import json, re, sys, shutil, subprocess, wave
import numpy as np
from rom import Rom, GBC, S_PAUSE

WORLD = (GBC / 'src/gen/world.h').read_text()
COUNT = int(re.search(r'#define SONG_COUNT (\d+)', WORLD).group(1))
SONGS = sorted(p.stem for p in (GBC / 'music').glob('*.js') if not p.name.endswith('.map.js') and p.name != 'sfx.js')   # build.js's order
OUT = GBC / 'build/songs'
FPS = 4194304 / 70224   # frames a second
assert len(SONGS) == COUNT, f'{len(SONGS)} songs in music/, {COUNT} in the ROM: run make first'

FADE = 6.0   # seconds
def song_info(name):   # (seconds to record, seconds where the fade starts or None)
    s = json.loads(subprocess.run(['node', '-e', f"const s = require({json.dumps(str(GBC / 'music' / name))}); console.log(JSON.stringify({{ beats: s.beats, bpm: s.bpm, loopFrom: s.loopFrom }}))"], capture_output=True, text=True, check=True).stdout)
    end, beat = s['beats'][1] - s['beats'][0], 60 / s['bpm']
    if s.get('loopFrom') is None: return end * beat, None
    fade_at = (end + end - s['loopFrom']) * beat   # the intro, the loop, the loop again
    return fade_at + FADE, fade_at

def record(target):
    rom = Rom(sound=True)
    rom.poke('en_n', 0)
    rom.tap('start', 30)
    assert rom.state() == S_PAUSE
    for _ in range(3): rom.tap('right', 24)   # MAP, QUEST, FANG, OPTIONS
    for _ in range(5): rom.tap('down', 8)     # MUSIC ... SOUND TEST
    while rom.u8('music_cur') != (target - 1) % COUNT: rom.tap('right', 8)
    seconds = song_info(SONGS[target])[0] + 1.5
    rate = rom.pb.sound.sample_rate
    chunks = []
    rom.pb.button_press('right')
    for f in range(int(seconds * FPS)):
        if f == 2: rom.pb.button_release('right')
        rom.tick(1, False)
        a = rom.pb.sound.ndarray
        if a.size: chunks.append(a.copy())
    assert rom.u8('music_cur') == target, f'the sound test did not reach song {target}'
    rom.stop()
    pcm = np.concatenate(chunks).astype(np.int16) * 256
    lead = np.argmax(np.abs(pcm).max(axis=1) > 0)   # from the song's first sound
    return pcm[lead:], rate

OUT.mkdir(parents=True, exist_ok=True)
for i, name in enumerate(SONGS):
    if sys.argv[1:] and name not in sys.argv[1:]: continue
    pcm, rate = record(i)
    path = OUT / f'{name}.wav'
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(rate); w.writeframes(pcm.tobytes())
    peak = int(np.abs(pcm).max())
    line = f'{name}: {len(pcm) / rate:.1f} s at {rate} Hz, peak {peak / 32768:.2f}'
    if shutil.which('ffmpeg'):
        # the hardware's capacitor takes out the DC offset the emulator leaves; one gain for every song keeps their balance
        fade_at = song_info(name)[1]
        af = 'highpass=f=20:p=1,volume=10dB' + (f',afade=t=out:st={fade_at:.2f}:d={FADE},atrim=0:{fade_at + FADE:.2f}' if fade_at else '')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(path), '-af', af, '-ac', '1', '-b:a', '128k', str(path.with_suffix('.mp3'))], check=True)
        line += f', {path.with_suffix(".mp3").stat().st_size / 1e6:.1f} MB mp3'
    print(line)
