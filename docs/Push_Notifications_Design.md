# Push notifications — design, before any code

Status: **proposal, for approval.** Nothing here is built. It is the plan for a
Web Push channel, written after the in-app bell landed, because push reuses most
of that machinery and is worth designing against what now exists rather than
against a blank page.

The one-line version: **push is a fourth `NotificationChannel`, addressed to a
*principal* rather than to an address, delivered through the browser's own push
service.** Two facts fall out of that and shape everything below — the delivery
path is currently email-shaped (`to` is an email string), and the browser push
service is a third party the data passes through.

## What already exists to build on

The in-app work put the load-bearing pieces in place:

- `notification-dispatch` fans an event to one delivery row per **registered**
  channel, resolves recipients by audience, and applies quiet hours and
  opt-outs before any send. Push inherits all of that unchanged.
- The `NotificationChannel` port (`apps/service/src/ports/index.ts`) is the
  seam. `email` and `in_app` are registered; `push` is a third `key`.
- `notification_channel_settings` already answers "may this event send on this
  channel", absence meaning on (`core/notifications.ts::channelDecision`).
- The `in_app` templates are the model for push wording: terse, self-addressed,
  no `{{senderName}}` signature. Push copy is a headline and one line.

So the new surface area is narrower than it looks: a subscription store, a
service worker, the adapter, and the one contract change push forces.

## The contract change push forces

`OutboundMessage` carries `to` — an **address**. Email has one; `in_app` did not
need one (the row *is* the notification). Push has neither an address nor a
row-is-enough shortcut: it needs the **principal**, because a person has zero or
many browser subscriptions, and it needs a **link**, because a push with nothing
to open is a dead end on a lock screen.

`ClaimedDelivery` in the dispatcher already knows `principalId` on the row it
claims (the column exists; the claim query does not yet select it). The
proposal:

- Widen `OutboundMessage` with two optionals: `recipientPrincipalId?: string`
  and `link?: string`. Email and WhatsApp ignore both; push reads both.
- `flush` fills them from the claimed delivery and the outbox. The link is
  built by a shared helper — the same `/jobs/:id`-or-`/enquiries/:id` rule the
  in-app query's `target()` uses, lifted into `core` so both sides agree.

This is the smallest change that keeps every existing channel untouched and
avoids a second, push-only delivery path.

## Subscriptions — a new table, and the one place immutability bends

A `push_subscriptions` table, declared with `pgTable` from `./table` (so the RLS
and audit coverage tests see it), one row per browser subscription:

| column | why |
|---|---|
| `principal_id` | who this device belongs to — the address push resolves by |
| `branch_id` | RLS scoping, as everywhere else |
| `endpoint` | the push service URL, unique |
| `p256dh`, `auth` | the subscription's encryption keys |
| `user_agent` | so a person can recognise "which device" to revoke |
| `last_seen_at` | refreshed on re-subscribe, for pruning stale devices |
| `revoked_at` | soft-deactivation — see below |

Two schema rules from `CONTRIBUTING.md` apply and must be honoured in the same
migration: a **hand-written RLS policy** (RLS on with no policy denies every
row silently), scoping a principal to their *own* subscriptions, and
`select app.attach_audit('push_subscriptions')`. Written via
`pnpm db:generate:custom`, which carries the schema snapshot forward.

**The immutability bend.** "Nothing is deleted" is a house rule, and `DELETE` is
revoked from `app_user`. But a push endpoint that returns `410 Gone` is dead and
must never be tried again — keeping it is not an audit virtue, it is a bug that
retries forever. The resolution that stays inside the rule: a `revoked_at`
column, set when the push service reports the endpoint gone or the person
revokes it, and every send filters `revoked_at is null`. A device token is
ephemeral infrastructure, not a business record; this is the same reasoning that
lets `is_active` retire a rate card without deleting its history.

## VAPID keys — a secret and a public half

Web Push authenticates the sender with a VAPID key pair. Provisioned the way SMTP
already is — as `integration_settings` rows (FR-AD-03), so a key rotated on the
settings screen takes effect on the next dispatch, not the next deploy:

- `VAPID_PUBLIC_KEY` — served to the browser; not secret.
- `VAPID_PRIVATE_KEY` — a secret, stored and read through `openSecret`, exactly
  as the SMTP password is.
- `VAPID_SUBJECT` — a `mailto:` the push services require.

A half-configured key pair degrades like every other adapter: the channel is off,
the reason is on the settings row, the screen shows it, and nothing else stops.
`resolvePushChannel` follows `resolveEmailChannel`'s shape.

## The service worker — the one place client JavaScript is unavoidable

The bell is deliberately zero-JavaScript. Push cannot be: the Push API and
`ServiceWorkerRegistration.pushManager` exist only in a service worker and a
registration script.

