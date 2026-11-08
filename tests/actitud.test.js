/* Pruebas del control de actitud en un eje (servo-actitud.js) frente a Python y a casos analíticos.
 *
 *   node tests/actitud.test.js
 *
 * Sin dependencias (node:assert). Las referencias de Python están en tests/actitud-referencias.json, generado con
 *   un script de Python local (exporta_referencias_actitud.py: planta por scipy.signal.cont2discrete en espacio de
 *   estados, PID, volante y métricas escritos de nuevo) que no forma parte de este repositorio.
 * Tolerancias: series |Δ| ≤ 1e-12 + 1e-9·|x| (misma aritmética en doble precisión, otra discretización); casos
 * analíticos exactos en discreto a 1e-9 relativo; comparación con el 2.º orden continuo a O(T).
 */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const A = require(path.join(__dirname, '..', 'servo-actitud.js'));
const S = require(path.join(__dirname, '..', 'servo-sim.js'));
const R = require(path.join(__dirname, '..', 'servo-radar.js'));
const REF = JSON.parse(fs.readFileSync(path.join(__dirname, 'actitud-referencias.json'), 'utf8'));

let ok = 0, fallos = 0;
function prueba(nombre, fn) {
  try { fn(); ok++; console.log('  ok   ' + nombre); }
  catch (err) { fallos++; console.log('  FALLO ' + nombre + '\n        ' + String(err.message).split('\n').join('\n        ')); }
}
function cerca(x, ref, tol, que) {
  assert.ok(Math.abs(x - ref) <= tol, `${que || ''}: ${x} frente a ${ref} (tol ${tol})`);
}
function serie(js, py, que, cada) {
  const c = cada || 1;
  assert.equal(Math.ceil(js.length / c), py.length, `${que}: longitud`);
  for (let i = 0; i < py.length; i++) {
    const x = js[i * c], tol = 1e-12 + 1e-9 * Math.abs(py[i]);
    if (!(Math.abs(x - py[i]) <= tol)) assert.fail(`${que}[${i * c}]: ${x} frente a ${py[i]}`);
  }
}
function metricasIguales(m, mp, que) {
  for (const k of ['pico', 'sobreosc', 't_pico', 'e_reg', 'parPico', 'omegaPico', 'hPico', 'hFin'])
    cerca(m[k], mp[k], 1e-12 + 1e-9 * Math.abs(mp[k]), `${que}.${k}`);
  for (const k of ['tSatPar', 'tSatH']) {
    if (mp[k] === null) assert.equal(m[k], null, `${que}.${k}`); else cerca(m[k], mp[k], 1e-9, `${que}.${k}`);
  }
  if (mp.ts === null) assert.equal(m.ts, Infinity, `${que}.ts`); else cerca(m.ts, mp.ts, 1e-9, `${que}.ts`);
}

const P = REF.param, C = REF.casos;
const { J, T, KP, KD, KI, paso } = P;
const D2R = Math.PI / 180;

console.log('\nservo-actitud.js — parámetros y diseño');

prueba('Diseño PD: ωn = √(KP/J), ζ = KD/(2√(KP·J)); valores por defecto del microsatélite', () => {
  const d = A.disenoPD(A.SAT.J, A.SAT.wn, A.SAT.zeta);
  cerca(d.KP, 0.02, 1e-15, 'KP'); cerca(d.KD, 0.28, 1e-15, 'KD');
  cerca(d.KP, KP, 1e-15, 'KP = Python'); cerca(d.KD, KD, 1e-15, 'KD = Python');
  const q = A.parametrosPD(A.SAT.J, d.KP, d.KD);
  cerca(q.wn, 0.1, 1e-15, 'ωn'); cerca(q.zeta, 0.7, 1e-15, 'ζ');
  const r = A.parametrosPD(3.7, 0.5, 0.9);
  cerca(r.wn, Math.sqrt(0.5 / 3.7), 1e-15); cerca(r.zeta, 0.9 / (2 * Math.sqrt(0.5 * 3.7)), 1e-15);
  cerca(50 * 0.5 * 0.5 / 6, A.SAT.J, 0.1, 'J ≈ m·a²/6 del cubo de 50 kg y 0,5 m');
});

