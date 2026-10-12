// 手元のPCで動かす将棋エンジン（USI）と、開発版の将棋インフルエンスマップ（npm run dev）をつなぐ中継プログラム。
//
// 使い方:
//   npm run engine -- --engine <USIエンジンの実行ファイル> [--port 8790] [--threads 14] [--hash 1024]
//   （環境変数 SHOGI_ENGINE にエンジンの場所を入れておけば --engine は省略できる）
//
// 安全のための決まり:
// - 127.0.0.1 でだけ待ち受け、ほかのPCからは接続できない
// - 接続してきたページが localhost / 127.0.0.1 のものでなければ断る（ほかのWebページからは使えない）
// - エンジンはこのプログラムを自分で起動したときだけ動く。アプリの公開版はここへつなぎに来ない
// - 受け付けるのは局面の評価に使うUSIコマンドだけ（ファイルを書き出すオプションなどは送れない）
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

function option(name, fallback) {
    const index = process.argv.indexOf(`--${name}`)
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const engineOption = option('engine', process.env.SHOGI_ENGINE)
// エンジンは自分のフォルダで起動するので、相対パスはここで絶対パスにしておく
const enginePath = engineOption && path.resolve(engineOption)
const port = Number(option('port', '8790'))
const threads = Number(option('threads', String(Math.max(1, os.cpus().length - 2))))
const hash = Number(option('hash', '1024'))

if (!engineOption) {
    console.error('USIエンジンの実行ファイルを --engine で指定してください（例: npm run engine -- --engine ./YaneuraOu.exe）')
    process.exit(1)
}

// アプリから受け付けるコマンド。setoption は候補手の数（MultiPV）だけ
const ALLOWED = [/^usi$/, /^isready$/, /^usinewgame$/, /^stop$/, /^setoption name MultiPV value \d{1,2}$/, /^position (startpos|sfen) [\w+\-/ *]+$/, /^go( (depth|movetime|nodes) \d+)*$/]

// ---- エンジン ----
let engine = null
let ready = null
// 送った go の数と、受け取った bestmove の数の差（探索中の数）
let searching = 0
// 接続が切れたときに止めた探索の、もう要らない bestmove の数
let discarding = 0
let client = null

function startEngine() {
    if (engine) return ready
    console.log(`エンジンを起動します: ${enginePath}`)
    engine = spawn(enginePath, [], { cwd: path.dirname(enginePath) })
    engine.on('error', (error) => {
        // 実行ファイルが見つからない・起動できないときは、中継は止めずに知らせる
        console.error(`エンジンを起動できませんでした: ${error.message}`)
        engine = null
        if (client) client.end()
    })
    searching = 0
    discarding = 0
    let buffer = ''
    let resolveReady
    ready = new Promise((resolve) => { resolveReady = resolve })
    engine.stdout.on('data', (chunk) => {
        buffer += chunk.toString()
        let index
        while ((index = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, index).replace(/\r$/, '')
            buffer = buffer.slice(index + 1)
            if (line === 'readyok' && resolveReady) {
                // 起動時の準備（スレッド数・置換表の大きさ）が済んだ
                resolveReady()
                resolveReady = null
                continue
            }
            if (resolveReady) continue
            if (line.startsWith('bestmove')) {
                searching = Math.max(0, searching - 1)
                if (discarding > 0) {
                    discarding--
                    continue
                }
            } else if (discarding > 0) {
                continue
            }
            if (client) sendText(client, line)
        }
    })
    engine.on('exit', (code) => {
        console.log(`エンジンが終了しました（code ${code}）`)
        engine = null
        if (client) client.end()
    })
    const send = (line) => engine.stdin.write(`${line}\n`)
    send('usi')
    send(`setoption name Threads value ${threads}`)
    send(`setoption name USI_Hash value ${hash}`)
    // 定跡は使わず、毎回探索した評価値を返す
    send('setoption name USI_OwnBook value false')
    send('setoption name ConsiderationMode value true')
    send('isready')
    return ready
}

function toEngine(line) {
    if (!engine) return
    if (line.startsWith('go')) searching++
    engine.stdin.write(`${line}\n`)
}

// ---- WebSocket（テキストのやり取りだけの最小限の実装） ----
function sendText(socket, text) {
    const payload = Buffer.from(text)
    let header
    if (payload.length < 126) {
        header = Buffer.from([0x81, payload.length])
    } else if (payload.length < 65536) {
        header = Buffer.alloc(4)
        header[0] = 0x81
        header[1] = 126
        header.writeUInt16BE(payload.length, 2)
    } else {
        header = Buffer.alloc(10)
        header[0] = 0x81
        header[1] = 127
        header.writeBigUInt64BE(BigInt(payload.length), 2)
    }
    socket.write(Buffer.concat([header, payload]))
}

function readFrames(socket, onText) {
    let buffer = Buffer.alloc(0)
    socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk])
        while (buffer.length >= 2) {
            const opcode = buffer[0] & 0x0f
            let length = buffer[1] & 0x7f
            let offset = 2
            if (length === 126) {
                if (buffer.length < 4) return
                length = buffer.readUInt16BE(2)
                offset = 4
            } else if (length === 127) {
                if (buffer.length < 10) return
                length = Number(buffer.readBigUInt64BE(2))
                offset = 10
            }
            const masked = (buffer[1] & 0x80) !== 0
            const total = offset + (masked ? 4 : 0) + length
            if (buffer.length < total) return
            let payload = buffer.subarray(offset + (masked ? 4 : 0), total)
            if (masked) {
                const mask = buffer.subarray(offset, offset + 4)
                payload = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]))
            }
            buffer = buffer.subarray(total)
            if (opcode === 0x1) onText(payload.toString())
            else if (opcode === 0x8) socket.end()
            else if (opcode === 0x9) socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]))
        }
    })
}

function isLocalOrigin(origin) {
    try {
        const { hostname, protocol } = new URL(origin)
        return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1')
    } catch {
        return false
    }
}

const server = http.createServer((req, res) => {
    res.writeHead(404)
    res.end()
})

server.on('upgrade', async (req, socket) => {
    const key = req.headers['sec-websocket-key']
    if (!key || !isLocalOrigin(req.headers.origin)) {
        console.log(`接続を断りました（origin: ${req.headers.origin ?? 'なし'}）`)
        socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
        return
    }
    const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)

    // つなげるのは1つのページだけ。新しいページがつないだら、前のページとの接続は切る
    if (client) client.end()
    client = socket
    console.log('アプリとつながりました')
    await startEngine()
    readFrames(socket, (text) => {
        for (const line of text.split('\n').map((item) => item.trim()).filter(Boolean)) {
            if (ALLOWED.some((pattern) => pattern.test(line))) toEngine(line)
            else console.log(`受け付けないコマンドを無視しました: ${line}`)
        }
    })
    const release = () => {
        if (client !== socket) return
        client = null
        // 探索中なら止め、その結果は次につないだページに渡さない
        if (engine && searching > 0) {
            discarding += searching
            engine.stdin.write('stop\n')
        }
        console.log('アプリとの接続が切れました')
    }
    socket.on('close', release)
    socket.on('error', release)
})

server.listen(port, '127.0.0.1', () => {
    console.log(`将棋エンジンの中継を開始しました: ws://127.0.0.1:${port}（Threads ${threads}, USI_Hash ${hash}MB）`)
    console.log('npm run dev で開いたアプリが、このエンジンを使います。終了は Ctrl+C')
})

process.on('SIGINT', () => {
    engine?.stdin.write('quit\n')
    process.exit(0)
})
