export interface Sha256Digest {
  readonly update: (bytes: Readonly<Uint8Array>) => void;
  readonly hex: () => string;
}

const blockBytes = 64;

const lengthAt = 56;

const roundConstants = wordsOf([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

const startingState = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

function wordsOf(words: readonly number[]): DataView {
  const view = new DataView(new ArrayBuffer(words.length * 4));
  for (const [index, word] of words.entries()) {
    view.setUint32(index * 4, word);
  }
  return view;
}

function rotated(word: number, bits: number): number {
  return (word >>> bits) | (word << (32 - bits));
}

function scheduled(schedule: DataView, source: DataView, offset: number): void {
  for (let word = 0; word < 16; word += 1) {
    schedule.setInt32(word * 4, source.getInt32(offset + word * 4));
  }
  for (let word = 16; word < 64; word += 1) {
    const before15 = schedule.getInt32((word - 15) * 4);
    const before2 = schedule.getInt32((word - 2) * 4);
    const small0 = rotated(before15, 7) ^ rotated(before15, 18) ^ (before15 >>> 3);
    const small1 = rotated(before2, 17) ^ rotated(before2, 19) ^ (before2 >>> 10);
    const before16 = schedule.getInt32((word - 16) * 4);
    schedule.setInt32(word * 4, before16 + small0 + schedule.getInt32((word - 7) * 4) + small1);
  }
}

function compressed(state: DataView, schedule: DataView): void {
  let a = state.getInt32(0);
  let b = state.getInt32(4);
  let c = state.getInt32(8);
  let d = state.getInt32(12);
  let e = state.getInt32(16);
  let f = state.getInt32(20);
  let g = state.getInt32(24);
  let h = state.getInt32(28);
  for (let round = 0; round < 64; round += 1) {
    const big1 = rotated(e, 6) ^ rotated(e, 11) ^ rotated(e, 25);
    const choice = (e & f) ^ (~e & g);
    const first = (h + big1 + choice + roundConstants.getInt32(round * 4) + schedule.getInt32(round * 4)) >>> 0;
    const big0 = rotated(a, 2) ^ rotated(a, 13) ^ rotated(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    h = g;
    g = f;
    f = e;
    e = (d + first) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (first + big0 + majority) >>> 0;
  }
  addedTo(state, 0, a, b);
  addedTo(state, 8, c, d);
  addedTo(state, 16, e, f);
  addedTo(state, 24, g, h);
}

function addedTo(state: DataView, offset: number, first: number, second: number): void {
  state.setInt32(offset, state.getInt32(offset) + first);
  state.setInt32(offset + 4, state.getInt32(offset + 4) + second);
}

export function sha256Digest(): Sha256Digest {
  const state = wordsOf(startingState);
  const schedule = new DataView(new ArrayBuffer(blockBytes * 4));
  const block = new Uint8Array(blockBytes);
  const blockView = new DataView(block.buffer);
  let filled = 0;
  let length = 0;
  const blockAt = (source: DataView, offset: number) => {
    scheduled(schedule, source, offset);
    compressed(state, schedule);
  };
  const update = (bytes: Readonly<Uint8Array>) => {
    length += bytes.byteLength;
    let offset = 0;
    if (filled > 0) {
      offset = Math.min(blockBytes - filled, bytes.byteLength);
      block.set(bytes.subarray(0, offset), filled);
      filled += offset;
      if (filled < blockBytes) {
        return;
      }
      blockAt(blockView, 0);
    }
    const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (; offset + blockBytes <= bytes.byteLength; offset += blockBytes) {
      blockAt(source, offset);
    }
    block.set(bytes.subarray(offset), 0);
    filled = bytes.byteLength - offset;
  };
  return {
    update,
    hex: () => {
      const bits = length * 8;
      const trailer = new DataView(new ArrayBuffer(8));
      trailer.setUint32(0, Math.floor(bits / 2 ** 32));
      trailer.setUint32(4, bits >>> 0);
      update(Uint8Array.of(0x80));
      update(new Uint8Array((blockBytes + lengthAt - filled) % blockBytes));
      update(new Uint8Array(trailer.buffer));
      return Array.from({ length: 8 }, (_, word) =>
        state
          .getUint32(word * 4)
          .toString(16)
          .padStart(8, '0'),
      ).join('');
    },
  };
}
