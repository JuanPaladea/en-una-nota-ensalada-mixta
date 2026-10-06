// Tarjeta del resultado para compartir.
// Se dibuja en un canvas y se comparte como PNG con la Web Share API: no hay
// backend, ni servicio de imágenes, ni datos que salgan del celular. Lo que se
// comparte es la partida que acaban de jugar (nombres y puntos), no un aviso.

const W = 1080, H = 1080;
const FONT = '"Trebuchet MS","Segoe UI",system-ui,sans-serif';
const C = {
  bg:"#140a24", card:"#241443", line:"#4a2f7a",
  magenta:"#ff2e88", amber:"#ffcb2e", cyan:"#25e0d6", lime:"#a6ff3d",
  ink:"#0c0618", paper:"#fff7ec", muted:"#b9a7d6",
};
const MAX_ROWS = 6;   // más equipos que esto no entran legibles: se resumen
const TOPE = 236;     // dónde termina el encabezado
const PIE  = 170;     // franja de abajo reservada para el pie

function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}
// recorta el texto con puntos suspensivos si no entra en el ancho dado
function fit(ctx, txt, max){
  if(ctx.measureText(txt).width <= max) return txt;
  let s = txt;
  while(s.length > 1 && ctx.measureText(s+"…").width > max) s = s.slice(0,-1);
  return s+"…";
}
function glow(ctx, color, blur){
  ctx.shadowColor = color; ctx.shadowBlur = blur;
  ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
}
function noGlow(ctx){ ctx.shadowColor="transparent"; ctx.shadowBlur=0; }

function drawFondo(ctx){
  ctx.fillStyle = C.bg; ctx.fillRect(0,0,W,H);
  // los mismos dos halos que tiene el fondo de la app
  let g = ctx.createRadialGradient(W*0.8, -H*0.1, 0, W*0.8, -H*0.1, W*0.95);
  g.addColorStop(0,"rgba(53,32,94,1)"); g.addColorStop(1,"rgba(53,32,94,0)");
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  g = ctx.createRadialGradient(-W*0.1, H*1.1, 0, -W*0.1, H*1.1, W*0.85);
  g.addColorStop(0,"rgba(42,22,80,1)"); g.addColorStop(1,"rgba(42,22,80,0)");
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  // marco
  ctx.strokeStyle = C.line; ctx.lineWidth = 6;
  roundRect(ctx, 20, 20, W-40, H-40, 40); ctx.stroke();
}

function drawEncabezado(ctx){
  ctx.save();
  ctx.textAlign = "center";
  ctx.translate(W/2, 118);
  ctx.rotate(-2 * Math.PI/180);          // la inclinación del logo de la app
  ctx.font = `900 78px ${FONT}`;
  glow(ctx, "rgba(255,46,136,.55)", 26);
  ctx.fillStyle = C.paper;
  ctx.fillText("EN UNA NOTA", 0, 0);
  noGlow(ctx);
  ctx.restore();

  // pastilla "ensalada mixta"
  ctx.font = `700 30px ${FONT}`;
  const txt = "🥗 ensalada mixta";
  const w = ctx.measureText(txt).width + 52;
  ctx.fillStyle = C.magenta;
  roundRect(ctx, (W-w)/2, 152, w, 54, 27); ctx.fill();
  ctx.fillStyle = C.ink; ctx.textAlign = "center";
  ctx.fillText(txt, W/2, 189);
}

const ALTO_GANADOR = 160;   // alto del bloque "GANÓ / nombre / puntos"

function drawGanador(ctx, orden, y){
  const top = orden[0];
  const campeones = orden.filter(t => t.score === top.score);
  const empate = campeones.length > 1;

  ctx.textAlign = "center";
  ctx.font = `700 34px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(empate ? "EMPATE" : "GANÓ", W/2, y+34);

  ctx.font = `900 62px ${FONT}`;
  glow(ctx, "rgba(166,255,61,.45)", 22);
  ctx.fillStyle = C.lime;
  const nombre = empate
    ? fit(ctx, campeones.map(t=>t.name).join(" y "), W-160)
    : fit(ctx, top.name, W-160);
  ctx.fillText(nombre, W/2, y+100);
  noGlow(ctx);

  ctx.font = `700 30px ${FONT}`;
  ctx.fillStyle = C.amber;
  ctx.fillText(`${top.score} punto${top.score!==1?"s":""}`, W/2, y+148);
  return y + ALTO_GANADOR;
}

function drawTablero(ctx, orden, yIni, alto, sep){
  const medallas = ["🥇","🥈","🥉"];
  const visibles = orden.slice(0, MAX_ROWS);
  const restantes = orden.length - visibles.length;
  const x = 90, ancho = W - 180;
  const mejor = orden[0].score;
  let y = yIni;

  visibles.forEach((t,i)=>{
    // La medalla sale del puntaje, no de la posición en la lista: si empataron,
    // los dos son 🥇. Si no, arriba decía "EMPATE" y abajo uno salía segundo.
    const puesto = orden.filter(o => o.score > t.score).length;
    const gana = t.score === mejor;

    ctx.fillStyle = gana ? C.card : "rgba(36,20,67,.75)";
    roundRect(ctx, x, y, ancho, alto, 18); ctx.fill();
    if(gana){ ctx.strokeStyle = C.lime; ctx.lineWidth = 3; ctx.stroke(); }

    const fs = alto > 70 ? 34 : 29;
    ctx.textAlign = "left";
    ctx.font = `700 ${fs}px ${FONT}`;
    ctx.fillStyle = C.paper;
    ctx.fillText(medallas[puesto] || `${puesto+1}.`, x+26, y+alto/2+fs/3);
    const nx = x + 26 + 62;
    ctx.fillText(fit(ctx, t.name, ancho-230), nx, y+alto/2+fs/3);

    ctx.textAlign = "right";
    ctx.font = `900 ${fs+6}px ${FONT}`;
    ctx.fillStyle = gana ? C.lime : C.cyan;
    ctx.fillText(String(t.score), x+ancho-26, y+alto/2+fs/3);

    y += alto + sep;
  });

  if(restantes > 0){
    ctx.textAlign = "center";
    ctx.font = `700 26px ${FONT}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(`y ${restantes} equipo${restantes!==1?"s":""} más`, W/2, y+30);
  }
}

