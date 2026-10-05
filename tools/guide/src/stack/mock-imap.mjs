// A minimal, always-empty IMAP inbox for the seeded stack, so the story's
// mailbox row reads as healthy and the poller has something to talk to.
// Mail itself arrives through the signed inbound-mail webhook instead.
net
  .createServer((s) => {
    s.write('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN UIDPLUS] demo ready\r\n')
    let buf = ''
    s.on('data', (d) => {
      buf += d.toString()
      let i
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 2)
        const [tag, cmdRaw, ...rest] = line.split(' ')
        const cmd = (cmdRaw || '').toUpperCase()
        const sub = (rest[0] || '').toUpperCase()
        if (cmd === 'CAPABILITY')
          s.write('* CAPABILITY IMAP4rev1 AUTH=PLAIN UIDPLUS\r\n' + tag + ' OK done\r\n')
        else if (cmd === 'LOGIN' || cmd === 'AUTHENTICATE')
          s.write(tag + ' OK [CAPABILITY IMAP4rev1 UIDPLUS] logged in\r\n')
        else if (cmd === 'SELECT' || cmd === 'EXAMINE')
          s.write(
            '* FLAGS (\\Seen \\Answered)\r\n* 0 EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 1] ok\r\n* OK [UIDNEXT 1] ok\r\n' +
              tag +
              ' OK [READ-WRITE] selected\r\n',
          )
        else if (cmd === 'SEARCH' || (cmd === 'UID' && sub === 'SEARCH'))
          s.write('* SEARCH\r\n' + tag + ' OK done\r\n')
        else if (cmd === 'LIST')
          s.write('* LIST (\\HasNoChildren) "/" INBOX\r\n' + tag + ' OK done\r\n')
        else if (cmd === 'LOGOUT') {
          s.write('* BYE\r\n' + tag + ' OK bye\r\n')
          s.end()
        } else if (tag) s.write(tag + ' OK done\r\n')
      }
    })
    s.on('error', () => {})
  })
  .listen(Number(process.env.GUIDE_IMAP_PORT ?? 3163), '127.0.0.1')
