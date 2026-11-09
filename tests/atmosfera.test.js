/* Pruebas de la atenuación atmosférica y del barrido en frecuencia del radar (servo-radar.js) frente a Python.
 *
 *   node tests/atmosfera.test.js
 *
 * Sin dependencias (node:assert). Las referencias están en tests/atmosfera-referencias.json, generado con un script
 * de Python local (exporta_referencias_digital_atmosfera.py: misma tabla P.676 y mismos coeficientes P.838-3,
 * interpolados con numpy; diagrama de Airy con scipy.special.j1) que no forma parte del repositorio.
 * Tolerancias: atenuaciones ≤ 1e-12 dB (mismo modelo, misma aritmética); alcances con error relativo ≤ 1e-5 (el JS usa
 * la aproximación de J1 de Abramowitz–Stegun, |ε| < 1e-7).
 */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const R = require(path.join(__dirname, '..', 'servo-radar.js'));
const REF = JSON.parse(fs.readFileSync(path.join(__dirname, 'atmosfera-referencias.json'), 'utf8'));
const RADAR = { Pt: 50e3, sigma: 15, Pmin: 1e-13, LdB: 6 };   // constantes de servo-view.js
const ETA = 0.65;

let ok = 0, fallos = 0;
function prueba(nombre, fn) {
  try { fn(); ok++; console.log('  ok   ' + nombre); }
  catch (err) { fallos++; console.log('  FALLO ' + nombre + '\n        ' + String(err.message).split('\n').join('\n        ')); }
}
function cerca(x, ref, tol, que) {
  assert.ok(Math.abs(x - ref) <= tol, `${que || ''}: ${x} frente a ${ref} (tol ${tol})`);
}
function publicado(x, cifra, dec, que) {
  const tol = 0.5 * Math.pow(10, -dec) * (1 + 1e-9);
  assert.ok(Math.abs(x - cifra) <= tol, `${que || ''}: ${x} no redondea a ${cifra} con ${dec} decimales`);
}

console.log('\nservo-radar.js — atmósfera (gases P.676 + lluvia P.838, desarrollo propio)');

prueba('Gases: atenuación cenital de la tabla y ley de la cosecante con tope en 5° (= Python)', () => {
  for (const g of REF.gas) cerca(R.atenuacionAtmosferica({ fGHz: g.f, elDeg: g.el }).gases, g.gases, 1e-12, `${g.f} GHz, ${g.el}°`);
  const z = R.atenuacionAtmosferica({ fGHz: 3, elDeg: 90 }).gases;
  for (const el of [60, 30, 10, 5]) cerca(R.atenuacionAtmosferica({ fGHz: 3, elDeg: el }).gases, z / Math.sin(el * Math.PI / 180), 1e-12, `cosec ${el}°`);
  assert.equal(R.atenuacionAtmosferica({ fGHz: 3, elDeg: 1 }).gases, R.atenuacionAtmosferica({ fGHz: 3, elDeg: 5 }).gases, 'tope en 5°');
  cerca(R.atenuacionAtmosferica({ fGHz: 1, elDeg: 90 }).gases, 0.035, 1e-15, '1 GHz cenit');
  cerca(R.atenuacionAtmosferica({ fGHz: 12, elDeg: 90 }).gases, 0.110, 1e-15, '12 GHz cenit');
});

prueba('Gases hasta 30 GHz: crecen con f en 1–12 GHz, máximo local en la raya del vapor de agua (22,2 GHz)', () => {
  let prev = 0;
  for (let f = 1; f <= 12; f += 0.25) { const a = R.atenuacionAtmosferica({ fGHz: f }).gases; assert.ok(a >= prev, `${f} GHz`); prev = a; }
  const g = (f) => R.atenuacionAtmosferica({ fGHz: f }).gases;
  assert.ok(g(22.2) > g(20) && g(22.2) > g(25), 'pico de 22,2 GHz');
  assert.ok(isFinite(g(40)) && g(40) === g(30) && g(0.5) === g(1), 'fuera de la tabla: valor del extremo');
});

prueba('Lluvia P.838 (circular): k, α y atenuación a 45° iguales a Python; sin lluvia, 0', () => {
  for (const l of REF.lluvia) {
    const c = R.coeficientesLluvia(l.f), a = R.atenuacionAtmosferica({ fGHz: l.f, elDeg: l.el, lluvia: l.R });
    cerca(c.k, l.k, 1e-15, `k ${l.f}`); cerca(c.alfa, l.alfa, 1e-12, `α ${l.f}`); cerca(a.lluvia, l.lluvia, 1e-12, `${l.f} GHz ${l.R} mm/h`);
  }
  assert.equal(R.atenuacionAtmosferica({ fGHz: 12, elDeg: 30, lluvia: 0 }).lluvia, 0);
  // tabla en los nodos: polarización circular = media de H y V
  const c10 = R.coeficientesLluvia(10); cerca(c10.k, (0.01217 + 0.01129) / 2, 1e-15, 'k(10 GHz)');
  publicado(R.atenuacionAtmosferica({ fGHz: 12, elDeg: 45, lluvia: 25 }).lluvia, 3.72, 2, '12 GHz, 25 mm/h');
});

