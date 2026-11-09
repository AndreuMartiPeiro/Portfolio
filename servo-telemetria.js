/* servo-telemetria.js — motor DSP de la telemetría del satélite (sin DOM, sin dependencias).
 *
 * Funciona igual en el navegador (objeto global `window.ServoTelemetria`) y en Node (`module.exports`).
 * Versión CORREGIDA de la P3 de CySC (modulaciones), contrastada con correcciones/p3_modulaciones_corregido.py.
 *
 * (a) FFT y transformada de Fourier aproximada.
 *     · fft(): radix-2 iterativa para N potencia de 2; para cualquier otro N, Bluestein (chirp-z) sobre la radix-2,
 *       así se usan los mismos N que la práctica (500, 1000, 10 000) y los mismos bins que numpy.
 *     · xf(x, t, N): X(f_k) = Δt · Σ x(t_n) e^{−j2π f_k t_n}  (ec. 6 de la P2), con fftshift y la fase referida a t[0].
 *       Corrección C.4 de la P3: la entrega devolvía fftshift(fft(x, N)) SIN el factor Δt (un pulso de área
 *       0,02 V·s daba |X(0)| = 200 en vez de 0,02 V·s).
 *     · coeficientes(X, T) = |X|/T, con T = N·Δt la duración: amplitud de cada exponencial (espectro bilateral);
 *       un cos de amplitud A da dos líneas de A/2. Es lo que la entrega leía con |fft|/L.
 * (b) Modulaciones: DSB-AM m·c; AM (1 + β·m)·c; FM cos(2π fc t + 2π kf ∫m dt) con la integral trapezoidal
 *     (= cumtrapz), β_FM = Δf/f_m con Δf = kf·max|m|, ancho de Carson 2(Δf + f_m).
 * (c) Envolvente por Hilbert (vía FFT, igual que scipy.signal.hilbert) y demodulación AM:
 *       m̂ = (v − 1)/β          ← fórmula correcta (recupera m)
 *       2·(v − 1)/β             ← fórmula del guion: devuelve 2·m (en la meseta +1 da 2,000)
 *     Sobremodulación si β·max|m| > 1: 1 + β·m < 0, la portadora invierte su fase y el detector de envolvente
 *     ve |1 + β·m|. Con el mensaje del enunciado (1 / −2 / 0) y β = 0,85, la meseta −2 sale −0,353
 *     (−0,706 con la fórmula del guion); con β = 0,4 sale −2,000. No es un efecto de la constante RC
 *     (la envolvente de Hilbert no tiene RC).
 * (d) VOR en banda base: s(t) = 1 + β·cos(2π·30 t + φ) + cos(2π·9960 t + β_FM·cos(2π·30 t + θ)), β = 0,9,
 *     β_FM = 480/30 = 16, Carson 2(16 + 1)·30 = 1020 Hz alrededor de 9960 Hz. El rumbo se recupera como la
 *     diferencia de fase entre el 30 Hz de la referencia AM y el 30 Hz de la fase de la subportadora FM (θ − φ).
 *     El caso en RF (portadora de 114,65 MHz muestreada a 250 MHz, 0,1 s = 25·10⁶ muestras) NO se simula en el
 *     navegador: su espectro es el de banda base trasladado a ±f_portadora con la mitad de amplitud (verificado
 *     en Python, p3_salida.txt: 0,500 / 0,2250 / 0,0437).
 * (e) Enlace de telemetría — DESARROLLO PROPIO (no sale de la P3), modelo de libro simple, ver telemetria().
 * (f) Modulación digital BPSK/QPSK/8-PSK/16-QAM con codificación Gray — DESARROLLO PROPIO, ver enlaceDigital().
 *
 * Unidades: t en s, f en Hz, señales en V; X en V·s; fases de salida en grados.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ServoTelemetria = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  // =========================================================================== (a) FFT
  function _esPot2(n) { return n > 0 && (n & (n - 1)) === 0; }

  /** FFT radix-2 iterativa in situ (n potencia de 2). signo = −1 directa, +1 inversa (sin dividir por n). */
  function _radix2(re, im, signo) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { // inversión de bits
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    const cs = new Float64Array(n >> 1), sn = new Float64Array(n >> 1);
    for (let k = 0; k < n >> 1; k++) { cs[k] = Math.cos(2 * Math.PI * k / n); sn[k] = signo * Math.sin(2 * Math.PI * k / n); }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1, paso = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k++) {
          const wr = cs[k * paso], wi = sn[k * paso];
          const a = i + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }

  /** DFT de longitud arbitraria por Bluestein (chirp-z) apoyada en la radix-2. */
  function _bluestein(re, im, signo) {
    const n = re.length;
    let m = 1; while (m < 2 * n - 1) m <<= 1;
    const wr = new Float64Array(n), wi = new Float64Array(n);
    for (let k = 0; k < n; k++) { // w_k = e^{signo·jπ k²/n}; k² mod 2n para no perder precisión
      const a = Math.PI * ((k * k) % (2 * n)) / n;
      wr[k] = Math.cos(a); wi[k] = signo * Math.sin(a);
    }
    const ar = new Float64Array(m), ai = new Float64Array(m), br = new Float64Array(m), bi = new Float64Array(m);
    for (let k = 0; k < n; k++) {
      ar[k] = re[k] * wr[k] - im[k] * wi[k]; ai[k] = re[k] * wi[k] + im[k] * wr[k];
    }
    br[0] = wr[0]; bi[0] = -wi[0];
    for (let k = 1; k < n; k++) { br[k] = br[m - k] = wr[k]; bi[k] = bi[m - k] = -wi[k]; }
    _radix2(ar, ai, -1); _radix2(br, bi, -1);
    for (let k = 0; k < m; k++) {
      const r = ar[k] * br[k] - ai[k] * bi[k], i = ar[k] * bi[k] + ai[k] * br[k];
      ar[k] = r; ai[k] = i;
    }
    _radix2(ar, ai, +1);
    for (let k = 0; k < n; k++) {
      const cr = ar[k] / m, ci = ai[k] / m;
      re[k] = cr * wr[k] - ci * wi[k]; im[k] = cr * wi[k] + ci * wr[k];
    }
  }

  /**
   * FFT sin normalizar (misma convención que numpy.fft.fft): X_k = Σ x_n e^{−j2π kn/N}.
   * x: array real o {re, im}; N opcional (rellena con ceros o trunca, como fft(x, N)). Devuelve {re, im} (Float64Array).
   */
  function fft(x, N) {
    const xr = x.re || x, xi = x.im || null;
    const n = N || xr.length;
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let k = 0; k < Math.min(n, xr.length); k++) { re[k] = xr[k]; if (xi) im[k] = xi[k]; }
    if (n === 1) return { re, im };
    if (_esPot2(n)) _radix2(re, im, -1); else _bluestein(re, im, -1);
    return { re, im };
  }

  /** IFFT normalizada por 1/N (numpy.fft.ifft). X = {re, im}. */
  function ifft(X) {
    const n = X.re.length;
    const re = Float64Array.from(X.re), im = Float64Array.from(X.im);
    if (n > 1) { if (_esPot2(n)) _radix2(re, im, +1); else _bluestein(re, im, +1); }
    for (let k = 0; k < n; k++) { re[k] /= n; im[k] /= n; }
    return { re, im };
  }

  /** Eje de frecuencias de fftshift: f_k = (k − ⌊N/2⌋)·fs/N, k = 0…N−1. */
  function frecuencias(N, fs) {
    const f = new Float64Array(N), h = Math.floor(N / 2);
    for (let k = 0; k < N; k++) f[k] = (k - h) * fs / N;
    return f;
  }

  /**
   * Transformada de Fourier aproximada (ec. 6 de la P2), corrección C.4:
   *   X(f_k) = Δt · Σ x(t_n) e^{−j2π f_k t_n},  f_k = (k − ⌊N/2⌋)·fs/N  (centrada, como fftshift).
   * t: vector de tiempos equiespaciado (se usan t[0] y Δt = t[1] − t[0]). Devuelve {re, im, abs, f, dt, fs, N}; X en V·s.
   */
  function xf(x, t, N) {
    const n = N || x.length;
    const dt = t[1] - t[0], fs = 1 / dt, t0 = t[0];
    const F = fft(x, n), f = frecuencias(n, fs), h = Math.floor(n / 2);
    const re = new Float64Array(n), im = new Float64Array(n), ab = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const j = (k - h + n) % n;                    // fftshift
      let r = F.re[j] * dt, i = F.im[j] * dt;
      if (t0 !== 0) { const a = -2 * Math.PI * f[k] * t0, c = Math.cos(a), s = Math.sin(a); const r2 = r * c - i * s; i = r * s + i * c; r = r2; }
      re[k] = r; im[k] = i; ab[k] = Math.hypot(r, i);
    }
    return { re, im, abs: ab, f, dt, fs, N: n };
  }

  /** Espectro de coeficientes |X|/T (T = duración de la señal; por defecto N·Δt): amplitud de cada exponencial. */
  function coeficientes(X, T) {
    const TT = T || X.N * X.dt, out = new Float64Array(X.N);
    for (let k = 0; k < X.N; k++) out[k] = X.abs[k] / TT;
    return out;
  }

  /** Valor del espectro de coeficientes en el bin más cercano a fObj. */
  function lineaEn(X, fObj, T) {
    let kb = 0;
    for (let k = 1; k < X.N; k++) if (Math.abs(X.f[k] - fObj) < Math.abs(X.f[kb] - fObj)) kb = k;
    return X.abs[kb] / (T || X.N * X.dt);
  }

  /** Líneas con |X|/T > umbral y f ≥ fmin: [{f, a}]. */
  function lineas(X, T, umbral, fmin) {
    const u = umbral == null ? 0.01 : umbral, fm = fmin == null ? -Infinity : fmin, TT = T || X.N * X.dt, out = [];
    for (let k = 0; k < X.N; k++) if (X.abs[k] / TT > u && X.f[k] >= fm) out.push({ f: X.f[k], a: X.abs[k] / TT });
    return out;
  }

  // =========================================================================== utilidades de señal
  /** t_n = t0 + n/fs para n = 0…N−1 con N = número de muestras de [t0, t0 + T) (np.arange). */
  function tiempos(fs, T, t0) {
    const dt = 1 / fs, N = Math.ceil(T / dt - 1e-9), a = t0 || 0, t = new Float64Array(N);
    for (let n = 0; n < N; n++) t[n] = a + n * dt;
    return t;
  }

  /** Integral acumulada trapezoidal con I(0) = 0 (cumtrapz / cumulative_trapezoid(..., initial=0)). */
  function integralTrapecio(y, t) {
    const I = new Float64Array(y.length);
    for (let k = 1; k < y.length; k++) I[k] = I[k - 1] + 0.5 * (t[k] - t[k - 1]) * (y[k] + y[k - 1]);
    return I;
  }

  /** Señal analítica x + j·H{x} vía FFT (scipy.signal.hilbert): {re, im}. */
  function analitica(x) {
    const n = x.length, X = fft(x), h = new Float64Array(n);
    h[0] = 1;
    if (n % 2 === 0) { h[n / 2] = 1; for (let k = 1; k < n / 2; k++) h[k] = 2; }
    else for (let k = 1; k < (n + 1) / 2; k++) h[k] = 2;
    for (let k = 0; k < n; k++) { X.re[k] *= h[k]; X.im[k] *= h[k]; }
    return ifft(X);
  }

  /** Envolvente |x + j·H{x}| (envolvente.m del enunciado = abs(hilbert(x))). */
  function envolvente(x) {
    const z = analitica(x), v = new Float64Array(x.length);
    for (let k = 0; k < v.length; k++) v[k] = Math.hypot(z.re[k], z.im[k]);
    return v;
  }

  /** Desenrollado de fase (numpy.unwrap con discont = π). */
  function desenrollar(p) {
    const out = Float64Array.from(p);
    let corr = 0;
    for (let k = 1; k < p.length; k++) {
      const d = p[k] - p[k - 1];
      let dd = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      if (dd === -Math.PI && d > 0) dd = Math.PI;
      if (Math.abs(d) >= Math.PI) corr += dd - d;
      out[k] = p[k] + corr;
    }
    return out;
  }

  /** Derivada numérica (numpy.gradient con paso uniforme): centrada dentro, de primer orden en los extremos. */
  function gradiente(y, dt) {
    const n = y.length, g = new Float64Array(n);
    if (n < 2) return g;
    g[0] = (y[1] - y[0]) / dt; g[n - 1] = (y[n - 1] - y[n - 2]) / dt;
    for (let k = 1; k < n - 1; k++) g[k] = (y[k + 1] - y[k - 1]) / (2 * dt);
    return g;
  }

  /** Frecuencia instantánea [Hz] = (1/2π)·d/dt unwrap(arg(analítica(x))). */
  function frecuenciaInstantanea(x, t) {
    const z = analitica(x), ph = new Float64Array(x.length);
    for (let k = 0; k < ph.length; k++) ph[k] = Math.atan2(z.im[k], z.re[k]);
    const g = gradiente(desenrollar(ph), t[1] - t[0]);
    for (let k = 0; k < g.length; k++) g[k] /= 2 * Math.PI;
    return g;
  }

  /** Bessel J_n(x) de orden entero: J_n(x) = (1/2π)∫₀^{2π} cos(nτ − x·senτ) dτ por trapecios (exacto a precisión
   *  de máquina con M > |n| + |x| + 40 nodos, el integrando es periódico y analítico). */
  function besselJ(n, x) {
    const M = 2 * (Math.ceil(Math.abs(n) + Math.abs(x)) + 40);
    let s = 0;
    for (let k = 0; k < M; k++) { const tau = 2 * Math.PI * k / M; s += Math.cos(n * tau - x * Math.sin(tau)); }
    return s / M;
  }

  /** erfc(x): serie de Taylor de erf para |x| < 2 y fracción continua de Laplace para |x| ≥ 2
   *  (error relativo ≲ 1e-13 en todo el eje). Q(x) = ½·erfc(x/√2). */
  function erfc(x) {
    const z = Math.abs(x);
    let r;
    if (z < 2) {
      let term = z, s = z;
      for (let n = 1; n < 60; n++) { term *= -z * z / n; const d = term / (2 * n + 1); s += d; if (Math.abs(d) < 1e-17 * Math.abs(s)) break; }
      r = 1 - 2 / Math.sqrt(Math.PI) * s;
    } else {
      let K = z;
      for (let n = 80; n >= 1; n--) K = z + (n / 2) / K;
      r = Math.exp(-z * z) / (Math.sqrt(Math.PI) * K);
    }
    return x >= 0 ? r : 2 - r;
  }
  function qfunc(x) { return 0.5 * erfc(x / Math.SQRT2); }

  function _maxAbs(m) { let a = 0; for (let k = 0; k < m.length; k++) a = Math.max(a, Math.abs(m[k])); return a; }
  function _map(n, fn) { const o = new Float64Array(n); for (let k = 0; k < n; k++) o[k] = fn(k); return o; }

  // =========================================================================== (b) modulaciones
  /** Tono cos(2π f t + φ). */
  function tono(t, f, faseRad) { return _map(t.length, (k) => Math.cos(2 * Math.PI * f * t[k] + (faseRad || 0))); }

  /** DSB-AM: m(t)·c(t). */
  function dsbam(m, c) { return _map(m.length, (k) => m[k] * c[k]); }

  /** AM convencional: [1 + β·m(t)]·c(t). */
  function am(m, c, beta) { return _map(m.length, (k) => (1 + beta * m[k]) * c[k]); }

  /**
   * FM: cos(2π fc t + 2π kf ∫₀ᵗ m dτ), integral trapezoidal. kf en Hz/V.
   * Devuelve {x, I (integral), deltaF = kf·max|m|}.
   */
  function fm(t, m, fc, kf) {
    const I = integralTrapecio(m, t);
    const x = _map(t.length, (k) => Math.cos(2 * Math.PI * fc * t[k] + 2 * Math.PI * kf * I[k]));
    return { x, I, deltaF: kf * _maxAbs(m) };
  }

  /** Índice de modulación FM β_FM = Δf / f_m. */
  function betaFM(deltaF, fMensaje) { return deltaF / fMensaje; }

  /** Ancho de banda de Carson 2(Δf + f_m) = 2(β_FM + 1)·f_m [Hz]. */
  function carson(deltaF, fMensaje) { return 2 * (deltaF + fMensaje); }

  // =========================================================================== (c) demodulación AM
  /**
   * Sobremodulación: β·max|m| > 1 (equivale a min(1 + β·m) < 0 si min m = −max|m|).
   * Devuelve {indice = β·max|m|, minEnvolvente = min(1 + β·m), sobremodulada}.
   */
  function sobremodulacion(m, beta) {
    let mn = Infinity;
    for (let k = 0; k < m.length; k++) mn = Math.min(mn, 1 + beta * m[k]);
    const indice = beta * _maxAbs(m);
    return { indice, minEnvolvente: mn, sobremodulada: indice > 1 };
  }

  /**
   * Demodulación por envolvente de Hilbert: v = |analítica(x)|.
   *   correcta = (v − 1)/β  (recupera m);  guion = 2·(v − 1)/β  (fórmula del guion: devuelve 2·m).
   */
  function demodularAM(x, beta) {
    const v = envolvente(x);
    return { v, correcta: _map(v.length, (k) => (v[k] - 1) / beta), guion: _map(v.length, (k) => 2 * (v[k] - 1) / beta) };
  }

  /** Mensaje del enunciado (5.1): 1 en [0, t0/3], −2 en (t0/3, 2t0/3], 0 en el resto (corrección C.1). */
  function mensajeEnunciado(t, t0) {
    return _map(t.length, (k) => (t[k] <= t0 / 3 ? 1 : (t[k] <= 2 * t0 / 3 ? -2 : 0)));
  }

  /** Media de y sobre las muestras con a < t < b. */
  function mediaEn(y, t, a, b) {
    let s = 0, n = 0;
    for (let k = 0; k < t.length; k++) if (t[k] > a && t[k] < b) { s += y[k]; n++; }
    return n ? s / n : NaN;
  }

  // =========================================================================== casos de la P3 (con los parámetros del guion)
  const P3 = Object.freeze({ f0: 20, fc: 250, t0: 0.5, fs: 1000, betaAM: 0.85, kf: 80, fsFM: 2000 });

  /** 2.1 y 3.1: mensaje, DSB y AM (fs = 1000 Hz, t0 = 0,5 s, N = 500, Δf = 2 Hz). */
  function casoDSBAM(beta) {
    const b = beta == null ? P3.betaAM : beta;
    const t = tiempos(P3.fs, P3.t0), m = tono(t, P3.f0), c = tono(t, P3.fc);
    const xd = dsbam(m, c), xa = am(m, c, b);
    const M = xf(m, t), D = xf(xd, t), A = xf(xa, t);
    return { t, m, c, dsb: xd, am: xa, M, D, A, beta: b,
      lineas: { M20: lineaEn(M, 20), D230: lineaEn(D, 230), D250: lineaEn(D, 250), D270: lineaEn(D, 270),
        A230: lineaEn(A, 230), A250: lineaEn(A, 250), A270: lineaEn(A, 270) } };
  }

  /** 4.1: FM con kf = 80 Hz/V, fs = 2000 Hz. β_FM = 4, Carson 200 Hz, líneas en fc + n·f0 = |J_n(4)|/2. */
  function casoFM(kf) {
    const k = kf == null ? P3.kf : kf;
    const t = tiempos(P3.fsFM, P3.t0), m = tono(t, P3.f0), s = fm(t, m, P3.fc, k);
    const X = xf(s.x, t), M = xf(m, t), fi = frecuenciaInstantanea(s.x, t);
    const beta = betaFM(s.deltaF, P3.f0);
    const lin = [];
    for (let n = 0; n <= 8; n++) lin.push({ n, f: P3.fc + n * P3.f0, a: lineaEn(X, P3.fc + n * P3.f0), bessel: Math.abs(besselJ(n, beta)) / 2 });
    return { t, m, x: s.x, I: s.I, X, M, fi, deltaF: s.deltaF, betaFM: beta, carson: carson(s.deltaF, P3.f0), lineas: lin };
  }

  /** 5.1: demodulación AM del mensaje del enunciado; mesetas medidas en las ventanas de la P3 corregida. */
  function casoDemodAM(beta) {
    const b = beta == null ? P3.betaAM : beta;
    const t = tiempos(P3.fs, P3.t0), m = mensajeEnunciado(t, P3.t0), c = tono(t, P3.fc);
    const x = am(m, c, b), d = demodularAM(x, b), sm = sobremodulacion(m, b);
    const vent = [[0.03, 0.13], [0.2, 0.3], [0.37, 0.47]];
    return { t, m, x, v: d.v, correcta: d.correcta, guion: d.guion, beta: b, ...sm,
      mesetas: { nivel: [1, -2, 0], correcta: vent.map(([a, z]) => mediaEn(d.correcta, t, a, z)),
        guion: vent.map(([a, z]) => mediaEn(d.guion, t, a, z)) },
      // teoría de la meseta −2: |1 − 2β| (envolvente) → (|1 − 2β| − 1)/β
      mesetaTeorica: (Math.abs(1 - 2 * b) - 1) / b };
  }

  // =========================================================================== (d) VOR en banda base
  const VOR = Object.freeze({ beta: 0.9, kf: 480 / 30, fref: 30, fsub: 9960, fs: 100e3, T: 0.1, fCorte: 5000,
    fPortadoraRF: 114.65e6, fsRF: 250e6 });

  /** Señal VOR en banda base. o = {thetaDeg (fase del 30 Hz de la FM), phiDeg = 0 (fase de la referencia AM), fs, T}. */
  function vorBandaBase(o) {
    const p = Object.assign({}, VOR, o || {});
    const th = (p.thetaDeg || 0) * D2R, ph = (p.phiDeg || 0) * D2R;
    const t = tiempos(p.fs, p.T), w = 2 * Math.PI * p.fref;
    const s = _map(t.length, (k) => (1 + p.beta * Math.cos(w * t[k] + ph)) + Math.cos(2 * Math.PI * p.fsub * t[k] + p.kf * Math.cos(w * t[k] + th)));
    return { t, s, fs: p.fs, betaFM: p.kf, carson: 2 * (p.kf + 1) * p.fref, fsub: p.fsub, fref: p.fref };
  }

  /** Fase [°] del bin de frecuencia fref de y (DFT directa de un bin; y debe cubrir un número entero de ciclos). */
  function _faseBin(y, fs, f) {
    let r = 0, i = 0;
    for (let k = 0; k < y.length; k++) { const a = -2 * Math.PI * f * k / fs; r += y[k] * Math.cos(a); i += y[k] * Math.sin(a); }
    return Math.atan2(i, r) * R2D;
  }

  /**
   * Rumbo VOR = fase del 30 Hz de la FM − fase del 30 Hz de la AM (grados, en [0, 360)).
   *   · referencia AM: bin de 30 Hz de s(t);
   *   · FM: señal analítica de la subportadora (solo f > fCorte = 5 kHz), fase ψ(t) − 2π·fsub·t = β_FM·cos(2π·30 t + θ),
   *     y su bin de 30 Hz.
   */
  function vorRumbo(s, fs, o) {
    const p = Object.assign({}, VOR, o || {});
    const n = s.length, S = fft(s);
    const faseAM = _faseBin(s, fs, p.fref);
    for (let k = 0; k < n; k++) { // analítica de la subportadora: 2·S en f > fCorte, 0 en el resto
      const f = (k <= (n - 1) / 2 ? k : k - n) * fs / n;
      const g = f > p.fCorte ? 2 : 0;
      S.re[k] *= g; S.im[k] *= g;
    }
    const z = ifft(S), ph = new Float64Array(n);
    for (let k = 0; k < n; k++) ph[k] = Math.atan2(z.im[k], z.re[k]);
    const u = desenrollar(ph);
    let media = 0;
    for (let k = 0; k < n; k++) { u[k] -= 2 * Math.PI * p.fsub * k / fs; media += u[k]; }
    media /= n;
    for (let k = 0; k < n; k++) u[k] -= media;
    const faseFM = _faseBin(u, fs, p.fref);
    let rumbo = (faseFM - faseAM) % 360; if (rumbo < 0) rumbo += 360;
    if (rumbo > 360 - 1e-9) rumbo = 0;
    return { faseAM, faseFM, rumbo };
  }

  /** 6.1: VOR completo en banda base (fs = 100 kHz, 0,1 s, N = 10 000, Δf = 10 Hz). */
  function casoVOR(thetaDeg, phiDeg) {
    const v = vorBandaBase({ thetaDeg: thetaDeg == null ? 45 : thetaDeg, phiDeg: phiDeg || 0 });
    const X = xf(v.s, v.t), T = VOR.T;
    let pc = 0, pt = 0;
    for (let k = 0; k < X.N; k++) {
      const a2 = (X.abs[k] / T) ** 2;
      if (X.f[k] > 5000) pt += a2;
      if (X.f[k] > VOR.fsub - v.carson / 2 && X.f[k] < VOR.fsub + v.carson / 2) pc += a2;
    }
    const sub = [0, 1, 15, 16, 17].map((n) => ({ n, f: VOR.fsub + n * VOR.fref, a: lineaEn(X, VOR.fsub + n * VOR.fref, T),
      bessel: Math.abs(besselJ(n, VOR.kf)) / 2 }));
    return Object.assign(v, { X, DC: lineaEn(X, 0, T), A30: lineaEn(X, VOR.fref, T), sub, fraccionCarson: pc / pt,
      ...vorRumbo(v.s, v.fs) });
  }

  // =========================================================================== (e) enlace de telemetría (desarrollo PROPIO)
  /**
   * SNR y tasa de error de la telemetría con la pérdida de apuntamiento del haz (ServoRadar.perdidaApuntamiento().ida,
   * un solo trayecto). DESARROLLO PROPIO, no sale de la P3: modelo de libro (Lathi/Haykin), ilustrativo.
   *
   *   o = {perdidaDb (dB, ≥ 0) | perdida: {ida}, snrRefDb, modulacion: 'am' | 'fm', beta = 0,85 (AM),
   *        betaFM = 4 (FM), msq = 0,5 (potencia media del mensaje normalizado |m| ≤ 1; tono = 0,5), umbralDb = 10}
   *
   * Supuestos:
   *   · snrRefDb es γ = S_R/(N0·W) sin pérdida de apuntamiento (SNR de referencia en la banda del mensaje W);
   *     con la pérdida, γ = snrRefDb − perdidaDb (la pérdida reduce la potencia recibida, el ruido no cambia).
   *   · C/N en la banda de transmisión B_T: AM B_T = 2W; FM B_T = Carson = 2(β_FM + 1)·W. CNR = γ·W/B_T.
   *   · Umbral del detector (envolvente en AM, discriminador en FM): CNR < umbralDb (10 dB) → «bajo umbral»;
   *     en FM equivale al clásico γ_umbral = 20(β_FM + 1). Por debajo, la SNR de salida analógica no es válida.
   *   · SNR de salida analógica: AM (S/N)_D = γ·β²⟨m²⟩/(1 + β²⟨m²⟩); FM (S/N)_D = 3β_FM²⟨m²⟩·γ.
   *   · Tasa de error: datos binarios NRZ (m = ±1) a Rb = 2W, Eb/N0 = γ/2.
   *       AM con detector de envolvente (aprox. gaussiana a SNR alta): niveles A|1 ± β|, umbral en el punto medio,
   *         Pb = Q(d·√(γ/(1 + β²))), d = (|1 + β| − |1 − β|)/2 (= β si β ≤ 1; = 1 si sobremodulada).
   *       FM como FSK binaria no coherente: Pb = ½·exp(−Eb/(2N0)) por encima del umbral; por debajo se pierde la
   *         ganancia de FM y se toma Eb/N0 = CNR (modelo de umbral, deliberadamente pesimista).
   * Devuelve {gammaDb, cnrDb, bTsobreW, umbralGammaDb, bajoUmbral, snrSalidaDb, ebn0Db, ber, sobremodulada, modelo}.
   */
  function telemetria(o) {
    const per = o.perdidaDb != null ? o.perdidaDb : (o.perdida ? o.perdida.ida : 0);
    const mod = o.modulacion || 'am', umbral = o.umbralDb == null ? 10 : o.umbralDb, msq = o.msq == null ? 0.5 : o.msq;
    const gammaDb = o.snrRefDb - per, g = isFinite(gammaDb) ? Math.pow(10, gammaDb / 10) : 0;
    const db = (x) => 10 * Math.log10(x);
    let bT, snrOut, ebn0, ber, sobremodulada = false, modelo;
    if (mod === 'fm') {
      const b = o.betaFM == null ? 4 : o.betaFM;
      bT = 2 * (b + 1);
      snrOut = 3 * b * b * msq * g;
      const bajo = g / bT < Math.pow(10, umbral / 10);
      ebn0 = bajo ? g / bT : g / 2;
      ber = 0.5 * Math.exp(-ebn0 / 2);
      modelo = 'FM: FSK binaria no coherente, Pb = ½·exp(−Eb/2N0); bajo umbral, Eb/N0 = C/N';
    } else {
      const b = o.beta == null ? 0.85 : o.beta;
      bT = 2;
      sobremodulada = b > 1;
      snrOut = g * b * b * msq / (1 + b * b * msq);
      ebn0 = g / 2;
      const d = (Math.abs(1 + b) - Math.abs(1 - b)) / 2;
      ber = qfunc(d * Math.sqrt(g / (1 + b * b)));
      modelo = 'AM: detector de envolvente, Pb = Q(d·√(γ/(1+β²)))';
    }
    const cnr = g / bT;
    const umbralGammaDb = umbral + db(bT);
    return { gammaDb, cnrDb: db(cnr), bTsobreW: bT, umbralGammaDb, bajoUmbral: !(gammaDb >= umbralGammaDb),
      snrSalidaDb: db(snrOut), ebn0Db: db(ebn0), ber, sobremodulada, modelo, perdidaDb: per };
  }

  // =========================================================================== (f) modulación digital (desarrollo propio)
  /**
   * Modulaciones digitales lineales con codificación Gray (Proakis, «Digital Communications», cap. 4; Haykin):
   *   'bpsk', 'qpsk' : Pb = Q(√(2·Eb/N0))                       (exacta; QPSK = dos BPSK en cuadratura)
   *   '8psk'         : Pb ≈ (2/3)·Q(√(6·sin²(π/8)·Eb/N0))        (aproximación de vecinos más próximos, Ps/log2M)
   *   'qam16'        : Pb ≈ (3/4)·Q(√(4·Eb/(5·N0)))  = (3/8)·erfc(√(2·Eb/(5·N0)))  (Gray, SNR alta)
   */
  const MOD_DIGITAL = Object.freeze({
    bpsk: { M: 2, k: 1, nombre: 'BPSK' },
    qpsk: { M: 4, k: 2, nombre: 'QPSK' },
    '8psk': { M: 8, k: 3, nombre: '8-PSK' },
    qam16: { M: 16, k: 4, nombre: '16-QAM' }
  });
  /** Banda de referencia W_ref [Hz] en la que está definida γ_ref (la B = 1 MHz del balance de Friis del paso 4). */
  const W_REF = 1e6;
  const ROLL_OFF = 0.35;
  const BER_OBJETIVO = 1e-5;

  /** Tasa de error de bit teórica de una modulación a Eb/N0 lineal (ebn0 ≥ 0). */
  function berDigital(mod, ebn0) {
    const x = Math.max(0, ebn0);
    if (mod === 'bpsk' || mod === 'qpsk') return qfunc(Math.sqrt(2 * x));
    if (mod === '8psk') { const s = Math.sin(Math.PI / 8); return (2 / 3) * qfunc(Math.sqrt(6 * s * s * x)); }
    if (mod === 'qam16') return 0.75 * qfunc(Math.sqrt(0.8 * x));
    throw new Error('Modulación digital desconocida: ' + mod);
  }

  /** Eb/N0 [dB] que da la tasa de error `objetivo` (bisección sobre la fórmula; Pb decrece con Eb/N0). */
  function ebn0Requerido(mod, objetivo) {
    const obj = objetivo || BER_OBJETIVO;
    let a = -10, b = 40;
    for (let i = 0; i < 200 && b - a > 1e-12; i++) {
      const m = 0.5 * (a + b);
      if (berDigital(mod, Math.pow(10, m / 10)) > obj) a = m; else b = m;
    }
    return 0.5 * (a + b);
  }

  /** Generador pseudoaleatorio determinista mulberry32 (enteros de 32 bits): devuelve una función → [0, 1). */
  function mulberry32(semilla) {
    let s = semilla >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Código Gray de n: n ⊕ (n >> 1). */
  const _gray = (n) => n ^ (n >> 1);
  const _bits = (v, k) => v.toString(2).padStart(k, '0');

  /**
   * Constelación ideal con energía media por símbolo Es = 1 y etiquetas Gray: [{i, q, bits}].
   *   BPSK ±1 · QPSK (±1 ± j)/√2 · 8-PSK e^{j2πm/8} · 16-QAM {±1, ±3}/√10 por eje (Gray en cada eje).
   * Puntos vecinos difieren en un solo bit.
   */
  function constelacion(mod) {
    const d = MOD_DIGITAL[mod]; if (!d) throw new Error('Modulación digital desconocida: ' + mod);
    const out = [];
    if (mod === 'bpsk') { out.push({ i: -1, q: 0, bits: '0' }, { i: 1, q: 0, bits: '1' }); return out; }
    if (mod === 'qpsk') {
      for (const bi of [0, 1]) for (const bq of [0, 1]) out.push({ i: (2 * bi - 1) / Math.SQRT2, q: (2 * bq - 1) / Math.SQRT2, bits: `${bi}${bq}` });
      return out;
    }
    if (mod === '8psk') {
      for (let m = 0; m < 8; m++) out.push({ i: Math.cos(2 * Math.PI * m / 8), q: Math.sin(2 * Math.PI * m / 8), bits: _bits(_gray(m), 3) });
      return out;
    }
    const niv = [-3, -1, 1, 3], esc = 1 / Math.sqrt(10); // niveles por eje; Gray: 00 → −3, 01 → −1, 11 → +1, 10 → +3
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) out.push({ i: niv[a] * esc, q: niv[b] * esc, bits: _bits(_gray(a), 2) + _bits(_gray(b), 2) });
    return out;
  }

  /**
   * Nube de n símbolos recibidos con ruido gaussiano complejo a Eb/N0 (dB): símbolo equiprobable de la constelación
   * (Es = 1) + ruido de varianza N0/2 por componente, N0 = Es/(k·Eb/N0). Box–Muller sobre mulberry32(semilla):
   * mismas muestras para los mismos parámetros. Devuelve {i, q, simbolo (índice), sigma}.
   */
  function muestrasRuido(mod, ebn0Db, n, semilla) {
    const pts = constelacion(mod), k = MOD_DIGITAL[mod].k, N = n || 600;
    const g = Math.pow(10, ebn0Db / 10), sigma = isFinite(ebn0Db) && g > 0 ? Math.sqrt(1 / (2 * k * g)) : Infinity;
    const rnd = mulberry32(semilla == null ? 20261109 : semilla);
    const I = new Float64Array(N), Q = new Float64Array(N), sim = new Uint8Array(N);
    const sg = isFinite(sigma) ? sigma : 10;
    for (let j = 0; j < N; j++) {
      const s = Math.min(pts.length - 1, Math.floor(rnd() * pts.length));
      const u1 = Math.max(1e-300, rnd()), u2 = rnd(), r = Math.sqrt(-2 * Math.log(u1));
      sim[j] = s;
      I[j] = pts[s].i + sg * r * Math.cos(2 * Math.PI * u2);
      Q[j] = pts[s].q + sg * r * Math.sin(2 * Math.PI * u2); // en BPSK la componente Q es solo ruido (no afecta a la decisión)
    }
    return { i: I, q: Q, simbolo: sim, sigma };
  }

  /**
   * Enlace de telemetría digital (desarrollo propio, fórmulas de libro).
   *   o = {perdidaDb (dB, ≥ 0, un trayecto) | perdida: {ida}, snrRefDb (γ_ref), modulacion: 'bpsk' | 'qpsk' | '8psk' | 'qam16',
   *        Rb [bit/s], rollOff = 0,35, objetivo = 1e-5, nMuestras = 600, semilla}
   *
   * Relación con el modelo analógico (telemetria()): γ_ref = S_R/(N0·W_ref) es la SNR de referencia en la banda
   * W_ref = 1 MHz (la B del balance de Friis del paso 4). Con la pérdida, γ = γ_ref − L. Como Eb = S_R/Rb,
   *   Eb/N0 = γ·W_ref/Rb  →  Eb/N0 [dB] = γ_ref − L + 10·log10(W_ref/Rb).
   * El modelo analógico toma datos NRZ a Rb = 2W (Eb/N0 = γ/2): es el caso particular Rb = 2·W_ref de esta expresión.
   * Filtro de coseno alzado: Rs = Rb/log2M, banda ocupada B = Rs·(1 + α), eficiencia log2M/(1 + α) bit/s/Hz.
   * Devuelve {gammaDb, ebn0Db, esn0Db, ber, ebn0ReqDb, margenDb, Rs, anchoBanda, eficiencia, M, k, nombre,
   *   constelacion, muestras, perdidaDb, bajoUmbral (= margen < 0), modelo}.
   */
  function enlaceDigital(o) {
    const mod = o.modulacion || 'qpsk', d = MOD_DIGITAL[mod];
    if (!d) throw new Error('Modulación digital desconocida: ' + mod);
    const per = o.perdidaDb != null ? o.perdidaDb : (o.perdida ? o.perdida.ida : 0);
    const Rb = o.Rb || 1e6, alfa = o.rollOff == null ? ROLL_OFF : o.rollOff, obj = o.objetivo || BER_OBJETIVO;
    const gammaDb = o.snrRefDb - per;
    const ebn0Db = gammaDb + 10 * Math.log10(W_REF / Rb);
    const ebn0 = isFinite(ebn0Db) ? Math.pow(10, ebn0Db / 10) : 0;
    const ber = berDigital(mod, ebn0);
    const req = ebn0Requerido(mod, obj);
    const Rs = Rb / d.k;
    const out = { gammaDb, ebn0Db, esn0Db: ebn0Db + 10 * Math.log10(d.k), ber, ebn0ReqDb: req, margenDb: ebn0Db - req,
      Rb, Rs, anchoBanda: Rs * (1 + alfa), eficiencia: d.k / (1 + alfa), rollOff: alfa, M: d.M, k: d.k, nombre: d.nombre,
      objetivo: obj, perdidaDb: per, modelo: mod === '8psk' ? '8-PSK: Pb ≈ (2/3)·Q(√(6·sin²(π/8)·Eb/N0)) (aproximación Gray)'
        : mod === 'qam16' ? '16-QAM: Pb ≈ (3/4)·Q(√(4Eb/5N0)) (Gray)' : `${d.nombre}: Pb = Q(√(2Eb/N0))` };
    out.bajoUmbral = !(out.margenDb >= 0);
    out.constelacion = constelacion(mod);
    out.muestras = muestrasRuido(mod, ebn0Db, o.nMuestras || 600, o.semilla);
    return out;
  }

  return { P3, VOR, fft, ifft, frecuencias, xf, coeficientes, lineaEn, lineas, tiempos, integralTrapecio,
    analitica, envolvente, desenrollar, gradiente, frecuenciaInstantanea, besselJ, erfc, qfunc,
    tono, dsbam, am, fm, betaFM, carson, sobremodulacion, demodularAM, mensajeEnunciado, mediaEn,
    casoDSBAM, casoFM, casoDemodAM, vorBandaBase, vorRumbo, casoVOR, telemetria,
    MOD_DIGITAL, W_REF, ROLL_OFF, BER_OBJETIVO, berDigital, ebn0Requerido, mulberry32, constelacion, muestrasRuido,
    enlaceDigital };
});
