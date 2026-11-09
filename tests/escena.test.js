/* Pruebas de la geometría de la escena animada de los pasos 1–3 (servo-escena.js).
 *
 *   node tests/escena.test.js
 *
 * Sin dependencias (node:assert). La escena no añade física: estas pruebas comprueban que la proyección polar, la
 * vista lateral, el cono del haz y el estado de cada instante reproducen EXACTAMENTE los números de servo-view.js
 * (la desviación del haz sim.ep, el semáforo y la pérdida de ida). La pasada y el servo se construyen aquí con los
 * mismos motores (servo-radar.js, servo-sim.js) y el mismo procedimiento que servo-view.js (construirPasada y
 * simularServo, copiados en su forma mínima).
 */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');

const E = require(path.join(__dirname, '..', 'servo-escena.js'));
const R = require(path.join(__dirname, '..', 'servo-radar.js'));
const S = require(path.join(__dirname, '..', 'servo-sim.js'));
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

let ok = 0, fallos = 0;
function prueba(nombre, fn) {
  try { fn(); ok++; console.log('  ok   ' + nombre); }
  catch (err) { fallos++; console.log('  FALLO ' + nombre + '\n        ' + String(err.message).split('\n').join('\n        ')); }
}
function cerca(x, ref, tol, que) {
  assert.ok(Math.abs(x - ref) <= tol, `${que || ''}: ${x} frente a ${ref} (tol ${tol})`);
}

// ------------------------------------------------------------------ pasada y servo como en servo-view.js
const EST = { latDeg: 39.470, lonDeg: -0.376 }, INC = 97.6, EL_MIN = 5;
function elementos(hKm, dLonDeg) {
  const i = INC * D2R, phi = EST.latDeg * D2R;
  const u = Math.asin(Math.sin(phi) / Math.sin(i));
  const alfa = Math.atan2(Math.cos(i) * Math.sin(u), Math.cos(u));
  const raan = (EST.lonDeg + dLonDeg) * D2R - alfa;
  return R.elementosCirculares({ h: hKm * 1e3, iDeg: INC, raanDeg: raan * R2D, u0Deg: u * R2D });
}
function construirPasada(hKm, elMaxDeg) {
  const est = R.estacion({ latDeg: EST.latDeg, lonDeg: EST.lonDeg, h: 0 });
  const medio = 1100;
  const elMaxDe = dl => R.pasada({ elem: elementos(hKm, dl), estacion: est, t0: -medio, t1: medio, dt: 5, elMin: EL_MIN }).elMax;
  const lam0 = Math.acos(R.RE / (R.RE + hKm * 1e3)) * R2D;
  let lo = 0, hi = 1.5 * lam0 / Math.cos(EST.latDeg * D2R);
  for (let it = 0; it < 32; it++) { const mid = 0.5 * (lo + hi); if (elMaxDe(mid) > elMaxDeg) lo = mid; else hi = mid; }
  const elem = elementos(hKm, 0.5 * (lo + hi));
  const p = R.pasada({ elem, estacion: est, t0: -medio, t1: medio, dt: 1, elMin: EL_MIN });
  const dur = p.los - p.aos, n = Math.max(2, Math.ceil(dur)), dtg = dur / n;
  const g = { tau: [], az: [], el: [], azRate: [], elRate: [], rango: [], omega: [], dtg, dur };
  let prev = null;
  for (let j = 0; j <= n; j++) {
    const o = R.observar(elem, est, p.aos + j * dtg);
    let az = o.az;
    if (prev != null) { while (az - prev > 180) az -= 360; while (az - prev < -180) az += 360; }
    prev = az;
    g.tau.push(j * dtg); g.az.push(az); g.el.push(o.el); g.azRate.push(o.azRate); g.elRate.push(o.elRate); g.rango.push(o.rango); g.omega.push(o.omega);
  }
  return { g, dur, elMax: p.elMax, tca: p.tca - p.aos };
}
/** Servo del paso 2 con la referencia «Pasada» (pedestal, regulador P o PI): mismo cálculo de ep que servo-view.js. */
function servoPasada(pas, eje, T, KI) {
  const planta = S.plantaPedestal(T), g = pas.g, base = g[eje][0];
  const N = Math.floor(pas.dur / T) + 1;
  const s = S.simular({ planta, T, KP: S.PEDESTAL.Km, KI: KI || 0, KD: 0, ref: k => (E.hermite(g, eje, k * T) - base) * D2R, N });
  const ep = new Float64Array(s.N);
  let k0 = 0, eEje = 0;
  for (let k = 0; k < s.N; k++) {
    const ee = Math.abs(s.e[k]);
    ep[k] = eje === 'az' ? 2 * Math.asin(Math.min(1, Math.cos(E.hermite(g, 'el', Math.min(k * T, pas.dur)) * D2R) * Math.sin(ee / 2))) : ee;
    if (ep[k] > ep[k0]) k0 = k;
    eEje = Math.max(eEje, ee);
  }
  return { s, T, ep, eMax: ep[k0], tEmax: k0 * T, eEjeMax: eEje, errDeg: ep[k0] * R2D, diverge: s.divergeEn != null };
}
const ANT = { a: 2, f: 3e9 }, HZ = R.haz(ANT);
const perdida = e => (!(e < HZ.thetaNulo) ? { ida: Infinity } : R.perdidaApuntamiento(e, ANT));
const PAS45 = construirPasada(550, 45), PAS85 = construirPasada(550, 85);

