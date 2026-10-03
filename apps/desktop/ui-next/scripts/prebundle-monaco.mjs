// Pre-bundle `monaco-editor` thành một file ESM tĩnh trong public/vendor/.
//
// Vì sao: Vite dep-optimizer gom monaco thành chunk core ~7.3MB, mà request dep
// .js đi qua transform pipeline của Nuxt — một transform handler nổ
// "Maximum call stack size exceeded" trên file cỡ này → dep fetch 404 →
// import('monaco-editor') văng "Failed to fetch dynamically imported module".
// Exclude khỏi optimizer thì phải serve ~1200 module ESM raw (cold-load ~15-25s).
// Bundle sẵn vào public/ → serve tĩnh, không transform, không `?v`, không
// waterfall — nhanh và miễn nhiễm mọi dep-churn.
//
// Chạy tự động qua `postinstall`/`predev`/`prebuild` (xem package.json). Kết quả
// trong public/vendor/monaco/ được gitignore — regenerate deterministic.
// esbuild là transitive dep của vite → gọi binary trong node_modules/.bin.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const entry = join(
  dirname(require.resolve('monaco-editor/package.json')),
  'esm/vs/editor/editor.main.js',
)
const outdir = join(root, 'public/vendor/monaco')

if (!existsSync(outdir)) mkdirSync(outdir, { recursive: true })

// Monaco import `.css` side-effect → esbuild gom thành monaco.css cạnh output;
// `.ttf` (codicon) emit file kèm URL tương đối → serve cùng thư mục public.
execFileSync(
  join(root, 'node_modules/.bin/esbuild'),
  [
    entry,
    '--bundle',
    '--format=esm',
    '--target=es2022',
    '--platform=browser',
    '--minify',
    `--outfile=${join(outdir, 'monaco.js')}`,
    '--loader:.ttf=file',
  ],
  { stdio: 'inherit' },
)

console.warn('[prebundle-monaco] → public/vendor/monaco/monaco.js')
