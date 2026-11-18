import { randomUUID } from 'node:crypto';
import type { CreateRequestBody } from '@approvals/contracts';

// A short id that is unique across workers and runs. Tests put it in titles, references and tags,
// so they find their own rows with a search and never depend on what other tests created.
export const uniqueId = () => randomUUID().slice(0, 8);

export const ERP_SOURCE = 'erp-procurement-mcp';

// What the ERP Procurement MCP server submits when an invoice fails three-way matching.
export function invoiceException(id: string, overrides: Partial<CreateRequestBody> = {}): CreateRequestBody {
  return {
    title: `INV-E2E-${id}: PRICE_VARIANCE`,
    type: 'invoice_exception',
    source: ERP_SOURCE,
    externalRef: `INV-E2E-${id}`,
    priority: 'high',
    amount: { amountMinor: 1_234_500, currency: 'RON' },
    metadata: { exceptionCodes: ['PRICE_VARIANCE'], supplier: 'Somes Industrial Components SRL' },
    tags: ['finance', 'price-variance'],
    ...overrides,
  };
}

export function purchaseRequest(id: string, overrides: Partial<CreateRequestBody> = {}): CreateRequestBody {
  return {
    title: `Laptop dock ${id}`,
    type: 'purchase',
    description: 'Created by the end-to-end suite.',
    amount: { amountMinor: 89_900, currency: 'EUR' },
    ...overrides,
  };
}
