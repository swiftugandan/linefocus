/** Seeded pseudo-random numbers. Every trace takes an explicit seed so that results are reproducible
 * and an optimiser sees the same random draws for every candidate (common random numbers). */

/** Mixes a 32-bit seed into a well-distributed state word (SplitMix32). @param {number} x */
function splitmix32(x) {
  x = (x + 0x9e3779b9) | 0;
  let z = x;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return [x, (z ^ (z >>> 16)) >>> 0];
}

/** Small, fast generator (SFC32) with uniform and normal draws. */
export class Rng {
  /** @param {number} seed */
  constructor(seed) {
    let s = seed >>> 0;
    /** @type {number[]} */
    const words = [];
    for (let i = 0; i < 4; i++) { const [next, word] = splitmix32(s); s = next; words.push(word); }
    this.a = words[0]; this.b = words[1]; this.c = words[2]; this.d = words[3];
    /** @type {number | null} */
    this.spare = null;
    for (let i = 0; i < 12; i++) this.next();
  }

  /** Uniform number in [0, 1). */
  next() {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** Uniform number in (0, 1], safe for logarithms. */
  open() { return 1 - this.next(); }

  /** Standard normal draw (Marsaglia polar method). */
  normal() {
    if (this.spare !== null) { const value = this.spare; this.spare = null; return value; }
    let u, v, s;
    do { u = 2 * this.next() - 1; v = 2 * this.next() - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    this.spare = v * m;
    return u * m;
  }
}
