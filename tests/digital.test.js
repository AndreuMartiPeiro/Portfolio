/* Pruebas de la modulación digital del enlace de telemetría (servo-telemetria.js, enlaceDigital) frente a Python.
 *
 *   node tests/digital.test.js
 *
 * Sin dependencias (node:assert). Las referencias están en tests/digital-referencias.json, generado con un script
 * de Python local (exporta_referencias_digital_atmosfera.py: scipy.stats.norm.sf, scipy.special.erfc,
 * scipy.optimize.brentq y una reimplementación de mulberry32 con aritmética uint32) que no forma parte del repo.
 * Tolerancias: BER con error relativo ≤ 1e-9 (el erfc del JS tiene error relativo ≲ 1e-13), Eb/N0 requerido ≤ 1e-6 dB,
 * muestras con ruido ≤ 1e-12 (misma semilla, mismo generador, misma transformación de Box–Muller).
 */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const TM = require(path.join(__dirname, '..', 'servo-telemetria.js'));
const REF = JSON.parse(fs.readFileSync(path.join(__dirname, 'digital-referencias.json'), 'utf8'));
const MODS = ['bpsk', 'qpsk', '8psk', 'qam16'];

let ok = 0, fallos = 0;
function prueba(nombre, fn) {
  try { fn(); ok++; console.log('  ok   ' + nombre); }
  catch (err) { fallos++; console.log('  FALLO ' + nombre + '\n        ' + String(err.message).split('\n').join('\n        ')); }
}
function cerca(x, ref, tol, que) {
  assert.ok(Math.abs(x - ref) <= tol, `${que || ''}: ${x} frente a ${ref} (tol ${tol})`);
}
function relativo(x, ref, tol, que) {
  assert.ok(Math.abs(x - ref) <= tol * Math.abs(ref), `${que || ''}: ${x} frente a ${ref} (rel ${tol})`);
}
const lin = (db) => Math.pow(10, db / 10);

console.log('\nservo-telemetria.js — modulación digital (desarrollo propio)');

prueba('BER teórica de BPSK, QPSK, 8-PSK y 16-QAM a Eb/N0 = 0…14 dB = scipy', () => {
  for (const m of MODS) REF.ebn0Db.forEach((d, i) => relativo(TM.berDigital(m, lin(d)), REF.ber[m][i], 1e-9, `${m} a ${d} dB`));
});

prueba('Fórmulas: BPSK = QPSK = Q(√(2Eb/N0)); 16-QAM (3/4)·Q(√(4Eb/5N0)) = (3/8)·erfc(√(2Eb/5N0))', () => {
  for (const d of [3, 7, 11]) {
    const x = lin(d);
    assert.equal(TM.berDigital('bpsk', x), TM.berDigital('qpsk', x));
    relativo(TM.berDigital('bpsk', x), 0.5 * TM.erfc(Math.sqrt(x)), 1e-12, 'BPSK = ½erfc(√(Eb/N0))');
    relativo(TM.berDigital('qam16', x), 0.375 * TM.erfc(Math.sqrt(2 * x / 5)), 1e-12, '16-QAM');
  }
  relativo(TM.berDigital('bpsk', lin(10)), 3.872108215522e-6, 1e-9, 'BPSK a 10 dB (tabla)');
});

prueba('Eb/N0 requerido para BER = 1e-5: BPSK/QPSK 9,59 dB; 8-PSK 12,97 dB; 16-QAM 13,43 dB (= brentq de Python)', () => {
  for (const m of MODS) cerca(TM.ebn0Requerido(m), REF.req[m], 1e-6, m);
  cerca(TM.ebn0Requerido('bpsk'), 9.5879, 5e-5, 'BPSK'); cerca(TM.ebn0Requerido('qam16'), 13.4345, 5e-5, '16-QAM');
  relativo(TM.berDigital('qam16', lin(TM.ebn0Requerido('qam16'))), 1e-5, 1e-6, 'inversa');
  assert.ok(TM.ebn0Requerido('bpsk', 1e-6) > TM.ebn0Requerido('bpsk', 1e-5), 'objetivo más exigente → más Eb/N0');
});

prueba('Orden a igual Eb/N0: BER(BPSK) = BER(QPSK) < BER(8-PSK) < BER(16-QAM); todas decrecen con Eb/N0', () => {
  for (let d = 0; d <= 16; d += 0.5) {
    const b = MODS.map((m) => TM.berDigital(m, lin(d)));
    assert.equal(b[0], b[1], `BPSK = QPSK a ${d} dB`);
    if (b[3] > 0) { assert.ok(b[1] < b[3], `QPSK < 16-QAM a ${d} dB`); assert.ok(b[1] < b[2] && b[2] < b[3], `8-PSK entre medias a ${d} dB`); }
    if (d > 0) for (const m of MODS) assert.ok(TM.berDigital(m, lin(d)) <= TM.berDigital(m, lin(d - 0.5)), `${m} monótona`);
  }
  assert.ok(TM.berDigital('qam16', 0) <= 0.5 && TM.berDigital('8psk', 0) <= 0.5, 'cota 1/2 a Eb/N0 = 0');
});

