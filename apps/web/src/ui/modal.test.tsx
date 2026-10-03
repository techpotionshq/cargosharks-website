/**
 * A dialog opens from its server-rendered HTML, before hydration.
 *
 * "Match" on a long supplier bill sometimes opened nothing on the first press:
 * the click landed on a button React had not hydrated yet, so it had no
 * handler. The trigger now carries HTML's invoker command, which the browser
 * acts on with no script, and this pins that the server markup wires the
 * button to the dialog it opens.
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Modal } from './modal'
import { RecordDialog } from './record-dialog'

const commandOf = (html: string) => {
  const button = /<button[^>]*commandfor="([^"]+)"[^>]*>/.exec(html)
  const dialog = /<dialog[^>]*id="([^"]+)"/.exec(html)
  return { button: button?.[0], target: button?.[1], dialog: dialog?.[1] }
}

describe('opening a dialog before hydration', () => {
  it('points the record dialog trigger at its own dialog, as show-modal', () => {
    const html = renderToStaticMarkup(
      <RecordDialog
        action={async () => ({})}
        fields={[{ kind: 'hidden', name: 'id', value: 'x' }]}
        labels={{
          open: 'Match',
          title: 'Match',
          submit: 'Match',
          submitting: '…',
          cancel: 'Cancel',
        }}
        iconOnly
      />,
    )
    const { button, target, dialog } = commandOf(html)
    expect(target).toBeDefined()
    expect(target).toBe(dialog)
    expect(button).toContain('command="show-modal"')
  })

  it('gives a custom trigger the same attributes to spread', () => {
    const html = renderToStaticMarkup(
      <Modal
        title="Title"
        trigger={({ onClick, invoker }) => (
          <button type="button" onClick={onClick} {...invoker}>
            Open
          </button>
        )}
      >
        <p>Body</p>
      </Modal>,
    )
    const { target, dialog } = commandOf(html)
    expect(target).toBe(dialog)
  })
})