prueba('Perturbación: gradiente gravitatorio a 500 km, ΔI = 0,5 kg·m², 45° → 0,92 µN·m (≈ τd por defecto)', () => {
  const g = A.parGradienteGravitatorio(500e3, 0.5, Math.PI / 4);
  const Rr = R.RE + 500e3;
  cerca(g, 1.5 * R.MU / (Rr * Rr * Rr) * 0.5, 1e-20, 'fórmula'); cerca(g, 0.919e-6, 0.0005e-6, '0,919 µN·m');
  assert.equal(A.MU, R.MU, 'mismo μ que servo-radar.js'); assert.equal(A.RT, R.RE, 'mismo radio terrestre');
  cerca(A.parGradienteGravitatorio(500e3, 0.5, 0), 0, 1e-30, 'alineado: sin par');
  assert.ok(A.SAT.tauD >= g && A.SAT.tauD < 2 * g, 'τd por defecto: el gradiente más un arrastre de su orden o menor');
});

prueba('Referencias: escalón y perfil con límite de velocidad', () => {
  const r = A.perfilApuntamiento(1000, 0.1, -paso, 0.5 * D2R);
  cerca(r[0], 0, 0); cerca(r[10], -0.5 * D2R, 1e-15, 'rampa a 0,5°/s'); cerca(r[999], -paso, 1e-15, 'final');
  for (let k = 1; k < r.length; k++) assert.ok(Math.abs(r[k] - r[k - 1]) <= 0.5 * D2R * 0.1 + 1e-15, 'velocidad ≤ ωmáx');
  assert.deepEqual(A.escalon(3, 2), [2, 2, 2]);
});

console.log('\nservo-actitud.js — mismo PID que servo-sim.js');

prueba('Sin perturbación ni volante limitado = ServoSim.simular con zohPlanta(1/J, 0, T) muestra a muestra', () => {
  const pl = S.zohPlanta(1 / J, 0, T);
  cerca(pl.b[1], T * T / (2 * J), 1e-18, 'b1 = T²/2J');
  const casos = [
    { KP, KD, derivada: 'salida' }, { KP, KD, derivada: 'error' }, { KP, KD, KI, derivada: 'salida' },
    { KP, KD, KI, derivada: 'salida', sat: 0.003, antiWindup: 'ninguno' },
    { KP, KD, KI, derivada: 'error', sat: 0.003, antiWindup: 'acotar', uImax: 0.002 },
    { KP, KD, KI, derivada: 'salida', sat: 0.003, antiWindup: 'congelar' },
  ];
  for (const c of casos) {
    const ref = A.escalon(2000, paso);
    const a = A.simular({ J, T, KP: c.KP, KI: c.KI, KD: c.KD, ref, derivada: c.derivada, tauMax: c.sat,
      antiWindup: c.antiWindup, uImax: c.uImax });
    const s = S.simular({ planta: pl, T, KP: c.KP, KI: c.KI, KD: c.KD, ref, derivada: c.derivada,
      sat: c.sat ? { min: -c.sat, max: c.sat } : null, antiWindup: c.antiWindup, uImax: c.uImax });
    const que = JSON.stringify(c);
    serie(a.theta, s.y, que + ' θ'); serie(a.u, s.u, que + ' u'); serie(a.e, s.e, que + ' e'); serie(a.uI, s.uI, que + ' uI');
  }
});

console.log('\nservo-actitud.js — frente a Python (scipy, implementación independiente)');

