// Interactive API docs at /docs. The OpenAPI document comes from @fastify/swagger at /docs/json; the page
// loads Swagger UI from a CDN instead of serving it from node_modules (the @fastify/swagger-ui plugin pulls
// in an ESM-only dependency that serverless runtimes fail to load), and only these routes relax the CSP.
import type { FastifyInstance } from 'fastify';

const SWAGGER_UI = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.35.0';

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Approvals API</title>
    <link rel="stylesheet" href="${SWAGGER_UI}/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${SWAGGER_UI}/swagger-ui-bundle.js"></script>
    <script src="/docs/init.js"></script>
  </body>
</html>`;

const init = `SwaggerUIBundle({ url: '/docs/json', dom_id: '#swagger-ui', persistAuthorization: true });`;

const csp = [
  "default-src 'self'",
  `script-src 'self' ${SWAGGER_UI}`,
  // Swagger UI sets inline styles on its elements.
  `style-src 'self' 'unsafe-inline' ${SWAGGER_UI}`,
  "img-src 'self' data:",
].join('; ');

export function registerDocs(app: FastifyInstance) {
  const hidden = { schema: { hide: true } };
  app.get('/docs/json', hidden, async () => app.swagger());
  app.get('/docs/init.js', hidden, async (_request, reply) => reply.type('text/javascript').send(init));
  app.get('/docs', hidden, async (_request, reply) =>
    reply.header('content-security-policy', csp).type('text/html').send(page),
  );
}
