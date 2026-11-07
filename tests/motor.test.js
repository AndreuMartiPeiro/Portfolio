/* Pruebas del motor numérico (servo-sim.js + servo-radar.js) frente a Python y a casos analíticos.
 *
 *   node tests/motor.test.js
 *
 * Sin dependencias (node:assert). Las referencias de Python están en tests/motor-referencias.json, generado con
 *   un script de Python local (exporta_referencias.py) que no forma parte de este repositorio.
 * Tolerancias: series temporales |Δ| ≤ 1e-9·máx(1, |x|) (misma aritmética en doble precisión); cifras publicadas
 * a la precisión con la que se publican; antenas ±0,001° frente a scipy (J1 de Abramowitz–Stegun en el JS).
 */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const S = require(path.join(__dirname, '..', 'servo-sim.js'));
const R = require(path.join(__dirname, '..', 'servo-radar.js'));
const REF = JSON.parse(fs.readFileSync(path.join(__dirname, 'motor-referencias.json'), 'utf8'));

let ok = 0, fallos = 0;
function prueba(nombre, fn) {
  try { fn(); ok++; console.log('  ok   ' + nombre); }
  catch (err) { fallos++; console.log('  FALLO ' + nombre + '\n        ' + String(err.message).split('\n').join('\n        ')); }
}
function cerca(x, ref, tol, que) {
  assert.ok(Math.abs(x - ref) <= tol, `${que || ''}: ${x} frente a ${ref} (tol ${tol})`);
}
/** Cifra «publicada»: |x − cifra| ≤ media unidad del último decimal. Se admite el empate exacto porque Python
 *  redondea al par (0,3125 → «0,312»; 1,625 → «1,62») y toFixed no. */
function publicado(x, cifra, dec, que) {
  const tol = 0.5 * Math.pow(10, -dec) * (1 + 1e-9);
  assert.ok(Math.abs(x - cifra) <= tol, `${que || ''}: ${x} no redondea a ${cifra} con ${dec} decimales`);
}
function serie(js, py, que) {
  assert.equal(js.length, py.length, `${que}: longitud`);
  for (let k = 0; k < py.length; k++) {
    const tol = 1e-9 * Math.max(1, Math.abs(py[k]));
    if (!(Math.abs(js[k] - py[k]) <= tol)) assert.fail(`${que}[${k}]: ${js[k]} frente a ${py[k]}`);
  }
}
function metricasIguales(m, mp, que) {
  for (const k of ['pico', 'sobreosc', 't_pico', 'u0', 'umax', 'y_fin']) cerca(m[k], mp[k], 1e-8 * Math.max(1, Math.abs(mp[k])), `${que}.${k}`);
  if (mp.ts2 === null) assert.equal(m.ts2, Infinity, `${que}.ts2`); else cerca(m.ts2, mp.ts2, 1e-12, `${que}.ts2`);
}

const P = REF.p1;
const planta = S.plantaP1();   // Ra·J = 0,010854, T = 0,0625
const T = S.P1.T;

// ============================================================================ servo-sim.js
console.log('\nservo-sim.js — planta y lazo de la P1');

prueba('V1 planta P1 por ZOH = cont2discrete de scipy', () => {
  serie(planta.b, P.b, 'b'); serie(planta.a, P.a, 'a');
  cerca(planta.b[1], 0.01344, 5e-6, 'b1'); cerca(planta.b[2], 0.01329, 5e-6, 'b2'); cerca(planta.a[1], -1.96775, 5e-6, 'a1');
  const p001 = S.plantaP1(0.01); serie(p001.b, P.T001.b, 'b (T=0,01)'); serie(p001.a, P.T001.a, 'a (T=0,01)');
});

prueba('ZOH: rama de series (aT < 0,1) y rama directa empalman', () => {
  const x = 0.1, K = 1, a = 1;
  const p1 = S.zohPlanta(K, a, x * (1 - 1e-12)), p2 = S.zohPlanta(K, a, x * (1 + 1e-12));
  // la diferencia esperada por el cambio de T (2e-13 en aT) es ≈ 2e-14; un error de rama sería ≫ 1e-13
  cerca(p1.b[1], p2.b[1], 1e-13, 'b1'); cerca(p1.b[2], p2.b[2], 1e-13, 'b2');
  const pa = S.zohPlanta(K, a, x * (1 - 1e-15)), pb = S.zohPlanta(K, a, x);
  cerca(pa.b[1] / pb.b[1], 1, 1e-13, 'b1 relativo'); cerca(pa.b[2] / pb.b[2], 1, 1e-13, 'b2 relativo');
  const d = S.zohPlanta(3, 1e-9, 0.01); cerca(d.b[1], 3 * 1e-4 / 2, 1e-15, 'casi doble integrador');
});

