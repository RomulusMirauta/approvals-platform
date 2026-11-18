import { z } from 'zod';

// zod speeds up object parsing by compiling code with new Function, and checks whether it may by calling it
// once. The CSP (script-src 'self', no 'unsafe-eval') blocks that, and the browser reports the blocked call as a
// violation even though zod catches it. jitless skips the check; these payloads are too small to miss the speed.
// zod runs the check when a schema is built, so this module must load before @approvals/contracts: main.tsx
// imports it first.
z.config({ jitless: true });