console.log('\nservo-escena.js — geometría de la escena animada (pasos 1–3)');

prueba('Cielo polar: el cenit (el = 90°) cae en el centro, con cualquier acimut', () => {
  for (const az of [0, 37, 180, 300]) { const p = E.polar(az, 90, 100, 120, 80); cerca(p.x, 100, 1e-12, 'x'); cerca(p.y, 120, 1e-12, 'y'); }
});

prueba('Cielo polar: elevación 0 en el borde; norte arriba, este a la derecha, sur abajo, oeste a la izquierda', () => {
  const c = [100, 120, 80];
  let p = E.polar(0, 0, ...c); cerca(p.x, 100, 1e-12); cerca(p.y, 40, 1e-12); cerca(p.r, 80, 1e-12, 'r');
  p = E.polar(90, 0, ...c); cerca(p.x, 180, 1e-12); cerca(p.y, 120, 1e-12);
  p = E.polar(180, 0, ...c); cerca(p.x, 100, 1e-12); cerca(p.y, 200, 1e-12);
  p = E.polar(270, 0, ...c); cerca(p.x, 20, 1e-12); cerca(p.y, 120, 1e-12);
});

prueba('Cielo polar equidistante: r = R·(90 − el)/90 (45° a medio radio); por debajo de 0° se queda en el borde', () => {
  cerca(E.polar(123, 45, 0, 0, 80).r, 40, 1e-12, 'el 45');
  cerca(E.polar(10, 60, 0, 0, 90).r, 30, 1e-12, 'el 60');
  cerca(E.polar(10, -3, 0, 0, 90).r, 90, 1e-12, 'el −3');
});

prueba('Interpolación de Hermite de la escena = valores de la rejilla de la pasada en los nodos', () => {
  const g = PAS45.g;
  for (const j of [0, 1, 50, 200, g.tau.length - 1]) {
    cerca(E.hermite(g, 'az', g.tau[j]), g.az[j], 1e-9, `az[${j}]`);
    cerca(E.hermite(g, 'el', g.tau[j]), g.el[j], 1e-9, `el[${j}]`);
    cerca(E.lineal(g, 'rango', g.tau[j]), g.rango[j], 1e-6, `rango[${j}]`);
  }
});

prueba('Desviación angular entre direcciones con la misma elevación = 2·asin(cos el·sin(Δaz/2)) (fórmula del paso 2)', () => {
  for (const el of [0, 20, 45, 80, 89]) for (const daz of [0.01, 0.4125, 3, 25]) {
    const ref = 2 * Math.asin(Math.cos(el * D2R) * Math.sin(daz * D2R / 2)) * R2D;
    cerca(E.desviacionHaz(100, el, 100 + daz, el), ref, 1e-10, `el ${el}, Δaz ${daz}`);
  }
});