prueba('V2/E1 Fig. 20–22: series y(k), u(k), e(k), uI(k) muestra a muestra', () => {
  const s = S.simular({ planta, T, KP: 4, KI: 8, KD: 1, ref: S.escalon(64, 10) });
  serie(s.y, P.E1.y, 'y'); serie(s.u, P.E1.u, 'u'); serie(s.e, P.E1.e, 'e'); serie(s.uI, P.E1.uI, 'uI');
  assert.equal(s.y[0], 0, 'y(0) = 0: sin retardo extra el primer u actúa en k = 1');
  cerca(s.y[1], 2.72163, 5e-6, 'y(1)');
});

prueba('E1 cifras publicadas: u(0)=202,50; pico 14,88 en 0,312 s; 48,8 %; ts 1,62 s; ρ 0,862', () => {
  const s = S.simular({ planta, T, KP: 4, KI: 8, KD: 1, ref: S.escalon(64, 10) });
  const m = S.metricas(s.y, s.u, 10, T);
  metricasIguales(m, P.E1.met, 'E1');
  publicado(m.u0, 202.5, 2, 'u(0)'); publicado(m.pico, 14.88, 2, 'pico'); publicado(m.t_pico, 0.312, 3, 't_pico');
  publicado(m.sobreosc, 48.8, 1, 'Mp'); publicado(m.ts2, 1.62, 2, 'ts'); publicado(m.y_fin, 10, 3, 'y final');
  const rho = S.radioEspectral(planta, 4, 8, 1, T);
  cerca(rho, P.E1.rho, 1e-9, 'ρ'); publicado(rho, 0.862, 3, 'ρ');
});

prueba('V3 ajustes (escalón 10, N = 400): métricas y ρ iguales a Python', () => {
  const pub = { '4/1/8': [48.8, 1.62], '5/2.5/6': [56.8, 1.19], '6/3/5': [70.9, 1.38], '3/1/0.5': [28.7, 1.00], '2/1/0.5': [19.2, 1.56], '1/1/1': [9.9, 2.62] };
  for (const [k, v] of Object.entries(P.ajustes)) {
    const s = S.simular({ planta, T, KP: v.KP, KI: v.KI, KD: v.KD, ref: S.escalon(400, 10) });
    const m = S.metricas(s.y, s.u, 10, T);
    metricasIguales(m, v.met, k);
    publicado(m.sobreosc, pub[k][0], 1, k + ' Mp'); publicado(m.ts2, pub[k][1], 2, k + ' ts');
    cerca(S.radioEspectral(planta, v.KP, v.KI, v.KD, T), v.rho, 1e-9, k + ' ρ');
  }
});

prueba('V7 estabilidad: KD = 0 → ρ 1,069 y KD = 5 → ρ 1,057 (inestables); T = 0,01 → ρ 0,982', () => {
  cerca(S.radioEspectral(planta, 4, 8, 0, T), P.rho_e['KD=0'], 1e-9, 'KD=0'); publicado(S.radioEspectral(planta, 4, 8, 0, T), 1.069, 3);
  cerca(S.radioEspectral(planta, 4, 8, 5, T), P.rho_e['KD=5'], 1e-9, 'KD=5'); publicado(S.radioEspectral(planta, 4, 8, 5, T), 1.057, 3);
  cerca(S.radioEspectral(planta, 1, 8, 1, T), P.rho_e['KP=1'], 1e-9, 'KP=1');
  cerca(S.radioEspectral(planta, 4, 20, 1, T), P.rho_e['KI=20'], 1e-9, 'KI=20');
  const p001 = S.plantaP1(0.01); cerca(S.radioEspectral(p001, 4, 8, 1, 0.01), P.T001.rho, 1e-9, 'T=0,01');
  const s = S.simular({ planta, T, KP: 4, KI: 8, KD: 0, ref: S.escalon(400, 10), limite: 1e4 });
  assert.ok(s.divergeEn !== null && s.N < 400, 'el corte por |y| > límite debe saltar en un lazo inestable');
});

prueba('V2 complemento T = 0,01 s: u(0) = 1040,4; 31,3 %; ts 1,78 s', () => {
  const p001 = S.plantaP1(0.01);
  const s = S.simular({ planta: p001, T: 0.01, KP: 4, KI: 8, KD: 1, ref: S.escalon(400, 10) });
  const m = S.metricas(s.y, s.u, 10, 0.01);
  metricasIguales(m, P.T001.met, 'T001');
  publicado(m.u0, 1040.4, 1); publicado(m.sobreosc, 31.3, 1); publicado(m.ts2, 1.78, 2);
});

