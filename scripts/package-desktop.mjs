import { cp, mkdir, readFile, writeFile, stat, unlink, chmod } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const stage = join(root, '.release')
const resources = join(stage, 'resources')
const platform = process.platform, arch = process.arch
if (!['win32-x64', 'darwin-arm64', 'darwin-x64'].includes(`${platform}-${arch}`)) throw Error('UNSUPPORTED_RELEASE_PLATFORM')
const runtime = join(resources, 'runtime', `${platform}-${arch}`)
const backend = join(runtime, 'backend')
const nodeVersion = '24.16.0'

async function run(command, args, options = {}) {
  await new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true, ...options })
    child.on('error', reject)
    child.on('close', code => code === 0 ? accept() : reject(Error(`${basename(command)} exited ${code}`)))
  })
}

async function download(url, target, expected) {
  const response = await fetch(url, { signal: AbortSignal.timeout(600000) })
  if (!response.ok || !response.body) throw Error(`DOWNLOAD_${response.status}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target))
  if (expected && createHash('sha256').update(await readFile(target)).digest('hex') !== expected) throw Error('DOWNLOAD_CHECKSUM_MISMATCH')
}

if (process.argv[2] === 'prepare') {
  if (await stat(backend).catch(() => null)) throw Error('RELEASE_STAGE_ALREADY_EXISTS')
  await mkdir(backend, { recursive: true })
  for (const file of ['server', 'dist', 'package.json', 'package-lock.json', 'LICENSE', 'LICENSE.details', 'THIRD_PARTY_NOTICES.md', 'THIRD-PARTY-NOTICES.md', 'licenses']) await cp(join(root, file), join(backend, file), { recursive: true })
  const installScript = platform === 'win32' ? join(resolve(process.execPath, '..'), 'node_modules/npm/bin/npm-cli.js') : join(resolve(process.execPath, '../..'), 'lib/node_modules/npm/bin/npm-cli.js')
  await run(process.execPath, [installScript, 'ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: backend })
  await mkdir(join(runtime, 'bin'), { recursive: true })
  const downloads = join(stage, 'downloads'); await mkdir(downloads, { recursive: true })
  const extension = platform === 'win32' ? 'zip' : 'tar.gz'
  const filename = `node-v${nodeVersion}-${platform}-${arch}.${extension}`
  const base = `https://nodejs.org/dist/v${nodeVersion}/`
  const sums = await (await fetch(base + 'SHASUMS256.txt', { signal: AbortSignal.timeout(60000) })).text()
  const hash = sums.split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(parts => parts[1] === filename)?.[0]
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw Error('NODE_RELEASE_CHECKSUM_MISSING')
  const archive = join(downloads, filename)
  await download(base + filename, archive, hash)
  await run('tar', ['-xf', archive, '-C', downloads])
  const extracted = join(downloads, `node-v${nodeVersion}-${platform}-${arch}`)
  await cp(join(extracted, platform === 'win32' ? 'node.exe' : 'bin/node'), join(runtime, 'bin', platform === 'win32' ? 'node.exe' : 'node'))
  await cp(join(extracted, 'LICENSE'), join(runtime, 'bin/LICENSE'))
  await run(process.execPath, [join(backend, 'node_modules/playwright/cli.js'), 'install', '--only-shell', 'chromium'], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(runtime, 'browsers') } })
  await run(process.execPath, [join(root, 'scripts/setup-asr.mjs')], { env: { ...process.env, DODA_DATA: resources } })
  await unlink(join(resources, 'asr/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2')).catch(error => { if (error.code !== 'ENOENT') throw error })
  if (platform === 'darwin') {
    await chmod(join(runtime, 'bin/node'), 0o755)
    await mkdir(join(resources, 'helpers'), { recursive: true })
    await run('clang', ['-arch', arch === 'arm64' ? 'arm64' : 'x86_64', '-mmacosx-version-min=11.0', 'src-tauri/keychain.c', '-framework', 'Security', '-framework', 'CoreFoundation', '-o', join(resources, 'helpers/doda-keychain')])
  }
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  await writeFile(join(resources, 'release.json'), JSON.stringify({ version: pkg.version, platform, arch, nodeVersion, nodeSHA256: hash, privateDataIncluded: false }, null, 2))
  const config = { bundle: { active: true, targets: [platform === 'win32' ? 'nsis' : 'app'], resources: { '../.release/resources/': '' }, ...(platform === 'win32' ? { windows: { nsis: { installMode: 'currentUser', displayLanguageSelector: false, languages: ['SimpChinese', 'English'], compression: 'lzma' } } } : { macOS: { minimumSystemVersion: '11.0', infoPlist: 'Info.plist' } }) } }
  await writeFile(join(stage, 'tauri.release.json'), JSON.stringify(config, null, 2))
  console.log(`Prepared ${platform}-${arch} runtime.`)
} else if (process.argv[2] === 'build') {
  await run(process.execPath, [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', '--config', join(stage, 'tauri.release.json')])
} else throw Error('USE_PREPARE_OR_BUILD')
