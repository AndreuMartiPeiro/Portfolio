/**
 * servo-view.js — Vista del proyecto «Seguimiento de un satélite de órbita baja desde una estación terrena».
 *
 * Fase 1 (núcleo): una sola vista con recorrido por pasos y un panel de misión con parámetros compartidos.
 *   Paso 1  Pasada orbital ............ desarrollo propio (órbita kepleriana circular, servo-radar.js)
 *   Paso 2  Pedestal de seguimiento ... Práctica 1 (PID digital corregido, servo-sim.js)
 *   Paso 3  Haz y pérdida ............. Práctica 4 (diagrama del reflector) + acoplamiento propio
 *   Paso 4  Enlace .................... problema del radar (ecuación del radar) + Friis (propio)
 *   Paso 5  Telemetría ................ Práctica 3 (DSB, AM, FM, demodulación, VOR; servo-telemetria.js)
 *                                       + enlace de telemetría con la pérdida del paso 3 (desarrollo propio)
 *   Paso 6  Actitud ................... desarrollo propio (doble integrador + volante saturable, servo-actitud.js)
 *                                       con el PID de la Práctica 1; requisito de la pasada del paso 1
 * Cambiar la altitud o la elevación máxima recalcula la pasada y, con ella, todos los pasos.
 *
 * Depende de window.ServoSim (servo-sim.js), window.ServoRadar (servo-radar.js),
 * window.ServoTelemetria (servo-telemetria.js), window.ServoActitud (servo-actitud.js) y Plotly.
 * Expone window.SERVO_FASES y window.renderServoFase(id, contenedor), que usa el router de app.js.
 * Los colores de las gráficas se leen de los tokens de :root (styles.css); no hay colores escritos a mano.
 */
