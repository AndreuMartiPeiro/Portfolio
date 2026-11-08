/* Pruebas del motor DSP de la telemetría (servo-telemetria.js) frente a Python y a casos analíticos.
 *
 *   node tests/telemetria.test.js
 *
 * Sin dependencias (node:assert). Las referencias de Python están en tests/telemetria-referencias.json, generado con
 *   un script de Python local (exporta_referencias_telemetria.py, reutiliza xf() de p3_modulaciones_corregido.py)
 *   que no forma parte de este repositorio. Las cifras «publicadas» son las de p3_salida.txt.
 * Tolerancias: espectros y envolventes |Δ| ≤ 1e-9 frente a numpy/scipy (misma aritmética en doble precisión, otro
 * algoritmo de FFT); cifras publicadas a la precisión con la que se publican.
 */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const TM = require(path.join(__dirname, '..', 'servo-telemetria.js'));
const R = require(path.join(__dirname, '..', 'servo-radar.js'));
const REF = JSON.parse(fs.readFileSync(path.join(__dirname, 'telemetria-referencias.json'), 'utf8'));

let ok = 0, fallos = 0;
function prueba(nombre, fn) {
  try { fn(); ok++; console.log('  ok   ' + nombre); }
  catch (err) { fallos++; console.log('  FALLO ' + nombre + '\n        ' + String(err.message).split('\n').join('\n        ')); }
}
function cerca(x, ref, tol, que) {
  assert.ok(Math.abs(x - ref) <= tol, `${que || ''}: ${x} frente a ${ref} (tol ${tol})`);
}
/** Cifra «publicada»: |x − cifra| ≤ media unidad del último decimal (se admite el empate exacto). */
function publicado(x, cifra, dec, que) {
  const tol = 0.5 * Math.pow(10, -dec) * (1 + 1e-9);
  assert.ok(Math.abs(x - cifra) <= tol, `${que || ''}: ${x} no redondea a ${cifra} con ${dec} decimales`);
}
function serie(js, py, tolAbs, que) {
  assert.equal(js.length, py.length, `${que}: longitud`);
  for (let k = 0; k < py.length; k++) {
    const tol = tolAbs * Math.max(1, Math.abs(py[k]));
    if (!(Math.abs(js[k] - py[k]) <= tol)) assert.fail(`${que}[${k}]: ${js[k]} frente a ${py[k]}`);
  }
}
function dftDirecta(x) {
  const n = x.length, re = new Float64Array(n), im = new Float64Array(n);
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) {
    const a = -2 * Math.PI * ((k * j) % n) / n; re[k] += x[j] * Math.cos(a); im[k] += x[j] * Math.sin(a);
  }
  return { re, im };
}
const difAng = (a, b) => ((a - b + 540) % 360) - 180;

// ============================================================================ FFT y normalización
console.log('\nservo-telemetria.js — FFT y normalización (corrección C.4)');

prueba('FFT radix-2 (N = 64) y Bluestein (N = 50, 97) = DFT directa; ifft(fft(x)) = x', () => {
  for (const n of [64, 50, 97]) {
    const x = Array.from({ length: n }, (_, k) => Math.sin(0.37 * k * k) + 0.2 * Math.cos(1.3 * k));
    const F = TM.fft(x), D = dftDirecta(x);
    serie(F.re, D.re, 1e-11, `re N=${n}`); serie(F.im, D.im, 1e-11, `im N=${n}`);
    const b = TM.ifft(F); serie(b.re, x, 1e-13, `ifft N=${n}`); serie(b.im, new Float64Array(n), 1e-13, `ifft im N=${n}`);
  }
});

prueba('Parseval con X = Δt·Σ…: Σ|x|²·Δt = Σ|X|²·Δf (N = 500 y N = 1024)', () => {
  for (const [fs, n] of [[1000, 500], [8192, 1024]]) {
    const t = TM.tiempos(fs, n / fs);
    const x = Array.from(t, (tt) => Math.exp(-40 * (tt - 0.2) ** 2) * Math.cos(2 * Math.PI * 50 * tt) + 0.3);
    const X = TM.xf(x, t);
    const e_t = x.reduce((s, v) => s + v * v, 0) / fs, df = fs / n;
    const e_f = X.abs.reduce((s, v) => s + v * v, 0) * df;
    cerca(e_f / e_t, 1, 1e-12, `Parseval N=${n}`);
  }
});