- `apps/web/public/sw.js` (or the app-router equivalent) handling two events:
  `push` (decrypt the payload, `showNotification(title, { body, data.url })`)
  and `notificationclick` (focus an open tab or open `data.url`).
- A small `'use client'` component — a toggle in **settings**, not the topbar —
  that registers the worker, asks permission *on an explicit click* (never on
  load; an unprompted permission request is the fastest way to a permanent
  block), subscribes with the public VAPID key, and POSTs the subscription to a
  server action that writes `push_subscriptions`.
- A matching "turn off on this device" that sets `revoked_at`.

Permission and subscription state live in the browser; the row is the server's
copy. The two can disagree (a person clears site data), which is why the push
adapter treats a `410`/`404` as authoritative and revokes the row.

## The adapter

`pushChannel: NotificationChannel`, `key: 'push'`, using the `web-push` npm
package (a new dependency in `apps/service`). Its `send`:

1. Reads `recipientPrincipalId` and `link` off the message.
2. Loads that principal's live subscriptions (`revoked_at is null`).
3. Sends each with `web-push`, payload `{ title, body, url: link }`.
4. On `410`/`404`, stamps `revoked_at` on that subscription.
5. Accepts if at least one endpoint took it; a principal with no subscription is
   **not** a failure — it is someone who has not turned push on.

That last point forces a dispatch decision below.

## Two decisions the dispatcher needs

1. **No subscription is not a failed delivery.** Email assumes an address; push
   does not assume a device. Pass one should create a push delivery only for a
   principal who has a live subscription, and otherwise record nothing (not
   `failed`, not `suppressed` — there is no decision to log, only an absence).
   This mirrors the `in_app` audience guard: a channel that does not apply
   leaves no row.
2. **Audience.** R1 push mirrors `in_app`: the six internal staff events, staff
   only, because the demo and the first customer both run the operations shell.
   Customer push (a portal PWA) is a later step with its own consent story and
   is explicitly out of scope here.

## Templates

Push needs its own rows, terse like `in_app` and for the same reason — a lock
screen is smaller than an inbox. The `NotificationTemplateSeed` channel union
gains `'push'`; the coverage test keeps requiring only `email` for every event,
and `in_app`/`push` cover the internal subset. In practice push and in-app
wording will be nearly identical, but they stay separate rows so a headline can
be tuned for a lock screen without touching the bell.

## Compliance — this adds a sub-processor

A push message travels through the browser's push service — FCM (Chrome),
Mozilla, Apple. That is a third party receiving encrypted payloads and endpoint
metadata on our behalf: a **sub-processor**, and `docs/compliance/` names its
sub-processors. Landing push means updating that list and the data-flow note,
and the re-verification `CLAUDE.md` asks for when `packages/db` or auth changes —
`push_subscriptions` is new personal data (a device identifier tied to a person).
This is not a footnote; it is a gate on shipping.

## What does not work in the demo

The bell works on fixtures because it reads a table this side owns. Push cannot:
it needs a real service worker, a real endpoint, and a real push service. The
demo's push toggle can show the UI and explain it, but the hosted
`QABANDI_PILOT_FIXTURES` instance will not deliver a push. Push is a
real-deployment feature; the bell remains the demo surface.

## Testing

- `push_subscriptions` in the RLS matrix (a principal reads only their own).
- The adapter against a mocked `web-push`: one live and one `410` endpoint, and
  assert the `410` gets `revoked_at`.
- The dispatcher: an internal event with a subscribed principal writes a push
  delivery; an unsubscribed principal writes none.
- Subscription lifecycle: subscribe writes a row, re-subscribe refreshes
  `last_seen_at` rather than duplicating, revoke stamps `revoked_at`.

## Rollout order

1. Schema: `push_subscriptions` + policy + audit + the `push` enum value.
2. Contract: widen `OutboundMessage`; select `principal_id` in the claim; the
   shared link helper in `core`.
3. Service: VAPID settings, `resolvePushChannel`, the adapter, register it.
4. Web: service worker, the settings toggle, the subscribe/revoke actions.
5. Templates: push rows for the six internal events, both languages.
6. Compliance: sub-processor and data-flow updates.
7. Tests, then run the DB-backed suites (serially, per `CLAUDE.md`).

## Open questions for sign-off

- **VAPID provisioning**: settings rows (consistent with SMTP) or environment
  only for R1? Rows cost a small settings screen; env is faster to ship.
- **`web-push` dependency**: acceptable, or is an in-region push relay wanted
  before this ships (the same argument `ModelProvider` makes about region)?
- **Customer push**: confirmed out of scope for R1?
- **The `OutboundMessage` widening**: acceptable, or would a push-specific
  delivery path be preferred (it would be more code and a second thing to keep
  in step, which is why it is not the proposal)?