console.log('\nservo-sim.js — mejoras 4.7 (saturación, anti-windup, derivative kick)');

prueba('V4 saturación ±50 V (15/1/20): sin saturar 316 V y pico 20,70; saturado pico 19,63, y final 10,000', () => {
  const s0 = S.simular({ planta, T, KP: 15, KI: 20, KD: 1, ref: S.escalon(240, 10) });
  const s1 = S.simular({ planta, T, KP: 15, KI: 20, KD: 1, ref: S.escalon(240, 10), sat: { min: -50, max: 50 } });
  const m0 = S.metricas(s0.y, s0.u, 10, T), m1 = S.metricas(s1.y, s1.u, 10, T);
  metricasIguales(m0, P.sat.sin, 'sin'); metricasIguales(m1, P.sat.con, 'con');
  serie(s1.y, P.sat.y_con, 'y saturado'); serie(s1.u, P.sat.u_con, 'u saturado');
  publicado(m0.umax, 316, 0); publicado(m0.pico, 20.70, 2); publicado(m1.pico, 19.63, 2); publicado(m1.y_fin, 10, 3); publicado(m1.umax, 50, 6);
});

prueba('V5 windup UMAX = 10 (4/1/8): 86,9 % / 25,0 % / 18,6 % y uI máx. 32,1 / 10,0 / 8,2', () => {
  const casos = {
    ref: {}, windup: { sat: { min: -10, max: 10 } },
    acotada: { sat: { min: -10, max: 10 }, antiWindup: 'acotar', uImax: 10 },
    congelada: { sat: { min: -10, max: 10 }, antiWindup: 'congelar' },
  };
  const pub = { ref: [48.8, 9.2, 1.62], windup: [86.9, 32.1, 3.19], acotada: [25.0, 10.0, 1.56], congelada: [18.6, 8.2, 1.62] };
  for (const [k, kw] of Object.entries(casos)) {
    const s = S.simular(Object.assign({ planta, T, KP: 4, KI: 8, KD: 1, ref: S.escalon(160, 10) }, kw));
    const py = P.windup.casos[k];
    serie(s.y, py.y, k + '.y'); serie(s.u, py.u, k + '.u'); serie(s.uI, py.uI, k + '.uI');
    const m = S.metricas(s.y, s.u, 10, T);
    metricasIguales(m, py.met, k);
    const uImax = Math.max(...s.uI.map(Math.abs));
    publicado(m.sobreosc, pub[k][0], 1, k + ' Mp'); publicado(uImax, pub[k][1], 1, k + ' uImax'); publicado(m.ts2, pub[k][2], 2, k + ' ts');
  }
});

prueba('V6 derivative kick, onda cuadrada 0/10 (semiperiodo 100): ±202,5 frente a ±42,5; picos 14,88 / 14,13', () => {
  const ref = S.cuadrada(400, 10, 100);
  const pub = { error: [202.5, -202.5, 14.88], salida: [42.5, -42.5, 14.13] };
  for (const d of ['error', 'salida']) {
    const s = S.simular({ planta, T, KP: 4, KI: 8, KD: 1, ref, derivada: d });
    const py = P.kick.casos[d];
    serie(s.y, py.y, d + '.y'); serie(s.u, py.u, d + '.u');
    publicado(s.u[0], pub[d][0], 1, d + ' u(0)'); publicado(s.u[100], pub[d][1], 1, d + ' u(flanco)');
    publicado(Math.max(...s.y), pub[d][2], 2, d + ' pico');
  }
  const c = S.simular({ planta, T, KP: 4, KI: 8, KD: 1, ref, derivada: 'salida', sat: { min: -10, max: 10 }, antiWindup: 'acotar', uImax: 10 });
  serie(c.y, P.completo.y, 'PID completo y');
  publicado(Math.max(...c.u.map(Math.abs)), 10, 6, 'completo |u|max'); publicado(Math.max(...c.y), 12.50, 2, 'completo pico');
});

prueba('Saturación sin «−U_MIN»: con U ∈ [−50, 50] u alcanza los dos límites', () => {
  const s = S.simular({ planta, T, KP: 15, KI: 20, KD: 1, ref: S.cuadrada(400, 10, 100), sat: { min: -50, max: 50 } });
  assert.equal(Math.max(...s.u), 50); assert.equal(Math.min(...s.u), -50);
});

