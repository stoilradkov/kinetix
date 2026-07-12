import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

config({ path: '../../.env', quiet: true });
config({ quiet: true });

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://kinetix:kinetix@localhost:5432/kinetix',
  },
  strict: true,
  verbose: true,
});
