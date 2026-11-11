/**
 * lezg-fases.js — Fases del estudio del lado aire del Aeropuerto de Zaragoza (LEZG)
 * Fase 2: aeronave crítica (Tema 3) · Fase 3: pistas y vientos (Tema 4)
 * Fase 4: rodaje y plataforma (Tema 5), con calculadora de los tres segmentos y semáforo del dictamen
 * Fase 5: servidumbres y OLS (Tema 6), con calculadora de penetración en la aproximación de la 30R
 */

(function () {
  'use strict';

  // ==========================================
  // Fases del proyecto (pestañas)
  // ==========================================
  window.LEZG_FASES = [
    { id: 'demanda', label: 'Demanda 2025–2050' },
    { id: 't3', label: 'Aeronave crítica B787-9' },
    { id: 't4', label: 'Pistas y vientos' },
    { id: 't5', label: 'Rodaje y plataforma' },
    { id: 't6', label: 'Servidumbres y OLS' }
  ];

  // ==========================================
  // Utilidades
  // ==========================================
  // Formato español con punto de miles también en cifras de cuatro dígitos (2.679)
  const fmt = (x, d = 0) => {
    const [ent, dec] = Math.abs(x).toFixed(d).split('.');
    return (x < 0 && +x.toFixed(d) !== 0 ? '−' : '') + ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dec ? ',' + dec : '');
  };

  function header(pill, title, summary) {
    return `
      <div class="methodology-block lezg-phase-header">
        <span class="methodology-pill">${pill}</span>
        <h2 class="lezg-phase-title">${title}</h2>
        <p class="block-description">${summary}</p>
      </div>`;
  }

  function kpis(items) {
    return `<div class="lezg-kpi-grid">${items.map(k => `
      <div class="runway-card ${k.glow ? 'highlight-glow' : ''}">
        <span class="runway-card-lbl">${k.lbl}</span>
        <span class="runway-card-val ${k.cls || ''}">${k.val}</span>
        <span class="runway-card-sub">${k.sub}</span>
      </div>`).join('')}</div>`;
  }

  function figura(src, caption, extra = '') {
    return `
      <figure class="lezg-figure ${extra}">
        <img src="${src}" alt="${caption.replace(/<[^>]+>/g, '')}" loading="lazy" />
        <figcaption>${caption}</figcaption>
      </figure>`;
  }

  function dictamen(texto, tipo = 'restricciones') {
    return `
      <div class="lezg-dictamen lezg-dictamen-${tipo}">
        <span class="lezg-dictamen-lbl">Dictamen</span>
        <p>${texto}</p>
      </div>`;
  }

  // ==========================================
  // Fase 2 · Tema 3: aeronave crítica
  // ==========================================
  function renderT3(container) {
    container.innerHTML = `
      <div class="lezg-phase">
        ${header('Fase 2 · Tema 3 · La aeronave como usuario',
          'Impacto del Boeing 787-9 como aeronave crítica',
          'Una nueva ruta de largo radio obliga a comprobar si el Boeing 787-9 cabe en la clave del aeropuerto, si puede maniobrar en sus calles de rodaje y si la pista permite el despegue a peso máximo en los días más calurosos de Zaragoza. Se combinan el AIP de ENAIRE, el manual de planificación de Boeing (ACAP) y diez años de temperaturas diarias de la estación del aeropuerto.')}

        ${kpis([
          { lbl: 'Clave de referencia', val: '4E', sub: '60,12 m de envergadura · compatible con LEZG', cls: 'accent' },
          { lbl: 'Pista necesaria a peso máximo', val: '3.914 m', sub: 'T<sub>ref</sub> = 32 °C · TORA 12R/30L: 3.718 m', cls: 'highlight', glow: true },
          { lbl: 'Peso máximo al despegue (RTOW)', val: '246,8 t', sub: '7,9 t de carga en tierra por la pista 12R/30L' },
          { lbl: 'Ancho en el giro A-1/TA', val: '24,2 m', sub: 'necesarios frente a 22,5 m disponibles' }
        ])}

        <div class="methodology-block">
          <div class="block-header"><span class="block-number">B.2</span><h3 class="block-title">Temperatura de referencia</h3></div>
          <p class="block-description">El AIP publica una temperatura de referencia de 32 °C. Con la media de las máximas de julio de 2016 a 2025 se obtienen <strong>33,8 °C</strong>: casi dos grados más, lo que alarga la pista necesaria unos 60 m.</p>
          ${figura('img/lezg/t3_tref.jpg', 'Media de las temperaturas máximas de julio (2016–2025) frente a la temperatura de referencia del AIP.')}
        </div>

        <div class="methodology-block">
          <div class="block-header"><span class="block-number">B.3–B.4</span><h3 class="block-title">Longitud de pista y penalización de carga</h3></div>
          <p class="block-description">Con las curvas del ACAP corregidas por altitud y temperatura, el 787-9 a peso máximo necesita <strong>3.914 m</strong> (3.974 m con la temperatura calculada). Ninguna de las dos pistas llega: por la 12R/30L hay que dejar en tierra <strong>7,9–10,4 t</strong>, y por la 12L/30R, de 3.032 m, <strong>19,7–21,5 t</strong>.</p>
          ${figura('img/lezg/t3_rtow.jpg', 'Longitud de campo necesaria frente al peso al despegue para tres temperaturas, con los TORA de ambas pistas.')}
        </div>

        <div class="methodology-block">
          <div class="block-header"><span class="block-number">A.2</span><h3 class="block-title">Off-tracking en la curva más desfavorable</h3></div>
          <p class="block-description">En el giro entre A-1 y TA, el tren principal del 787-9 recorta la curva y exige <strong>24,22 m</strong> de pavimento, frente a los 22,5 m disponibles. Se resuelve ensanchando el acuerdo o fijando un procedimiento de rodaje.</p>
          ${figura('img/lezg/t3_giro_a1.jpg', 'Geometría del giro A-1/TA sobre la carta del AIP: bordes del pavimento y eje de la curva.', 'lezg-figure-narrow')}
        </div>

        ${dictamen('<strong>Operación viable con restricciones operativas.</strong> El 787-9 es compatible con la clave 4E del aeropuerto, pero no puede despegar a peso máximo en los días de calor de referencia. Se recomienda operar por la pista 12R/30L, limitar el peso al despegue en verano y corregir o gestionar por procedimiento el giro A-1/TA.')}
      </div>`;
  }

  // ==========================================
  // Fase 3 · Tema 4: pistas y vientos
  // ==========================================
  function renderT4(container) {
    container.innerHTML = `
      <div class="lezg-phase">
        ${header('Fase 3 · Tema 4 · Configuración de pistas',
          'Orientación por vientos, cabeceras y perfil longitudinal',
          'Con 120.282 observaciones horarias de viento (METAR de 2010 a 2024) se construye la rosa de vientos de Zaragoza y se busca, grado a grado con el método de Valenzuela, la orientación que maximiza el coeficiente de utilización. Después se designan las cabeceras y se verifica el perfil longitudinal publicado en el AIP con los criterios del Anexo 14.')}

        ${kpis([
          { lbl: 'Utilización del eje actual (120°)', val: '99,96 %', sub: 'Viento cruzado ≤ 20 kt · mínimo OACI 95 %', cls: 'accent', glow: true },
          { lbl: 'Orientación óptima', val: '110°', sub: '99,98 % · se designaría 11/29' },
          { lbl: 'Cambios de pendiente en 12R/30L', val: '403 m', sub: 'de separación frente a 599 m recomendados', cls: 'highlight' },
          { lbl: 'TORA para despegue a peso máximo', val: '−193 m', sub: '3.911 m necesarios frente a 3.718 m' }
        ])}

        <div class="lezg-figure-grid">
          <div class="methodology-block">
            <div class="block-header"><span class="block-number">A.2</span><h3 class="block-title">Cierzo y bochorno</h3></div>
            <p class="block-description">Los vientos dominantes son el <strong>cierzo</strong> (WNW) y el <strong>bochorno</strong> (E-ESE), casi alineados con las pistas.</p>
            ${figura('img/lezg/t4_rosa.jpg', 'Rosa de vientos de LEZG (2010–2024) con el eje de las pistas 12/30 y la orientación óptima de 110°.')}
          </div>
          <div class="methodology-block">
            <div class="block-header"><span class="block-number">A.3</span><h3 class="block-title">Barrido de Valenzuela</h3></div>
            <p class="block-description">Con 20 kt la curva es muy plana: <strong>145 de los 180 rumbos</strong> superan el 95 %. El eje real está dentro de la banda casi óptima (104°–117°), así que no se justifica reorientar.</p>
            ${figura('img/lezg/t4_valenzuela.jpg', 'Coeficiente de utilización en función del rumbo para límites de 10, 13 y 20 kt de viento cruzado.')}
          </div>
        </div>

        <div class="methodology-block">
          <div class="block-header"><span class="block-number">C</span><h3 class="block-title">Perfil longitudinal de la 12R/30L</h3></div>
          <p class="block-description">Las pendientes total y local, los cambios de pendiente y la visibilidad cumplen. El único incumplimiento: dos cambios de pendiente a 1.693 m y 2.096 m del umbral 12R están separados <strong>403 m</strong>, y el Anexo 14 recomienda 599 m. Se corrige recreciendo <strong>1,05 m</strong> el punto bajo en la próxima rehabilitación del firme.</p>
          ${figura('img/lezg/t4_perfil_12r.jpg', 'Perfil longitudinal de la pista 12R/30L según el AIP, con pendientes por tramo.')}
        </div>

        ${dictamen('<strong>Configuración validada en lo esencial.</strong> Se mantienen la orientación y la designación 12/30, se recomienda corregir el punto bajo de la 12R/30L y se confirma la limitación de peso al despegue del 787-9 en los días calurosos.')}
      </div>`;
  }

  // ==========================================
  // Fase 4 · Tema 5: rodaje y plataforma
  // ==========================================
  const RWY = {
    '30R': { lda: 3032, exits: [['A-4', 820.7], ['A-3', 1521], ['A-2', 2270], ['A-1', 3030]], end: 'A-1' },
    '12L': { lda: 3032, exits: [['A-2', 762], ['A-3', 1511], ['A-4', 2211.3], ['A-5', 3027]], end: 'A-5' }
  };
  const S1 = 450, DT = 10, VEX_RET = 95, VEX_ORT = 25;
  const RET_AVANCE = 550 * Math.sin(Math.PI / 6) + (276 - 550 * (1 - Math.cos(Math.PI / 6))) / Math.tan(Math.PI / 6); // 625,4 m
  const PRESETS = [
    { lbl: 'Grupo C · 240 km/h', v: 240, a: 1.5 },
    { lbl: 'Grupo D · 260 km/h', v: 260, a: 1.5, def: true },
    { lbl: '787-9 · 153 kt', v: 283.4, a: 1.5 },
    { lbl: 'Pista seca · 3,0 m/s²', v: 260, a: 3.0 }
  ];
  let calc = { v: 260, a: 1.5, thr: '30R' };

  const SEMAFORO = [
    { el: 'Salidas de la pista 12L/30R', est: 'ambar', res: 'Conformidad con restricciones', act: 'El 787-9 sale por A-1 (30R) o A-5 (12L); unos 32 s más de ocupación de pista' },
    { el: 'Calle de salida rápida (RET) para el 787-9', est: 'rojo', res: 'No viable', act: 'Enlazaría con TA 272 m más allá del extremo; reservar una RET de clase C a 2.370 m' },
    { el: 'Curvas de salida A-1 a A-5', est: 'verde', res: 'Conformidad', act: 'Radio de 60 m, acuerdos y tramo recto adecuados para salidas ortogonales' },
    { el: 'Puntos de espera de la 12L/30R', est: 'verde', res: 'Conformidad', act: '121 m pintados frente a 65–95 m exigidos; válidos incluso para letra F' },
    { el: 'Puntos de espera de la 12R/30L', est: 'ambar', res: 'En el límite', act: 'Retranquearlos a 90–100 m si se implanta un ILS CAT I en la 12R' },
    { el: 'Separación pista–TA y objetos', est: 'verde', res: 'Conformidad', act: '276 m frente a 172,5 m; primer objeto a 64 m de TA (mínimo 43,5 m)' },
    { el: 'Anchura de A-1 y A-5', est: 'rojo', res: 'Inconformidad menor', act: '22,3 y 22,6 m frente a 23 m; ensanchar en la próxima rehabilitación' },
    { el: 'Márgenes, franjas y sobreanchos de TA', est: 'verde', res: 'Conformidad', act: '44 m de calle con márgenes frente a 38 m; acuerdos de A-4 suficientes' },
    { el: 'Puentes-pista', est: 'gris', res: 'No aplica', act: 'Diseño futuro: 38 m de ancho y 51,7 m de recta a cada lado' },
    { el: 'Puesto de estacionamiento PRKG 4', est: 'ambar', res: 'Conformidad con restricciones', act: 'Push-back obligatorio: el giro autónomo invade los puestos 1 y 5A' },
    { el: 'Cota de la plataforma civil en el AIP', est: 'ambar', res: 'Errata', act: 'Comunicar a ENAIRE la cota de 296 m (real: 245–247 m)' }
  ];
  const EST_LBL = { verde: 'Cumple', ambar: 'Con restricción', rojo: 'No cumple', gris: 'No aplica' };
  let filtroSemaforo = 'todos';

  function renderT5(container) {
    container.innerHTML = `
      <div class="lezg-phase">
        ${header('Fase 4 · Tema 5 · Calles de rodaje y plataformas',
          'Auditoría del sistema de rodadura y plataforma',
          'Se auditan las salidas de pista, los puntos de espera, las separaciones del Anexo 14 y el puesto de estacionamiento para el 787-9. Las distancias que el AIP no publica se han medido sobre ortofoto rectificada a los ejes de la pista con las coordenadas de los umbrales.')}

        ${kpis([
          { lbl: 'Eje de pista a eje de TA', val: '276 m', sub: 'mínimo Anexo 14: 172,5 m', cls: 'accent' },
          { lbl: 'Puntos de espera pintados', val: '121 m', sub: 'exigidos 90–95 m con corrección por cota', cls: 'accent' },
          { lbl: 'Ocupación de pista del 787-9', val: '79 s', sub: 'sale por A-1: 32 s más que con una RET', cls: 'highlight', glow: true },
          { lbl: 'Sobre con push-back', val: '4.035 m²', sub: 'frente a 8.300 m² con giro autónomo' }
        ])}

        ${figura('img/lezg/t5_layout.jpg', 'Pista 12L/30R y calle paralela TA sobre ortofoto rectificada: salidas reales, posiciones teóricas, RET propuesta, separación pista–TA y puntos de espera.')}

        <!-- Calculadora de los tres segmentos -->
        <div class="methodology-block lezg-calc" id="lezg-calc">
          <div class="block-header"><span class="block-number">A.1</span><h3 class="block-title">Calculadora de los tres segmentos</h3></div>
          <p class="block-description">La distancia del umbral a la salida es <strong>S = S<sub>1</sub> + S<sub>2</sub> + S<sub>3</sub></strong>: 450 m hasta la toma de contacto, 10 s de transición a velocidad V<sub>ba</sub> y frenado hasta 95 km/h (salida rápida) o 25 km/h (salida ortogonal). Mueve los controles y mira por qué salida abandona la pista el avión.</p>

          <div class="lezg-calc-presets">${PRESETS.map((p, i) => `<button class="toggle-btn ${p.def ? 'active' : ''}" data-preset="${i}">${p.lbl}</button>`).join('')}</div>

          <div class="lezg-calc-controls">
            <label class="lezg-slider">
              <span>Velocidad al inicio del frenado V<sub>ba</sub> <strong id="calc-v-lbl"></strong></span>
              <input type="range" class="custom-range" id="calc-v" min="200" max="300" step="1" value="260" />
            </label>
            <label class="lezg-slider">
              <span>Deceleración media a <strong id="calc-a-lbl"></strong></span>
              <input type="range" class="custom-range" id="calc-a" min="1" max="3.5" step="0.05" value="1.5" />
            </label>
            <div class="lezg-slider">
              <span>Cabecera de aterrizaje</span>
              <div class="button-toggle-group">
                <button class="toggle-btn active" data-thr="30R">30R (ILS CAT II/III)</button>
                <button class="toggle-btn" data-thr="12L">12L</button>
              </div>
            </div>
          </div>

          <div class="lezg-kpi-grid" id="calc-results"></div>
          <div class="lezg-runway-svg" id="calc-svg"></div>
          <div id="calc-chart" class="lezg-calc-chart"></div>
          <div class="lezg-calc-bottom">
            <div class="table-responsive">
              <table class="compact-table" id="calc-table"></table>
            </div>
            <div class="runway-conclusion-box" id="calc-conclusion"></div>
          </div>
        </div>

        <div class="lezg-figure-grid">
          ${figura('img/lezg/t5_a4.jpg', 'Salida A-4: línea de salida de unos 60 m de radio (≤ 32 km/h) y punto de espera pintado a 121 m del eje.')}
          ${figura('img/lezg/t5_puesto4.jpg', 'Puesto PRKG 4: sobres de estacionamiento con push-back y círculo de giro autónomo de 102,8 m, que invade los puestos contiguos.')}
        </div>

        <!-- Semáforo del dictamen -->
        <div class="methodology-block" id="lezg-semaforo">
          <div class="block-header"><span class="block-number">D</span><h3 class="block-title">Dictamen por elemento</h3></div>
          <p class="block-description">Resolución técnica de cada elemento auditado. Filtra por estado para ver qué cumple, qué funciona con restricciones y qué requiere obra.</p>
          <div class="lezg-sem-summary" id="sem-summary"></div>
          <div class="table-responsive">
            <table class="compact-table lezg-sem-table" id="sem-table"></table>
          </div>
        </div>

        ${dictamen('<strong>Conformidad con restricciones.</strong> El lado aire de LEZG admite el 787-9 sin obras imprescindibles. El avión abandonará la pista por el extremo y el puesto PRKG 4 solo admite salida remolcada. Una RET para el 787-9 no cabe en la pista; la medida eficaz, si creciera el tráfico, sería una RET para la flota de clase C a 2.370 m del umbral 30R.')}
      </div>`;

    setupCalculator(container);
    renderSemaforo();
    container.querySelector('#sem-summary').addEventListener('click', e => {
      const b = e.target.closest('[data-filtro]');
      if (!b) return;
      filtroSemaforo = b.dataset.filtro;
      renderSemaforo();
    });
  }

  // ---------- Calculadora ----------
  function tresSegmentos(vKmh, a) {
    const vba = vKmh / 3.6;
    const s2 = DT * vba;
    const sRet = S1 + s2 + (vba ** 2 - (VEX_RET / 3.6) ** 2) / (2 * a);
    const sOrt = S1 + s2 + (vba ** 2 - (VEX_ORT / 3.6) ** 2) / (2 * a);
    return { vba, s2, sRet, sOrt };
  }

  function aRequerida(s, vba, s12, vexKmh) {
    return s > s12 + 1 ? (vba ** 2 - (vexKmh / 3.6) ** 2) / (2 * (s - s12)) : null;
  }

  function setupCalculator(root) {
    const vIn = root.querySelector('#calc-v');
    const aIn = root.querySelector('#calc-a');
    const presetBtns = root.querySelectorAll('[data-preset]');
    const thrBtns = root.querySelectorAll('[data-thr]');

    const sync = () => { vIn.value = calc.v; aIn.value = calc.a; updateCalculator(); };
    vIn.addEventListener('input', () => { calc.v = +vIn.value; presetBtns.forEach(b => b.classList.remove('active')); updateCalculator(); });
    aIn.addEventListener('input', () => { calc.a = +aIn.value; presetBtns.forEach(b => b.classList.remove('active')); updateCalculator(); });
    presetBtns.forEach(b => b.addEventListener('click', () => {
      const p = PRESETS[+b.dataset.preset];
      calc.v = p.v; calc.a = p.a;
      presetBtns.forEach(x => x.classList.toggle('active', x === b));
      sync();
    }));
    thrBtns.forEach(b => b.addEventListener('click', () => {
      calc.thr = b.dataset.thr;
      thrBtns.forEach(x => x.classList.toggle('active', x === b));
      updateCalculator();
    }));
    sync();
  }

  function updateCalculator() {
    const rwy = RWY[calc.thr];
    const r = tresSegmentos(calc.v, calc.a);
    const s12 = S1 + r.s2;
    const salida = rwy.exits.find(([, s]) => s >= r.sOrt);
    const ultima = rwy.exits[rwy.exits.length - 1];
    const usada = salida || ultima;
    const forzada = !salida;
    const vexRot = 25 / 3.6;
    let rot = S1 / r.vba + DT + (r.vba - vexRot) / calc.a;
    if (!forzada && usada[1] > r.sOrt) rot += (usada[1] - r.sOrt) / vexRot;
    if (forzada) {
      const aNec = aRequerida(usada[1], r.vba, s12, 25);
      rot = S1 / r.vba + DT + (r.vba - vexRot) / aNec;
    }
    const rotRet = S1 / r.vba + DT + (r.vba - VEX_RET / 3.6) / calc.a;
    const enlace = r.sRet + RET_AVANCE;
    const retViable = enlace <= rwy.lda;

    document.getElementById('calc-v-lbl').textContent = `${fmt(calc.v, calc.v % 1 ? 1 : 0)} km/h (${fmt(r.vba, 1)} m/s)`;
    document.getElementById('calc-a-lbl').textContent = `${fmt(calc.a, 2)} m/s²`;

    document.getElementById('calc-results').innerHTML = [
      { lbl: 'RET teórica (95 km/h)', val: `${fmt(r.sRet)} m`, sub: retViable ? `enlace con TA a ${fmt(enlace)} m: cabe` : `enlace con TA a ${fmt(enlace)} m: más allá del extremo`, cls: retViable ? 'accent' : 'highlight' },
      { lbl: 'Salida ortogonal teórica (25 km/h)', val: `${fmt(r.sOrt)} m`, sub: r.sOrt > rwy.lda ? 'más allá del extremo de pista' : `S₂ = ${fmt(r.s2)} m · S₃ = ${fmt(r.sOrt - s12)} m` },
      { lbl: 'Salida utilizada', val: usada[0], sub: forzada ? `forzada en el extremo: exige ${fmt(aRequerida(usada[1], r.vba, s12, 25), 2)} m/s²` : `a ${fmt(usada[1])} m del umbral ${calc.thr}`, cls: forzada ? 'highlight' : 'accent', glow: true },
      { lbl: 'Ocupación de pista', val: `${fmt(rot)} s`, sub: `${fmt(rot - rotRet)} s más que con una RET teórica (rodando a 25 km/h hasta la salida)` }
    ].map(k => `
      <div class="runway-card ${k.glow ? 'highlight-glow' : ''}">
        <span class="runway-card-lbl">${k.lbl}</span>
        <span class="runway-card-val ${k.cls || ''}">${k.val}</span>
        <span class="runway-card-sub">${k.sub}</span>
      </div>`).join('');

    renderRunwaySvg(rwy, r, s12, usada, enlace);
    renderCalcChart(rwy, r, s12, usada);

    document.getElementById('calc-table').innerHTML = `
      <thead><tr><th>Salida</th><th>Desde THR ${calc.thr}</th><th>a necesaria a 25 km/h</th><th>Valoración</th></tr></thead>
      <tbody>${rwy.exits.map(([n, s]) => {
        const a = aRequerida(s, r.vba, s12, 25);
        let val, cls;
        if (a === null) { val = 'antes de empezar a frenar'; cls = 'lezg-txt-muted'; }
        else if (a <= calc.a + 1e-9) { val = 'utilizable con la a elegida'; cls = 'lezg-txt-ok'; }
        else if (a <= 3.0) { val = 'requiere frenada más fuerte'; cls = 'lezg-txt-warn'; }
        else { val = 'no utilizable'; cls = 'lezg-txt-bad'; }
        return `<tr class="${n === usada[0] ? 'lezg-row-active' : ''}"><td><strong>${n}</strong></td><td>${fmt(s)} m</td><td>${a === null ? '—' : fmt(a, 2) + ' m/s²'}</td><td class="${cls}">${val}</td></tr>`;
      }).join('')}</tbody>`;

    const anterior = rwy.exits[rwy.exits.indexOf(usada) - 1];
    const aAnt = anterior ? aRequerida(anterior[1], r.vba, s12, 25) : null;
    document.getElementById('calc-conclusion').innerHTML = `
      <span class="conclusion-icon ${forzada ? '' : 'is-ok'}"></span>
      <div class="conclusion-text">
        ${forzada
          ? `Con ${fmt(calc.a, 2)} m/s² el avión no baja a 25 km/h antes del final de la pista: tendría que frenar más fuerte para salir por <strong>${usada[0]}</strong>, en el extremo.`
          : `El avión abandona la pista por <strong>${usada[0]}</strong>, a ${fmt(usada[1])} m del umbral ${calc.thr}.`}
        ${aAnt ? ` Para usar ${anterior[0]} necesitaría frenar a ${fmt(aAnt, 2)} m/s².` : ''}
        ${retViable
          ? ` Una RET a ${fmt(r.sRet)} m sí cabría: enlaza con TA a ${fmt(enlace)} m, antes del extremo.`
          : ` Una RET en su posición teórica no cabe: enlazaría con TA ${fmt(enlace - rwy.lda)} m más allá del extremo de pista.`}
      </div>`;
  }

  function renderRunwaySvg(rwy, r, s12, usada, enlace) {
    const L = 3400, X = s => 40 + (s / L) * 920;
    const exits = rwy.exits.map(([n, s]) => `
      <line x1="${X(s)}" y1="52" x2="${X(s)}" y2="88" class="svg-exit ${n === usada[0] ? 'used' : ''}" />
      <text x="${X(s)}" y="104" class="svg-exit-lbl ${n === usada[0] ? 'used' : ''}">${n}</text>`).join('');
    const seg = (a, b, cls, lbl) => b > a ? `
      <rect x="${X(a)}" y="20" width="${Math.max(X(Math.min(b, L)) - X(a), 0)}" height="12" class="${cls}" />
      <text x="${(X(a) + X(Math.min(b, L))) / 2}" y="14" class="svg-seg-lbl">${lbl}</text>` : '';
    const mark = (s, cls, lbl, y) => s <= L ? `
      <path d="M ${X(s)} 42 l -6 -9 h 12 z" class="${cls}" />
      <text x="${X(s)}" y="${y}" class="svg-mark-lbl ${cls}">${lbl}</text>` : '';
    document.getElementById('calc-svg').innerHTML = `
      <svg viewBox="0 0 1000 120" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Esquema de la pista con los tres segmentos y las salidas">
        <rect x="${X(0)}" y="44" width="${X(rwy.lda) - X(0)}" height="8" class="svg-runway" />
        <rect x="${X(rwy.lda)}" y="44" width="${X(L) - X(rwy.lda)}" height="8" class="svg-overrun" />
        <text x="${X(0)}" y="70" class="svg-thr">THR ${calc.thr}</text>
        <text x="${(X(rwy.lda) + X(L)) / 2}" y="40" class="svg-thr">fuera de pista</text>
        ${seg(0, S1, 'svg-s1', 'S₁')}
        ${seg(S1, s12, 'svg-s2', 'S₂')}
        ${seg(s12, r.sOrt, 'svg-s3', 'S₃ (hasta 25 km/h)')}
        ${exits}
        ${mark(r.sRet, 'svg-ret', 'RET', 118)}
        ${mark(r.sOrt, 'svg-ort', '25 km/h', 118)}
      </svg>`;
  }

  function renderCalcChart(rwy, r, s12, usada) {
    const el = document.getElementById('calc-chart');
    if (!el || typeof Plotly === 'undefined') return;
    const xs = [], ys = [];
    for (let s = 0; s <= 3400; s += 10) {
      xs.push(s);
      ys.push(s <= s12 ? r.vba * 3.6 : Math.sqrt(Math.max(r.vba ** 2 - 2 * calc.a * (s - s12), 0)) * 3.6);
    }
    const shapes = [
      ...rwy.exits.map(([n, s]) => ({ type: 'line', x0: s, x1: s, y0: 0, y1: 1, yref: 'paper', line: { color: n === usada[0] ? '#e8552b' : 'rgba(255,255,255,0.18)', width: n === usada[0] ? 2 : 1 } })),
      { type: 'rect', x0: rwy.lda, x1: 3400, y0: 0, y1: 1, yref: 'paper', fillcolor: 'rgba(255,255,255,0.05)', line: { width: 0 } },
      ...[95, 25].map(v => ({ type: 'line', x0: 0, x1: 3400, y0: v, y1: v, line: { color: 'rgba(255,255,255,0.3)', width: 1, dash: 'dot' } }))
    ];
    const annotations = [
      ...rwy.exits.map(([n, s]) => ({ x: s, y: 1.04, yref: 'paper', text: n, showarrow: false, font: { color: n === usada[0] ? '#e8552b' : '#8e8e93', size: 11 } })),
      { x: 60, y: 95, text: '95 km/h', showarrow: false, xanchor: 'left', yanchor: 'bottom', font: { color: '#8e8e93', size: 10 } },
      { x: 60, y: 25, text: '25 km/h', showarrow: false, xanchor: 'left', yanchor: 'bottom', font: { color: '#8e8e93', size: 10 } },
      { x: 3215, y: 0.5, yref: 'paper', text: 'fuera de<br>pista', showarrow: false, font: { color: '#6e6e73', size: 10 } }
    ];
    const layout = {
      paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
      margin: { l: 50, r: 15, t: 25, b: 45 }, height: 300, showlegend: false,
      xaxis: { title: { text: `Distancia desde el umbral ${calc.thr} (m)`, font: { color: '#8e8e93', size: 12 } }, range: [0, 3400], color: '#8e8e93', gridcolor: 'rgba(255,255,255,0.06)', zeroline: false },
      yaxis: { title: { text: 'Velocidad (km/h)', font: { color: '#8e8e93', size: 12 } }, range: [0, 320], color: '#8e8e93', gridcolor: 'rgba(255,255,255,0.06)', zeroline: false },
      shapes, annotations
    };
    const data = [{ x: xs, y: ys, type: 'scatter', mode: 'lines', line: { color: '#e8552b', width: 3 }, hovertemplate: '%{x:.0f} m · %{y:.0f} km/h<extra></extra>' }];
    Plotly.react(el, data, layout, { responsive: true, displayModeBar: false });
  }

  // ---------- Semáforo ----------
  function renderSemaforo() {
    const cuenta = est => SEMAFORO.filter(s => s.est === est).length;
    document.getElementById('sem-summary').innerHTML = [
      { f: 'todos', lbl: 'Todos', n: SEMAFORO.length },
      { f: 'verde', lbl: EST_LBL.verde, n: cuenta('verde') },
      { f: 'ambar', lbl: EST_LBL.ambar, n: cuenta('ambar') },
      { f: 'rojo', lbl: EST_LBL.rojo, n: cuenta('rojo') },
      { f: 'gris', lbl: EST_LBL.gris, n: cuenta('gris') }
    ].map(c => `
      <button class="lezg-sem-chip ${filtroSemaforo === c.f ? 'active' : ''}" data-filtro="${c.f}">
        ${c.f !== 'todos' ? `<span class="lezg-dot lezg-dot-${c.f}"></span>` : ''}${c.lbl}<span class="lezg-sem-n">${c.n}</span>
      </button>`).join('');
    const filas = SEMAFORO.filter(s => filtroSemaforo === 'todos' || s.est === filtroSemaforo);
    document.getElementById('sem-table').innerHTML = `
      <thead><tr><th></th><th>Elemento</th><th>Resolución</th><th>Actuación propuesta</th></tr></thead>
      <tbody>${filas.map(s => `
        <tr>
          <td><span class="lezg-dot lezg-dot-${s.est}" title="${EST_LBL[s.est]}"></span></td>
          <td><strong>${s.el}</strong></td>
          <td class="lezg-sem-res lezg-sem-res-${s.est}">${s.res}</td>
          <td>${s.act}</td>
        </tr>`).join('')}</tbody>`;
  }

  // ==========================================
  // Fase 5 · Tema 6: servidumbres aeronáuticas y OLS
  // ==========================================
  // Superficies de aproximación y transición de la cabecera 30R (clave 4, umbral a 254 m)
  const OLS30R = { zThr: 254, zShi: 308, w0: 280, ini: 60, div: 0.15, p1: 0.02, l1: 3000, p2: 0.025, l2: 3600, ltot: 15000, trans: 1 / 7 };
  const OBST_T6 = [
    { lbl: 'Edificio de 45,5 m (A)', x: 1061.71, y: 298.34, z: 248.02, h: 45.52, def: true },
    { lbl: 'Antena de 22 m en el eje (B)', x: 1458.82, y: 4.58, z: 250.0, h: 22.01 },
    { lbl: 'Poste de 10,5 m', x: 694, y: 184, z: 250.4, h: 10.5 }
  ];
  let obst = Object.assign({}, OBST_T6[0]);

  const SEMAFORO_T6 = [
    { el: 'Superficies de aproximación (4 cabeceras)', est: 'verde', res: 'Libres', act: 'Ningún obstáculo no frangible las penetra; margen mínimo de 0,7 m en la 12L (vegetación podable). No hace falta umbral desplazado' },
    { el: 'OFZ de la 30R (CAT II/III)', est: 'verde', res: 'Libre', act: 'Aproximación interna, transición interna y aterrizaje interrumpido sin objetos' },
    { el: 'Transición de la 30R', est: 'rojo', res: 'Edificio de 45,5 m', act: 'Penetra 18,4 m y el plano de la senda de descenso 17,5 m; señalizar, estudio ante AESA y limitar construcciones en 430 m a cada lado' },
    { el: 'Ascenso en el despegue (12L y 12R)', est: 'ambar', res: 'CWY declarada demasiado larga', act: '13 objetos penetran hasta 5,3 m; reducir la CWY a 420 m (12L) y 570 m (12R). No afecta al 787-9: se calcula con el TORA' },
    { el: 'Relieve del suroeste (La Muela)', est: 'rojo', res: 'Supera las OLS', act: 'Hasta 184 m sobre la externa circular y 42 m sobre la horizontal interna; es relieve natural y debe constar en el plan de servidumbres' },
    { el: 'Localizador y senda del ILS 30R', est: 'verde', res: 'Zonas próximas libres', act: 'Ningún objeto supera 20 m (LOC) ni 5 m (GP) en su zona plana; seis objetos de más de 70 m en el sector lejano del LOC' },
    { el: 'VOR/DME ZAR y aerogeneradores', est: 'rojo', res: 'Cinco superan 52 m', act: 'Uno a 9,6 km y otro a 10,01 km del VOR; no autorizar más aerogeneradores en 10 km y pedir estudio de interferencias' },
    { el: 'Servidumbres acústicas', est: 'gris', res: 'No analizadas', act: 'No se dispone de las huellas de ruido del aeropuerto' }
  ];

  function renderT6(container) {
    container.innerHTML = `
      <div class="lezg-phase">
        ${header('Fase 5 · Tema 6 · Servidumbres aeronáuticas',
          'Superficies limitadoras de obstáculos y servidumbres',
          'Con las pistas tal como están en el AIP, se dimensionan las diez superficies limitadoras de obstáculos para la clave 4E del 787-9 y se cruzan con los 949 obstáculos publicados por ENAIRE, con el relieve del IGN y con las zonas de protección del ILS y del VOR/DME. El resultado dice qué construcciones impide la servidumbre y qué se puede dejar como está.')}

        ${kpis([
          { lbl: 'Obstáculos en aproximación', val: '0', sub: 'ninguno penetra · no hace falta umbral desplazado', cls: 'accent' },
          { lbl: 'Edificio sobre la transición 30R', val: '+18,4 m', sub: '45,5 m de altura · sin señalizar', cls: 'highlight', glow: true },
          { lbl: 'Terreno sobre las OLS', val: '116,5 km²', sub: 'de 811,7 km² · meseta de La Muela, hasta 184 m' },
          { lbl: 'Aerogeneradores sobre el límite del VOR', val: '5', sub: 'superan los 52 m · uno a 9,6 km' }
        ])}

        <div class="methodology-block">
          <div class="block-header"><span class="block-number">A</span><h3 class="block-title">Fichas de las superficies</h3></div>
          <p class="block-description">La horizontal interna queda a <strong>308 m</strong>, la cónica sube hasta 408 m y la aproximación pasa de 314 m a 404 m en tres secciones (2 %, 2,5 % y horizontal). La horizontal interna corta la sección primera a 2.760 m del umbral 30R. La cota de cada punto del eje se interpola con el perfil del AIP.</p>
          ${figura('img/lezg/t6_perfil_tipo.jpg', 'Perfil tipo de la superficie de aproximación de la 30R (clave 4): 2 % en 3.000 m, 2,5 % en 3.600 m y sección horizontal hasta 15 km.')}
        </div>

        <div class="methodology-block">
          <div class="block-header"><span class="block-number">B</span><h3 class="block-title">Plano de servidumbres</h3></div>
          <p class="block-description">Las huellas sobre el mapa del IGN: la horizontal interna llega a 4 km de las pistas e incluye Utebo, Casetas y Garrapinillos. Las aproximaciones atraviesan al sureste la plataforma logística y los barrios del sur de Zaragoza.</p>
          ${figura('img/lezg/t6_plano_general.jpg', 'Superficies limitadoras de obstáculos de LEZG sobre el mapa del IGN, con los aerogeneradores del AIP.', 'lezg-figure-narrow')}
          ${figura('img/lezg/t6_plano_detalle.jpg', 'Detalle del entorno: obstáculos que penetran, los cuatro verificados (A a D), radioayudas y terreno por encima de la superficie.')}
        </div>

        <!-- Calculadora de penetración -->
        <div class="methodology-block lezg-calc" id="lezg-calc-t6">
          <div class="block-header"><span class="block-number">C</span><h3 class="block-title">¿Penetra tu obstáculo en la aproximación de la 30R?</h3></div>
          <p class="block-description">Cota límite = cota de la superficie de aproximación, o la de la transición si el obstáculo queda fuera de su ancho. Es el procedimiento de los ejercicios de clase: <strong>ΔZ = (Z<sub>terreno</sub> + h) − Z<sub>lim</sub></strong>. Elige un caso real o mueve los controles.</p>
          <div class="lezg-calc-presets">${OBST_T6.map((p, i) => `<button class="toggle-btn ${p.def ? 'active' : ''}" data-obst="${i}">${p.lbl}</button>`).join('')}</div>
          <div class="lezg-calc-controls">
            <label class="lezg-slider"><span>Distancia al umbral 30R, antes de pista <strong id="t6-x-lbl"></strong></span>
              <input type="range" class="custom-range" id="t6-x" min="100" max="6000" step="10" value="1062" /></label>
            <label class="lezg-slider"><span>Distancia lateral al eje <strong id="t6-y-lbl"></strong></span>
              <input type="range" class="custom-range" id="t6-y" min="0" max="1500" step="5" value="298" /></label>
            <label class="lezg-slider"><span>Cota del terreno <strong id="t6-z-lbl"></strong></span>
              <input type="range" class="custom-range" id="t6-z" min="240" max="300" step="0.5" value="248" /></label>
            <label class="lezg-slider"><span>Altura del obstáculo <strong id="t6-h-lbl"></strong></span>
              <input type="range" class="custom-range" id="t6-h" min="1" max="80" step="0.5" value="45.5" /></label>
          </div>
          <div class="lezg-kpi-grid" id="t6-results"></div>
          <div class="runway-conclusion-box" id="t6-conclusion"></div>
        </div>

        <div class="methodology-block">
          <div class="block-header"><span class="block-number">D</span><h3 class="block-title">Obstáculos críticos y relieve</h3></div>
          <p class="block-description">El edificio A supera la transición 18,4 m y se podría construir hasta 27,2 m en ese punto. La antena B penetra 5,3 m el ascenso en el despegue de la 12L por la zona libre de 690 m; con 420 m deja de hacerlo.</p>
          <div class="lezg-figure-grid">
            ${figura('img/lezg/t6_seccion_a.jpg', 'Sección a 1.062 m del umbral 30R: el edificio A penetra la transición lateral de la aproximación.')}
            ${figura('img/lezg/t6_perfil_se.jpg', 'Perfil del sector sureste: obstáculos y ascenso en el despegue con la zona libre de 690 m y de 420 m.')}
          </div>
          ${figura('img/lezg/t6_relieve.jpg', 'Altura del terreno sobre la superficie limitadora más restrictiva (MDT25 del IGN).', 'lezg-figure-narrow')}
        </div>

        <div class="methodology-block">
          <div class="block-header"><span class="block-number">E</span><h3 class="block-title">Servidumbres radioeléctricas</h3></div>
          <p class="block-description">Las zonas planas del localizador y la senda del ILS 30R están libres; en el VOR/DME, cinco aerogeneradores del AIP superan el límite de 52 m, y el más cercano está a 9,6 km, dentro del cilindro de 10 km.</p>
          ${figura('img/lezg/t6_radio.jpg', 'Zonas de protección del ILS 30R y cilindros y cono del VOR/DME con los aerogeneradores.')}
        </div>

        <div class="methodology-block" id="lezg-semaforo-t6">
          <div class="block-header"><span class="block-number">F</span><h3 class="block-title">Dictamen por elemento</h3></div>
          <div class="table-responsive">
            <table class="compact-table lezg-sem-table">
              <thead><tr><th></th><th>Elemento</th><th>Resolución</th><th>Actuación propuesta</th></tr></thead>
              <tbody>${SEMAFORO_T6.map(s => `
                <tr>
                  <td><span class="lezg-dot lezg-dot-${s.est}" title="${EST_LBL[s.est]}"></span></td>
                  <td><strong>${s.el}</strong></td>
                  <td class="lezg-sem-res lezg-sem-res-${s.est}">${s.res}</td>
                  <td>${s.act}</td>
                </tr>`).join('')}</tbody>
            </table>
          </div>
        </div>

        ${dictamen('<strong>Compatible, con incumplimientos localizados.</strong> La configuración actual admite el 787-9 sin umbral desplazado. Hay que señalizar el edificio de 45,5 m y pedir el estudio aeronáutico a AESA, recortar las zonas libres de obstáculos declaradas de la 12L y la 12R, no autorizar más aerogeneradores en el entorno del VOR/DME y dejar constancia del relieve del suroeste en el plan de servidumbres.')}
      </div>`;

    setupObstacleCalc(container);
  }

  // ---------- Calculadora de penetración (30R) ----------
  function limiteAprox30R(x, y) {
    const o = OLS30R;
    const d = x - o.ini;
    if (d < 0 || d > o.ltot) return null;
    const zAp = o.zThr + o.p1 * Math.min(d, o.l1) + o.p2 * Math.min(Math.max(d - o.l1, 0), o.l2);
    const semi = o.w0 / 2 + o.div * d;
    if (Math.abs(y) <= semi) return { sup: 'Aproximación', zLim: zAp, semi, zAp, d };
    const zTr = zAp + (Math.abs(y) - semi) * o.trans;
    return { sup: zTr >= o.zShi ? 'Horizontal interna' : 'Transición', zLim: Math.min(zTr, o.zShi), semi, zAp, d };
  }

  function setupObstacleCalc(root) {
    const ids = ['x', 'y', 'z', 'h'];
    const inp = {};
    ids.forEach(k => { inp[k] = root.querySelector('#t6-' + k); });
    const btns = root.querySelectorAll('[data-obst]');
    const sync = () => { ids.forEach(k => { inp[k].value = obst[k]; }); updateObstacleCalc(root); };
    ids.forEach(k => inp[k].addEventListener('input', () => {
      obst[k] = +inp[k].value;
      btns.forEach(b => b.classList.remove('active'));
      updateObstacleCalc(root);
    }));
    btns.forEach(b => b.addEventListener('click', () => {
      obst = Object.assign({}, OBST_T6[+b.dataset.obst]);
      btns.forEach(x => x.classList.toggle('active', x === b));
      sync();
    }));
    sync();
  }

  function updateObstacleCalc(root) {
    const set = (id, v) => { root.querySelector(id).textContent = v; };
    set('#t6-x-lbl', fmt(obst.x, 0) + ' m'); set('#t6-y-lbl', fmt(obst.y, 0) + ' m');
    set('#t6-z-lbl', fmt(obst.z, 1) + ' m'); set('#t6-h-lbl', fmt(obst.h, 1) + ' m');
    const r = limiteAprox30R(obst.x, obst.y);
    const zObst = obst.z + obst.h;
    const res = root.querySelector('#t6-results'), concl = root.querySelector('#t6-conclusion');
    if (!r) {
      res.innerHTML = '';
      concl.innerHTML = '<p>El punto queda fuera de la superficie de aproximación (más allá de 15 km o antes del borde interior). Compruébalo contra el resto de superficies.</p>';
      return;
    }
    const dz = zObst - r.zLim;
    const hMax = r.zLim - obst.z;
    const tarjetas = [
      { lbl: 'Superficie que gobierna', val: r.sup, sub: 'semiancho de la aproximación: ' + fmt(r.semi, 1) + ' m' },
      { lbl: 'Cota límite', val: fmt(r.zLim, 2) + ' m', sub: 'cota del obstáculo: ' + fmt(zObst, 2) + ' m' },
      { lbl: dz > 0 ? 'Penetración' : 'Margen', val: (dz > 0 ? '+' : '−') + fmt(Math.abs(dz), 2) + ' m', cls: dz > 0 ? 'accent' : 'highlight', glow: dz > 0, sub: dz > 0 ? 'vulnera la servidumbre' : 'por debajo de la superficie' },
      { lbl: 'Altura máxima permitida', val: fmt(Math.max(hMax, 0), 1) + ' m', sub: 'sobre un terreno de ' + fmt(obst.z, 1) + ' m' }
    ];
    res.innerHTML = tarjetas.map(k => `
      <div class="runway-card ${k.glow ? 'highlight-glow' : ''}">
        <span class="runway-card-lbl">${k.lbl}</span>
        <span class="runway-card-val ${k.cls || ''}">${k.val}</span>
        <span class="runway-card-sub">${k.sub}</span>
      </div>`).join('');
    concl.innerHTML = dz > 0
      ? `<p><strong>Vulnera la servidumbre</strong> en ${fmt(dz, 2)} m. Debe reducirse a ${fmt(Math.max(hMax, 0), 1)} m, reubicarse o justificarse con un estudio aeronáutico o por apantallamiento.</p>`
      : `<p><strong>No penetra.</strong> Queda ${fmt(-dz, 2)} m por debajo de la superficie de ${r.sup.toLowerCase()}.</p>`;
  }

  window.renderLezgFase = function (id, container) {
    ({ t3: renderT3, t4: renderT4, t5: renderT5, t6: renderT6 }[id] || renderT6)(container);
  };
})();
