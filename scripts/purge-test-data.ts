import 'dotenv/config';
import { getFirebaseAdminContext } from '../netlify/functions/_firebaseAdmin';
import { runServerTestDataPurge } from '../netlify/functions/admin-purge';

async function main() {
  const { db, projectId, databaseId } = (() => {
    const ctx = getFirebaseAdminContext();
    return {
      db: ctx.db,
      projectId: process.env.FIREBASE_PROJECT_ID || 'firebase-applet-config',
      databaseId: ctx.databaseId,
    };
  })();

  console.log(`Purge AFRICABANK en cours (projet=${projectId}, db=${databaseId})...`);
  const summary = await runServerTestDataPurge(db, { resetBalances: true });
  console.log('Purge terminée avec succès :', summary);
  process.exit(0);
}

main().catch((err) => {
  console.error('Échec du script de purge :', err);
  process.exit(1);
});