prueba('C.4 pulso de área 0,02 V·s: |X(0)| = 0,0200 V·s (sin Δt, la entrega daba 200,0)', () => {
  const p = REF.pulso, t = TM.tiempos(1 / p.dt, p.n * p.dt);
  assert.equal(t.length, p.n);
  const x = Array.from(t, (tt) => (tt < 0.02 ? 1 : 0));
  const X = TM.xf(x, t, p.N);
  cerca(X.abs[p.N / 2], p.X0, 1e-12, '|X(0)|'); publicado(X.abs[p.N / 2], 0.02, 4, '|X(0)|');
  const F = TM.fft(x, p.N); cerca(Math.hypot(F.re[0], F.im[0]), p.X0_sinDt, 1e-9, 'sin Δt'); publicado(F.re[0], 200.0, 1, 'sin Δt');
});

prueba('xf con t[0] ≠ 0: la fase se refiere a t[0] (cos desplazado da la misma |X| y fase 0 en su línea)', () => {
  const t = TM.tiempos(1000, 0.5, 0.123), x = Array.from(t, (tt) => Math.cos(2 * Math.PI * 20 * tt));
  const X = TM.xf(x, t), k = X.f.findIndex((f) => Math.abs(f - 20) < 1e-9);
  cerca(X.abs[k] / 0.5, 0.5, 1e-12, '|X|/T'); cerca(Math.atan2(X.im[k], X.re[k]), 0, 1e-9, 'fase');
});

// ============================================================================ DSB y AM
console.log('\nDSB-AM (2.1) y AM (3.1)');

prueba('DSB: líneas en fc ± f0 = 230/270 Hz con |X|/t0 = 0,25; portadora suprimida; |DSB(f)| igual a numpy', () => {
  const c = TM.casoDSBAM(), d = REF.dsb;
  assert.equal(c.t.length, d.L);
  serie(c.D.f, d.f, 1e-12, 'f'); serie(c.D.abs, d.absD, 1e-12, '|DSB|');
  cerca(c.lineas.M20, d.M20, 1e-12, 'M20'); publicado(c.lineas.M20, 0.5, 4, '|M(20)|/t0');
  publicado(c.lineas.D230, 0.25, 4, 'D230'); publicado(c.lineas.D270, 0.25, 4, 'D270');
  cerca(c.lineas.D230, 0.25, 1e-12, 'D230 analítico');
  assert.ok(c.lineas.D250 < 1e-12, `portadora suprimida: ${c.lineas.D250}`);
  publicado(Math.max(...c.D.abs), 0.125, 4, 'pico |DSB| V·s');
  const lin = TM.lineas(c.D, 0.5, 0.01, 0).map((l) => l.f); assert.deepEqual(lin, [230, 270]);
});

prueba('AM β = 0,85: 250 Hz = 0,5; 230/270 Hz = 0,2125 (= β·0,25 frente a DSB; β/2 frente a la portadora)', () => {
  const c = TM.casoDSBAM(), a = REF.am;
  cerca(c.lineas.A230, a.A230, 1e-12, 'A230'); cerca(c.lineas.A250, a.A250, 1e-12, 'A250'); cerca(c.lineas.A270, a.A270, 1e-12, 'A270');
  cerca(c.lineas.A250, 0.5, 1e-12, 'portadora'); cerca(c.lineas.A270, 0.2125, 1e-12, 'banda lateral');
  publicado(c.lineas.A270 / c.lineas.D270, 0.850, 3, 'AM/DSB = β'); publicado(c.lineas.A270 / c.lineas.A250, 0.425, 3, 'lateral/portadora = β/2');
});

// ============================================================================ FM
console.log('\nFM (4.1)');

prueba('FM kf = 80: ∫m dt (cumtrapz) = 0,00796; f_i 170,1–329,9 Hz, error 0,08 Hz; igual que Python', () => {
  const c = TM.casoFM(), r = REF.fm;
  serie(c.I.slice(0, 200), r.I, 1e-13, 'I');
  const maxI = Math.max(...c.I.map(Math.abs)); cerca(maxI, r.maxI, 1e-13, 'max|I|'); publicado(maxI, 0.00796, 5, 'max|I|');
  publicado(1 / (2 * Math.PI * 20), 0.00796, 5, '1/(2πf0)');
  let errI = 0; c.t.forEach((t, k) => { errI = Math.max(errI, Math.abs(c.I[k] - Math.sin(2 * Math.PI * 20 * t) / (2 * Math.PI * 20))); });
  cerca(errI, r.errI, 1e-12, 'max|I − sin/(2πf0)|');
  let mn = Infinity, mx = -Infinity, err = 0;
  c.t.forEach((t, k) => { if (t > 0.05 && t < 0.45) { mn = Math.min(mn, c.fi[k]); mx = Math.max(mx, c.fi[k]); err = Math.max(err, Math.abs(c.fi[k] - (250 + 80 * c.m[k]))); } });
  cerca(mn, r.fiMin, 1e-8, 'f_i min'); cerca(mx, r.fiMax, 1e-8, 'f_i max'); cerca(err, r.errFi, 1e-8, 'error f_i');
  publicado(mn, 170.1, 1, 'f_i min'); publicado(mx, 329.9, 1, 'f_i max'); publicado(err, 0.08, 2, 'error f_i');
});