prueba('Desviación angular con el mismo acimut = |Δel|; entre el cenit y el horizonte, 90°', () => {
  cerca(E.desviacionHaz(30, 40, 30, 40.825), 0.825, 1e-10, 'Δel');
  cerca(E.desviacionHaz(30, 90, 250, 0), 90, 1e-10, 'cenit-horizonte');
});

prueba('Vista lateral: cenit en la vertical de la estación; un punto en el horizonte, sobre el eje x', () => {
  const dir = { e: 0, n: 1 };
  let p = E.lateral(0, 90, 550e3, dir); cerca(p.x, 0, 1e-6, 'x cenit'); cerca(p.y, 550e3, 1e-6, 'y cenit');
  p = E.lateral(0, 0, 2000e3, dir); cerca(p.x, 2000e3, 1e-6, 'x horizonte'); cerca(p.y, 0, 1e-6, 'y horizonte');
  cerca(E.suelo(0), 0, 1e-9, 'suelo en la estación');
});

prueba('Vista lateral a escala real: un satélite en el plano de la traza está a RE + h del centro de la Tierra', () => {
  const h = 550e3, RE = E.RE, dir = { e: Math.sin(30 * D2R), n: Math.cos(30 * D2R) };
  for (const el of [5, 20, 45, 85]) {
    const rho = Math.sqrt((RE + h) ** 2 - (RE * Math.cos(el * D2R)) ** 2) - RE * Math.sin(el * D2R);
    const p = E.lateral(30, el, rho, dir);
    cerca(Math.hypot(p.x, p.y + RE), RE + h, 1e-3, `el ${el}°`);
  }
});

prueba('Vista lateral de una pasada real: la traza va del AOS (x < 0) al LOS (x > 0) y nunca baja del horizonte', () => {
  const g = PAS45.g, dir = E.direccionTraza(g), n = g.tau.length - 1;
  const p0 = E.lateral(g.az[0], g.el[0], g.rango[0], dir), p1 = E.lateral(g.az[n], g.el[n], g.rango[n], dir);
  assert.ok(p0.x < 0 && p1.x > 0, `x AOS ${p0.x}, x LOS ${p1.x}`);
  for (let j = 0; j <= n; j += 10) assert.ok(E.lateral(g.az[j], g.el[j], g.rango[j], dir).y > 0, `y en j = ${j}`);
});

prueba('Ampliación del dibujo (serie 1-2-5): mayor N con error·N ≤ objetivo; 1 si el error ya se ve', () => {
  assert.equal(E.factorAmpliacion(0.102, 30), 200);
  assert.equal(E.factorAmpliacion(1.315, 30), 20);
  assert.equal(E.factorAmpliacion(5, 30), 5);
  assert.equal(E.factorAmpliacion(40, 30), 1);
  assert.equal(E.factorAmpliacion(0, 30), 1);
  assert.equal(E.factorAmpliacion(Infinity, 30), 1);
  cerca(E.semiConoDibujo(1.474, 20), 14.74, 1e-12, 'semicono ×20');
});

prueba('Cono a −3 dB (4 m a 3 GHz): e_ss = 0,4125° dentro, el blanco al doble (0,825°) fuera, igual que el semáforo', () => {
  assert.equal(E.dentroDelCono(0.4125, HZ.hpbw), true);
  assert.equal(E.dentroDelCono(0.825, HZ.hpbw), false);
  for (let e = 0; e <= 1.2; e += 0.01) assert.equal(E.dentroDelCono(e, HZ.hpbw), R.clasificarApuntamiento(e, HZ.hpbw) !== 'fuera', `e = ${e}`);
});