prueba('Constelaciones Gray: 2 / 4 / 8 / 16 puntos, Es = 1, iguales a Python y vecinos a un solo bit', () => {
  for (const m of MODS) {
    const c = TM.constelacion(m), r = REF.constelacion[m];
    assert.equal(c.length, TM.MOD_DIGITAL[m].M); assert.equal(c.length, r.i.length);
    c.forEach((p, j) => { cerca(p.i, r.i[j], 1e-15, `${m} i[${j}]`); cerca(p.q, r.q[j], 1e-15, `${m} q[${j}]`); assert.equal(p.bits, r.bits[j]); });
    cerca(c.reduce((s, p) => s + p.i * p.i + p.q * p.q, 0) / c.length, 1, 1e-12, `${m} Es`);
    assert.equal(new Set(c.map((p) => p.bits)).size, c.length, `${m} etiquetas distintas`);
    // distancia mínima y propiedad Gray: los pares a distancia mínima difieren en un bit
    let dmin = Infinity;
    for (const a of c) for (const b of c) if (a !== b) dmin = Math.min(dmin, Math.hypot(a.i - b.i, a.q - b.q));
    for (const a of c) for (const b of c) if (a !== b && Math.hypot(a.i - b.i, a.q - b.q) < dmin + 1e-9) {
      let dif = 0; for (let k = 0; k < a.bits.length; k++) dif += a.bits[k] !== b.bits[k];
      assert.equal(dif, 1, `${m}: ${a.bits} y ${b.bits} vecinos`);
    }
  }
  cerca(Math.hypot(TM.constelacion('qam16')[0].i - TM.constelacion('qam16')[1].i, TM.constelacion('qam16')[0].q - TM.constelacion('qam16')[1].q), 2 / Math.sqrt(10), 1e-15, '16-QAM d_min = 2/√10');
});

prueba('mulberry32 y muestras con ruido: idénticas a Python con la misma semilla; reproducibles', () => {
  const r = TM.mulberry32(1); REF.mulberry32_1.forEach((v, j) => cerca(r(), v, 0, `mulberry32(1)[${j}]`));
  for (const m of MODS) {
    const p = REF.muestras[m], s = TM.muestrasRuido(m, p.ebn0Db, p.i.length, p.semilla);
    p.i.forEach((v, j) => { cerca(s.i[j], v, 1e-12, `${m} i[${j}]`); cerca(s.q[j], p.q[j], 1e-12, `${m} q[${j}]`); assert.equal(s.simbolo[j], p.simbolo[j]); });
    const s2 = TM.muestrasRuido(m, p.ebn0Db, p.i.length, p.semilla);
    assert.deepEqual(Array.from(s2.i), Array.from(s.i), 'reproducible');
    const s3 = TM.muestrasRuido(m, p.ebn0Db, p.i.length, p.semilla + 1);
    assert.notDeepEqual(Array.from(s3.i), Array.from(s.i), 'otra semilla, otras muestras');
  }
});

prueba('Ruido de las muestras: σ = √(1/(2·log2M·Eb/N0)) y varianza empírica coherente (N = 4000)', () => {
  for (const m of ['qpsk', 'qam16']) {
    const s = TM.muestrasRuido(m, 10, 4000), c = TM.constelacion(m), k = TM.MOD_DIGITAL[m].k;
    cerca(s.sigma, Math.sqrt(1 / (2 * k * 10)), 1e-15, 'σ');
    let v = 0; for (let j = 0; j < 4000; j++) v += (s.i[j] - c[s.simbolo[j]].i) ** 2 + (s.q[j] - c[s.simbolo[j]].q) ** 2;
    cerca(v / 4000 / (2 * s.sigma * s.sigma), 1, 0.08, `${m} varianza`);
  }
});

prueba('Enlace: Eb/N0 = γ_ref − L + 10·log10(1 MHz/Rb); BER, margen, banda Rs(1 + 0,35) y eficiencia = Python', () => {
  for (const e of REF.enlace) {
    const d = TM.enlaceDigital({ perdidaDb: e.perdidaDb, snrRefDb: e.snrRefDb, modulacion: e.mod, Rb: e.Rb });
    cerca(d.ebn0Db, e.ebn0Db, 1e-12, 'Eb/N0'); cerca(d.margenDb, e.margenDb, 1e-6, 'margen');
    if (e.ber > 1e-300) relativo(d.ber, e.ber, 1e-9, 'BER');
    relativo(d.anchoBanda, e.anchoBanda, 1e-12, 'banda'); relativo(d.eficiencia, e.eficiencia, 1e-12, 'eficiencia');
    assert.equal(d.bajoUmbral, e.margenDb < 0);
  }
  // coherencia con el modelo analógico: Rb = 2·W_ref → Eb/N0 = γ/2
  const d = TM.enlaceDigital({ perdidaDb: 1, snrRefDb: 20, modulacion: 'bpsk', Rb: 2 * TM.W_REF });
  const a = TM.telemetria({ perdidaDb: 1, snrRefDb: 20, modulacion: 'am' });
  cerca(d.ebn0Db, a.ebn0Db, 1e-12, 'Eb/N0 digital = analógico con Rb = 2W');
  assert.equal(d.constelacion.length, 2); assert.equal(d.muestras.i.length, 600);
});

prueba('La pérdida de apuntamiento rebaja Eb/N0 dB a dB; sin señal, BER = 1/2 (BPSK)', () => {
  const a = TM.enlaceDigital({ perdidaDb: 0, snrRefDb: 20, modulacion: 'qam16', Rb: 2e6 });
  const b = TM.enlaceDigital({ perdida: { ida: 3.84 }, snrRefDb: 20, modulacion: 'qam16', Rb: 2e6 });
  cerca(a.ebn0Db - b.ebn0Db, 3.84, 1e-12, 'ΔEb/N0'); assert.ok(b.ber > 1e4 * a.ber);
  assert.ok(a.margenDb > 0 && b.margenDb < 0, '16-QAM a 2 Mbit/s pierde el margen con 3,84 dB');
  cerca(TM.enlaceDigital({ perdidaDb: Infinity, snrRefDb: 20, modulacion: 'bpsk', Rb: 1e6 }).ber, 0.5, 1e-12, 'sin señal');
});

console.log(`\n${ok} pruebas correctas, ${fallos} fallidas`);
process.exitCode = fallos ? 1 : 0;
