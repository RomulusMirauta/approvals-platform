import type { Role } from '@approvals/contracts';

// The demo users created by apps/api/src/db/seed.ts.
export const DEMO_PASSWORD = 'demo-password';

export interface DemoUser {
  email: string;
  name: string;
  role: Role;
}

export const users = {
  alice: { email: 'alice@example.com', name: 'Alice Popescu', role: 'requester' },
  bob: { email: 'bob@example.com', name: 'Bob Ionescu', role: 'approver' },
  carol: { email: 'carol@example.com', name: 'Carol Dumitru', role: 'admin' },
  agent: { email: 'erp-agent@example.com', name: 'ERP Procurement Agent', role: 'agent' },
} as const satisfies Record<string, DemoUser>;

export type UserKey = keyof typeof users;
