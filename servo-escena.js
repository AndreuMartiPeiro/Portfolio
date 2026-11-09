/* servo-escena.js — escena animada («Simular») de los pasos 1, 2 y 3 del proyecto «Seguimiento LEO».
 *
 * Funciona en el navegador (objeto global `window.ServoEscena`) y en Node (`module.exports`, solo la geometría pura,
 * para tests/escena.test.js).
 *
 * No hay física nueva: la escena solo dibuja, instante a instante, lo que ya calcula servo-view.js:
 *   · la pasada `pas` del paso 1 (rejilla g.tau, g.az, g.el, g.rango con interpolación de Hermite, la misma del servo);
 *   · el servo `sim` del paso 2 (error del eje sim.s.e[k] y desviación del haz sim.ep[k] en la muestra k = t/T);
 *   · el haz `hz` y la pérdida del paso 3 (la misma función perdida() de la vista y el semáforo clasificarApuntamiento).
 * Con la referencia «Rampa» el error estacionario se aplica a toda la pasada (igual que la telemetría del paso 4);
 * con «Escalón» o «Cuadrada» no hay error de apuntamiento definido y la antena se dibuja sobre la línea de vista.
 *
 * Un solo reloj (fracción de la pasada, 0…1) y un solo bucle requestAnimationFrame para los tres lienzos; el bucle se
 * para cuando no se anima nada o ningún lienzo está a la vista (IntersectionObserver). Con prefers-reduced-motion,
 * «Simular» salta al siguiente instante clave (AOS, 25 %, TCA, 75 %, LOS) sin animación continua.
 * Depuración: `?escena=0.45` en la query fija el instante relativo (en pausa) para hacer capturas.
 * Colores y fuentes: tokens de :root leídos con getComputedStyle (styles.css); ningún color escrito a mano.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ServoEscena = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const RE = 6378.137e3;                 // el mismo radio terrestre que servo-radar.js
  const VELOCIDADES = [1, 4, 16, 64];
  const SERIE_125 = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

  // =========================================================================== geometría pura (sin DOM)
  const norm360 = a => ((a % 360) + 360) % 360;

  /** Cielo polar: cenit en el centro, elevación 0 en el borde (equidistante en elevación), acimut desde el norte
   *  (arriba) en sentido horario (este a la derecha, vista desde abajo con el norte arriba). */
  function polar(azDeg, elDeg, cx, cy, radio) {
    const el = Math.max(0, Math.min(90, elDeg));
    const r = radio * (90 - el) / 90, a = azDeg * D2R;
    return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a), r };
  }

  /** Interpolación de Hermite cúbica en la rejilla uniforme de la pasada: la misma fórmula que servo-view.js. */
  function hermite(g, clave, tau) {
    const v = g[clave], d = g[clave + 'Rate'], n = v.length - 1;
    const j = Math.min(n - 1, Math.max(0, Math.floor(tau / g.dtg)));
    const h = g.dtg, s = (tau - g.tau[j]) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * v[j] + (s3 - 2 * s2 + s) * h * d[j] + (-2 * s3 + 3 * s2) * v[j + 1] + (s3 - s2) * h * d[j + 1];
  }
  /** Interpolación lineal en la rejilla (para el rango, que no tiene derivada en la rejilla). */
  function lineal(g, clave, tau) {
    const v = g[clave], n = v.length - 1;
    const j = Math.min(n - 1, Math.max(0, Math.floor(tau / g.dtg)));
    const s = Math.min(1, Math.max(0, (tau - g.tau[j]) / g.dtg));
    return v[j] + (v[j + 1] - v[j]) * s;
  }

  /** Posición local este-norte-cenit [m] a partir de acimut, elevación [°] y rango [m]. */
  function enu(azDeg, elDeg, rango) {
    const a = azDeg * D2R, e = elDeg * D2R, h = rango * Math.cos(e);
    return { e: h * Math.sin(a), n: h * Math.cos(a), u: rango * Math.sin(e) };
  }
  /** Dirección horizontal unitaria (este, norte) del AOS al LOS: el plano vertical de la vista lateral. */
  function direccionTraza(g) {
    const n = g.az.length - 1;
    const p0 = enu(g.az[0], g.el[0], g.rango[0]), p1 = enu(g.az[n], g.el[n], g.rango[n]);
    let de = p1.e - p0.e, dn = p1.n - p0.n;
    const m = Math.hypot(de, dn);
    if (m < 1e-6) { de = Math.sin(g.az[0] * D2R); dn = Math.cos(g.az[0] * D2R); return { e: de, n: dn }; }
    return { e: de / m, n: dn / m };
  }
  /** Vista lateral: proyección sobre el plano vertical que contiene la estación, el centro de la Tierra y la
   *  dirección AOS → LOS. x: distancia horizontal a lo largo de la traza [m]; y: altura sobre el plano tangente de la
   *  estación [m]. La estación está en (0, 0) y el centro de la Tierra en (0, −RE). Misma escala en los dos ejes. */
  function lateral(azDeg, elDeg, rango, dir) {
    const p = enu(azDeg, elDeg, rango);
    return { x: p.e * dir.e + p.n * dir.n, y: p.u };
  }
  /** Superficie terrestre en la vista lateral: altura (negativa) del suelo a la distancia horizontal x [m]. */
  function suelo(x) { return Math.sqrt(Math.max(0, RE * RE - x * x)) - RE; }

  /** Ángulo [°] entre dos direcciones dadas por acimut y elevación (arco de círculo máximo, fórmula del haversine).
   *  Con la misma elevación da sin(γ/2) = cos(el)·sin(Δaz/2), la proyección que usa servo-view.js para el haz. */
  function desviacionHaz(az1, el1, az2, el2) {
    const p1 = el1 * D2R, p2 = el2 * D2R, dl = (az2 - az1) * D2R;
    const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * R2D;
  }

  /** Factor de ampliación del dibujo (serie 1-2-5): el mayor N con errMax·N ≤ objetivo; 1 si no hace falta. */
  function factorAmpliacion(errMaxDeg, objetivoDeg) {
    if (!(errMaxDeg > 0) || !isFinite(errMaxDeg) || errMaxDeg >= objetivoDeg) return 1;
    let N = 1;
    for (const k of SERIE_125) if (errMaxDeg * k <= objetivoDeg) N = k;
    return N;
  }
  /** Semiángulo dibujado del cono a −3 dB con la escala angular K: (θ3dB/2)·K [°]. */
  function semiConoDibujo(hpbwDeg, K) { return hpbwDeg / 2 * K; }
  /** ¿Está el satélite dentro del cono a −3 dB? (desviación ≤ θ3dB/2, el límite «degradado / fuera» del semáforo). */
  function dentroDelCono(desvDeg, hpbwDeg) { return Math.abs(desvDeg) <= hpbwDeg / 2; }

  /** Instantes clave de la pasada en fracción de su duración: AOS, 25 %, TCA, 75 %, LOS. */
  function instantesClave(dur, tca) {
    const fT = dur > 0 && isFinite(tca) ? Math.min(1, Math.max(0, tca / dur)) : 0.5;
    return [{ frac: 0, nombre: 'AOS' }, { frac: 0.25, nombre: '25 %' }, { frac: fT, nombre: 'TCA' },
      { frac: 0.75, nombre: '75 %' }, { frac: 1, nombre: 'LOS' }].sort((a, b) => a.frac - b.frac);
  }
  /** Índice del primer instante clave posterior a `frac`; tras el LOS vuelve al AOS. */
  function siguienteInstante(frac, lista) {
    for (let i = 0; i < lista.length; i++) if (lista[i].frac > frac + 1e-6) return i;
    return 0;
  }
  /** Velocidad (de las opciones) con la que la pasada dura más cerca de `objetivo` segundos (en escala logarítmica). */
  function velocidadPorDefecto(dur, objetivo, opciones) {
    const ops = opciones || VELOCIDADES, obj = objetivo || 12;
    if (!(dur > 0)) return ops[ops.length - 1];
    let mejor = ops[0], dMin = Infinity;
    for (const v of ops) { const d = Math.abs(Math.log(dur / v / obj)); if (d < dMin) { dMin = d; mejor = v; } }
    return mejor;
  }
  /** Muestra del servo para el instante t [s] desde el AOS: k = round(t/T), acotada a la simulación. */
  function indiceServo(sim, t) { return Math.min(sim.s.N - 1, Math.max(0, Math.round(t / sim.T))); }

  /**
   * Estado de la escena en el instante t [s] desde el AOS con los datos de servo-view.js
   *   d = {pas, sim, hz, L, ref, eje, perdida(errDeg) → {ida}, clasificar(errDeg, hpbw) → 'dentro'|'degradado'|'fuera'}
   * Devuelve los ángulos del satélite y de la antena, el error del eje y la desviación del haz [°], la pérdida de ida
   * [dB] y el semáforo de ese instante. `modo`: 'pasada' | 'rampa' | 'na' | 'inestable' | 'sinpasada'.
   */
  function estadoInstante(d, t) {
    const pas = d && d.pas;
    if (!pas) return { modo: 'sinpasada', t: 0, frac: 0 };
    const g = pas.g, tt = Math.min(pas.dur, Math.max(0, t));
    const az = hermite(g, 'az', tt), el = hermite(g, 'el', tt), rango = lineal(g, 'rango', tt);
    const o = { t: tt, frac: pas.dur > 0 ? tt / pas.dur : 0, az: norm360(az), el, rango, azAnt: norm360(az), elAnt: el,
      errEje: null, signo: 1, ejeErr: null, desv: null, perdIda: null, clase: 'na', modo: 'na' };
    const sim = d.sim;
    if (!sim) return o;
    if (sim.diverge) {
      o.modo = 'inestable'; o.azAnt = norm360(g.az[0]); o.elAnt = g.el[0];
      o.desv = Infinity; o.perdIda = Infinity; o.clase = 'fuera';
      return o;
    }
    if (d.ref === 'pasada' && sim.ep) {
      const k = indiceServo(sim, tt), e = sim.s.e[k] * R2D;     // e = r − y: la antena va por detrás en e
      o.modo = 'pasada'; o.ejeErr = d.eje; o.errEje = e; o.signo = e < 0 ? -1 : 1;
      o.desv = sim.ep[k] * R2D;
      if (d.eje === 'el') o.elAnt = el - e; else o.azAnt = norm360(az - e);
    } else if (d.ref === 'rampa' && sim.errDeg != null && isFinite(sim.errDeg)) {
      // error estacionario de la rampa, constante en toda la pasada (como en el paso 3 y en la telemetría del paso 4)
      o.modo = 'rampa'; o.ejeErr = 'el'; o.errEje = sim.errDeg; o.desv = sim.errDeg; o.elAnt = el - sim.errDeg;
    } else return o;
    o.perdIda = d.perdida ? d.perdida(o.desv).ida : null;
    o.clase = d.clasificar && d.hz ? d.clasificar(o.desv, d.hz.hpbw) : 'na';
    return o;
  }

  const geometria = { polar, hermite, lineal, enu, direccionTraza, lateral, suelo, desviacionHaz, factorAmpliacion,
    semiConoDibujo, dentroDelCono, instantesClave, siguienteInstante, velocidadPorDefecto, indiceServo, estadoInstante,
    norm360, RE, VELOCIDADES };
  if (typeof window === 'undefined' || typeof document === 'undefined') return geometria;

  // =========================================================================== formato (como servo-view.js)
  const fmt = (x, dd = 0) => {
    if (x == null || Number.isNaN(x)) return '—';
    if (!isFinite(x)) return x > 0 ? '∞' : '−∞';
    const [ent, dec] = Math.abs(x).toFixed(dd).split('.');
    return (x < 0 && +x.toFixed(dd) !== 0 ? '−' : '') + ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dec ? ',' + dec : '');
  };
  /** Cifras con tres significativas al menos (errores de 0,0004° no se quedan en «0,000°»). */
  const fmtAng = x => {
    if (x == null || !isFinite(x)) return fmt(x);
    const a = Math.abs(x);
    return fmt(x, a >= 10 ? 2 : a >= 0.1 ? 3 : a >= 0.001 ? 4 : 6);
  };
  const ESTADO_LBL = { dentro: 'Dentro del haz', degradado: 'Degradado', fuera: 'Fuera del semihaz', na: 'No aplica' };

  // =========================================================================== estado
  const est = {
    frac: 0, jugando: false, velUsuario: null, velAuto: 64, datos: null, deriv: null,
    escenas: [], raf: 0, ultimo: 0, visibles: new Set(), io: null, ro: null, c: null, root: null, ariaTs: 0
  };
  const reducido = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const vel = () => est.velUsuario || est.velAuto;
  const dur = () => (est.datos && est.datos.pas ? est.datos.pas.dur : 0);

  function leerColores() {
    const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
    est.c = { text: v('--text'), text2: v('--text-2'), text3: v('--text-3'), line: v('--line'), lineStrong: v('--line-strong'),
      accent: v('--accent'), accentSoft: v('--accent-soft'), accentLine: v('--accent-line'), tertiary: v('--tertiary'),
      tertiaryLine: v('--tertiary-line'), warn: v('--warn'), raised: v('--bg-raised'), elevated: v('--bg-elevated'),
      mono: v('--font-mono') || 'monospace', body: v('--font-body') || 'sans-serif' };
  }

  // =========================================================================== plantilla
  const TITULOS = { 1: 'Vista de la pasada', 2: 'Vista del pedestal', 3: 'Vista del haz' };
  const NOTAS = {
    1: 'Cielo de la estación y corte vertical a escala real',
    2: 'Ángulos del servo del paso 2 en cada instante',
    3: 'Desviación del haz frente al ancho a −3 dB y pérdida instantánea'
  };
  function plantilla(n) {
    return `
            <div class="servo-escena reveal" data-escena-bloque="${n}">
              <div class="servo-escena-head">
                <span class="servo-lbl">${TITULOS[n]}</span>
                <span class="servo-escena-nota">${NOTAS[n]} · reloj compartido con los pasos 1, 2 y 3</span>
              </div>
              <div class="servo-escena-lienzo"><canvas data-escena="${n}" role="img" aria-label="${TITULOS[n]}"></canvas></div>
              <div class="servo-escena-ctrl">
                <button type="button" class="btn ghost servo-escena-play" data-esc-accion="play" aria-pressed="false">Simular</button>
                <div class="servo-seg servo-escena-vel" role="group" aria-label="Velocidad de la simulación">
                  ${VELOCIDADES.map(v => `<button type="button" data-esc-vel="${v}" aria-pressed="false" aria-label="Velocidad ${v} veces el tiempo real">${v}×</button>`).join('')}
                </div>
                <label class="servo-escena-tiempo">
                  <span class="servo-lbl">Tiempo</span>
                  <input type="range" class="custom-range" min="0" max="1000" step="1" value="0" data-esc-t aria-label="Instante de la pasada (${TITULOS[n].toLowerCase()})" />
                </label>
                <output class="servo-escena-lect" data-esc-lect>t = 0 s · el = —</output>
              </div>
            </div>`;
  }

  // =========================================================================== conexión con la vista
  function conectar(rootEl) {
    desconectar();
    est.root = rootEl;
    leerColores();
    est.escenas = [...rootEl.querySelectorAll('canvas[data-escena]')].map(cv => ({
      n: +cv.dataset.escena, cv, ctx: cv.getContext('2d'), bloque: cv.closest('[data-escena-bloque]'), W: 0, H: 0, sucio: true
    }));
    if (!est.escenas.length) return;
    if ('IntersectionObserver' in window) {
      est.io = new IntersectionObserver(ents => {
        est.ioListo = true;
        ents.forEach(en => {
          const e = est.escenas.find(x => x.cv === en.target); if (!e) return;
          if (en.isIntersecting) { est.visibles.add(e); if (e.sucio) pintar(e); } else est.visibles.delete(e);
        });
        if (est.jugando && !est.raf && est.visibles.size) { est.ultimo = 0; est.raf = requestAnimationFrame(tick); }
      }, { rootMargin: '80px 0px' });
      est.escenas.forEach(e => est.io.observe(e.cv));
    } else est.escenas.forEach(e => est.visibles.add(e));
    if (typeof ResizeObserver !== 'undefined') {
      est.ro = new ResizeObserver(ents => ents.forEach(en => {
        const e = est.escenas.find(x => x.cv.parentElement === en.target); if (e) { e.sucio = true; if (aLaVista(e)) pintar(e); }
      }));
      est.escenas.forEach(e => est.ro.observe(e.cv.parentElement));
    }
    rootEl.addEventListener('click', alClic);
    rootEl.addEventListener('input', alDeslizar);
    // Depuración / capturas: ?escena=0.45 fija el instante relativo y deja la animación en pausa
    const m = /[?&]escena=([0-9.]+)/.exec(window.location.search);
    if (m) { est.frac = Math.min(1, Math.max(0, parseFloat(m[1]) || 0)); est.jugando = false; }
  }
  function desconectar() {
    if (est.raf) cancelAnimationFrame(est.raf);
    est.raf = 0; est.jugando = false; est.ultimo = 0;
    if (est.io) est.io.disconnect(); if (est.ro) est.ro.disconnect();
    est.io = est.ro = null; est.visibles.clear(); est.ioListo = false;
    if (est.root) { est.root.removeEventListener('click', alClic); est.root.removeEventListener('input', alDeslizar); }
    est.root = null; est.escenas = [];
  }

  function alClic(ev) {
    const b = ev.target.closest('[data-esc-accion], [data-esc-vel]');
    if (!b || !est.root.contains(b)) return;
    if (b.dataset.escVel) { est.velUsuario = +b.dataset.escVel; est.ultimo = 0; pintarControles(); return; }
    if (!est.datos || !est.datos.pas) return;
    if (reducido()) {
      // Sin animación continua: salto al siguiente instante clave
      const lista = est.deriv.claves;
      est.jugando = false;
      est.frac = lista[siguienteInstante(est.frac, lista)].frac;
      pintarTodo(true);
      return;
    }
    est.jugando = !est.jugando;
    if (est.jugando) {
      if (est.frac >= 1) est.frac = 0;
      est.ultimo = 0;
      if (!est.raf) est.raf = requestAnimationFrame(tick);
    }
    pintarTodo(true);
  }
  function alDeslizar(ev) {
    if (!ev.target.matches('[data-esc-t]')) return;
    est.frac = Math.min(1, Math.max(0, +ev.target.value / 1000));
    est.ultimo = 0;
    pintarTodo(true);
  }

  function tick(ts) {
    est.raf = 0;
    if (!est.jugando) return;
    if (!est.escenas.length || !est.escenas[0].cv.isConnected) { desconectar(); return; }
    const dt = est.ultimo ? Math.min(0.1, (ts - est.ultimo) / 1000) : 0;
    est.ultimo = ts;
    const D = dur();
    if (D > 0) { est.frac += dt * vel() / D; if (est.frac >= 1) est.frac %= 1; }   // al llegar al LOS vuelve al AOS
    pintarTodo(ts - est.ariaTs > 1000, true);
    if (est.visibles.size || !est.ioListo) est.raf = requestAnimationFrame(tick);
    else est.ultimo = 0;     // nada a la vista: el bucle se para y se reanuda al volver a verse
  }

  /** Datos nuevos de servo-view.js (misión, servo o escenario): se redibuja conservando la fracción de la pasada. */
  function actualizar(datos) {
    est.datos = datos;
    leerColores();
    const pas = datos && datos.pas;
    est.deriv = null;
    if (pas) {
      const g = pas.g, dir = direccionTraza(g), n = g.tau.length;
      const paso = Math.max(1, Math.floor(n / 600));
      const traza = [];
      for (let j = 0; j < n; j += paso) traza.push({ tau: g.tau[j], az: norm360(g.az[j]), el: g.el[j], lat: lateral(g.az[j], g.el[j], g.rango[j], dir) });
      if (traza[traza.length - 1].tau !== g.tau[n - 1]) {
        const j = n - 1; traza.push({ tau: g.tau[j], az: norm360(g.az[j]), el: g.el[j], lat: lateral(g.az[j], g.el[j], g.rango[j], dir) });
      }
      const sim = datos.sim, enPasada = datos.ref === 'pasada' && sim && sim.ep && !sim.diverge;
      const errEjeMax = enPasada ? sim.eEjeMax * R2D : (sim && isFinite(sim.errDeg) ? sim.errDeg : 0);
      const desvMax = enPasada ? sim.eMax * R2D : (sim && isFinite(sim.errDeg) ? sim.errDeg : 0);
      est.deriv = {
        dir, traza, claves: instantesClave(pas.dur, pas.tca),
        nPed: factorAmpliacion(errEjeMax, 30),
        desvMax, errEjeMax,
        lim4: datos.hz && datos.perdida ? datos.perdida(datos.hz.hpbw / 4).ida : null,
        lim2: datos.hz && datos.perdida ? datos.perdida(datos.hz.hpbw / 2).ida : null
      };
      est.velAuto = velocidadPorDefecto(pas.dur, 12);
    }
    est.escenas.forEach(e => { e.sucio = true; });
    pintarTodo(true);
  }

  // =========================================================================== pintado
  /** Mientras el observador no haya informado (o no exista) se considera todo a la vista. */
  const aLaVista = e => !est.io || !est.ioListo || est.visibles.has(e);
  /** `animando`: fotograma del bucle; solo entonces se saltan los lienzos fuera de la pantalla (los redibujos por
   *  datos nuevos o por la barra de tiempo son puntuales y pintan los tres). */
  function pintarTodo(aria, animando) {
    const s = est.datos ? estadoInstante(est.datos, est.frac * dur()) : null;
    est.escenas.forEach(e => { if (!animando || aLaVista(e)) pintar(e, s, aria); else e.sucio = true; });
    pintarControles(s);
    if (aria) est.ariaTs = performance.now();
  }

  function pintarControles(s) {
    if (!est.root) return;
    if (!s && est.datos) s = estadoInstante(est.datos, est.frac * dur());
    const sinPasada = !est.datos || !est.datos.pas, red = reducido();
    est.root.querySelectorAll('[data-esc-accion="play"]').forEach(b => {
      b.disabled = sinPasada;
      if (red) {
        const lista = est.deriv ? est.deriv.claves : [];
        const sig = lista.length ? lista[siguienteInstante(est.frac, lista)].nombre : '';
        b.textContent = 'Simular';
        b.setAttribute('aria-label', sig ? `Saltar al siguiente instante de la pasada: ${sig}` : 'Simular');
        b.setAttribute('aria-pressed', 'false');
      } else {
        b.textContent = est.jugando ? 'Pausar' : 'Simular';
        b.setAttribute('aria-label', est.jugando ? 'Pausar la simulación de la pasada' : 'Simular la pasada');
        b.setAttribute('aria-pressed', String(est.jugando));
      }
    });
    est.root.querySelectorAll('[data-esc-vel]').forEach(b => {
      const on = +b.dataset.escVel === vel();
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
      b.disabled = sinPasada;
    });
    const tx = s && s.modo !== 'sinpasada' ? `t = ${fmt(s.t)} s · el = ${fmt(s.el, 1)}°` : 'Sin pasada visible';
    est.root.querySelectorAll('[data-esc-t]').forEach(inp => {
      const v = Math.round(est.frac * 1000);
      if (document.activeElement !== inp || est.jugando) inp.value = v;
      inp.disabled = sinPasada;
      inp.setAttribute('aria-valuetext', s && s.modo !== 'sinpasada' ? `${tx} de ${fmt(dur())} s` : tx);
    });
    est.root.querySelectorAll('[data-esc-lect]').forEach(o => { o.textContent = tx; });
  }

  function ajustar(e) {
    const p = e.cv.parentElement, dpr = Math.min(3, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(p.clientWidth)), H = Math.max(1, Math.round(p.clientHeight));
    if (W !== e.W || H !== e.H || e.dpr !== dpr) {
      e.W = W; e.H = H; e.dpr = dpr;
      e.cv.width = Math.round(W * dpr); e.cv.height = Math.round(H * dpr);
    }
    e.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function pintar(e, s, aria) {
    if (!est.c) leerColores();
    ajustar(e);
    const ctx = e.ctx, W = e.W, H = e.H;
    ctx.clearRect(0, 0, W, H);
    e.sucio = false;
    if (!est.datos || W < 240 || H < 220) return;     // lienzo aún sin maquetar (o demasiado pequeño para dibujar)
    if (!s) s = estadoInstante(est.datos, est.frac * dur());
    if (s.modo === 'sinpasada') {
      texto(ctx, 'Sin pasada visible con estos parámetros del panel de misión.', W / 2, H / 2, { size: 12, color: est.c.text2, align: 'center' });
      if (aria !== false) e.cv.setAttribute('aria-label', `${TITULOS[e.n]}: sin pasada visible con estos parámetros.`);
      return;
    }
    let lbl = '';
    if (e.n === 1) lbl = escenaPasada(ctx, W, H, s);
    else if (e.n === 2) lbl = escenaPedestal(ctx, W, H, s);
    else lbl = escenaHaz(ctx, W, H, s);
    if (aria !== false) e.cv.setAttribute('aria-label', lbl);
  }

  // ---------------------------------------------------------------- utilidades de dibujo
  function texto(ctx, t, x, y, o) {
    o = o || {};
    ctx.font = `${o.weight || 400} ${o.size || 11}px ${o.mono === false ? est.c.body : est.c.mono}`;
    ctx.fillStyle = o.color || est.c.text2;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.base || 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = o.ls || '0px';
    ctx.fillText(t, x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    return ctx.measureText(t).width;
  }
  const etiqueta = (ctx, t, x, y, o) => texto(ctx, t.toUpperCase(), x, y, Object.assign({ size: 11, color: est.c.text2, ls: '0.08em' }, o));
  function linea(ctx, x0, y0, x1, y1, color, w, dash) {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    ctx.strokeStyle = color; ctx.lineWidth = w || 1; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
  }
  function punto(ctx, x, y, r, color) { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill(); }
  /** Caja de lectura (fondo elevado, borde de 1 px) con varias líneas mono, acotada al rectángulo [bx0, bx1]×[by0, by1]. */
  function caja(ctx, lineas, x, y, lado, lim) {
    ctx.font = `400 11px ${est.c.mono}`;
    const w = Math.ceil(Math.max(...lineas.map(l => ctx.measureText(l.t).width))) + 14, h = lineas.length * 15 + 8;
    let bx = lado > 0 ? x + 10 : x - 10 - w;
    if (bx + w > lim.x1) bx = x - 10 - w;
    if (bx < lim.x0) bx = x + 10;
    let by = Math.min(lim.y1 - h, Math.max(lim.y0, y - h / 2));
    bx = Math.round(bx) + 0.5; by = Math.round(by) + 0.5;
    ctx.fillStyle = est.c.elevated; ctx.fillRect(bx, by, w, h);
    ctx.strokeStyle = est.c.lineStrong; ctx.lineWidth = 1; ctx.strokeRect(bx, by, w, h);
    lineas.forEach((l, i) => texto(ctx, l.t, bx + 7, by + 4 + 7.5 + i * 15, { color: l.color || est.c.text }));
  }
  const colorClase = cl => (cl === 'fuera' ? est.c.accent : cl === 'degradado' ? est.c.warn : cl === 'dentro' ? est.c.tertiary : est.c.text3);

  // ---------------------------------------------------------------- 1 · Pasada
  function escenaPasada(ctx, W, H, s) {
    const c = est.c, dv = est.deriv, pas = est.datos.pas, movil = W < 560;
    // Distribución: cielo polar a la izquierda (cuadrado) y corte lateral a la derecha; en móvil, uno encima del otro
    let P, Lr;
    if (!movil) {
      const lado = Math.min(H, W * 0.46);
      P = { cx: lado / 2 + 8, cy: H / 2 + 4, R: lado / 2 - 40, x0: 0, x1: lado + 8 };
      Lr = { x0: lado + 36, x1: W - 18, y0: 40, y1: H - 18 };
    } else {
      const R = Math.min(W * 0.6 / 2 - 24, H * 0.22);
      P = { cx: R + 28, cy: R + 44, R, x0: 0, x1: 2 * R + 56 };
      Lr = { x0: 12, x1: W - 12, y0: P.cy + R + 58, y1: H - 8 };
    }
    // --- cielo
    etiqueta(ctx, 'Cielo · cenit en el centro', 14, 16);
    ctx.lineWidth = 1;
    [0, 30, 60].forEach(e => {
      ctx.beginPath(); ctx.arc(P.cx, P.cy, P.R * (90 - e) / 90, 0, 2 * Math.PI);
      ctx.strokeStyle = e === 0 ? c.lineStrong : c.line; ctx.stroke();
    });
    ctx.beginPath(); ctx.arc(P.cx, P.cy, P.R * (90 - 5) / 90, 0, 2 * Math.PI);
    ctx.setLineDash([3, 3]); ctx.strokeStyle = c.lineStrong; ctx.stroke(); ctx.setLineDash([]);
    linea(ctx, P.cx - P.R, P.cy, P.cx + P.R, P.cy, c.line);
    linea(ctx, P.cx, P.cy - P.R, P.cx, P.cy + P.R, c.line);
    [['N', 0], ['E', 90], ['S', 180], ['O', 270]].forEach(([t, a]) => {
      const r = P.R + 12;
      texto(ctx, t, P.cx + r * Math.sin(a * D2R), P.cy - r * Math.cos(a * D2R), { color: c.text2, align: 'center' });
    });
    // rótulos de 30° y 60° sobre el eje este-oeste, en la mitad del cielo por la que no pasa la traza
    const ladoEste = dv.traza.reduce((m, p) => m + Math.sin(p.az * D2R), 0) > 0, sx0 = ladoEste ? -1 : 1;
    if (P.R >= 75) [30, 60].forEach(e => texto(ctx, `${e}°`, P.cx + sx0 * (P.R * (90 - e) / 90 - 3), P.cy - 8, { color: c.text2, size: 11, align: ladoEste ? 'left' : 'right' }));
    if (!movil) {
      linea(ctx, 14, H - 30, 34, H - 30, c.lineStrong, 1, [3, 3]);
      texto(ctx, 'máscara', 40, H - 30, { color: c.text2 });
      texto(ctx, 'de 5°', 40, H - 15, { color: c.text2 });
    }
    // traza completa (gris fino) y recorrida (naranja)
    const tr = dv.traza, tPas = s.t;
    ctx.beginPath();
    tr.forEach((p, i) => { const q = polar(p.az, p.el, P.cx, P.cy, P.R); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
    ctx.strokeStyle = c.text3; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath();
    let iu = 0;
    for (let i = 0; i < tr.length && tr[i].tau <= tPas; i++) { const q = polar(tr[i].az, tr[i].el, P.cx, P.cy, P.R); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); iu = i; }
    const qs = polar(s.az, s.el, P.cx, P.cy, P.R);
    if (iu >= 0) ctx.lineTo(qs.x, qs.y);
    ctx.strokeStyle = c.accent; ctx.lineWidth = 1.5; ctx.stroke();
    const q0 = polar(tr[0].az, tr[0].el, P.cx, P.cy, P.R), q1 = polar(tr[tr.length - 1].az, tr[tr.length - 1].el, P.cx, P.cy, P.R);
    // AOS / LOS hacia dentro del círculo (fuera chocarían con N, E, S, O)
    const fuera = (q, t) => { const dx = P.cx - q.x, dy = P.cy - q.y, m = Math.hypot(dx, dy) || 1; texto(ctx, t, q.x + dx / m * 16, q.y + dy / m * 16, { color: c.text2, align: 'center' }); };
    punto(ctx, q0.x, q0.y, 2, c.text2); punto(ctx, q1.x, q1.y, 2, c.text2);
    fuera(q0, 'AOS'); fuera(q1, 'LOS');
    punto(ctx, qs.x, qs.y, 4.5, c.accent);
    if (!movil) caja(ctx, [{ t: `el ${fmt(s.el, 1)}°` }, { t: `az ${fmt(s.az, 1)}°` }, { t: `${fmt(s.rango / 1e3)} km` }],
      qs.x, qs.y, qs.x < P.cx ? 1 : -1, { x0: 4, x1: P.x1 - 4, y0: 26, y1: H - 26 });
    else [['Elevación', `${fmt(s.el, 1)}°`], ['Acimut', `${fmt(s.az, 1)}°`], ['Rango', `${fmt(s.rango / 1e3)} km`]].forEach(([l, v], i) => {
      etiqueta(ctx, l, P.x1 + 6, P.cy - P.R + 10 + i * 44);
      texto(ctx, v, P.x1 + 6, P.cy - P.R + 28 + i * 44, { color: c.text, size: 13, weight: 500 });
    });

    // --- corte lateral a escala real
    etiqueta(ctx, 'Corte vertical · escala real', Lr.x0, movil ? Lr.y0 - 24 : 16);
    const xs = tr.map(p => p.lat.x), ys = tr.map(p => p.lat.y);
    const xMin = Math.min(0, ...xs), xMax = Math.max(0, ...xs), yMax = Math.max(...ys);
    const yMin = Math.min(suelo(xMin), suelo(xMax));
    const sx = (Lr.x1 - Lr.x0) / ((xMax - xMin) * 1.08), sy = (Lr.y1 - Lr.y0) / ((yMax - yMin) * 1.12);
    const k = Math.min(sx, sy);
    const ox = (Lr.x0 + Lr.x1) / 2 - k * (xMin + xMax) / 2, oy = (Lr.y0 + Lr.y1) / 2 + k * (yMin + yMax) / 2;
    const X = x => ox + k * x, Y = y => oy - k * y;
    ctx.save();
    ctx.beginPath(); ctx.rect(Lr.x0 - 8, Lr.y0 - 8, Lr.x1 - Lr.x0 + 16, Lr.y1 - Lr.y0 + 16); ctx.clip();
    ctx.beginPath(); ctx.arc(X(0), Y(-RE), RE * k, 0, 2 * Math.PI);
    ctx.fillStyle = c.elevated; ctx.fill(); ctx.strokeStyle = c.lineStrong; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
    // horizonte local de la estación
    linea(ctx, X(0) - 70, Y(0), X(0) + 70, Y(0), c.lineStrong, 1, [3, 3]);
    // trayectoria proyectada
    ctx.beginPath();
    tr.forEach((p, i) => { if (i) ctx.lineTo(X(p.lat.x), Y(p.lat.y)); else ctx.moveTo(X(p.lat.x), Y(p.lat.y)); });
    ctx.strokeStyle = c.text3; ctx.lineWidth = 1; ctx.stroke();
    const ls = lateral(s.az, s.el, s.rango, dv.dir);
    ctx.beginPath();
    for (let i = 0; i < tr.length && tr[i].tau <= tPas; i++) { const p = tr[i]; if (i) ctx.lineTo(X(p.lat.x), Y(p.lat.y)); else ctx.moveTo(X(p.lat.x), Y(p.lat.y)); }
    ctx.lineTo(X(ls.x), Y(ls.y));
    ctx.strokeStyle = c.accent; ctx.lineWidth = 1.5; ctx.stroke();
    // línea de vista
    linea(ctx, X(0), Y(0), X(ls.x), Y(ls.y), c.text2, 1);
    // estación
    ctx.beginPath(); ctx.moveTo(X(0), Y(0) - 7); ctx.lineTo(X(0) - 5, Y(0)); ctx.lineTo(X(0) + 5, Y(0)); ctx.closePath();
    ctx.fillStyle = c.text; ctx.fill();
    texto(ctx, 'estación', X(0), Y(0) + 12, { color: c.text2, align: 'center' });
    punto(ctx, X(ls.x), Y(ls.y), 4.5, c.accent);
    // rango junto a la línea de vista y altitud en el punto más alto
    const mx = (X(0) + X(ls.x)) / 2, my = (Y(0) + Y(ls.y)) / 2;
    const ang = Math.atan2(Y(ls.y) - Y(0), X(ls.x) - X(0));
    const nx = -Math.sin(ang), ny = Math.cos(ang), lado = ny > 0 ? -1 : 1;
    const ox2 = nx * 14 * lado, oy2 = ny * 14 * lado;
    texto(ctx, `ρ = ${fmt(s.rango / 1e3)} km`, mx + ox2, my + oy2, { color: c.text, align: ox2 >= 0 ? 'left' : 'right' });
    // barra de escala (misma escala en horizontal y en vertical)
    const kmBarra = [200, 500, 1000, 2000].find(v => v * 1e3 * k >= 50) || 2000, wb = kmBarra * 1e3 * k;
    const bx1 = Lr.x1 - 4, by = Lr.y1 - 10;
    linea(ctx, bx1 - wb, by, bx1, by, c.text2, 1);
    linea(ctx, bx1 - wb, by - 4, bx1 - wb, by + 4, c.text2, 1); linea(ctx, bx1, by - 4, bx1, by + 4, c.text2, 1);
    texto(ctx, `${fmt(kmBarra)} km`, bx1 - wb / 2, by - 11, { color: c.text2, align: 'center' });
    const iTop = ys.indexOf(yMax);
    texto(ctx, movil ? `h = ${fmt(est.datos.hKm)} km` : `traza a ${fmt(est.datos.hKm)} km de altitud`, X(xs[iTop]), Y(yMax) - 12, { color: c.text2, align: 'center' });
    return `Vista de la pasada en t = ${fmt(s.t)} s de ${fmt(pas.dur)} s: satélite a ${fmt(s.el, 1)}° de elevación, `
      + `${fmt(s.az, 1)}° de acimut y ${fmt(s.rango / 1e3)} km de rango; elevación máxima ${fmt(pas.elMax, 1)}° en el TCA.`;
  }

  // ---------------------------------------------------------------- 2 · Pedestal
  function parabola(ctx, px, py, angDeg, a, prof, c) {
    // Reflector de perfil: vértice detrás del pivote, abertura hacia la dirección del haz
    const ca = Math.cos(angDeg * D2R), sa = Math.sin(angDeg * D2R);
    const P = (u, v) => ({ x: px + u * ca - v * sa, y: py - (u * sa + v * ca) });
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) { const v = -a + 2 * a * i / 24, u = prof * (v / a) ** 2 - prof * 0.35; const q = P(u, v); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }
    ctx.strokeStyle = c.text; ctx.lineWidth = 1.5; ctx.stroke();
    const foco = P(a * a / (4 * prof) - prof * 0.35, 0), r1 = P(prof * 0.65, a), r2 = P(prof * 0.65, -a);
    linea(ctx, r1.x, r1.y, foco.x, foco.y, c.text2, 1); linea(ctx, r2.x, r2.y, foco.x, foco.y, c.text2, 1);
    ctx.fillStyle = c.text; ctx.fillRect(foco.x - 2.5, foco.y - 2.5, 5, 5);
  }
  function arco(ctx, cx, cy, r, a0, a1, color, w) {
    // ángulos en convención matemática (antihorario, grados) sobre el lienzo con y hacia abajo
    ctx.beginPath(); ctx.arc(cx, cy, r, -a0 * D2R, -a1 * D2R, a1 > a0);
    ctx.strokeStyle = color; ctx.lineWidth = w || 1; ctx.stroke();
  }
  function escenaPedestal(ctx, W, H, s) {
    const c = est.c, dv = est.deriv, movil = W < 680, N = dv.nPed, d = est.datos;
    let S, A;   // S: vista lateral (elevación); A: esfera de acimut
    if (!movil) {
      S = { x0: 14, x1: W * 0.58, y1: H - 62 };
      const R = Math.min(W * 0.42 / 2 - 44, (H - 34 - 66) / 2 - 16);
      A = { cx: W * 0.58 + (W * 0.42) / 2, cy: 34 + 16 + R, R };
    } else {
      S = { x0: 10, x1: W * 0.56, y1: H * 0.52 };
      const R = Math.min(W * 0.44 / 2 - 22, H * 0.52 / 2 - 30);
      A = { cx: W * 0.78, cy: 44 + R, R };
    }
    const errEl = s.ejeErr === 'el' && s.errEje != null ? s.errEje : 0, errAz = s.ejeErr === 'az' && s.errEje != null ? s.errEje : 0;
    const elDib = s.modo === 'inestable' ? s.elAnt : s.el - errEl * N;
    const azDib = s.modo === 'inestable' ? s.azAnt : s.az - errAz * N;
    // --- vista lateral
    etiqueta(ctx, movil ? 'Elevación' : 'Elevación · vista de perfil', S.x0 + 2, 16);
    const suelo0 = S.y1, px = S.x0 + (S.x1 - S.x0) * 0.26, py = suelo0 - (movil ? 40 : 64);
    const Lb = Math.min((S.x1 - px) - 16, py - (movil ? 44 : 52));
    linea(ctx, S.x0, suelo0 + 0.5, S.x1, suelo0 + 0.5, c.lineStrong);
    // pedestal: base y columna
    ctx.strokeStyle = c.lineStrong; ctx.lineWidth = 1; ctx.fillStyle = c.elevated;
    ctx.beginPath(); ctx.moveTo(px - 26, suelo0); ctx.lineTo(px - 16, suelo0 - 10); ctx.lineTo(px + 16, suelo0 - 10); ctx.lineTo(px + 26, suelo0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillRect(px - 5, py, 10, suelo0 - 10 - py); ctx.strokeRect(px - 5 + 0.5, py + 0.5, 9, suelo0 - 10 - py);
    // escala de elevación 0–90°
    const Re = Lb * 0.6;
    arco(ctx, px, py, Re, 0, 90, c.line, 1);
    [0, 30, 60, 90].forEach(a => {
      const x = px + Re * Math.cos(a * D2R), y = py - Re * Math.sin(a * D2R);
      linea(ctx, x - 4 * Math.cos(a * D2R), y + 4 * Math.sin(a * D2R), x + 4 * Math.cos(a * D2R), y - 4 * Math.sin(a * D2R), c.lineStrong);
      if (Math.abs(a - s.el) > 7) texto(ctx, `${a}°`, px + (Re + 14) * Math.cos(a * D2R), py - (Re + 12) * Math.sin(a * D2R), { color: c.text2, align: a >= 60 ? 'center' : 'left' });
    });
    // línea de vista al satélite y eje del haz
    const elS = s.el, xs = px + Lb * Math.cos(elS * D2R), ys = py - Lb * Math.sin(elS * D2R);
    linea(ctx, px, py, xs, ys, c.text2, 1, [4, 3]);
    punto(ctx, xs, ys, 4, c.text);
    texto(ctx, 'satélite', xs + 9, ys - 9, { color: c.text2 });
    linea(ctx, px, py, px + Lb * 0.92 * Math.cos(elDib * D2R), py - Lb * 0.92 * Math.sin(elDib * D2R), c.text, 1);
    parabola(ctx, px, py, elDib, movil ? 22 : 36, movil ? 8 : 13, c);
    punto(ctx, px, py, 2.5, c.text2);
    if (Math.abs(errEl) > 0 && s.modo !== 'inestable') {
      arco(ctx, px, py, Lb * 0.78, elDib, elS, c.accent, 1.5);
      const am = (elDib + elS) / 2, rx = px + (Lb * 0.78 + 8) * Math.cos(am * D2R), ry = py - (Lb * 0.78 + 8) * Math.sin(am * D2R);
      if (!movil) texto(ctx, `Δel ${fmtAng(Math.abs(errEl))}°`, rx, ry, { color: c.accent, align: am > 75 ? 'right' : 'left' });
    }
    // --- esfera de acimut (vista desde arriba, norte arriba, horario)
    etiqueta(ctx, movil ? 'Acimut' : 'Acimut · vista en planta', movil ? A.cx - A.R - 10 : A.cx - A.R - 20, 16);
    ctx.beginPath(); ctx.arc(A.cx, A.cy, A.R, 0, 2 * Math.PI); ctx.strokeStyle = c.lineStrong; ctx.lineWidth = 1; ctx.stroke();
    for (let a = 0; a < 360; a += 10) {
      const lg = a % 30 === 0 ? 7 : 3.5, sa = Math.sin(a * D2R), ca = Math.cos(a * D2R);
      linea(ctx, A.cx + (A.R - lg) * sa, A.cy - (A.R - lg) * ca, A.cx + A.R * sa, A.cy - A.R * ca, a % 30 === 0 ? c.lineStrong : c.line);
    }
    [['N', 0], ['E', 90], ['S', 180], ['O', 270]].forEach(([t, a]) =>
      texto(ctx, t, A.cx + (A.R + 12) * Math.sin(a * D2R), A.cy - (A.R + 12) * Math.cos(a * D2R), { color: c.text2, align: 'center' }));
    const pa = (a, r) => ({ x: A.cx + r * Math.sin(a * D2R), y: A.cy - r * Math.cos(a * D2R) });
    const sp = pa(s.az, A.R - 2), ap = pa(azDib, A.R * 0.86);
    linea(ctx, A.cx, A.cy, sp.x, sp.y, c.text2, 1, [4, 3]); punto(ctx, sp.x, sp.y, 3.5, c.text);
    linea(ctx, A.cx, A.cy, ap.x, ap.y, c.text, 1.5); punto(ctx, A.cx, A.cy, 2.5, c.text2);
    if (Math.abs(errAz) > 0 && s.modo !== 'inestable') {
      // arco horario de azDib a az (en el lienzo, el acimut crece en sentido horario)
      const r = A.R * 0.62, a0 = (azDib - 90) * D2R, a1 = (s.az - 90) * D2R;
      ctx.beginPath(); ctx.arc(A.cx, A.cy, r, a0, a1, a1 < a0); ctx.strokeStyle = c.accent; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // --- lecturas
    const fil = [];
    const azAntLeido = s.modo === 'inestable' ? s.azAnt : norm360(s.az - errAz), elAntLeido = s.modo === 'inestable' ? s.elAnt : s.el - errEl;
    fil.push([`antena   el ${fmt(elAntLeido, 2)}° · az ${fmt(azAntLeido, 2)}°`, c.text]);
    fil.push([`satélite el ${fmt(s.el, 2)}° · az ${fmt(s.az, 2)}°`, c.text2]);
    if (!movil) fil.forEach(([t, col], i) => texto(ctx, t, A.cx, H - 46 + i * 18, { color: col, align: 'center' }));
    let msg, msgCol = c.text;
    if (s.modo === 'pasada') msg = `desviación del haz ${fmtAng(s.desv)}° · error del eje de ${s.ejeErr === 'az' ? 'acimut' : 'elevación'} ${fmtAng(Math.abs(s.errEje))}°`;
    else if (s.modo === 'rampa') msg = `error estacionario de la rampa ${fmtAng(s.desv)}° · constante en toda la pasada`;
    else if (s.modo === 'inestable') { msg = `lazo inestable (ρ = ${fmt(d.sim.rho, 3)} ≥ 1) · la antena no sigue al satélite`; msgCol = c.accent; }
    else msg = 'escalón o cuadrada · sin error de apuntamiento definido · antena sobre la línea de vista';
    if (!movil) {
      // reparto voraz de las partes del mensaje en el ancho de la vista lateral
      ctx.font = `400 11px ${c.mono}`;
      const filas = [];
      msg.split(' · ').forEach(p => {
        const ult = filas.length ? filas[filas.length - 1] + ' · ' + p : p;
        if (filas.length && ctx.measureText(ult).width <= S.x1 - S.x0 - 4) filas[filas.length - 1] = ult; else filas.push(p);
      });
      if (N > 1 && (s.modo === 'pasada' || s.modo === 'rampa')) filas.push({ t: `error ×${fmt(N)} (ampliado en el dibujo)` });
      filas.forEach((f, i) => texto(ctx, f.t || f, S.x0 + 2, H - 46 + i * 18, { color: f.t ? c.text2 : msgCol }));
    } else {
      const y0 = suelo0 + 22;
      fil.forEach(([t, col], i) => texto(ctx, t.replace('antena   ', 'antena ').replace(' · ', ' '), S.x0 + 2, y0 + i * 16, { color: col }));
      const partes = msg.split(' · ');
      partes.forEach((p, i) => texto(ctx, p, S.x0 + 2, y0 + 40 + i * 16, { color: msgCol }));
      if (N > 1 && (s.modo === 'pasada' || s.modo === 'rampa')) texto(ctx, `error ×${fmt(N)} (ampliado)`, S.x0 + 2, y0 + 40 + partes.length * 16, { color: c.text2 });
    }
    return `Vista del pedestal en t = ${fmt(s.t)} s: antena a ${fmt(elAntLeido, 2)}° de elevación y ${fmt(azAntLeido, 2)}° de acimut; `
      + `satélite a ${fmt(s.el, 2)}° y ${fmt(s.az, 2)}°. ${msg.charAt(0).toUpperCase() + msg.slice(1)}.`
      + (N > 1 ? ` El error se dibuja ampliado ${fmt(N)} veces.` : '');
  }

  // ---------------------------------------------------------------- 3 · Haz
  function escenaHaz(ctx, W, H, s) {
    const c = est.c, dv = est.deriv, d = est.datos, hz = d.hz, movil = W < 560;
    let C, Pn;
    if (!movil) { C = { x0: 16, x1: W * 0.62, y0: 34, y1: H - 34 }; Pn = { x0: W * 0.62 + 32, x1: W - 18, y0: 28 }; }
    else { C = { x0: 12, x1: W - 12, y0: 28, y1: 140 }; Pn = { x0: 14, x1: W - 14, y0: 178 }; }
    // Escala angular: el cono a −3 dB ocupa unos 15° en el dibujo; satélite y cono con la MISMA escala
    const cy = (C.y0 + C.y1) / 2, ax = C.x0 + 34, Lc = C.x1 - ax - 8;
    // el cono (con sus rótulos por fuera) tiene que caber en altura
    const semiMax = Math.atan((cy - C.y0 - 16) / Lc) * R2D;
    const K = factorAmpliacion(hz.hpbw / 2, Math.min(15, semiMax));
    const semi = semiConoDibujo(hz.hpbw, K), semi4 = semiConoDibujo(hz.hpbw / 2, K);
    const maxDib = Math.atan((cy - C.y0 - 4) / (Lc * 0.86)) * R2D;
    etiqueta(ctx, 'Haz de la antena · vista lateral', C.x0 + 2, 16);
    // cono a −3 dB
    const col = s.modo === 'na' ? c.lineStrong : (s.clase === 'fuera' ? c.accent : s.clase === 'degradado' ? c.accentLine : c.text2);
    const tip = (a, L) => ({ x: ax + L * Math.cos(a * D2R), y: cy - L * Math.sin(a * D2R) });
    const e1 = tip(semi, Lc), e2 = tip(-semi, Lc);
    ctx.beginPath(); ctx.moveTo(ax, cy); ctx.lineTo(e1.x, e1.y); ctx.lineTo(e2.x, e2.y); ctx.closePath();
    ctx.fillStyle = c.accentSoft; ctx.fill();
    linea(ctx, ax, cy, e1.x, e1.y, col, 1); linea(ctx, ax, cy, e2.x, e2.y, col, 1);
    const f1 = tip(semi4, Lc), f2 = tip(-semi4, Lc);
    linea(ctx, ax, cy, f1.x, f1.y, c.lineStrong, 1, [3, 3]); linea(ctx, ax, cy, f2.x, f2.y, c.lineStrong, 1, [3, 3]);
    linea(ctx, ax, cy, ax + Lc, cy, c.text3, 1, [1, 3]);
    parabola(ctx, ax, cy, 0, movil ? 16 : 20, movil ? 6 : 8, c);
    // rótulos del cono en el lado contrario al satélite
    const arriba = (s.signo || 1) < 0;
    const eL = arriba ? e1 : e2, fL = arriba ? f1 : f2, sg = arriba ? -1 : 1;
    texto(ctx, `−3 dB · θ3dB/2 = ${fmtAng(hz.hpbw / 2)}°`, eL.x, eL.y + 11 * sg, { color: c.text2, align: 'right' });
    if (Math.abs(eL.y - fL.y) >= 13) texto(ctx, 'θ3dB/4', fL.x - 2, (eL.y + fL.y) / 2, { color: c.text2, align: 'right' });
    texto(ctx, `ángulos ×${fmt(K)} (ampliados en el dibujo)`, C.x0 + 2, movil ? C.y1 + 14 : H - 14, { color: c.text2 });
    // satélite: a la desviación del haz, con el signo del error del eje
    let msgSat;
    if (s.modo === 'pasada' || s.modo === 'rampa' || s.modo === 'inestable') {
      const dib = isFinite(s.desv) ? s.desv * K * (s.signo || 1) : maxDib + 1;
      const corta = Math.abs(dib) > maxDib, a = Math.max(-maxDib, Math.min(maxDib, dib));
      const p = tip(a, Lc * 0.8);
      punto(ctx, p.x, p.y, 4.5, c.text);
      msgSat = isFinite(s.desv) ? `satélite · ${fmtAng(s.desv)}°` : 'satélite · sin seguimiento';
      texto(ctx, msgSat + (corta ? ' (fuera de escala)' : ''), p.x - 10, p.y + (a >= 0 ? -12 : 12), { color: c.text, align: 'right' });
    } else {
      const p = tip(0, Lc * 0.8); punto(ctx, p.x, p.y, 4.5, c.text);
      texto(ctx, 'satélite · sin error definido', p.x - 10, p.y - 12, { color: c.text, align: 'right' });
    }
    // --- panel: pérdida instantánea y semáforo
    const pw = Pn.x1 - Pn.x0;
    let y = Pn.y0;
    etiqueta(ctx, 'Pérdida de ida en este instante', Pn.x0, y);
    const L = s.perdIda;
    const vtxt = L == null ? '—' : isFinite(L) ? `${fmt(L, 2)} dB` : 'sin señal';
    y += movil ? 24 : 34;
    texto(ctx, vtxt, Pn.x0, y, { size: movil ? 22 : 28, weight: 500, color: c.text });
    // barra 0–6 dB con los límites del semáforo
    const bMax = 6, by = y + (movil ? 18 : 30), bh = 8, bx = Pn.x0, bw = pw;
    const X = v => bx + bw * Math.min(1, Math.max(0, v / bMax));
    ctx.strokeStyle = c.lineStrong; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh);
    if (L != null && L > 0) {
      ctx.fillStyle = s.clase === 'fuera' ? c.accent : s.clase === 'degradado' ? c.accentLine : c.text2;
      ctx.fillRect(bx + 1, by + 1, Math.max(1, X(isFinite(L) ? L : bMax) - bx - 2), bh - 1);
    }
    const marca = (v, t, arriba) => {
      if (v == null || !isFinite(v) || v > bMax) return;
      const x = Math.round(X(v)) + 0.5;
      linea(ctx, x, by - 4, x, by + bh + 4, c.text2, 1);
      if (t) texto(ctx, t, x, arriba ? by - 11 : by + bh + 13, { color: c.text2, align: 'center' });
    };
    marca(dv.lim4, 'θ3dB/4', !movil); marca(dv.lim2, '−3 dB', !movil);
    if (!(movil && dv.lim4 != null && X(dv.lim4) - bx < 48)) texto(ctx, '0', bx, by + bh + 13, { color: c.text2 });
    texto(ctx, `${bMax} dB`, bx + bw, by + bh + 13, { color: c.text2, align: 'right' });
    if (isFinite(L) && L > bMax) texto(ctx, '›', bx + bw + 6, by + bh / 2, { color: c.accent });
    // semáforo de este instante
    y = by + bh + (movil ? 36 : 44);
    punto(ctx, Pn.x0 + 4, y, 4, colorClase(s.clase));
    texto(ctx, s.modo === 'na' ? 'No aplica' : ESTADO_LBL[s.clase], Pn.x0 + 16, y, { color: c.text, size: 12, mono: false });
    y += 22;
    const linPn = [];
    if (s.modo === 'pasada' || s.modo === 'rampa') {
      linPn.push(`desviación ${fmtAng(s.desv)}° de ${fmtAng(hz.hpbw / 2)}°`);
      if (!movil || H >= 320) linPn.push(s.modo === 'pasada' ? `máx. de la pasada ${fmtAng(dv.desvMax)}° · ${fmt(d.L.ida, 2)} dB` : 'error estacionario de la rampa');
    } else if (s.modo === 'inestable') linPn.push('lazo inestable: sin seguimiento');
    else linPn.push('la referencia no define un error');
    if (!movil) linPn.push(`θ3dB ${fmtAng(hz.hpbw)}° · FNBW ${fmtAng(hz.fnbw)}°`);
    linPn.forEach((t, i) => texto(ctx, t, Pn.x0, y + i * 16, { color: c.text2 }));
    return `Vista del haz en t = ${fmt(s.t)} s: ` + (s.modo === 'pasada' || s.modo === 'rampa'
      ? `desviación de ${fmtAng(s.desv)}° frente a un semihaz a −3 dB de ${fmtAng(hz.hpbw / 2)}°; pérdida de ida de ${vtxt}; ${ESTADO_LBL[s.clase].toLowerCase()}.`
      : s.modo === 'inestable' ? 'lazo inestable, sin seguimiento.' : 'la referencia elegida no define un error de apuntamiento.')
      + ` Ángulos ampliados ${fmt(K)} veces en el dibujo.`;
  }

  return Object.assign({}, geometria, {
    plantilla, conectar, desconectar, actualizar,
    /** Para depuración en consola: estado del reloj. */
    reloj: () => ({ frac: est.frac, t: est.frac * dur(), jugando: est.jugando, velocidad: vel(), visibles: est.visibles.size, bucle: !!est.raf })
  });
});