(function () {
  'use strict';

  const S = window.ServoSim, R = window.ServoRadar, Tm = window.ServoTelemetria, At = window.ServoActitud;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  // La telemetría (antes fase 2) y el control de actitud (antes fase 3 pendiente) son ahora los pasos 5 y 6 de la
  // misma vista: comparten la pasada del paso 1 y la pérdida del paso 3. Ya no queda ninguna fase pendiente.
  window.SERVO_FASES = [
    { id: 'seguimiento', label: 'Seguimiento, enlace, telemetría y actitud' }
  ];

  // ------------------------------------------------------------------ datos fijos
  const EST = { latDeg: 39.470, lonDeg: -0.376 };      // estación de ejemplo (Valencia)
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
    { id: 'leo', grupo: 'mision', lbl: 'Pasada LEO a 45°', mision: { h: 550, elMax: 45, D: 4, fGHz: 3 }, servo: {},
      texto: 'Pasada de 45° de elevación máxima a 550 km. El pedestal del caso de estudio (regulador P, Km = 6,944) sigue el acimut del satélite.',
      ref: 'Desarrollo propio, sin cifra de referencia externa.' },
    { id: 'cenit', grupo: 'mision', lbl: 'Pasada casi cenital', mision: { h: 550, elMax: 85, D: 4, fGHz: 3 }, servo: {},
      texto: 'Cerca del cenit el acimut gira muy deprisa (≈ 9 °/s frente a 0,8 °/s a 45°): es el «keyhole» de un pedestal acimut-elevación. El error del eje de acimut se dispara, pero el haz apenas se desvía porque ese error se proyecta con cos(el). Lo que de verdad limita es la velocidad y la aceleración que se piden al motor de acimut.',
      ref: 'Desarrollo propio, sin cifra de referencia externa.' },
    { id: 'cenit-pi', grupo: 'mision', paso: 2, lbl: 'Cenital con regulador PI', mision: { h: 550, elMax: 85, D: 4, fGHz: 3 }, servo: { T: 0.005, KI: 5 },
      texto: 'La misma pasada con acción integral (KI = 5): el lazo pasa a tipo 2 y sigue una rampa sin error; el error del eje de acimut baja a una séptima parte y solo queda el debido a su aceleración.',
      ref: 'Desarrollo propio: compárese con «Pasada casi cenital».' },
    // Casos estudiados: sus chips están dentro del paso donde se ve el efecto, junto a los controles que cambian.
    // `donde`: bloque de chips que los muestra ('pedestal' en el paso 2, 'demod' en el paso 5). `mirar`: qué observar.
    { id: 'e1', grupo: 'caso', donde: 'pedestal', origen: 'P1', lbl: 'Ajuste del guion', servo: { planta: 'p1', T: 0.0625, KP: 4, KI: 8, KD: 1, ref: 'escalon' },
      texto: 'Ajuste del guion de la Práctica 1 (KP = 4, KD = 1, KI = 8) ante un escalón de 10 en las unidades del guion.',
      mirar: 'La sobreoscilación de la salida (casi la mitad del escalón) y el pico de u(0) = 202,5 V en la curva de control.',
      ref: 'Python: u(0) = 202,50 · pico 14,88 a 0,3125 s · Mp 48,8 % · ts(2 %) 1,625 s · ρ 0,862.' },
    { id: 'e3', grupo: 'caso', donde: 'pedestal', origen: 'P1', lbl: 'Windup con actuador saturado', servo: { planta: 'p1', T: 0.0625, KP: 4, KI: 8, KD: 1, ref: 'escalon', sat: true, U: 10 },
      texto: 'Actuador saturado a ±10 V. Cambia el anti-windup para ver cómo se recupera la respuesta.',
      mirar: 'Cambia «Anti-windup» entre Ninguno, Acotar y Congelar y compara la sobreoscilación y la curva de control.',
      ref: 'Python: sin anti-windup 86,9 % (uI máx. 32,1) · acotar 25,0 % · congelar 18,6 %.' },
    { id: 'e4', grupo: 'caso', donde: 'pedestal', origen: 'P1', lbl: 'Derivative kick', servo: { planta: 'p1', T: 0.0625, KP: 4, KI: 8, KD: 1, ref: 'cuadrada' },
      texto: 'Onda cuadrada 0/10 con semiperiodo de 100 muestras (6,25 s). Cambia la derivada del error a la de la salida.',
      mirar: 'Los picos de u en cada flanco de la cuadrada: pasa «Derivada» a «De la salida» y se reducen a una quinta parte.',
      ref: 'Python: u en los flancos ±202,5 (derivada del error) frente a ±42,5 (derivada de la salida).' },
    { id: 'e7', grupo: 'caso', donde: 'pedestal', origen: 'Radar', lbl: 'Blanco al doble de velocidad', mision: { D: 4, fGHz: 3 }, servo: { T: 0.001, ref: 'rampa', omega0: 0.10 },
      texto: 'El mismo pedestal con el blanco al doble de velocidad angular (0,10 rad/s). Fija la antena del panel de misión (4 m a 3 GHz), de la que dependen la pérdida y el alcance.',
      mirar: 'El «Error estacionario» de la rampa se duplica (0,825°) y el semáforo del paso 3 pasa a «Fuera del semihaz»: la pérdida se multiplica por más de cuatro.',
      ref: 'Python: e_ss 0,825° · pérdida 7,67 dB · R_ef 114,3 km (fuera del semihaz).' },
    { id: 'e9', grupo: 'caso', donde: 'pedestal', origen: 'Radar', lbl: 'PI en el pedestal', servo: { T: 0.005, KI: 5, ref: 'rampa', omega0: 0.05 },
      texto: 'Acción integral en el pedestal (KI = 5) ante la rampa de 0,05 rad/s.',
      mirar: 'El «Error estacionario» de la rampa: con KI = 5 es prácticamente nulo; baja KI a 0 y vuelve a Ω₀/Km ≈ 0,0072 rad.',
      ref: 'Python: e(10 s) ≈ 3·10⁻⁶ rad: el blanco queda centrado en el haz.' },
    { id: 'p3-am', grupo: 'caso', donde: 'demod', origen: 'P3', lbl: 'AM sobremodulada', tm: { mod: 'am', beta: 0.85 },
      texto: 'Parámetros de la Práctica 3: AM de un tono de 20 Hz sobre 250 Hz con β = 0,85. Con el mensaje del enunciado (1 / −2 / 0), β·max|m| = 1,70 > 1: la meseta −2 no se recupera con el detector de envolvente.',
      mirar: 'La meseta central sale en −0,353 en vez de −2; baja β a 0,4 y se recupera.',
      ref: 'Python (P3 corregida): líneas 0,500 en 250 Hz y 0,2125 en 230/270 Hz · mesetas +1,000 / −0,353 / 0,000 (con β = 0,4: −2,000).' },
    { id: 'tm-e7', grupo: 'mision', paso: 5, bloque: 'sv-bloque-enlace', lbl: 'Telemetría con blanco ×2', mision: { D: 4, fGHz: 3 }, servo: { T: 0.001, ref: 'rampa', omega0: 0.10 },
      tm: { mod: 'fm', kf: 80, enl: 'fm', snrRef: 20 },
      texto: 'El error del caso «Blanco al doble de velocidad» (0,10 rad/s) cuesta 3,84 dB en un trayecto. Con una SNR de referencia de 20 dB el enlace FM (β_FM = 4) está por encima del umbral; con la pérdida cae por debajo y la tasa de error se dispara: es el efecto umbral de la FM. La AM pierde lo mismo en dB, pero sin umbral tan abrupto.',
      ref: 'Desarrollo propio (modelo de libro): FM Pb 6,9·10⁻¹² → 6,3·10⁻² · AM (β = 0,85) Pb 4,7·10⁻¹¹ → 1,6·10⁻⁵.' },
    { id: 'at-nom', grupo: 'mision', paso: 6, lbl: 'Actitud nominal', mision: { h: 500, elMax: 88 }, act: {},
      texto: 'Paso 6 con el microsatélite por defecto (J = 2 kg·m², volante de 10 mN·m y 0,1 N·m·s, τd = 1 µN·m) y el PD de ωn = 0,1 rad/s y ζ = 0,7 (KP = 0,02, KD = 0,28) ante una maniobra de 30°. KP·30° = 10,47 mN·m: el par se recorta a 10 mN·m solo en la primera muestra. Pasada casi cenital a 500 km: el cuerpo tiene que girar a ≈ v/h ≈ 0,015 rad/s y el volante almacena J·ω ≈ 0,03 N·m·s, por debajo de su límite.',
      ref: 'Python: Mp 4,51 % · ts(2 %) 59,4 s · par recortado a 10 mN·m en t = 0 · pasada cenital analítica a 500 km: h = 0,0305 N·m·s, el volante aguanta.' },
    { id: 'at-chico', grupo: 'mision', paso: 6, lbl: 'Volante sub-dimensionado', mision: { h: 500, elMax: 88 }, act: { tauMax: 2, hMax: 0.02 },
      texto: 'El mismo satélite con un volante de 2 mN·m y 0,02 N·m·s. La maniobra de 30° pasa casi entera con el par saturado y el satélite no puede pasar de hmax/J = 0,01 rad/s: en la pasada cenital el volante se llena antes del cenit y la estación se pierde.',
      ref: 'Desarrollo propio: momento necesario ≈ 0,03 N·m·s frente a 0,02 (margen < 1): el volante no aguanta.' }
  ];
  const TM_BASE = { mod: 'am', beta: 0.85, kf: 80, Am: 1, fm: 20, theta: 45, snrRef: 20, enl: 'am' };

  // Paso 6 (actitud). Unidades de los controles: τmax en mN·m, τd y τm,max en µN·m, ángulos en ° y °/s.
  const T_ACT = [0.05, 0.1, 0.2, 0.5, 1];
  const KDES = [1e-4, 3e-4, 1e-3, 3e-3, 1e-2];
  const ACT_BASE = At ? { modo: 'polos', wn: At.SAT.wn, zeta: At.SAT.zeta, KP: 0.02, KD: 0.28, KI: 0, J: At.SAT.J,
    tauMax: At.SAT.tauMax * 1e3, hMax: At.SAT.hMax, tauD: At.SAT.tauD * 1e6, T: At.SAT.T, man: 'escalon', thF: 30, wLim: 0.5,
    hor: 120, aw: 'ninguno', der: 'salida', des: false, kDes: At.SAT.kDes, tmMax: At.SAT.tauMMax * 1e6 } : {};

  // ------------------------------------------------------------------ estado (persiste al cambiar de pestaña)
  const estado = {
    mision: { h: 550, elMax: 45, D: 4, fGHz: 3 },
    servo: Object.assign({}, SERVO_BASE),
    enlace: { PtSat: 1 },
    tm: Object.assign({}, TM_BASE),
    act: Object.assign({}, ACT_BASE),
    escenario: 'leo',
    modificado: false
  };
  const cache = { clave: null, pasada: null, calc: null, calcClave: null, mod: null, modClave: null,
    demod: null, demodClave: null, vor: null, vorClave: null, act: null, actClave: null, actPas: null, actPasClave: null };

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
  /** calcular() solo depende de la misión, el servo y el enlace: los controles del paso 5 no relanzan el servo. */
  function calcularCache() {
    const clave = JSON.stringify([estado.mision, estado.servo, estado.enlace]);
    if (cache.calcClave !== clave) { cache.calc = calcular(); cache.calcClave = clave; }
    return cache.calc;
  }

  // ------------------------------------------------------------------ paso 5: telemetría (Práctica 3 + enlace propio)
  /** Modulación de un tono A_m·cos(2π f_m t) sobre la portadora de 250 Hz, con los parámetros de la P3. */
  function calcModulacion(p) {
    const P3 = Tm.P3, fm = p.mod === 'fm', fs = fm ? P3.fsFM : P3.fs;
    const t = Tm.tiempos(fs, P3.t0), m = Tm.tono(t, p.fm).map(v => v * p.Am), c = Tm.tono(t, P3.fc);
    let x, env = null, deltaF = 0, bw;
    if (p.mod === 'dsb') { x = Tm.dsbam(m, c); env = m; bw = 2 * p.fm; }
    else if (p.mod === 'am') { x = Tm.am(m, c, p.beta); env = m.map(v => 1 + p.beta * v); bw = 2 * p.fm; }
    else { const s = Tm.fm(t, m, P3.fc, p.kf); x = s.x; deltaF = s.deltaF; bw = Tm.carson(deltaF, p.fm); }
    const X = Tm.xf(x, t), coef = Tm.coeficientes(X, P3.t0);
    const out = { t, m, x, env, X, coef, deltaF, bw, fs, betaFM: fm ? Tm.betaFM(deltaF, p.fm) : null,
      linea: f => Tm.lineaEn(X, f, P3.t0), indice: p.beta * p.Am };
    if (fm) out.lineasFM = [0, 1, 2, 3].map(n => ({ n, f: P3.fc + n * p.fm, a: out.linea(P3.fc + n * p.fm),
      bessel: Math.abs(Tm.besselJ(n, out.betaFM)) / 2 }));
    return out;
  }
  function calcTelemetria(r) {
    const p = estado.tm;
    const kMod = [p.mod, p.beta, p.kf, p.Am, p.fm].join('|');
    if (cache.modClave !== kMod) { cache.mod = calcModulacion(p); cache.modClave = kMod; }
    if (cache.demodClave !== p.beta) { cache.demod = Tm.casoDemodAM(p.beta); cache.demodClave = p.beta; }
    if (cache.vorClave !== p.theta) { cache.vor = Tm.casoVOR(p.theta, 0); cache.vorClave = p.theta; }
    // Enlace: la pérdida de ida del paso 3 (un trayecto) rebaja la SNR de referencia
    const perdidaDb = r.L.na ? 0 : r.L.ida;
    const betaFM = p.kf * p.Am / p.fm;
    const op = { snrRefDb: p.snrRef, modulacion: p.enl, beta: p.beta, betaFM };
    const enl = Tm.telemetria(Object.assign({ perdidaDb }, op));
    const enl0 = Tm.telemetria(Object.assign({ perdidaDb: 0 }, op));
    return { mod: cache.mod, demod: cache.demod, vor: cache.vor, enl, enl0, perdidaDb, betaFM, op };
  }

  // ------------------------------------------------------------------ paso 6: actitud (desarrollo propio + PID de la P1)
  /** Mantiene coherentes las dos formas de dar el diseño: polos (ωn, ζ) → ganancias, o ganancias → (ωn, ζ). */
  function sincronizarDiseno(a) {
    if (a.modo === 'polos') Object.assign(a, At.disenoPD(a.J, a.wn, a.zeta));
    else Object.assign(a, At.parametrosPD(a.J, a.KP, a.KD));
  }
  /** Opciones comunes de ServoActitud.simular a partir del estado del paso 6 (unidades SI). */
  function opcionesActitud(a) {
    const tauMax = a.tauMax * 1e-3;
    return { J: a.J, T: a.T, KP: a.KP, KI: a.KI, KD: a.KD, tauMax, hMax: a.hMax, tauD: a.tauD * 1e-6,
      descarga: a.des ? { kDes: a.kDes, tauMMax: a.tmMax * 1e-6 } : null,
      antiWindup: a.aw, uImax: tauMax, derivada: a.der };
  }
  function simActitud(a) {
    const clave = JSON.stringify(a);
    if (cache.actClave === clave) return cache.act;
    const N = Math.round(a.hor / a.T) + 1, thF = a.thF * D2R;
    const ref = a.man === 'perfil' ? At.perfilApuntamiento(N, a.T, thF, a.wLim * D2R) : At.escalon(N, thF);
    const s = At.simular(Object.assign({ ref, N }, opcionesActitud(a)));
    const m = At.metricas(s);
    cache.act = { s, m, H: At.momentoTotal(s), thF, parPedido: a.KP * thF };
    cache.actClave = clave;
    return cache.act;
  }
  /**
   * Seguimiento de la pasada del paso 1: el cuerpo gira con la línea de vista (ω(t) de la pasada) para apuntar a la
   * estación. Requisito analítico (ServoActitud.requisitoSeguimiento) + simulación con los mismos controles.
   */
  function actitudPasada(a, pas) {
    if (!pas) return null;
    const clave = JSON.stringify([a, estado.mision.h, estado.mision.elMax]);
    if (cache.actPasClave === clave) return cache.actPas;
    const g = pas.g, wRad = g.omega.map(v => v * D2R);
    const rq = At.requisitoSeguimiento({ omegaMax: pas.omegaMax * D2R, alfaMax: At.alfaDeSerie(g.tau, wRad),
      J: a.J, tauMax: a.tauMax * 1e-3, hMax: a.hMax, tauD: a.tauD * 1e-6, duracion: pas.dur });
    // referencia: integral trapezoidal de ω(t) interpolada linealmente en la rejilla de la pasada
    const T = a.T, N = Math.floor(pas.dur / T) + 1, ref = new Array(N), wAt = t => {
      const j = Math.min(g.tau.length - 2, Math.max(0, Math.floor(t / g.dtg))), s = (t - g.tau[j]) / g.dtg;
      return wRad[j] + (wRad[j + 1] - wRad[j]) * Math.min(1, Math.max(0, s));
    };
    let ang = 0;
    for (let k = 0; k < N; k++) { ref[k] = ang; ang += 0.5 * (wAt(k * T) + wAt((k + 1) * T)) * T; }
    const s = At.simular(Object.assign({ ref, N }, opcionesActitud(a)));
    let eMax = 0, hMaxSim = 0;
    const hNec = new Array(N);
    for (let k = 0; k < N; k++) {
      eMax = Math.max(eMax, Math.abs(s.e[k])); hMaxSim = Math.max(hMaxSim, Math.abs(s.h[k]));
      hNec[k] = a.J * wAt(k * T) + Math.abs(a.tauD * 1e-6) * k * T;
    }
    const m = At.metricas(s);
    cache.actPas = { rq, s, eMax, hMaxSim, hNec, tSatH: m.tSatH, tSatPar: m.tSatPar };
    cache.actPasClave = clave;
    return cache.actPas;
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

  /** Índices de las líneas más altas (máx. n), separadas al menos `sep` Hz, ordenadas por frecuencia. */
  function lineasDestacadas(f, a, f0, f1, umbral, n, sep) {
    const idx = [];
    for (let k = 0; k < f.length; k++) if (f[k] >= f0 && f[k] <= f1 && a[k] > umbral) idx.push(k);
    idx.sort((i, j) => a[j] - a[i]);
    const sel = [];
    for (const k of idx) { if (sel.length >= n) break; if (sel.every(s => Math.abs(f[s] - f[k]) >= sep)) sel.push(k); }
    return sel.sort((i, j) => f[i] - f[j]);
  }

  function graficasPaso5(t5, c) {
    const p = estado.tm, M = t5.mod, P3 = Tm.P3;
    const nom = { dsb: 'DSB-AM', am: 'AM', fm: 'FM' }[p.mod];
    // Señal en el tiempo (primeros 0,2 s)
    const tt = Array.from(M.t), trazas = [
      { x: tt, y: Array.from(M.x), name: `Señal ${nom}`, type: 'scatter', mode: 'lines', line: { color: c.text2, width: 1 }, hovertemplate: '%{y:.3f} V<extra>x(t)</extra>' }];
    if (M.env) {
      const e = Array.from(M.env);
      trazas.push({ x: tt, y: e, name: p.mod === 'am' ? 'Envolvente 1 + β·m(t)' : 'Mensaje ±m(t)', type: 'scatter', mode: 'lines', line: { color: c.accent, width: 1.5 }, hovertemplate: '%{y:.3f}<extra>envolvente</extra>' },
        { x: tt, y: e.map(v => -v), showlegend: false, type: 'scatter', mode: 'lines', line: { color: c.accent, width: 1.5 }, hoverinfo: 'skip' });
    } else {
      trazas.push({ x: tt, y: Array.from(M.m), name: 'Mensaje m(t)', type: 'scatter', mode: 'lines', line: { color: c.accent, width: 1.5 }, hovertemplate: '%{y:.3f}<extra>m</extra>' });
    }
    dibujar('sv-c-tm-t', trazas, layout(c, { xaxis: eje(c, 'Tiempo [s]', { range: [0, 0.2] }), yaxis: eje(c, 'Amplitud [V]') }));

    // Espectro de coeficientes |X|/T con las líneas anotadas
    const half = Math.max(60, 0.75 * M.bw), f0 = Math.max(0, P3.fc - half), f1 = Math.min(M.fs / 2, P3.fc + half);
    const fx = [], ay = [];
    for (let k = 0; k < M.X.N; k++) if (M.X.f[k] >= f0 && M.X.f[k] <= f1) { fx.push(M.X.f[k]); ay.push(M.coef[k]); }
    const sel = lineasDestacadas(fx, ay, f0, f1, 0.02, 5, Math.max(0.9 * p.fm, (f1 - f0) / 12));
    const anot = sel.map((k, i) => ({ x: fx[k], y: ay[k], xref: 'x', yref: 'y', showarrow: false, yanchor: 'bottom', yshift: 4 + (i % 2) * 14,
      text: `${fmt(fx[k])} Hz<br>${fmt(ay[k], 3)}`, font: { family: c.fontMono, size: 10, color: c.text2 } }));
    const bandaTxt = p.mod === 'fm' ? `Carson ${fmt(M.bw)} Hz` : `B = 2·f_m = ${fmt(M.bw)} Hz`;
    dibujar('sv-c-tm-f', [
      { x: fx, y: ay, type: 'bar', width: 1.2, marker: { color: c.text2 }, hovertemplate: '%{x:.0f} Hz · %{y:.4f} V<extra></extra>' },
      { x: sel.map(k => fx[k]), y: sel.map(k => ay[k]), type: 'scatter', mode: 'markers', marker: { color: c.accent, size: 6 }, hoverinfo: 'skip' }
    ], layout(c, { showlegend: false, hovermode: 'closest', bargap: 0,
      xaxis: eje(c, 'Frecuencia [Hz]', { range: [f0, f1], zeroline: false }),
      yaxis: eje(c, 'Coeficiente |X(f)|/T [V]', { range: [0, 1.45 * Math.max(0.05, ...ay)] }), annotations: anot,
      shapes: [{ type: 'rect', xref: 'x', yref: 'paper', x0: P3.fc - M.bw / 2, x1: P3.fc + M.bw / 2, y0: 0, y1: 1, fillcolor: c.line, line: { width: 0 }, layer: 'below' }],
      title: { text: `Banda sombreada: ${bandaTxt}`, font: { size: 10, color: c.text3 }, x: 0.01, xanchor: 'left', y: 0.97 } }));

    // Demodulación AM del mensaje del enunciado
    const D = t5.demod, td = Array.from(D.t);
    dibujar('sv-c-tm-d', [
      { x: td, y: Array.from(D.m), name: 'Mensaje original m(t)', type: 'scatter', mode: 'lines', line: { color: c.tertiary, width: 1.5, dash: 'dash' }, hovertemplate: '%{y:.3f}<extra>m</extra>' },
      { x: td, y: Array.from(D.correcta), name: 'Demodulado (v − 1)/β', type: 'scatter', mode: 'lines', line: { color: c.accent, width: 2 }, hovertemplate: '%{y:.3f}<extra>(v−1)/β</extra>' },
      { x: td, y: Array.from(D.guion), name: 'Fórmula del guion 2(v − 1)/β', type: 'scatter', mode: 'lines', line: { color: c.text3, width: 1, dash: 'dot' }, hovertemplate: '%{y:.3f}<extra>guion</extra>' }
    ], layout(c, { xaxis: eje(c, 'Tiempo [s]'), yaxis: eje(c, 'Mensaje [V]'), shapes: [hline(-2, c.text3)] }));

    // VOR en banda base: dos tramos del espectro (DC y 30 Hz | subportadora de 9960 Hz con su banda de Carson)
    const V = t5.vor, VO = Tm.VOR, xa = [], ya = [], xb = [], yb = [];
    const fb0 = VO.fsub - 700, fb1 = VO.fsub + 700;
    for (let k = 0; k < V.X.N; k++) {
      const f = V.X.f[k], a = V.X.abs[k] / VO.T;
      if (f >= 0 && f <= 60) { xa.push(f); ya.push(a); } else if (f >= fb0 && f <= fb1) { xb.push(f); yb.push(a); }
    }
    const lbl = (x, y, xr, txt, ys) => ({ x, y, xref: xr, yref: 'y', showarrow: false, yanchor: 'bottom', yshift: ys || 4, text: txt, font: { family: c.fontMono, size: 10, color: c.text2 } });
    dibujar('sv-c-vor-f', [
      { x: xa, y: ya, type: 'bar', width: 4, marker: { color: c.text2 }, hovertemplate: '%{x:.0f} Hz · %{y:.4f}<extra></extra>' },
      { x: xb, y: yb, type: 'bar', width: 6, xaxis: 'x2', marker: { color: c.text2 }, hovertemplate: '%{x:.0f} Hz · %{y:.4f}<extra></extra>' }
    ], layout(c, { showlegend: false, hovermode: 'closest', bargap: 0, margin: { l: 54, r: 18, t: 34, b: 42 },
      xaxis: eje(c, 'f [Hz]', { domain: [0, 0.2], range: [-8, 60], zeroline: false }),
      xaxis2: eje(c, 'Frecuencia [Hz]', { domain: [0.27, 1], range: [fb0, fb1], anchor: 'y', zeroline: false }),
      yaxis: eje(c, 'Coeficiente |X(f)|/T', { range: [0, 1.4] }),
      shapes: [{ type: 'rect', xref: 'x2', yref: 'paper', x0: VO.fsub - V.carson / 2, x1: VO.fsub + V.carson / 2, y0: 0, y1: 1, fillcolor: c.line, line: { width: 0 }, layer: 'below' }],
      annotations: [lbl(0, V.DC, 'x', `DC<br>${fmt(V.DC, 3)}`), lbl(30, V.A30, 'x', `30 Hz<br>${fmt(V.A30, 3)}`),
        lbl(VO.fsub, 0.55, 'x2', `Carson ≈ ${fmt(V.carson)} Hz`)] }));

    // Rumbo: los dos tonos de 30 Hz (referencia AM y fase de la subportadora FM)
    const tr = [], ra = [], rf = [];
    for (let i = 0; i <= 400; i++) {
      const ti = i * 0.1 / 400; tr.push(ti);
      ra.push(Math.cos(2 * Math.PI * VO.fref * ti + V.faseAM * D2R)); rf.push(Math.cos(2 * Math.PI * VO.fref * ti + V.faseFM * D2R));
    }
    dibujar('sv-c-vor-r', [
      { x: tr, y: ra, name: '30 Hz de referencia (AM)', type: 'scatter', mode: 'lines', line: { color: c.tertiary, width: 1.5, dash: 'dash' }, hovertemplate: '%{y:.3f}<extra>ref.</extra>' },
      { x: tr, y: rf, name: '30 Hz variable (fase de la FM)', type: 'scatter', mode: 'lines', line: { color: c.accent, width: 2 }, hovertemplate: '%{y:.3f}<extra>var.</extra>' }
    ], layout(c, { xaxis: eje(c, 'Tiempo [s]'), yaxis: eje(c, 'Tono de 30 Hz normalizado', { range: [-1.15, 1.15] }) }));

    // Enlace: tasa de error frente a la SNR de referencia, con el punto de trabajo
    const gs = [], berA = [], berF = [];
    const piso = 1e-15;
    for (let g = 0; g <= 40; g += 0.25) {
      gs.push(g);
      berA.push(Math.max(piso, Tm.telemetria({ perdidaDb: 0, snrRefDb: g, modulacion: 'am', beta: p.beta }).ber));
      berF.push(Math.max(piso, Tm.telemetria({ perdidaDb: 0, snrRefDb: g, modulacion: 'fm', betaFM: t5.betaFM }).ber));
    }
    const vline = (x, col, dash) => ({ type: 'line', xref: 'x', yref: 'paper', x0: x, x1: x, y0: 0, y1: 1, line: { color: col, width: 1.5, dash } });
    const gam = t5.enl.gammaDb, sh = [vline(p.snrRef, c.text3, 'dot')];
    if (isFinite(gam) && gam >= 0) sh.push(vline(gam, c.accent, 'solid'));
    dibujar('sv-c-tm-ber', [
      { x: gs, y: berA, name: `AM (β = ${fmt(p.beta, 2)})`, type: 'scatter', mode: 'lines', line: { color: p.enl === 'am' ? c.accent : c.text3, width: p.enl === 'am' ? 2 : 1.5 }, hovertemplate: '%{y:.2e}<extra>AM</extra>' },
      { x: gs, y: berF, name: `FM (β_FM = ${fmt(t5.betaFM, 1)})`, type: 'scatter', mode: 'lines', line: { color: p.enl === 'fm' ? c.accent : c.text3, width: p.enl === 'fm' ? 2 : 1.5, dash: p.enl === 'fm' ? 'solid' : 'dash' }, hovertemplate: '%{y:.2e}<extra>FM</extra>' }
    ], layout(c, { legend: { orientation: 'v', x: 0.02, xanchor: 'left', y: 0.04, yanchor: 'bottom', font: { size: 11, color: c.text2 }, bgcolor: 'transparent' },
      xaxis: eje(c, 'SNR en la banda del mensaje γ [dB]', { range: [0, 40] }),
      yaxis: eje(c, 'Tasa de error de bit', { type: 'log', range: [-15, 0], exponentformat: 'power', dtick: 3 }), shapes: sh,
      title: { text: 'Punteada: γ_ref · naranja: con la pérdida del paso 3', font: { size: 10, color: c.text3 }, x: 0.01, xanchor: 'left', y: 0.97 } }));
  }

  function graficasPaso6(a6, ap, c) {
    const a = estado.act, s = a6.s, tl = { font: { size: 10, color: c.text3 }, x: 0.01, xanchor: 'left', y: 0.97 };
    const rv = diezmar(s.t, s.r, 900, R2D), yv = diezmar(s.t, s.theta, 900, R2D);
    dibujar('sv-c-at-th', [
      { x: rv.x, y: rv.y, name: a.man === 'perfil' ? 'Referencia (perfil con ω limitada)' : 'Referencia (escalón)', type: 'scatter', mode: 'lines', line: { color: c.tertiary, width: 1.5, dash: 'dash' }, hovertemplate: '%{y:.3f}°<extra>r</extra>' },
      { x: yv.x, y: yv.y, name: 'Ángulo del satélite θ(t)', type: 'scatter', mode: 'lines', line: { color: c.accent, width: 2 }, hovertemplate: '%{y:.3f}°<extra>θ</extra>' }
    ], layout(c, { xaxis: eje(c, 'Tiempo [s]'), yaxis: eje(c, 'Ángulo [°]') }));

    const uv = diezmar(s.t, s.u, 900, 1e3), lim = a.tauMax;
    const tr = [{ x: uv.x, y: uv.y, name: 'Par del volante τc', type: 'scatter', mode: 'lines', line: { color: c.accent, width: 1.5 }, hovertemplate: '%{y:.4f} mN·m<extra>τc</extra>' }];
    if (a.des) tr.push(Object.assign({ name: 'Magnetopares τm', type: 'scatter', mode: 'lines', line: { color: c.tertiary, width: 1.5, dash: 'dot' }, hovertemplate: '%{y:.4f} mN·m<extra>τm</extra>' }, diezmar(s.t, s.tauM, 900, 1e3)));
    dibujar('sv-c-at-u', tr, layout(c, { showlegend: a.des, xaxis: eje(c, 'Tiempo [s]'), yaxis: eje(c, 'Par [mN·m]'),
      shapes: [hline(lim, c.text2, 'dash'), hline(-lim, c.text2, 'dash')],
      title: Object.assign({ text: a.des ? '' : `Discontinua: saturación ±${fmt(lim, 1)} mN·m` }, tl) }));

    const hv = diezmar(s.t, s.h, 900), Hv = diezmar(s.t, a6.H, 900);
    dibujar('sv-c-at-h', [
      { x: hv.x, y: hv.y, name: 'Momento del volante h_w', type: 'scatter', mode: 'lines', line: { color: c.accent, width: 1.5 }, hovertemplate: '%{y:.5f} N·m·s<extra>h_w</extra>' },
      { x: Hv.x, y: Hv.y, name: 'Total J·ω + h_w', type: 'scatter', mode: 'lines', line: { color: c.tertiary, width: 1.5, dash: 'dot' }, hovertemplate: '%{y:.5f} N·m·s<extra>total</extra>' }
    ], layout(c, { xaxis: eje(c, 'Tiempo [s]'), yaxis: eje(c, 'Momento angular [N·m·s]'),
      shapes: [hline(a.hMax, c.text2, 'dash'), hline(-a.hMax, c.text2, 'dash')] }));

    const wrap = document.getElementById('sv-at-pasada-charts');
    if (wrap) wrap.hidden = !ap;
    if (!ap) return;
    const sp = ap.s, hs = diezmar(sp.t, sp.h.map(Math.abs), 900), hn = diezmar(sp.t, ap.hNec, 900);
    dibujar('sv-c-at-ph', [
      { x: hn.x, y: hn.y, name: 'Necesario J·ω(t) + |τd|·t', type: 'scatter', mode: 'lines', line: { color: c.tertiary, width: 1.5, dash: 'dash' }, hovertemplate: '%{y:.5f} N·m·s<extra>necesario</extra>' },
      { x: hs.x, y: hs.y, name: 'Simulado |h_w|', type: 'scatter', mode: 'lines', line: { color: c.accent, width: 2 }, hovertemplate: '%{y:.5f} N·m·s<extra>simulado</extra>' }
    ], layout(c, { xaxis: eje(c, 'Tiempo desde AOS [s]'), yaxis: eje(c, 'Momento del volante [N·m·s]', { rangemode: 'tozero' }),
      shapes: [hline(a.hMax, c.text2, 'dash')] }));
    const ev = diezmar(sp.t, sp.e, 900, R2D);
    dibujar('sv-c-at-pe', [
      { x: ev.x, y: ev.y, name: 'Error de apuntamiento del satélite', type: 'scatter', mode: 'lines', line: { color: c.accent, width: 1.5 }, hovertemplate: '%{y:.4f}°<extra>e</extra>' }
    ], layout(c, { showlegend: false, xaxis: eje(c, 'Tiempo desde AOS [s]'), yaxis: eje(c, 'Error r − θ [°]'),
      title: Object.assign({ text: 'Error del cuerpo frente a la línea de vista a la estación' }, tl) }));
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
  // obj = 'tm' para los controles del paso 5 (estado.tm); por defecto, estado.servo
  const seg = (grupo, lbl, ops, obj) => `
    <div class="servo-ctrl" data-grupo-wrap="${grupo}">
      <span class="servo-lbl">${lbl}</span>
      <div class="servo-seg" role="group" aria-label="${lbl}">${ops.map(([v, t]) => `<button type="button" data-grupo="${grupo}"${obj ? ` data-obj="${obj}"` : ''} data-val="${v}">${t}</button>`).join('')}</div>
    </div>`;
  const objDe = b => (b.dataset.obj === 'tm' ? estado.tm : b.dataset.obj === 'act' ? estado.act : estado.servo);
  const kpi = (lbl, val, sub, cls) => `
    <div class="servo-kpi"><span class="servo-kpi-lbl">${lbl}</span><span class="servo-kpi-val${cls ? ' ' + cls : ''}">${val}</span>${sub ? `<span class="servo-kpi-sub">${sub}</span>` : ''}</div>`;
  const chart = (id, wide) => `<div class="servo-chart-wrap${wide ? ' is-wide' : ''}"><div class="servo-chart" id="${id}"></div></div>`;

  const chipEscenario = e => `<button type="button" class="servo-chip" data-escenario="${e.id}">${e.origen ? `<span class="servo-chip-tag">${e.origen}</span>` : ''}${e.lbl}</button>`;
  // Bloque de casos estudiados dentro de un paso: chips, descripción, «Qué mirar» y «Referencia · Python»
  const bloqueCasos = (donde, titulo, sub) => `
            <div class="servo-casos" data-casos="${donde}">
              <div class="servo-casos-head">
                <span class="servo-lbl">${titulo}</span>
                <p class="servo-esc-grupo-sub">${sub}</p>
              </div>
              <div class="servo-chips" role="group" aria-label="${titulo}">
                ${ESCENARIOS.filter(e => e.donde === donde).map(chipEscenario).join('')}
              </div>
              <div class="servo-casos-det" data-casos-det hidden>
                <p class="servo-esc-texto" data-casos-texto></p>
                <p class="servo-esc-mirar"><span class="servo-lbl">Qué mirar</span><span data-casos-mirar></span></p>
                <p class="servo-esc-ref" data-casos-ref></p>
              </div>
            </div>`;

  // ------------------------------------------------------------------ introducción (carrusel de tarjetas)
  const PASOS_INTRO = [
    [1, 'Pasada orbital', 'Acimut, elevación, rango y ω(t)'],
    [2, 'Pedestal de seguimiento', 'Error de apuntamiento'],
    [3, 'Haz y apuntamiento', 'Pérdida en dB'],
    [4, 'Enlace', 'Alcance y SNR'],
    [5, 'Telemetría', 'Tasa de error de bit'],
    [6, 'Actitud', '¿Aguanta el volante?']
  ];
  const INTRO_TABS = ['Qué hacemos', 'La cadena', 'Para qué', 'Origen', 'Cómo usarlo'];

  function plantillaIntro() {
    const flujo = PASOS_INTRO.map(([n, t, sale]) => `
              <li class="servo-flujo-item${n === 6 ? ' is-rama' : ''}">
                <a href="#servo-paso-${n}" class="servo-flujo-link">
                  <span class="servo-flujo-num">${String(n).padStart(2, '0')}</span>
                  <span class="servo-flujo-tit">${t}</span>
                  <span class="servo-flujo-sale">→ ${sale}</span>
                </a>
              </li>`).join('');
    const tarjeta = (i, badge, titulo, cuerpo) => `
          <article class="servo-card" id="sv-card-${i}" role="tabpanel" aria-labelledby="sv-tab-${i}"${i ? ' inert' : ''}>
            <span class="servo-card-badge">${badge}</span>
            <h3 class="servo-card-title">${titulo}</h3>
            ${cuerpo}
          </article>`;
    return `
      <section class="servo-intro" id="servo-intro" aria-label="Introducción">
        <header class="section-head reveal">
          <span class="section-index">01</span>
          <div>
            <span class="eyebrow">Introducción</span>
            <h2 class="section-title">Seguir un satélite y medir lo que cuesta <em class="serif">apuntar</em> mal</h2>
          </div>
          <p class="section-intro">Cinco tarjetas para situarse antes de los resultados: qué se simula, cómo se encadenan los seis pasos, para qué sirve, qué viene de las prácticas y cómo se maneja la página.</p>
        </header>

        <div class="servo-carrusel reveal" style="--d: 80ms">
          <div class="servo-carrusel-tabs" role="tablist" aria-label="Tarjetas de la introducción">
            ${INTRO_TABS.map((t, i) => `<button type="button" role="tab" class="servo-carrusel-tab" id="sv-tab-${i}" aria-controls="sv-card-${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-card="${i}"><span>${String(i + 1).padStart(2, '0')}</span>${t}</button>`).join('')}
          </div>
          <div class="servo-carrusel-ventana" id="sv-carrusel-ventana">
            <div class="servo-carrusel-pista" id="sv-carrusel-pista">
${tarjeta(0, '01 · Planteamiento', 'Qué estamos haciendo', `
            <p class="servo-card-desc">Una estación terrena (de ejemplo, en Valencia) sigue con una antena parabólica a un satélite de <strong>órbita baja</strong> (LEO, <em>low Earth orbit</em>: entre 300 y 1500 km de altitud) durante una <strong>pasada</strong>: los pocos minutos que el satélite está por encima del horizonte, desde la adquisición de señal (AOS, <em>acquisition of signal</em>) hasta su pérdida (LOS, <em>loss of signal</em>). La máxima elevación se alcanza en el TCA (<em>time of closest approach</em>, instante de máxima aproximación).</p>
            <div class="servo-card-destacado">
              <span class="servo-lbl">Pregunta guía</span>
              <p><strong>¿Cuánto se pierde por apuntar mal?</strong> Un error de unas décimas de grado en la antena se traduce en decibelios de señal, en kilómetros de alcance y, al final, en bits erróneos de telemetría.</p>
            </div>
            <ul class="servo-card-lista">
              <li><strong>Pasada:</strong> por dónde y a qué velocidad cruza el satélite el cielo de la estación.</li>
              <li><strong>Apuntamiento:</strong> un servo con regulador PID (proporcional, integral y derivativo) mueve el pedestal de la antena para seguirlo.</li>
              <li><strong>Enlace:</strong> el error del pedestal se lleva al diagrama de la antena y se convierte en pérdida de señal.</li>
              <li><strong>Telemetría:</strong> los datos del satélite llegan modulados en AM o FM y la pérdida rebaja su calidad.</li>
              <li><strong>Actitud:</strong> el satélite también tiene que girar para apuntar a la estación, con un volante de inercia que puede saturar.</li>
            </ul>`)}
${tarjeta(1, '02 · Estructura', 'La cadena de seis módulos', `
            <p class="servo-card-desc">Cada paso es un módulo con su propio modelo y su propia pregunta. Lo que sale de uno entra en el siguiente, de modo que un cambio en el panel de misión (altitud, elevación máxima, antena) recorre toda la cadena. Pulsa un paso para ir a él.</p>
            <ol class="servo-flujo" aria-label="Cadena de módulos">${flujo}
            </ol>
            <ul class="servo-card-lista">
              <li><strong>1 → 2:</strong> la pasada da la trayectoria en acimut y elevación que tiene que seguir el pedestal.</li>
              <li><strong>2 → 3 → 4:</strong> el error de seguimiento se compara con el haz de la antena; la pérdida resultante recorta el alcance del radar y la SNR (relación señal-ruido) del enlace.</li>
              <li><strong>3 → 5:</strong> la pérdida de un trayecto rebaja la SNR de la telemetría modulada y fija su tasa de error.</li>
              <li><strong>1 → 6:</strong> la misma velocidad angular de la pasada es la que tiene que girar el satélite; con ella se comprueba si su volante aguanta.</li>
            </ul>`)}
${tarjeta(2, '03 · Objetivo', 'Para qué sirve estudiarlo', `
            <p class="servo-card-desc">La cadena junta en un solo caso lo que normalmente se estudia por separado: control, antenas, radar, modulación y actitud y permite ver cómo un detalle de control acaba siendo un problema de comunicaciones.</p>
            <ul class="servo-card-lista servo-card-lista-2">
              <li><strong>Control digital:</strong> PID discreto, muestreo, estabilidad (radio espectral), saturación y windup, derivative kick.</li>
              <li><strong>Antenas:</strong> diagrama de un reflector, ancho de haz a −3 dB (HPBW, <em>half-power beamwidth</em>) y pérdida por desapuntamiento.</li>
              <li><strong>Radar y enlace:</strong> ecuación del radar, balance de Friis, SNR y margen.</li>
              <li><strong>Modulación:</strong> DSB, AM y FM, ancho de Carson, sobremodulación y efecto umbral de la FM.</li>
              <li><strong>Actitud:</strong> doble integrador, volante de inercia saturable y descarga con magnetopares.</li>
            </ul>
            <div class="servo-card-cifras">
              <div class="servo-card-cifra"><span class="servo-card-cifra-val">1,81 dB</span><span class="servo-card-cifra-lbl">pérdida de ida y vuelta con 0,41° de error (antena de 4 m a 3 GHz, HPBW 1,474°): el alcance del radar baja de 177,84 a 160,25 km</span></div>
              <div class="servo-card-cifra"><span class="servo-card-cifra-val">7,67 dB</span><span class="servo-card-cifra-lbl">con el blanco al doble de velocidad: el error pasa a 0,825° y la pérdida a algo más del cuádruple</span></div>
              <div class="servo-card-cifra"><span class="servo-card-cifra-val">6,9·10⁻¹² → 6,3·10⁻²</span><span class="servo-card-cifra-lbl">tasa de error de la telemetría FM (SNR de referencia de 20 dB) sin y con esa pérdida, 3,84 dB de ida: la FM cae por debajo de su umbral</span></div>
            </div>
            <p class="servo-card-nota">Conclusión: mientras el error queda dentro de una fracción del haz, apuntar mal cuesta poco; al acercarse al borde del haz la pérdida crece mucho más deprisa que el error, y en FM basta para hundir el enlace.</p>`)}
${tarjeta(3, '04 · Origen', 'Qué viene de las prácticas y qué es propio', `
            <p class="servo-card-desc">El proyecto parte de las prácticas de <em>Control y Sistemas de Comunicación</em> (Grado en Ingeniería Aeroespacial, Universidad de Alicante) y las une con modelos nuevos. Cada paso lleva una etiqueta con su origen.</p>
            <div class="servo-card-cols">
              <div>
                <span class="servo-lbl">De las prácticas</span>
                <ul class="servo-card-lista">
                  <li><strong>Práctica 1:</strong> servomotor y PID digital (guion de S. T. Puente), en versión corregida.</li>
                  <li><strong>Práctica 3:</strong> modulaciones DSB, AM y FM, demodulación y VOR.</li>
                  <li><strong>Práctica 4:</strong> diagramas de radiación (M. Á. Sánchez Soriano y A. Mestre Quereda).</li>
                  <li><strong>Problema de radar:</strong> ecuación del radar y pedestal; caso de estudio de origen sin confirmar.</li>
                </ul>
              </div>
              <div>
                <span class="servo-lbl">Desarrollo propio</span>
                <ul class="servo-card-lista">
                  <li><strong>Órbita y pasada</strong> kepleriana circular sobre la estación.</li>
                  <li><strong>Paso del error</strong> del servo a pérdida de ganancia.</li>
                  <li><strong>Enlace de telemetría:</strong> Friis, SNR y tasa de error.</li>
                  <li><strong>Actitud</strong> con volante de inercia y requisito de la pasada.</li>
                </ul>
              </div>
            </div>
            <p class="servo-card-nota">La plantilla del diagrama del reflector es del profesor A. Mestre Quereda y no se publica. Los motores numéricos se han contrastado con una réplica independiente en Python (29 + 19 + 16 pruebas automáticas), no con MATLAB. La implementación y la verificación se han hecho con apoyo de herramientas de programación asistida por IA. Detalle en <a href="#servo-creditos" class="link-underline">Créditos y limitaciones</a>.</p>`)}
${tarjeta(4, '05 · Guía', 'Cómo usarlo', `
            <p class="servo-card-desc">Todo se calcula en el navegador al momento. Material académico de simulación: no es una herramienta operativa ni usa datos reales de ningún satélite.</p>
            <ol class="servo-card-pasos">
              <li><strong>Elige un escenario o un caso.</strong> Los <em>escenarios de la misión</em>, encima del panel, ajustan altitud, elevación o antena y recorren la cadena entera; si su efecto está en un paso concreto, la página baja hasta él. Los <em>casos estudiados</em> comprueban una pieza concreta de cada práctica y están dentro del paso donde se ve su efecto, junto a los controles que cambian (el PID y el pedestal en el paso 2, la AM sobremodulada en el paso 5); su línea «Qué mirar» dice en qué fijarse. Solo hay una configuración activa a la vez.</li>
              <li><strong>Mueve el panel de misión.</strong> Altitud, elevación máxima, diámetro y frecuencia de la antena: se recalculan los seis pasos y el resumen del panel. Sus enlaces llevan a cada paso.</li>
              <li><strong>Ajusta cada paso.</strong> Los deslizadores y botones de cada paso cambian el regulador, la referencia, la modulación o el volante.</li>
              <li><strong>Compara con la referencia.</strong> La línea <span class="servo-card-mono">Referencia · Python</span> da las cifras que obtuvo la réplica independiente en Python para ese escenario o caso; si coinciden con las de la página, el cálculo es el mismo. Al tocar un control, la configuración pasa a «modificada» y la referencia deja de aplicarse.</li>
            </ol>
            <a href="#servo-escenarios" class="btn ghost servo-card-cta">Ir a los escenarios</a>`)}
            </div>
          </div>
          <div class="servo-carrusel-ctrl">
            <button type="button" class="servo-carrusel-flecha" data-card-dir="-1" aria-label="Tarjeta anterior">←</button>
            <span class="servo-carrusel-cont" id="sv-carrusel-cont" aria-live="polite">Tarjeta 1 de ${INTRO_TABS.length}</span>
            <button type="button" class="servo-carrusel-flecha" data-card-dir="1" aria-label="Tarjeta siguiente">→</button>
          </div>
        </div>
      </section>`;
  }

  /** Carrusel de la introducción: pestañas, flechas y teclado; la ventana toma la altura de la tarjeta activa. */
  function conectarCarrusel(root) {
    const pista = root.querySelector('#sv-carrusel-pista'), ventana = root.querySelector('#sv-carrusel-ventana');
    if (!pista) return;
    const tabs = [...root.querySelectorAll('.servo-carrusel-tab')], cards = [...pista.children], n = cards.length;
    let actual = 0;
    const ajustarAltura = () => { ventana.style.height = cards[actual].offsetHeight + 'px'; };
    const ir = (i, foco) => {
      actual = (i + n) % n;
      pista.style.transform = `translateX(${-100 * actual}%)`;
      tabs.forEach((t, k) => { t.setAttribute('aria-selected', k === actual); t.tabIndex = k === actual ? 0 : -1; });
      cards.forEach((c, k) => { c.inert = k !== actual; });
      root.querySelector('#sv-carrusel-cont').textContent = `Tarjeta ${actual + 1} de ${n}`;
      ajustarAltura();
      if (foco) tabs[actual].focus();
    };
    root.querySelector('.servo-carrusel-tabs').addEventListener('click', e => {
      const t = e.target.closest('[data-card]'); if (t) ir(+t.dataset.card);
    });
    root.querySelector('.servo-carrusel-tabs').addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); ir(actual + (e.key === 'ArrowRight' ? 1 : -1), true); }
    });
    root.querySelectorAll('[data-card-dir]').forEach(b => b.addEventListener('click', () => ir(actual + +b.dataset.cardDir)));
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(ajustarAltura);
      cards.forEach(c => ro.observe(c));
    } else window.addEventListener('resize', ajustarAltura);
    ir(0);
  }

  function plantilla() {
    return `
    <div class="servo-view">
      ${plantillaIntro()}

      <header class="section-head reveal" id="servo-simulador">
        <span class="section-index">02</span>
        <div>
          <span class="eyebrow"><span class="dot"></span>Fases 1 a 3 · Seguimiento, enlace, telemetría y actitud</span>
          <h2 class="section-title">Del paso del satélite al <em class="serif">margen</em> del enlace</h2>
        </div>
        <p class="section-intro">Seis pasos encadenados: la pasada fija lo que debe seguir el pedestal, su error se convierte en pérdida con el diagrama de la antena, esa pérdida cuesta alcance y margen y rebaja la SNR de la telemetría modulada; al otro lado del enlace, el satélite tiene que girar para apuntar a la estación con un volante de inercia que puede saturar. Cambia la altitud o la elevación en el panel de misión y se recalcula todo.</p>
      </header>

      <div class="servo-escenarios reveal" id="servo-escenarios" style="--d: 80ms">
        <div class="servo-esc-grupo-head">
          <span class="servo-lbl">Escenarios de la misión</span>
          <p class="servo-esc-grupo-sub">Fijan la altitud, la elevación o la antena del panel de misión y recorren la cadena completa. Los casos estudiados de cada práctica están dentro del paso donde se ve su efecto (pasos 2 y 5).</p>
        </div>
        <div class="servo-chips" role="group" aria-label="Escenarios de la misión">
          ${ESCENARIOS.filter(e => e.grupo === 'mision').map(chipEscenario).join('')}
        </div>
        <p class="servo-esc-texto" id="sv-esc-texto"></p>
        <p class="servo-esc-ref" id="sv-esc-ref"></p>
      </div>

      <div class="servo-layout">
        <aside class="servo-mision reveal" id="sv-mision" aria-label="Panel de misión" style="--d: 120ms">
          <span class="eyebrow">Panel de misión</span>
          ${slider('sv-h', 'Altitud de la órbita', 300, 1500, 10)}
          ${slider('sv-elmax', 'Elevación máxima de la pasada', 10, 88, 1)}
          ${slider('sv-d', 'Diámetro de la antena', 1, 10, 0.1)}
          ${slider('sv-f', 'Frecuencia', 1, 12, 0.1)}
          <p class="servo-mision-nota">Estación de ejemplo en Valencia (39,47° N · 0,38° O), órbita circular de 97,6° de inclinación, máscara de ${EL_MIN}°.</p>
          <div class="servo-resumen" id="sv-resumen"></div>
          <nav class="servo-nav" aria-label="Pasos">
            <a href="#servo-paso-1">01 Pasada</a><a href="#servo-paso-2">02 Pedestal</a><a href="#servo-paso-3">03 Haz</a><a href="#servo-paso-4">04 Enlace</a><a href="#servo-paso-5">05 Telemetría</a><a href="#servo-paso-6">06 Actitud</a>
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
            ${bloqueCasos('pedestal', 'Casos estudiados', 'Cada caso carga en los controles de abajo una configuración de la Práctica 1 o del problema del radar; las cifras de «Referencia · Python» salen de la réplica independiente en Python. Salvo el blanco al doble, que fija la antena del panel (4 m a 3 GHz), no dependen del panel de misión.')}
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

          ${Tm ? plantillaPaso5() : ''}
          ${At ? plantillaPaso6() : ''}
        </div>
      </div>

      ${creditos()}
    </div>`;
  }

  function plantillaPaso5() {
    return `
          <article class="servo-paso reveal" id="servo-paso-5">
            ${cabeceraPaso(5, 'Telemetría', '¿Cómo se modula la telemetría y cuántos errores llegan con el apuntamiento real?', origen('Práctica 3') + origen('Desarrollo propio', true))}
            <p class="servo-text">Modulaciones de la Práctica 3 en su versión corregida: un tono A<sub>m</sub>·cos(2π f<sub>m</sub> t) sobre una portadora de 250 Hz, muestreado a 1 kHz (2 kHz en FM) durante 0,5 s. El espectro es la transformada aproximada X(f) = Δt·Σ x(t<sub>n</sub>)·e<sup>−j2πft<sub>n</sub></sup> (con el factor Δt que faltaba en la entrega) y se lee como coeficientes |X|/T: un coseno de amplitud A da dos líneas de A/2.</p>
            <div class="servo-formula">DSB-AM m(t)·c(t) · AM [1 + β·m(t)]·c(t) · FM cos(2π f_c t + 2π k_f ∫m dt) · Δf = k_f·max|m| · β_FM = Δf/f_m · Carson 2(Δf + f_m)</div>
            <div class="servo-controles">
              ${seg('mod', 'Modulación', [['dsb', 'DSB-AM'], ['am', 'AM'], ['fm', 'FM']], 'tm')}
              ${slider('sv-beta', 'Índice β (AM y demodulación)', 0.1, 1.5, 0.05)}
              <div class="servo-ctrl" data-grupo-wrap="kf">${slider('sv-kf', 'Sensibilidad k_f (FM)', 10, 200, 5)}</div>
              ${slider('sv-am', 'Amplitud del mensaje A_m', 0.25, 2, 0.05)}
              ${slider('sv-fm', 'Frecuencia del mensaje f_m', 10, 50, 2)}
            </div>
            <div class="servo-kpis" id="sv-k5"></div>
            <div class="servo-charts">${chart('sv-c-tm-t')}${chart('sv-c-tm-f')}</div>

            <div class="servo-bloque" id="sv-bloque-demod">
              <div class="servo-bloque-head"><h4 class="servo-sub">Demodulación AM por envolvente</h4>${origen('Práctica 3')}</div>
              <p class="servo-text">Mensaje del enunciado: 1 en el primer tercio, −2 en el segundo y 0 en el último, modulado en AM con el β de arriba. El detector de envolvente toma v = |x + j·H{x}| (transformada de Hilbert) y recupera m̂ = (v − 1)/β. La fórmula del guion, 2(v − 1)/β, devuelve 2·m.</p>
              ${bloqueCasos('demod', 'Caso estudiado', 'Carga los parámetros de la Práctica 3 en los controles de modulación de arriba; no depende del panel de misión.')}
              <p class="servo-aviso servo-alerta" id="sv-sobremod" hidden></p>
              <div class="servo-kpis" id="sv-k5d"></div>
              <div class="servo-charts">${chart('sv-c-tm-d', true)}</div>
            </div>

            <div class="servo-bloque">
              <div class="servo-bloque-head"><h4 class="servo-sub">Caso de estudio: VOR en banda base</h4>${origen('Práctica 3')}</div>
              <p class="servo-text">La señal del VOR suma una referencia de 30 Hz en AM (β = 0,9) y una subportadora de 9960 Hz modulada en FM por otro tono de 30 Hz (Δf = 480 Hz, β_FM = 16). El rumbo es el desfase entre los dos tonos de 30 Hz: se recupera con la fase del bin de 30 Hz de la señal y la de la fase instantánea de la subportadora (señal analítica por encima de 5 kHz). Muestreo a 100 kHz durante 0,1 s (10 000 muestras).</p>
              <div class="servo-formula">s(t) = 1 + 0,9·cos(2π·30 t) + cos(2π·9960 t + 16·cos(2π·30 t + θ)) · Carson 2(16 + 1)·30 = 1020 Hz · rumbo = θ</div>
              <div class="servo-controles servo-controles-1">${slider('sv-theta', 'Rumbo elegido θ (radial)', 0, 359, 1)}</div>
              <div class="servo-kpis" id="sv-k5v"></div>
              <div class="servo-charts">${chart('sv-c-vor-f')}${chart('sv-c-vor-r')}</div>
              <p class="servo-pie">El caso en RF (portadora de 114,65 MHz muestreada a 250 MHz: 25·10⁶ muestras en 0,1 s) solo se documenta, no se simula en el navegador: su espectro es el de banda base trasladado a ±f<sub>portadora</sub> con la mitad de amplitud.</p>
            </div>

            <div class="servo-bloque" id="sv-bloque-enlace">
              <div class="servo-bloque-head"><h4 class="servo-sub">Enlace de telemetría</h4>${origen('Desarrollo propio', true)}</div>
              <p class="servo-text">La pérdida de ida del paso 3 (un trayecto) rebaja la SNR de referencia γ en la banda del mensaje: γ = γ<sub>ref</sub> − L<sub>ap</sub>; el ruido no cambia. Con γ se calcula la C/N en la banda de transmisión (2W en AM, Carson en FM), el umbral del detector (C/N &lt; 10 dB), la SNR de salida y la tasa de error de datos binarios NRZ: AM con detector de envolvente, Pb = Q(d·√(γ/(1 + β²))), y FM como FSK no coherente, Pb = ½·e<sup>−Eb/2N0</sup>. Modelo de libro, ilustrativo: usa el β y el β_FM = k_f·A_m/f_m de los controles de arriba.</p>
              <div class="servo-controles">
                ${seg('enl', 'Modulación del enlace', [['am', 'AM'], ['fm', 'FM']], 'tm')}
                ${slider('sv-snr', 'SNR de referencia γ_ref (sin pérdida)', 0, 40, 0.5)}
              </div>
              <div class="servo-kpis" id="sv-k5e"></div>
              <div class="servo-charts">${chart('sv-c-tm-ber', true)}</div>
              <p class="servo-pie">Modulaciones, demodulación y VOR: enunciado de la Práctica 3 (material docente de la asignatura), implementado y corregido aquí; réplica independiente en Python. El modelo de SNR y tasa de error del enlace no sale de la P3: es desarrollo propio con fórmulas de libro (Lathi, Haykin).</p>
            </div>
          </article>`;
  }

  function plantillaPaso6() {
    return `
          <article class="servo-paso reveal" id="servo-paso-6">
            ${cabeceraPaso(6, 'Actitud', '¿Puede el satélite girar para apuntar a la estación sin que se sature su volante de inercia?', origen('Desarrollo propio', true) + origen('Práctica 1'))}
            <p class="servo-text">Satélite rígido en <strong>un eje</strong>: J·θ'' = τ<sub>c</sub> + τ<sub>d</sub> + τ<sub>m</sub>, un doble integrador discretizado por ZOH (exacto con par constante en cada periodo). El par de control τ<sub>c</sub> lo da un <strong>volante de inercia</strong>: sale de su momento angular, ḣ<sub>w</sub> = −τ<sub>c</sub>, y está limitado en par (|τ<sub>c</sub>| ≤ τ<sub>max</sub>) y en momento (|h<sub>w</sub>| ≤ h<sub>max</sub>: con el volante lleno solo puede frenar). La perturbación τ<sub>d</sub> (gradiente gravitatorio y arrastre) es constante, así que el volante la compensa acumulando momento; los <strong>magnetopares</strong> lo descargan con τ<sub>m</sub> = −k<sub>des</sub>·h<sub>w</sub>. El regulador es el <strong>mismo PID digital de la Práctica 1</strong> (integral trapezoidal, anti-windup, derivada del error o de la salida), diseñado por asignación de polos.</p>
            <div class="servo-formula">θ(k+1) = θ(k) + T·ω(k) + T²/(2J)·τ(k) · h_w(k+1) = h_w(k) − T·τ_c(k) · KP = J·ωn² · KD = 2ζ·ωn·J · τ_m = −k_des·h_w · J·ω + h_w = H₀ + Σ(τ_d + τ_m)·T</div>
            <div class="servo-controles">
              ${seg('modo', 'Diseño del regulador', [['polos', 'Polos (ωn, ζ)'], ['ganancias', 'Ganancias (KP, KD)']], 'act')}
              <div class="servo-ctrl" data-grupo-wrap="at-polos">${slider('sv-at-wn', 'Frecuencia natural ωn', 0.02, 0.5, 0.01)}${slider('sv-at-z', 'Amortiguamiento ζ', 0.2, 1.5, 0.05)}</div>
              <div class="servo-ctrl" data-grupo-wrap="at-gan">${slider('sv-at-kp', 'KP', 0.001, 0.2, 0.001)}${slider('sv-at-kd', 'KD', 0.01, 2, 0.01)}</div>
              ${slider('sv-at-ki', 'KI (acción integral)', 0, 0.002, 0.0001)}
              ${slider('sv-at-j', 'Inercia J', 0.5, 20, 0.1)}
              ${slider('sv-at-tmax', 'Par máximo del volante τmax', 0.5, 50, 0.5)}
              ${slider('sv-at-hmax', 'Momento máximo del volante hmax', 0.01, 0.5, 0.005)}
              ${slider('sv-at-td', 'Perturbación τd', 0, 200, 1)}
              ${slider('sv-at-t', 'Periodo del lazo T', 0, T_ACT.length - 1, 1)}
              ${seg('man', 'Maniobra', [['escalon', 'Escalón'], ['perfil', 'Perfil con ω limitada']], 'act')}
              ${slider('sv-at-th', 'Ángulo de la maniobra θf', 0, 90, 1)}
              <div class="servo-ctrl" data-grupo-wrap="at-perfil">${slider('sv-at-wl', 'Velocidad máxima del perfil', 0.1, 2, 0.05)}</div>
              ${seg('hor', 'Duración simulada', [['120', '120 s'], ['300', '300 s'], ['1000', '1000 s'], ['3000', '3000 s']], 'act')}
              ${seg('aw', 'Anti-windup', [['ninguno', 'Ninguno'], ['acotar', 'Acotar uI a ±τmax'], ['congelar', 'Congelar']], 'act')}
              ${seg('der', 'Derivada', [['salida', 'De la salida (giróscopo)'], ['error', 'Del error']], 'act')}
              <div class="servo-ctrl">
                <label class="servo-check"><input type="checkbox" id="sv-at-des" /> <span>Descarga con magnetopares</span></label>
                <div class="servo-ctrl" data-grupo-wrap="at-des">${slider('sv-at-tm', 'Par máximo τm,max', 10, 1000, 10)}${slider('sv-at-kdes', 'Ganancia de descarga k_des', 0, KDES.length - 1, 1)}</div>
              </div>
            </div>
            <p class="servo-aviso" id="sv-at-aviso" hidden></p>
            <div class="servo-kpis" id="sv-k6"></div>
            <div class="servo-charts">${chart('sv-c-at-th', true)}${chart('sv-c-at-u')}${chart('sv-c-at-h')}</div>

            <div class="servo-bloque">
              <div class="servo-bloque-head"><h4 class="servo-sub">Requisito de la pasada</h4>${origen('Desarrollo propio', true)}</div>
              <p class="servo-text">Para apuntar su antena a la estación, el cuerpo del satélite tiene que girar con la línea de vista: la velocidad angular ω(t) de la pasada del <strong>paso 1</strong> (salvo la rotación terrestre, ≈ 7·10⁻⁵ rad/s). El volante tiene que dar el par J·α<sub>máx</sub> + |τ<sub>d</sub>| y almacenar J·ω<sub>máx</sub> + |τ<sub>d</sub>|·duración, con α<sub>máx</sub> sacada de la propia pasada. Debajo, la simulación del seguimiento con los controles de arriba y la ω(t) de la pasada como referencia.</p>
              <div class="servo-semaforo" id="sv-at-sem"></div>
              <div class="servo-kpis" id="sv-k6p"></div>
              <div class="servo-charts" id="sv-at-pasada-charts">${chart('sv-c-at-ph')}${chart('sv-c-at-pe')}</div>
            </div>
            <p class="servo-pie">Modelo de actitud, volante, descarga y requisito de la pasada: desarrollo propio, contrastado con una réplica independiente en Python (16 pruebas). El algoritmo del PID digital es el de la Práctica 1 (S. T. Puente), reutilizado sin cambios. Parámetros de un microsatélite típico de 50 kg (J = 2 kg·m², volante de 10 mN·m y 0,1 N·m·s, τd = 1 µN·m, magnetopares de 50 µN·m): supuestos propios, no un equipo concreto.</p>
          </article>`;
  }

  function creditos() {
    return `
      <section class="section servo-creditos" id="servo-creditos">
        <header class="section-head reveal">
          <span class="section-index">03</span>
          <div>
            <span class="eyebrow">Fuentes, validación y límites</span>
            <h2 class="section-title">Créditos y limitaciones</h2>
          </div>
          <p class="section-intro">Qué es material docente, qué es propio, cómo se ha comprobado y qué simplifica el modelo. Material académico de simulación con fines educativos: no es una herramienta operativa.</p>
        </header>
        <div class="servo-creditos-grid">
          <div class="servo-creditos-col reveal">
            <h3 class="servo-sub">Créditos</h3>
            <p>Basado en las prácticas de <em>Control y Sistemas de Comunicación</em> (Grado en Ingeniería Aeroespacial, Universidad de Alicante, curso 2025-26). Bloque de control: guion de la Práctica 1 de S. T. Puente (modelo del servomotor y algoritmo del PID digital). Bloque de comunicaciones: Práctica 4 de M. Á. Sánchez Soriano y A. Mestre Quereda (ecuaciones de los diagramas de radiación) y Práctica 3 (modulaciones DSB, AM y FM, demodulación y VOR), cuyo enunciado es material docente de la asignatura. Los enunciados son material docente de sus autores y no se reproducen. La implementación, las correcciones del modelo, la integración radar–antena–servo–telemetría–actitud y el simulador son trabajo propio. El control de actitud (paso 6) no sale de ninguna práctica: es desarrollo propio que reutiliza el PID digital de la Práctica 1.</p>
            <p>De la P3 se corrigen el factor Δt de la transformada aproximada (la entrega daba |X(0)| = 200 en vez de 0,02 V·s), la fórmula de la demodulación AM (el guion devuelve 2·m) y la explicación de la meseta −2 con β = 0,85: es sobremodulación, no la constante RC del detector.</p>
            <p>La plantilla <code>plano_E_reflector.m</code> es del profesor A. Mestre Quereda: no se publica ni se reescribe. El diagrama del reflector parte de la función de análisis propia de la P4 y de la ecuación del enunciado.</p>
            <h3 class="servo-sub">Limitaciones</h3>
            <ul class="servo-lista">
              <li><strong>Validación:</strong> el motor numérico se ha comparado con una réplica independiente en Python (scipy) mediante 29 pruebas automáticas, el de telemetría (FFT, AM/FM, demodulación, VOR) con otras 19 y el de actitud con 16 más. No se ha contrastado con MATLAB.</li>
              <li><strong>Actitud:</strong> un solo eje, cuerpo rígido y sin acoplamiento giroscópico entre ejes ni dinámica del motor del volante; τd constante (en realidad el gradiente gravitatorio depende de la orientación y el arrastre de la densidad); magnetopares siempre disponibles con el par pedido, sin depender de la dirección del campo magnético a lo largo de la órbita. El requisito de la pasada supone que el cuerpo gira con la línea de vista que ve la estación y que el volante empieza vacío. Los parámetros del microsatélite (J, volante, τd, magnetopares, T = 0,1 s) son valores típicos elegidos como supuestos propios. Sin validación en MATLAB: solo la réplica en Python y casos analíticos.</li>
              <li><strong>Telemetría:</strong> la P3 se simula en banda base y a las frecuencias del guion (portadora de 250 Hz), no en RF. El VOR en RF (114,65 MHz muestreado a 250 MHz) solo se documenta: no se simula. El modelo de SNR y tasa de error del enlace es desarrollo propio, de libro e ilustrativo (sin codificación, sin sincronización, ruido blanco gaussiano y pérdida de apuntamiento estática).</li>
              <li><strong>Problema del radar:</strong> el origen del enunciado está sin confirmar; se usa como caso de estudio.</li>
              <li><strong>Órbita:</strong> kepleriana circular, sin J2, arrastre ni refracción; Tierra esférica.</li>
              <li><strong>Seguimiento:</strong> un solo eje del pedestal frente a la referencia, con el otro eje supuesto perfecto (en acimut, la desviación del haz es la del eje proyectada con cos(el)); sin monopulso ni barrido cónico ni límites de velocidad del motor; pérdida estática por desapuntamiento.</li>
              <li><strong>Supuestos no fijados por el enunciado:</strong> U = 10 V y la onda cuadrada de 12,5 s de periodo. El guion da 0,01 s como periodo de la planta (§4.6), pero solo 0,0625 s reproduce sus figuras 20–22: se usa 0,0625 s, supuesto propio.</li>
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
    if (Tm) {
      const a = Tm.casoDSBAM(0.85), f = Tm.casoFM(80), d1 = Tm.casoDemodAM(0.85), d2 = Tm.casoDemodAM(0.4), v = Tm.casoVOR(45, 0);
      filas.push(
        ['AM β = 0,85: línea en 270 Hz (P3)', '0,2125', fmt(a.lineas.A270, 4)],
        ['FM k_f = 80: ancho de Carson (P3)', '200 Hz', fmt(f.carson) + ' Hz'],
        ['Meseta −2 demodulada, β = 0,85', '−0,353', fmt(d1.mesetas.correcta[1], 3)],
        ['Meseta −2 demodulada, β = 0,4', '−2,000', fmt(d2.mesetas.correcta[1], 3)],
        ['VOR: ancho de Carson', '1.020 Hz', fmt(v.carson) + ' Hz'],
        ['VOR: rumbo recuperado (θ = 45°)', '45,00°', fmt(v.rumbo, 2) + '°']);
    }
    if (At) {
      const Q = At.SAT, d = At.disenoPD(Q.J, Q.wn, Q.zeta), paso = 30 * D2R;
      const base = { J: Q.J, T: Q.T, KP: d.KP, KD: d.KD };
      const mNom = At.metricas(At.simular(Object.assign({ ref: At.escalon(1200, paso), tauMax: Q.tauMax, hMax: Q.hMax, tauD: Q.tauD }, base)));
      const mW = At.metricas(At.simular(Object.assign({ ref: At.escalon(3000, paso), KI: 4e-4, tauMax: 0.003, antiWindup: 'ninguno', uImax: 0.003 }, base)));
      const mL = At.metricas(At.simular(Object.assign({}, base, { ref: At.escalon(6000, 0), T: 0.5, tauMax: Q.tauMax, hMax: Q.hMax, tauD: 1e-4 })));
      const wCen = Math.sqrt(R.MU / (R.RE + Q.altitud)) / Q.altitud, rq = At.requisitoSeguimiento({ omegaMax: wCen });
      filas.push(
        ['Actitud: KP y KD (ωn = 0,1 rad/s, ζ = 0,7)', '0,02 · 0,28', `${fmt(d.KP, 2)} · ${fmt(d.KD, 2)}`],
        ['Gradiente gravitatorio a 500 km (ΔI = 0,5, 45°)', '0,919 µN·m', fmt(At.parGradienteGravitatorio(500e3, 0.5, Math.PI / 4) * 1e6, 3) + ' µN·m'],
        ['Maniobra de 30°: sobreoscilación', '4,51 %', fmt(mNom.sobreosc, 2) + ' %'],
        ['Maniobra de 30°: ts (2 %)', '59,4 s', fmt(mNom.ts, 1) + ' s'],
        ['PID saturado sin anti-windup: Mp', '37,94 %', fmt(mW.sobreosc, 2) + ' %'],
        ['Volante lleno con τd = 100 µN·m', '1000 s', fmt(mL.tSatH, 1) + ' s'],
        ['Pasada cenital a 500 km: h = J·v/h', '0,0305 N·m·s', `${fmt(rq.momentoNecesario, 4)} N·m·s · ${rq.ok ? 'aguanta' : 'no aguanta'}`]);
    }
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
    'sv-pt': { get: () => estado.enlace.PtSat, set: v => { estado.enlace.PtSat = v; }, txt: v => `${fmt(v, 1)} W` },
    'sv-beta': { get: () => estado.tm.beta, set: v => { estado.tm.beta = v; }, txt: v => fmt(v, 2) },
    'sv-kf': { get: () => estado.tm.kf, set: v => { estado.tm.kf = v; }, txt: v => `${fmt(v)} Hz/V` },
    'sv-am': { get: () => estado.tm.Am, set: v => { estado.tm.Am = v; }, txt: v => `${fmt(v, 2)} V` },
    'sv-fm': { get: () => estado.tm.fm, set: v => { estado.tm.fm = v; }, txt: v => `${fmt(v)} Hz` },
    'sv-theta': { get: () => estado.tm.theta, set: v => { estado.tm.theta = v; }, txt: v => `${fmt(v)}°` },
    'sv-snr': { get: () => estado.tm.snrRef, set: v => { estado.tm.snrRef = v; }, txt: v => `${fmt(v, 1)} dB` },
    'sv-at-wn': { get: () => estado.act.wn, set: v => { estado.act.wn = v; }, txt: v => `${fmtT(v, 3)} rad/s` },
    'sv-at-z': { get: () => estado.act.zeta, set: v => { estado.act.zeta = v; }, txt: v => fmtT(v, 3) },
    'sv-at-kp': { get: () => estado.act.KP, set: v => { estado.act.KP = v; }, txt: v => `${fmtT(v, 4)} N·m/rad` },
    'sv-at-kd': { get: () => estado.act.KD, set: v => { estado.act.KD = v; }, txt: v => `${fmtT(v, 3)} N·m·s/rad` },
    'sv-at-ki': { get: () => estado.act.KI, set: v => { estado.act.KI = v; }, txt: v => (v ? `${fmtSci(v, 1)} N·m/(rad·s)` : '0 (PD)') },
    'sv-at-j': { get: () => estado.act.J, set: v => { estado.act.J = v; }, txt: v => `${fmt(v, 1)} kg·m²` },
    'sv-at-tmax': { get: () => estado.act.tauMax, set: v => { estado.act.tauMax = v; }, txt: v => `${fmt(v, 1)} mN·m` },
    'sv-at-hmax': { get: () => estado.act.hMax, set: v => { estado.act.hMax = v; }, txt: v => `${fmtT(v, 3)} N·m·s` },
    'sv-at-td': { get: () => estado.act.tauD, set: v => { estado.act.tauD = v; }, txt: v => `${fmt(v)} µN·m` },
    'sv-at-t': { get: () => T_ACT.indexOf(estado.act.T), set: v => { estado.act.T = T_ACT[v]; }, txt: v => `${fmtT(T_ACT[v])} s` },
    'sv-at-th': { get: () => estado.act.thF, set: v => { estado.act.thF = v; }, txt: v => `${fmt(v)}°` },
    'sv-at-wl': { get: () => estado.act.wLim, set: v => { estado.act.wLim = v; }, txt: v => `${fmt(v, 2)} °/s` },
    'sv-at-tm': { get: () => estado.act.tmMax, set: v => { estado.act.tmMax = v; }, txt: v => `${fmt(v)} µN·m` },
    'sv-at-kdes': { get: () => KDES.indexOf(estado.act.kDes), set: v => { estado.act.kDes = KDES[v]; }, txt: v => `${fmtSci(KDES[v], 0)} 1/s` }
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
      const on = String(objDe(b)[b.dataset.grupo]) === b.dataset.val;
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', on);
    });
    const sv = estado.servo;
    root.querySelector('[data-grupo-wrap="eje"]').hidden = sv.ref !== 'pasada';
    root.querySelector('[data-grupo-wrap="omega0"]').hidden = sv.ref !== 'rampa';
    const wkf = root.querySelector('[data-grupo-wrap="kf"]');
    if (wkf) wkf.hidden = estado.tm.mod !== 'fm' && estado.tm.enl !== 'fm';
    $('sv-sat').checked = sv.sat;
    if (At && $('sv-at-des')) {
      const a = estado.act, w = n => root.querySelector(`[data-grupo-wrap="${n}"]`);
      w('at-polos').hidden = a.modo !== 'polos'; w('at-gan').hidden = a.modo === 'polos';
      w('at-perfil').hidden = a.man !== 'perfil'; w('at-des').hidden = !a.des;
      $('sv-at-des').checked = a.des;
    }
    root.querySelectorAll('[data-escenario]').forEach(b => {
      const on = !estado.modificado && b.dataset.escenario === estado.escenario;
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', on);
    });
    // Una sola configuración activa: un escenario de la misión (texto arriba) o un caso estudiado (texto en su paso)
    const esc = ESCENARIOS.find(e => e.id === estado.escenario);
    const modif = esc && estado.modificado ? `Configuración modificada a partir de «${esc.lbl}». ` : '';
    const esCaso = !!(esc && esc.grupo === 'caso');
    $('sv-esc-texto').textContent = !esc ? 'Configuración libre.'
      : esCaso ? `Caso estudiado «${esc.lbl}» activo en el paso ${esc.donde === 'demod' ? 5 : 2}${estado.modificado ? ' (configuración modificada)' : ''}: ningún escenario de la misión seleccionado.`
        : modif + esc.texto;
    $('sv-esc-ref').hidden = esCaso;
    $('sv-esc-ref').textContent = esc && !esCaso ? 'Referencia · ' + esc.ref : '';
    root.querySelectorAll('[data-casos]').forEach(b => {
      const mio = esCaso && esc.donde === b.dataset.casos;
      b.querySelector('[data-casos-det]').hidden = !mio;
      if (!mio) return;
      b.querySelector('[data-casos-texto]').textContent = modif + esc.texto;
      b.querySelector('[data-casos-mirar]').textContent = esc.mirar;
      b.querySelector('[data-casos-ref]').textContent = 'Referencia · ' + esc.ref;
    });
  }

  function aplicarEscenario(id) {
    const e = ESCENARIOS.find(x => x.id === id); if (!e) return;
    estado.escenario = id; estado.modificado = false;
    estado.servo = Object.assign({}, SERVO_BASE, e.servo);
    estado.tm = Object.assign({}, TM_BASE, e.tm);
    estado.act = Object.assign({}, ACT_BASE, e.act);
    if (e.mision) Object.assign(estado.mision, e.mision);
  }

  function actualizar() {
    const root = document.querySelector('.servo-view'); if (!root) return;
    if (At) sincronizarDiseno(estado.act);
    sincronizarControles(root);
    const r = calcularCache(), c = colores(), sv = estado.servo, sim = r.sim, pas = r.pas;
    const t5 = Tm ? calcTelemetria(r) : null;

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
    ].concat(t5 ? [kpi('Tasa de error (paso 5)', fmtBer(t5.enl.ber), `${t5.op.modulacion.toUpperCase()} · γ = ${fmtDb(t5.enl.gammaDb)}${t5.enl.bajoUmbral ? ' · bajo umbral' : ''}`)] : []).join('');
    $('sv-nota4').textContent = pas
      ? `El satélite nunca se acerca a menos de ${fmt(pas.rangoMin / 1e3)} km: queda fuera del alcance del radar del caso de estudio (${fmt(r.Rmax / 1e3)} km). Para el satélite lo que cuenta es el enlace de telemetría; el radar muestra cuánto alcance cuesta el mismo error.`
      : '';

    // Paso 6 (actitud)
    const a6 = At ? simActitud(estado.act) : null, ap = At ? actitudPasada(estado.act, pas) : null;
    if (a6) actualizarPaso6(a6, ap);

    // Resumen del panel de misión
    $('sv-resumen').innerHTML = [
      ['Pasada', pas ? `${mmss(pas.dur)} · ${fmt(pas.elMax, 0)}°` : '—'],
      ['Error de apuntamiento', err == null ? 'no aplica' : isFinite(err) ? `${fmt(err, 3)}°` : 'inestable'],
      ['Semáforo', `<span class="servo-dot is-${r.clase}" aria-hidden="true"></span>${ESTADO_LBL[r.clase]}`],
      ['Pérdida (ida y vuelta)', perdTxt(L.idaVuelta)],
      ['Alcance efectivo radar', `<span class="servo-key">${L.na ? '—' : fmt(r.Ref / 1e3, 2) + ' km'}</span>`],
      ['Margen de telemetría', isFinite(r.snrMin) ? `${fmt(r.snrMin - TM.snrMin, 1)} dB` : '—']
    ].concat(t5 ? [
      ['SNR telemetría γ', fmtDb(t5.enl.gammaDb)],
      ['Tasa de error', fmtBer(t5.enl.ber)]
    ] : []).concat(ap ? [
      ['Volante en la pasada', `<span class="servo-dot is-${ap.rq.ok ? 'dentro' : 'fuera'}" aria-hidden="true"></span>${ap.rq.ok ? 'Aguanta' : 'No aguanta'}`]
    ] : []).map(([a, b]) => `<div class="servo-resumen-row"><span>${a}</span><strong>${b}</strong></div>`).join('');

    graficasPaso1(r, c); graficasPaso2(r, c); graficasPaso3(r, c); graficasPaso4(r, c);
    if (t5) { actualizarPaso5(r, t5); graficasPaso5(t5, c); }
    if (a6) graficasPaso6(a6, ap, c);
  }

  const fmtPar = v => `${fmt(v * 1e3, 2)} mN·m`;
  const fmtH = v => `${fmt(v, 4)} N·m·s`;
  const fmtDur = s => (!isFinite(s) ? '∞' : s < 0 ? 'ya saturado' : s < 600 ? `${fmt(s)} s` : s < 7200 ? `${fmt(s / 60, 1)} min` : `${fmt(s / 3600, 1)} h`);
  const fmtMargen = m => (isFinite(m) ? `×${fmt(m, 2)}` : '∞');

  function actualizarPaso6(a6, ap) {
    const a = estado.act, m = a6.m, s = a6.s, conManiobra = a.thF !== 0;
    const avisos = [];
    if (a6.parPedido > a.tauMax * 1e-3 && a.man === 'escalon')
      avisos.push(`El escalón pide KP·θf = ${fmtPar(a6.parPedido)} en la primera muestra, más que τmax = ${fmt(a.tauMax, 1)} mN·m: el volante arranca saturado.`);
    if (m.tSatH != null)
      avisos.push(`El volante llega a su momento máximo en t = ${fmt(m.tSatH, 1)} s: a partir de ahí solo puede dar par de vaciado y la perturbación (o la maniobra) se lleva el satélite.`);
    if (a.KI > 0 && a.aw === 'ninguno' && m.tSatPar != null)
      avisos.push('Acción integral con el par saturado y sin anti-windup: el integrador se carga durante la saturación (windup).');
    $('sv-at-aviso').hidden = !avisos.length; $('sv-at-aviso').textContent = avisos.join(' ');

    const eFinDeg = m.e_reg * R2D, ePD = a.KI > 0 ? 0 : -(a.tauD * 1e-6) / a.KP;
    $('sv-k6').innerHTML = [
      kpi('Diseño', `KP ${fmtT(a.KP, 4)} · KD ${fmtT(a.KD, 3)}`, `ωn = ${fmtT(a.wn, 3)} rad/s · ζ = ${fmtT(a.zeta, 3)}${a.KI > 0 ? ` · KI = ${fmtSci(a.KI, 1)}` : ''}`),
      kpi('Sobreoscilación', conManiobra ? `${fmt(m.sobreosc, 2)} %` : '—', conManiobra ? `pico ${fmt(m.pico * R2D, 2)}° a ${fmtT(m.t_pico, 1)} s` : 'sin maniobra (θf = 0)'),
      kpi('Establecimiento (2 %)', !conManiobra ? '—' : isFinite(m.ts) ? `${fmt(m.ts, 1)} s` : 'no se establece', `T = ${fmtT(a.T)} s · ${fmt(s.N)} muestras`),
      kpi('Error de régimen', `${Math.abs(eFinDeg) >= 1 ? fmt(Math.abs(eFinDeg), 1) : fmtSci(Math.abs(eFinDeg), 2)}°`,
        m.tSatH != null ? `en t = ${fmt(a.hor)} s · volante lleno: el satélite deriva`
          : a.KI > 0 || a.des ? `en t = ${fmt(a.hor)} s · ${a.KI > 0 ? 'con KI' : 'con descarga'} tiende a 0`
            : `en t = ${fmt(a.hor)} s · PD: −τd/KP = ${fmtSci(Math.abs(ePD * R2D), 2)}°`, m.tSatH != null ? 'is-key' : ''),
      kpi('Pico de par', fmtPar(m.parPico), `límite ±${fmt(a.tauMax, 1)} mN·m`, m.tSatPar != null ? 'is-key' : ''),
      kpi('Saturación del par', m.tSatPar == null ? 'no satura' : `t = ${fmtT(m.tSatPar, 2)} s`, m.tSatH == null ? 'momento: no satura' : `momento: satura en t = ${fmt(m.tSatH, 1)} s`),
      kpi('Momento del volante', `${fmtH(m.hPico)}`, `pico · final ${fmtH(m.hFin)} · límite ${fmtT(a.hMax, 3)}`)
    ].join('');

    const sem = $('sv-at-sem'), k6p = $('sv-k6p');
    if (!ap) {
      sem.innerHTML = '<span class="servo-dot is-na" aria-hidden="true"></span><span>Sin pasada visible con los parámetros del panel de misión.</span>';
      k6p.innerHTML = '';
      return;
    }
    const q = ap.rq, falta = [];
    if (!q.parOk) falta.push('par'); if (!q.momentoOk) falta.push('momento');
    sem.innerHTML = `<span class="servo-dot is-${q.ok ? 'dentro' : 'fuera'}" aria-hidden="true"></span><span>${q.ok
      ? `<strong>El volante aguanta la pasada.</strong> Margen de par ${fmtMargen(q.margenPar)} y de momento ${fmtMargen(q.margenMomento)}.`
      : `<strong>El volante no aguanta la pasada:</strong> le falta ${falta.join(' y ')} (margen de par ${fmtMargen(q.margenPar)}, de momento ${fmtMargen(q.margenMomento)}).`}</span>`;
    const pas = cache.pasada;
    k6p.innerHTML = [
      kpi('Velocidad angular máx. (paso 1)', `${fmt(pas.omegaMax * D2R, 4)} rad/s`, `${fmt(pas.omegaMax, 3)} °/s · elevación máx. ${fmt(pas.elMax, 1)}°`),
      kpi('Aceleración angular máx.', `${fmtSci(q.alfaMax, 2)} rad/s²`, `cota del sobrevuelo plano: ${fmtSci(At.alfaSobrevuelo(pas.omegaMax * D2R), 2)}`),
      kpi('Par necesario', fmtPar(q.parNecesario), `J·α + |τd| frente a ${fmt(a.tauMax, 1)} mN·m · ${fmtMargen(q.margenPar)}`, q.parOk ? '' : 'is-key'),
      kpi('Momento necesario', fmtH(q.momentoNecesario), `J·ω + |τd|·${mmss(pas.dur)} frente a ${fmtT(a.hMax, 3)} · ${fmtMargen(q.margenMomento)}`, 'is-key'),
      kpi('Hasta saturar por la perturbación', fmtDur(q.tHastaSaturar), '(hmax − J·ωmáx)/|τd| sin descarga'),
      kpi('Momento simulado máx.', fmtH(ap.hMaxSim), ap.tSatH == null ? 'el momento no satura' : `satura en t = ${fmt(ap.tSatH, 1)} s del AOS`),
      kpi('Error máx. de apuntamiento', `${fmt(ap.eMax * R2D, 3)}°`, a.der === 'salida' && a.KI === 0 ? 'derivada de la salida: e ≈ KD·ω/KP frente a una rampa' : 'cuerpo frente a la línea de vista')
    ].join('');
  }

  const fmtDb = v => (isFinite(v) ? `${fmt(v, 1)} dB` : 'sin señal');
  const fmtBer = b => (b < 1e-15 ? '< 10⁻¹⁵' : fmtSci(b, 1));

  function actualizarPaso5(r, t5) {
    const p = estado.tm, M = t5.mod, D = t5.demod, V = t5.vor, E = t5.enl, fc = Tm.P3.fc;
    // Modulación
    const k5 = [];
    if (p.mod === 'dsb') {
      k5.push(kpi('Líneas en f_c ± f_m', fmt(M.linea(fc + p.fm), 4), `${fmt(fc - p.fm)} y ${fmt(fc + p.fm)} Hz · A_m/4`),
        kpi('Portadora en f_c', fmtSci(M.linea(fc), 1), 'suprimida: DSB no la transmite'),
        kpi('Ancho de banda', `${fmt(M.bw)} Hz`, '2·f_m'));
    } else if (p.mod === 'am') {
      k5.push(kpi('Índice β·A_m', fmt(M.indice, 3), M.indice > 1 ? 'sobremodulada: > 1' : 'sin sobremodulación', M.indice > 1 ? 'is-key' : ''),
        kpi('Portadora en f_c', fmt(M.linea(fc), 4), `${fmt(fc)} Hz · 1/2`),
        kpi('Bandas laterales', fmt(M.linea(fc + p.fm), 4), `${fmt(fc - p.fm)} y ${fmt(fc + p.fm)} Hz · β·A_m/4`),
        kpi('Ancho de banda', `${fmt(M.bw)} Hz`, '2·f_m'));
    } else {
      const l0 = M.lineasFM[0];
      k5.push(kpi('Desviación Δf', `${fmt(M.deltaF)} Hz`, 'k_f·max|m|'),
        kpi('Índice β_FM', fmt(M.betaFM, 2), 'Δf/f_m'),
        kpi('Ancho de Carson', `${fmt(M.bw)} Hz`, '2(Δf + f_m)'),
        kpi('Línea en f_c', fmt(l0.a, 4), `|J₀(β_FM)|/2 = ${fmt(l0.bessel, 4)}`));
      if (M.deltaF + p.fm > fc) k5.push(kpi('Aviso', 'Δf + f_m > f_c', 'las bandas negativas se pliegan sobre las positivas'));
    }
    $('sv-k5').innerHTML = k5.join('');

    // Demodulación AM (mensaje del enunciado, max|m| = 2)
    const so = D.sobremodulada, mes = D.mesetas;
    const av = $('sv-sobremod');
    av.hidden = !so && !(p.mod === 'am' && M.indice > 1);
    if (so) {
      av.innerHTML = `<strong>Sobremodulación: β·max|m| = ${fmt(D.indice, 2)} &gt; 1.</strong> En la meseta −2, 1 + β·m = ${fmt(D.minEnvolvente, 3)} &lt; 0: la portadora invierte su fase y el detector de envolvente solo ve |1 + β·m| = ${fmt(Math.abs(D.minEnvolvente), 3)}. Por eso (v − 1)/β da ${fmt(mes.correcta[1], 3)} en lugar de −2 (teoría: (|1 − 2β| − 1)/β = ${fmt(D.mesetaTeorica, 3)}). No es un efecto de la constante RC del detector: la envolvente de Hilbert no tiene RC. La información del signo se pierde en la modulación; se evita con β ≤ 1/max|m| = 0,5 o con detección coherente.`;
    } else if (!av.hidden) {
      av.innerHTML = `<strong>Sobremodulación del tono: β·A_m = ${fmt(M.indice, 2)} &gt; 1.</strong> 1 + β·m(t) se hace negativo en los valles del tono y la portadora invierte su fase: la envolvente |1 + β·m| ya no reproduce el mensaje.`;
    }
    $('sv-k5d').innerHTML = [
      kpi('Índice β·max|m|', fmt(D.indice, 2), so ? 'sobremodulada (> 1)' : 'sin sobremodulación', so ? 'is-key' : ''),
      kpi('Meseta +1', fmt(mes.correcta[0], 3), `guion: ${fmt(mes.guion[0], 3)}`),
      kpi('Meseta −2', fmt(mes.correcta[1], 3), `guion: ${fmt(mes.guion[1], 3)} · ${so ? 'no se recupera' : 'recuperada'}`, so ? 'is-key' : ''),
      kpi('Meseta 0', fmt(mes.correcta[2], 3), `mín. de 1 + β·m: ${fmt(D.minEnvolvente, 3)}`)
    ].join('');

    // VOR
    let err = V.rumbo - p.theta; err = ((err + 540) % 360) - 180;
    $('sv-k5v').innerHTML = [
      kpi('Rumbo elegido', `${fmt(p.theta)}°`, 'fase del 30 Hz de la FM'),
      kpi('Rumbo recuperado', `${fmt(V.rumbo, 2)}°`, Math.abs(err) < 0.005 ? 'error < 0,01°' : `error ${fmt(Math.abs(err), 2)}°`, 'is-key'),
      kpi('Ancho de Carson', `${fmt(V.carson)} Hz`, `${fmt(Tm.VOR.fsub - V.carson / 2)}–${fmt(Tm.VOR.fsub + V.carson / 2)} Hz`),
      kpi('Potencia dentro de Carson', `${fmt(100 * V.fraccionCarson, 1)} %`, 'de la subportadora'),
      kpi('Referencia AM', `${fmt(V.A30, 3)}`, `línea de 30 Hz (β/2) · DC ${fmt(V.DC, 3)}`)
    ].join('');

    // Enlace de telemetría
    const conPerdida = !r.L.na;
    $('sv-k5e').innerHTML = [
      kpi('Pérdida de ida (paso 3)', conPerdida ? (isFinite(t5.perdidaDb) ? `${fmt(t5.perdidaDb, 2)} dB` : 'sin señal') : '—', conPerdida ? (estado.servo.ref === 'pasada' ? 'máximo de la pasada' : 'error estacionario') : 'sin error de apuntamiento definido'),
      kpi('Alcance efectivo (paso 4)', r.L.na ? '—' : `${fmt(r.Ref / 1e3, 2)} km`, 'radar, ida y vuelta'),
      kpi('SNR del enlace γ', fmtDb(E.gammaDb), `referencia ${fmt(p.snrRef, 1)} dB`),
      kpi('C/N en la banda', fmtDb(E.cnrDb), `B_T = ${fmt(E.bTsobreW, 1)}·W · umbral γ = ${fmt(E.umbralGammaDb, 1)} dB`),
      kpi('SNR de salida', E.bajoUmbral ? 'bajo umbral' : fmtDb(E.snrSalidaDb), E.bajoUmbral ? 'el detector no da una SNR válida' : (p.enl === 'fm' ? '3·β_FM²·⟨m²⟩·γ' : 'γ·β²⟨m²⟩/(1 + β²⟨m²⟩)')),
      kpi('Tasa de error', fmtBer(E.ber), `sin pérdida: ${fmtBer(t5.enl0.ber)}${E.sobremodulada ? ' · AM sobremodulada' : ''}`, 'is-key')
    ].join('');
  }

  let programado = false, irPendiente = null;
  function programar() {
    if (programado) return;
    programado = true;
    requestAnimationFrame(() => {
      programado = false; actualizar();
      if (irPendiente) { const e = irPendiente; irPendiente = null; irAlPaso(e); }
    });
  }

  /** Escenarios de la misión con `paso` (y `bloque`): baja a donde se ve el efecto y lo resalta un momento.
   *  Los casos estudiados no lo necesitan: sus chips ya están junto a los controles que cambian. */
  let resalteTimer = null;
  function irAlPaso(esc) {
    const el = esc && esc.paso ? document.getElementById(esc.bloque || `servo-paso-${esc.paso}`) : null;
    if (!el) return;
    const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reducido ? 'auto' : 'smooth', block: 'start' });
    document.querySelectorAll('.servo-resaltado').forEach(x => x.classList.remove('servo-resaltado'));
    void el.offsetWidth;   // reinicia la animación si se repite el mismo bloque
    el.classList.add('servo-resaltado');
    clearTimeout(resalteTimer);
    resalteTimer = setTimeout(() => el.classList.remove('servo-resaltado'), 2400);
  }

  function conectar(root) {
    root.addEventListener('input', e => {
      const d = SLIDERS[e.target.id]; if (!d) return;
      d.set(+e.target.value); estado.modificado = true; programar();
    });
    root.addEventListener('change', e => {
      if (e.target.id === 'sv-sat') { estado.servo.sat = e.target.checked; estado.modificado = true; programar(); }
      if (e.target.id === 'sv-at-des') { estado.act.des = e.target.checked; estado.modificado = true; programar(); }
    });
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-grupo]');
      if (b) {
        const v = b.dataset.val;
        objDe(b)[b.dataset.grupo] = b.dataset.obj === 'act' && /^\d+(\.\d+)?$/.test(v) ? +v : v;
        estado.modificado = true; programar(); return;
      }
      const s = e.target.closest('[data-escenario]');
      if (s) {
        aplicarEscenario(s.dataset.escenario);
        const e2 = ESCENARIOS.find(x => x.id === s.dataset.escenario);
        irPendiente = e2 && e2.grupo === 'mision' && e2.paso ? e2 : null;
        programar();
      }
    });
  }

  // Se conserva por si se añade otra fase pendiente (hoy ninguna lo está).
  function renderPendiente(fase, container) {
    const txt = fase.desc || '';
    container.innerHTML = `
      <div class="servo-view">
        <header class="section-head reveal">
          <span class="section-index">F3</span>
          <div><span class="eyebrow">Próximamente</span><h2 class="section-title">${fase.label}</h2></div>
          <p class="section-intro">${txt}</p>
        </header>
      </div>`;
  }

  window.renderServoFase = function (id, container, sub) {
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
    conectarCarrusel(root);
    tablaValidacion();
    actualizar();
    const alias = { telemetria: 5, actitud: 6 }[sub];
    if (alias) setTimeout(() => irAlPaso({ paso: alias }), 0);
  };
})();