prueba('Series θ, ω, τ, h_w, uI, τm y métricas de los 10 casos iguales a Python', () => {
  const Nesc = C.pd_libre.N, esc = A.escalon(Nesc, paso), perfil = A.perfilApuntamiento(Nesc, T, paso, P.w_lim);
  const conf = {
    pd_libre: { ref: esc },
    pd_error: { ref: esc, derivada: 'error' },
    pd_sat_pert: { ref: esc, tauMax: 0.01, hMax: 0.1, tauD: 1e-6 },
    pid_ninguno: { ref: A.escalon(3000, paso), KI, tauMax: 0.003, antiWindup: 'ninguno', uImax: 0.003 },
    pid_acotar: { ref: A.escalon(3000, paso), KI, tauMax: 0.003, antiWindup: 'acotar', uImax: 0.003 },
    pid_congelar: { ref: A.escalon(3000, paso), KI, tauMax: 0.003, antiWindup: 'congelar', uImax: 0.003 },
    perfil: { ref: perfil, derivada: 'error', tauMax: 0.01, hMax: 0.1, tauD: 1e-6 },
    perfil_salida: { ref: perfil },
    llenado: { T: 0.5, ref: A.escalon(6000, 0), tauMax: 0.01, hMax: 0.1, tauD: 1e-4 },
    descarga: { T: 0.5, ref: A.escalon(6000, 0), tauMax: 0.01, hMax: 0.1, tauD: 1e-4, descarga: { kDes: 1e-2, tauMMax: 5e-4 } },
  };
  assert.deepEqual(Object.keys(conf).sort(), Object.keys(C).sort(), 'mismos casos');
  for (const [k, c] of Object.entries(conf)) {
    const s = A.simular(Object.assign({ J, T, KP, KD }, c)), py = C[k];
    assert.equal(s.N, py.N, k + ' N');
    for (const f of ['theta', 'omega', 'u', 'h', 'uI', 'tauM']) serie(s[f], py.serie[f], `${k}.${f}`, py.cada);
    metricasIguales(A.metricas(s), py.met, k);
  }
});

console.log('\nservo-actitud.js — casos analíticos');

prueba('PD sin perturbación: error → 0 (e(600 s) < 1e-12 rad) y h_w → 0', () => {
  const s = A.simular({ J, T, KP, KD, ref: A.escalon(6000, paso) });
  const m = A.metricas(s);
  assert.ok(Math.abs(m.e_reg) < 1e-12, 'e_reg ' + m.e_reg);
  assert.ok(Math.abs(m.hFin) < 1e-12, 'h_w final ' + m.hFin); // J·ω + h_w = 0 sin pares externos
});

prueba('PD con perturbación constante: e_reg = −τd/KP exacto; con acción integral e → 0', () => {
  for (const tauD of [1e-6, 1e-4, -3e-4]) {
    const s = A.simular({ J, T, KP, KD, ref: A.escalon(8000, paso), tauD });
    cerca(s.e[s.N - 1], -tauD / KP, 1e-9 * Math.abs(tauD / KP), 'PD τd=' + tauD);
    cerca(s.u[s.N - 1], -tauD, 1e-9 * Math.abs(tauD), 'el volante compensa τd');
    // la acción integral elimina el error (tercer polo lento, ≈ KI/KP = 0,02 rad/s)
    const si = A.simular({ J, T, KP, KD, KI, ref: A.escalon(40000, paso), tauD });
    assert.ok(Math.abs(si.e[si.N - 1]) < 1e-9 * Math.abs(tauD / KP), `PID τd=${tauD}: e = ${si.e[si.N - 1]}`);
    cerca(si.uI[si.N - 1], -tauD, 1e-9 * Math.abs(tauD), 'uI → −τd');
  }
});

prueba('Sin saturación tiende al 2.º orden continuo (ωn, ζ): error O(T) y Mp, ts del 2.º orden', () => {
  const tFin = 120, err = {};
  for (const Ts of [0.1, 0.01]) {
    const N = Math.round(tFin / Ts), s = A.simular({ J, T: Ts, KP, KD, ref: A.escalon(N, paso) });
    let e = 0; for (let k = 0; k < N; k++) e = Math.max(e, Math.abs(s.theta[k] / paso - A.escalonSegundoOrden(0.1, 0.7, k * Ts)));
    err[Ts] = e;
  }
  assert.ok(err[0.01] < 1e-3, 'T = 0,01 s: error máx. ' + err[0.01]);
  const ratio = err[0.1] / err[0.01];
  assert.ok(ratio > 8 && ratio < 12, 'el error escala con T (cociente ' + ratio + ')');
  const so = S.segundoOrden(0.1, 0.7);
  const s = A.simular({ J, T: 0.01, KP, KD, ref: A.escalon(12000, paso) }), m = A.metricas(s);
  cerca(m.sobreosc, so.Mp, 0.05, 'Mp (4,60 %)'); cerca(m.t_pico, so.tp, 0.2, 'tp');
  // la solución analítica en el instante continuo de 2 %: (último cruce de la banda)
  let tsC = 0; for (let k = 0; k < 12000; k++) if (Math.abs(A.escalonSegundoOrden(0.1, 0.7, k * 0.01) - 1) > 0.02) tsC = (k + 1) * 0.01;
  cerca(m.ts, tsC, 0.1, 'ts');
  // envolvente del 2.º orden subamortiguado: |θ − θf| ≤ A·e^(−ζωn t)/√(1−ζ²) (con un 1 % de holgura por el muestreo)
  for (let k = 0; k < 12000; k++) assert.ok(Math.abs(s.theta[k] - paso) <= paso * Math.exp(-0.07 * k * 0.01) / Math.sqrt(0.51) * 1.01 + 1e-12, 'envolvente k=' + k);
});