console.log('\nservo-sim.js — pedestal del radar');
const PE = REF.pedestal;

prueba('V9 fórmulas de 2.º orden: Km 6,944; Mp 9,48 %; tp 0,4712 s; ts 0,80 s; e_ss 0,00720 rad', () => {
  cerca(S.PEDESTAL.Km, PE.Km, 1e-12, 'Km');
  const f = S.segundoOrden(S.PEDESTAL.wn, S.PEDESTAL.xi);
  cerca(f.Mp, PE.teorico.Mp, 1e-12, 'Mp'); cerca(f.tp, PE.teorico.tp, 1e-12, 'tp'); cerca(f.ts2, PE.teorico.ts_regla, 1e-12, 'ts');
  publicado(f.Mp, 9.48, 2); publicado(f.tp, 0.4712, 4); publicado(0.05 / S.PEDESTAL.Km, 0.0072, 5);
  const g = S.segundoOrden(6, 0.4); publicado(g.Mp, 25.38, 2, 'V14 Mp'); publicado(g.tp, 0.571, 3, 'V14 tp'); publicado(g.ts2, 1.667, 3, 'V14 ts');
});

prueba('V10 efecto del muestreo (P = Km, escalón 1): 9,60 / 10,10 / 10,75 / 12,14 / 17,06 %; e_ss = 0,0072 rad', () => {
  const pub = { '0.001': 9.60, '0.005': 10.10, '0.01': 10.75, '0.02': 12.14, '0.05': 17.06 };
  for (const [k, v] of Object.entries(PE.muestreo)) {
    const pl = S.plantaPedestal(v.T);
    serie(pl.b, v.b, k + ' b'); serie(pl.a, v.a, k + ' a');
    const s = S.simular({ planta: pl, T: v.T, KP: S.PEDESTAL.Km, ref: S.escalon(v.N, 1) });
    const m = S.metricas(s.y, s.u, 1, v.T);
    metricasIguales(m, v.met, 'T=' + k);
    publicado(m.sobreosc, pub[k], 2, 'T=' + k + ' Mp');
    const sr = S.simular({ planta: pl, T: v.T, KP: S.PEDESTAL.Km, ref: S.rampa(v.N, v.T, 0.05) });
    cerca(sr.e[sr.N - 1], v.e_fin, 1e-12, 'T=' + k + ' e_ss'); publicado(sr.e[sr.N - 1], 0.0072, 5);
    // ρ del P puro: polinomio simplificado (ver nota en polinomioCaracteristico)
    cerca(S.radioEspectral(pl, S.PEDESTAL.Km, 0, 0, v.T), v.rho, 1e-12, 'T=' + k + ' ρ');
  }
  const m1 = S.metricas(...(() => { const s = S.simular({ planta: S.plantaPedestal(0.001), T: 0.001, KP: S.PEDESTAL.Km, ref: S.escalon(4000, 1) }); return [s.y, s.u]; })(), 1, 0.001);
  publicado(m1.t_pico, 0.470, 3, 'tp'); publicado(m1.ts2, 0.713, 3, 'ts');
});

prueba('E9 PI en el pedestal (T = 0,005): e(10 s) = 3,8e-4 (KI = 2) y ≈ 3e-6 rad (KI = 5)', () => {
  const pl = S.plantaPedestal(PE.PI.T);
  for (const [k, v] of Object.entries(PE.PI.casos)) {
    const s = S.simular({ planta: pl, T: PE.PI.T, KP: S.PEDESTAL.Km, KI: v.KI, ref: S.rampa(PE.PI.N, PE.PI.T, 0.05) });
    cerca(s.e[s.N - 1], v.e_10s, 1e-12, 'KI=' + k);
    cerca(S.radioEspectral(pl, S.PEDESTAL.Km, v.KI, 0, PE.PI.T), v.rho, 1e-9, 'ρ KI=' + k);
  }
  publicado(PE.PI.casos['2'].e_10s, 3.8e-4, 5); publicado(PE.PI.casos['5'].e_10s, 3e-6, 6);
});

prueba('Raíces (Aberth): polinomios conocidos', () => {
  const r = S.raices([1, -6, 11, -6]).map((v) => v[0]).sort((a, b) => a - b);
  cerca(r[0], 1, 1e-12); cerca(r[1], 2, 1e-12); cerca(r[2], 3, 1e-12);
  const c = S.raices([1, 0, 0, 0, 1]); // z⁴ + 1: |z| = 1
  for (const v of c) cerca(Math.hypot(v[0], v[1]), 1, 1e-12);
});

