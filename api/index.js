// Vercel serves every file in /api as a function. This one hands all API traffic to the Fastify app,
// built to apps/api/dist during the deploy (see vercel.json).
export { default } from '../apps/api/dist/serverless/handler.js';