prueba('Seguimiento de rampa (perfil de velocidad limitada): e = KD·ω/KP con derivada de la salida, 0 con la del error', () => {
  const w = 0.5 * D2R, N = 2000; // rampa de 90° a 0,5°/s: 180 s
  const ref = A.perfilApuntamiento(N, T, 90 * D2R, w);
  const s = A.simular({ J, T, KP, KD, ref, derivada: 'salida' });
  cerca(s.e[1700], KD * w / KP, 1e-5 * KD * w / KP, 'e rampa (salida)');
  const s2 = A.simular({ J, T, KP, KD, ref, derivada: 'error' });
  assert.ok(Math.abs(s2.e[1700]) < 1e-5 * KD * w / KP, 'e rampa (error) ' + s2.e[1700]);
});

prueba('Saturación de par: el tiempo de maniobra crece al bajar τmax y el par nunca pasa del límite', () => {
  // τmax = 0,01 solo recorta la primera muestra (KP·30° = 10,5 mN·m): ts igual a la resolución de T; el resto lo alarga
  let tsAnt = 0;
  for (const tauMax of [Infinity, 0.01, 0.005, 0.002, 0.001]) {
    const s = A.simular({ J, T, KP, KD, ref: A.escalon(4000, paso), tauMax }), m = A.metricas(s);
    if (tauMax === 0.01) assert.ok(m.ts >= tsAnt, `τmax=${tauMax}: ts ${m.ts} ≥ ${tsAnt}`);
    else assert.ok(m.ts > tsAnt, `τmax=${tauMax}: ts ${m.ts} > ${tsAnt}`);
    assert.ok(m.parPico <= tauMax, 'par ≤ τmax');
    if (isFinite(tauMax)) assert.equal(m.tSatPar, 0, 'satura al arrancar'); else assert.equal(m.tSatPar, null);
    tsAnt = m.ts;
  }
});

prueba('Windup: sin anti-windup el PID saturado sobreoscila y tarda más que con acotar / congelar', () => {
  const m = {};
  for (const aw of ['ninguno', 'acotar', 'congelar'])
    m[aw] = A.metricas(A.simular({ J, T, KP, KD, KI, ref: A.escalon(3000, paso), tauMax: 0.003, antiWindup: aw, uImax: 0.003 }));
  const libre = A.metricas(A.simular({ J, T, KP, KD, KI, ref: A.escalon(3000, paso) }));
  assert.ok(m.ninguno.sobreosc > m.acotar.sobreosc && m.acotar.sobreosc > m.congelar.sobreosc, 'Mp');
  assert.ok(m.ninguno.ts > m.acotar.ts && m.acotar.ts > m.congelar.ts, 'ts');
  assert.ok(m.ninguno.sobreosc > libre.sobreosc, 'la saturación sin anti-windup empeora el PID libre');
  for (const aw of ['ninguno', 'acotar', 'congelar']) assert.ok(Math.abs(m[aw].e_reg) < 1e-3 * paso, aw + ': el integrador acaba en 0');
});

