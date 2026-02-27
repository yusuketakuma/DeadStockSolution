import { defineConfig } from 'drizzle-kit';
import { resolveDatabaseUrls } from './src/config/database-url';

const { nonPoolingUrl } = resolveDatabaseUrls(process.env);

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: nonPoolingUrl,
  },
});
