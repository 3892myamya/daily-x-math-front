// 開発サーバー（vite）と、手元の将棋エンジンの中継（shogi-engine-bridge.mjs）をまとめて起動する。
// 使い方: SHOGI_ENGINE=<USIエンジンの実行ファイル> npm run dev:engine [-- vite に渡す引数（--host など）]
// Ctrl+C で両方とも止まる。エンジンの場所が指定されていない・起動できないときは、vite だけで動かす
// （アプリはブラウザ内のエンジンを使う）
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const children = new Set()
let stopping = false

function run(name, args, { required }) {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' })
    children.add(child)
    child.on('exit', (code) => {
        children.delete(child)
        if (stopping) {
            if (!children.size) process.exit(0)
            return
        }
        if (required) {
            // vite が止まったら、中継も止めて終わる
            console.log(`[dev:engine] ${name} が終了しました（code ${code}）`)
            stopAll()
        } else {
            console.log(`[dev:engine] ${name} は動いていません。アプリはブラウザ内のエンジンを使います`)
        }
    })
    return child
}

function stopAll() {
    if (stopping) return
    stopping = true
    for (const child of children) child.kill('SIGINT')
    if (!children.size) process.exit(0)
}

if (process.env.SHOGI_ENGINE) {
    run('将棋エンジンの中継', [path.join(root, 'tools/shogi-engine-bridge.mjs')], { required: false })
} else {
    console.log('[dev:engine] SHOGI_ENGINE にエンジンの場所が指定されていないので、vite だけ起動します')
}
run('vite', [path.join(root, 'node_modules/vite/bin/vite.js'), ...process.argv.slice(2)], { required: true })

// Ctrl+C は子のプロセスにも届くので、ここでは両方が止まるのを待つ
process.on('SIGINT', stopAll)
process.on('SIGTERM', stopAll)
