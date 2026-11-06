// Map projection, identical to render/project.py: WGS84 -> ECEF -> ENU at the anchor -> fixed orthographic camera.
// Canvas pixel (u, v): u right, v down, (0, 0) = anchor. toPx is forward; toLatLon inverts it on a horizontal plane.
const A = 6378137, F_ = 1 / 298.257223563, E2 = F_ * (2 - F_), D = Math.PI / 180;

export function makeProjection({ lat, lon, groundH, heading, tilt, mpp }) {
  const la = lat * D, lo = lon * D, sla = Math.sin(la), cla = Math.cos(la), slo = Math.sin(lo), clo = Math.cos(lo);
  const ecef = (latd, lond, h) => {
    const a = latd * D, b = lond * D, n = A / Math.sqrt(1 - E2 * Math.sin(a) ** 2);
    return [(n + h) * Math.cos(a) * Math.cos(b), (n + h) * Math.cos(a) * Math.sin(b), (n * (1 - E2) + h) * Math.sin(a)];
  };
  const O = ecef(lat, lon, groundH);
  const h = heading * D, t = tilt * D;
  const Fv = [Math.sin(h) * Math.cos(t), Math.cos(h) * Math.cos(t), -Math.sin(t)];
  const R = [Math.cos(h), -Math.sin(h), 0];
  const U = [R[1] * Fv[2] - R[2] * Fv[1], R[2] * Fv[0] - R[0] * Fv[2], R[0] * Fv[1] - R[1] * Fv[0]];
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];

  function enuOf(latd, lond, hgt = groundH) {
    const [x, y, z] = ecef(latd, lond, hgt), dx = x - O[0], dy = y - O[1], dz = z - O[2];
    return [-slo * dx + clo * dy, -sla * clo * dx - sla * slo * dy + cla * dz, cla * clo * dx + cla * slo * dy + sla * dz];
  }
  // lat/lon (on the anchor's ground plane unless hgt given) -> canvas px
  function toPx(latd, lond, hgt) { const p = enuOf(latd, lond, hgt); return [dot(p, R) / mpp, -dot(p, U) / mpp]; }

  // canvas px -> lat/lon of the point on the plane `up` metres above the anchor ground (default 0)
  function toLatLon(u, v, up = 0) {
    const xs = u * mpp, ys = -v * mpp, k = (up - ys * U[2]) / Fv[2];
    const e = xs * R[0] + ys * U[0] + k * Fv[0], n = xs * R[1] + ys * U[1] + k * Fv[1], w = xs * R[2] + ys * U[2] + k * Fv[2];
    // ENU -> ECEF
    const X = O[0] - slo * e - sla * clo * n + cla * clo * w;
    const Y = O[1] + clo * e - sla * slo * n + cla * slo * w;
    const Z = O[2] + cla * n + sla * w;
    // ECEF -> geodetic (Bowring, then two refinements)
    const lonr = Math.atan2(Y, X), p = Math.hypot(X, Y);
    let latr = Math.atan2(Z, p * (1 - E2));
    for (let i = 0; i < 3; i++) { const N = A / Math.sqrt(1 - E2 * Math.sin(latr) ** 2); latr = Math.atan2(Z + E2 * N * Math.sin(latr), p); }
    return [latr / D, lonr / D];
  }
  return { toPx, toLatLon };
}
