import { readFileSync } from 'node:fs'
import { compileScript, compileStyle, parse } from 'vue/compiler-sfc'
let failed = 0
for (const file of process.argv.slice(2)) {
  const source = readFileSync(file, 'utf8')
  const { descriptor, errors } = parse(source, { filename: file })
  if (errors.length) { failed++; console.log(`PARSE FAIL ${file}`); errors.forEach(e => console.log('   ', e.message)); continue }
  try {
    compileScript(descriptor, { id: file, inlineTemplate: true, templateOptions: { compilerOptions: { isCustomElement: (t) => t.startsWith('md-') } } })
  } catch (e) { failed++; console.log(`SCRIPT/TEMPLATE FAIL ${file}`); console.log('   ', e.message); continue }
  for (const style of descriptor.styles) {
    const r = compileStyle({ source: style.content, filename: file, id: 'data-v-test', scoped: style.scoped })
    if (r.errors.length) { failed++; console.log(`STYLE FAIL ${file}`); r.errors.forEach(e => console.log('   ', String(e))) }
  }
  console.log(`ok    ${file}`)
}
console.log(failed === 0 ? 'all SFCs compiled' : `${failed} file(s) failed`)
process.exitCode = failed === 0 ? 0 : 1
