/**
 * Customs filing — `CustomsFiling` in `ports/index.ts`.
 *
 * The one port on this list that should stay manual, and the reason is
 * commercial rather than technical.
 *
 * ## Kuwait is not an integration we can buy
 *
 * `SRS §11` defers this as *"requires technical access and credentials from
 * the General Administration of Customs"*, which reads like a procurement
 * task. It is not. In 2005 KGAC awarded a twenty-five-year Build-Operate-
 * Transfer concession to Global Clearinghouse Systems — a joint venture in
 * which **Agility is the majority shareholder** — to run Kuwait customs on the
 * MicroClear platform. That concession runs to 2030.
 *
 * So access is gated by a concessionaire majority-owned by one of the largest
 * logistics groups in the region, who has no commercial reason to enable a
 * competitor's software vendor. The honest estimate is not "months"; it is
 * "unknown, possibly never", and planning a release around it would be
 * planning around somebody else's goodwill.
 *
 * Dubai and Oman customs *are* connectable and Logistaas already are — but
 * both are relationship-gated too, and neither is worth starting before there
 * is a UAE customer asking.
 *
 * ## What R1 actually does, and why it is enough
 *
 * The broker files. The declaration number, its date and the duty come back
 * onto `customs_stages`, where the SLA clock and the exception board read
 * them. The operator gets the visibility PP-06 asks for without anybody
 * pretending we are in the filing path.
 */

import type { CustomsDeclaration, CustomsFiling } from '../ports/index'

/**
 * Reference capture, kept as a real implementation.
 *
 * It refuses rather than returning an empty declaration. The other manual
 * adapters here answer "I have nothing to add", which is true of a rate feed
 * or a tracking feed; this one would be answering "I filed your declaration",
 * and a caller must never be able to believe that. Nothing calls it today, and
 * if something ever does, it should fail loudly at the first attempt rather
 * than at the first audit.
 */
const manualCustomsFiling: CustomsFiling = {
  key: 'manual',

  file(): Promise<CustomsDeclaration> {
    return Promise.reject(
      new Error(
        'Customs declarations are filed by the broker and captured on the job — ' +
          'this deployment has no filing connection. Kuwait is served by ' +
          'MicroClear under a concession held by an Agility-majority joint ' +
          'venture, so there is no route to file programmatically.',
      ),
    )
  },
}

export function resolveCustomsFiling(): CustomsFiling {
  return manualCustomsFiling
}
