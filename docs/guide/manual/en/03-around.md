---
title: Getting around
routes: [/sign-in, /dashboard, /track]
messages: [signIn.subtitle, nav.finance, nav.moreBelow, nav.menu]
components: [apps/web/src/ui/nav.tsx, apps/web/src/ui/preferences.tsx]
---

# Getting around

::: intro
Signing in, the dashboard, the menu, search, notifications, Arabic, and phones.
:::

## Signing in

Go to your company's address for the system and enter your work email and password. The page says it plainly: *{app:signIn.subtitle}* There is no sign-up form: your administrator invites you, and you receive an email with a link to set your own password.

![**Sign in.** Email, password, and a link for a forgotten password.](shot:/sign-in?who=none&hide=[data-guide=demo-access]&fill=input[name=email]=>&fill=input[name=password]=>)

**Administrators and finance staff** also use two-factor authentication. The first time, you scan a code with an authenticator app on your phone, such as Google Authenticator or Microsoft Authenticator. After that, each sign-in asks for the six digit code the app shows. After too many wrong attempts the page asks you to wait a few minutes before trying again.

::: note
**Forgot your password?**

Use the forgotten password link on the sign-in page. The link expires in one hour. It only arrives if your company has set up outbound mail; otherwise ask your administrator.
:::

## The dashboard

![**The dashboard.** 1 What needs you today. 2 The four numbers that matter now. 3 The menu. 4 Search. 5 Notifications, appearance and language.](shot:/dashboard?mark=1:text=/things? needs? you today/&mark=2:[data-guide=dashboard-numbers]&mark=3:nav >> nth=0&mark=4:role=searchbox&mark=5:role=button[name="{app:common.language}"])

1.  **What needs you today.** One line that counts what needs attention. When it says nothing needs you, every open shipment is running to plan.
2.  **Four numbers.** Overdue replies (enquiries past their reply deadline), demurrage accruing (money the port and shipping line are charging right now), open enquiries, and live shipments.
3.  **The menu.** Four groups: Commercial, Operations, Network and Finance. Only the group you are working in is open; click a group's name to open it. Settings and the link to the customer tracking page sit at the bottom.
4.  **Search** finds a shipment reference, container number, bill of lading number, booking number or customer.
5.  **Notifications, appearance and language.** The bell lists new enquiries, overdue replies and other events. The sun and moon switch light and dark. The language button switches to Arabic.

Further down, the map draws every live shipment, **Needs your attention** lists problems oldest first, and **SLA watch** lists enquiries closest to missing their reply deadline.

## The menu

| Group | What is in it |
|---|---|
| Commercial | Dashboard, Enquiries, Quotations, Customers, Rate cards |
| Operations | Shipments, Exceptions, Consolidations, Customs, Documents, Assistant |
| Network | Partners and agents, Ports and places, Reference data, Bulk import |
| Finance | {app:nav.finance}, Invoices, Payments, Payables, Settlements, Reports |

The groups fold, so the menu stays short: the group holding the screen you are on is open and the others show only their names. When the menu is taller than the window, a *{app:nav.moreBelow}* hint appears at its foot.

You only see what your role allows. A button you are not allowed to use is not shown, and a screen that belongs to another role names the permission it needs. See the chapter on roles.

## Search and notifications

Type in the search box at the top of any screen and press Enter. If exactly one shipment matches, it opens straight away. The bell shows a number when there is something new.

![**Notifications.** New enquiries, overdue replies and other events, newest first.](shot:/dashboard?click=summary[aria-label^="{app:notifications.title}"]&crop=details[open] > div)

## Arabic, right to left

Click [{app:common.language}]{.ui} at the top of any screen. The whole product switches to Arabic and the layout flips to read from right to left. Documents and customer pages follow the same choice. Your choice is remembered for you only, so a colleague can work in English on the same records.

![**The dashboard in Arabic.** The menu moves to the right and every label is translated.](shot:/dashboard?locale=ar)

## On a phone

The system works in the browser on a phone. The menu becomes a **menu sheet**: tap [{app:nav.menu}]{.ui} at the top to open it, with every section, search, the customer tracking link, settings, the light and dark switch and sign-out. The **Assistant** has its own button in the top bar. Tables become lists, and proof of delivery can be captured at the door with a finger signature and the phone's camera.

::: phone
![**The dashboard** on a phone.](shot:/dashboard?viewport=phone)

![**The menu sheet**, with sections, search, tracking and sign-out.](shot:/dashboard?viewport=phone&click=role=button[name="{app:nav.menu}"])

![**Customer tracking** on a phone.](shot:/track?viewport=phone&who=none&fill=input[name=reference]=>KWI-2026-01041&fill=input[name=verifier]=>CMAU0385171&click=form button[type=submit] >> nth=-1)
:::

## Five habits of the system

-   **Nothing is deleted.** Records are closed, cancelled, superseded or deactivated, and stay readable.
-   **Everything is recorded.** Every change is written to an audit log that nobody can edit.
-   **Money is exact.** The Kuwaiti dinar keeps three decimals, and every charge keeps the exchange rate it was struck at.
-   **Deadlines count working time** on your branch's calendar, so a Thursday evening enquiry is not overdue on Saturday.
-   **Problems are listed oldest first**, because the oldest is the one nobody picked up.
