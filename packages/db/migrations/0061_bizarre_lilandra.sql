-- D12: the customer portal's quotations and invoices.
--
-- The portal now reads a customer's quotations and invoices, and lets them
-- accept or decline a quotation, all under the contact's own actor. The
-- `customer_contact` arms already scoped both tables to the contact's company,
-- but by customer only: a contact could read every draft and superseded
-- version, every draft and voided invoice, and the `for all` policies left the
-- write side open to whatever statement reached them. These policies make the
-- database say what the portal shows, so a projection that forgets a filter
-- still leaks nothing.
--
-- Restrictive policies, layered on the existing permissive ones rather than
-- rewriting them: each one constrains only `customer_contact`, so staff,
-- system and support behaviour is unchanged by construction.

-- The decline reason column, `quotes.decision_note`, is added by 0060 (generated
-- from the schema). Nullable, set only when a customer declines with a reason.

-- ---------------------------------------------------------------------------
-- Quotations: what a customer may read
-- ---------------------------------------------------------------------------
--
-- An offer they were sent, in whatever state it reached: sent, accepted,
-- rejected or lapsed. Never a draft (it has not been offered) and never a
-- superseded version (the customer must not accept a price the branch has
-- already replaced). `quote_lines_scope` is `exists (... from quotes ...)`,
-- and that subquery runs under these same policies, so a hidden quote hides
-- its lines with no policy of their own.
--
-- `for select` applies to the row lookup of an UPDATE too, so a customer
-- cannot move a quote this hides from them either.

create policy quotes_customer_reads on quotes as restrictive for select using (
  app.principal_type() <> 'customer_contact'
  or (status in ('sent', 'accepted', 'rejected', 'expired') and superseded_by_id is null)
);

-- The one write a customer makes: answering a sent offer. The old row must be
-- `sent` and the new one decided; anything else updates nothing (USING) or
-- raises 42501 (WITH CHECK). The state machine in the action says the same,
-- and this is what holds if the action is ever wrong.
create policy quotes_customer_decides on quotes as restrictive for update
  using (app.principal_type() <> 'customer_contact' or status = 'sent')
  with check (
    app.principal_type() <> 'customer_contact' or status in ('accepted', 'rejected')
  );

create policy quotes_customer_inserts_nothing on quotes as restrictive for insert
  with check (app.principal_type() <> 'customer_contact');

create policy quote_lines_customer_inserts_nothing on quote_lines as restrictive for insert
  with check (app.principal_type() <> 'customer_contact');

create policy quote_lines_customer_updates_nothing on quote_lines as restrictive for update
  using (app.principal_type() <> 'customer_contact');

-- ---------------------------------------------------------------------------
-- Invoices: what a customer may read
-- ---------------------------------------------------------------------------
--
-- Issued documents only. A draft or an approved invoice can still change and
-- has no number; a void one was withdrawn before issue. `credited` stays: the
-- customer holds that invoice and the credit note against it, and both are
-- `issued`-family rows. `invoice_lines_scope` follows through its subquery,
-- as quote lines do.

create policy invoices_customer_reads on invoices as restrictive for select using (
  app.principal_type() <> 'customer_contact'
  or status in ('issued', 'part_paid', 'paid', 'credited')
);

create policy invoices_customer_inserts_nothing on invoices as restrictive for insert
  with check (app.principal_type() <> 'customer_contact');

create policy invoices_customer_updates_nothing on invoices as restrictive for update
  using (app.principal_type() <> 'customer_contact');

create policy invoice_lines_customer_inserts_nothing on invoice_lines as restrictive for insert
  with check (app.principal_type() <> 'customer_contact');

create policy invoice_lines_customer_updates_nothing on invoice_lines as restrictive for update
  using (app.principal_type() <> 'customer_contact');

-- ---------------------------------------------------------------------------
-- The branch hears the answer
-- ---------------------------------------------------------------------------
--
-- `notification_outbox_scope` admits system and internal principals only, so
-- the customer's own transaction could not raise the event that tells the
-- branch. This admits exactly that: the two decision events, about this
-- customer, on an enquiry they can see, addressed to the branch of a quote on
-- it. The subquery runs under the customer's policies, so a contact cannot
-- name another company's enquiry or an arbitrary branch.

create policy notification_outbox_customer_decision on notification_outbox for insert
  with check (
    app.principal_type() = 'customer_contact'
    and event_key in ('quote.accepted', 'quote.declined')
    and customer_id = app.customer_id()
    and exists (
      select 1
        from quotes q
        join enquiries e on e.id = q.enquiry_id
       where e.id = notification_outbox.enquiry_id
         and e.customer_id = app.customer_id()
         and q.branch_id = notification_outbox.branch_id
    )
  );