prueba('FM: β_FM = 4, Carson = 200 Hz; líneas en fc + n·20 Hz = |J_n(4)|/2 (y = Python)', () => {
  const c = TM.casoFM(), r = REF.fm;
  assert.equal(c.betaFM, 4); assert.equal(c.carson, 200); assert.equal(TM.carson(80, 20), 200);
  for (let n = 0; n <= 6; n++) {
    cerca(c.lineas[n].a, r.lineas[n], 1e-11, `línea n=${n}`);
    cerca(c.lineas[n].bessel, r.bessel[n], 1e-13, `|J${n}(4)|/2 frente a scipy`);
    cerca(c.lineas[n].a, c.lineas[n].bessel, 6e-4, `línea ≈ |J${n}(4)|/2`);
  }
  publicado(c.lineas[0].a, 0.1986, 4, '250 Hz'); publicado(c.lineas[3].a, 0.2151, 4, '310 Hz');
  // 98 % de la potencia de f > 0 en 9 líneas
  const p = Array.from(c.X.abs).filter((_, k) => c.X.f[k] > 0).map((v) => v * v).sort((a, b) => b - a);
  const tot = p.reduce((s, v) => s + v, 0); let acc = 0, nl = 0; while (acc / tot < 0.98) acc += p[nl++];
  assert.equal(nl, r.n98); assert.equal(nl, 9);
});

prueba('Bessel J_n(x) de orden entero: valores tabulados y J0(16), J15(16)', () => {
  cerca(TM.besselJ(0, 4), -0.39714980986384735, 1e-14, 'J0(4)'); cerca(TM.besselJ(1, 4), -0.06604332802354913, 1e-14, 'J1(4)');
  cerca(TM.besselJ(3, 4), 0.43017147387562193, 1e-14, 'J3(4)'); cerca(TM.besselJ(0, 0), 1, 1e-15, 'J0(0)');
  cerca(Math.abs(TM.besselJ(0, 16)) / 2, REF.vor.bessel['0'], 1e-14, '|J0(16)|/2'); cerca(Math.abs(TM.besselJ(15, 16)) / 2, REF.vor.bessel['15'], 1e-14, '|J15(16)|/2');
});

// ============================================================================ demodulación AM
console.log('\nDemodulación AM (5.1) con el mensaje del enunciado 1 / −2 / 0');

prueba('Envolvente de Hilbert = abs(scipy.signal.hilbert) muestra a muestra (β = 0,85 y 0,4)', () => {
  for (const b of ['0.85', '0.4']) serie(TM.casoDemodAM(Number(b)).v, REF.demod[b].v, 1e-12, `v β=${b}`);
});

prueba('β = 0,85: SOBREMODULACIÓN (β·max|m| = 1,70, min(1 + β·m) = −0,700); mesetas +1,000 / −0,353 / 0,000', () => {
  const c = TM.casoDemodAM(0.85), r = REF.demod['0.85'];
  assert.equal(c.sobremodulada, true); publicado(c.indice, 1.70, 2, 'β·max|m|'); publicado(c.minEnvolvente, -0.700, 3, 'min env');
  cerca(c.minEnvolvente, r.minEnv, 1e-15, 'min env');
  for (let i = 0; i < 3; i++) { cerca(c.mesetas.correcta[i], r.correcta[i], 1e-12, `meseta ${i}`); cerca(c.mesetas.guion[i], r.guion[i], 1e-12, `meseta guion ${i}`); }
  publicado(c.mesetas.correcta[0], 1.000, 3, '+1'); publicado(c.mesetas.correcta[1], -0.353, 3, '−2 → −0,353'); publicado(c.mesetas.correcta[2], 0.000, 3, '0');
  publicado(c.mesetaTeorica, -0.353, 3, 'teoría (0,7 − 1)/0,85');
});

