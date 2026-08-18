import pg from 'pg'
for (const [label, url] of [
  ['behind/app_user b_pw', 'postgres://app_user:b_pw@127.0.0.1:5544/qabandi_behind'],
  ['main/app_user u_pw', 'postgres://app_user:u_pw@127.0.0.1:5544/qabandi'],
  ['main/app_user b_pw', 'postgres://app_user:b_pw@127.0.0.1:5544/qabandi'],
]) {
  const c = new pg.Client({ connectionString: url })
  try {
    await c.connect()
    const r = await c.query('select count(*)::int n from drizzle.__drizzle_migrations')
    console.log(`${label}: OK, migrations=${r.rows[0].n}`)
    await c.end()
  } catch (e) {
    console.log(`${label}: ${(e as Error).message.slice(0, 60)}`)
  }
}
