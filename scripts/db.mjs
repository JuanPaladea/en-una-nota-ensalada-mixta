// Ejecuta un archivo SQL contra la base de Neon (DATABASE_URL del .env).
//   npm run db -- db/esquema.sql
//   npm run catalogo:subir
// El archivo puede tener varias sentencias; se corre entero o no se corre.
import { readFileSync } from "node:fs";
import pg from "pg";

const archivo = process.argv[2];
if(!archivo){ console.error("Uso: npm run db -- <archivo.sql>"); process.exit(1); }
if(!process.env.DATABASE_URL){ console.error("Falta DATABASE_URL (copiá .env.example a .env y completalo)."); process.exit(1); }

const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cliente.connect();
try{
  const sql = readFileSync(archivo, "utf8");
  // Sin begin/commit propio, todo el archivo va en una transacción
  const propia = /^\s*begin\s*;/im.test(sql);
  if(!propia) await cliente.query("begin");
  await cliente.query(sql);
  if(!propia) await cliente.query("commit");
  console.log(`${archivo}: listo`);
}catch(e){
  await cliente.query("rollback").catch(()=>{});
  console.error(`${archivo}: ${e.message}`);
  process.exitCode = 1;
}finally{
  await cliente.end();
}
