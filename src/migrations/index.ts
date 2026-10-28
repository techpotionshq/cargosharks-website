import * as migration_20261027_205725_initial from './20261027_205725_initial'
import * as migration_20261027_210000_seed_content from './20261027_210000_seed_content'
import * as migration_20261028_075203_stock_cover_credit from './20261028_075203_stock_cover_credit'

export const migrations = [
  {
    up: migration_20261027_205725_initial.up,
    down: migration_20261027_205725_initial.down,
    name: '20261027_205725_initial',
  },
  {
    up: migration_20261027_210000_seed_content.up,
    down: migration_20261027_210000_seed_content.down,
    name: '20261027_210000_seed_content',
  },
  {
    up: migration_20261028_075203_stock_cover_credit.up,
    down: migration_20261028_075203_stock_cover_credit.down,
    name: '20261028_075203_stock_cover_credit',
  },
]
