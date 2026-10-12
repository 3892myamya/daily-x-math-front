// 手元のPCで動かしている将棋エンジン（tools/shogi-engine-bridge.mjs の中継）につなぐ。
// 開発版（npm run dev）でだけ使い、つながれば wasm のエンジンと同じ形（postMessage / addMessageListener / terminate）で扱える。
// 中継が動いていなければ、すぐに null を返して wasm のエンジンを使う
export const LOCAL_ENGINE_URL = 'ws://127.0.0.1:8790'

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
                // 中継やエンジンが止まったときに呼ぶ
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
            for (const listener of listeners) listener(String(event.data))
        }
        socket.onerror = () => {
            if (!opened) {
                clearTimeout(timer)
                resolve(null)
            }
        }
        socket.onclose = () => {
            if (opened) for (const listener of closeListeners) listener()
        }
    })
}
