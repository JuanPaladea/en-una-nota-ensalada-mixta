// Compartir el link del juego. Lo usan el inicio, el final de la partida y la
// página de Cómo se juega, por eso vive aparte de main.js.
import { track } from "./analytics.js";

export const SHARE_URL = "https://enunanota.com.ar/";
const SHARE_TEXT = "🎤 En una nota · Ensalada mixta: suena 1 segundo de una canción y tenés que seguir cantando la que sigue. Gratis, sin instalar nada:";

// desde: en qué página se tocó, para distinguirlo en Analytics
export async function shareGame(desde){
  track("compartir", desde ? { que: "link", desde } : { que: "link" });
  if(navigator.share){
    try{ await navigator.share({ title:"En una nota · Ensalada mixta", text:SHARE_TEXT, url:SHARE_URL }); return; }
    catch(e){ if(e && e.name === "AbortError") return; }
  }
  try{
    await navigator.clipboard.writeText(SHARE_TEXT + " " + SHARE_URL);
    alert("¡Link copiado! Pegalo en el grupo y jueguen todos 🎶");
  }catch(e){
    prompt("Copiá el link y compartilo:", SHARE_URL);
  }
}
