import {describe,it,expect} from 'vitest'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import type {DesignSystem} from '../server/contracts'

const catalog:DesignSystem[]=JSON.parse(await readFile(new URL('../server/designs/catalog.json',import.meta.url),'utf8'))

describe('Complete Open Design packages',()=>{
 it.each(['apple','duolingo','atelier-zero'])('retains every declared file and the canonical CSS for %s',id=>{
  const design=catalog.find(item=>item.package?.id===id)!,pkg=design.package!,manifest=JSON.parse(pkg.files['manifest.json'])
  const paths=[...Object.values(manifest.files),manifest.usage,manifest.componentsManifest,...manifest.preview.pages.map((page:{path:string})=>page.path),...Object.values(manifest.sourceFiles)] as string[]
  expect(pkg.files['tokens.css']).toContain(':root')
  for(const path of paths)expect(pkg.files[path],path).toBeTypeOf('string')
  expect(pkg.hash).toBe(createHash('sha256').update(JSON.stringify(pkg.files)).digest('hex'))
  expect(JSON.parse(pkg.files['source/token-contract.report.json'])).toBeTypeOf('object')
 })
})