// ============================================================================ servo-radar.js
console.log('\nservo-radar.js — antena');
const A = REF.antena;

prueba('Bessel J1 (Abramowitz–Stegun) frente a scipy.special.j1: |Δ| < 1e-7', () => {
  for (const [x, v] of Object.entries(A.j1)) cerca(R.besselJ1(Number(x)), v, 1e-7, 'J1(' + x + ')');
  cerca(R.besselJ1(-2.5), -A.j1['2.5'], 1e-7, 'J1 impar');
  cerca(R.besselJ1(A.x1), 0, 1e-7, 'J1(3,8317)');
});

prueba('V11 reflector de la P4 (a = 18 cm, 9 GHz): HPBW 5,46/5,45°; FNBW 12,97°; NLPS 17,57/17,67 dB', () => {
  for (const pl of ['E', 'H']) {
    const h = R.haz({ a: 0.18, f: 9e9, plano: pl }), h3 = R.haz({ a: 0.18, f: 9e9, plano: pl, nivel: Math.pow(10, -0.3) });
    const py = A.P4[pl];
    cerca(h.hpbw, py.hpbw, 1e-3, pl + ' hpbw'); cerca(h3.hpbw, py.hpbw_3, 1e-3, pl + ' hpbw -3,00');
    cerca(h.fnbw, py.fnbw, 1e-9, pl + ' fnbw'); cerca(h.nlps, py.nlps, 1e-3, pl + ' nlps'); cerca(h.thetaSec, py.theta_sec, 1e-3, pl + ' θsec');
  }
  publicado(R.haz({ a: 0.18, f: 9e9 }).hpbw, 5.46, 2); publicado(R.haz({ a: 0.18, f: 9e9, nivel: Math.pow(10, -0.3) }).hpbw, 5.45, 2);
  publicado(R.haz({ a: 0.18, f: 9e9, plano: 'H', nivel: Math.pow(10, -0.3) }).hpbw, 5.44, 2);
  publicado(R.haz({ a: 0.18, f: 9e9 }).fnbw, 12.97, 2); publicado(R.haz({ a: 0.18, f: 9e9 }).nlps, 17.57, 2);
  publicado(R.haz({ a: 0.18, f: 9e9, plano: 'H' }).nlps, 17.67, 2);
});

prueba('V12 antena del radar (4 m, 3 GHz): θ3dB 1,4740°; FNBW 3,4946°', () => {
  const h = R.haz({ a: 2, f: 3e9 });
  cerca(h.hpbw, A.radar.E.hpbw, 1e-4, 'hpbw'); cerca(h.fnbw, A.radar.E.fnbw, 1e-9, 'fnbw');
  publicado(h.hpbw, 1.474, 3); publicado(h.fnbw, 3.4946, 4);
  publicado(h.hpbw / 2, 0.737, 3, 'semihaz');
});

prueba('V12 pérdida de apuntamiento (Airy): 0,4125° → 0,90 / 1,81 dB; 0,825° → 7,67 dB', () => {
  for (const v of Object.values(A.perdidas_radar_E)) {
    const L = R.perdidaApuntamiento(v.err_deg, { a: 2, f: 3e9 });
    cerca(L.ida, v.ida_dB, 1e-5, 'ida ' + v.err_deg); cerca(L.idaVuelta, v.idaVuelta_dB, 2e-5, 'i/v ' + v.err_deg);
  }
  const ess = 0.05 / S.PEDESTAL.Km * 180 / Math.PI;
  const L = R.perdidaApuntamiento(ess, { a: 2, f: 3e9 });
  publicado(ess, 0.4125, 4, 'e_ss [°]'); publicado(L.ida, 0.90, 2); publicado(L.idaVuelta, 1.81, 2);
  publicado(R.perdidaApuntamiento(2 * ess, { a: 2, f: 3e9 }).idaVuelta, 7.67, 2);
  assert.equal(R.clasificarApuntamiento(ess, 1.474), 'degradado');
  assert.equal(R.clasificarApuntamiento(0.3, 1.474), 'dentro'); assert.equal(R.clasificarApuntamiento(0.8, 1.474), 'fuera');
});

