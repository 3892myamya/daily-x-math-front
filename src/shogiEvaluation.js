import { moveQualifier } from './shogiKif.js'

const PIECE_CODES = {
    FU: 'P', KY: 'L', KE: 'N', GI: 'S', KI: 'G', KA: 'B', HI: 'R', OU: 'K',
}

const CODE_TO_TYPE = Object.fromEntries(
    Object.entries(PIECE_CODES).map(([type, code]) => [code, type]),
)

const PIECE_NAMES = {
    FU: '歩', KY: '香', KE: '桂', GI: '銀', KI: '金', KA: '角', HI: '飛', OU: '玉',
}

const PROMOTED_NAMES = {
    FU: 'と', KY: '成香', KE: '成桂', GI: '成銀', KA: '馬', HI: '龍',
}

const FULL_WIDTH_NUMBERS = ['', '１', '２', '３', '４', '５', '６', '７', '８', '９']
const KANJI_NUMBERS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const HAND_ORDER = ['HI', 'KA', 'KI', 'GI', 'KE', 'KY', 'FU']

export function positionToSfen(board, capturedPieces, sideToMove) {
    const boardSfen = board.map((row) => {
        let empty = 0
        let result = ''
        for (const piece of row) {
            if (!piece) {
                empty++
                continue
            }
            if (empty) {
                result += empty
                empty = 0
            }
            const baseCode = PIECE_CODES[piece.type]
            const code = piece.owner === 'sente' ? baseCode : baseCode.toLowerCase()
            result += `${piece.promoted ? '+' : ''}${code}`
        }
        return result + (empty || '')
    }).join('/')

    let hands = ''
    for (const owner of ['sente', 'gote']) {
        for (const type of HAND_ORDER) {
            const count = capturedPieces[owner][type] ?? 0
            if (!count) continue
            const baseCode = PIECE_CODES[type]
            const code = owner === 'sente' ? baseCode : baseCode.toLowerCase()
            hands += `${count > 1 ? count : ''}${code}`
        }
    }

    return `${boardSfen} ${sideToMove === 'sente' ? 'b' : 'w'} ${hands || '-'} 1`
}

// previousTo: 読み筋の直前の手（棋譜の最後の手）の移動先。同じマスへの手は「同」で書く（▲２四歩 △同歩 ▲同飛）
export function formatUsiPv(moves, initialBoard, initialSideToMove, previousTo = null) {
    const board = structuredClone(initialBoard)
    let owner = initialSideToMove
    let lastTo = previousTo

    return moves.map((move) => {
        const notation = formatAndApplyMove(move, board, owner)
        owner = owner === 'sente' ? 'gote' : 'sente'
        const target = move.match(/([1-9])([a-i])\+?$/)
        const to = target ? usiSquareToBoard(target[1], target[2]) : null
        const recapture = to && lastTo && to.row === lastTo.row && to.col === lastTo.col && !move.includes('*')
        lastTo = to
        return recapture ? `${notation[0]}同${notation.slice(3)}` : notation
    })
}

function formatAndApplyMove(move, board, owner) {
    const marker = owner === 'sente' ? '▲' : '△'
    const dropMatch = move.match(/^([PLNSGBR])\*([1-9])([a-i])$/)
    if (dropMatch) {
        const type = CODE_TO_TYPE[dropMatch[1]]
        const destination = usiSquareToBoard(dropMatch[2], dropMatch[3])
        board[destination.row][destination.col] = { type, owner, promoted: false }
        return `${marker}${formatDestination(dropMatch[2], dropMatch[3])}${PIECE_NAMES[type]}打`
    }

    const normalMatch = move.match(/^([1-9])([a-i])([1-9])([a-i])(\+)?$/)
    if (!normalMatch) return `${marker}${move}`

    const from = usiSquareToBoard(normalMatch[1], normalMatch[2])
    const to = usiSquareToBoard(normalMatch[3], normalMatch[4])
    const piece = board[from.row]?.[from.col]
    if (!piece) return `${marker}${move}`

    const promotes = Boolean(normalMatch[5])
    const pieceName = piece.promoted
        ? (PROMOTED_NAMES[piece.type] ?? PIECE_NAMES[piece.type])
        : PIECE_NAMES[piece.type]
    // 同種の駒が複数動ける場合は「右・左・上・引・寄・直」を付ける
    const qualifier = moveQualifier(board, { owner, type: piece.type, from, to, drop: false })
    const notation = `${marker}${formatDestination(normalMatch[3], normalMatch[4])}${pieceName}${qualifier}${promotes ? '成' : ''}`

    board[to.row][to.col] = { ...piece, promoted: piece.promoted || promotes }
    board[from.row][from.col] = null
    return notation
}

function usiSquareToBoard(file, rank) {
    return {
        row: rank.charCodeAt(0) - 'a'.charCodeAt(0),
        col: 9 - Number(file),
    }
}

function formatDestination(file, rank) {
    const rankNumber = rank.charCodeAt(0) - 'a'.charCodeAt(0) + 1
    return `${FULL_WIDTH_NUMBERS[Number(file)]}${KANJI_NUMBERS[rankNumber]}`
}
