/**
 * servo-view.js — Vista del proyecto «Seguimiento de un satélite de órbita baja desde una estación terrena».
 *
 * Fase 1 (núcleo): una sola vista con recorrido por pasos y un panel de misión con parámetros compartidos.
 *   Paso 1  Pasada orbital ............ desarrollo propio (órbita kepleriana circular, servo-radar.js)
 *   Paso 2  Pedestal de seguimiento ... Práctica 1 (PID digital corregido, servo-sim.js)
 *   Paso 3  Haz y pérdida ............. Práctica 4 (diagrama del reflector) + acoplamiento propio
 *   Paso 4  Enlace .................... problema del radar (ecuación del radar) + Friis (propio)
 * Cambiar la altitud o la elevación máxima recalcula la pasada y, con ella, todos los pasos.
 *
 * Depende de window.ServoSim (servo-sim.js), window.ServoRadar (servo-radar.js) y Plotly.
 * Expone window.SERVO_FASES y window.renderServoFase(id, contenedor), que usa el router de app.js.
 * Los colores de las gráficas se leen de los tokens de :root (styles.css); no hay colores escritos a mano.
 */
(function () {
  'use strict';

  const S = window.ServoSim, R = window.ServoRadar;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  window.SERVO_FASES = [
    { id: 'seguimiento', label: 'Seguimiento y enlace' },
    { id: 'telemetria', label: 'Telemetría', pending: true },
    { id: 'actitud', label: 'Control de actitud', pending: true }
  ];

  // ------------------------------------------------------------------ datos fijos
  const EST = { latDeg: 38.385, lonDeg: -0.514 };      // estación de ejemplo (San Vicente del Raspeig)
  const INC = 97.6;                                    // inclinación de la órbita [°]
  const EL_MIN = 5;                                    // máscara de elevación [°]
  const ETA = 0.65;                                    // eficiencia de la antena
  const RADAR = { Pt: 50e3, sigma: 15, Pmin: 1e-13, LdB: 6, h1: 30, h2: 3000 };
  const TM = { GtDbi: 0, Tsys: 290, B: 1e6, snrMin: 10 };
  const T_LIST = [0.001, 0.005, 0.01, 0.02, 0.05, 0.0625];
  const T_MIN_PASADA = 0.005;
  const Km = S ? S.PEDESTAL.Km : 6.944;

  const SERVO_BASE = { planta: 'pedestal', T: 0.01, KP: Km, KI: 0, KD: 0, ref: 'pasada', eje: 'az', omega0: 0.05,
    sat: false, U: 10, aw: 'ninguno', der: 'error' };

  const ESCENARIOS = [
    { id: 'leo', lbl: 'Pasada LEO', mision: { h: 550, elMax: 45, D: 4, fGHz: 3 }, servo: {},
      texto: 'Pasada de 45° de elevación máxima a 550 km. El pedestal del caso de estudio (regulador P, Km = 6,944) sigue el acimut del satélite.',
      ref: 'Desarrollo propio, sin cifra de referencia externa.' },
    { id: 'cenit', lbl: 'Pasada casi cenital', mision: { h: 550, elMax: 85, D: 4, fGHz: 3 }, servo: {},
      texto: 'Cerca del cenit el acimut gira muy deprisa (≈ 9 °/s frente a 0,8 °/s a 45°): es el «keyhole» de un pedestal acimut-elevación. El error del eje de acimut se dispara, pero el haz apenas se desvía porque ese error se proyecta con cos(el). Lo que de verdad limita es la velocidad y la aceleración que se piden al motor de acimut.',
      ref: 'Desarrollo propio, sin cifra de referencia externa.' },
    { id: 'cenit-pi', lbl: 'Cenital con PI', mision: { h: 550, elMax: 85, D: 4, fGHz: 3 }, servo: { T: 0.005, KI: 5 },
      texto: 'La misma pasada con acción integral (KI = 5): el lazo pasa a tipo 2 y sigue una rampa sin error; el error del eje de acimut baja a una séptima parte y solo queda el debido a su aceleración.',
      ref: 'Desarrollo propio: compárese con «Pasada casi cenital».' },
    { id: 'e1', lbl: 'E1 · Guion P1', servo: { planta: 'p1', T: 0.0625, KP: 4, KI: 8, KD: 1, ref: 'escalon' },
      texto: 'Ajuste del guion de la Práctica 1 (KP = 4, KD = 1, KI = 8) ante un escalón de 10 en las unidades del guion.',
      ref: 'Python: u(0) = 202,50 · pico 14,88 a 0,3125 s · Mp 48,8 % · ts(2 %) 1,625 s · ρ 0,862.' },
    { id: 'e2', lbl: 'E2 · Ajuste propuesto', servo: { planta: 'p1', T: 0.0625, KP: 3, KI: 0.5, KD: 1, ref: 'escalon' },
      texto: 'Ajuste corregido con menos acción integral (KP = 3, KD = 1, KI = 0,5).',
      ref: 'Python: Mp 28,7 % · ts(2 %) 1,00 s.' },
    { id: 'e3', lbl: 'E3 · Windup', servo: { planta: 'p1', T: 0.0625, KP: 4, KI: 8, KD: 1, ref: 'escalon', sat: true, U: 10 },
      texto: 'Actuador saturado a ±10 V. Cambia el anti-windup para ver cómo se recupera la respuesta.',
      ref: 'Python: sin anti-windup 86,9 % (uI máx. 32,1) · acotar 25,0 % · congelar 18,6 %.' },
    { id: 'e4', lbl: 'E4 · Derivative kick', servo: { planta: 'p1', T: 0.0625, KP: 4, KI: 8, KD: 1, ref: 'cuadrada' },
      texto: 'Onda cuadrada 0/10 con semiperiodo de 100 muestras (6,25 s). Cambia la derivada del error a la de la salida.',
      ref: 'Python: u en los flancos ±202,5 (derivada del error) frente a ±42,5 (derivada de la salida).' },
    { id: 'e5', lbl: 'E5 · Ajustes de la memoria', servo: { planta: 'p1', T: 0.0625, KP: 5, KI: 6, KD: 2.5, ref: 'escalon' },
      texto: 'Contraejemplo: el ajuste del apartado d de la memoria (KP = 5, KD = 2,5, KI = 6). Con el modelo corregido la sobreoscilación no baja sino que sube; el del apartado f (KP = 6, KD = 3, KI = 5) la sube aún más.',
      ref: 'Python: Mp 56,8 % (KP = 5, KD = 2,5, KI = 6) y 70,9 % (KP = 6, KD = 3, KI = 5).' },
    { id: 'e6', lbl: 'E6 · Radar nominal', mision: { D: 4, fGHz: 3 }, servo: { T: 0.001, ref: 'rampa', omega0: 0.05 },
      texto: 'Pedestal del problema del radar (P = Km) siguiendo un blanco a 0,05 rad/s, con la antena de 4 m a 3 GHz.',
      ref: 'Python: e_ss 0,0072 rad = 0,41° · pérdida 1,81 dB (ida y vuelta) · R_ef 160,25 km.' },
    { id: 'e7', lbl: 'E7 · Blanco ×2', mision: { D: 4, fGHz: 3 }, servo: { T: 0.001, ref: 'rampa', omega0: 0.10 },
      texto: 'El mismo pedestal con el blanco al doble de velocidad angular (0,10 rad/s).',
      ref: 'Python: e_ss 0,825° · pérdida 7,67 dB · R_ef 114,3 km (fuera del semihaz).' },
    { id: 'e8', lbl: 'E8 · Muestreo lento', servo: { T: 0.05, ref: 'escalon' },
      texto: 'Pedestal con P = Km y periodo de muestreo de 0,05 s ante un escalón unitario.',
      ref: 'Python: Mp 17,06 % (9,60 % con T = 0,001 s; teórico continuo 9,48 %).' },
    { id: 'e9', lbl: 'E9 · PI en el pedestal', servo: { T: 0.005, KI: 5, ref: 'rampa', omega0: 0.05 },
      texto: 'Acción integral en el pedestal (KI = 5) ante la rampa de 0,05 rad/s.',
      ref: 'Python: e(10 s) ≈ 3·10⁻⁶ rad: el blanco queda centrado en el haz.' }
  ];

  // ------------------------------------------------------------------ estado (persiste al cambiar de pestaña)
  const estado = {
    mision: { h: 550, elMax: 45, D: 4, fGHz: 3 },
    servo: Object.assign({}, SERVO_BASE),
    enlace: { PtSat: 1 },
    escenario: 'leo',
    modificado: false
  };
  const cache = { clave: null, pasada: null };

  // ------------------------------------------------------------------ formato
  const fmt = (x, d = 0) => {
    if (x == null || Number.isNaN(x)) return '—';
    if (!isFinite(x)) return x > 0 ? '∞' : '−∞';
    const [ent, dec] = Math.abs(x).toFixed(d).split('.');
    return (x < 0 && +x.toFixed(d) !== 0 ? '−' : '') + ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dec ? ',' + dec : '');
  };
  // hasta d decimales sin ceros sobrantes (0,3125 s; 1,625 s)
  const fmtT = (x, d = 4) => {
    if (!isFinite(x)) return '—';
    const s = fmt(x, d);
    return s.indexOf(',') >= 0 ? s.replace(/0+$/, '').replace(/,$/, '') : s;
  };
  const SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  const fmtSci = (x, d = 1) => {
    if (!isFinite(x)) return fmt(x);
    if (x === 0) return '0';
    if (Math.abs(x) >= 1e-3) return fmtT(x, 5);
    const [m, e] = x.toExponential(d).split('e');
    return m.replace('.', ',').replace('-', '−') + '·10' + String(+e).split('').map(c => SUP[c] || c).join('');
  };
  const mmss = s => { const r = Math.round(s); return `${Math.floor(r / 60)} min ${String(r % 60).padStart(2, '0')} s`; };
  const ESTADO_LBL = { dentro: 'Dentro del haz', degradado: 'Degradado', fuera: 'Fuera del semihaz', na: 'No aplica' };

  // ------------------------------------------------------------------ paso 1: pasada orbital
  function elementos(hKm, dLonDeg) {
    const i = INC * D2R, phi = EST.latDeg * D2R;
    const u = Math.asin(Math.sin(phi) / Math.sin(i));              // argumento de latitud sobre la estación
    const alfa = Math.atan2(Math.cos(i) * Math.sin(u), Math.cos(u)); // ascensión recta relativa al nodo
    const raan = (EST.lonDeg + dLonDeg) * D2R - alfa;              // θg(0) = 0: ECI = ECEF en t = 0
    return R.elementosCirculares({ h: hKm * 1e3, iDeg: INC, raanDeg: raan * R2D, u0Deg: u * R2D });
  }

  /** Coloca la órbita para que la pasada alcance la elevación máxima pedida (bisección en la longitud del paso). */
  function construirPasada(hKm, elMaxDeg) {
    const est = R.estacion({ latDeg: EST.latDeg, lonDeg: EST.lonDeg, h: 0 });
    const medio = 1100;
    const elMaxDe = dl => R.pasada({ elem: elementos(hKm, dl), estacion: est, t0: -medio, t1: medio, dt: 5, elMin: EL_MIN }).elMax;
    const lam0 = Math.acos(R.RE / (R.RE + hKm * 1e3)) * R2D;
    let lo = 0, hi = 1.5 * lam0 / Math.cos(EST.latDeg * D2R);
    for (let it = 0; it < 32; it++) {
      const mid = 0.5 * (lo + hi);
      if (elMaxDe(mid) > elMaxDeg) lo = mid; else hi = mid;
    }
    const elem = elementos(hKm, 0.5 * (lo + hi));
    const p = R.pasada({ elem, estacion: est, t0: -medio, t1: medio, dt: 1, elMin: EL_MIN });
    if (p.aos == null || p.los == null) return null;

    // Rejilla uniforme AOS → LOS con valores y derivadas analíticas (interpolación de Hermite para el servo)
    const dur = p.los - p.aos, n = Math.max(2, Math.ceil(dur)), dtg = dur / n;
    const g = { tau: [], az: [], el: [], azRate: [], elRate: [], rango: [], omega: [], dtg, dur };
    let prev = null;
    for (let j = 0; j <= n; j++) {
      const o = R.observar(elem, est, p.aos + j * dtg);
      let az = o.az;
      if (prev != null) { while (az - prev > 180) az -= 360; while (az - prev < -180) az += 360; }
      prev = az;
      g.tau.push(j * dtg); g.az.push(az); g.el.push(o.el); g.azRate.push(o.azRate); g.elRate.push(o.elRate);
      g.rango.push(o.rango); g.omega.push(o.omega);
    }
    const absMax = a => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    return {
      g, dur, elMax: p.elMax, tca: p.tca - p.aos, periodo: R.periodo(elem.a),
      rangoMin: Math.min(...g.rango), omegaMax: Math.max(...g.omega), azRateMax: absMax(g.azRate), elRateMax: absMax(g.elRate),
      azAos: ((g.az[0] % 360) + 360) % 360, azLos: ((g.az[n] % 360) + 360) % 360
    };
  }

  function hermite(g, clave, tau) {
    const v = g[clave], d = g[clave + 'Rate'], n = v.length - 1;
    const j = Math.min(n - 1, Math.max(0, Math.floor(tau / g.dtg)));
    const h = g.dtg, s = (tau - g.tau[j]) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * v[j] + (s3 - 2 * s2 + s) * h * d[j] + (-2 * s3 + 3 * s2) * v[j + 1] + (s3 - s2) * h * d[j + 1];
  }

  // ------------------------------------------------------------------ paso 2: servo
  function simularServo(sv, pas) {
    const esP1 = sv.planta === 'p1';
    let T = sv.T, aviso = '';
    if (sv.ref === 'pasada' && T < T_MIN_PASADA) {
      T = T_MIN_PASADA;
      aviso = `Con la pasada completa se simula con T = ${fmtT(T_MIN_PASADA)} s como mínimo (más de 100 000 muestras con T = 0,001 s).`;
    }
    const planta = esP1 ? S.plantaP1(T) : S.plantaPedestal(T);
    let ref, N, A = esP1 ? 10 : 1, semi = 0, refMax = 1, angular = false;
    if (sv.ref === 'escalon') {
      N = Math.round((esP1 ? 25 : 4) / T); ref = S.escalon(N, A); refMax = A;
    } else if (sv.ref === 'cuadrada') {
      semi = Math.round((esP1 ? 6.25 : 2) / T); N = 4 * semi; ref = S.cuadrada(N, A, semi); refMax = A;
    } else if (sv.ref === 'rampa') {
      const dur = esP1 ? 25 : 10;
      N = Math.round(dur / T) + 1; ref = S.rampa(N, T, sv.omega0); refMax = Math.max(1e-6, sv.omega0 * dur); angular = true;
    } else {
      if (!pas) return null;
      const g = pas.g, base = g[sv.eje][0];
      N = Math.floor(pas.dur / T) + 1;
      ref = k => (hermite(g, sv.eje, k * T) - base) * D2R;
      refMax = Math.max(1e-6, g[sv.eje].reduce((m, v) => Math.max(m, Math.abs(v - base)), 0) * D2R);
      angular = true;
    }
    const rho = S.radioEspectral(planta, sv.KP, sv.KI, sv.KD, T);
    const s = S.simular({ planta, T, KP: sv.KP, KI: sv.KI, KD: sv.KD, ref, N,
      sat: sv.sat ? { min: -sv.U, max: sv.U } : null, antiWindup: sv.aw, uImax: sv.U, derivada: sv.der,
      limite: rho >= 1 ? 1e3 * refMax : undefined });
    const out = { s, T, N, A, semi, rho, aviso, angular, esP1, diverge: s.divergeEn != null };
    out.umax = s.u.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    out.uImaxAbs = s.uI.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    if (sv.ref === 'escalon') out.met = S.metricas(s.y, s.u, A, T);
    if (sv.ref === 'cuadrada') { out.u0 = s.u[0]; out.uFlanco = s.u[semi]; out.pico = Math.max(...s.y); }
    if (sv.ref === 'rampa') out.eFin = s.e[s.N - 1];
    if (sv.ref === 'pasada') {
      // Desviación angular del haz respecto a la línea de vista (el otro eje se supone perfecto).
      // En acimut el error del eje se proyecta con la elevación: sin(γ/2) = cos(el)·sin(Δaz/2);
      // cerca del cenit un error grande del eje apenas desvía el haz. En elevación, γ = |Δel|.
      const g = pas.g, ep = new Float64Array(s.N);
      let k0 = 0, sq = 0, eEje = 0;
      for (let k = 0; k < s.N; k++) {
        const ee = Math.abs(s.e[k]);
        ep[k] = sv.eje === 'az'
          ? 2 * Math.asin(Math.min(1, Math.cos(hermite(g, 'el', Math.min(k * T, pas.dur)) * D2R) * Math.sin(ee / 2)))
          : ee;
        if (ep[k] > ep[k0]) k0 = k;
        sq += ep[k] * ep[k]; eEje = Math.max(eEje, ee);
      }
      out.ep = ep; out.eMax = ep[k0]; out.tEmax = k0 * T; out.eRms = Math.sqrt(sq / s.N); out.eEjeMax = eEje;
    }
    // error de apuntamiento representativo [°] para el paso 3
    if (out.diverge) out.errDeg = Infinity;
    else if (sv.ref === 'rampa') out.errDeg = Math.abs(out.eFin) * R2D;
    else if (sv.ref === 'pasada') out.errDeg = out.eMax * R2D;
    else out.errDeg = null;
    return out;
  }

  // ------------------------------------------------------------------ pasos 3 y 4
  function perdida(errDeg, ant, hz) {
    if (errDeg == null) return { ida: 0, idaVuelta: 0, na: true };
    if (!(errDeg < hz.thetaNulo)) return { ida: Infinity, idaVuelta: Infinity };
    return R.perdidaApuntamiento(errDeg, ant);
  }

  function calcular() {
    const m = estado.mision, sv = estado.servo;
    const clave = `${m.h}|${m.elMax}`;
    if (cache.clave !== clave) { cache.pasada = construirPasada(m.h, m.elMax); cache.clave = clave; }
    const pas = cache.pasada;
    const f = m.fGHz * 1e9, ant = { a: m.D / 2, f };
    const hz = R.haz(ant);
    const sim = simularServo(sv, pas);
    const L = perdida(sim ? sim.errDeg : null, ant, hz);
    const clase = sim && sim.errDeg != null ? R.clasificarApuntamiento(sim.errDeg, hz.hpbw) : 'na';
    const gan = R.ganancia(m.D, ETA, f);
    const Rmax = R.alcanceRadar({ Pt: RADAR.Pt, G: gan.G, f, sigma: RADAR.sigma, Pmin: RADAR.Pmin, LdB: RADAR.LdB });
    const hor = R.horizonte(RADAR.h1, RADAR.h2).metrica;
    const Ref = isFinite(L.idaVuelta) ? R.alcanceEfectivo(Rmax, L.idaVuelta) : 0;

    // Telemetría a lo largo de la pasada (un solo trayecto: pérdida de ida)
    const tm = { tau: [], snr: [], snr0: [], perd: [] };
    if (pas) {
      const g = pas.g, porPasada = sv.ref === 'pasada' && sim && !sim.diverge;
      for (let j = 0; j < g.tau.length; j++) {
        let li;
        if (porPasada) {
          const k = Math.min(sim.s.N - 1, Math.round(g.tau[j] / sim.T));
          li = perdida(sim.ep[k] * R2D, ant, hz).ida;
        } else li = L.ida;
        const base = { Pt: estado.enlace.PtSat, GtDbi: TM.GtDbi, GrDbi: gan.GdBi, f, d: g.rango[j], Tsys: TM.Tsys, B: TM.B };
        const snr0 = R.friis(base).snr;
        tm.tau.push(g.tau[j]); tm.snr0.push(snr0); tm.perd.push(li);
        tm.snr.push(isFinite(li) ? snr0 - li : null);
      }
    }
    const snrMin = tm.snr.length ? tm.snr.reduce((mn, v) => (v == null ? -Infinity : Math.min(mn, v)), Infinity) : NaN;
    const snrMin0 = tm.snr0.length ? Math.min(...tm.snr0) : NaN;
    return { pas, sim, hz, ant, L, clase, gan, Rmax, hor, Ref, tm, snrMin, snrMin0 };
  }

  // ------------------------------------------------------------------ gráficas (colores desde los tokens)
  function colores() {
    const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
    return { accent: v('--accent'), tertiary: v('--tertiary'), warn: v('--warn'), text: v('--text'), text2: v('--text-2'),
      text3: v('--text-3'), line: v('--line'), lineStrong: v('--line-strong'), elevated: v('--bg-elevated'),
      fontBody: v('--font-body'), fontMono: v('--font-mono') };
  }
  function eje(c, titulo, extra) {
    return Object.assign({ title: { text: titulo, font: { size: 11, color: c.text3 } }, gridcolor: c.line, zerolinecolor: c.lineStrong,
      linecolor: c.line, tickfont: { family: c.fontMono, size: 10, color: c.text3 }, automargin: true }, extra || {});
  }
  function layout(c, extra) {
    return Object.assign({
      paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', height: 260,
      font: { family: c.fontBody, color: c.text2, size: 11 },
      margin: { l: 54, r: 18, t: 34, b: 42 },
      legend: { orientation: 'h', x: 0, y: 1.16, font: { size: 11, color: c.text2 }, bgcolor: 'transparent' },
      hoverlabel: { bgcolor: c.elevated, bordercolor: c.lineStrong, font: { family: c.fontMono, size: 11, color: c.text } },
      hovermode: 'x unified'
    }, extra);
  }
  const CFG = { responsive: true, displayModeBar: false };
  function dibujar(id, data, lay) {
    const el = document.getElementById(id);
    if (!el || typeof Plotly === 'undefined') return;
    Plotly.react(el, data, lay, CFG);
  }
  /** Diezmado mínimo-máximo: conserva los picos de una serie larga (≤ 2·cubos puntos). */
  function diezmar(t, v, cubos = 900, esc = 1) {
    const n = Math.min(t.length, v.length);
    if (n <= 2 * cubos) return { x: t.slice(0, n), y: v.slice(0, n).map(z => z * esc) };
    const x = [], y = [], paso = n / cubos;
    for (let b = 0; b < cubos; b++) {
      const i0 = Math.floor(b * paso), i1 = Math.min(n, Math.floor((b + 1) * paso));
      let iMin = i0, iMax = i0;
      for (let i = i0; i < i1; i++) { if (v[i] < v[iMin]) iMin = i; if (v[i] > v[iMax]) iMax = i; }
      const [a, b2] = iMin < iMax ? [iMin, iMax] : [iMax, iMin];
      x.push(t[a]); y.push(v[a] * esc);
      if (b2 !== a) { x.push(t[b2]); y.push(v[b2] * esc); }
    }
    return { x, y };
  }
  const hline = (y, c, dash = 'dot') => ({ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: y, y1: y, line: { color: c, width: 1, dash } });

  function graficasPaso1(r, c) {
    if (!r.pas) return;
    const g = r.pas.g;
    const azMod = g.az.map(a => ((a % 360) + 360) % 360);
    dibujar('sv-c-azel', [
      { x: g.tau, y: g.el, name: 'Elevación', type: 'scatter', mode: 'lines', line: { color: c.accent, width: 2 }, hovertemplate: '%{y:.2f}°<extra>Elevación</extra>' },
      { x: g.tau, y: azMod, name: 'Acimut', type: 'scatter', mode: 'lines', yaxis: 'y2', line: { color: c.tertiary, width: 1.5 }, hovertemplate: '%{y:.1f}°<extra>Acimut</extra>' }
    ], layout(c, {
      margin: { l: 54, r: 54, t: 34, b: 42 },
      xaxis: eje(c, 'Tiempo desde la adquisición (AOS) [s]'),
      yaxis: eje(c, 'Elevación [°]', { rangemode: 'tozero' }),
      yaxis2: eje(c, 'Acimut [°]', { overlaying: 'y', side: 'right', range: [0, 360], dtick: 90, showgrid: false }),
      shapes: [hline(EL_MIN, c.text3)]
    }));
    dibujar('sv-c-vel', [
      { x: g.tau, y: g.omega, name: 'ω línea de vista', type: 'scatter', mode: 'lines', line: { color: c.accent, width: 2 }, hovertemplate: '%{y:.3f} °/s<extra>ω</extra>' },
      { x: g.tau, y: g.azRate.map(Math.abs), name: '|dAz/dt|', type: 'scatter', mode: 'lines', line: { color: c.tertiary, width: 1.5, dash: 'dot' }, hovertemplate: '%{y:.3f} °/s<extra>|dAz/dt|</extra>' },
      { x: g.tau, y: g.rango.map(v => v / 1e3), name: 'Rango', type: 'scatter', mode: 'lines', yaxis: 'y2', line: { color: c.text3, width: 1.5 }, hovertemplate: '%{y:.0f} km<extra>Rango</extra>' }
    ], layout(c, {
      margin: { l: 54, r: 60, t: 34, b: 42 },
      xaxis: eje(c, 'Tiempo desde la adquisición (AOS) [s]'),
      yaxis: eje(c, 'Velocidad angular [°/s]', { rangemode: 'tozero' }),
      yaxis2: eje(c, 'Rango [km]', { overlaying: 'y', side: 'right', showgrid: false, rangemode: 'tozero' })
    }));
  }

  function graficasPaso2(r, c) {
    const sim = r.sim; if (!sim) return;
    const s = sim.s, esc = sim.angular ? R2D : 1, ud = sim.angular ? '°' : (sim.esP1 ? 'unid. del guion' : 'rad');
    const yv = diezmar(s.t, s.y, 900, esc), rv = diezmar(s.t, s.r, 900, esc);
    dibujar('sv-c-y', [
      { x: rv.x, y: rv.y, name: 'Referencia r(t)', type: 'scatter', mode: 'lines', line: { color: c.tertiary, width: 1.5, dash: 'dash' }, hovertemplate: '%{y:.4f}<extra>r</extra>' },
      { x: yv.x, y: yv.y, name: 'Salida y(t)', type: 'scatter', mode: 'lines', line: { color: c.accent, width: 2 }, hovertemplate: '%{y:.4f}<extra>y</extra>' }
    ], layout(c, { xaxis: eje(c, 'Tiempo [s]'), yaxis: eje(c, `Posición [${ud}]`) }));

    const ev = diezmar(s.t, s.e, 900, esc);
    const shapes = [];
    if (sim.angular) {
      const q = r.hz.hpbw / 4, h = r.hz.hpbw / 2;
      shapes.push(hline(q, c.text3), hline(-q, c.text3), hline(h, c.text2, 'dash'), hline(-h, c.text2, 'dash'));
    }
    const conHaz = !!sim.ep && estado.servo.eje === 'az';
    const trazasE = conHaz
      ? [{ x: ev.x, y: ev.y, name: 'Error del eje de acimut', type: 'scatter', mode: 'lines', line: { color: c.tertiary, width: 1.5, dash: 'dot' }, hovertemplate: '%{y:.4f}°<extra>eje</extra>' },
        Object.assign({ name: 'Desviación del haz', type: 'scatter', mode: 'lines', line: { color: c.accent, width: 1.5 }, hovertemplate: '%{y:.4f}°<extra>haz</extra>' }, diezmar(s.t, sim.ep, 900, R2D))]
      : [{ x: ev.x, y: ev.y, name: 'Error e(t)', type: 'scatter', mode: 'lines', line: { color: c.accent, width: 1.5 }, hovertemplate: '%{y:.4f}<extra>e</extra>' }];
    dibujar('sv-c-e', trazasE, layout(c, { showlegend: conHaz, xaxis: eje(c, 'Tiempo [s]'),
      yaxis: eje(c, sim.angular ? 'Error de apuntamiento [°]' : `Error [${ud}]`), shapes,
      title: { text: sim.angular ? 'Líneas: ±θ3dB/4 (punteada) y ±θ3dB/2 (discontinua)' : '', font: { size: 10, color: c.text3 }, x: 0.01, xanchor: 'left', y: 0.97 } }));

    const uv = diezmar(s.t, s.u, 900), iv = diezmar(s.t, s.uI, 900);
    const ushapes = estado.servo.sat ? [hline(estado.servo.U, c.text3), hline(-estado.servo.U, c.text3)] : [];
    dibujar('sv-c-u', [
      { x: uv.x, y: uv.y, name: 'Esfuerzo u(t)', type: 'scatter', mode: 'lines', line: { color: c.accent, width: 1.5 }, hovertemplate: '%{y:.3f}<extra>u</extra>' },
      { x: iv.x, y: iv.y, name: 'Integral uI(t)', type: 'scatter', mode: 'lines', line: { color: c.tertiary, width: 1.5, dash: 'dot' }, hovertemplate: '%{y:.3f}<extra>uI</extra>' }
    ], layout(c, { xaxis: eje(c, 'Tiempo [s]'), yaxis: eje(c, sim.esP1 ? 'Tensión [V]' : 'Esfuerzo de control'), shapes: ushapes }));
  }

  function graficasPaso3(r, c) {
    const hz = r.hz, lim = 1.6 * hz.thetaNulo, xs = [], ys = [];
    for (let i = 0; i <= 400; i++) {
      const th = -lim + 2 * lim * i / 400;
      xs.push(th); ys.push(Math.max(-40, 10 * Math.log10(Math.max(1e-12, R.patronReflector(th * D2R, r.ant)))));
    }
    const shapes = [hline(-3.0103, c.text3),
      { type: 'rect', xref: 'x', yref: 'paper', x0: -hz.hpbw / 4, x1: hz.hpbw / 4, y0: 0, y1: 1, fillcolor: c.line, line: { width: 0 } }];
    const e = r.sim && r.sim.errDeg;
    if (e != null && isFinite(e) && e < lim) {
      shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: e, x1: e, y0: 0, y1: 1, line: { color: c.accent, width: 1.5 } });
    }
    dibujar('sv-c-haz', [
      { x: xs, y: ys, name: 'Diagrama', type: 'scatter', mode: 'lines', line: { color: c.text2, width: 1.5 }, hovertemplate: '%{x:.3f}° · %{y:.2f} dB<extra></extra>' }
    ], layout(c, { showlegend: false, hovermode: 'closest', xaxis: eje(c, 'Ángulo respecto al eje [°]', { zeroline: false }),
      yaxis: eje(c, 'Potencia normalizada [dB]', { range: [-40, 2] }), shapes,
      title: { text: 'Banda: ±θ3dB/4 · línea naranja: error de seguimiento', font: { size: 10, color: c.text3 }, x: 0.01, xanchor: 'left', y: 0.97 } }));

    const el = document.getElementById('sv-c-perd');
    if (!el) return;
    const conPasada = estado.servo.ref === 'pasada' && r.pas && r.sim && !r.sim.diverge;
    el.closest('.servo-chart-wrap').hidden = !conPasada;
    if (!conPasada) return;
    dibujar('sv-c-perd', [
      { x: r.tm.tau, y: r.tm.perd.map(v => (isFinite(v) ? Math.min(v, 40) : 40)), name: 'Pérdida de ida', type: 'scatter', mode: 'lines', line: { color: c.accent, width: 1.5 }, hovertemplate: '%{y:.3f} dB<extra>ida</extra>' }
    ], layout(c, { showlegend: false, xaxis: eje(c, 'Tiempo desde AOS [s]'), yaxis: eje(c, 'Pérdida de apuntamiento (ida) [dB]', { rangemode: 'tozero' }) }));
  }

  function graficasPaso4(r, c) {
    if (!r.pas) return;
    dibujar('sv-c-enlace', [
      { x: r.tm.tau, y: r.tm.snr0, name: 'Sin pérdida de apuntamiento', type: 'scatter', mode: 'lines', line: { color: c.tertiary, width: 1.5, dash: 'dot' }, hovertemplate: '%{y:.2f} dB<extra>ideal</extra>' },
      { x: r.tm.tau, y: r.tm.snr, name: 'Con el error del pedestal', type: 'scatter', mode: 'lines', line: { color: c.accent, width: 2 }, connectgaps: false, hovertemplate: '%{y:.2f} dB<extra>real</extra>' }
    ], layout(c, { xaxis: eje(c, 'Tiempo desde AOS [s]'), yaxis: eje(c, 'SNR de la telemetría [dB]'), shapes: [hline(TM.snrMin, c.text2, 'dash')] }));
  }

  // ------------------------------------------------------------------ plantillas HTML
  const origen = (txt, propio) => `<span class="servo-origen${propio ? ' is-propio' : ''}">${txt}</span>`;
  function cabeceraPaso(n, titulo, pregunta, origenes) {
    return `
      <header class="servo-paso-head">
        <span class="servo-paso-num">${String(n).padStart(2, '0')}</span>
        <div>
          <div class="servo-origenes">${origenes}</div>
          <h3 class="servo-paso-title">${titulo}</h3>
          <p class="servo-paso-q">${pregunta}</p>
        </div>
      </header>`;
  }
  const slider = (id, lbl, min, max, step) => `
    <label class="servo-slider" for="${id}">
      <span class="servo-slider-top"><span>${lbl}</span><strong id="${id}-v"></strong></span>
      <input type="range" class="custom-range" id="${id}" min="${min}" max="${max}" step="${step}" />
    </label>`;
  const seg = (grupo, lbl, ops) => `
    <div class="servo-ctrl" data-grupo-wrap="${grupo}">
      <span class="servo-lbl">${lbl}</span>
      <div class="servo-seg" role="group" aria-label="${lbl}">${ops.map(([v, t]) => `<button type="button" data-grupo="${grupo}" data-val="${v}">${t}</button>`).join('')}</div>
    </div>`;
  const kpi = (lbl, val, sub, cls) => `
    <div class="servo-kpi"><span class="servo-kpi-lbl">${lbl}</span><span class="servo-kpi-val${cls ? ' ' + cls : ''}">${val}</span>${sub ? `<span class="servo-kpi-sub">${sub}</span>` : ''}</div>`;
  const chart = (id, wide) => `<div class="servo-chart-wrap${wide ? ' is-wide' : ''}"><div class="servo-chart" id="${id}"></div></div>`;

  function plantilla() {
    return `
    <div class="servo-view">
      <header class="section-head reveal">
        <span class="section-index">F1</span>
        <div>
          <span class="eyebrow"><span class="dot"></span>Fase 1 · Seguimiento y enlace</span>
          <h2 class="section-title">Del paso del satélite al <em class="serif">margen</em> del enlace</h2>
        </div>
        <p class="section-intro">Cuatro pasos encadenados: la pasada fija lo que debe seguir el pedestal, su error se convierte en pérdida con el diagrama de la antena y esa pérdida cuesta alcance y margen. Cambia la altitud o la elevación en el panel de misión y se recalcula todo.</p>
      </header>

      <div class="servo-escenarios reveal" style="--d: 80ms">
        <div class="servo-escenarios-head">
          <span class="servo-lbl">Escenarios preestablecidos</span>
          <div class="servo-chips" role="group" aria-label="Escenarios preestablecidos">
            ${ESCENARIOS.map(e => `<button type="button" class="servo-chip" data-escenario="${e.id}">${e.lbl}</button>`).join('')}
          </div>
        </div>
        <p class="servo-esc-texto" id="sv-esc-texto"></p>
        <p class="servo-esc-ref" id="sv-esc-ref"></p>
      </div>

      <div class="servo-layout">
        <aside class="servo-mision reveal" aria-label="Panel de misión" style="--d: 120ms">
          <span class="eyebrow">Panel de misión</span>
          ${slider('sv-h', 'Altitud de la órbita', 300, 1500, 10)}
          ${slider('sv-elmax', 'Elevación máxima de la pasada', 10, 88, 1)}
          ${slider('sv-d', 'Diámetro de la antena', 1, 10, 0.1)}
          ${slider('sv-f', 'Frecuencia', 1, 12, 0.1)}
          <p class="servo-mision-nota">Estación de ejemplo en San Vicente del Raspeig (38,39° N · 0,51° O), órbita circular de 97,6° de inclinación, máscara de ${EL_MIN}°.</p>
          <div class="servo-resumen" id="sv-resumen"></div>
          <nav class="servo-nav" aria-label="Pasos">
            <a href="#servo-paso-1">01 Pasada</a><a href="#servo-paso-2">02 Pedestal</a><a href="#servo-paso-3">03 Haz</a><a href="#servo-paso-4">04 Enlace</a>
          </nav>
        </aside>

        <div class="servo-pasos">
          <article class="servo-paso reveal" id="servo-paso-1">
            ${cabeceraPaso(1, 'Pasada orbital', '¿Cuándo, por dónde y a qué velocidad cruza el satélite el cielo de la estación?', origen('Desarrollo propio', true))}
            <p class="servo-text">Órbita circular kepleriana (dos cuerpos, Tierra esférica en rotación, sin perturbaciones ni refracción). La órbita se coloca para que la pasada alcance la <strong>elevación máxima</strong> del panel de misión. Se comprueba con casos analíticos: periodo 2π√(a³/μ), rango mínimo igual a la altitud y velocidad angular v/h en una pasada cenital.</p>
            <div class="servo-formula">T = 2π·√(a³/μ) · ω = |ρ × ρ̇| / |ρ|² · elevación y acimut en el sistema local este-norte-cenit</div>
            <div class="servo-kpis" id="sv-k1"></div>
            <div class="servo-charts">${chart('sv-c-azel')}${chart('sv-c-vel')}</div>
          </article>

          <article class="servo-paso reveal" id="servo-paso-2">
            ${cabeceraPaso(2, 'Pedestal de seguimiento', '¿Mantiene el servo la antena apuntada al satélite?', origen('Práctica 1'))}
            <p class="servo-text">Planta K/[s(s + a)] discretizada por ZOH al <strong>mismo periodo T</strong> que el regulador y PID digital posicional de la P1 en su versión corregida: sin retardo extra, e(k) = r(k) − y(k), integral trapezoidal y saturación sin «−U<sub>MIN</sub>». Con la referencia «Pasada», el pedestal espera apuntado al punto de adquisición (AOS) y sigue el acimut o la elevación del paso 1. Lo que cuenta para el enlace es la <strong>desviación del haz</strong>, no el error del eje: en acimut se proyecta con la elevación, sin(γ/2) = cos(el)·sin(Δaz/2), así que cerca del cenit un error grande del eje apenas desvía el haz.</p>
            <div class="servo-formula">u(k) = KP·e(k) + uI(k) + uD(k) · uI(k) = uI(k−1) + KI·T/2·[e(k) + e(k−1)] · uD(k) = KD/T·[e(k) − e(k−1)]</div>
            <div class="servo-controles">
              ${seg('planta', 'Planta', [['pedestal', 'Pedestal (caso de estudio)'], ['p1', 'Servo de laboratorio (P1)']])}
              ${seg('ref', 'Referencia', [['pasada', 'Pasada'], ['rampa', 'Rampa'], ['escalon', 'Escalón'], ['cuadrada', 'Cuadrada']])}
              ${seg('eje', 'Eje seguido', [['az', 'Acimut'], ['el', 'Elevación']])}
              <div class="servo-ctrl" data-grupo-wrap="omega0">${slider('sv-w0', 'Velocidad del blanco Ω₀', 0, 0.15, 0.005)}</div>
              ${slider('sv-t', 'Periodo de muestreo T', 0, T_LIST.length - 1, 1)}
              ${slider('sv-kp', 'KP', 0, 20, 0.01)}
              ${slider('sv-ki', 'KI', 0, 20, 0.01)}
              ${slider('sv-kd', 'KD', 0, 5, 0.01)}
              <div class="servo-ctrl">
                <label class="servo-check"><input type="checkbox" id="sv-sat" /> <span>Saturación del actuador ±U</span></label>
                ${slider('sv-u', 'U', 5, 300, 1)}
              </div>
              ${seg('aw', 'Anti-windup', [['ninguno', 'Ninguno'], ['acotar', 'Acotar uI a ±U'], ['congelar', 'Congelar']])}
              ${seg('der', 'Derivada', [['error', 'Del error'], ['salida', 'De la salida']])}
            </div>
            <p class="servo-aviso" id="sv-aviso" hidden></p>
            <div class="servo-kpis" id="sv-k2"></div>
            <div class="servo-charts">${chart('sv-c-y', true)}${chart('sv-c-e')}${chart('sv-c-u')}</div>
            <p class="servo-pie">Modelo del servomotor y algoritmo del PID digital: guion de la Práctica 1 (S. T. Puente). Pedestal: lazo Km/[s(0,1 s + 1)] del problema del radar, con ξ = 0,6. El servo de la P1 tiene la inercia de un equipo de laboratorio y no movería una antena de 4 m. Implementación y correcciones propias.</p>
          </article>

          <article class="servo-paso reveal" id="servo-paso-3">
            ${cabeceraPaso(3, 'Haz y pérdida de apuntamiento', '¿Cuánta señal se pierde por no apuntar exactamente al satélite?', origen('Práctica 4') + origen('Desarrollo propio', true))}
            <p class="servo-text">Diagrama de una apertura circular uniforme, [2·J₁(ka·senθ)/(ka·senθ)]², con el diámetro y la frecuencia del panel de misión. El error del paso 2 (el <strong>máximo de la pasada</strong> o el <strong>error estacionario</strong> de la rampa) se lleva al diagrama: la pérdida de ida es −10·log₁₀ P(e) y la de ida y vuelta, el doble. El semáforo compara el error con el haz: dentro si |e| ≤ θ3dB/4, degradado si |e| ≤ θ3dB/2 y fuera por encima.</p>
            <div class="servo-semaforo" id="sv-sem"></div>
            <div class="servo-kpis" id="sv-k3"></div>
            <div class="servo-charts">${chart('sv-c-haz')}${chart('sv-c-perd')}</div>
            <p class="servo-pie">Ecuaciones del diagrama de radiación: enunciado de la Práctica 4 (M. Á. Sánchez Soriano y A. Mestre Quereda); la función de análisis es propia. El paso del error del servo a pérdida de ganancia es desarrollo propio.</p>
          </article>

          <article class="servo-paso reveal" id="servo-paso-4">
            ${cabeceraPaso(4, 'Enlace', '¿Cuánto alcance y cuánto margen cuesta el error de apuntamiento?', origen('Problema de radar') + origen('Desarrollo propio', true))}
            <p class="servo-text"><strong>Radar (caso de estudio):</strong> ecuación del radar con P<sub>t</sub> = 50 kW, σ = 15 m², P<sub>min</sub> = 10⁻¹³ W, L = 6 dB y η = 0,65. El alcance va con la raíz cuarta de la potencia, así que R<sub>ef</sub> = R<sub>max</sub>·10^(−L<sub>ap</sub>/40) con la pérdida de ida y vuelta del paso 3. <strong>Telemetría del satélite:</strong> balance de Friis en un trayecto con el rango de la pasada, antena del satélite de 0 dBi, T<sub>sys</sub> = 290 K, B = 1 MHz y una SNR mínima de ${TM.snrMin} dB (valores ilustrativos).</p>
            <div class="servo-formula">R_max = [P_t·G²·λ²·σ / ((4π)³·P_min·L)]^¼ · P_r = P_t + G_t + G_r − 20·log₁₀(4πd/λ) − L_ap</div>
            <div class="servo-controles servo-controles-1">${slider('sv-pt', 'Potencia del transmisor del satélite', 0.1, 10, 0.1)}</div>
            <div class="servo-kpis" id="sv-k4"></div>
            <div class="servo-charts">${chart('sv-c-enlace', true)}</div>
            <p class="servo-pie" id="sv-nota4"></p>
            <p class="servo-pie">Problema del radar: el origen del enunciado está sin confirmar; se presenta como caso de estudio con parámetros típicos de un radar de aproximación (TAR). El balance de Friis es desarrollo propio.</p>
          </article>
        </div>
      </div>

      ${creditos()}
    </div>`;
  }

  function creditos() {
    return `
      <section class="section servo-creditos" id="servo-creditos">
        <header class="section-head reveal">
          <span class="section-index">05</span>
          <div>
            <span class="eyebrow">Fuentes, validación y límites</span>
            <h2 class="section-title">Créditos y limitaciones</h2>
          </div>
          <p class="section-intro">Qué es material docente, qué es propio, cómo se ha comprobado y qué simplifica el modelo. Material académico de simulación con fines educativos: no es una herramienta operativa.</p>
        </header>
        <div class="servo-creditos-grid">
          <div class="servo-creditos-col reveal">
            <h3 class="servo-sub">Créditos</h3>
            <p>Basado en las prácticas de <em>Control y Sistemas de Comunicación</em> (Grado en Ingeniería Aeroespacial, Universidad de Alicante, curso 2025-26). Bloque de control: guion de la Práctica 1 de S. T. Puente (modelo del servomotor y algoritmo del PID digital). Bloque de comunicaciones: Práctica 4 de M. Á. Sánchez Soriano y A. Mestre Quereda (ecuaciones de los diagramas de radiación). Los enunciados son material docente de sus autores y no se reproducen. La implementación, las correcciones del modelo, la integración radar–antena–servo y el simulador son trabajo propio.</p>
            <p>La plantilla <code>plano_E_reflector.m</code> es del profesor A. Mestre Quereda: no se publica ni se reescribe. El diagrama del reflector parte de la función de análisis propia de la P4 y de la ecuación del enunciado.</p>
            <h3 class="servo-sub">Limitaciones</h3>
            <ul class="servo-lista">
              <li><strong>Validación:</strong> el motor numérico se ha comparado con una réplica independiente en Python (scipy) mediante 29 pruebas automáticas. No se ha contrastado con MATLAB.</li>
              <li><strong>Problema del radar:</strong> el origen del enunciado está sin confirmar; se usa como caso de estudio.</li>
              <li><strong>Órbita:</strong> kepleriana circular, sin J2, arrastre ni refracción; Tierra esférica.</li>
              <li><strong>Seguimiento:</strong> un solo eje del pedestal frente a la referencia, con el otro eje supuesto perfecto (en acimut, la desviación del haz es la del eje proyectada con cos(el)); sin monopulso ni barrido cónico ni límites de velocidad del motor; pérdida estática por desapuntamiento.</li>
              <li><strong>Supuestos no fijados por el enunciado:</strong> U = 10 V y la onda cuadrada de 12,5 s de periodo. El guion da 0,01 s como periodo de la planta (§4.6), pero solo 0,0625 s reproduce sus figuras 20–22: se usa 0,0625 s, pendiente de confirmar con el profesor.</li>
              <li><strong>Herramientas:</strong> implementación y verificación numérica realizadas con apoyo de herramientas de programación asistida por IA.</li>
            </ul>
          </div>
          <div class="servo-creditos-col reveal" style="--d: 120ms">
            <h3 class="servo-sub">Comprobación en vivo</h3>
            <p>Cifras de referencia de la réplica en Python frente a lo que calcula esta página al cargarse.</p>
            <div class="table-responsive"><table class="servo-tabla" id="sv-validacion"></table></div>
          </div>
        </div>
      </section>`;
  }

  function tablaValidacion() {
    const el = document.getElementById('sv-validacion');
    if (!el) return;
    const p1 = S.plantaP1();
    const s1 = S.simular({ planta: p1, T: S.P1.T, KP: 4, KI: 8, KD: 1, ref: S.escalon(400, 10) });
    const m1 = S.metricas(s1.y, s1.u, 10, S.P1.T);
    const g = R.ganancia(4, ETA, 3e9);
    const Rm = R.alcanceRadar({ Pt: RADAR.Pt, G: g.G, f: 3e9, sigma: RADAR.sigma, Pmin: RADAR.Pmin, LdB: RADAR.LdB });
    const pl = S.plantaPedestal(0.001);
    const sr = S.simular({ planta: pl, T: 0.001, KP: Km, ref: S.rampa(10001, 0.001, 0.05) });
    const ess = Math.abs(sr.e[sr.N - 1]) * R2D;
    const L = R.perdidaApuntamiento(ess, { a: 2, f: 3e9 });
    const filas = [
      ['u(0), guion P1', '202,50 V', fmt(m1.u0, 2) + ' V'],
      ['Sobreoscilación, guion P1', '48,8 %', fmt(m1.sobreosc, 1) + ' %'],
      ['ρ del lazo, guion P1', '0,862', fmt(S.radioEspectral(p1, 4, 8, 1, S.P1.T), 3)],
      ['θ3dB, antena de 4 m a 3 GHz', '1,474°', fmt(R.haz({ a: 2, f: 3e9 }).hpbw, 3) + '°'],
      ['R_max del radar', '177,84 km', fmt(Rm / 1e3, 2) + ' km'],
      ['e_ss del pedestal (0,05 rad/s)', '0,4125°', fmt(ess, 4) + '°'],
      ['Pérdida de ida y vuelta', '1,81 dB', fmt(L.idaVuelta, 2) + ' dB'],
      ['Alcance efectivo', '160,25 km', fmt(R.alcanceEfectivo(Rm, L.idaVuelta) / 1e3, 2) + ' km'],
      ['Periodo a 400 km', '92,56 min', fmt(R.periodo(R.RE + 400e3) / 60, 2) + ' min']
    ];
    el.innerHTML = `<thead><tr><th>Magnitud</th><th>Python</th><th>Esta web</th></tr></thead>
      <tbody>${filas.map(f => `<tr><td>${f[0]}</td><td>${f[1]}</td><td>${f[2]}</td></tr>`).join('')}</tbody>`;
  }

  // ------------------------------------------------------------------ actualización
  const $ = id => document.getElementById(id);
  const SLIDERS = {
    'sv-h': { get: () => estado.mision.h, set: v => { estado.mision.h = v; }, txt: v => `${fmt(v)} km` },
    'sv-elmax': { get: () => estado.mision.elMax, set: v => { estado.mision.elMax = v; }, txt: v => `${fmt(v)}°` },
    'sv-d': { get: () => estado.mision.D, set: v => { estado.mision.D = v; }, txt: v => `${fmt(v, 1)} m` },
    'sv-f': { get: () => estado.mision.fGHz, set: v => { estado.mision.fGHz = v; }, txt: v => `${fmt(v, 1)} GHz` },
    'sv-w0': { get: () => estado.servo.omega0, set: v => { estado.servo.omega0 = v; }, txt: v => `${fmt(v, 3)} rad/s` },
    'sv-t': { get: () => T_LIST.indexOf(estado.servo.T), set: v => { estado.servo.T = T_LIST[v]; }, txt: v => `${fmtT(T_LIST[v])} s` },
    'sv-kp': { get: () => estado.servo.KP, set: v => { estado.servo.KP = v; }, txt: () => fmtT(estado.servo.KP, 3) },
    'sv-ki': { get: () => estado.servo.KI, set: v => { estado.servo.KI = v; }, txt: () => fmtT(estado.servo.KI, 3) },
    'sv-kd': { get: () => estado.servo.KD, set: v => { estado.servo.KD = v; }, txt: () => fmtT(estado.servo.KD, 3) },
    'sv-u': { get: () => estado.servo.U, set: v => { estado.servo.U = v; }, txt: v => `${fmt(v)}${estado.servo.planta === 'p1' ? ' V' : ''}` },
    'sv-pt': { get: () => estado.enlace.PtSat, set: v => { estado.enlace.PtSat = v; }, txt: v => `${fmt(v, 1)} W` }
  };

  function sincronizarControles(root) {
    Object.entries(SLIDERS).forEach(([id, d]) => {
      const inp = $(id); if (!inp) return;
      if (document.activeElement !== inp) inp.value = d.get();
      const t = d.txt(d.get());
      $(id + '-v').textContent = t;
      inp.setAttribute('aria-valuetext', t);
    });
    root.querySelectorAll('[data-grupo]').forEach(b => {
      const on = String(estado.servo[b.dataset.grupo]) === b.dataset.val;
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', on);
    });
    const sv = estado.servo;
    root.querySelector('[data-grupo-wrap="eje"]').hidden = sv.ref !== 'pasada';
    root.querySelector('[data-grupo-wrap="omega0"]').hidden = sv.ref !== 'rampa';
    $('sv-sat').checked = sv.sat;
    root.querySelectorAll('[data-escenario]').forEach(b => {
      const on = !estado.modificado && b.dataset.escenario === estado.escenario;
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', on);
    });
    const esc = ESCENARIOS.find(e => e.id === estado.escenario);
    $('sv-esc-texto').textContent = esc ? (estado.modificado ? `Configuración modificada a partir de «${esc.lbl}». ` : '') + esc.texto : 'Configuración libre.';
    $('sv-esc-ref').textContent = esc ? 'Referencia · ' + esc.ref : '';
  }

  function aplicarEscenario(id) {
    const e = ESCENARIOS.find(x => x.id === id); if (!e) return;
    estado.escenario = id; estado.modificado = false;
    estado.servo = Object.assign({}, SERVO_BASE, e.servo);
    if (e.mision) Object.assign(estado.mision, e.mision);
  }

  function actualizar() {
    const root = document.querySelector('.servo-view'); if (!root) return;
    sincronizarControles(root);
    const r = calcular(), c = colores(), sv = estado.servo, sim = r.sim, pas = r.pas;

    // Paso 1
    $('sv-k1').innerHTML = pas ? [
      kpi('Periodo orbital', `${fmt(pas.periodo / 60, 2)} min`, `${fmt(estado.mision.h)} km · i = ${fmt(INC, 1)}°`),
      kpi('Duración de la pasada', mmss(pas.dur), `AOS ${fmt(pas.azAos)}° → LOS ${fmt(pas.azLos)}° de acimut`),
      kpi('Elevación máxima', `${fmt(pas.elMax, 1)}°`, `a ${fmt(pas.tca)} s del AOS`),
      kpi('Rango mínimo', `${fmt(pas.rangoMin / 1e3)} km`, 'distancia estación–satélite'),
      kpi('ω máx. línea de vista', `${fmt(pas.omegaMax, 3)} °/s`, 'lo que tiene que girar la antena'),
      kpi('Acimut máx. |dAz/dt|', `${fmt(pas.azRateMax, 3)} °/s`, `elevación: ${fmt(pas.elRateMax, 3)} °/s`)
    ].join('') : kpi('Pasada', '—', 'sin pasada visible con estos parámetros');

    // Paso 2
    const avisos = [];
    if (sim && sim.aviso) avisos.push(sim.aviso);
    if (sim && sim.diverge) avisos.push(`Lazo inestable (ρ = ${fmt(sim.rho, 3)} ≥ 1): la simulación se corta cuando la salida se dispara.`);
    if (sv.planta === 'p1' && sim && sim.angular) avisos.push('El servo de laboratorio de la P1 sigue aquí una referencia angular solo como ejercicio: su inercia no es la de un pedestal de antena.');
    $('sv-aviso').hidden = !avisos.length; $('sv-aviso').textContent = avisos.join(' ');
    const k2 = [];
    if (sim) {
      k2.push(kpi('Radio espectral ρ', fmt(sim.rho, 3), sim.rho < 1 ? 'lazo cerrado estable' : 'lazo cerrado inestable', sim.rho < 1 ? '' : 'is-key'));
      if (sv.ref === 'escalon' && !sim.diverge) {
        const m = sim.met;
        k2.push(kpi('u(0)', fmt(m.u0, 2) + (sim.esP1 ? ' V' : ''), 'esfuerzo en la primera muestra'),
          kpi('Sobreoscilación', `${fmt(m.sobreosc, sim.esP1 ? 1 : 2)} %`, `pico ${fmt(m.pico, 2)} a ${fmtT(m.t_pico)} s`),
          kpi('Establecimiento (2 %)', isFinite(m.ts2) ? `${fmt(m.ts2, 3)} s` : 'no se establece', `T = ${fmtT(sim.T)} s`),
          kpi('máx. |uI|', fmt(sim.uImaxAbs, 1), `máx. |u| = ${fmt(sim.umax, 1)}`));
      } else if (sv.ref === 'cuadrada' && !sim.diverge) {
        k2.push(kpi('u(0)', fmt(sim.u0, 1), 'flanco de subida'), kpi('u en el flanco de bajada', fmt(sim.uFlanco, 1), `muestra ${sim.semi}`),
          kpi('Pico de la salida', fmt(sim.pico, 2), sv.der === 'salida' ? 'derivada de la salida: sin kick' : 'derivada del error: con kick'));
      } else if (sv.ref === 'rampa' && !sim.diverge) {
        k2.push(kpi('Error estacionario', `${fmtSci(Math.abs(sim.eFin), 1)} rad`, `${fmt(Math.abs(sim.eFin) * R2D, 4)}° · Ω₀/Km = ${fmt(sv.omega0 / Km, 5)} rad con P`),
          kpi('máx. |u|', fmt(sim.umax, 3), `Ω₀ = ${fmt(sv.omega0, 3)} rad/s`));
      } else if (sv.ref === 'pasada' && !sim.diverge) {
        k2.push(kpi('Desviación máx. del haz', `${fmt(sim.eMax * R2D, 3)}°`, `a ${fmt(sim.tEmax, 1)} s del AOS`),
          kpi(sv.eje === 'az' ? 'Error máx. del eje de acimut' : 'Error máx. del eje de elevación', `${fmt(sim.eEjeMax * R2D, 3)}°`,
            sv.eje === 'az' ? 'se proyecta con cos(el) sobre el haz' : 'coincide con la desviación del haz'),
          kpi('Desviación eficaz', `${fmt(sim.eRms * R2D, 4)}°`, 'a lo largo de la pasada'),
          kpi('máx. |u|', fmt(sim.umax, 3), sv.sat ? `saturación ±${fmt(sv.U)}` : 'sin saturación'));
      }
    }
    $('sv-k2').innerHTML = k2.join('');

    // Paso 3
    const hz = r.hz, L = r.L, err = sim ? sim.errDeg : null;
    const semTxt = r.clase === 'na'
      ? 'Esta referencia es una prueba del guion: no define un error de apuntamiento. Elige «Pasada» o «Rampa» para llevar el error al haz.'
      : `${ESTADO_LBL[r.clase]} · error de ${fmt(err, 3)}° frente a θ3dB/4 = ${fmt(hz.hpbw / 4, 3)}° y θ3dB/2 = ${fmt(hz.hpbw / 2, 3)}°`;
    $('sv-sem').innerHTML = `<span class="servo-dot is-${r.clase}" aria-hidden="true"></span><span>${semTxt}</span>`;
    const perdTxt = v => (L.na ? '—' : isFinite(v) ? `${fmt(v, 2)} dB` : 'sin señal');
    $('sv-k3').innerHTML = [
      kpi('θ3dB (HPBW)', `${fmt(hz.hpbw, 3)}°`, `D = ${fmt(estado.mision.D, 1)} m · f = ${fmt(estado.mision.fGHz, 1)} GHz`),
      kpi('FNBW', `${fmt(hz.fnbw, 3)}°`, `primer lóbulo lateral −${fmt(hz.nlps, 1)} dB`),
      kpi('Error de seguimiento', err == null ? '—' : isFinite(err) ? `${fmt(err, 3)}°` : '∞', sv.ref === 'pasada' ? 'máximo de la pasada' : sv.ref === 'rampa' ? 'error estacionario' : 'no aplica'),
      kpi('Pérdida de ida', perdTxt(L.ida), 'enlace de telemetría'),
      kpi('Pérdida de ida y vuelta', perdTxt(L.idaVuelta), 'radar monoestático', L.na ? '' : 'is-key')
    ].join('');

    // Paso 4
    $('sv-k4').innerHTML = [
      kpi('Ganancia de la antena', `${fmt(r.gan.GdBi, 2)} dBi`, `A_ef = ${fmt(r.gan.Aef, 3)} m²`),
      kpi('R_max del radar', `${fmt(r.Rmax / 1e3, 2)} km`, `horizonte (30 m / 3000 m): ${fmt(r.hor, 2)} km`),
      kpi('Alcance efectivo', L.na ? '—' : `${fmt(r.Ref / 1e3, 2)} km`, L.na ? 'sin error de apuntamiento definido' : (100 * (1 - r.Ref / r.Rmax) < 0.05 ? 'sin pérdida por apuntamiento' : `−${fmt(100 * (1 - r.Ref / r.Rmax), 1)} % por apuntamiento`), 'is-key'),
      kpi('SNR mínima de la pasada', isFinite(r.snrMin) ? `${fmt(r.snrMin, 1)} dB` : 'sin señal',
        sv.ref === 'pasada' && isFinite(r.snrMin) && r.L.ida > 0.5 && r.snrMin0 - r.snrMin < 0.5
          ? `ideal: ${fmt(r.snrMin0, 1)} dB · el mínimo cae en el borde de la pasada, lejos del cenit donde el error es máximo`
          : `ideal: ${fmt(r.snrMin0, 1)} dB`),
      kpi('Margen mínimo', isFinite(r.snrMin) ? `${fmt(r.snrMin - TM.snrMin, 1)} dB` : '—', `sobre ${TM.snrMin} dB de SNR · P_t = ${fmt(estado.enlace.PtSat, 1)} W`)
    ].join('');
    $('sv-nota4').textContent = pas
      ? `El satélite nunca se acerca a menos de ${fmt(pas.rangoMin / 1e3)} km: queda fuera del alcance del radar del caso de estudio (${fmt(r.Rmax / 1e3)} km). Para el satélite lo que cuenta es el enlace de telemetría; el radar muestra cuánto alcance cuesta el mismo error.`
      : '';

    // Resumen del panel de misión
    $('sv-resumen').innerHTML = [
      ['Pasada', pas ? `${mmss(pas.dur)} · ${fmt(pas.elMax, 0)}°` : '—'],
      ['Error de apuntamiento', err == null ? 'no aplica' : isFinite(err) ? `${fmt(err, 3)}°` : 'inestable'],
      ['Semáforo', `<span class="servo-dot is-${r.clase}" aria-hidden="true"></span>${ESTADO_LBL[r.clase]}`],
      ['Pérdida (ida y vuelta)', perdTxt(L.idaVuelta)],
      ['Alcance efectivo radar', `<span class="servo-key">${L.na ? '—' : fmt(r.Ref / 1e3, 2) + ' km'}</span>`],
      ['Margen de telemetría', isFinite(r.snrMin) ? `${fmt(r.snrMin - TM.snrMin, 1)} dB` : '—']
    ].map(([a, b]) => `<div class="servo-resumen-row"><span>${a}</span><strong>${b}</strong></div>`).join('');

    graficasPaso1(r, c); graficasPaso2(r, c); graficasPaso3(r, c); graficasPaso4(r, c);
  }

  let programado = false;
  function programar() {
    if (programado) return;
    programado = true;
    requestAnimationFrame(() => { programado = false; actualizar(); });
  }

  function conectar(root) {
    root.addEventListener('input', e => {
      const d = SLIDERS[e.target.id]; if (!d) return;
      d.set(+e.target.value); estado.modificado = true; programar();
    });
    root.addEventListener('change', e => {
      if (e.target.id === 'sv-sat') { estado.servo.sat = e.target.checked; estado.modificado = true; programar(); }
    });
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-grupo]');
      if (b) { estado.servo[b.dataset.grupo] = b.dataset.val; estado.modificado = true; programar(); return; }
      const s = e.target.closest('[data-escenario]');
      if (s) { aplicarEscenario(s.dataset.escenario); programar(); }
    });
  }

  function renderPendiente(fase, container) {
    const txt = fase.id === 'telemetria'
      ? 'Fase 2: modulación de la telemetría (DSB, AM y FM de la Práctica 3) y su demodulación, con el VOR como caso de estudio final.'
      : 'Fase 3: control de actitud del satélite con el mismo PID sobre un doble integrador con volante de inercia saturable.';
    container.innerHTML = `
      <div class="servo-view">
        <header class="section-head reveal">
          <span class="section-index">${fase.id === 'telemetria' ? 'F2' : 'F3'}</span>
          <div><span class="eyebrow">Próximamente</span><h2 class="section-title">${fase.label}</h2></div>
          <p class="section-intro">${txt}</p>
        </header>
      </div>`;
  }

  window.renderServoFase = function (id, container) {
    if (typeof Plotly !== 'undefined') container.querySelectorAll('.js-plotly-plot').forEach(el => Plotly.purge(el));
    const fase = window.SERVO_FASES.find(f => f.id === id) || window.SERVO_FASES[0];
    if (fase.pending) { renderPendiente(fase, container); return; }
    if (!S || !R) {
      container.innerHTML = '<p class="servo-text">No se ha podido cargar el motor numérico (servo-sim.js / servo-radar.js).</p>';
      return;
    }
    container.innerHTML = plantilla();
    const root = container.querySelector('.servo-view');
    conectar(root);
    tablaValidacion();
    actualizar();
  };
})();
