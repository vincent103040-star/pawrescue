/**
 * Loads .env / .env.local, and does it early enough to matter.
 *
 * This exists because of an ordering bug that only showed up in a real
 * deployment. server.ts called dotenv.config() in its own body, but it also
 * imports ./db -- and an ES module's imports are fully evaluated before any of
 * the importing module's own statements run. So db.ts, which reads
 * ADMIN_PASSWORD and ORGANIZATION_ID while deciding what to migrate, was
 * looking at process.env before dotenv had put anything in it.
 *
 * The symptom was quiet and convincing: setting ADMIN_PASSWORD in .env.local
 * appeared to do nothing at all, and the server rotated the password to a
 * random one instead, exactly as if the variable had never been set. It went
 * unnoticed in local testing because the variable was being passed on the
 * command line there, which puts it in the environment before the process even
 * starts.
 *
 * Importing this module first from db.ts fixes it regardless of who imports
 * what: db.ts cannot begin its own work until this has finished. Importing it
 * more than once is free -- module evaluation happens once.
 *
 * .env is read first and .env.local overrides it, matching how Vite resolves
 * the same pair for the frontend.
 */
import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.local', override: true });