prueba('Conservación del momento: J·ω + h_w = Σ (τd + τm)·T (con saturación y descarga)', () => {
  const s = A.simular({ J, T: 0.5, KP, KD, ref: A.escalon(4000, 0.2), tauMax: 0.01, hMax: 0.1, tauD: (k) => 1e-4 * Math.sin(k / 50) + 5e-5,
    h0: 0.03, omega0: 0.001, descarga: { kDes: 1e-2, tauMMax: 5e-4 } });
  const H = A.momentoTotal(s);
  let ext = J * 0.001 + 0.03;
  for (let k = 0; k < s.N; k++) { cerca(H[k], ext, 1e-13, 'H k=' + k); ext += (s.tauD[k] + s.tauM[k]) * 0.5; }
  for (const h of s.h) assert.ok(Math.abs(h) <= 0.1 + 1e-15, '|h_w| ≤ hmax');
});

prueba('El volante se llena: satura en t ≈ hmax/τd = 1000 s y el satélite deriva; con magnetopares h_w → τd/kDes y e → 0', () => {
  const base = { J, T: 0.5, KP, KD, ref: A.escalon(6000, 0), tauMax: 0.01, hMax: 0.1, tauD: 1e-4 };
  const m = A.metricas(A.simular(base));
  cerca(m.tSatH, 0.1 / 1e-4, 2 * 0.5, 'instante de saturación del momento');
  assert.ok(Math.abs(m.e_reg) > 10, 'sin descarga se pierde el apuntamiento: e = ' + m.e_reg);
  const sd = A.simular(Object.assign({ descarga: { kDes: 1e-2, tauMMax: 5e-4 } }, base)), md = A.metricas(sd);
  assert.equal(md.tSatH, null, 'con descarga no satura');
  cerca(md.hFin, 1e-4 / 1e-2, 1e-9, 'h_w = τd/kDes');
  assert.ok(Math.abs(md.e_reg) < 1e-12, 'los magnetopares absorben τd: e = ' + md.e_reg);
  // con descarga insuficiente (τmMax < τd) el volante acaba saturando igual, más tarde
  const mi = A.metricas(A.simular(Object.assign({ descarga: { kDes: 1e-2, tauMMax: 5e-5 } }, base)));
  assert.ok(mi.tSatH > m.tSatH, 'descarga insuficiente: satura más tarde');
  // h_w sube como τd/kDes·(1 − e^(−kDes t)) hasta que τm llega a τmMax (h = τmMax/kDes, en t = ln 2/kDes) y luego
  // linealmente a (τd − τmMax): t_sat ≈ ln2/kDes + (hmax − τmMax/kDes)/(τd − τmMax) = 1969,3 s (± el transitorio de J·ω)
  cerca(mi.tSatH, Math.LN2 / 1e-2 + (0.1 - 5e-5 / 1e-2) / (1e-4 - 5e-5), 2, 'instante analítico');
});

console.log('\nservo-actitud.js — enlace con la misión (paso sobre la estación)');

prueba('Sobrevuelo rectilíneo: |dω/dt|máx = 3√3/8·ω0² (diferencias finitas)', () => {
  const v = 7600, d = 500e3, w0 = v / d, t = [], w = [];
  for (let k = -20000; k <= 20000; k++) { const tt = k * 0.01; t.push(tt); w.push(w0 / (1 + (v * tt / d) ** 2)); }
  cerca(A.alfaDeSerie(t, w), A.alfaSobrevuelo(w0), 1e-6 * A.alfaSobrevuelo(w0), 'α máx');
});

