/** The server's only source of "now". Real in production; set to scenario times in DEMO_MODE and tests. */
export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/**
 * A clock set to a chosen instant. When `ticking` it then advances in real
 * time (so 30-second relocks and 60-second approvals still behave); when not,
 * it stands still until moved by hand (tests).
 */
export class ControlledClock implements Clock {
  private base: number;
  private setAt: number;
  constructor(start: number, private ticking = true) {
    this.base = start;
    this.setAt = Date.now();
  }
  now(): number {
    return this.ticking ? this.base + (Date.now() - this.setAt) : this.base;
  }
  set(ms: number): void {
    this.base = ms;
    this.setAt = Date.now();
  }
  advance(ms: number): void {
    this.set(this.now() + ms);
  }
  setTicking(t: boolean): void {
    this.base = this.now();
    this.setAt = Date.now();
    this.ticking = t;
  }
}