prueba('Lluvia monótona: crece con la tasa (0–50 mm/h) y con la frecuencia (1–12 GHz) a 5°, 20°, 45° y 90°', () => {
  for (const el of [5, 20, 45, 90]) {
    for (let f = 1; f <= 12; f += 0.5) {
      let prev = -1;
      for (let r = 0; r <= 50; r += 2.5) { const a = R.atenuacionAtmosferica({ fGHz: f, elDeg: el, lluvia: r }).lluvia; assert.ok(a > prev || (r === 0 && a === 0), `R ${r} a ${f} GHz, ${el}°`); prev = a; }
    }
    for (const r of [5, 25, 50]) {
      let prev = -1;
      for (let f = 1; f <= 12; f += 0.1) { const a = R.atenuacionAtmosferica({ fGHz: f, elDeg: el, lluvia: r }).lluvia; assert.ok(a > prev, `f ${f.toFixed(1)} con ${r} mm/h, ${el}°`); prev = a; }
    }
  }
  // más trayecto a baja elevación
  assert.ok(R.atenuacionAtmosferica({ fGHz: 10, elDeg: 10, lluvia: 25 }).lluvia > R.atenuacionAtmosferica({ fGHz: 10, elDeg: 45, lluvia: 25 }).lluvia);
});

console.log('\nAlcance del radar frente a la frecuencia (antena de 4 m, error de 0,4125°)');

const base = { D: 4, eta: ETA, errDeg: 0.4125, radar: RADAR };

prueba('Sin atmósfera, el barrido reproduce los resultados anteriores: 177,84 km y 160,25 km a 3 GHz', () => {
  const b = R.barridoFrecuencia(Object.assign({ fGHz: [3] }, base));
  publicado(b.Rmax[0] / 1e3, 177.84, 2, 'R_max'); publicado(b.Ref[0] / 1e3, 160.25, 2, 'R_ef');
  const g = R.ganancia(4, ETA, 3e9);
  const Rm = R.alcanceRadar({ Pt: RADAR.Pt, G: g.G, f: 3e9, sigma: RADAR.sigma, Pmin: RADAR.Pmin, LdB: RADAR.LdB });
  assert.equal(b.Rmax[0], Rm, 'mismo R_max que alcanceRadar');
  assert.equal(b.Ref[0], R.alcanceEfectivo(Rm, R.perdidaApuntamiento(0.4125, { a: 2, f: 3e9 }).idaVuelta), 'mismo R_ef');
  assert.equal(b.RefAtm, null, 'sin atm no hay curva con atmósfera');
  const t = R.friis({ Pt: 1, GtDbi: 0, GrDbi: g.GdBi, f: 3e9, d: 550e3, Tsys: 290, B: 1e6 });
  const t2 = R.friis({ Pt: 1, GtDbi: 0, GrDbi: g.GdBi, f: 3e9, d: 550e3, Tsys: 290, B: 1e6, perdidasDb: 0 });
  assert.equal(t.snr, t2.snr, 'Friis sin pérdidas extra no cambia');
});

prueba('Barrido 1–12 GHz = Python (R_max, R_ef y R_ef con 25 mm/h a 45°); R_max ∝ √f', () => {
  const r = REF.barrido, b = R.barridoFrecuencia(Object.assign({ fGHz: r.f, atm: { elDeg: r.elDeg, lluvia: r.lluvia } }, base));
  for (let i = 0; i < r.f.length; i++) {
    cerca(b.Rmax[i] / r.Rmax[i], 1, 1e-12, `R_max ${r.f[i]}`);
    cerca(b.Ref[i], r.Ref[i], 1e-5 * r.Rmax[i], `R_ef ${r.f[i]}`);
    cerca(b.RefAtm[i], r.RefAtm[i], 1e-5 * r.Rmax[i], `R_ef atm ${r.f[i]}`);
    cerca(b.Rmax[i] / b.Rmax[0], Math.sqrt(r.f[i] / r.f[0]), 1e-12, `√f ${r.f[i]}`);
  }
});

