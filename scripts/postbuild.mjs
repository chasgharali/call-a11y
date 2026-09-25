// Runs after tsup.
//  1. Copies the optional stylesheet into dist/ (exported as "call-a11y/styles.css").
//  2. Prepends "use client" to the React entry only. esbuild drops module-level
//     directives when it bundles, so this has to happen after the build. The
//     core entry stays free of it: it is DOM-only and has no reason to be
//     marked client-only.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'

copyFileSync('src/styles.css', 'dist/styles.css')

for (const file of ['dist/react.js', 'dist/react.cjs']) {
  const source = readFileSync(file, 'utf8')
  if (!source.startsWith('"use client"')) {
    writeFileSync(file, `"use client";\n${source}`)
  }
}
console.log('postbuild: styles.css copied, "use client" set on the React entry')
