import { draftMode } from 'next/headers'
import { redirect } from 'next/navigation'

/** `/preview/exit/`: back to what readers see. */
export async function GET() {
  ;(await draftMode()).disable()
  redirect('/blog/')
}
