import { describe, expect, it, vi } from 'vitest'
import { ensureFaqs, usableFaqs } from '../scripts/blog/lib.mjs'

/**
 * A generated post never reaches a pull request without an FAQ in each
 * language. The first draft came back with five Arabic answers and an empty
 * English list; `ensureFaqs` is what stops that recurring.
 */
const article = { title: 'Demurrage vs detention', markdown: '## What is demurrage?\n\nA charge.' }
const two = [
  { question: 'What is demurrage?', answer: 'A charge inside the terminal.' },
  { question: 'What is detention?', answer: 'A charge outside the terminal.' },
]

describe('ensureFaqs', () => {
  it('leaves a post that already has its FAQ alone', async () => {
    const ask = vi.fn()
    const copy = await ensureFaqs('en', { ...article, faqs: two }, ask)
    expect(copy.faqs).toEqual(two)
    expect(ask).not.toHaveBeenCalled()
  })

  it('asks for the FAQ alone when the list came back empty', async () => {
    const ask = vi.fn().mockResolvedValue(two)
    const copy = await ensureFaqs('en', { ...article, faqs: [] }, ask)
    expect(copy.faqs).toEqual(two)
    expect(ask).toHaveBeenCalledOnce()
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ markdown: article.markdown }))
  })

  it('counts only entries with both a question and an answer', async () => {
    const blank = [{ question: 'Half?', answer: ' ' }, two[0]]
    const ask = vi.fn().mockResolvedValue(two)
    await ensureFaqs('ar', { ...article, faqs: blank }, ask)
    expect(ask).toHaveBeenCalledOnce()
  })

  it('fails the run after the retries rather than ship an empty FAQ', async () => {
    const ask = vi.fn().mockResolvedValue([])
    await expect(ensureFaqs('en', { ...article, faqs: [] }, ask)).rejects.toThrow(
      /en: 0 usable FAQ\(s\) after 2 requests/,
    )
    expect(ask).toHaveBeenCalledTimes(2)
  })
})

describe('usableFaqs', () => {
  it('drops entries missing either half', () => {
    expect(usableFaqs({ faqs: [{ question: 'Q' }, { answer: 'A' }, two[0]] })).toEqual([two[0]])
    expect(usableFaqs({})).toEqual([])
  })
})