// "canciones" pierde el acento en plural: no sirve agregarle una "es" a "canción"
function cancionesTxt(n, cola){
  return n === 1 ? `1 canción ${cola}` : `${n} canciones ${cola}s`;
}

// linea: el texto chico arriba de la dirección ("10 canciones cantadas"), o nada
function drawPie(ctx, linea){
  ctx.textAlign = "center";
  if(linea){
    ctx.font = `700 28px ${FONT}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(linea, W/2, H-132);
  }
  ctx.font = `900 40px ${FONT}`;
  glow(ctx, "rgba(37,224,214,.5)", 20);
  ctx.fillStyle = C.cyan;
  ctx.fillText("enunanota.com.ar", W/2, H-72);
  noGlow(ctx);
}

// Dibuja la tarjeta y devuelve el canvas.
export function drawCard(teams, canciones){
  const orden = [...teams].sort((a,b)=> b.score - a.score);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.textBaseline = "alphabetic";
  drawFondo(ctx);
  drawEncabezado(ctx);
  if(orden.length){
    // El bloque ganador + tablero se centra en el espacio que queda entre el
    // encabezado y el pie: con pocos equipos, si no, quedaba un hueco enorme.
    // El alto de fila se calcula para que entre siempre: con filas fijas, 10
    // equipos desbordaban y el tablero se dibujaba encima del pie.
    const filas = Math.min(orden.length, MAX_ROWS);
    const extra = orden.length > filas ? 44 : 0;   // línea "y N equipos más"
    const sep = 14;
    const libre = H - TOPE - PIE - ALTO_GANADOR - 28 - extra;
    const alto = Math.max(46, Math.min(76, Math.floor(libre/filas) - sep));
    const altoTablero = filas*(alto+sep) - sep + extra;
    const total = ALTO_GANADOR + 28 + altoTablero;
    const yIni = TOPE + Math.max(0, (H - TOPE - PIE - total)/2);
    const yTablero = drawGanador(ctx, orden, yIni);
    drawTablero(ctx, orden, yTablero + 28, alto, sep);
  }
  drawPie(ctx, canciones ? cancionesTxt(canciones, "cantada") : "");
  return cv;
}

/* ---- Modo solo ----
   En vez de un tablero, el puntaje grande y una fila de cuadritos por canción
   (como Wordle): el color dice con cuántos segundos la sacó. */
const SOLO_COLS = 10, SOLO_MAX = 30;   // más de 3 filas no entran: se resumen

// Color e inscripción de cada cuadrito. Lo usa también el texto que se comparte.
export function soloTramo(r){
  if(!r.ok) return { color:"#3a2a55", txt:"✕", emoji:"⬛" };
  if(r.seg === 1) return { color:C.lime, txt:"1s", emoji:"🟩" };
  if(r.seg <= 3) return { color:C.amber, txt:r.seg+"s", emoji:"🟨" };
  return { color:"#ff8a3d", txt:r.seg+"s", emoji:"🟧" };
}

const SOLO_GAP = 14;
// lado del cuadrito: grandes si son pocos, más chicos para que entren 10 por fila
function ladoCuadrito(n){
  const cols = Math.min(SOLO_COLS, n);
  return Math.min(96, Math.floor((W - 180 - (cols-1)*SOLO_GAP) / cols));
}

function drawCuadritos(ctx, resultados, y){
  const visibles = resultados.slice(0, SOLO_MAX);
  const gap = SOLO_GAP;
  const lado = ladoCuadrito(visibles.length);
  visibles.forEach((r,i)=>{
    const fila = Math.floor(i / SOLO_COLS);
    const enFila = Math.min(SOLO_COLS, visibles.length - fila*SOLO_COLS);
    const x0 = (W - (enFila*lado + (enFila-1)*gap)) / 2;   // cada fila centrada
    const x = x0 + (i % SOLO_COLS)*(lado+gap);
    const yy = y + fila*(lado+gap);
    const t = soloTramo(r);
    ctx.fillStyle = t.color;
    roundRect(ctx, x, yy, lado, lado, 14); ctx.fill();
    ctx.textAlign = "center";
    ctx.font = `900 ${Math.round(lado*0.36)}px ${FONT}`;
    ctx.fillStyle = r.ok ? C.ink : C.muted;
    ctx.fillText(t.txt, x+lado/2, yy+lado/2+lado*0.13);
  });
  const filas = Math.ceil(visibles.length / SOLO_COLS);
  const fin = y + filas*(lado+gap) - gap;
  if(resultados.length > visibles.length){
    ctx.font = `700 26px ${FONT}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(`y ${resultados.length - visibles.length} más`, W/2, fin + 40);
  }
}

