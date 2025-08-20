// src/ml/kalman.ts
// 2D constant-velocity Kalman filter (x,y,vx,vy). Positions in pixels, dt in seconds.

export class Kalman2D {
  private x = new Float64Array(4); // [x, y, vx, vy]
  private P = new Float64Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1000, 0,
    0, 0, 0, 1000,
  ]);
  private inited = false;

  // q: process noise scale (bigger = smoother, slower to react)
  // r: measurement noise (bigger = trust measurements less)
  constructor(private q: number = 5e-2, private r: number = 3.0) {}

  reset() {
    this.inited = false;
    this.x.fill(0);
    this.P.set([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1000, 0,
      0, 0, 0, 1000,
    ]);
  }

  private init(zx: number, zy: number) {
    this.x[0] = zx; this.x[1] = zy; this.x[2] = 0; this.x[3] = 0;
    this.inited = true;
  }

  predict(dt: number) {
    if (!this.inited) return;
    this.x[0] = this.x[0] + dt * this.x[2];
    this.x[1] = this.x[1] + dt * this.x[3];

    const p = this.P;
    const dt2 = dt * dt;
    const n00 = p[0] + dt*(p[2] + p[8])  + dt2*p[10];
    const n01 = p[1] + dt*(p[3] + p[9])  + dt2*p[11];
    const n02 = p[2] + dt*p[10];
    const n03 = p[3] + dt*p[11];
    const n10 = p[4] + dt*(p[6] + p[12]) + dt2*p[14];
    const n11 = p[5] + dt*(p[7] + p[13]) + dt2*p[15];
    const n12 = p[6] + dt*p[14];
    const n13 = p[7] + dt*p[15];
    const n20 = p[8] + dt*p[10];
    const n21 = p[9] + dt*p[11];
    const n22 = p[10];
    const n23 = p[11];
    const n30 = p[12] + dt*p[14];
    const n31 = p[13] + dt*p[15];
    const n32 = p[14];
    const n33 = p[15];

    const q11 = this.q * (dt2*dt2 / 4); // dt^4 / 4
    const q13 = this.q * (dt2*dt  / 2); // dt^3 / 2
    const q33 = this.q * (dt2);        // dt^2

    this.P.set([
      n00 + q11, n01,         n02 + q13, n03,
      n10,       n11 + q11,   n12,       n13 + q13,
      n20 + q13, n21,         n22 + q33, n23,
      n30,       n31 + q13,   n32,       n33 + q33,
    ]);
  }

  update(zx: number, zy: number) {
    if (!this.inited) { this.init(zx, zy); return; }

    const p = this.P;
    const y0 = zx - this.x[0];
    const y1 = zy - this.x[1];
    const s00 = p[0] + this.r, s01 = p[1];
    const s10 = p[4],          s11 = p[5] + this.r;
    const det = s00*s11 - s01*s10; if (!isFinite(det) || Math.abs(det) < 1e-12) return;
    const inv00 =  s11/det, inv01 = -s01/det, inv10 = -s10/det, inv11 = s00/det;

    // K = P H^T S^{-1}, with H = [[1,0,0,0],[0,1,0,0]]
    const c0_0 = p[0],  c0_1 = p[4],  c0_2 = p[8],  c0_3 = p[12];
    const c1_0 = p[1],  c1_1 = p[5],  c1_2 = p[9],  c1_3 = p[13];

    const k00 = c0_0*inv00 + c1_0*inv10; const k01 = c0_0*inv01 + c1_0*inv11;
    const k10 = c0_1*inv00 + c1_1*inv10; const k11 = c0_1*inv01 + c1_1*inv11;
    const k20 = c0_2*inv00 + c1_2*inv10; const k21 = c0_2*inv01 + c1_2*inv11;
    const k30 = c0_3*inv00 + c1_3*inv10; const k31 = c0_3*inv01 + c1_3*inv11;

    // x = x + K y
    this.x[0] += k00*y0 + k01*y1;
    this.x[1] += k10*y0 + k11*y1;
    this.x[2] += k20*y0 + k21*y1;
    this.x[3] += k30*y0 + k31*y1;

    // P = P - K H P
    const row0 = [p[0], p[1], p[2], p[3]];
    const row1 = [p[4], p[5], p[6], p[7]];
    const sub = new Float64Array(16);
    const k0 = [k00, k10, k20, k30];
    const k1 = [k01, k11, k21, k31];
    for (let i = 0; i < 4; i++) {
      sub[i*4+0] = k0[i]*row0[0] + k1[i]*row1[0];
      sub[i*4+1] = k0[i]*row0[1] + k1[i]*row1[1];
      sub[i*4+2] = k0[i]*row0[2] + k1[i]*row1[2];
      sub[i*4+3] = k0[i]*row0[3] + k1[i]*row1[3];
    }
    for (let i = 0; i < 16; i++) p[i] = p[i] - sub[i];
  }

  hasInit() { return this.inited; }
  getPosition() { return { x: this.x[0], y: this.x[1] }; }
  getVelocityPxPerSec() { return Math.hypot(this.x[2], this.x[3]); }
  getState() { return { x: this.x[0], y: this.x[1], vx: this.x[2], vy: this.x[3] }; }

  /** S = H P H^T + R for position measurement (2x2): [[P00+r, P01],[P10, P11+r]] */
  getInnovationCov(): [number, number, number, number] {
    return [this.P[0] + this.r, this.P[1], this.P[4], this.P[5] + this.r];
  }

  /** Mahalanobis distance^2 of z=(zx,zy) w.r.t current predicted position */
  mahalanobis2(zx: number, zy: number): number {
    const d0 = zx - this.x[0];
    const d1 = zy - this.x[1];
    const [s00, s01, s10, s11] = this.getInnovationCov();
    const det = s00*s11 - s01*s10;
    if (!isFinite(det) || Math.abs(det) < 1e-12) return Number.POSITIVE_INFINITY;
    const inv00 =  s11/det, inv01 = -s01/det, inv10 = -s10/det, inv11 = s00/det;
    // d^T S^{-1} d
    return d0*(inv00*d0 + inv01*d1) + d1*(inv10*d0 + inv11*d1);
  }
}

export function pxPerSecToKph(pxPerSec: number, metersPerPixel: number) {
  return pxPerSec * metersPerPixel * 3.6;
}
