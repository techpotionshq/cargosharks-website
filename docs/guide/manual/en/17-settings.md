---
title: Settings and administration
routes: [/settings, /settings/users, /settings/branches, /settings/whatsapp-numbers, /settings/mailboxes, /settings/integrations, /settings/brand, /settings/support, /customers/[id]]
messages: [settings.areas.support.title, customers.termsBranch]
---

# Settings and administration

::: intro
Who can sign in, what each branch is, and how the system talks to the outside world. Most of this belongs to the administrator.
:::

## Users and roles

[Settings]{.ui}, [Users & roles]{.ui} lists everyone with their roles per branch. [Invite someone]{.ui} creates a person with their role and branches; they receive an email to set their password. If no email could be sent (outbound mail not set up yet), the screen says so and gives you a set-password link to pass on yourself. [Suspend]{.ui} removes access without deleting anything.

![**Users & roles.** People, their branch roles, and the seven roles with their permission counts.](shot:/settings/users)

**Roles are per branch.** The same person can be a coordinator in Kuwait and read only in Dubai. You can only grant branches you hold yourself.

## Branches

Each branch has its own legal name in both languages, currency, invoice series, working calendar, time zone, trading conditions and quiet hours for customer notifications.

## Customer terms per branch

A customer can be served by more than one branch, on different terms. On the customer's page, [{app:customers.termsBranch}]{.ui} picks the branch, and the terms below it (payment terms, credit limit and the **house margin** used when only a buying rate covers a lane) apply to that branch only.

## Intake agent

One row per branch. See the chapter on the intake assistant.

## WhatsApp numbers

The business numbers the system answers on. [Add a number]{.ui}: the branch, the provider's phone number ID, the number as customers see it, and a label. A message to that number becomes an enquiry for that branch.

![**WhatsApp numbers.** One row per business number and branch.](shot:/settings/whatsapp-numbers)

## Mailboxes

The email addresses the system reads. [Connect a mailbox]{.ui}: branch, address, incoming mail server, port, password and folder. Each row shows when it was last checked. [Stop reading]{.ui} pauses one.

## Integrations

The accounts the system reaches the outside world with: outbound mail, file storage, WhatsApp Business, carrier tracking, exchange rates, e-invoicing, and the model key for document extraction and the assistants. Also the switches for automatic rate requests, automatic enquiry fill, automatic rate award and automatic quotation drafts, all off until you turn them on. Credentials are sealed and never shown again; a change takes effect within a minute.

![**Integrations.** Each card says what it does and what it is set to.](shot:/settings/integrations)

## Brand

Shows every colour, name and mark the product uses, and the setting behind each. The product is re-branded by changing a few deployment settings, with no new release.

## Also in Settings

-   **Audit log:** every change, by whom, when and from where. Nobody can edit it.
-   **{app:settings.areas.support.title}:** who from the support team can see this system, for how long, and what they opened. You grant it here, it expires on its own, and you can withdraw it at any time.
-   **Notification wording:** the text of every email in both languages.
-   **API keys:** read-only keys for a customer's own systems, and webhooks.
