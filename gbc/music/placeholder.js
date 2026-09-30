// A placeholder loop so the music driver, its interrupt and ROM banking are tested from phase 1 on.
// The album tracks replace it in phase 7 (converted from the Bitwig projects).
const bar = (...rows) => rows.join(' ');
module.exports = {
  tempo: 7,   // ticks per row: 16th notes at about 128 BPM
  duty: [{ duty: 2, env: 0xB3 }, { duty: 1, env: 0x72 }],
  wave: [{ volume: 1, wave: 0 }],
  noise: [{ env: 0xA1 }, { env: 0x81 }, { env: 0x41 }],
  waves: [[0, 2, 4, 6, 8, 10, 12, 14, 15, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 1, 2, 3, 4, 5, 6]],
  drums: { k: ['C4', 1], s: ['A5', 2], h: ['C7', 3] },
  patterns: {
    A: {
      p1: bar('C5 . E5 . G5 . . . A5 . G5 . E5 . . .', 'F5 . A5 . C6 . . . B5 . A5 . G5 . . .', 'E5 . G5 . C6 . . . D6 . C6 . A5 . . .', 'G5 . . . F5 . E5 . D5 . . . - . . .'),
      p2: bar('C4 E4 G4 E4 C4 E4 G4 E4 C4 E4 G4 E4 C4 E4 G4 E4', 'F4 A4 C5 A4 F4 A4 C5 A4 F4 A4 C5 A4 F4 A4 C5 A4', 'A3 C4 E4 C4 A3 C4 E4 C4 A3 C4 E4 C4 A3 C4 E4 C4', 'G3 B3 D4 B3 G3 B3 D4 B3 G3 B3 D4 B3 G3 B3 D4 B3'),
      wave: bar('C4 . . . C4 . . . G3 . . . C4 . . .', 'F3 . . . F3 . . . C4 . . . F3 . . .', 'A3 . . . A3 . . . E4 . . . A3 . . .', 'G3 . . . G3 . . . D4 . . . G3 . . .'),
      noise: bar('k . h . s . h . k . h . s . h h', 'k . h . s . h . k . h . s . h h', 'k . h . s . h . k . h . s . h h', 'k . h . s . h . k . k . s . s s'),
    },
    B: {
      p1: bar('C5 . E5 . G5 . . . A5 . G5 . E5 . C5 .', 'D5 . F5 . A5 . . . G5 . F5 . E5 . . .', 'F5 . E5 . D5 . . . E5 . G5 . B5 . . .', 'C6 . . . . . . . G5 . . . C5 . - .'),
      p2: bar('C4 E4 G4 E4 C4 E4 G4 E4 C4 E4 G4 E4 C4 E4 G4 E4', 'D4 F4 A4 F4 D4 F4 A4 F4 D4 F4 A4 F4 D4 F4 A4 F4', 'F4 A4 C5 A4 F4 A4 C5 A4 G3 B3 D4 B3 G3 B3 D4 B3', 'C4 E4 G4 E4 C4 E4 G4 E4 C4 E4 G4 E4 C4 . . .'),
      wave: bar('C4 . . . C4 . . . G3 . . . C4 . . .', 'D4 . . . D4 . . . A3 . . . D4 . . .', 'F3 . . . F3 . . . G3 . . . G3 . . .', 'C4 . . . G3 . . . C4 . . . - . . .'),
      noise: bar('k . h . s . h . k . h . s . h h', 'k . h . s . h . k . h . s . h h', 'k . h . s . h . k . h . s . h h', 'k . . . s . . . k . s s s s s s'),
    },
  },
  order: ['A', 'B'],
};
