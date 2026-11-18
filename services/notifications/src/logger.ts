// JSON log lines like the API's (pino), so both services' logs can be searched the same way, e.g. by requestId.
import { pino } from 'pino';
import { REDACT_CENSOR, REDACT_PATHS } from '@approvals/api/redact';

export type Logger = pino.Logger;

export const logger: Logger = pino({ level: process.env.LOG_LEVEL ?? 'info', redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR } });
