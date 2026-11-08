/* servo-actitud.js — control de actitud de un satélite en un eje (sin DOM, sin dependencias).
 *
 * Funciona igual en el navegador (objeto global `window.ServoActitud`) y en Node (`module.exports`).
 * Desarrollo propio (no viene de las prácticas): reutiliza el MISMO PID digital validado en servo-sim.js
 * (mismo orden de cálculo, misma integral trapezoidal, mismas opciones de derivada y anti-windup).
 *
 * Modelo
 *   · Planta: cuerpo rígido en un eje, J·θ'' = τc + τd + τm   (doble integrador).
 *       τc = par del volante de inercia sobre el satélite (acción de control), τd = perturbación externa,
 *       τm = par de los magnetopares (descarga del volante; también es un par externo).
 *     Par constante dentro de cada periodo (ZOH): la discretización es EXACTA,
 *       θ(k+1) = θ(k) + T·ω(k) + T²/(2J)·τ(k),   ω(k+1) = ω(k) + T/J·τ(k).
 *     Sin perturbación ni saturación equivale a zohPlanta(1/J, 0, T) de servo-sim.js (b1 = b2 = T²/2J).
 *   · Volante: el par que da al satélite sale de su momento angular, h_w(k+1) = h_w(k) − T·τc(k).
 *       Saturación de par |τc| ≤ τmax y de momento |h_w| ≤ hmax: el par de cada muestra se recorta para que
 *       h_w no salga de ±hmax al final del periodo (con el volante lleno solo puede dar par «de vaciado»).
 *       Se conserva el momento total: J·ω + h_w = H0 + Σ (τd + τm)·T (lo comprueban las pruebas).
 *   · Descarga (opcional): τm(k) = clamp(−kDes·h_w(k), ±τmMax). Con el satélite quieto, dh_w/dt = τd + τm,
 *       así que τm frena el volante y el lazo de actitud absorbe τm como una perturbación más.
 *   · PID digital posicional (idéntico a servo-sim.js §4.4, sin retardo extra):
 *       y(k) = θ(k) (se mide primero),  e(k) = r(k) − y(k)
 *       uI(k) = uI(k−1) + KI·T/2·(e(k) + e(k−1))
 *       uD(k) = KD/T·(e(k) − e(k−1))  (derivada del error)   o   −KD/T·(y(k) − y(k−1))  (de la salida, por defecto:
 *               en actitud la derivada sale del giróscopo y no debe dar «kick» al mandar un escalón de ángulo)
 *       τc(k) = clamp(KP·e(k) + uI(k) + uD(k), límites de par y de momento)
 *       Anti-windup 'acotar' (|uI| ≤ uImax) o 'congelar' (si τc satura, uI no se actualiza en esa muestra).
 *     Historia previa: el satélite estaba en reposo en θ0 con r = θ0, es decir e(−1) = 0, y(−1) = θ0, uI(−1) = 0.
 *     Con θ0 = 0 coincide muestra a muestra con ServoSim.simular.
 *
 * Parámetros por defecto (SAT): microsatélite de clase 50 kg, órbita LEO de 500 km.
 *   · J = 2 kg·m²: cubo homogéneo de 50 kg y 0,5 m de lado → m·a²/6 = 2,08 kg·m², redondeado.
 *   · Volante: τmax = 10 mN·m y hmax = 0,1 N·m·s, orden de magnitud de los volantes de microsatélite
 *     (valores representativos, no un modelo comercial concreto).
 *   · τd = 1 µN·m: gradiente gravitatorio a 500 km con ΔI = 0,5 kg·m² (25 % de J) y 45° de desalineación,
 *     3μ/(2R³)·ΔI·sin 2θ = 0,92 µN·m (parGradienteGravitatorio), más arrastre residual del mismo orden o menor
 *     (ρ ≈ 5e-13 kg/m³, Cd = 2,2, A = 0,25 m², brazo 5 cm → 0,4 µN·m). Se redondea a 1 µN·m y se trata como constante.
 *   · Magnetopares: τmMax = 50 µN·m (dipolo 2 A·m² × campo 25 µT); kDes = 1e-3 1/s (constante de 1000 s).
 *   · Lazo: T = 0,1 s (10 Hz, típico de un ADCS); PD por asignación de polos ωn = 0,1 rad/s, ζ = 0,7:
 *     KP = J·ωn² = 0,02 N·m/rad, KD = 2ζωn·J = 0,28 N·m·s/rad (ωn·T = 0,01: casi continuo).
 * Unidades SI: θ en rad, ω en rad/s, τ en N·m, h en N·m·s, t = k·T en s.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ServoActitud = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  const MU = 3.986004418e14;   // m³/s² (el mismo μ que servo-radar.js)
  const RT = 6378137;          // m, radio ecuatorial

  const SAT = Object.freeze({
    J: 2.0, T: 0.1, tauMax: 0.01, hMax: 0.1, tauD: 1e-6, tauMMax: 5e-5, kDes: 1e-3,
    wn: 0.1, zeta: 0.7, altitud: 500e3,
  });

  // ------------------------------------------------------------------ diseño y fórmulas continuas
  /** PD por asignación de polos para J·θ'' = τ: KP = J ωn², KD = 2 ζ ωn J. */
  function disenoPD(J, wn, zeta) { return { KP: J * wn * wn, KD: 2 * zeta * wn * J }; }

  /** Inverso: ωn = √(KP/J), ζ = KD / (2 √(KP·J)). */
  function parametrosPD(J, KP, KD) { return { wn: Math.sqrt(KP / J), zeta: KD / (2 * Math.sqrt(KP * J)) }; }

  /** Respuesta continua al escalón unitario de ωn²/(s² + 2ζωn s + ωn²) (sub, crítico y sobreamortiguado). */
  function escalonSegundoOrden(wn, zeta, t) {
    if (t <= 0) return 0;
    if (zeta < 1) {
      const wd = wn * Math.sqrt(1 - zeta * zeta), s = zeta / Math.sqrt(1 - zeta * zeta);
      return 1 - Math.exp(-zeta * wn * t) * (Math.cos(wd * t) + s * Math.sin(wd * t));
    }
    if (zeta === 1) return 1 - Math.exp(-wn * t) * (1 + wn * t);
    const q = wn * Math.sqrt(zeta * zeta - 1), p1 = -zeta * wn + q, p2 = -zeta * wn - q;
    return 1 + (p2 * Math.exp(p1 * t) - p1 * Math.exp(p2 * t)) / (p1 - p2);
  }

  // ------------------------------------------------------------------ perturbaciones
  /** Par de gradiente gravitatorio en órbita circular: 3μ/(2R³)·ΔI·sin(2θ) [N·m]. */
  function parGradienteGravitatorio(altitud, dI, theta) {
    const R = RT + altitud;
    return 1.5 * MU / (R * R * R) * dI * Math.sin(2 * theta);
  }

  // ------------------------------------------------------------------ referencias
  /** Escalón de ángulo: r(k) = θf (desde k = 0). */
  function escalon(N, thetaF) { return new Array(N).fill(thetaF); }

  /** Apuntamiento con límite de velocidad: rampa a ωmax desde θ0 hasta θf y después constante. */
  function perfilApuntamiento(N, T, thetaF, omegaMax, theta0) {
    const t0 = theta0 || 0, d = thetaF - t0, sg = d >= 0 ? 1 : -1, r = new Array(N);
    for (let k = 0; k < N; k++) r[k] = t0 + sg * Math.min(Math.abs(d), omegaMax * k * T);
    return r;
  }

  // ------------------------------------------------------------------ simulación
  /**
   * simular(opts)
   *   J, T                 inercia [kg·m²] y periodo [s]   (por defecto SAT)
   *   KP, KI, KD           ganancias (N·m/rad, N·m/(rad·s), N·m·s/rad)
   *   ref                  array r(k) o función k → r(k);  N nº de muestras (por defecto ref.length)
   *   theta0, omega0, h0   estado inicial (0 por defecto)
   *   tauMax, hMax         límites del volante (Infinity = sin saturación; por defecto Infinity)
   *   tauD                 perturbación: número constante o función (k, t) → τd   (0 por defecto)
   *   descarga             null | {kDes, tauMMax}  magnetopares
   *   antiWindup           'ninguno' | 'acotar' | 'congelar';  uImax  límite de |uI| para 'acotar'
   *   derivada             'salida' (por defecto, giróscopo) | 'error'
   * Devuelve {t, r, theta, omega, u (par del volante), tauD, tauM, h (volante), e, uI, satPar, satH, N}
   * con theta/omega/h en el instante k·T y u, tauD, tauM aplicados durante [kT, (k+1)T).
   */
  function simular(o) {
    const J = o.J != null ? o.J : SAT.J, T = o.T != null ? o.T : SAT.T;
    if (!(J > 0) || !(T > 0)) throw new Error('simular: J y T deben ser > 0');
    const KP = +o.KP || 0, KI = +o.KI || 0, KD = +o.KD || 0;
    const refFn = typeof o.ref === 'function' ? o.ref : (k) => o.ref[k];
    const N = o.N != null ? o.N : (Array.isArray(o.ref) ? o.ref.length : 0);
    const tauMax = o.tauMax != null ? o.tauMax : Infinity, hMax = o.hMax != null ? o.hMax : Infinity;
    const hayLimite = isFinite(tauMax) || isFinite(hMax);
    const dFn = typeof o.tauD === 'function' ? o.tauD : (() => { const c = +o.tauD || 0; return () => c; })();
    const des = o.descarga || null;
    const aw = o.antiWindup || 'ninguno', uImax = o.uImax;
    const dSalida = o.derivada !== 'error';
    const t = new Array(N), r = new Array(N), th = new Array(N), om = new Array(N), u = new Array(N), td = new Array(N),
      tm = new Array(N), h = new Array(N), e = new Array(N), uIh = new Array(N), sP = new Array(N), sH = new Array(N);
    let x = o.theta0 || 0, w = o.omega0 || 0, hw = o.h0 || 0, uI = 0, yAnt = x, eAnt = 0;
    const a2 = T * T / (2 * J), a1 = T / J;
    for (let k = 0; k < N; k++) {
      t[k] = k * T; th[k] = x; om[k] = w; h[k] = hw;
      r[k] = refFn(k);
      e[k] = r[k] - x;
      let uIn = uI + KI * T / 2 * (e[k] + eAnt);
      if (aw === 'acotar' && uImax != null) uIn = Math.min(Math.max(uIn, -uImax), uImax);
      const uD = dSalida ? -KD / T * (x - yAnt) : KD / T * (e[k] - eAnt);
      const v = KP * e[k] + uIn + uD;
      // límites de la muestra: par y momento (h_w − T·τ ∈ [−hMax, hMax])
      const loH = (hw - hMax) / T, hiH = (hw + hMax) / T;
      let us = Math.min(Math.max(v, -tauMax), tauMax);
      sP[k] = us !== v;
      const usH = Math.min(Math.max(us, loH), hiH);
      sH[k] = usH !== us;
      us = usH;
      if (!(aw === 'congelar' && hayLimite && us !== v)) uI = uIn;
      u[k] = us; uIh[k] = uI;
      td[k] = dFn(k, t[k]);
      tm[k] = des ? Math.min(Math.max(-des.kDes * hw, -des.tauMMax), des.tauMMax) : 0;
      const tau = us + td[k] + tm[k];
      yAnt = x; eAnt = e[k];
      x = x + T * w + a2 * tau;
      w = w + a1 * tau;
      hw = hw - T * us;
    }
    return { t, r, theta: th, omega: om, u, tauD: td, tauM: tm, h, e, uI: uIh, satPar: sP, satH: sH, N, J, T };
  }

  // ------------------------------------------------------------------ métricas
  /**
   * metricas(sim, tol = 0,02) — con θf = r(N−1) y A = θf − θ(0):
   *   pico, sobreosc [%] = (pico − θf)/A·100 (pico en el sentido de la maniobra), t_pico,
   *   ts [s] = (último índice fuera de ±tol·|A| + 1)·T (Infinity si no se establece; 0 si nunca sale),
   *   e_reg = e(N−1), parPico = máx|τc|, omegaPico = máx|ω|, hPico = máx|h_w|, hFin = h_w(N−1),
   *   tSatPar / tSatH = primer instante con el par / el momento del volante saturado (null si nunca).
   * Mismas convenciones que ServoSim.metricas.
   */
  function metricas(s, tol) {
    const tl = tol == null ? 0.02 : tol, n = s.theta.length, T = s.T;
    const thF = s.r[n - 1], A = thF - s.theta[0], sg = A >= 0 ? 1 : -1;
    let iMax = 0, ultimoFuera = -1, parPico = 0, omegaPico = 0, hPico = 0, kP = null, kH = null;
    for (let k = 0; k < n; k++) {
      if (sg * s.theta[k] > sg * s.theta[iMax]) iMax = k;
      if (Math.abs(s.theta[k] - thF) > tl * Math.abs(A)) ultimoFuera = k;
      parPico = Math.max(parPico, Math.abs(s.u[k]));
      omegaPico = Math.max(omegaPico, Math.abs(s.omega[k]));
      hPico = Math.max(hPico, Math.abs(s.h[k]));
      if (kP === null && s.satPar[k]) kP = k;
      if (kH === null && s.satH[k]) kH = k;
    }
    let ts = ultimoFuera >= 0 ? (ultimoFuera + 1) * T : 0;
    if (ultimoFuera === n - 1) ts = Infinity;
    return { pico: s.theta[iMax], sobreosc: A !== 0 ? (s.theta[iMax] - thF) / A * 100 : 0, t_pico: iMax * T, ts,
      e_reg: s.e[n - 1], parPico, omegaPico, hPico, hFin: s.h[n - 1],
      tSatPar: kP === null ? null : kP * T, tSatH: kH === null ? null : kH * T };
  }

  /** Momento angular total J·ω(k) + h_w(k) (se conserva salvo los pares externos τd y τm). */
  function momentoTotal(s) { return s.omega.map((w, k) => s.J * w + s.h[k]); }

  // ------------------------------------------------------------------ enlace con la misión
  /**
   * Aceleración angular máxima de la línea de vista en un sobrevuelo rectilíneo a velocidad v y distancia mínima d:
   * ω(t) = ω0/(1 + (v t/d)²) con ω0 = v/d  →  |dω/dt|máx = 3√3/8 · ω0² (en v·t/d = 1/√3). Cota para una pasada cenital.
   */
  function alfaSobrevuelo(omegaMax) { return 3 * Math.sqrt(3) / 8 * omegaMax * omegaMax; }

  /** Máximo de |dω/dt| por diferencias centradas de una serie muestreada (p. ej. la pasada de servo-radar.js). */
  function alfaDeSerie(t, omega) {
    let m = 0;
    for (let k = 1; k < t.length - 1; k++) m = Math.max(m, Math.abs((omega[k + 1] - omega[k - 1]) / (t[k + 1] - t[k - 1])));
    return m;
  }

  /**
   * requisitoSeguimiento({omegaMax [rad/s], alfaMax?, J, tauMax, hMax, tauD, duracion [s]})
   * Para que el satélite apunte a la estación durante el paso su cuerpo debe girar con la línea de vista (la misma
   * velocidad angular que ve la antena de tierra, salvo la rotación terrestre ≈ 7e-5 rad/s). El volante tiene que:
   *   · dar el par   τ = J·αmáx + |τd|           (αmáx = alfaSobrevuelo(ωmáx) si no se da)
   *   · almacenar    h = J·ωmáx + |τd|·duracion   (el momento del cuerpo más lo acumulado por la perturbación)
   * Devuelve {alfaMax, parNecesario, momentoNecesario, margenPar = τmax/τ, margenMomento = hmax/h, parOk, momentoOk,
   *   ok, tHastaSaturar = (hmax − J·ωmáx)/|τd| (s; Infinity sin perturbación)}.
   * Supuestos: eje único, sin acoplamiento giroscópico, volante con momento inicial nulo.
   */
  function requisitoSeguimiento(o) {
    const J = o.J != null ? o.J : SAT.J, tauMax = o.tauMax != null ? o.tauMax : SAT.tauMax;
    const hMax = o.hMax != null ? o.hMax : SAT.hMax, tauD = Math.abs(o.tauD != null ? o.tauD : SAT.tauD);
    const w = Math.abs(o.omegaMax), dur = o.duracion || 0;
    const alfaMax = o.alfaMax != null ? Math.abs(o.alfaMax) : alfaSobrevuelo(w);
    const parNecesario = J * alfaMax + tauD, momentoNecesario = J * w + tauD * dur;
    const parOk = parNecesario <= tauMax, momentoOk = momentoNecesario <= hMax;
    return { alfaMax, parNecesario, momentoNecesario, margenPar: tauMax / parNecesario,
      margenMomento: hMax / momentoNecesario, parOk, momentoOk, ok: parOk && momentoOk,
      tHastaSaturar: tauD > 0 ? (hMax - J * w) / tauD : Infinity };
  }

  return { SAT, MU, RT, disenoPD, parametrosPD, escalonSegundoOrden, parGradienteGravitatorio, escalon,
    perfilApuntamiento, simular, metricas, momentoTotal, alfaSobrevuelo, alfaDeSerie, requisitoSeguimiento };
});
