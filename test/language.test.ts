import { describe, expect, it, vi } from 'vitest'
import { ensureLanguage, languageProblems, retryNote, wrongScript } from '../scripts/blog/lib.mjs'

/**
 * The draft of 20 November 2026 came back with its English edition in
 * Bengali, from an English topic, and reached the admin as a normal draft.
 * These hold the guard that stops that: real lines from that draft, and the
 * kind of Arabic the published posts carry, which must keep passing.
 */

// From the Bengali draft, verbatim.
const BENGALI_LINE =
  'যখন একজন কুয়েত, সৌদি আরব বা সংযুক্ত আরব আমিরাতের ফ্রেট ফরওয়ার্ডার **Dachser বা DHL**-এর তাত্ক্ষণিক টুল থেকে একটি ফ্রেট উদ্ধৃতি দেখেন, তখন তারা একটি পরিচ্ছন্ন মূল্য দেখতে পান।'
const BENGALI_HEADING = '## কাস্টমস ডিউটি ও ক্লিয়ারেন্স ফি: অনলাইন কোটেশনের ফাঁক'
const HALF_BENGALI_TITLE = 'উপসাগরীয় কাস্টমস উদ্ধৃতি: Dachser Missing Gulf Costs'

const ENGLISH =
  '## What a Gulf freight quotation must include\n\nAn instant quote from a carrier portal shows the freight. It leaves out customs clearance, free time at the terminal (the Arabic term is الأرضيات), detention and destination charges. See the [ZATCA guidance](https://zatca.gov.sa/en/E-Invoicing/Pages/default.aspx) for invoices.'

// The shape of a published Arabic edition: Latin names, codes and units, a
// link, and the tatweel in بـ and لـ.
const ARABIC =
  '## ما الذي يجب أن يتضمنه عرض أسعار الشحن في الخليج\n\nيعرض التسعير الفوري من DHL وDachser سعر النقل فقط، ولا يشمل التخليص الجمركي أو وقت السماح أو الأرضيات. اطلبوا من الخط الملاحي بـ 5 أيام سماح، وراجعوا [منصة فسح](https://www.fasah.sa/) لـ BAF وCIF وHS code.'

const URDU =
  'کسٹمز کلیئرنس کے لیے یہ دستاویزات ضروری ہیں۔ شپمنٹ کی ترسیل میں تاخیر ہو سکتی ہے اور گودام کے چارجز لگ سکتے ہیں۔'

describe('wrongScript', () => {
  it('passes English, Arabic terms and links included', () => {
    expect(wrongScript('en', ENGLISH)).toBeUndefined()
  })

  it('passes Arabic with Latin names, codes, links and the tatweel', () => {
    expect(wrongScript('ar', ARABIC)).toBeUndefined()
  })

  it('catches the Bengali English edition, and names a word from it', () => {
    expect(wrongScript('en', BENGALI_LINE)).toMatch(/another script, e\.g\. "[ঀ-৿]/)
    expect(wrongScript('en', BENGALI_HEADING)).toMatch(/another script/)
  })

  it('catches a title that is only half English', () => {
    expect(wrongScript('en', HALF_BENGALI_TITLE)).toMatch(/another script/)
  })

  it('catches an Arabic edition written in English', () => {
    expect(wrongScript('ar', ENGLISH)).toMatch(/of its letters are Arabic/)
  })

  it('catches an English edition written in Arabic', () => {
    expect(wrongScript('en', ARABIC)).toMatch(/of its letters are English/)
  })

  it('catches Urdu, which Arabic script alone would let through', () => {
    expect(wrongScript('ar', URDU)).toMatch(/Urdu/)
  })

  // One published English keyword reads like this; `polish` now rewrites it.
  it('holds an English search phrase to English', () => {
    expect(
      wrongScript('en', 'types of bill of lading (بوليصة الشحن البحري / بوليصة الشحن الجوي)'),
    ).toMatch(/of its letters are English/)
    expect(wrongScript('en', 'freight quotation Dachser')).toBeUndefined()
  })

  it('has nothing to say about text with no letters', () => {
    expect(wrongScript('en', '')).toBeUndefined()
    expect(wrongScript('ar', '| 20 | 40 |')).toBeUndefined()
    expect(wrongScript('en', undefined)).toBeUndefined()
  })
})

const english = {
  title: 'Gulf freight quotation: what instant quotes miss',
  excerpt: 'Instant quotes show the freight and leave out the Gulf costs.',
  metaDescription: 'What a Gulf freight quotation must include beyond the freight.',
  focusKeyword: 'freight quotation Dachser',
  markdown: ENGLISH,
  faqs: [{ question: 'What does an instant quote leave out?', answer: 'Customs and free time.' }],
}

const bengali = {
  ...english,
  title: HALF_BENGALI_TITLE,
  excerpt:
    'DHL এবং Dachser থেকে তাত্ক্ষণিক উদ্ধতি উপসাগরীয় অঞ্চলের শিপমেন্টে আসল খরচ ধরতে পারে না।',
  markdown: `${BENGALI_HEADING}\n\n${BENGALI_LINE}`,
  faqs: [{ question: 'তাত্ক্ষণিক কোট কী বাদ দেয়?', answer: 'কাস্টমস এবং ফ্রি টাইম।' }],
}

describe('languageProblems', () => {
  it('finds nothing in a clean edition', () => {
    expect(languageProblems('en', english)).toEqual([])
  })

  it('names every reader-facing field that is in the wrong language', () => {
    const problems = languageProblems('en', bengali)
    expect(problems.map((p) => p.split(' ')[0])).toEqual(['title', 'excerpt', 'markdown', 'faqs'])
    expect(problems[0]).toMatch(/^title is not English: /)
  })

  // The keyword is `polish`'s to fix; it never fails a run on its own.
  it('leaves the search phrase out', () => {
    expect(
      languageProblems('en', { ...english, focusKeyword: 'উপসাগরীয় কাস্টমস উদ্ধৃতি' }),
    ).toEqual([])
  })
})

describe('ensureLanguage', () => {
  it('leaves an edition in its language alone', async () => {
    const write = vi.fn()
    expect(await ensureLanguage('en', english, write)).toBe(english)
    expect(write).not.toHaveBeenCalled()
  })

  it('writes it once more, told what was wrong, when it drifted', async () => {
    const write = vi.fn().mockResolvedValue(english)
    expect(await ensureLanguage('en', bengali, write)).toBe(english)
    expect(write).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledWith(languageProblems('en', bengali))
  })

  it('fails the run when the second attempt drifted too', async () => {
    const write = vi.fn().mockResolvedValue(bengali)
    await expect(ensureLanguage('en', bengali, write)).rejects.toThrow(
      /en: not in English after a second attempt: title is not English/,
    )
    expect(write).toHaveBeenCalledOnce()
  })
})

describe('retryNote', () => {
  it('says nothing on a first attempt', () => {
    expect(retryNote('en')).toBe('')
    expect(retryNote('ar', [])).toBe('')
  })

  it('puts the problems in front of the model on a second', () => {
    const note = retryNote('en', [
      'markdown is not English: 93% of its letters are in another script',
    ])
    expect(note).toMatch(/YOUR PREVIOUS ATTEMPT WAS NOT IN ENGLISH/)
    expect(note).toMatch(/- markdown is not English/)
    expect(note).toMatch(/Write every field in English\.$/)
  })
})
