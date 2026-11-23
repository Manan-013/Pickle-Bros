const BLOCKED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
/** How far back mouse movement counts toward a flick (ms). */
const FLICK_WINDOW = 150;

/** Keyboard and mouse state. Touch controls come in a later phase. */
export class Input {
  private held = new Set<string>();
  private pressed: string[] = [];
  private trail: { t: number; x: number; y: number }[] = [];
  /** Last mouse position in screen pixels, or null before the mouse has moved. */
  pointer: { x: number; y: number } | null = null;

  constructor() {
    addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.pointer = { x: e.clientX, y: e.clientY };
      const t = performance.now();
      this.trail.push({ t, x: e.clientX, y: e.clientY });
      while (this.trail.length && this.trail[0].t < t - FLICK_WINDOW) this.trail.shift();
    });
    addEventListener('keydown', (e) => {
      if (BLOCKED.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.push(e.code);
      this.held.add(e.code);
    });
    addEventListener('keyup', (e) => this.held.delete(e.code));
    addEventListener('blur', () => this.held.clear());
  }

  /**
   * Mouse buttons on the game canvas only (not on menu buttons). Reported through consumePressed()
   * as 'MouseLeft' / 'MouseRight' when pressed and 'MouseLeftUp' / 'MouseRightUp' when released.
   * Right-click never opens the browser menu.
   */
  attach(canvas: HTMLElement): void {
    const name = (button: number) => (button === 0 ? 'MouseLeft' : button === 2 ? 'MouseRight' : null);
    canvas.addEventListener('pointerdown', (e) => {
      const n = name(e.button);
      if (!n) return;
      this.pressed.push(n);
      this.held.add(n);
    });
    // Released anywhere (even off the canvas) counts, but only for a press that began on the canvas.
    addEventListener('pointerup', (e) => {
      const n = name(e.button);
      if (n && this.held.delete(n)) this.pressed.push(`${n}Up`);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isDown(code: string): boolean {
    return this.held.has(code);
  }

  /** Mouse movement (px) over the last moment: used to read a flick for spin. */
  flick(): { dx: number; dy: number } {
    const now = performance.now();
    const recent = this.trail.filter((s) => s.t >= now - FLICK_WINDOW);
    if (recent.length < 2) return { dx: 0, dy: 0 };
    const a = recent[0];
    const b = recent[recent.length - 1];
    return { dx: b.x - a.x, dy: b.y - a.y };
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  /** Movement on the court plane: x right, z toward the camera. Length <= 1. */
  move(): { x: number; z: number } {
    const x = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    const z = (this.down('KeyS', 'ArrowDown') ? 1 : 0) - (this.down('KeyW', 'ArrowUp') ? 1 : 0);
    const len = Math.hypot(x, z);
    return len > 1 ? { x: x / len, z: z / len } : { x, z };
  }

  /** Keys and mouse buttons pressed (and mouse buttons released) since the last call. */
  consumePressed(): string[] {
    const p = this.pressed;
    this.pressed = [];
    return p;
  }
}
