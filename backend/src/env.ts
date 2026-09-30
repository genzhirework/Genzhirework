// Load backend/.env before any module reads configuration (Node 21.7+).
// Deployed environments inject real env vars and have no .env file.
try {
  process.loadEnvFile();
} catch {
  /* no .env file */
}