prueba('Instantes clave AOS, 25 %, TCA, 75 %, LOS en orden; «Simular» sin animación los recorre y vuelve al AOS', () => {
  const k = E.instantesClave(PAS45.dur, PAS45.tca);
  assert.deepEqual(k.map(x => x.nombre), ['AOS', '25 %', 'TCA', '75 %', 'LOS']);
  cerca(k[2].frac, PAS45.tca / PAS45.dur, 1e-12, 'TCA');
  let f = 0; const vistos = [];
  for (let i = 0; i < 5; i++) { const j = E.siguienteInstante(f, k); vistos.push(k[j].nombre); f = k[j].frac; }
  assert.deepEqual(vistos, ['25 %', 'TCA', '75 %', 'LOS', 'AOS']);
});

prueba('Velocidad por defecto: la pasada de 45° (≈ 566 s) se ve en unos 12 s a 64×; una de 120 s, a 16×', () => {
  assert.equal(E.velocidadPorDefecto(PAS45.dur, 12), 64);
  assert.equal(E.velocidadPorDefecto(120, 12), 16);
  assert.equal(E.velocidadPorDefecto(48, 12), 4);
  assert.equal(E.velocidadPorDefecto(10, 12), 1);
});

prueba('Pasada de 45° siguiendo el acimut: la desviación de cada instante es la sim.ep del paso 2, muestra a muestra', () => {
  const sim = servoPasada(PAS45, 'az', 0.01);
  const d = { pas: PAS45, sim, hz: HZ, ref: 'pasada', eje: 'az', perdida, clasificar: R.clasificarApuntamiento };
  for (let k = 0; k < sim.s.N; k += 997) {
    const o = E.estadoInstante(d, k * sim.T);
    assert.equal(o.modo, 'pasada');
    cerca(o.desv, sim.ep[k] * R2D, 1e-12, `desviación k = ${k}`);
    cerca(o.errEje, sim.s.e[k] * R2D, 1e-12, `error del eje k = ${k}`);
    // los ángulos dibujados de antena y satélite dan la misma desviación (geometría esférica)
    cerca(E.desviacionHaz(o.az, o.el, o.azAnt, o.elAnt), o.desv, 1e-9, `geometría k = ${k}`);
    cerca(o.elAnt, o.el, 0, 'el otro eje se supone perfecto');
  }
});

prueba('Pasada casi cenital con PI: error del eje y desviación del haz iguales a los del servo también cerca del cenit', () => {
  const sim = servoPasada(PAS85, 'az', 0.005, 5);
  const d = { pas: PAS85, sim, hz: HZ, ref: 'pasada', eje: 'az', perdida, clasificar: R.clasificarApuntamiento };
  const kT = Math.round(PAS85.tca / sim.T);
  for (const k of [kT - 400, kT, kT + 400]) {
    const o = E.estadoInstante(d, k * sim.T);
    cerca(o.desv, sim.ep[k] * R2D, 1e-12, `k = ${k}`);
    cerca(E.desviacionHaz(o.az, o.el, o.azAnt, o.elAnt), o.desv, 1e-9, `geometría k = ${k}`);
  }
});

prueba('Pasada siguiendo la elevación: la antena solo se separa en elevación y la desviación es |e|', () => {
  const sim = servoPasada(PAS45, 'el', 0.01);
  const d = { pas: PAS45, sim, hz: HZ, ref: 'pasada', eje: 'el', perdida, clasificar: R.clasificarApuntamiento };
  const k = Math.round(0.3 * PAS45.dur / sim.T), o = E.estadoInstante(d, k * sim.T);
  cerca(o.azAnt, o.az, 1e-12, 'acimut');
  cerca(o.el - o.elAnt, sim.s.e[k] * R2D, 1e-12, 'Δel');
  cerca(o.desv, Math.abs(sim.s.e[k]) * R2D, 1e-12, 'desviación');
});