prueba('Modelo gaussiano: 12,04·(e/θ3)² por trayecto → 1,886 dB (no 1,81: la cifra publicada es la de Airy)', () => {
  const ess = 0.05 / S.PEDESTAL.Km * 180 / Math.PI;
  const g = R.perdidaApuntamiento(ess, { modelo: 'gauss', a: 2, f: 3e9 });
  cerca(g.idaVuelta, A.gauss_nominal_idaVuelta_dB, 1e-6, 'gauss');
  publicado(g.idaVuelta, 1.89, 2);
  // en θ3dB/2 los dos modelos dan exactamente 3,01 dB por trayecto (los dos pasan por la potencia mitad)
  const th3 = R.haz({ a: 2, f: 3e9 }).hpbw;
  cerca(R.perdidaApuntamiento(th3 / 2, { modelo: 'gauss', hpbwDeg: th3 }).ida, 10 * Math.log10(2), 1e-12, 'gauss θ3/2');
  cerca(R.perdidaApuntamiento(th3 / 2, { a: 2, f: 3e9 }).ida, 10 * Math.log10(2), 1e-6, 'airy θ3/2');
});

console.log('\nservo-radar.js — radar y enlace');
const RR = REF.radar;

prueba('V8 radar: G 40,11 dBi; Aef 8,168 m²; R_max 177,84 km (96,0 NM); horizonte 248,59 / 248,23 km', () => {
  const g = R.ganancia(4, 0.65, 3e9);
  cerca(g.G, RR.G, 1e-9, 'G'); cerca(g.Aef, RR.Aef, 1e-12, 'Aef');
  publicado(g.GdBi, 40.11, 2); publicado(g.Aef, 8.168, 3); publicado(g.lambda, 0.1, 12);
  const Rm = R.alcanceRadar({ Pt: 50e3, G: g.G, f: 3e9, sigma: 15, PminDbm: -100, LdB: 6 });
  cerca(Rm, RR.Rmax_m, 1e-6, 'R_max'); publicado(Rm / 1e3, 177.84, 2); publicado(Rm / 1852, 96.0, 1);
  cerca(R.potenciaRadar(Rm, { Pt: 50e3, G: g.G, f: 3e9, sigma: 15, LdB: 6 }), 1e-13, 1e-22, 'Pr(R_max) = Pmin');
  const h = R.horizonte(30, 3000);
  cerca(h.nm, RR.horizonte_km_NM, 1e-9); cerca(h.metrica, RR.horizonte_km_412, 1e-9);
  publicado(h.nm, 248.59, 2); publicado(h.metrica, 248.23, 2);
  publicado(Math.pow(h.nm * 1e3 / Rm, 4), 3.82, 2, 'factor Pt·σ para llegar al horizonte');
});

prueba('V13 alcance efectivo: 160,25 km (nominal, 1,81 dB) y 114,3 km (blanco ×2, 7,67 dB)', () => {
  const g = R.ganancia(4, 0.65, 3e9);
  const Rm = R.alcanceRadar({ Pt: 50e3, G: g.G, f: 3e9, sigma: 15, Pmin: 1e-13, LdB: 6 });
  const ess = 0.05 / S.PEDESTAL.Km * 180 / Math.PI;
  const r1 = R.alcanceEfectivo(Rm, R.perdidaApuntamiento(ess, { a: 2, f: 3e9 }).idaVuelta) / 1e3;
  const r2 = R.alcanceEfectivo(Rm, R.perdidaApuntamiento(2 * ess, { a: 2, f: 3e9 }).idaVuelta) / 1e3;
  cerca(r1, RR.Ref_nominal_km, 1e-4, 'R_ef nominal'); cerca(r2, RR.Ref_x2_km, 1e-4, 'R_ef ×2');
  // La propuesta publica «160,2 km»: el valor exacto es 160,2507 km (redondea a 160,3). «160,2» sale de usar
  // R_max redondeado a 177,8 km (177,8·10^(−1,809/40) = 160,22). Se comprueba el valor exacto a 0,01 km.
  publicado(r1, 160.25, 2); publicado(177.8 * Math.pow(10, -R.perdidaApuntamiento(ess, { a: 2, f: 3e9 }).idaVuelta / 40), 160.2, 1);
  publicado(r2, 114.3, 1);
});

