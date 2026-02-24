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
// Resolve MIGRATIONS_DIR dynamically based on where the script is executed from
const isRoot = !__dirname.includes('backend/scripts') || process.cwd().endsWith('backend');
const baseDir = process.cwd().endsWith('backend') ? process.cwd() : path.join(process.cwd(), 'backend');
const MIGRATIONS_DIR = path.resolve(baseDir, 'db/migrations');

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

    // Flyway requires filesystem locations to be formatted properly.
    // Replace backslashes with forward slashes for cross-platform compatibility.
    const normalizedDir = MIGRATIONS_DIR.replace(/\\/g, '/');

    const localCmd = [
        `flyway`,
        `-locations="filesystem:${normalizedDir}"`,
        `-url="${jdbcUrl}"`,
        `-user="${user}"`,
        `-password="${password}"`,
        ...commandArgs
    ].join(' ');

    console.log(`Executing local Flyway: ${commandArgs.join(' ')}`);
    execSync(localCmd, { stdio: 'inherit' });
    process.exit(0);
} catch (_error) {
    // Flyway locally not found, proceed to run via Docker
    console.log('Local Flyway binary not found, falling back to Docker...');
}

let dockerCmd: string;

if (dbUrl.hostname === 'localhost' || dbUrl.hostname === '127.0.0.1') {
    // Determine the host IP dynamically for Docker-in-Docker or Testcontainers
    // In CI (GitHub/Gitea Actions), the Docker host where testcontainers binds the port
    // is usually reachable at the default Docker bridge IP 172.17.0.1
    const isLinux = process.platform === 'linux';
    const hostIp = isLinux ? '172.17.0.1' : 'host.docker.internal';
    const modifiedJdbcUrl = `jdbc:postgresql://${hostIp}:${dbUrl.port}${dbUrl.pathname}`;

    dockerCmd = [
        `docker run --rm`,
        `--add-host=host.docker.internal:host-gateway`, // Ensure resolution works on Linux
        `-v "${MIGRATIONS_DIR}:/flyway/sql"`,
        `flyway/flyway:10-alpine`,
        `-url="${modifiedJdbcUrl}"`,
        `-user="${user}"`,
        `-password="${password}"`,
        ...commandArgs
    ].join(' ');
} else {
    // Remote database, simple Docker command
    dockerCmd = [
        `docker run --rm`,
        `-v "${MIGRATIONS_DIR}:/flyway/sql"`,
        `flyway/flyway:10-alpine`,
        `-url="${jdbcUrl}"`,
        `-user="${user}"`,
        `-password="${password}"`,
        ...commandArgs
    ].join(' ');
}

console.log(`Executing Docker Flyway: ${commandArgs.join(' ')}`);

try {
    execSync(dockerCmd, { stdio: 'inherit' });
} catch (_error) {
    if (process.env.NODE_ENV === 'test') {
        console.warn('Docker Flyway fallback failed in test environment. Please install Flyway CLI natively or ensure Docker volume mounting works.');
    } else {
        console.error('Flyway Docker fallback task failed.');
        process.exit(1);
    }
}
