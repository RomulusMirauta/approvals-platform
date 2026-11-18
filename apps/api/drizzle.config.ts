import { defineConfig } from 'drizzle-kit';

// Generates SQL migrations from src/db/schema.ts. The migrations are committed and reviewed like code.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
