// Démarrage du serveur : base SQLite (DB_PATH, data/pos.db par défaut), puis API sur HOST:PORT (127.0.0.1:4100).
//   npm start              base existante, ou base vide + administrateur ADMIN_USERNAME / ADMIN_PASSWORD
//   npm start -- --demo    base vide remplie avec les données de démonstration (valeurs provisoires)
//   npm run seed -- --demo crée la base et s'arrête
// Réglages dans server/.env (voir .env.example). Le port 4000 reste à la fausse API / passerelle de la caisse.

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { startBreakline } from "./breakline.js";
import { openDb } from "./db.js";
import { passwordProblem } from "./security.js";
import { isEmpty, seedAdmin, seedDemo } from "./seed.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const env = process.env;

const dbPath = resolve(root, env.DB_PATH ?? "data/pos.db");
mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(dbPath);

if (isEmpty(db)) {
  if (args.has("--demo")) {
    await seedDemo(db);
    console.log(
      "Base créée avec les données de démonstration (admin/admin, responsable/responsable, caissier/caissier).",
    );
  } else if (env.ADMIN_USERNAME && env.ADMIN_PASSWORD) {
    const problem = passwordProblem(env.ADMIN_PASSWORD);
    if (problem) {
      console.error(`ADMIN_PASSWORD refusé : ${problem}`);
      process.exit(1);
    }
    seedAdmin(db, {
      username: env.ADMIN_USERNAME.trim(),
      password: env.ADMIN_PASSWORD,
    });
    console.log(
      `Base créée avec l'administrateur « ${env.ADMIN_USERNAME.trim()} ».`,
    );
  } else {
    console.error(
      "Base vide : lancez avec --demo, ou définissez ADMIN_USERNAME et ADMIN_PASSWORD (server/.env).",
    );
    process.exit(1);
  }
}
if (args.has("--seed-only")) process.exit(0);

// Connexion à BreakLine (facultative : sans BREAKLINE_URL, le POS fonctionne seul). Voir src/breakline.js.
startBreakline(db);

const corsOrigins = env.CORS_ORIGINS
  ? env.CORS_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : null;
const app = createApp({
  db,
  corsOrigins,
  tokenTtlHours: Number(env.TOKEN_TTL_HOURS) || undefined,
});
const port = Number(env.PORT) || 4100;
const host = env.HOST ?? "127.0.0.1";
app.listen(port, host, () => {
  console.log(`Serveur POS sur http://${host}:${port}/api (base : ${dbPath})`);
  if (!corsOrigins)
    console.log(
      "CORS ouvert à toutes les origines : définissez CORS_ORIGINS en production.",
    );
});