prueba('Friis: FSPL y Pr frente a Python; Pr cae 6,02 dB al doblar la distancia', () => {
  const fe = RR.friis_ej;
  const g = R.ganancia(4, 0.65, fe.f);
  cerca(g.GdBi, fe.Gr_dBi, 1e-9, 'Gr');
  const L = R.friis({ Pt: fe.Pt_W, GtDbi: fe.Gt_dBi, GrDbi: g.GdBi, f: fe.f, d: fe.d_m });
  cerca(L.fspl, fe.FSPL_dB, 1e-9, 'FSPL'); cerca(L.PrDbm, fe.Pr_dBm, 1e-9, 'Pr');
  const L2 = R.friis({ Pt: fe.Pt_W, GtDbi: fe.Gt_dBi, GrDbi: g.GdBi, f: fe.f, d: 2 * fe.d_m });
  cerca(L.PrDbm - L2.PrDbm, 20 * Math.log10(2), 1e-12, '6,02 dB');
  const L3 = R.friis({ Pt: fe.Pt_W, GtDbi: fe.Gt_dBi, GrDbi: g.GdBi, f: fe.f, d: fe.d_m, perdidasDb: 0.9, Tsys: 290, B: 1e6, sensibilidadDbm: -110 });
  cerca(L3.PrDbm, fe.Pr_dBm - 0.9, 1e-9, 'pérdida de apuntamiento'); cerca(L3.cn0, L3.PrDbw - 10 * Math.log10(1.380649e-23 * 290), 1e-6, 'C/N0');
  cerca(L3.snr, L3.cn0 - 60, 1e-12, 'SNR'); cerca(L3.margen, L3.PrDbm + 110, 1e-12, 'margen');
});

console.log('\nservo-radar.js — pasada orbital (desarrollo propio: casos analíticos)');

prueba('Periodo 2π√(a³/μ): 400 km → 92,56 min; el estado vuelve a sí mismo tras un periodo (e = 0 y e = 0,1)', () => {
  const a = R.RE + 400e3;
  cerca(R.periodo(a), 2 * Math.PI * Math.sqrt(a ** 3 / R.MU), 1e-9);
  publicado(R.periodo(a) / 60, 92.56, 2);
  for (const e of [0, 0.1]) {
    const el = { a, e, i: 0.9, raan: 0.3, argp: 1.1, M0: 0.4 };
    const s0 = R.estadoECI(el, 0), s1 = R.estadoECI(el, R.periodo(a));
    for (let j = 0; j < 3; j++) { cerca(s1.r[j], s0.r[j], 1e-4, 'r'); cerca(s1.v[j], s0.v[j], 1e-7, 'v'); }
    // vis-viva y momento angular constantes
    const E = (s) => (s.v[0] ** 2 + s.v[1] ** 2 + s.v[2] ** 2) / 2 - R.MU / Math.hypot(...s.r);
    const s2 = R.estadoECI(el, 1234.5);
    cerca(E(s2), -R.MU / (2 * a), 1e-6 * R.MU / a, 'energía');
  }
});

prueba('Pasada cenital, Tierra fija: rango mínimo = altitud; ω máx. = v/h en el cenit; pasada simétrica', () => {
  const h = 500e3;
  const el = R.elementosCirculares({ h, iDeg: 90, raanDeg: 0, u0Deg: 0 }); // en t = 0 sobre (lat 0, lon 0)
  const est = R.estacion({ latDeg: 0, lonDeg: 0, h: 0 });
  const p = R.pasada({ elem: el, estacion: est, t0: -600, t1: 600, dt: 1, elMin: 0, rotacion: false });
  const k0 = 600;
  cerca(p.rango[k0], h, 1e-6, 'rango en el cenit'); cerca(Math.min(...p.rango), h, 1e-6, 'rango mínimo');
  cerca(p.el[k0], 90, 1e-9, 'el cenit'); cerca(p.tca, 0, 1e-4, 'TCA'); cerca(p.elMax, 90, 1e-6, 'elMax');
  const wz = Math.sqrt(R.MU / (R.RE + h)) / h * 180 / Math.PI;
  cerca(p.omega[k0], wz, 1e-9 * wz, 'ω cenit'); cerca(p.omegaMax, wz, 1e-9 * wz, 'ω máx = ω cenit');
  for (let k = 1; k <= 600; k += 7) {
    cerca(p.el[k0 + k], p.el[k0 - k], 1e-8, 'el simétrica'); cerca(p.rango[k0 + k], p.rango[k0 - k], 1e-5, 'rango simétrico');
    cerca(p.omega[k0 + k], p.omega[k0 - k], 1e-10, 'ω simétrica');
    cerca(p.rangoRate[k0 + k], -p.rangoRate[k0 - k], 1e-6, 'ρ̇ antisimétrica');
  }
  cerca(p.aos, -p.los, 1e-5, 'AOS/LOS simétricos');
  // AOS analítico: ángulo central λ0 = arccos(RE/(RE+h)) a elevación 0 → t = λ0/n
  const n = 2 * Math.PI / R.periodo(R.RE + h);
  cerca(p.los, Math.acos(R.RE / (R.RE + h)) / n, 1e-5, 'LOS analítico');
});