prueba('Forma de R_ef(f): sube hasta un máximo interior entre 3 y 5 GHz (4,5 GHz, 171,4 km) y cae al estrecharse el haz', () => {
  const b = R.barridoFrecuencia(base);
  assert.ok(b.fMax > 3 && b.fMax < 5, `máximo en ${b.fMax} GHz`);
  cerca(b.fMax, REF.barrido.fMax, 1e-9, 'f del máximo = Python'); publicado(b.RefMax / 1e3, 171.4, 1, 'R_ef máx.');
  const i = (f) => b.f.findIndex((x) => Math.abs(x - f) < 1e-9);
  publicado(b.Ref[i(1)] / 1e3, 101.5, 1, '1 GHz'); publicado(b.Ref[i(4)] / 1e3, 170.2, 1, '4 GHz');
  publicado(b.Ref[i(8)] / 1e3, 124.6, 1, '8 GHz'); publicado(b.Ref[i(12)] / 1e3, 17.2, 1, '12 GHz');
  for (let k = 1; k < b.f.length; k++) {
    if (b.f[k] <= b.fMax) assert.ok(b.Ref[k] >= b.Ref[k - 1], `sube a ${b.f[k]}`); else assert.ok(b.Ref[k] <= b.Ref[k - 1], `baja a ${b.f[k]}`);
  }
  // pasado el primer nulo no hay eco
  const z = R.barridoFrecuencia(Object.assign({ fGHz: [14] }, base)); assert.equal(z.Ref[0], 0);
});

prueba('Con atmósfera, R_ef < sin atmósfera en toda la banda y la diferencia crece con f y con la lluvia', () => {
  const sin = R.barridoFrecuencia(base);
  let dPrev = 0;
  for (const ll of [0, 5, 25, 50]) {
    const con = R.barridoFrecuencia(Object.assign({ atm: { elDeg: 45, lluvia: ll } }, base));
    let d = 0;
    for (let k = 0; k < sin.f.length; k++) {
      if (sin.Ref[k] > 0) assert.ok(con.RefAtm[k] < sin.Ref[k], `${sin.f[k]} GHz, ${ll} mm/h`);
      d += sin.Ref[k] - con.RefAtm[k];
    }
    assert.ok(d > dPrev, `más lluvia, más pérdida (${ll})`); dPrev = d;
  }
  const c = R.barridoFrecuencia(Object.assign({ fGHz: [2, 6, 10], atm: { elDeg: 45, lluvia: 25 } }, base));
  const s = R.barridoFrecuencia(Object.assign({ fGHz: [2, 6, 10] }, base));
  const rel = c.RefAtm.map((v, k) => v / s.Ref[k]);
  assert.ok(rel[0] > rel[1] && rel[1] > rel[2], 'el recorte relativo crece con f');
  // ida y vuelta: R_ef,atm = R_ef·10^(−2A/40)
  const A = R.atenuacionAtmosferica({ fGHz: 10, elDeg: 45, lluvia: 25 }).total;
  cerca(rel[2], Math.pow(10, -2 * A / 40), 1e-12, 'factor de ida y vuelta');
});

prueba('FSPL sube 20·log f y la ganancia de diámetro fijo 20·log f: el balance de Friis no depende de f (sin apuntamiento)', () => {
  const pr = (f) => { const g = R.ganancia(4, ETA, f).GdBi; return R.friis({ Pt: 1, GtDbi: g, GrDbi: g, f, d: 1e6 }); };
  const a = pr(2e9), b = pr(8e9);
  cerca(b.fspl - a.fspl, 20 * Math.log10(4), 1e-9, 'ΔFSPL = 12,04 dB');
  cerca(R.ganancia(4, ETA, 8e9).GdBi - R.ganancia(4, ETA, 2e9).GdBi, 20 * Math.log10(4), 1e-9, 'ΔG = 12,04 dB');
  // con antena de diámetro fijo en los dos extremos, la potencia recibida SUBE 20·log f (ganancia extra de una antena)
  cerca(b.PrDbw - a.PrDbw, 20 * Math.log10(4), 1e-9, 'Pr con dos antenas fijas');
  // con la antena del satélite isótropa (0 dBi, la del paso 4) se compensa exactamente
  const pr0 = (f) => R.friis({ Pt: 1, GtDbi: 0, GrDbi: R.ganancia(4, ETA, f).GdBi, f, d: 1e6 }).PrDbw;
  cerca(pr0(8e9) - pr0(2e9), 0, 1e-9, 'Pr con una antena fija y otra isótropa');
});

prueba('Directividad del reflector de la P4 (a = 18 cm a 9 GHz): 41253/(θE·θH) = 31,42 dBi (= Python)', () => {
  const e = R.haz({ a: 0.18, f: 9e9, plano: 'E' }).hpbw, h = R.haz({ a: 0.18, f: 9e9, plano: 'H' }).hpbw;
  cerca(e, REF.p4.hpbwE, 1e-5, 'θE'); cerca(h, REF.p4.hpbwH, 1e-5, 'θH');
  const D = 10 * Math.log10(41253 / (e * h));
  cerca(D, REF.p4.DdBi, 1e-5, 'D'); publicado(D, 31.42, 2, 'D [dBi]');
});

console.log(`\n${ok} pruebas correctas, ${fallos} fallidas`);
process.exitCode = fallos ? 1 : 0;
