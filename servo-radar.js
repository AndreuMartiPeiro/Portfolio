/* servo-radar.js — motor numérico de la estación terrena (sin DOM, sin dependencias).
 *
 * Funciona igual en el navegador (objeto global `window.ServoRadar`) y en Node (`module.exports`).
 * Tres bloques:
 *   (a) PASADA ORBITAL kepleriana simple vista desde una estación. Desarrollo PROPIO: no sale de las prácticas.
 *       Supuestos (no fijados por ningún enunciado):
 *         · problema de dos cuerpos puro (sin J2, sin arrastre, sin perturbaciones);
 *         · Tierra esférica de radio RE = 6378,137 km (radio ecuatorial WGS-84), sin achatamiento;
 *         · μ = 398 600,4418 km³/s²; rotación terrestre ωE = 7,2921150e-5 rad/s, opcional;
 *         · marco inercial «ECI» con el eje z en el eje de rotación y ángulo de Greenwich θg(t) = θ0 + ωE·t
 *           (θ0 libre, sin época ni tiempo sidéreo real); sin refracción atmosférica ni aberración.
 *       Validación: periodo 2π√(a³/μ), velocidad angular máxima en el cenit = v_rel/h, rango mínimo = altitud,
 *       simetría de la pasada y contraste con una implementación independiente en Python
 *       (script de verificación local, fuera de este repositorio).
 *   (b) HAZ DE LA ANTENA: diagrama de una apertura circular uniforme (ec. 5–6 de la P4), [2·J1(ka·senθ)/(ka·senθ)]²,
 *       HPBW/FNBW/NLPS y pérdida por error de apuntamiento. Modelo por defecto 'airy' (el diagrama real de la P4,
 *       que es el que da 1,81 dB de ida y vuelta a 0,4125° con la antena de 4 m a 3 GHz); 'gauss' es la
 *       aproximación habitual L = 12,04·(e/θ3dB)² dB por trayecto, que con los mismos datos da 1,89 dB.
 *   (c) ENLACE: ecuación del radar (alcance máximo, horizonte con k = 4/3, alcance efectivo con pérdida de
 *       apuntamiento) y balance de enlace de Friis para la telemetría del satélite.
 *
 * Constantes: c = 3e8 m/s, como en las prácticas y en radar_corregido.py (así λ = 0,100 m exactos a 3 GHz).
 * Unidades: SI en la entrada (m, s, Hz, W, rad) salvo que el nombre diga «Deg»/«dB»; ángulos de salida en grados.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ServoRadar = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  const C = 3e8;
  const MU = 398600.4418e9;     // m³/s²
  const RE = 6378.137e3;        // m
  const WE = 7.2921150e-5;      // rad/s
  const KB_DB = 10 * Math.log10(1.380649e-23); // −228,6 dBW/(K·Hz)
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const X1 = 3.8317059702075123;  // primer cero de J1
  const X2 = 7.015586669815619;   // segundo cero de J1

  // =========================================================================== (a) órbita
  /** Periodo kepleriano [s] de una órbita de semieje mayor a [m]. */
  function periodo(a) { return 2 * Math.PI * Math.sqrt(a * a * a / MU); }

  /** Elementos de una órbita circular a altitud h [m] (ángulos en grados). u0 = argumento de latitud en t = 0. */
  function elementosCirculares(o) {
    return { a: RE + o.h, e: 0, i: (o.iDeg || 0) * D2R, raan: (o.raanDeg || 0) * D2R, argp: 0,
      M0: (o.u0Deg || 0) * D2R };
  }

  /** Estación terrena: latitud/longitud geocéntricas en grados y altura h [m] sobre la esfera. */
  function estacion(o) { return { lat: o.latDeg * D2R, lon: o.lonDeg * D2R, h: o.h || 0 }; }

  function _kepler(M, e) { // E − e·senE = M, con M en (−π, π]
    let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
    for (let i = 0; i < 60; i++) {
      const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= d;
      if (Math.abs(d) < 1e-15) break;
    }
    return E;
  }

  /**
   * Estado inercial en t [s] desde los elementos {a [m], e, i, raan, argp, M0 [rad]}.
   * Devuelve {r:[x,y,z], v:[vx,vy,vz]} en m y m/s.
   */
  function estadoECI(el, t) {
    const n = Math.sqrt(MU / (el.a * el.a * el.a));
    let M = (el.M0 + n * t) % (2 * Math.PI);
    if (M > Math.PI) M -= 2 * Math.PI; else if (M <= -Math.PI) M += 2 * Math.PI;
    const e = el.e || 0;
    const E = _kepler(M, e);
    const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    const p = el.a * (1 - e * e);
    const r = p / (1 + e * Math.cos(nu));
    const xp = r * Math.cos(nu), yp = r * Math.sin(nu);
    const vf = Math.sqrt(MU / p);
    const vxp = -vf * Math.sin(nu), vyp = vf * (e + Math.cos(nu));
    // Q = Rz(raan)·Rx(i)·Rz(argp) aplicada a vectores del plano orbital (z = 0)
    const cO = Math.cos(el.raan), sO = Math.sin(el.raan), ci = Math.cos(el.i), si = Math.sin(el.i);
    const cw = Math.cos(el.argp), sw = Math.sin(el.argp);
    const P = [cO * cw - sO * ci * sw, sO * cw + cO * ci * sw, si * sw];      // primera columna de Q
    const Qv = [-cO * sw - sO * ci * cw, -sO * sw + cO * ci * cw, si * cw];   // segunda columna de Q
    return { r: [P[0] * xp + Qv[0] * yp, P[1] * xp + Qv[1] * yp, P[2] * xp + Qv[2] * yp],
      v: [P[0] * vxp + Qv[0] * vyp, P[1] * vxp + Qv[1] * vyp, P[2] * vxp + Qv[2] * vyp] };
  }

  /**
   * Observación topocéntrica en t [s].
   *   opts.rotacion (true): Tierra en rotación; opts.theta0 [rad]: ángulo de Greenwich en t = 0 (por defecto el.theta0 || 0).
   * Devuelve {t, az, el [°], rango [m], rangoRate [m/s], omega [°/s] (velocidad angular de la línea de vista),
   *   azRate, elRate [°/s], enu:[E,N,U]}. azRate es singular en el cenit (el «keyhole» de un pedestal az/el).
   */
  function observar(el, est, t, opts) {
    const o = opts || {};
    const rot = o.rotacion !== false;
    const th0 = o.theta0 != null ? o.theta0 : (el.theta0 || 0);
    const s = estadoECI(el, t);
    const th = th0 + (rot ? WE * t : 0);
    const c = Math.cos(th), sn = Math.sin(th);
    // ECI → ECEF: Rz(−θ)
    const r = [c * s.r[0] + sn * s.r[1], -sn * s.r[0] + c * s.r[1], s.r[2]];
    let vi = s.v;
    if (rot) vi = [s.v[0] + WE * s.r[1], s.v[1] - WE * s.r[0], s.v[2]]; // v − ωE × r
    const v = [c * vi[0] + sn * vi[1], -sn * vi[0] + c * vi[1], vi[2]];
    const cl = Math.cos(est.lat), sl = Math.sin(est.lat), cL = Math.cos(est.lon), sL = Math.sin(est.lon);
    const Rs = RE + (est.h || 0);
    const d = [r[0] - Rs * cl * cL, r[1] - Rs * cl * sL, r[2] - Rs * sl];
    const E = -sL * d[0] + cL * d[1];
    const N = -sl * cL * d[0] - sl * sL * d[1] + cl * d[2];
    const U = cl * cL * d[0] + cl * sL * d[1] + sl * d[2];
    const vE = -sL * v[0] + cL * v[1];
    const vN = -sl * cL * v[0] - sl * sL * v[1] + cl * v[2];
    const vU = cl * cL * v[0] + cl * sL * v[1] + sl * v[2];
    const rh2 = E * E + N * N, rh = Math.sqrt(rh2);
    const rng = Math.sqrt(rh2 + U * U);
    let az = Math.atan2(E, N) * R2D; if (az < 0) az += 360;
    const cx = N * vU - U * vN, cy = U * vE - E * vU, cz = E * vN - N * vE; // ρ × ρ'
    return {
      t, az, el: Math.atan2(U, rh) * R2D, rango: rng,
      rangoRate: (E * vE + N * vN + U * vU) / rng,
      omega: Math.sqrt(cx * cx + cy * cy + cz * cz) / (rng * rng) * R2D,
      azRate: rh2 > 0 ? (N * vE - E * vN) / rh2 * R2D : NaN,
      elRate: rh > 0 ? (vU * rh2 - U * (E * vE + N * vN)) / (rng * rng * rh) * R2D : NaN,
      enu: [E, N, U],
    };
  }

  /**
   * Pasada: muestrea observar() en [t0, t1] con paso dt y localiza AOS/LOS (el = elMin, refinados por bisección)
   * y TCA (elevación máxima, refinada por sección áurea).
   *   {elem, estacion, t0 = 0, t1, dt = 1, elMin = 0 [°], rotacion = true, theta0}
   * Devuelve {t, az, el, rango, rangoRate, omega, azRate, elRate (arrays), aos, los, tca, elMax, omegaMax,
   *   azRateMax (|.| sobre las muestras visibles)}. aos/los = null si la pasada empieza o acaba fuera del intervalo.
   */
  function pasada(o) {
    const el = o.elem, est = o.estacion, op = { rotacion: o.rotacion, theta0: o.theta0 };
    const t0 = o.t0 || 0, t1 = o.t1, dt = o.dt || 1, elMin = o.elMin || 0;
    const res = { t: [], az: [], el: [], rango: [], rangoRate: [], omega: [], azRate: [], elRate: [] };
    const elDe = (t) => observar(el, est, t, op).el;
    const n = Math.round((t1 - t0) / dt);
    let aos = null, los = null, iMax = 0, omegaMax = 0, azRateMax = 0;
    for (let k = 0; k <= n; k++) {
      const t = t0 + k * dt, ob = observar(el, est, t, op);
      for (const key of ['az', 'el', 'rango', 'rangoRate', 'omega', 'azRate', 'elRate']) res[key].push(ob[key]);
      res.t.push(t);
      if (ob.el > res.el[iMax]) iMax = k;
      if (ob.el >= elMin) {
        omegaMax = Math.max(omegaMax, ob.omega);
        if (isFinite(ob.azRate)) azRateMax = Math.max(azRateMax, Math.abs(ob.azRate));
      }
      if (k > 0) {
        const ea = res.el[k - 1] - elMin, eb = ob.el - elMin;
        if (ea < 0 && eb >= 0 && aos === null) aos = _biseccion((x) => elDe(x) - elMin, t - dt, t);
        if (ea >= 0 && eb < 0 && aos !== null && los === null) los = _biseccion((x) => elDe(x) - elMin, t - dt, t);
      }
    }
    // TCA: cero de la derivada analítica de la elevación alrededor de la muestra de elevación máxima (bisección:
    // precisión de máquina); si no hay cambio de signo (máximo en un extremo o en el cenit, donde elRate no está
    // definida), sección áurea sobre la elevación.
    const tA = Math.max(t0, res.t[iMax] - dt), tB = Math.min(t1, res.t[iMax] + dt);
    const elR = (x) => observar(el, est, x, op).elRate;
    const rA = elR(tA), rB = elR(tB);
    const tca = (rA > 0 && rB < 0) ? _biseccion(elR, tA, tB) : _aurea((x) => -elDe(x), tA, tB);
    return Object.assign(res, { aos, los, tca, elMax: elDe(tca), omegaMax, azRateMax });
  }

  function _biseccion(f, a, b) {
    let fa = f(a);
    for (let i = 0; i < 200 && b - a > 1e-13 * Math.max(1, Math.abs(a), Math.abs(b)); i++) {
      const m = 0.5 * (a + b), fm = f(m);
      if ((fm < 0) === (fa < 0)) { a = m; fa = fm; } else b = m;
    }
    return 0.5 * (a + b);
  }
  function _aurea(f, a, b) { // mínimo de f en [a, b]
    const g = (Math.sqrt(5) - 1) / 2;
    let c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
    for (let i = 0; i < 200 && Math.abs(b - a) > 1e-10 * Math.max(1, Math.abs(a)); i++) {
      if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); }
      else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
    }
    return 0.5 * (a + b);
  }

  // =========================================================================== (b) haz de la antena
  /**
   * J1(x) por Abramowitz–Stegun 9.4.4 (|x| ≤ 3, |ε| < 1,3e-8) y 9.4.6 (|x| > 3, |ε| < 1e-7). Impar.
   */
  function besselJ1(x) {
    const ax = Math.abs(x);
    let r;
    if (ax <= 3) {
      const y = (x / 3) * (x / 3);
      r = x * (0.5 + y * (-0.56249985 + y * (0.21093573 + y * (-0.03954289 + y * (0.00443319 + y * (-0.00031761 + y * 0.00001109))))));
      return r;
    }
    const y = 3 / ax;
    const f1 = 0.79788456 + y * (0.00000156 + y * (0.01659667 + y * (0.00017105 + y * (-0.00249511 + y * (0.00113653 + y * -0.00020033)))));
    const t1 = ax - 2.35619449 + y * (0.12499612 + y * (0.00005650 + y * (-0.00637879 + y * (0.00074348 + y * (0.00079824 + y * -0.00029166)))));
    r = f1 * Math.cos(t1) / Math.sqrt(ax);
    return x < 0 ? -r : r;
  }

  /** Campo normalizado 2·J1(x)/x (límite 1 en x = 0). */
  function jinc(x) {
    if (Math.abs(x) < 1e-4) return 1 - x * x / 8;
    return 2 * besselJ1(x) / x;
  }

  /**
   * Densidad de potencia normalizada del reflector (apertura circular uniforme de radio a [m] a f [Hz]):
   *   plano 'E': [2J1(ka·senθ)/(ka·senθ)]²;  plano 'H': lo mismo por cos²θ (ec. 5–6 de la P4). θ en rad.
   */
  function patronReflector(theta, o) {
    const k = 2 * Math.PI * o.f / C;
    let F = jinc(k * o.a * Math.sin(theta));
    if (o.plano === 'H') F *= Math.cos(theta);
    return F * F;
  }

  /**
   * Parámetros del haz {a, f, plano = 'E', nivel = 0,5 (potencia mitad exacta; 10^(−0,3) para «−3,00 dB»)}:
   *   {hpbw, fnbw, nlps [dB > 0], thetaSec, thetaNulo [°]}. HPBW por bisección sobre el patrón continuo.
   */
  function haz(o) {
    const k = 2 * Math.PI * o.f / C;
    const nivel = o.nivel == null ? 0.5 : o.nivel;
    const thN1 = Math.asin(Math.min(1, X1 / (k * o.a)));
    const thN2 = Math.asin(Math.min(1, X2 / (k * o.a)));
    const P = (t) => patronReflector(t, o);
    const th3 = _biseccion((t) => nivel - P(t), 1e-12, thN1); // P decrece en el lóbulo principal
    const tSec = _aurea((t) => -P(t), thN1, thN2);
    return { hpbw: 2 * th3 * R2D, fnbw: 2 * thN1 * R2D, thetaNulo: thN1 * R2D,
      nlps: -10 * Math.log10(P(tSec)), thetaSec: tSec * R2D };
  }

  /**
   * Pérdida por error de apuntamiento errDeg [°].
   *   {modelo = 'airy' | 'gauss', a, f, plano = 'E' (para 'airy'), hpbwDeg (para 'gauss'; si falta se calcula con a, f)}
   * Devuelve {ida, idaVuelta} en dB (> 0). Ida y vuelta = 2 × ida (radar monoestático: la misma antena en Tx y Rx).
   */
  function perdidaApuntamiento(errDeg, o) {
    let ida;
    if ((o.modelo || 'airy') === 'gauss') {
      const th3 = o.hpbwDeg != null ? o.hpbwDeg : haz({ a: o.a, f: o.f, plano: o.plano }).hpbw;
      ida = 10 * Math.log10(Math.E) * 4 * Math.LN2 * (errDeg / th3) * (errDeg / th3); // ≈ 12,04·(e/θ3)²
    } else {
      ida = -10 * Math.log10(patronReflector(errDeg * D2R, o));
    }
    return { ida, idaVuelta: 2 * ida };
  }

  /** Semáforo del apuntamiento: 'dentro' (|e| ≤ θ3dB/4), 'degradado' (≤ θ3dB/2) o 'fuera'. */
  function clasificarApuntamiento(errDeg, hpbwDeg) {
    const e = Math.abs(errDeg);
    return e <= hpbwDeg / 4 ? 'dentro' : (e <= hpbwDeg / 2 ? 'degradado' : 'fuera');
  }

  // =========================================================================== (c) radar y enlace
  /** Antena parabólica de diámetro D [m], eficiencia eta, frecuencia f [Hz]: {lambda, Aef, G, GdBi}. */
  function ganancia(D, eta, f) {
    const lambda = C / f, Aef = eta * Math.PI * D * D / 4, G = 4 * Math.PI * Aef / (lambda * lambda);
    return { lambda, Aef, G, GdBi: 10 * Math.log10(G) };
  }

  function _lin(v, vDb) { return v != null ? v : (vDb != null ? Math.pow(10, vDb / 10) : 1); }

  /**
   * Potencia recibida del eco [W] a la distancia R [m] (radar monoestático, misma antena):
   *   Pr = Pt·G²·λ²·σ / ((4π)³·R⁴·L).  o = {Pt, G | GdBi, f, sigma, L | LdB}
   */
  function potenciaRadar(R, o) {
    const G = _lin(o.G, o.GdBi), L = _lin(o.L, o.LdB), lam = C / o.f;
    return o.Pt * G * G * lam * lam * o.sigma / (Math.pow(4 * Math.PI, 3) * Math.pow(R, 4) * L);
  }

  /** Alcance máximo [m]: R = [Pt·G²·λ²·σ / ((4π)³·Pmin·L)]^¼.  o = {Pt, G | GdBi, f, sigma, Pmin | PminDbm, L | LdB} */
  function alcanceRadar(o) {
    const G = _lin(o.G, o.GdBi), L = _lin(o.L, o.LdB), lam = C / o.f;
    const Pmin = o.Pmin != null ? o.Pmin : Math.pow(10, o.PminDbm / 10) * 1e-3;
    return Math.pow(o.Pt * G * G * lam * lam * o.sigma / (Math.pow(4 * Math.PI, 3) * Pmin * L), 0.25);
  }

  /**
   * Horizonte radioeléctrico con k = 4/3 para alturas h1, h2 [m]. Devuelve, en km:
   *   nm: 1,23·(√h1[ft] + √h2[ft]) NM → km (la forma del .m);  metrica: 4,12·(√h1 + √h2);
   *   exacta: √(2kRE·h1) + √(2kRE·h2).
   */
  function horizonte(h1, h2) {
    const FT = 3.28084;
    return { nm: 1.23 * (Math.sqrt(h1 * FT) + Math.sqrt(h2 * FT)) * 1.852,
      metrica: 4.12 * (Math.sqrt(h1) + Math.sqrt(h2)),
      exacta: (Math.sqrt(2 * 4 / 3 * RE * h1) + Math.sqrt(2 * 4 / 3 * RE * h2)) / 1e3 };
  }

  /** Alcance efectivo con una pérdida de ida y vuelta LDb: R_ef = R·10^(−L/40) (R ∝ Pr^¼). */
  function alcanceEfectivo(R, LidaVueltaDb) { return R * Math.pow(10, -LidaVueltaDb / 40); }

  /**
   * Balance de enlace de Friis (un trayecto):
   *   o = {Pt [W] | PtDbw, GtDbi, GrDbi, f [Hz], d [m], perdidasDb = 0 (apuntamiento, atmósfera…),
   *        Tsys [K] (opcional), B [Hz] (opcional), sensibilidadDbm (opcional)}
   * Devuelve {lambda, fspl, PrDbw, PrDbm, cn0 [dB·Hz], snr [dB], margen [dB]} (los opcionales, si hay datos).
   */
  function friis(o) {
    const lambda = C / o.f;
    const PtDbw = o.PtDbw != null ? o.PtDbw : 10 * Math.log10(o.Pt);
    const fspl = 20 * Math.log10(4 * Math.PI * o.d / lambda);
    const PrDbw = PtDbw + (o.GtDbi || 0) + (o.GrDbi || 0) - fspl - (o.perdidasDb || 0);
    const out = { lambda, fspl, PrDbw, PrDbm: PrDbw + 30 };
    if (o.Tsys) {
      out.cn0 = PrDbw - KB_DB - 10 * Math.log10(o.Tsys);
      if (o.B) out.snr = out.cn0 - 10 * Math.log10(o.B);
    }
    if (o.sensibilidadDbm != null) out.margen = out.PrDbm - o.sensibilidadDbm;
    return out;
  }

  return { C, MU, RE, WE, periodo, elementosCirculares, estacion, estadoECI, observar, pasada,
    besselJ1, jinc, patronReflector, haz, perdidaApuntamiento, clasificarApuntamiento,
    ganancia, potenciaRadar, alcanceRadar, horizonte, alcanceEfectivo, friis };
});