prueba('Fórmula del guion 2(v−1)/β devuelve 2·m: +2,000 / −0,706 / 0,000 (comparar con −4, no con −2)', () => {
  const c = TM.casoDemodAM(0.85);
  publicado(c.mesetas.guion[0], 2.000, 3, '+1 → 2'); publicado(c.mesetas.guion[1], -0.706, 3, '−2 → −0,706'); publicado(c.mesetas.guion[2], 0.000, 3, '0');
  for (let k = 0; k < c.v.length; k++) cerca(c.guion[k], 2 * c.correcta[k], 1e-12, 'guion = 2·correcta');
});

prueba('β = 0,4: sin sobremodulación (β·max|m| = 0,80, min = +0,200); mesetas +1,000 / −2,000 / 0,000', () => {
  const c = TM.casoDemodAM(0.4), r = REF.demod['0.4'];
  assert.equal(c.sobremodulada, false); publicado(c.indice, 0.80, 2, 'β·max|m|'); publicado(c.minEnvolvente, 0.200, 3, 'min env');
  for (let i = 0; i < 3; i++) cerca(c.mesetas.correcta[i], r.correcta[i], 1e-12, `meseta ${i}`);
  publicado(c.mesetas.correcta[0], 1.000, 3, '+1'); publicado(c.mesetas.correcta[1], -2.000, 3, '−2'); publicado(c.mesetas.correcta[2], 0.000, 3, '0');
  publicado(c.mesetas.guion[1], -4.000, 3, 'guion −2 → −4');
});

// ============================================================================ VOR
console.log('\nVOR en banda base (6.1)');

prueba('VOR: N = 10 000, DC = 1,000, 30 Hz = 0,45 (= β/2), β_FM = 16, Carson 1020 Hz (9450–10 470 Hz), 97,5 %', () => {
  const c = TM.casoVOR(45), r = REF.vor;
  assert.equal(c.t.length, r.N);
  cerca(c.DC, r.DC, 1e-12, 'DC'); cerca(c.A30, r.A30, 1e-12, '30 Hz'); cerca(c.A30, 0.45, 1e-12, '30 Hz = β/2');
  assert.equal(c.betaFM, 16); assert.equal(c.carson, 1020);
  cerca(c.fsub - c.carson / 2, 9450, 1e-9, 'borde inferior'); cerca(c.fsub + c.carson / 2, 10470, 1e-9, 'borde superior');
  cerca(c.fraccionCarson, r.fraccionCarson, 1e-12, 'fracción'); publicado(c.fraccionCarson * 100, 97.5, 1, '% en Carson');
  for (const s of c.sub) {
    cerca(s.a, r.sub[String(s.n)], 1e-11, `línea ${s.f} Hz`); cerca(s.a, s.bessel, 1e-9, `|J${s.n}(16)|/2`);
  }
  publicado(c.sub[0].a, 0.0874, 4, '9960 Hz'); publicado(c.sub[2].a, 0.1200, 4, '10 410 Hz');
});

prueba('VOR: rumbo recuperado por la diferencia de fase de los dos 30 Hz = θ − φ (y = Python)', () => {
  for (const c of REF.vor.rumbos) {
    const v = TM.vorBandaBase({ thetaDeg: c.theta, phiDeg: c.phi });
    const r = TM.vorRumbo(v.s, v.fs);
    cerca(difAng(r.rumbo, c.rumbo), 0, 1e-8, `rumbo frente a Python θ=${c.theta}`);
    cerca(difAng(r.rumbo, c.theta - c.phi), 0, 1e-8, `rumbo = θ − φ (θ=${c.theta}, φ=${c.phi})`);
    cerca(difAng(r.faseAM, c.phi), 0, 1e-8, 'fase AM');
    assert.ok(r.rumbo >= 0 && r.rumbo < 360, 'rumbo en [0, 360)');
  }
  for (let th = 0; th < 360; th += 23.5) cerca(difAng(TM.casoVOR(th).rumbo, th), 0, 1e-8, `barrido θ=${th}`);
});

// ============================================================================ enlace de telemetría
console.log('\nEnlace de telemetría (desarrollo propio)');

