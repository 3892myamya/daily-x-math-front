export function isUnwindError(reason) {
    if (reason === 'unwind') return true
    if (!reason || typeof reason !== 'object') return false
    return reason.reason === 'unwind' || reason.error === 'unwind'
}

export function isEngineWorkerError(event, workerUrl) {
    if (!event || !workerUrl) return false

    const workerFile = fileName(workerUrl)
    const filenames = [
        event.filename,
        event.error?.filename,
        event.reason?.filename,
    ]

    return filenames.some((filename) => {
        if (typeof filename !== 'string') return false
        return filename === workerUrl || fileName(filename) === workerFile
    })
}

export function isFatalEngineEvent(event, workerUrl) {
    return isUnwindError(event?.error ?? event?.reason) || isEngineWorkerError(event, workerUrl)
}

function fileName(url) {
    return String(url).split(/[?#]/, 1)[0].split('/').pop()
}
