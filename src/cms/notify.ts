/**
 * The side effects of publishing: Slack and IndexNow.
 *
 * Both are best effort. A publish that cannot reach Slack is still a publish,
 * so nothing here throws, and every call has a timeout so a slow endpoint
 * never holds an admin's save open.
 */

export const SITE_URL = process.env.SITE_URL ?? 'https://cargosharks.com'

/** `public/<key>.txt` holds the key; IndexNow fetches it to check we own the host. */
const INDEXNOW_KEY = 'fb93406b9c03f241b9736dbbb81332bb'

export async function slack(text: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel: process.env.SLACK_BLOG_CHANNEL ?? '#blog-automation',
        text,
        unfurl_links: false,
      }),
      signal: AbortSignal.timeout(5000),
    })
    const json = (await res.json()) as { ok: boolean; error?: string }
    if (!json.ok) console.warn('slack:', json.error)
  } catch (error) {
    console.warn('slack: not sent', error)
  }
}

/**
 * Tell Bing, Yandex, Seznam and Naver. Google does not take part; it learns
 * from the sitemap. Unlike the file-based pipeline there is no waiting for a
 * deploy: a publish revalidates the page in this process before this runs.
 */
export async function indexNow(urls: string[]): Promise<void> {
  if (!urls.length || process.env.INDEXNOW === 'off') return
  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: new URL(SITE_URL).host,
        key: INDEXNOW_KEY,
        keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`,
        urlList: urls,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok && res.status !== 202) console.warn('indexnow:', res.status)
  } catch (error) {
    console.warn('indexnow: not sent', error)
  }
}
