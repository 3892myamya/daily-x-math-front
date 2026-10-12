// 手元のPCで動かしている将棋エンジン（tools/shogi-engine-bridge.mjs の中継）につなぐ。
// 開発版（npm run dev）でだけ使い、つながれば wasm のエンジンと同じ形（postMessage / addMessageListener / terminate）で扱える。
// 中継が動いていなければ、すぐに null を返して wasm のエンジンを使う
export const LOCAL_ENGINE_URL = 'ws://127.0.0.1:8790'
// 中継が「別のページがエンジンを引き継いだ」ことを知らせる行（tools/shogi-engine-bridge.mjs）
const TAKEN_OVER = 'info string bridge taken-over'

export function connectLocalEngine(url = LOCAL_ENGINE_URL, timeoutMs = 800) {
    return new Promise((resolve) => {
        let socket
        try {
            socket = new WebSocket(url)
        } catch {
            resolve(null)
            return
        }
        const listeners = []
        const closeListeners = []
        let opened = false
        let takenOver = false
        const timer = setTimeout(() => {
            if (!opened) {
                socket.close()
                resolve(null)
            }
        }, timeoutMs)
        socket.onopen = () => {
            opened = true
            clearTimeout(timer)
            resolve({
                local: true,
                postMessage(line) {
                    if (socket.readyState === WebSocket.OPEN) socket.send(line)
                },
                addMessageListener(listener) {
                    listeners.push(listener)
                },
                // 中継やエンジンが止まったときに呼ぶ。別のページに引き継がれて切れたときは引数が true
                onClose(listener) {
                    closeListeners.push(listener)
                },
                terminate() {
                    closeListeners.length = 0
                    socket.close()
                },
            })
        }
        socket.onmessage = (event) => {
            const line = String(event.data)
            if (line === TAKEN_OVER) {
                takenOver = true
                return
            }
            for (const listener of listeners) listener(line)
        }
        socket.onerror = () => {
            if (!opened) {
                clearTimeout(timer)
                resolve(null)
            }
        }
        socket.onclose = () => {
            if (opened) for (const listener of closeListeners) listener(takenOver)
        }
    })
}
