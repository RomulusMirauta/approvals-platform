// Structured JSON logs (pino, through Fastify): one line per request, never a secret or an email address.
import { LogController, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import { REDACT_CENSOR, REDACT_PATHS } from './redact.js';

type LoggerOptions = Exclude<FastifyServerOptions['logger'], boolean | undefined>;

// stream: tests read the lines back instead of letting them go to stdout.
export function loggerOptions(stream?: LoggerOptions['stream']): LoggerOptions {
  return { level: process.env.LOG_LEVEL ?? 'info', redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR }, stream };
}

// Fastify's default is two lines per request ("incoming", "completed") with the full URL and headers. One line at
// the end has everything worth searching for. The URL's query string and the user's email stay out of it.
export class RequestLog extends LogController {
  constructor() {
    // The same name the worker and the problem+json body use.
    super({ requestIdLogLabel: 'requestId' });
  }

  override incomingRequest() {}

  // The completed line says 404 with no route; a second "not found" line would add nothing.
  override routeNotFound() {}

  override requestCompleted(error: Error | null | undefined, request: FastifyRequest, reply: FastifyReply) {
    const line = {
      method: request.method,
      // The route pattern (/v1/requests/:id), not the URL, so lines group by endpoint and ids stay out of it.
      route: request.routeOptions.url,
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
      // Only the id: it identifies the user to us without putting personal data in the logs. Unset before sign-in.
      userId: request.user?.sub,
      // Vercel's own id for the invocation, to match our line with its function logs and dashboard.
      vercelId: request.headers['x-vercel-id'],
    };
    if (error) reply.log.error({ ...line, err: error }, 'request errored');
    else reply.log.info(line, 'request completed');
  }
}