// puntos: total; posibles: el máximo que se podía hacer;
// resultados: [{ok, seg, pts}] por canción; record: true si es récord nuevo
export function drawSoloCard(puntos, posibles, resultados, record){
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.textBaseline = "alphabetic";
  drawFondo(ctx);
  drawEncabezado(ctx);

  const n = resultados.length;
  const vis = Math.min(n, SOLO_MAX);
  const lado = vis ? ladoCuadrito(vis) : 0;
  const altoCuadritos = vis ? Math.ceil(vis/SOLO_COLS)*(lado+SOLO_GAP) - SOLO_GAP + (n > vis ? 44 : 0) : 0;
  const altoPuntos = 40 + 150 + 50 + (record ? 56 : 0);
  const total = altoPuntos + (vis ? 44 + altoCuadritos : 0);
  const y = TOPE + Math.max(0, (H - TOPE - PIE - total)/2);

  ctx.textAlign = "center";
  ctx.font = `700 34px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText("HICE", W/2, y+34);
  ctx.font = `900 150px ${FONT}`;
  glow(ctx, "rgba(166,255,61,.45)", 26);
  ctx.fillStyle = C.lime;
  ctx.fillText(String(puntos), W/2, y+184);
  noGlow(ctx);
  ctx.font = `700 34px ${FONT}`;
  ctx.fillStyle = C.amber;
  ctx.fillText(`punto${puntos!==1?"s":""}${posibles ? ` de ${posibles} posibles` : ""}`, W/2, y+234);
  if(record){
    ctx.font = `900 34px ${FONT}`;
    ctx.fillStyle = C.magenta;
    ctx.fillText("🏅 ¡NUEVO RÉCORD!", W/2, y+290);
  }
  if(vis) drawCuadritos(ctx, resultados, y + altoPuntos + 44);

  drawPie(ctx, n ? `${n} ${n===1 ? "canción" : "canciones"} · un jugador` : "");
  return cv;
}

// JPEG y no PNG a propósito: la misma tarjeta pesa 969 KB en PNG y 94 KB en
// JPEG 0.92, sin diferencia visible. Se manda por datos móviles, así que importa.
function toBlob(cv){
  return new Promise(res => cv.toBlob(res, "image/jpeg", 0.92));
}

/* Comparte la tarjeta ya dibujada (drawCard o drawSoloCard). Devuelve qué pasó,
   para poder avisar bien: 'compartido' | 'cancelado' | 'descargado' | 'error' */
export async function shareCard(cv, texto, url){
  let file = null;
  try{
    const blob = await toBlob(cv);
    if(blob) file = new File([blob], "en-una-nota.jpg", {type:"image/jpeg"});
  }catch(e){ file = null; }

  const mensaje = texto + " " + url;

  // Camino bueno: la imagen entra en el menú de compartir del sistema.
  if(file && navigator.canShare && navigator.canShare({files:[file]})){
    try{
      await navigator.share({ files:[file], title:"En una nota · Ensalada mixta", text:mensaje });
      return "compartido";
    }catch(e){
      if(e && e.name === "AbortError") return "cancelado";
    }
  }
  // Sin compartir archivos (Firefox, escritorio viejo): se baja la imagen y se
  // copia el mensaje, así igual la pueden mandar a mano.
  if(file){
    try{
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file);
      a.download = "en-una-nota.jpg";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=> URL.revokeObjectURL(a.href), 4000);
      try{ await navigator.clipboard.writeText(mensaje); }catch(_){}
      return "descargado";
    }catch(e){}
  }
  // Último recurso: compartir/copiar solo el texto.
  if(navigator.share){
    try{ await navigator.share({ title:"En una nota · Ensalada mixta", text:texto, url }); return "compartido"; }
    catch(e){ if(e && e.name === "AbortError") return "cancelado"; }
  }
  try{ await navigator.clipboard.writeText(mensaje); return "descargado"; }catch(e){}
  return "error";
}
