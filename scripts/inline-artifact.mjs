// Turns dist-artifact/index.html + assets into ONE self-contained HTML fragment (artifact.html).
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = 'dist-artifact'
const html = readFileSync(join(dir, 'index.html'), 'utf8')
const jsPath = html.match(/<script[^>]+src="\/?([^"]+\.js)"/)?.[1]
const cssPath = html.match(/<link[^>]+href="\/?([^"]+\.css)"/)?.[1]
if (!jsPath || !cssPath) throw new Error('could not find built js/css in dist-artifact/index.html')

const js = readFileSync(join(dir, jsPath), 'utf8').replace(/<\/script/gi, '<\\/script')
const css = readFileSync(join(dir, cssPath), 'utf8').replace(/<\/style/gi, '<\\/style')

const out = `<title>Wander Prototype</title>
<style>${css}
/* sandboxed preview: size to the frame, not the window */
html,body,#root{height:100%}
.h-dvh{height:100%}.min-h-dvh{min-height:100%}
</style>
<div id="root"></div>
<script type="module">${js}</script>
`
writeFileSync('artifact.html', out)
console.log(`artifact.html ${(out.length / 1024).toFixed(0)} KB`)