prueba('Requisito de la pasada cenital a 500 km con el volante por defecto: lo aguanta; y casos que no', () => {
  const h = 500e3, el = R.elementosCirculares({ h, iDeg: 90, raanDeg: 0, u0Deg: 0 });
  const p = R.pasada({ elem: el, estacion: R.estacion({ latDeg: 0, lonDeg: 0, h: 0 }), t0: -400, t1: 400, dt: 0.1, rotacion: false });
  const wMax = p.omegaMax * D2R;
  cerca(wMax, Math.sqrt(R.MU / (R.RE + h)) / h, 1e-9 * wMax, 'ω máx = v/h');
  const alfa = A.alfaDeSerie(p.t, p.omega.map((x) => x * D2R));
  const rq = A.requisitoSeguimiento({ omegaMax: wMax, alfaMax: alfa });
  cerca(rq.momentoNecesario, A.SAT.J * wMax, 1e-15, 'h = J·ω');
  cerca(rq.parNecesario, A.SAT.J * alfa + A.SAT.tauD, 1e-15, 'τ = J·α + τd');
  assert.ok(rq.ok && rq.margenMomento > 1 && rq.margenPar > 1, 'el volante por defecto lo aguanta');
  // en esta pasada la cota del sobrevuelo plano (3√3/8·ω²) queda por encima de la α real (Tierra esférica): conservadora
  const rqPlano = A.requisitoSeguimiento({ omegaMax: wMax });
  cerca(rqPlano.alfaMax, 3 * Math.sqrt(3) / 8 * wMax * wMax, 1e-18);
  assert.ok(alfa < rqPlano.alfaMax && alfa > 0.85 * rqPlano.alfaMax, `α(pasada) ${alfa} frente a α(plano) ${rqPlano.alfaMax}`);
  assert.ok(rqPlano.ok, 'con la cota plana también lo aguanta');
  console.log(`        ω máx ${wMax.toExponential(4)} rad/s · α pasada ${alfa.toExponential(4)} · α plano ${rqPlano.alfaMax.toExponential(4)} rad/s² · h ${rq.momentoNecesario.toFixed(4)} N·m·s · τ ${rq.parNecesario.toExponential(3)} N·m`);
  const chico = A.requisitoSeguimiento({ omegaMax: wMax, alfaMax: alfa, hMax: 0.02 });
  assert.ok(!chico.momentoOk && chico.parOk && !chico.ok, 'volante de 0,02 N·m·s: no almacena J·ω');
  const flojo = A.requisitoSeguimiento({ omegaMax: wMax, alfaMax: alfa, tauMax: 1e-4 });
  assert.ok(!flojo.parOk && flojo.momentoOk, 'volante de 0,1 mN·m: no da el par');
  const largo = A.requisitoSeguimiento({ omegaMax: wMax, tauD: 1e-4, duracion: 900 });
  cerca(largo.momentoNecesario, A.SAT.J * wMax + 0.09, 1e-15, 'momento acumulado por τd');
  cerca(largo.tHastaSaturar, (0.1 - A.SAT.J * wMax) / 1e-4, 1e-9, 't hasta saturar');
  assert.equal(A.requisitoSeguimiento({ omegaMax: wMax, tauD: 0 }).tHastaSaturar, Infinity);
});

prueba('Simulación del seguimiento: con la ω(t) de la pasada como referencia el volante almacena ≈ J·ω', () => {
  const h = 500e3, el = R.elementosCirculares({ h, iDeg: 90, raanDeg: 0, u0Deg: 0 });
  const est = R.estacion({ latDeg: 0, lonDeg: 0, h: 0 });
  const Ts = 0.1, t0 = -300, N = 6000;
  // ángulo de la línea de vista en el plano orbital: integral de ω (signo constante en esta pasada)
  const ref = new Array(N); let ang = 0;
  for (let k = 0; k < N; k++) {
    ref[k] = ang;
    const wa = R.observar(el, est, t0 + k * Ts, { rotacion: false }).omega, wb = R.observar(el, est, t0 + (k + 1) * Ts, { rotacion: false }).omega;
    ang += (wa + wb) / 2 * D2R * Ts;
  }
  const s = A.simular({ J, T: Ts, KP, KD, KI, ref, derivada: 'error', tauMax: A.SAT.tauMax, hMax: A.SAT.hMax, tauD: A.SAT.tauD });
  const m = A.metricas(s);
  const rq = A.requisitoSeguimiento({ omegaMax: Math.sqrt(R.MU / (R.RE + h)) / h });
  assert.equal(m.tSatH, null, 'el momento no satura');
  cerca(m.hPico, rq.momentoNecesario, 0.05 * rq.momentoNecesario, 'pico de h_w ≈ J·ω máx');
});

console.log(`\n${ok} pruebas correctas, ${fallos} fallidas`);
process.exitCode = fallos ? 1 : 0;
