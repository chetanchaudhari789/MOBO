import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
import { loadDotenv } from '../config/dotenvLoader.js';
loadDotenv();

function getDbUrl() {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error('DATABASE_URL is not set.');
        process.exit(1);
    }
    return new URL(url);
}

const dbUrl = getDbUrl();
const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log(`Directory ${MIGRATIONS_DIR} does not exist. Skipping Flyway migrations.`);
    process.exit(0);
}

// Convert format from postgres:// to jdbc:postgresql://
const jdbcUrl = `jdbc:postgresql://${dbUrl.host}${dbUrl.pathname}`;
const user = dbUrl.username;
const password = dbUrl.password;

const args = process.argv.slice(2);
const commandArgs = args.length > 0 ? args : ['info'];

try {
    // Check if flyway binary is installed locally (e.g., in Docker container or dev machine)
    execSync('flyway -v', { stdio: 'ignore' });

    const localCmd = [
        `flyway`,
        `-locations="filesystem:${MIGRATIONS_DIR}"`,
        `-url="${jdbcUrl}"`,
        `-user="${user}"`,
        `-password="${password}"`,
        ...commandArgs
    ].join(' ');

    console.log(`Executing local Flyway: ${commandArgs.join(' ')}`);
    execSync(localCmd, { stdio: 'inherit' });
    process.exit(0);
} catch (error) {
    // Flyway locally not found, proceed to run via Docker
    console.log('Local Flyway binary not found, falling back to Docker...');
}

const dockerCmd = [
    `docker run --rm`,
    `--network host`, // Ensure it can reach localhost databases if needed
    `-v "${MIGRATIONS_DIR}:/flyway/sql"`,
    `flyway/flyway:10-alpine`,
    `-url="${jdbcUrl}"`,
    `-user="${user}"`,
    `-password="${password}"`,
    ...commandArgs
].join(' ');

console.log(`Executing Docker Flyway: ${commandArgs.join(' ')}`);

try {
    execSync(dockerCmd, { stdio: 'inherit' });
} catch (error) {
    console.error('Flyway task failed.');
    process.exit(1);
}
