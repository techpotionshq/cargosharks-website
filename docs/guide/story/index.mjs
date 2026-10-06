// The story the seeded shorts are recorded in: Maryam at Rumaithiya Retail
// Trading brings two 40ft high cube containers of office furniture from
// Ningbo to Shuwaikh. Each chapter takes the database one step further and is
// kept as a snapshot (tools/guide/src/stack/seeded.mjs); a short names the
// chapter it starts from. A chapter is either code (`run`) or a short played
// without keeping its video (`short`), so the quotation that short 03's
// customer accepts is exactly the one short 02 sent.
//
// Everything runs against the local stack: WhatsApp messages are signed
// webhooks to the local service, partner replies are signed inbound-mail
// webhooks, and the model is the local fake.

const dlg = (page) => page.locator('dialog[open], [role=dialog]').last()
const settle = async (page) => {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(800)
}
const save = async (page, name = /save|add|open|record|send|confirm/i) => {
  await dlg(page).getByRole('button', { name }).last().click()
  await settle(page)
}

/** The partner replies the fake model reads into rate lines (see fake-model.mjs). */
export const RATE_REPLIES = {
  MSC: [
    'gulf.pricing@msc-demo.test',
    'MSC Gulf Pricing',
    'Dear team,\n\nThank you for the request. Our offer for Ningbo to Shuwaikh:\n\nOcean freight 40HC: USD 2,350 per container\nTHC origin 40HC: USD 180 per container\nDocumentation: USD 75\n\nValid until 31 October 2026. Weekly sailing, 21 days transit.\n\nBest regards,\nPricing Desk',
  ],
  CMACGM: [
    'rates.kw@cmacgm-demo.test',
    'CMA CGM Rates',
    'Hello,\n\nPlease see our rate:\n\nOcean freight 40HC: USD 2,480 per container\nTHC origin 40HC: USD 170 per container\nDocumentation: USD 60\n\nValid until 31 October 2026.\n\nRates Team',
  ],
  SHACO: [
    'pricing@shanghai-ocean.test',
    'Li Wei',
    'Hi,\n\nOur best rate for this lane:\n\nOcean freight 40HC: USD 2,190 per container\nTHC origin 40HC: USD 165 per container\nDocumentation: USD 50\n\nValid until 31 October 2026.\n\nLi Wei, Shanghai Ocean Logistics',
  ],
}

/** Answers every open rate request on the newest enquiry, as the partners would by email. */
export async function replyToRateRequests(ctx) {
  const rows = await ctx.sql(
    'select p.code, r.token from rate_requests r join partners p on p.id = r.partner_id where r.enquiry_id = (select enquiry_id from rate_requests order by created_at desc limit 1)',
  )
  for (const { code, token } of rows) {
    const reply = RATE_REPLIES[code]
    if (!reply) continue
    const [from, fromName, text] = reply
    await ctx.sendMail({ from, fromName, subject: `RE: Rate request [RFQ:${token}]`, text })
  }
}

/** The ids shorts need, looked up by the story's own references. */
export async function storyIds(ctx) {
  let [e] = await ctx.sql(
    "select id, reference from enquiries where customer_id = (select id from customers where code = 'RUMRET') order by created_at desc limit 1",
  )
  // Before a person links it, the newest enquiry is hers.
  if (!e)
    [e] = await ctx.sql(
      "select id, reference from enquiries where channel::text = 'whatsapp' order by created_at desc limit 1",
    )
  const [q] = e
    ? await ctx.sql(
        'select id, reference from quotes where enquiry_id = $1 order by created_at desc limit 1',
        [e.id],
      )
    : []
  const [j] = q
    ? await ctx
        .sql(
          'select id, reference from jobs where quote_id = $1 order by created_at desc limit 1',
          [q.id],
        )
        .catch(() => [])
    : []
  return {
    enquiry: e?.id,
    enquiryRef: e?.reference,
    quote: q?.id,
    quoteRef: q?.reference,
    job: j?.id,
    jobRef: j?.reference,
  }
}

