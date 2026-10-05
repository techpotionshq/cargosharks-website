-- R2 (live run 5): a bill captured with a total summed from its lines, because
-- the page printed none, waits for a person to confirm that figure before it
-- can be approved. See `supplierInvoices.totalUnconfirmed`. Existing bills
-- were captured with a printed or a typed total, so they start confirmed.

ALTER TABLE "supplier_invoices" ADD COLUMN "total_unconfirmed" boolean DEFAULT false NOT NULL;