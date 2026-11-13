/* ============================================================
   MOVIMIENTO
   Lo que no se puede hacer solo con CSS: números que saltan, puntos que
   vuelan al marcador, papelitos y los indicadores que se deslizan. Todo con
   la Web Animations API (transform y opacity, sin librerías). Con "reducir
   movimiento" activado en el sistema, cada función deja el estado final sin
   mover nada.
   ============================================================ */
const reducir = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
export const calmo = ()=> reducir.matches;

// Las mismas curvas que las variables --ease-* de styles.css
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const EASE_IN_OUT = "cubic-bezier(0.77, 0, 0.175, 1)";

export function animar(el, cuadros, opciones){
  if(!el || !el.animate) return null;
  try{ return el.animate(cuadros, opciones); }catch(_){ return null; }
}

// Lo que cambia de golpe (el título de la fase, los botones) entra con un
// fundido corto en vez de aparecer
export function entrar(el, dy = 8, ms = 220){
  animar(el, calmo() || !dy
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ opacity: 0, transform: `translateY(${dy}px)` }, { opacity: 1, transform: "none" }],
    { duration: ms, easing: EASE_OUT });
}

// El número salta cuando cambia. color: con el que destella (verde si sumó, rojo si restó)
export function golpe(el, color){
  if(calmo()) return;
  const pico = { transform: "scale(1.5)", offset: 0.3, easing: EASE_OUT };
  if(color) pico.color = color;
  animar(el, [{ transform: "scale(1)", easing: EASE_OUT }, pico, { transform: "scale(1)" }], { duration: 480 });
}

// Un "+1" que sube desde el elemento y se desvanece
export function flotar(ancla, texto, color){
  if(calmo() || !ancla || !document.body.animate) return;
  const r = ancla.getBoundingClientRect();
  if(!r.width) return;
  const el = document.createElement("span");
  el.className = "flota";
  el.textContent = texto;
  el.style.color = color;
  el.style.left = (r.left + r.width / 2) + "px";
  el.style.top = r.top + "px";
  document.body.appendChild(el);
  const a = animar(el, [
    { opacity: 0, transform: "translate(-50%, 4px) scale(.8)", easing: EASE_OUT },
    { opacity: 1, transform: "translate(-50%, -16px) scale(1)", offset: 0.3 },
    { opacity: 0, transform: "translate(-50%, -34px) scale(1)" },
  ], { duration: 850 });
  if(a) a.onfinish = a.oncancel = ()=> el.remove(); else el.remove();
}