prueba('Pasada cenital, Tierra en rotación (órbita ecuatorial): ω cenit = (√(μ/a) − ωE·a)/h', () => {
  const h = 550e3, a = R.RE + h;
  const el = R.elementosCirculares({ h, iDeg: 0, u0Deg: 0 });
  const est = R.estacion({ latDeg: 0, lonDeg: 0, h: 0 });
  const p = R.pasada({ elem: el, estacion: est, t0: -500, t1: 500, dt: 0.5, elMin: 0, theta0: 0 });
  const k0 = 1000;
  const wz = (Math.sqrt(R.MU / a) - R.WE * a) / h * 180 / Math.PI;
  cerca(p.omega[k0], wz, 1e-9 * wz, 'ω cenit'); cerca(p.omegaMax, wz, 1e-9 * wz, 'ω máx');
  cerca(p.rango[k0], h, 1e-6, 'rango mínimo');
  for (let k = 1; k <= 1000; k += 13) cerca(p.el[k0 + k], p.el[k0 - k], 1e-8, 'simetría');
  // relación de periodos: con rotación la pasada dura más (n_rel = n − ωE)
  const n = 2 * Math.PI / R.periodo(a);
  cerca(p.los, Math.acos(R.RE / a) / (n - R.WE), 1e-5, 'LOS con rotación');
});

prueba('Pasada no cenital, Tierra fija (i = 60°, estación desplazada): simétrica respecto al TCA', () => {
  const el = R.elementosCirculares({ h: 700e3, iDeg: 60, raanDeg: 0, u0Deg: 0 });
  const est = R.estacion({ latDeg: 0, lonDeg: 5, h: 0 });
  const p = R.pasada({ elem: el, estacion: est, t0: -900, t1: 900, dt: 2, elMin: 5, rotacion: false });
  assert.ok(p.elMax > 5 && p.elMax < 90, 'elMax');
  const ob = (t) => R.observar(el, est, t, { rotacion: false });
  for (const tau of [30, 120, 300]) {
    cerca(ob(p.tca + tau).el, ob(p.tca - tau).el, 1e-6, 'el(TCA±τ)');
    cerca(ob(p.tca + tau).rango, ob(p.tca - tau).rango, 1e-3, 'rango(TCA±τ)');
  }
  cerca(p.aos + p.los, 2 * p.tca, 1e-4, 'AOS/LOS simétricos');
  // velocidad angular = √(azRate²·cos²el + elRate²)
  const o = ob(p.tca + 77);
  const wComp = Math.hypot(o.azRate * Math.cos(o.el * Math.PI / 180), o.elRate);
  cerca(o.omega, wComp, 1e-9 * o.omega, 'ω por componentes');
});

prueba('Contraste con la implementación independiente en Python (elíptica e = 0,02, i = 51,6°, con rotación)', () => {
  const O = REF.orbita;
  assert.equal(R.MU, O.MU); assert.equal(R.RE, O.RE); assert.equal(R.WE, O.WE);
  for (const m of O.muestras) {
    const o = R.observar(O.elem, O.estacion, m.t);
    const daz = ((o.az - m.az + 540) % 360) - 180;
    cerca(daz, 0, 1e-8, 'az t=' + m.t); cerca(o.el, m.el, 1e-8, 'el t=' + m.t);
    cerca(o.rango, m.rango, 1e-5, 'rango t=' + m.t); cerca(o.rangoRate, m.rangoRate, 1e-7, 'ρ̇ t=' + m.t);
    cerca(o.omega, m.omega_degs, 1e-11, 'ω t=' + m.t);
  }
  assert.ok(O.muestras.some((m) => m.el > 10), 'hay muestras dentro de una pasada visible');
});

prueba('Derivadas az/el analíticas frente a diferencias finitas', () => {
  const O = REF.orbita, t = O.muestras[O.muestras.length - 2].t, d = 1e-3;
  const a = R.observar(O.elem, O.estacion, t - d), b = R.observar(O.elem, O.estacion, t + d), o = R.observar(O.elem, O.estacion, t);
  cerca(o.elRate, (b.el - a.el) / (2 * d), 1e-6, 'elRate'); cerca(o.azRate, (b.az - a.az) / (2 * d), 1e-6, 'azRate');
  cerca(o.rangoRate, (b.rango - a.rango) / (2 * d), 1e-3, 'rangoRate');
});

console.log(`\n${ok} pruebas correctas, ${fallos} fallidas`);
process.exitCode = fallos ? 1 : 0;
