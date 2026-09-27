import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const src = join(root, 'web', 'dist')
const dest = join(root, 'server', 'public')

if (!existsSync(src)) {
  throw new Error(`Missing ${src}; run web build first`)
}

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })
console.log(`Copied ${src} → ${dest}`)
