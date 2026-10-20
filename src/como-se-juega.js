// Página de Cómo se juega: solo texto, así que no carga nada del juego.
// Trae los estilos, la medición y el botón de compartir.
import "./styles.css";
import "./analytics.js";
import { shareGame } from "./share.js";

window.shareGame = shareGame;
// "‹" vuelve a donde estaba si vino del juego; si entró directo (desde Google,
// por ejemplo), el link lleva al juego.
window.volverAtras = ()=>{
  if(document.referrer.startsWith(location.origin) && history.length > 1){ history.back(); return false; }
  return true;
};