// Los puntos vuelan desde donde se ganaron hasta el marcador.
// desde: DOMRect de origen · hasta: elemento de destino · alLlegar: se llama
// siempre (también sin animación), es donde se actualiza el número.
export function volar(desde, hasta, texto, alLlegar){
  const llegar = ()=>{ if(alLlegar) alLlegar(); };
  const h = hasta ? hasta.getBoundingClientRect() : null;
  if(calmo() || !desde || !desde.width || !h || !h.width || !document.body.animate){ llegar(); return; }
  const el = document.createElement("span");
  el.className = "vuela";
  el.textContent = texto;
  el.style.left = (desde.left + desde.width / 2) + "px";
  el.style.top = (desde.top + desde.height / 2) + "px";
  document.body.appendChild(el);
  const dx = (h.left + h.width / 2) - (desde.left + desde.width / 2);
  const dy = (h.top + h.height / 2) - (desde.top + desde.height / 2);
  const fin = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.6)`;
  const a = animar(el, [
    { opacity: 0, transform: "translate(-50%, -50%) scale(.7)", easing: EASE_OUT },
    { opacity: 1, transform: "translate(-50%, -50%) scale(1.15)", offset: 0.25, easing: EASE_IN_OUT },
    { opacity: 1, transform: fin, offset: 0.92 },
    { opacity: 0, transform: fin },
  ], { duration: 800 });
  if(!a){ el.remove(); llegar(); return; }
  a.onfinish = a.oncancel = ()=>{ el.remove(); llegar(); };
}
// Al cambiar de pantalla no queda nada volando encima de la nueva
export function cancelarVuelos(){
  document.querySelectorAll(".vuela, .flota, .papelitos").forEach(el=> el.remove());
}

// Cuenta de un número a otro (el marcador de Un jugador)
export function contar(el, desde, hasta, ms = 500){
  cancelAnimationFrame(el._cuenta);
  if(calmo() || desde === hasta){ el.textContent = hasta; return; }
  const t0 = performance.now();
  const paso = (t)=>{
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = Math.round(desde + (hasta - desde) * (1 - Math.pow(1 - k, 3)));
    if(k < 1) el._cuenta = requestAnimationFrame(paso);
  };
  el._cuenta = requestAnimationFrame(paso);
}
// Para fijar el número a mano sin que una cuenta en curso lo pise
export function fijar(el, valor){
  cancelAnimationFrame(el._cuenta);
  el.textContent = valor;
}

// Sacudida corta: se erró
export function temblar(el){
  if(calmo()) return;
  animar(el, [0, -8, 7, -5, 3, 0].map(x=> ({ transform: `translateX(${x}px)` })), { duration: 340, easing: EASE_OUT });
}

/* ---- Papelitos ----
   Dos cañones desde los costados, en un canvas que se saca solo al terminar.
   Es una simulación (gravedad, rozamiento, giro), por eso va con
   requestAnimationFrame y no con CSS. */
const COLORES = ["#ff2e88", "#ffcb2e", "#25e0d6", "#a6ff3d", "#fff7ec"];
export function papelitos(){
  if(calmo()) return;
  document.querySelectorAll(".papelitos").forEach(el=> el.remove());
  const cv = document.createElement("canvas");
  const ctx = cv.getContext && cv.getContext("2d");
  if(!ctx) return;
  cv.className = "papelitos";
  cv.setAttribute("aria-hidden", "true");
  const W = innerWidth, H = innerHeight, dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.scale(dpr, dpr);
  document.body.appendChild(cv);

  // Cada cañón apunta al centro de la parte de arriba, con la fuerza justa
  // para llegar: en un celular parado tira casi vertical y en una compu
  // ancha, más acostado (si no, el medio de la pantalla quedaba vacío).
  const hastaX = W / 2, hastaY = H * 0.6;
  const apunta = Math.atan2(-hastaY, hastaX);
  const fuerza = Math.hypot(hastaX, hastaY) * 2.7;
  const cuantos = Math.min(150, 70 + Math.round(W / 10));
  const ps = Array.from({ length: cuantos }, (_, i)=>{
    const izq = i % 2 === 0;
    const ang = (izq ? apunta : Math.PI - apunta) + (Math.random() - 0.5) * 0.9;
    const v = fuerza * (0.45 + Math.random() * 0.75);
    return {
      x: izq ? -10 : W + 10, y: H * 0.72,
      vx: Math.cos(ang) * v, vy: Math.sin(ang) * v,
      w: 6 + Math.random() * 6, h: 9 + Math.random() * 8,
      giro: Math.random() * 6.28, vgiro: (Math.random() - 0.5) * 14,
      onda: Math.random() * 6.28,
      color: COLORES[i % COLORES.length],
    };
  });
  const DURA = 3200, APAGA = 700;
  let antes = performance.now();
  const t0 = antes;
  const cuadro = (ahora)=>{
    if(!cv.isConnected) return;
    const dt = Math.min(0.034, (ahora - antes) / 1000);
    antes = ahora;
    const pasado = ahora - t0;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = Math.max(0, Math.min(1, (DURA - pasado) / APAGA));
    const roce = Math.pow(0.12, dt);          // pierde casi todo el impulso en un segundo
    ps.forEach(p=>{
      p.vx *= roce; p.vy = p.vy * roce + 900 * dt;
      p.onda += dt * 5;
      p.x += (p.vx + Math.sin(p.onda) * 40) * dt;
      p.y += p.vy * dt;
      p.giro += p.vgiro * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.giro);
      ctx.scale(1, Math.cos(p.onda));         // el papel que gira sobre sí mismo
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if(pasado < DURA) requestAnimationFrame(cuadro); else cv.remove();
  };
  requestAnimationFrame(cuadro);
}

/* ---- Indicadores que se deslizan ---- */
// La pastilla de un selector (.seg): se mueve al botón apretado en vez de
// saltar. La posición sale de cuentas en CSS (columnas iguales, 4px de
// separación), así que no hay que medir nada ni escuchar el resize.
export function pastilla(seg){
  if(!seg) return;
  const botones = [...seg.querySelectorAll("button")];
  const i = botones.findIndex(b=> b.getAttribute("aria-pressed") === "true");
  let p = seg.querySelector(".seg-pill");
  if(!p){
    p = document.createElement("span");
    p.className = "seg-pill";
    p.setAttribute("aria-hidden", "true");
    seg.prepend(p);
    seg.classList.add("con-pill");
  }
  p.hidden = i < 0;
  if(i < 0) return;
  const n = botones.length;
  p.style.width = `calc((100% - ${8 + (n - 1) * 4}px) / ${n})`;
  p.style.transform = `translateX(calc(${i} * (100% + 4px)))`;
}
// La rayita de la barra de abajo del celular: va de una sección a la otra
export function indicadorTabs(){
  const nav = document.querySelector(".tabs");
  if(!nav) return;
  const tabs = [...nav.querySelectorAll(".tab:not([hidden])")];
  const i = tabs.findIndex(t=> t.getAttribute("aria-current") === "page");
  let ind = nav.querySelector(".tabs-ind");
  if(!ind){
    ind = document.createElement("span");
    ind.className = "tabs-ind";
    ind.setAttribute("aria-hidden", "true");
    nav.appendChild(ind);
    nav.classList.add("con-ind");
  }
  ind.hidden = i < 0;
  if(i < 0) return;
  nav.style.setProperty("--n", tabs.length);
  ind.style.transform = `translateX(${i * 100}%)`;
}