prueba('Satélite dentro del cono cuando la desviación < θ3dB/2; semáforo y pérdida de cada instante = los del paso 3', () => {
  const sim = servoPasada(PAS45, 'az', 0.01);
  const d = { pas: PAS45, sim, hz: HZ, ref: 'pasada', eje: 'az', perdida, clasificar: R.clasificarApuntamiento };
  for (let f = 0; f <= 1; f += 0.05) {
    const o = E.estadoInstante(d, f * PAS45.dur);
    assert.equal(E.dentroDelCono(o.desv, HZ.hpbw), o.desv < HZ.hpbw / 2);
    assert.equal(o.clase, R.clasificarApuntamiento(o.desv, HZ.hpbw));
    cerca(o.perdIda, R.perdidaApuntamiento(o.desv, ANT).ida, 1e-12, `pérdida en f = ${f.toFixed(2)}`);
  }
  // en el instante del máximo, la pérdida es la del paso 3 (L.ida con el máximo de la pasada)
  const oMax = E.estadoInstante(d, sim.tEmax);
  cerca(oMax.desv, sim.errDeg, 1e-12, 'desviación máxima');
  cerca(oMax.perdIda, R.perdidaApuntamiento(sim.errDeg, ANT).ida, 1e-12, 'pérdida máxima = L.ida');
});

prueba('Rampa del blanco al doble (0,10 rad/s): error estacionario constante, fuera del semihaz, pérdida = L.ida del paso 3', () => {
  const T = 0.001, s = S.simular({ planta: S.plantaPedestal(T), T, KP: S.PEDESTAL.Km, ref: S.rampa(10001, T, 0.10) });
  const errDeg = Math.abs(s.e[s.N - 1]) * R2D, L = R.perdidaApuntamiento(errDeg, ANT);
  const d = { pas: PAS45, sim: { s, T, errDeg, diverge: false }, hz: HZ, ref: 'rampa', eje: 'az', perdida, clasificar: R.clasificarApuntamiento };
  for (const f of [0, 0.4, 1]) {
    const o = E.estadoInstante(d, f * PAS45.dur);
    assert.equal(o.modo, 'rampa');
    cerca(o.desv, errDeg, 0, 'desviación'); cerca(o.perdIda, L.ida, 1e-12, 'pérdida');
    assert.equal(o.clase, 'fuera'); assert.equal(E.dentroDelCono(o.desv, HZ.hpbw), false);
  }
  cerca(errDeg, 0.825, 5e-4, 'e_ss publicado');
});

prueba('Sin error definido (escalón), lazo inestable o sin pasada: la escena lo indica sin inventar números', () => {
  const s = S.simular({ planta: S.plantaPedestal(0.01), T: 0.01, KP: S.PEDESTAL.Km, ref: S.escalon(400, 1) });
  let o = E.estadoInstante({ pas: PAS45, sim: { s, T: 0.01, errDeg: null }, hz: HZ, ref: 'escalon', perdida, clasificar: R.clasificarApuntamiento }, 100);
  assert.equal(o.modo, 'na'); assert.equal(o.desv, null); assert.equal(o.perdIda, null); assert.equal(o.clase, 'na');
  cerca(o.azAnt, o.az, 0, 'antena sobre la línea de vista');
  o = E.estadoInstante({ pas: PAS45, sim: { s, T: 0.01, diverge: true, errDeg: Infinity }, hz: HZ, ref: 'pasada', eje: 'az', perdida, clasificar: R.clasificarApuntamiento }, 100);
  assert.equal(o.modo, 'inestable'); assert.equal(o.perdIda, Infinity);
  assert.equal(E.estadoInstante({ pas: null }, 10).modo, 'sinpasada');
});

prueba('Índice del servo k = round(t/T), acotado a la simulación; el tiempo se acota a la duración de la pasada', () => {
  const sim = { s: { N: 101 }, T: 0.01 };
  assert.equal(E.indiceServo(sim, 0.004), 0); assert.equal(E.indiceServo(sim, 0.006), 1);
  assert.equal(E.indiceServo(sim, 5), 100); assert.equal(E.indiceServo(sim, -1), 0);
  const o = E.estadoInstante({ pas: PAS45 }, PAS45.dur + 50);
  cerca(o.t, PAS45.dur, 0, 't acotado'); cerca(o.frac, 1, 0, 'fracción');
});

console.log(`\n${ok} pruebas correctas, ${fallos} fallidas`);
process.exitCode = fallos ? 1 : 0;
