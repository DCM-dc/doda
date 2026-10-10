import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const root = resolve(process.env.DODA_TEST_ROOT || '.data/runtime-probe')
await mkdir(root, { recursive: true })
const patch = join(root, 'guard.patch.yml')
await writeFile(patch, `- insert:\n    - id: doda-project-tools\n      name: ${JSON.stringify(resolve('server/runtime-plugin.mjs').replaceAll('\\', '/'))}\n`)
const harness = new DeepSeekHarness({ profile: 'sdk-minimal', dshHome: join(root, 'dsh'), cwd: root, model: 'deepseek-flash', patches: [patch], env: { ...process.env, DEEPSEEK_API_KEY: '', DODA_PROJECT_ROOT: root }, initializeTimeoutMs: 30000 })
try { await harness.start(); process.stdout.write('DSH_NATIVE_HANDSHAKE_OK\n') }
finally { await harness.close() }
