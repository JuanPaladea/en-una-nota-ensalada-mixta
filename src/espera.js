// El vigía del audio: que no quede la pantalla diciendo "Sonando…" en silencio.
//
// YouTube no avisa cuando un video se queda cargando para siempre (poca señal,
// un bloqueador, el video trabado): no hay error, simplemente no suena. Sin
// esto, después de apretar "Reproducir" no pasaba nada y lo único que quedaba
// era irse.
//
// Se arma al pedir el audio (esperar) y se desarma cuando suena de verdad
// (sono) o cuando ya no se espera nada (parar). Si el audio tarda, avisa una
// vez (alDemorar: para decir que está cargando) y si no llega, otra (alFallar:
// para ofrecer qué hacer). No sabe nada del reproductor ni de la pantalla.
export const DEMORA_MS = 2500;   // a partir de acá ya no es "al toque": se dice que está cargando
export const FALLA_MS = 8000;    // a partir de acá se ofrece probar de nuevo o cambiar de canción

export function vigia({ alDemorar, alFallar, demora = DEMORA_MS, falla = FALLA_MS }){
  let tDemora = null, tFalla = null, desde = null;   // desde: cuándo se pidió (null = nadie espera)
  const parar = ()=>{
    clearTimeout(tDemora); clearTimeout(tFalla);
    tDemora = tFalla = null;
  };
  return {
    // Se pidió el audio. Si ya se estaba esperando, la cuenta empieza de nuevo.
    esperar(){
      parar();
      desde = Date.now();
      tDemora = setTimeout(()=>{ tDemora = null; if(alDemorar) alDemorar(); }, demora);
      tFalla = setTimeout(()=>{ tFalla = null; if(alFallar) alFallar(); }, falla);
    },
    // Sonó. Devuelve cuánto tardó (ms) desde que se pidió, o null si nadie lo había pedido.
    sono(){
      const tardo = desde === null ? null : Date.now() - desde;
      parar(); desde = null;
      return tardo;
    },
    // Ya no se espera nada: se cortó, cambió la canción o terminó la partida.
    parar(){ parar(); desde = null; },
  };
}
