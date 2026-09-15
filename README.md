# PNOA LiDAR Depth Map

Visor web cenital de las nubes de puntos LiDAR del Plan Nacional de Ortofotografía Aérea. Recibe una coordenada WGS84 y un radio, localiza las teselas que la rodean y genera un mapa de profundidad/elevación con los nodos COPC necesarios.

## Ejecutar

Requiere Node.js 20 o posterior.

```powershell
npm install
npm run dev
```

Abre `http://127.0.0.1:5173`. La primera búsqueda en cada huso descarga el índice público y lo guarda en IndexedDB; las siguientes consultas lo reutilizan.

## Funciones actuales

- Selección por latitud, longitud o clic sobre la ortofoto PNOA.
- Selección automática de ETRS89/UTM 29, 30 y 31; REGCAN95/UTM 28 en Canarias.
- Localización exacta de teselas mediante sus cabeceras COPC.
- Peticiones HTTP parciales: se leen los nodos que intersectan el radio, no el fichero completo.
- Mapa cenital 2D con zoom y desplazamiento.
- Modelo de superficie DSM o terreno filtrado por la clase 2 LiDAR.
- Colormaps Terreno, Viridis, Turbo y escala de grises.
- Presupuesto de 2,5 millones de puntos visibles para limitar memoria y GPU.
- Catálogo persistente en el navegador.

## Datos

Los puntos proceden de PNOA LiDAR, IGN–CNIG, bajo CC BY 4.0. El MVP usa la copia en COPC publicada por [Flai Open LiDAR Data](https://github.com/flai-ai/open-lidar-data); el contenido de los puntos se mantiene y el formato permite lecturas parciales por HTTP. El mapa de contexto usa el WMS oficial PNOA Máxima Actualidad.

La Península y Baleares usan actualmente la segunda cobertura (2015–2021) de la réplica. Canarias usa la tercera (2022–2025). La siguiente integración prevista es añadir el catálogo oficial de la tercera cobertura del CNIG conforme se publique un mecanismo estable de consulta automática.

## Verificación

```powershell
npm test
npm run build
npm run test:smoke
```

La prueba de navegador abre la coordenada `40.43190101842764, -2.6694763767013745`, resuelve cuatro teselas reales, decodifica los nodos LAZ y guarda capturas en `artifacts/`.