prueba('Q(x) y erfc: valores tabulados (error relativo < 1e-12)', () => {
  cerca(TM.qfunc(0), 0.5, 1e-9, 'Q(0)'); cerca(TM.qfunc(1) / 0.15865525393145707, 1, 1e-12, 'Q(1)');
  cerca(TM.qfunc(3) / 1.3498980316301e-3, 1, 1e-12, 'Q(3)'); cerca(TM.qfunc(6) / 9.865876450377e-10, 1, 1e-12, 'Q(6)');
  cerca(TM.qfunc(-1) + TM.qfunc(1), 1, 1e-9, 'simetría');
});

prueba('SNR del enlace = referencia − pérdida de apuntamiento (1,81 dB de ida y vuelta → 0,905 dB de ida)', () => {
  const L = R.perdidaApuntamiento(0.4125, { a: 2, f: 3e9 });
  publicado(L.idaVuelta, 1.81, 2, 'pérdida de la P4');
  const t = TM.telemetria({ perdida: L, snrRefDb: 30, modulacion: 'am' });
  cerca(t.gammaDb, 30 - L.ida, 1e-12, 'γ'); cerca(t.perdidaDb, L.ida, 0, 'ida');
  const t0 = TM.telemetria({ perdidaDb: 0, snrRefDb: 30, modulacion: 'am' });
  assert.ok(t.ber > t0.ber, 'la pérdida empeora la tasa de error');
});

prueba('AM envolvente: SNR de salida η·γ, Pb = Q(β√(γ/(1+β²))), umbral en γ = 13,01 dB; sobremodulación', () => {
  const g = 20, t = TM.telemetria({ perdidaDb: 0, snrRefDb: g, modulacion: 'am', beta: 0.85 });
  const G = 100, b = 0.85, eta = b * b * 0.5 / (1 + b * b * 0.5);
  cerca(t.snrSalidaDb, 10 * Math.log10(eta * G), 1e-12, 'SNR salida');
  cerca(t.cnrDb, g - 10 * Math.log10(2), 1e-12, 'CNR en 2W');
  cerca(t.ber, TM.qfunc(b * Math.sqrt(G / (1 + b * b))), 1e-15, 'Pb');
  cerca(t.umbralGammaDb, 10 + 10 * Math.log10(2), 1e-12, 'umbral'); assert.equal(t.bajoUmbral, false);
  assert.equal(TM.telemetria({ perdidaDb: 8, snrRefDb: g, modulacion: 'am' }).bajoUmbral, true, 'γ = 12 dB < 13,01');
  const s = TM.telemetria({ perdidaDb: 0, snrRefDb: g, modulacion: 'am', beta: 1.7 });
  assert.equal(s.sobremodulada, true); cerca(s.ber, TM.qfunc(Math.sqrt(G / (1 + 1.7 * 1.7))), 1e-15, 'Pb sobremodulada (d = 1)');
  cerca(TM.telemetria({ perdidaDb: Infinity, snrRefDb: g, modulacion: 'am' }).ber, 0.5, 1e-9, 'sin señal: Pb = 1/2');
});

prueba('FM con umbral: (S/N)_D = 3β²⟨m²⟩γ, umbral γ = 20(β+1), Pb = ½e^(−γ/4) encima y ½e^(−CNR/2) debajo', () => {
  const b = 4, gTh = 10 * Math.log10(20 * (b + 1));
  const enc = TM.telemetria({ perdidaDb: 0, snrRefDb: 25, modulacion: 'fm', betaFM: b });
  cerca(enc.umbralGammaDb, gTh, 1e-12, 'umbral = 20(β+1)'); assert.equal(enc.bajoUmbral, false);
  const G = Math.pow(10, 2.5);
  cerca(enc.snrSalidaDb, 10 * Math.log10(3 * b * b * 0.5 * G), 1e-12, 'SNR salida');
  cerca(enc.ber, 0.5 * Math.exp(-G / 4), 1e-15, 'Pb encima');
  const deb = TM.telemetria({ perdidaDb: 6, snrRefDb: 25, modulacion: 'fm', betaFM: b }); // γ = 19 dB < 20 dB
  assert.equal(deb.bajoUmbral, true);
  const G2 = Math.pow(10, 1.9); cerca(deb.ber, 0.5 * Math.exp(-(G2 / 10) / 2), 1e-15, 'Pb debajo (sin ganancia de FM)');
  assert.ok(deb.ber > 1e3 * enc.ber, 'el umbral de FM se nota en la tasa de error');
});

console.log(`\n${ok} pruebas correctas, ${fallos} fallidas`);
process.exitCode = fallos ? 1 : 0;
