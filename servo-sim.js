/* servo-sim.js — motor numérico del lazo de seguimiento (sin DOM, sin dependencias).
 *
 * Funciona igual en el navegador (objeto global `window.ServoSim`) y en Node (`module.exports`).
 *
 * Modelo (versión CORREGIDA de la P1 de CySC):
 *   · Planta G(s) = K / [s (s + a)] discretizada por ZOH analítico con el MISMO periodo T que el regulador.
 *       G(z) = (b1 z + b2) / (z² − (1 + p) z + p),  p = e^(−aT)
 *       b1 = K/a² · (aT − 1 + p),  b2 = K/a² · (1 − p − aT·p)
 *     (coincide con scipy.signal.cont2discrete(..., 'zoh') / c2d(...,'zoh'); para aT < 0,1 se usan las series
 *      de Taylor para evitar la cancelación de (aT − 1 + p)).
 *   · PID digital posicional del §4.4 del guion, SIN retardo extra y desde k = 0:
 *       y(k)  = −a1 y(k−1) − a2 y(k−2) + b1 u(k−1) + b2 u(k−2)        (primero la salida: planta estrictamente propia)
 *       e(k)  = r(k) − y(k)
 *       uI(k) = uI(k−1) + KI·T/2·(e(k) + e(k−1))                       (integral trapezoidal)
 *       uD(k) = KD/T·(e(k) − e(k−1))          derivada del error  (con «derivative kick»)
 *             = −KD/T·(y(k) − y(k−1))         derivada de la salida (sin kick)
 *       u(k)  = clamp(KP e(k) + uI(k) + uD(k), Umin, Umax)            (sin el «−U_MIN» erróneo del .m)
 *     Condiciones iniciales nulas: y(−1) = y(−2) = u(−1) = u(−2) = e(−1) = 0, uI(−1) = 0.
 *   · Anti-windup: 'acotar' (uI recortada a ±uImax) o 'congelar' (si u satura, uI no se actualiza en esa muestra;
 *     la u de esa muestra se calcula con la integral tentativa, igual que `pid()` de p1_pid_corregido.py).
 *
 * Parámetros del guion de la P1: KT = 7,55086e-2, KT·KE = 5,6933e-3, Ra·J = 0,010854 (el valor impreso en
 * Gm(s); el J de la tabla, 4,7281e-5, NO reproduce las Fig. 20–22) y T = 0,0625 s.
 * Unidades: y en rad, u en V, t = k·T en s.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ServoSim = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  // ------------------------------------------------------------------ parámetros de las plantas
  const P1 = Object.freeze({ KT: 7.55086e-2, KTKE: 5.6933e-3, RaJ: 0.010854, T: 0.0625 });

  // Pedestal del radar (problema_radar_matlab.m): lazo Km / [s (0,1 s + 1)] = 10·Km / [s (s + 10)].
  // Se modela como planta K = 10, a = 10 y un regulador P con KP = Km. ξ = 0,6 → ωn = 10/(2ξ), Km = ωn²/10.
  const PEDESTAL = Object.freeze({ K: 10, a: 10, xi: 0.6, wn: 10 / 1.2, Km: (10 / 1.2) * (10 / 1.2) / 10 });

  // ------------------------------------------------------------------ ZOH analítico
  // f1(x) = x − 1 + e^(−x) = Σ_{n≥2} (−x)^n / n!      f2(x) = 1 − e^(−x)(1 + x) = Σ_{n≥2} (−1)^n (n−1) x^n / n!
  function _f1f2(x) {
    if (x < 0.1) {
      let s1 = 0, s2 = 0, term = x; // term = x^n / n!
      for (let n = 2; n <= 30; n++) {
        term *= x / n;
        const sg = n % 2 === 0 ? 1 : -1;
        s1 += sg * term;
        s2 += sg * (n - 1) * term;
      }
      return [s1, s2];
    }
    const p = Math.exp(-x);
    return [x + Math.expm1(-x), -Math.expm1(-x) - x * p];
  }

  /** ZOH de G(s) = K/[s(s+a)] con periodo T. Devuelve {b:[0,b1,b2], a:[1,a1,a2], polos:[1,p], K, aCont, T}. */
  function zohPlanta(K, a, T) {
    if (!(T > 0)) throw new Error('zohPlanta: T debe ser > 0');
    if (a === 0) { // doble integrador K/s²: b1 = b2 = K T²/2, polos dobles en 1
      const g = K * T * T / 2;
      return { b: [0, g, g], a: [1, -2, 1], polos: [1, 1], K, aCont: 0, T };
    }
    const x = a * T;
    const p = Math.exp(-x);
    const [f1, f2] = _f1f2(x);
    const k = K / (a * a);
    return { b: [0, k * f1, k * f2], a: [1, -(1 + p), p], polos: [1, p], K, aCont: a, T };
  }

  /** Planta del servo de la P1: Gm(s) = KT / (RaJ s² + KTKE s) → K = KT/RaJ, a = KTKE/RaJ. */
  function plantaP1(T, RaJ) {
    const raj = RaJ == null ? P1.RaJ : RaJ;
    return zohPlanta(P1.KT / raj, P1.KTKE / raj, T == null ? P1.T : T);
  }

  /** Planta del pedestal del radar (K = 10, a = 10) al periodo T. */
  function plantaPedestal(T) { return zohPlanta(PEDESTAL.K, PEDESTAL.a, T); }

  // ------------------------------------------------------------------ referencias
  function escalon(N, A) { return new Array(N).fill(A == null ? 1 : A); }
  function rampa(N, T, omega) { const r = new Array(N); for (let k = 0; k < N; k++) r[k] = omega * k * T; return r; }
  /** Onda cuadrada que empieza en `alto` y alterna cada `semiperiodo` muestras (en la P1: 0/10, 100 muestras). */
  function cuadrada(N, alto, semiperiodo, bajo) {
    const lo = bajo == null ? 0 : bajo, r = new Array(N);
    for (let k = 0; k < N; k++) r[k] = Math.floor(k / semiperiodo) % 2 === 0 ? alto : lo;
    return r;
  }

  // ------------------------------------------------------------------ simulación del lazo
  /**
   * simular(opts)
   *   planta   {b:[0,b1,b2], a:[1,a1,a2]}  (de zohPlanta / plantaP1 / plantaPedestal)
   *   T        periodo [s] (el mismo de la planta)
   *   KP, KI, KD   ganancias (KI en 1/s, KD en s)
   *   ref      array r(k) o función k → r(k);  N  nº de muestras (por defecto ref.length)
   *   sat      null | {min, max}            saturación del actuador
   *   antiWindup  'ninguno' | 'acotar' | 'congelar'   ('congelar' solo actúa si hay saturación)
   *   uImax    límite de |uI| para 'acotar'
   *   derivada 'error' (con kick) | 'salida' (sin kick)
   *   limite   opcional: si |y| > limite se corta la simulación (lazos inestables); se devuelve divergeEn = k
   * Devuelve {t, r, y, u, e, uI, N, divergeEn}. uI(k) es la integral YA aceptada en la muestra k.
   */
  function simular(o) {
    const pl = o.planta, T = o.T;
    if (!pl || !(T > 0)) throw new Error('simular: faltan planta o T');
    const b1 = pl.b[1], b2 = pl.b[2], a1 = pl.a[1], a2 = pl.a[2];
    const KP = +o.KP || 0, KI = +o.KI || 0, KD = +o.KD || 0;
    const refFn = typeof o.ref === 'function' ? o.ref : (k) => o.ref[k];
    const N = o.N != null ? o.N : (Array.isArray(o.ref) ? o.ref.length : 0);
    const sat = o.sat || null;
    const aw = o.antiWindup || 'ninguno';
    const uImax = o.uImax;
    const dSalida = o.derivada === 'salida';
    const limite = o.limite;
    const t = new Array(N), r = new Array(N), y = new Array(N), u = new Array(N), e = new Array(N), uIh = new Array(N);
    let uI = 0, divergeEn = null, Nef = N;
    for (let k = 0; k < N; k++) {
      const y1 = k >= 1 ? y[k - 1] : 0, y2 = k >= 2 ? y[k - 2] : 0;
      const u1 = k >= 1 ? u[k - 1] : 0, u2 = k >= 2 ? u[k - 2] : 0;
      t[k] = k * T;
      r[k] = refFn(k);
      y[k] = -a1 * y1 - a2 * y2 + b1 * u1 + b2 * u2;
      e[k] = r[k] - y[k];
      const eAnt = k >= 1 ? e[k - 1] : 0;
      let uIn = uI + KI * T / 2 * (e[k] + eAnt);
      if (aw === 'acotar' && uImax != null) uIn = Math.min(Math.max(uIn, -uImax), uImax);
      const uD = dSalida ? -KD / T * (y[k] - y1) : KD / T * (e[k] - eAnt);
      const v = KP * e[k] + uIn + uD;
      const us = sat ? Math.min(Math.max(v, sat.min), sat.max) : v;
      if (!(aw === 'congelar' && sat && us !== v)) uI = uIn;
      u[k] = us;
      uIh[k] = uI;
      if (limite != null && !(Math.abs(y[k]) <= limite)) { divergeEn = k; Nef = k + 1; break; }
    }
    if (Nef < N) { for (const arr of [t, r, y, u, e, uIh]) arr.length = Nef; }
    return { t, r, y, u, e, uI: uIh, N: Nef, divergeEn };
  }

  // ------------------------------------------------------------------ métricas (idénticas a metricas() de Python)
  /**
   * metricas(y, u, ref, T, tol = 0,02) → {pico, sobreosc [%], t_pico [s], ts2 [s] (Infinity si no se establece),
   *   u0, umax, y_fin}.  ts = (último índice fuera de la banda ±tol·|ref| + 1)·T; t_pico = primer máximo.
   */
  function metricas(y, u, ref, T, tol) {
    const tl = tol == null ? 0.02 : tol;
    let iMax = 0, ultimoFuera = -1, umax = 0;
    for (let k = 0; k < y.length; k++) {
      if (y[k] > y[iMax]) iMax = k;
      if (Math.abs(y[k] - ref) > tl * Math.abs(ref)) ultimoFuera = k;
      if (u && Math.abs(u[k]) > umax) umax = Math.abs(u[k]);
    }
    let ts = ultimoFuera >= 0 ? (ultimoFuera + 1) * T : 0;
    if (ultimoFuera === y.length - 1) ts = Infinity;
    return { pico: y[iMax], sobreosc: (y[iMax] - ref) / ref * 100, t_pico: iMax * T, ts2: ts,
      u0: u ? u[0] : NaN, umax, y_fin: y[y.length - 1] };
  }

  // ------------------------------------------------------------------ polinomios y raíces
  function polyMul(p, q) { // coeficientes de mayor a menor grado
    const r = new Array(p.length + q.length - 1).fill(0);
    for (let i = 0; i < p.length; i++) for (let j = 0; j < q.length; j++) r[i + j] += p[i] * q[j];
    return r;
  }
  function polyAdd(p, q) {
    const n = Math.max(p.length, q.length), r = new Array(n).fill(0);
    for (let i = 0; i < p.length; i++) r[n - p.length + i] += p[i];
    for (let i = 0; i < q.length; i++) r[n - q.length + i] += q[i];
    return r;
  }
  function polyScale(p, s) { return p.map((c) => c * s); }

  /**
   * Raíces de un polinomio real (coeficientes de mayor a menor grado) por Aberth–Ehrlich.
   * Devuelve [[re, im], ...]. Pensado para grado ≤ 6 (lazos de este motor: grado ≤ 4).
   */
  function raices(coef) {
    let c = coef.slice();
    while (c.length > 1 && c[0] === 0) c.shift();
    const out = [];
    while (c.length > 1 && c[c.length - 1] === 0) { out.push([0, 0]); c.pop(); } // raíces en 0 exactas
    const n = c.length - 1;
    if (n < 1) return out;
    const lead = c[0];
    c = c.map((v) => v / lead);
    if (n === 1) { out.push([-c[1], 0]); return out; }
    if (n === 2) {
      const B = c[1], C = c[2], d = B * B - 4 * C;
      if (d >= 0) { const q = -0.5 * (B + Math.sign(B || 1) * Math.sqrt(d)); out.push([q, 0], [C / q, 0]); }
      else { out.push([-B / 2, Math.sqrt(-d) / 2], [-B / 2, -Math.sqrt(-d) / 2]); }
      return out;
    }
    // cota de Cauchy para los valores iniciales
    let R = 0; for (let i = 1; i <= n; i++) R = Math.max(R, Math.abs(c[i]));
    R = 1 + R;
    let z = [];
    for (let k = 0; k < n; k++) { const ang = 2 * Math.PI * k / n + 0.4; z.push([0.5 * R * Math.cos(ang), 0.5 * R * Math.sin(ang)]); }
    const cmul = (x, y) => [x[0] * y[0] - x[1] * y[1], x[0] * y[1] + x[1] * y[0]];
    const cdiv = (x, y) => { const d = y[0] * y[0] + y[1] * y[1]; return [(x[0] * y[0] + x[1] * y[1]) / d, (x[1] * y[0] - x[0] * y[1]) / d]; };
    const evalP = (x) => { // Horner de p y p'
      let p = [c[0], 0], dp = [0, 0];
      for (let i = 1; i <= n; i++) { dp = [dp[0] * 1, dp[1] * 1]; dp = cmul(dp, x); dp = [dp[0] + p[0], dp[1] + p[1]]; p = cmul(p, x); p = [p[0] + c[i], p[1]]; }
      return [p, dp];
    };
    for (let it = 0; it < 500; it++) {
      let maxPaso = 0;
      const zn = z.slice();
      for (let k = 0; k < n; k++) {
        const [p, dp] = evalP(z[k]);
        if (p[0] === 0 && p[1] === 0) continue;
        const ratio = cdiv(p, dp); // p/p'
        let s = [0, 0];
        for (let j = 0; j < n; j++) if (j !== k) {
          const d = [z[k][0] - z[j][0], z[k][1] - z[j][1]];
          const inv = cdiv([1, 0], d); s = [s[0] + inv[0], s[1] + inv[1]];
        }
        const den = [1 - (ratio[0] * s[0] - ratio[1] * s[1]), -(ratio[0] * s[1] + ratio[1] * s[0])];
        const w = cdiv(ratio, den);
        zn[k] = [z[k][0] - w[0], z[k][1] - w[1]];
        maxPaso = Math.max(maxPaso, Math.hypot(w[0], w[1]) / Math.max(1, Math.hypot(zn[k][0], zn[k][1])));
      }
      z = zn;
      if (maxPaso < 1e-15) break;
    }
    return out.concat(z.map((v) => [v[0], Math.abs(v[1]) < 1e-12 * Math.max(1, Math.abs(v[0])) ? 0 : v[1]]));
  }

  /**
   * Polinomio característico del lazo cerrado 1 + C(z)·G(z) = 0, YA SIMPLIFICADO:
   *   C(z) = KP + KI·T/2·(z+1)/(z−1) + KD/T·(z−1)/z.
   *   · KI ≠ 0, KD ≠ 0: Cd = (z−1)z.  · KI = 0: Cd = z (sin el polo en 1).  · KD = 0: Cd = (z−1).  · P puro: Cd = 1.
   * (radio_espectral() de p1_pid_corregido.py no simplifica: con KI = KD = 0 deja raíces espurias en 1 y 0 y da
   *  ρ = 1 en un lazo estable. En la P1 siempre hay KI y KD, así que allí no afecta.)
   * La derivada de la salida no cambia los polos (solo el camino de la referencia).
   */
  function polinomioCaracteristico(planta, KP, KI, KD, T) {
    const zm1 = [1, -1], z = [1, 0], zp1 = [1, 1];
    let Cn, Cd;
    if (KI !== 0 && KD !== 0) {
      Cd = polyMul(zm1, z);
      Cn = polyAdd(polyAdd(polyScale(polyMul(zm1, z), KP), polyScale(polyMul(zp1, z), KI * T / 2)), polyScale(polyMul(zm1, zm1), KD / T));
    } else if (KI !== 0) {
      Cd = zm1; Cn = polyAdd(polyScale(zm1, KP), polyScale(zp1, KI * T / 2));
    } else if (KD !== 0) {
      Cd = z; Cn = polyAdd(polyScale(z, KP), polyScale(zm1, KD / T));
    } else { Cd = [1]; Cn = [KP]; }
    return polyAdd(polyMul(Cd, planta.a), polyMul(Cn, planta.b));
  }

  /** Radio espectral (máximo |polo|) del lazo cerrado. ρ < 1 ⇔ estable. */
  function radioEspectral(planta, KP, KI, KD, T) {
    const r = raices(polinomioCaracteristico(planta, KP, KI, KD, T));
    return r.reduce((m, v) => Math.max(m, Math.hypot(v[0], v[1])), 0);
  }

  // ------------------------------------------------------------------ fórmulas de 2.º orden (continuo)
  /** Fórmulas estándar de un 2.º orden subamortiguado: Mp [%], tp, tr, ts(2 %) = 4/(ξωn), ts(5 %) = 3/(ξωn). */
  function segundoOrden(wn, xi) {
    const wd = wn * Math.sqrt(1 - xi * xi);
    return { wd, Mp: 100 * Math.exp(-Math.PI * xi / Math.sqrt(1 - xi * xi)), tp: Math.PI / wd,
      tr: (Math.PI - Math.acos(xi)) / wd, ts2: 4 / (xi * wn), ts5: 3 / (xi * wn) };
  }

  return { P1, PEDESTAL, zohPlanta, plantaP1, plantaPedestal, escalon, rampa, cuadrada, simular, metricas,
    polinomioCaracteristico, radioEspectral, raices, segundoOrden };
});
