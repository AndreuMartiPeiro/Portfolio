/**
 * projects.js — Base de datos de proyectos
 * Para añadir un nuevo proyecto, añade un objeto al array PROJECTS.
 */
const PROJECTS = [
  {
    id: "misil",
    title: "BGM-109 Tomahawk",
    subtitle: "Análisis del misil de crucero: propulsión, aerodinámica y diseño CAD",
    description: "Proyecto integral de ingeniería inversa del misil de crucero Tomahawk: análisis termodinámico del turbofán Williams F107-WR-402, simulación CFD y diseño CAD.",
    tags: ["GasTurb", "ANSYS Fluent", "SolidWorks", "CFD", "Propulsión"],
    image: "img/misil_hero.png",
    status: "En progreso",
    date: "2026",
    sections: [
      {
        id: "diseno",
        title: "Diseño CAD",
        icon: "",
        software: ["SolidWorks 2026", "Python (API de SolidWorks)"],
        summary: "Modelo sólido del BGM-109 a escala ≈ 1:20 (280,8 mm): ojiva tangente, fuselaje cilíndrico, cola troncocónica, alas rectas y tres aletas de cola a 120°.",
        steps: [
          { title: "Modelo 3D interactivo", description: "Gira, acerca y explora el modelo directamente en el navegador.", contentHTML: `<div style="position:relative;border-radius:8px;overflow:hidden;border:1px solid var(--line);margin-top:0.6rem"><iframe src="tomahawk/visor-cad.html" title="Visor 3D" loading="lazy" style="display:block;width:100%;height:460px;border:0" allowfullscreen></iframe></div><p class="timeline-card-desc" style="margin-top:0.6rem"><a href="tomahawk/" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600;text-decoration:none">Abrir la ficha completa del modelo CAD &rarr;</a></p>` },
          { title: "Medidas principales", description: "Medidas extraídas de la geometría exacta (B-rep) del modelo con la API de SolidWorks, en mm.", contentHTML: `<table class="data-table" style="width:100%;margin-top:0.6rem"><thead><tr><th>Componente</th><th>Medida</th></tr></thead><tbody><tr><td>Longitud total</td><td>280,80</td></tr><tr><td>Diámetro del fuselaje</td><td>Ø 26,00</td></tr><tr><td>Ojiva tangente</td><td>L 28,00 · ρ 36,65</td></tr><tr><td>Cola troncocónica</td><td>L 26,00 · Ø 26,00 → 17,31</td></tr><tr><td>Alas rectas</td><td>envergadura 133,00 · cuerda 19,19 · espesor 1,53 (≈ 8 %)</td></tr><tr><td>Aletas (×3 a 120°)</td><td>radio de punta 33,50 · cuerda 15,4–15,8 · flecha 8°</td></tr><tr><td>Esbeltez L/D</td><td>10,8</td></tr><tr><td>Volumen / superficie</td><td>141,6 cm³ / 286,0 cm²</td></tr></tbody></table>` },
          { title: "Planos acotados", description: "Planos dibujados a partir de las medidas exactas del sólido.", images: ["tomahawk/img/plano_alzado.png", "tomahawk/img/plano_planta.png", "tomahawk/img/plano_posterior.png"] },
          { title: "Perfiles del ala y de la aleta", description: "Secciones del ala (cuerda 19,19 mm, espesor 8 %, curvatura ≈ 1 %) y de la aleta (cuerda 15,75 mm, espesor 9 %).", images: ["tomahawk/img/perfiles.png"] },
          { title: "Preparación para CFD", description: "Los bordes de salida en filo de alas y aletas impedían generar una malla válida. Se truncaron a 0,25 mm de espesor con operaciones automatizadas desde Python sobre la API de SolidWorks, manteniendo la longitud y el volumen del modelo. Su efecto estimado en la resistencia es de ≈ +2 %.", image: null }
        ]
      },
      {
        id: "motor",
        title: "Análisis del Motor",
        icon: "",
        software: ["GasTurb 15", "MATLAB R2024b", "Excel"],
        summary: "Análisis termodinámico del turbofán Williams F107-WR-402. Estudio de punto de diseño, paramétrico y off-design.",
        steps: [
          {
            title: "Datos de Partida",
            description: "Condiciones ambientales y diseño termodinámico inicial para simular el motor (Williams F107-WR-402) en GasTurb.",
            contentHTML: `<div class="table-responsive">
              <table>
                <thead><tr><th>Property</th><th>Unit</th><th>Value</th><th>Fuente</th></tr></thead>
                <tbody>
                  <tr class="table-group-header"><td colspan="4">Basic Data</td></tr>
                  <tr><td>Intake Pressure Ratio</td><td>—</td><td>0.97</td><td>Estimado (inlet anular, vuelo subsónico)</td></tr>
                  <tr><td>No (0) or Average (1) Core dP/P</td><td>—</td><td>0</td><td>Estándar para este tipo</td></tr>
                  <tr><td>Inner Fan Pressure Ratio</td><td>—</td><td>2.30</td><td>Estimado (fan 2 etapas + booster 2 etapas, 4 etapas LP total → OPR=13.8)</td></tr>
                  <tr><td>Booster Map Type (0/1/2)</td><td>—</td><td>0</td><td>Off-design, estándar</td></tr>
                  <tr><td>Outer Fan Pressure Ratio</td><td>—</td><td>2.30</td><td>Igual al inner (fan sin dividir en GasTurb, BPR=1)</td></tr>
                  <tr><td>Compr. Interduct Press. Ratio</td><td>—</td><td>0.99</td><td>Estimado (pérdidas mínimas)</td></tr>
                  <tr><td>HP Compressor Pressure Ratio</td><td>—</td><td>6.06</td><td>Estimado → OPR total ≈ 13.8 (OFICIAL)</td></tr>
                  <tr><td>Bypass Duct Pressure Ratio</td><td>—</td><td>0.99</td><td>Estimado (ducto corto, motor compacto)</td></tr>
                  <tr><td>Turb. Interd. Ref. Press. Ratio</td><td>—</td><td>0.99</td><td>Estimado estándar</td></tr>
                  <tr><td>Design Bypass Ratio</td><td>—</td><td>1.0</td><td>OFICIAL</td></tr>
                  <tr><td>Burner Exit Temperature</td><td>K</td><td>1227</td><td>OFICIAL (954°C = 1227 K)</td></tr>
                  <tr><td>Burner Design Efficiency</td><td>—</td><td>0.99</td><td>Estimado estándar</td></tr>
                  <tr><td>Burner Partload Constant</td><td>—</td><td>1.5</td><td>Estimado, off-design only</td></tr>
                  <tr><td>Fuel Heating Value</td><td>MJ/kg</td><td>43.5</td><td>JP-10 / high-density fuel del Tomahawk</td></tr>
                  <tr><td>Overboard Bleed</td><td>kg/s</td><td>0.0</td><td>Motor de misil, sin sangrado externo</td></tr>
                  <tr><td>Power Offtake</td><td>kW</td><td>0.5</td><td>Mínimo (solo alternador del gearbox)</td></tr>
                  <tr><td>HP Spool Mechanical Efficiency</td><td>—</td><td>0.995</td><td>Estimado estándar small engine</td></tr>
                  <tr><td>LP Spool Mechanical Efficiency</td><td>—</td><td>0.995</td><td>Estimado estándar small engine</td></tr>
                  <tr><td>Burner Pressure Ratio</td><td>—</td><td>0.96</td><td>Estimado (combustor anular compacto, 4% pérdida)</td></tr>
                  <tr><td>Turbine Exit Duct Press Ratio</td><td>—</td><td>0.99</td><td>Estimado</td></tr>
                  <tr><td>Hot Stream Mixer Press Ratio</td><td>—</td><td>0.99</td><td>Estimado</td></tr>
                  <tr><td>Cold Stream Mixer Press Ratio</td><td>—</td><td>0.99</td><td>Estimado</td></tr>
                  <tr><td>Mixed Stream Pressure Ratio</td><td>—</td><td>0.99</td><td>Estimado (motor compacto, ducto corto post-mixer)</td></tr>
                  <tr><td>Mixer Efficiency</td><td>—</td><td>0.95</td><td>Estimado estándar mixed exhaust</td></tr>
                  <tr><td>Design Mixer Mach Number</td><td>—</td><td>0</td><td>Estimado</td></tr>
                  <tr><td>Design Mixer Area</td><td>m²</td><td>0.4</td><td>Estimado para empuje de 2.67 kN</td></tr>
                  <tr class="table-group-header"><td colspan="4">Secondary Air System</td></tr>
                  <tr><td>Booster(0) or HPC(1) Handl.Bleed</td><td>—</td><td>0</td><td>LPC (booster)</td></tr>
                  <tr><td>Rel. Handling Bleed to Bypass</td><td>—</td><td>0.0</td><td>Sin handling bleed</td></tr>
                  <tr><td>Rel. Enthalpy of HP Handl.Bleed</td><td>—</td><td>0.5</td><td>Estándar</td></tr>
                  <tr><td>Rel. HP Leakage to Bypass</td><td>—</td><td>0.005</td><td>Fugas mínimas estimadas</td></tr>
                  <tr><td>Rel. Overboard Bleed W_Bld/W25</td><td>—</td><td>0.0</td><td>Sin sangrado</td></tr>
                  <tr><td>Rel. Enthalpy of Overb. Bleed</td><td>—</td><td>0.5</td><td>Estándar</td></tr>
                  <tr><td>Recirculating Bleed W_reci/W25</td><td>—</td><td>0.0</td><td>Off-design only, sin recirculación</td></tr>
                  <tr><td>Rel. Enthalpy of Recirc Bleed</td><td>—</td><td>0.5</td><td>Estándar</td></tr>
                  <tr><td>Number of HP Turbine Stages</td><td>—</td><td>1</td><td>OFICIAL</td></tr>
                  <tr><td>HPT NGV 1 Cooling Air / W25</td><td>—</td><td>0.0</td><td>OFICIAL (turbina uncooled)</td></tr>
                  <tr><td>HPT Rotor 1 Cooling Air / W25</td><td>—</td><td>0.0</td><td>OFICIAL (turbina uncooled)</td></tr>
                  <tr><td>HPT Cooling Air Pumping Dia</td><td>m</td><td>0.08</td><td>Estimado geométrico</td></tr>
                  <tr><td>Number of LP Turbine Stages</td><td>—</td><td>2</td><td>OFICIAL</td></tr>
                  <tr><td>LPT NGV 1 Cooling Air / W25</td><td>—</td><td>0.0</td><td>Sin refrigeración</td></tr>
                  <tr><td>LPT Rotor 1 Cooling Air / W25</td><td>—</td><td>0.0</td><td>Sin refrigeración</td></tr>
                  <tr><td>Rel. Enth. LPT NGV Cooling Air</td><td>—</td><td>0.5</td><td>Estándar</td></tr>
                  <tr><td>Rel. Enth. of LPT Cooling Air</td><td>—</td><td>0.5</td><td>Estándar</td></tr>
                  <tr><td>Rel. HP Leakage to LPT exit</td><td>—</td><td>0.003</td><td>Fugas mínimas estimadas</td></tr>
                  <tr><td>Rel. Fan Overb. Bleed W_Bld/W13</td><td>—</td><td>0.0</td><td>Sin sangrado de fan</td></tr>
                  <tr><td>Core-Byp Heat Transf Effectiven</td><td>—</td><td>0.0</td><td>Sin transferencia de calor</td></tr>
                  <tr><td>Coolg Air Cooling Effectiveness</td><td>—</td><td>0.7</td><td>Estándar (aunque no hay cooling)</td></tr>
                  <tr><td>Bleed Air Cooling Effectiveness</td><td>—</td><td>0.7</td><td>Estándar</td></tr>
                  <tr class="table-group-header"><td colspan="4">Ambient Conditions</td></tr>
                  <tr><td>Total Temperature T1</td><td>K</td><td>291.5</td><td>Equivalente a Mach 0.46</td></tr>
                  <tr><td>Total Pressure P1</td><td>kPa</td><td>116.5</td><td>Equivalente a Mach 0.46</td></tr>
                  <tr><td>Ambient Pressure Pamb</td><td>kPa</td><td>101.0</td><td>Nivel del mar</td></tr>
                  <tr><td>Relative Humidity [%]</td><td>—</td><td>0</td><td>Estándar</td></tr>
                  <tr class="table-group-header"><td colspan="4">Mass Flow</td></tr>
                  <tr><td>Inlet Corr. Flow W2Rstd</td><td>kg/s</td><td>8.0</td><td>Estimado para empuje ~2.9 kN con BPR=1</td></tr>
                  <tr class="table-group-header"><td colspan="4">LPC / Fan Design</td></tr>
                  <tr><td>Nominal LP Spool Speed</td><td>RPM</td><td>35500</td><td>OFICIAL</td></tr>
                  <tr class="table-group-header"><td colspan="4">LPC / Fan Efficiencies</td></tr>
                  <tr><td>Inner LPC Isentr. Efficiency</td><td>—</td><td>0.84</td><td>Estimado (4 etapas axiales LP, ajustado)</td></tr>
                  <tr><td>Outer LPC Isentr. Efficiency</td><td>—</td><td>0.88</td><td>Estimado</td></tr>
                  <tr class="table-group-header"><td colspan="4">HPC Efficiency</td></tr>
                  <tr><td>Isentr. HPC Efficiency</td><td>—</td><td>0.82</td><td>Estimado (compresor centrífugo, ajustado)</td></tr>
                  <tr class="table-group-header"><td colspan="4">HPC Design</td></tr>
                  <tr><td>Nominal HP Spool Speed</td><td>RPM</td><td>60000</td><td>Estimado (centrífugo pequeño, RPM alta típica)</td></tr>
                  <tr class="table-group-header"><td colspan="4">Nozzle</td></tr>
                  <tr><td>Nozzle Thrust Coefficient</td><td>—</td><td>0.985</td><td>Estimado estándar tobera convergente</td></tr>
                  <tr><td>Design Nozzle Petal Angle [deg]</td><td>—</td><td>12</td><td>Estimado estándar</td></tr>
                  <tr class="table-group-header"><td colspan="4">Turbine Efficiencies</td></tr>
                  <tr><td>Isentr. HPT Efficiency</td><td>—</td><td>0.87</td><td>Estimado (1 etapa axial uncooled, ajustado)</td></tr>
                  <tr><td>Isentr. LPT Efficiency</td><td>—</td><td>0.89</td><td>Estimado (2 etapas axiales, ajustado)</td></tr>
                </tbody>
              </table>
            </div>`
          },
          {
            title: "Resultados del Punto de Diseño",
            description: "Resultados numéricos de la simulación del punto de diseño (Mach 0.46). Se detalla el rendimiento general (Overall Performance), eficiencia de componentes y propiedades termodinámicas por estaciones.",
            contentHTML: `<h4 style="margin-bottom: 0.5rem; color: var(--text-primary);">Overall Performance</h4>
<div class="table-responsive">
  <table>
    <thead><tr><th>Parameter</th><th>Value</th><th>Unit</th></tr></thead>
    <tbody>
      <tr><td>Net Thrust (FN)</td><td>2.90</td><td>kN</td></tr>
      <tr><td>Thrust Specific Fuel Consumption (TSFC)</td><td>22.8266</td><td>g/(kN*s)</td></tr>
      <tr><td>Fuel Flow (WF Burner)</td><td>0.06628</td><td>kg/s</td></tr>
      <tr><td>Bypass Ratio (BPR)</td><td>1.0000</td><td>-</td></tr>
      <tr><td>Core Efficiency</td><td>0.3750</td><td>-</td></tr>
      <tr><td>Propulsive Efficiency</td><td>0.4859</td><td>-</td></tr>
      <tr><td>Overall Pressure Ratio (P3/P2)</td><td>14.225</td><td>-</td></tr>
      <tr><td>Nozzle Area (A8)</td><td>0.02619</td><td>m²</td></tr>
      <tr><td>Nozzle Pressure Ratio (P8/Pamb)</td><td>2.11119</td><td>-</td></tr>
      <tr><td>Power Offtake (PWX)</td><td>0.5</td><td>kW</td></tr>
    </tbody>
  </table>
</div>
<h4 style="margin-bottom: 0.5rem; margin-top: 1.5rem; color: var(--text-primary);">Component Efficiencies</h4>
<div class="table-responsive">
  <table>
    <thead><tr><th>Component</th><th>Isentropic</th><th>Polytropic</th><th>Pressure Ratio (P/P)</th></tr></thead>
    <tbody>
      <tr><td>Outer LPC</td><td>0.8600</td><td>0.8753</td><td>2.300</td></tr>
      <tr><td>Inner LPC</td><td>0.8600</td><td>0.8753</td><td>2.300</td></tr>
      <tr><td>HP Compressor</td><td>0.8200</td><td>0.8576</td><td>6.060</td></tr>
      <tr><td>Burner</td><td>0.9900</td><td>-</td><td>0.960</td></tr>
      <tr><td>HP Turbine</td><td>0.8700</td><td>0.8526</td><td>3.235</td></tr>
      <tr><td>LP Turbine</td><td>0.8900</td><td>0.8793</td><td>2.274</td></tr>
      <tr><td>Mixer</td><td>0.9700</td><td>-</td><td>-</td></tr>
    </tbody>
  </table>
</div>
<h4 style="margin-bottom: 0.5rem; margin-top: 1.5rem; color: var(--text-primary);">Station Properties</h4>
<div class="table-responsive">
  <table>
    <thead><tr><th>Station</th><th>Mass Flow (kg/s)</th><th>Total Temp (K)</th><th>Total Press (kPa)</th><th>Velocity (m/s)</th><th>Mach Number</th><th>Area (m²)</th></tr></thead>
    <tbody>
      <tr><td>St 2 (Fan Inlet)</td><td>8.871</td><td>291.50</td><td>113.00</td><td>167.01</td><td>0.500</td><td>0.0444</td></tr>
      <tr><td>St 21 (Fan Exit Inner)</td><td>4.435</td><td>382.28</td><td>267.95</td><td>191.07</td><td>0.500</td><td>0.0107</td></tr>
      <tr><td>St 13 (Fan Exit Outer)</td><td>4.435</td><td>382.28</td><td>251.87</td><td>154.16</td><td>0.400</td><td>0.0136</td></tr>
      <tr><td>St 3 (HPC Exit)</td><td>4.435</td><td>684.54</td><td>1607.54</td><td>103.26</td><td>0.200</td><td>0.0054</td></tr>
      <tr><td>St 4 (Burner Exit)</td><td>4.466</td><td>1227.00</td><td>1543.24</td><td>202.62</td><td>0.300</td><td>0.0053</td></tr>
      <tr><td>St 44 (HPT Exit)</td><td>4.466</td><td>962.68</td><td>477.08</td><td>268.58</td><td>0.450</td><td>0.0106</td></tr>
      <tr><td>St 5 (LPT Exit)</td><td>4.466</td><td>802.94</td><td>207.67</td><td>272.79</td><td>0.500</td><td>0.0205</td></tr>
      <tr><td>St 6 (Mixer Core In)</td><td>4.479</td><td>802.61</td><td>205.60</td><td>120.30</td><td>0.217</td><td>0.0427</td></tr>
      <tr><td>St 16 (Mixer Byp In)</td><td>4.458</td><td>383.82</td><td>249.35</td><td>108.97</td><td>0.280</td><td>0.0188</td></tr>
      <tr><td>St 64 (Mixer Exit)</td><td>8.937</td><td>600.51</td><td>215.38</td><td>193.76</td><td>0.404</td><td>0.0400</td></tr>
      <tr><td>St 8 (Nozzle Throat)</td><td>8.937</td><td>600.51</td><td>213.23</td><td>447.58</td><td>1.000</td><td>0.0256</td></tr>
    </tbody>
  </table>
</div>`
          },
          {
            title: "Estudio Paramétrico — Design Point",
            description: "Análisis paramétrico del punto de diseño. Se han variado la Burner Exit Temperature (1062–1500 K) y el HP Compressor Pressure Ratio (4–10) para estudiar su efecto sobre el consumo específico (TSFC) y el empuje neto (Net Thrust).",
            isParametricStudy: true,
            isExpandedByDefault: true,
            downloadFile: "data/DatosExportados.xlsx",
            substeps: [
              {
                title: "Consumo Específico (TSFC)",
                description: "El <strong>Thrust Specific Fuel Consumption (TSFC)</strong> mide los gramos de combustible que se consumen por cada kN de empuje generado cada segundo. Es el indicador clave de eficiencia para maximizar el alcance del misil.<br><br><strong>Conclusión del análisis:</strong> La superficie revela un claro 'valle' de consumo mínimo. A bajas temperaturas y relaciones de compresión muy altas, el trabajo requerido por el compresor penaliza severamente el ciclo termodinámico (creando un pico de alto consumo). Aunque el mínimo matemático absoluto se ubica hacia relaciones de compresión muy elevadas (PR > 9), la ganancia en eficiencia es marginal y requeriría un diámetro de compresor prohibitivo para el empaquetado del misil.",
                chartId: "chart-tsfc",
                chartType: "surface3d",
                chartConfig: "tsfc"
              },
              {
                title: "Empuje Neto (Net Thrust)",
                description: "El <strong>empuje neto (Net Thrust)</strong> es la fuerza útil que genera el motor para propulsar el misil, descontando las pérdidas por entrada de aire. El objetivo es asegurar un empuje suficiente en régimen de crucero (~2.9 kN).<br><br><strong>Conclusión del análisis:</strong> El mapa tridimensional demuestra que el empuje crece linealmente al incrementar la temperatura de entrada a la turbina (debido al mayor contenido energético de los gases). Sin embargo, disminuye de forma constante a medida que aumenta la relación de compresión, ya que la turbina debe extraer más energía del flujo principal para impulsar el compresor, reduciendo la energía cinética disponible en la tobera.",
                chartId: "chart-thrust",
                chartType: "surface3d",
                chartConfig: "thrust"
              },
              {
                title: "Carpet Plot: Trade-Off Thrust vs TSFC",
                description: "El <strong>Carpet Plot</strong> es la herramienta definitiva en la industria para tomar decisiones top-level de arquitectura de motor. Cruza simultáneamente las variables de diseño (temperatura y compresión) frente a las de rendimiento (empuje y consumo).<br><br><strong>Conclusión del análisis (Punto de Diseño F107):</strong> La selección final del motor F107-WR-402 (marcada en rojo con 2.90 kN de empuje y 22.83 g/kN·s de consumo) demuestra un diseño de compromiso magistral. Al fijar un HP PR = 6.06 y una TET = 1227 K, se sacrifica un pequeño porcentaje de eficiencia termodinámica frente al mínimo absoluto del valle de consumo, pero a cambio se obtiene un motor sustancialmente más ligero, compacto (menor diámetro frontal crítico para la aerodinámica del misil) y capaz de sostener el régimen de empuje requerido.",
                chartId: "chart-carpet",
                chartType: "carpet2d",
                chartConfig: "carpet"
              }
            ]
          },
          {
            title: "Estudio Off-Design",
            description: "Análisis del comportamiento del motor fuera de su punto de diseño. Se han simulado 8 condiciones de vuelo representativas del perfil de misión del Tomahawk, variando el número de Mach de 0.30 a 0.85 a nivel del mar (ISA). El limitador de temperatura T41 = 1227 K está activo en todos los casos.",
            isOffDesignStudy: true,
            isExpandedByDefault: true,
            contentHTML: `<h4 style="margin-bottom: 0.5rem; color: var(--text-primary);">Metodología: Puntos de Estudio</h4>
<p class="timeline-card-desc" style="margin-bottom: 1rem;">Para simular distintas velocidades de vuelo en GasTurb (modo T1/P1/Pamb), se calcularon las condiciones de entrada al motor usando las <strong>relaciones isentrópicas de flujo compresible</strong> y la <strong>atmósfera estándar ISA a nivel del mar</strong> (T<sub>s</sub> = 288.15 K, P<sub>s</sub> = 101.325 kPa):</p>
<div style="background: rgba(232,85,43,0.06); border: 1px solid rgba(232,85,43,0.15); border-radius: 8px; padding: 0.8rem 1.2rem; margin-bottom: 1.2rem; font-family: 'JetBrains Mono', monospace; font-size: 0.82rem; color: var(--text-secondary); line-height: 1.8;">
  T₁ = T<sub>s</sub> × (1 + 0.2 × M²)<br>
  P₁ = P<sub>s</sub> × (1 + 0.2 × M²)<sup>3.5</sup>
</div>
<div class="table-responsive">
  <table>
    <thead><tr><th>Punto</th><th>Fase de Vuelo</th><th>Mach</th><th>T1 [K]</th><th>P1 [kPa]</th><th>Pamb [kPa]</th></tr></thead>
    <tbody>
      <tr><td>1</td><td>Post-booster (arranque F107)</td><td>0.30</td><td>293.0</td><td>107.8</td><td>101.3</td></tr>
      <tr style="background: rgba(232,85,43,0.08);"><td>2</td><td>Punto de Diseño</td><td>0.46</td><td>291.5</td><td>116.5</td><td>101.0</td></tr>
      <tr><td>3</td><td>Aceleración intermedia</td><td>0.50</td><td>303.0</td><td>120.0</td><td>101.3</td></tr>
      <tr><td>4</td><td>Transición a crucero</td><td>0.60</td><td>309.0</td><td>129.0</td><td>101.3</td></tr>
      <tr><td>5</td><td>Crucero económico</td><td>0.65</td><td>312.5</td><td>134.6</td><td>101.3</td></tr>
      <tr><td>6</td><td>Crucero nominal</td><td>0.72</td><td>318.0</td><td>143.2</td><td>101.3</td></tr>
      <tr><td>7</td><td>Crucero rápido</td><td>0.80</td><td>325.1</td><td>154.6</td><td>101.3</td></tr>
      <tr><td>8</td><td>Sprint final al objetivo</td><td>0.85</td><td>330.0</td><td>162.0</td><td>101.3</td></tr>
    </tbody>
  </table>
</div>
<h4 style="margin-bottom: 0.5rem; margin-top: 1.5rem; color: var(--text-primary);">Resultados Off-Design</h4>
<p class="timeline-card-desc" style="margin-bottom: 1rem;">El limitador de TET (Active Limiter T41 = 1227 K) se activó en los <strong>8 puntos</strong>, confirmando que el motor opera al máximo térmico permitido en toda la envolvente de vuelo.</p>
<div class="table-responsive">
  <table>
    <thead><tr><th>Mach</th><th>Net Thrust [kN]</th><th>Gross Thrust [kN]</th><th>TSFC [g/(kN·s)]</th><th>Fuel Flow [kg/s]</th><th>OPR</th><th>ΔT Combustor [K]</th></tr></thead>
    <tbody>
      <tr><td>0.30</td><td>2.858</td><td>3.693</td><td>21.23</td><td>0.0607</td><td>14.10</td><td>541</td></tr>
      <tr style="background: rgba(232,85,43,0.08);"><td><strong>0.46</strong></td><td><strong>2.885</strong></td><td><strong>4.247</strong></td><td><strong>22.91</strong></td><td><strong>0.0661</strong></td><td><strong>14.20</strong></td><td><strong>542</strong></td></tr>
      <tr><td>0.50</td><td>2.684</td><td>4.178</td><td>23.64</td><td>0.0635</td><td>13.43</td><td>534</td></tr>
      <tr><td>0.60</td><td>2.644</td><td>4.528</td><td>24.78</td><td>0.0655</td><td>13.02</td><td>~527</td></tr>
      <tr><td>0.65</td><td>2.625</td><td>4.731</td><td>25.40</td><td>0.0667</td><td>12.76</td><td>~521</td></tr>
      <tr><td>0.72</td><td>2.589</td><td>5.008</td><td>26.30</td><td>0.0681</td><td>12.34</td><td>~514</td></tr>
      <tr><td>0.80</td><td>2.543</td><td>5.349</td><td>27.38</td><td>0.0697</td><td>11.80</td><td>~505</td></tr>
      <tr><td>0.85</td><td>2.506</td><td>5.547</td><td>28.06</td><td>0.0703</td><td>11.45</td><td>514</td></tr>
    </tbody>
  </table>
</div>
<h4 style="margin-bottom: 0.5rem; margin-top: 1.5rem; color: var(--text-primary);">Gráfico Interactivo: Rendimiento vs Mach</h4>
<p class="timeline-card-desc" style="margin-bottom: 1rem;">El gráfico muestra tres magnitudes clave en función de la velocidad de vuelo:<br>
• <strong style="color: var(--accent);">Net Thrust (empuje neto)</strong> — La fuerza útil que realmente propulsa el misil. Equivale al empuje bruto menos la resistencia ram (coste de capturar el aire). Es la métrica que define si el misil puede mantener o acelerar su velocidad.<br>
• <strong style="color: rgba(232,85,43,0.6);">Gross Thrust (empuje bruto)</strong> — La fuerza total generada por los gases que salen de la tobera, sin descontar el coste de la entrada de aire. Crece con el Mach gracias al efecto ram (más aire comprimido entra al motor).<br>
• <strong style="color: var(--tertiary);">TSFC (consumo específico)</strong> — Gramos de combustible consumidos por cada kN de empuje por segundo. Más alto = peor eficiencia. Determina el alcance máximo del misil.<br><br>
La <strong>zona verde sombreada</strong> marca la ventana de crucero operativo del Tomahawk (Mach 0.65–0.72), donde se equilibra empuje suficiente con consumo aceptable.</p>
<div class="chart-container" id="chart-offdesign-profile" data-chart-type="offdesign" data-chart-config="flightprofile"></div>
<h4 style="margin-bottom: 0.5rem; margin-top: 1.5rem; color: var(--text-primary);">Análisis de las Tendencias</h4>
<p class="timeline-card-desc"><strong>Empuje neto:</strong> Desciende un 13% (de 2.885 a 2.506 kN) al pasar del punto de diseño a Mach 0.85. Aunque el empuje bruto casi se duplica (3.69 → 5.55 kN) gracias al efecto ram, la resistencia ram crece aún más rápido (de 0.83 a 3.04 kN).</p>
<p class="timeline-card-desc" style="margin-top: 0.5rem;"><strong>Consumo (TSFC):</strong> Aumenta un 32% (de 21.2 a 28.1 g/(kN·s)). La razón termodinámica: a Mach alto, el aire entra al motor a 330 K. Como la turbina no puede superar 1227 K (sin refrigeración), el margen de temperatura para quemar combustible (ΔT combustor) se reduce de 541 K a 514 K.</p>
<p class="timeline-card-desc" style="margin-top: 0.5rem;"><strong>OPR:</strong> Cae de 14.2 a 11.5. El aire caliente y presurizado por el efecto ram "le quita trabajo" al compresor, que opera progresivamente fuera de su punto óptimo a mayor Mach.</p>`
          },
          {
            title: "Conclusiones del Análisis del Motor",
            description: "",
            contentHTML: `<div style="margin-bottom: 1.5rem;">
<h4 style="margin-bottom: 0.5rem; color: var(--text-primary);">Validación del Diseño del F107-WR-402</h4>
<p class="timeline-card-desc">El análisis completo en GasTurb (Design Point + Estudio Paramétrico + Off-Design) permite extraer las siguientes conclusiones sobre la ingeniería del turbofán Williams F107-WR-402 que propulsa el misil de crucero Tomahawk BGM-109:</p>
</div>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
  <div style="background: rgba(232,85,43,0.04); border: 1px solid rgba(232,85,43,0.15); border-radius: 8px; padding: 1.2rem;">
    <div style="font-size: 0.7rem; color: var(--accent-cyan); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 0.3rem;">Punto de Diseño</div>
    <div style="font-size: 1.8rem; font-weight: 700; color: var(--text-primary); font-family: var(--font-display);">2.90 kN</div>
    <div style="font-size: 0.8rem; color: var(--text-muted);">Empuje neto a Mach 0.72 en crucero</div>
  </div>
  <div style="background: rgba(232,85,43,0.04); border: 1px solid rgba(232,85,43,0.15); border-radius: 8px; padding: 1.2rem;">
    <div style="font-size: 0.7rem; color: var(--accent-cyan); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 0.3rem;">Consumo</div>
    <div style="font-size: 1.8rem; font-weight: 700; color: var(--text-primary); font-family: var(--font-display);">22.83 <span style="font-size: 0.9rem; font-weight: 400;">g/(kN·s)</span></div>
    <div style="font-size: 0.8rem; color: var(--text-muted);">TSFC en punto de diseño (BPR = 1.0)</div>
  </div>
  <div style="background: rgba(232,85,43,0.04); border: 1px solid rgba(232,85,43,0.15); border-radius: 8px; padding: 1.2rem;">
    <div style="font-size: 0.7rem; color: var(--accent-cyan); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 0.3rem;">Off-Design</div>
    <div style="font-size: 1.8rem; font-weight: 700; color: var(--text-primary); font-family: var(--font-display);">8 <span style="font-size: 0.9rem; font-weight: 400;">puntos</span></div>
    <div style="font-size: 0.8rem; color: var(--text-muted);">Mach 0.30 – 0.85 validados sin convergencia</div>
  </div>
</div>
<h4 style="margin-bottom: 0.5rem; color: var(--text-primary);">¿Por qué el Tomahawk vuela a Mach 0.72?</h4>
<p class="timeline-card-desc">El análisis Off-Design demuestra que la velocidad de crucero no es arbitraria, sino el resultado de un compromiso de ingeniería:</p>
<ul style="color: var(--text-secondary); font-size: 0.9rem; line-height: 1.8; padding-left: 1.2rem; margin: 0.8rem 0 1.2rem;">
  <li><strong>A menor velocidad (Mach 0.3–0.5):</strong> el motor es más eficiente (TSFC ↓), pero el misil tarda demasiado en llegar al objetivo, siendo vulnerable a defensas antiaéreas.</li>
  <li><strong>A mayor velocidad (Mach 0.8–0.85):</strong> el consumo sube un 32%, reduciendo el alcance de ~2500 km a ~1900 km. Inaceptable para las misiones de largo alcance del Tomahawk.</li>
  <li><strong>Mach 0.72 (crucero nominal):</strong> equilibra alcance (~2500 km con 400 kg JP-10), tiempo de vuelo, empuje disponible (2.59 kN, suficiente para vencer la resistencia aerodinámica) y supervivencia del motor sin refrigeración.</li>
</ul>
<h4 style="margin-bottom: 0.5rem; color: var(--text-primary);">Éxito de la Ingeniería Inversa</h4>
<p class="timeline-card-desc">Partiendo de solo 8 datos oficiales del F107 (OPR, BPR, TET, número de etapas de turbina, ausencia de refrigeración, velocidad LP, combustible JP-10) y estimando el resto mediante iteración termodinámica, el modelo de GasTurb ha logrado reproducir con alta fidelidad el rendimiento documentado del motor real:</p>
<div class="table-responsive" style="margin-top: 0.8rem;">
  <table>
    <thead><tr><th>Parámetro</th><th>Valor Oficial/Referencia</th><th>Nuestro Modelo GasTurb</th><th>Desviación</th></tr></thead>
    <tbody>
      <tr><td>Empuje neto (crucero)</td><td>~2.67 kN (oficial)</td><td>2.90 kN</td><td>+8.6%</td></tr>
      <tr><td>TSFC</td><td>~0.7 lb/lbf/h (~19.6 g/kN·s)</td><td>22.83 g/kN·s</td><td>+16%</td></tr>
      <tr><td>Overall Pressure Ratio</td><td>13.8</td><td>14.2</td><td>+2.9%</td></tr>
      <tr><td>Bypass Ratio</td><td>1.0</td><td>1.0</td><td>Exacto</td></tr>
    </tbody>
  </table>
</div>
<p class="timeline-card-desc" style="margin-top: 0.8rem;">Las desviaciones del 8–16% son aceptables en un análisis de ciclo termodinámico 0D/1D sin datos internos del fabricante. Las diferencias se atribuyen a la falta de datos de eficiencia de componentes reales y a las simplificaciones del modelo (tobera ideal, sin pérdidas por instalación, sin efectos de afterbody del misil). En un entorno académico, este nivel de concordancia valida la metodología de ingeniería inversa empleada.</p>`
          }
        ]
      },
      {
        id: "aerodinamica",
        title: "Análisis Aerodinámico",
        icon: "",
        software: ["ANSYS Discovery", "ANSYS Meshing", "ANSYS Fluent 2026 R1", "CFD-Post", "PyVista · three.js"],
        summary: "Flujo externo compresible a Mach 0,72 a nivel del mar (crucero nominal del F107): coeficientes aerodinámicos, campo de flujo y visor 3D interactivo de los resultados.",
        steps: [
          { title: "Resultados en 3D", description: "Visor interactivo de la solución: número de Mach y presión alrededor del misil, presión y fricción sobre su superficie, y líneas de corriente. Pasa el cursor para leer los valores.", contentHTML: `<div style="position:relative;border-radius:8px;overflow:hidden;border:1px solid var(--line);margin-top:0.6rem"><iframe src="tomahawk/cfd/?embed=1" title="Visor 3D" loading="lazy" style="display:block;width:100%;height:560px;border:0" allowfullscreen></iframe></div><p class="timeline-card-desc" style="margin-top:0.6rem"><a href="tomahawk/cfd/" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600;text-decoration:none">Abrir el análisis CFD completo &rarr;</a></p>` },
          { title: "Efecto del ángulo de ataque", description: "Cinco soluciones entre 0° y 8° de ángulo de ataque a Mach 0,72. La sustentación pasa de CL = 0,22 a 3,7 y la resistencia se multiplica por 2,5; la eficiencia aerodinámica máxima (L/D ≈ 5,4) se da hacia 4°, donde además el flujo empieza a oscilar. Cambia de ángulo o pulsa Evolución para ver cómo se transforma el flujo.", contentHTML: `<div style="position:relative;border-radius:8px;overflow:hidden;border:1px solid var(--line);margin-top:0.6rem"><iframe src="tomahawk/cfd/aoa.html?embed=1" title="Barrido de ángulo de ataque" loading="lazy" style="display:block;width:100%;height:640px;border:0" allowfullscreen></iframe></div><p class="timeline-card-desc" style="margin-top:0.6rem"><a href="tomahawk/cfd/aoa.html" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600;text-decoration:none">Abrir el barrido de ángulo de ataque completo &rarr;</a></p>` },
          { title: "Dominio y malla", description: "Volumen de control en ANSYS Discovery (1,0 m delante, 2,5 m detrás y 0,85 m a los lados) y malla no estructurada en ANSYS Meshing, dentro del límite de un millón de celdas de la licencia Student. La primera capa se dimensionó para y⁺ ≈ 30.", contentHTML: `<table class="data-table" style="width:100%;margin-top:0.6rem"><thead><tr><th>Parámetro</th><th>Valor</th></tr></thead><tbody><tr><td>Celdas</td><td>471 730</td></tr><tr><td>Tipo</td><td>tetraedros + 5 capas de prismas</td></tr><tr><td>Tamaño en el misil</td><td>3 mm</td></tr><tr><td>Primera capa</td><td>0,12 mm</td></tr><tr><td>y⁺ medio / máximo</td><td>30,9 / 75,4</td></tr><tr><td>Calidad ortogonal mínima</td><td>0,024</td></tr></tbody></table>` },
          { title: "Configuración del solver", description: "ANSYS Fluent, solver basado en presión acoplado y estacionario, discretización de segundo orden.", contentHTML: `<table class="data-table" style="width:100%;margin-top:0.6rem"><thead><tr><th>Apartado</th><th>Ajuste</th></tr></thead><tbody><tr><td>Aire</td><td>gas ideal + viscosidad de Sutherland</td></tr><tr><td>Turbulencia</td><td>k-ω SST</td></tr><tr><td>Contorno exterior</td><td>pressure far-field: Mach 0,72 · 101 325 Pa · 288,15 K</td></tr><tr><td>Velocidad</td><td>244,9 m/s</td></tr><tr><td>Ángulo de ataque</td><td>0°</td></tr><tr><td>Referencias</td><td>A = 531 mm² (sección frontal) · D = 26 mm</td></tr></tbody></table>` },
          { title: "Convergencia y validación", description: "1000 iteraciones; el Cd se estabiliza con una oscilación inferior al 0,01 %. La presión en la punta de la ojiva (142,8 kPa) reproduce la presión de remanso isentrópica (143,1 kPa) con un −0,2 % de diferencia, y coincide con la presión de entrada P1 del motor a Mach 0,72 (143,2 kPa).", images: ["tomahawk/cfd/img/convergencia_cd.png"] },
          { title: "Coeficientes aerodinámicos", description: "Coeficientes referidos a la sección frontal del fuselaje. Casi la mitad de la resistencia es fricción, por la gran superficie mojada de un misil tan esbelto (L/D ≈ 11).", contentHTML: `<table class="data-table" style="width:100%;margin-top:0.6rem"><thead><tr><th>Coeficiente</th><th>Presión</th><th>Fricción</th><th>Total</th></tr></thead><tbody><tr><td>Cd</td><td>0,175</td><td>0,161</td><td><strong>0,336</strong></td></tr><tr><td>Cl</td><td>0,216</td><td>0,000</td><td><strong>0,216</strong></td></tr><tr><td>Cz (lateral)</td><td>−0,003</td><td>0,000</td><td>−0,003</td></tr></tbody></table><table class="data-table" style="width:100%;margin-top:0.6rem"><thead><tr><th>Magnitud</th><th>Valor</th></tr></thead><tbody><tr><td>Cm (respecto al CdG)</td><td>0,228</td></tr><tr><td>Resistencia del modelo</td><td>6,55 N</td></tr><tr><td>Mach local máximo</td><td>0,91</td></tr></tbody></table>` },
          { title: "Campo de flujo", description: "Líneas de flujo sobre la superficie (esfuerzo cortante) y coeficiente de presión, renderizados en CFD-Post. El flujo sale en estrella del punto de remanso de la ojiva, alcanza su fricción máxima en el hombro y se desvía alrededor de la raíz del ala.", images: ["tomahawk/cfd/img/cfdpost_flujo_3q.png", "tomahawk/cfd/img/cfdpost_cp.png", "tomahawk/cfd/img/cfdpost_flujo_lateral.png"] },
          { title: "Informe técnico", description: "Proceso completo paso a paso, desde la preparación de la geometría hasta la validación de resultados.", contentHTML: `<p class="timeline-card-desc" style="margin-top:0.6rem"><a href="tomahawk/docs/Informe_CFD_Tomahawk.pdf" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600;text-decoration:none">Descargar el informe CFD (PDF) &rarr;</a></p>` }
        ]
      },
      {
        id: "conclusiones",
        title: "Conclusiones",
        icon: "",
        software: [],
        summary: "Resumen de resultados, lecciones aprendidas y trabajo futuro.",
        steps: [
          { title: "Resultados principales", description: "<strong>Motor F107:</strong> 2,90 kN de empuje neto en el punto de diseño y 2,59 kN en crucero nominal (Mach 0,72), con un consumo específico de 26,3 g/(kN·s). <strong>Aerodinámica (CFD, Mach 0,72, α = 0°):</strong> Cd = 0,336, repartido entre presión (52 %) y fricción (48 %). Extrapolada a escala real (Ø 0,52 m), la resistencia es de 2,2–2,6 kN (con y sin corrección de Reynolds), del mismo orden que el empuje en crucero: el motor está dimensionado para sostener el crucero a Mach ≈ 0,7, coherente con el Tomahawk real. <strong>Barrido de ángulo de ataque (0°–8°):</strong> el CL pasa de 0,22 a 3,71 y el CD de 0,336 a 0,833; la eficiencia máxima, L/D ≈ 5,4, se da hacia α = 4°, donde el flujo presenta oscilaciones (el campo mostrado es una instantánea y los coeficientes son medias).", image: null },
          { title: "Lecciones aprendidas", description: "La integración multidisciplinar reveló acoplimientos importantes entre geometría, propulsión y aerodinámica. Experiencia adquirida en SolidWorks, ANSYS Fluent y CEA.", image: null },
          { title: "Trabajo futuro", description: "Análisis de estabilidad estática a partir del momento de cabeceo del barrido de ángulo de ataque (ya realizado entre 0° y 8°; falta contrastar el criterio de signo del momento), barrido de Mach frente a la curva de empuje del F107, estimación del alcance combinando la polar aerodinámica con el TSFC, estudio de independencia de malla y análisis estructural de las alas con las cargas del CFD.", image: null }
        ]
      }
    ]
  },
  {
    id: "zaragoza",
    title: "Aeropuerto de Zaragoza (LEZG): planificación del lado aire",
    subtitle: "De la previsión de demanda a 2050 al diseño de pistas, calles de rodaje y plataforma con el Boeing 787-9 como aeronave crítica",
    description: "Estudio por fases del Aeropuerto de Zaragoza: previsión econométrica de la demanda hasta 2050, impacto del Boeing 787-9, orientación de pistas por vientos y auditoría del sistema de rodadura y plataforma según el Anexo 14 de la OACI.",
    tags: ["Ingeniería Aeroportuaria", "Previsión de Demanda", "Anexo 14 OACI", "Lado aire", "AENA"],
    image: "img/zaragoza.png",
    status: "Completado",
    date: "2026",
    sections: []
  },
  {
    id: "seguimiento-leo",
    title: "Seguimiento de un satélite de órbita baja desde una estación terrena",
    subtitle: "Pasada orbital, PID digital del pedestal, pérdida de apuntamiento del haz, balance del enlace, telemetría modulada y control de actitud con volante de inercia, en una sola cadena de simulación",
    description: "Simulador interactivo que encadena la pasada de un satélite LEO, el lazo de seguimiento del pedestal (PID digital corregido de la Práctica 1), la pérdida por error de apuntamiento con el diagrama del reflector (Práctica 4), el alcance y el margen del enlace, la telemetría en DSB, AM y FM con el VOR como caso de estudio (Práctica 3) y el control de actitud del satélite en un eje con un volante de inercia saturable y descarga por magnetopares, que comprueba si el volante aguanta el giro que pide la pasada.",
    tags: ["Control digital", "PID", "Mecánica orbital", "Antenas", "Radar", "Modulación", "Control de actitud", "Simulación"],
    image: "img/seguimiento_leo.jpg",
    imagePos: "50% 62%",
    status: "En progreso",
    date: "2026",
    view: "servo",
    sections: []
  }
];
