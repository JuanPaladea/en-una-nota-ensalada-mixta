// Página de Cómo se juega: solo texto, así que no carga nada del juego.
// Trae los estilos, la medición y el botón de compartir.
import "./styles.css";
import "./analytics.js";
import { shareGame } from "./share.js";

window.shareGame = shareGame;