export default [
  {
    id: 'base',
    // A seeded demo instance (migrations, seed, seed-demo run before this),
    // one administrator, Maryam's portal login, and the integrations pointed at
    // the local stand-ins.
    run: async (ctx) => {
      await ctx.dbScript('create-user', [
        '--email',
        ctx.stack.emails.operations,
        '--name',
        'Sara Al-Mutairi',
        '--role',
        'administrator',
        '--password',
        ctx.password,
        '--branch',
        'KWI',
        '--branch',
        'DXB',
      ])
      const { page, base, close } = await ctx.page('operations')
      const card = async (heading) => {
        await page.goto(`${base}/settings/integrations`, { waitUntil: 'networkidle' })
        await page
          .locator('section.rounded-card')
          .filter({ has: page.getByRole('heading', { name: heading, exact: true }) })
          .getByRole('button', { name: /configure/i })
          .first()
          .click()
        await page.waitForTimeout(600)
      }
      // WhatsApp through the local Kapso stand-in.
      await card('WhatsApp Business')
      await dlg(page).locator('input[name=driver][value=kapso]').check({ force: true })
      await dlg(page).locator('input[name=baseUrl]').fill(ctx.kapsoBase)
      await dlg(page).locator('input[name=kapsoApiKey]').fill('local-mock-key')
      await save(page, /save/i)
      // A model key, so the assistants run; the fake model answers them.
      await card('Document extraction')
      await dlg(page).locator('input[name=apiKey]').fill('local-demo-key')
      await dlg(page).locator('input[name=monthlyBudgetUsd]').fill('50')
      await save(page, /save/i)
      // The Kuwait sales number.
      await page.goto(`${base}/settings/whatsapp-numbers`, { waitUntil: 'networkidle' })
      await page
        .getByRole('button', { name: /add a number/i })
        .first()
        .click()
      const branch = dlg(page).locator('select[name=branchId]')
      await branch.selectOption(
        await branch.evaluate((el) => [...el.options].find((o) => o.text.includes('KWI'))?.value),
      )
      await dlg(page).locator('input[name=phoneNumberId]').fill('100200300400500')
      await dlg(page).locator('input[name=displayNumber]').fill('+965 2200 0000')
      await dlg(page).locator('input[name=label]').fill('Kuwait sales desk')
      await save(page, /add a number/i)
      // The Kuwait sales mailbox, read from the local stand-in; partner replies arrive here.
      await page.goto(`${base}/settings/mailboxes`, { waitUntil: 'networkidle' })
      await page
        .getByRole('button', { name: /connect/i })
        .first()
        .click()
      await page.waitForTimeout(600)
      const mb = dlg(page)
      const mbBranch = mb.locator('select[name=branchId]')
      await mbBranch.selectOption(
        await mbBranch.evaluate((el) => [...el.options].find((o) => o.text.includes('KWI'))?.value),
      )
      await mb.locator('input[name=username]').fill(ctx.mailbox)
      await mb.locator('input[name=host]').fill('127.0.0.1')
      await mb.locator('input[name=port]').fill(String(ctx.imapPort))
      const secure = mb.locator('input[name=secure]')
      if ((await secure.count()) && (await secure.isChecked()))
        await secure.uncheck({ force: true })
      await mb.locator('input[name=password]').fill('local-mock')
      await save(page, /connect|save/i)
      // The intake agent on for Kuwait, with a short quiet window so the story moves.
      await page.goto(`${base}/settings/intake-agent`, { waitUntil: 'networkidle' })
      const kwi = page.locator('tr').filter({ hasText: 'KWI' }).first()
      await kwi.getByRole('button', { name: /edit/i }).click()
      await page.waitForTimeout(600)
      await dlg(page).locator('input[name=enabled]').check({ force: true })
      await dlg(page).locator('input[name=whatsappQuietSeconds]').fill('20')
      await dlg(page).locator('input[name=emailQuietSeconds]').fill('20')
      await save(page, /save/i)
      // No quiet hours on either branch: the story's messages go out when sent.
      //
      // And the branches named as the brand's demo company. seed-demo names
      // them after the brand's legal identity, and a branch's legal name is the
      // letterhead of its quotations, invoices and house bills, so the seeded
      // shorts printed one company and the fixture shorts another (CargoSharks
      // Freight Technologies beside Gulf Harbour Freight Services). The demo
      // block in packages/brand is what the fixtures name them, so an
      // administrator renames them to that here, as one would; a branch already
      // carrying its demo name is left as seeded.
      const { homeEntityEn, homeEntityAr, regionalEntityEn, regionalEntityAr } = ctx.brand.demo
      const legalNames = {
        KWI: [homeEntityEn, homeEntityAr],
        DXB: [regionalEntityEn, regionalEntityAr],
      }
      for (let i = 0; i < 2; i++) {
        await page.goto(`${base}/settings/branches`, { waitUntil: 'networkidle' })
        await page.getByRole('button', { name: /edit/i }).nth(i).click()
        await page.waitForTimeout(600)
        const q = dlg(page).locator('input[name=quietHoursEnabled]')
        if (await q.count()) await q.uncheck({ force: true })
        const code = await dlg(page).locator('input[name=code]').inputValue()
        const en = dlg(page).locator('input[name=legalNameEn]')
        const ar = dlg(page).locator('input[name=legalNameAr]')
        const want = legalNames[code]
        if (want && ((await en.inputValue()) !== want[0] || (await ar.inputValue()) !== want[1])) {
          await en.fill(want[0])
          await ar.fill(want[1])
        }
        await save(page, /save/i)
      }
      // Maryam's portal login.
      const [rum] = await ctx.sql("select id from customers where code = 'RUMRET'")
      await page.goto(`${base}/customers/${rum.id}`, { waitUntil: 'networkidle' })
      const [has] = await ctx.sql(
        "select 1 from auth_user where email = 'maryam.alhajri@rumret.test'",
      )
      if (!has) {
        await page
          .getByRole('button', { name: /portal access/i })
          .first()
          .click()
        await page.waitForTimeout(600)
        const d = dlg(page)
        if (await d.locator('input[name=nameEn]').count())
          await d.locator('input[name=nameEn]').fill('Maryam Al-Hajri')
        if (await d.locator('input[name=nameAr]').count())
          await d.locator('input[name=nameAr]').fill('مريم الهاجري')
        if (await d.locator('input[name=email]').count())
          await d.locator('input[name=email]').fill('maryam.alhajri@rumret.test')
        await save(page, /give|invite|send|save/i)
      }
      await ctx.setPassword('maryam.alhajri@rumret.test', ctx.password)
      // Three partners cover Ningbo to Shuwaikh by sea, so a rate request has someone to ask.
      for (const [code, days] of [
        ['MSC', 21],
        ['CMACGM', 26],
        ['SHACO', 24],
      ]) {
        await ctx.sql(
          "insert into partner_coverage (partner_id, mode, origin_id, destination_id, transit_days) select p.id, 'sea_fcl', o.id, d.id, $2 from partners p, locations o, locations d where p.code = $1 and o.unlocode = 'CNNGB' and d.unlocode = 'KWSWK'",
          [code, days],
        )
      }
      // Rumaithiya's house margin in Kuwait: 15 percent over cost, as agreed.
      await ctx.sql(
        "insert into customer_branch_terms (customer_id, branch_id, default_margin_kind, default_margin_value) select c.id, b.id, 'percent', 15 from customers c, branches b where c.code = 'RUMRET' and b.code = 'KWI' on conflict (customer_id, branch_id) do update set default_margin_kind = 'percent', default_margin_value = 15",
      )
      // A pricing contact at each, where the rate request email goes.
      for (const [code, name, email] of [
        ['MSC', 'Pricing Desk', 'gulf.pricing@msc-demo.test'],
        ['CMACGM', 'Rates Team', 'rates.kw@cmacgm-demo.test'],
        ['SHACO', 'Li Wei', 'pricing@shanghai-ocean.test'],
      ]) {
        await ctx.sql(
          'insert into partner_contacts (partner_id, name_en, email, role, is_primary) select id, $2, $3, $4, true from partners where code = $1',
          [code, name, email, 'Pricing'],
        )
      }
      // Her mobile on file, so her WhatsApp message lands on her company.
      await ctx.sql(
        "update customer_contacts set phone = '+96550001234' where email = 'maryam.alhajri@rumret.test'",
      )
      await close()
    },
  },
  {
    id: 'intake',
    // Maryam's two WhatsApp messages, with the assistant's question in between.
    run: async (ctx) => {
      await ctx.sendWhatsApp(
        'Hello, I need a price for 2 containers from Ningbo to Shuwaikh port in Kuwait please.',
      )
      await ctx.waitFor(() => ctx.kapsoCount() >= 1, 180000)
      await new Promise((r) => setTimeout(r, 15000))
      await ctx.sendWhatsApp(
        'It is office furniture, 40ft high cube. Cargo ready around 20 October, about 18,000 kg in total.',
      )
      await ctx.waitFor(() => ctx.kapsoCount() >= 2, 180000)
      await new Promise((r) => setTimeout(r, 3000))
    },
  },
  {
    id: 'ready',
    // A person accepts what the assistant read: the enquiry is ready to price.
    run: async (ctx) => {
      const { enquiry } = await storyIds(ctx)
      const { page, base, close } = await ctx.page('operations')
      await page.goto(`${base}/enquiries/${enquiry}`, { waitUntil: 'networkidle' })
      await page
        .getByRole('button', { name: /^Accept all/ })
        .first()
        .click()
      await settle(page)
      await close()
    },
  },
  { id: 'quoted', short: '02-rates-and-quotations' },
  { id: 'accepted', short: '03-customer-accepts-quote' },
  {
    id: 'booked',
    // The office opens the shipment from the accepted quotation and books it:
    // booking details, two containers, the origin agent, shipper and
    // consignee, the cargo line, and the first two milestones. In transit.
    run: async (ctx) => {
      const ids = await storyIds(ctx)
      const { page, base, close } = await ctx.page('operations')
      await page.goto(`${base}/quotes/${ids.quote}`, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: 'New shipment' }).first().click()
      await page.waitForTimeout(800)
      let d = dlg(page)
      await d.locator('input[name=customerReference]').fill('PO-55120')
      await d.locator('input[name=bookingNumber]').fill('NGB2614420')
      await d.locator('input[name=vesselName]').fill('Ocean Pearl')
      await d.locator('input[name=voyageNumber]').fill('042W')
      await d.locator('input[name=etd]').fill('2026-10-02T10:00')
      await d.locator('input[name=eta]').fill('2026-10-24T08:00')
      await d.locator('input[name=grossWeightKg]').fill('18000')
      await d.locator('input[name=pieces]').fill('240')
      await save(page, /open shipment/i)
      const { job } = await storyIds(ctx)
      await page.goto(`${base}/jobs/${job}`, { waitUntil: 'networkidle' })
      for (const [no, seal] of [
        ['MSKU7204418', 'SL554120'],
        ['MSKU7204423', 'SL554121'],
      ]) {
        await page.getByRole('button', { name: 'Add a container' }).first().click()
        await page.waitForTimeout(500)
        d = dlg(page)
        await d.locator('input[name=containerNo]').fill(no)
        await d.locator('select[name=containerType]').selectOption('40HC')
        await d.locator('input[name=sealNo]').fill(seal)
        await save(page, /save|add/i)
      }
      await page.getByRole('button', { name: 'Engage a partner' }).first().click()
      await page.waitForTimeout(500)
      d = dlg(page)
      await d
        .locator('select[name=partnerId]')
        .selectOption({ label: 'SHACO — Shanghai Ocean Logistics' })
      await d.locator('select[name=role]').selectOption({ label: 'Origin agent' })
      await d.locator('input[name=reference]').fill('SOL-88412')
      await save(page, /save|engage|add/i)
      for (const [role, name, addr, city, country] of [
        [
          'shipper',
          'Ningbo Ergonomic Furniture Co., Ltd.',
          'No. 88 Yinxian Avenue',
          'Ningbo',
          'CN',
        ],
        [
          'consignee',
          'Rumaithiya Retail Trading',
          'Block 4, Street 12, Al Rai',
          'Kuwait City',
          'KW',
        ],
      ]) {
        await page.getByRole('button', { name: 'Add party' }).first().click()
        await page.waitForTimeout(500)
        d = dlg(page)
        await d.locator(`input[name=role][value=${role}]`).check({ force: true })
        await d.locator('input[name=nameEn]').fill(name)
        await d.locator('textarea[name=address]').fill(addr)
        await d.locator('input[name=city]').fill(city)
        const c = d.locator('[name=country]')
        if ((await c.evaluate((e) => e.tagName)) === 'SELECT') await c.selectOption(country)
        else await c.fill(country)
        await save(page, /save|add/i)
      }
      await page.getByRole('button', { name: 'Add cargo line' }).first().click()
      await page.waitForTimeout(500)
      d = dlg(page)
      await d
        .locator('textarea[name=descriptionEn]')
        .fill('Office furniture: desks, chairs and cabinets')
      await d.locator('textarea[name=descriptionAr]').fill('أثاث مكتبي: مكاتب وكراسي وخزائن')
      await d.locator('input[name=packageCount]').fill('240')
      await d.locator('input[name=packageType]').fill('cartons')
      await d.locator('input[name=hsCode]').fill('940330')
      await d.locator('input[name=grossWeightKg]').fill('18000')
      await d.locator('input[name=netWeightKg]').fill('16500')
      await d.locator('input[name=volumeCbm]').fill('132')
      await save(page, /save|add/i)
      for (const [label, at] of [
        ['Cargo received', '2026-10-01T15:30'],
        ['Vessel departed', '2026-10-02T11:00'],
      ]) {
        await page.getByRole('button', { name: 'Record a milestone' }).first().click()
        await page.waitForTimeout(500)
        d = dlg(page)
        await d.locator('select[name=milestoneId]').selectOption({ label })
        await d.locator('input[name=actualAt]').fill(at)
        await save(page, /save|record/i)
      }
      await page.getByRole('button', { name: 'Update status' }).first().click()
      await page.waitForTimeout(500)
      await dlg(page).locator('select[name=status]').selectOption({ label: 'In transit' })
      await save(page, /save|update/i)
      await close()
    },
  },
]
