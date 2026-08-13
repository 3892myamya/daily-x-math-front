const TYPES = { 歩: 'FU', 香: 'KY', 桂: 'KE', 銀: 'GI', 金: 'KI', 角: 'KA', 飛: 'HI', 玉: 'OU', 王: 'OU', と: 'FU', 成香: 'KY', 杏: 'KY', 成桂: 'KE', 圭: 'KE', 成銀: 'GI', 全: 'GI', 馬: 'KA', 龍: 'HI', 竜: 'HI' }
const NAMES = { FU: '歩', KY: '香', KE: '桂', GI: '銀', KI: '金', KA: '角', HI: '飛', OU: '玉' }
const PROMOTED = { FU: 'と', KY: '成香', KE: '成桂', GI: '成銀', KA: '馬', HI: '龍' }
const FULL = ['', '１', '２', '３', '４', '５', '６', '７', '８', '９']
const KANJI = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const NUM = { '１': 1, '２': 2, '３': 3, '４': 4, '５': 5, '６': 6, '７': 7, '８': 8, '９': 9 }

const piece = (type, owner) => ({ type, owner, promoted: false })
export function createStandardPosition() {
    return {
        board: [
            ['KY','KE','GI','KI','OU','KI','GI','KE','KY'].map(t => piece(t, 'gote')),
            [null,piece('HI','gote'),null,null,null,null,null,piece('KA','gote'),null],
            Array.from({ length: 9 }, () => piece('FU','gote')),
            ...Array.from({ length: 3 }, () => Array(9).fill(null)),
            Array.from({ length: 9 }, () => piece('FU','sente')),
            [null,piece('KA','sente'),null,null,null,null,null,piece('HI','sente'),null],
            ['KY','KE','GI','KI','OU','KI','GI','KE','KY'].map(t => piece(t, 'sente')),
        ],
        capturedPieces: { sente: {}, gote: {} }, sideToMove: 'sente',
    }
}

export function decodeKif(buffer, filename) {
    const encoding = filename.toLowerCase().endsWith('.kif') ? 'shift_jis' : 'utf-8'
    return new TextDecoder(encoding, { fatal: true }).decode(buffer).replace(/^\uFEFF/, '')
}

export function parseKif(text) {
    if (/^手合割[：:]\s*(?!平手\s*$).+/m.test(text)) throw new Error('平手以外の手合割には対応していません')
    if (/^[上下]手の持駒[：:]|^\s*\+[-+]+\+/m.test(text)) throw new Error('任意局面・盤面図付き棋譜には対応していません')
    const position = createStandardPosition()
    const moves = []
    let previousTo = null
    for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
        const match = line.match(/^\s*(\d+)\s+(.+?)(?:\s+\([^)]*:[^)]*\))?\s*$/)
        if (!match) continue
        const token = match[2].trim()
        if (/^(投了|中断|千日手|持将棋|詰み|切れ負け|反則)/.test(token)) break
        try {
            const move = parseMoveToken(token, position, previousTo)
            applyMove(position, move)
            moves.push(move)
            previousTo = move.to
        } catch (error) {
            throw new Error(`${lineIndex + 1}行目: ${error.message}`)
        }
    }
    if (!moves.length) throw new Error('指し手が見つかりません')
    return moves
}

function parseMoveToken(token, position, previousTo) {
    const ownerMark = token.match(/^[▲△]/)?.[0]
    if (ownerMark) token = token.slice(1)
    const owner = ownerMark ? (ownerMark === '▲' ? 'sente' : 'gote') : position.sideToMove
    let to
    if (token.startsWith('同')) {
        if (!previousTo) throw new Error('「同」の移動先がありません')
        to = { ...previousTo }; token = token.replace(/^同[　 ]*/, '')
    } else {
        const d = token.match(/^([１-９1-9])([一二三四五六七八九])/)
        if (!d) throw new Error('移動先を解釈できません')
        const file = NUM[d[1]] ?? Number(d[1]); to = { row: KANJI.indexOf(d[2]) - 1, col: 9 - file }; token = token.slice(d[0].length)
    }
    const p = token.match(/^(成香|成桂|成銀|歩|香|桂|銀|金|角|飛|玉|王|と|杏|圭|全|馬|龍|竜)/)
    if (!p) throw new Error('駒名を解釈できません')
    const shownName = p[1]; const type = TYPES[shownName]; token = token.slice(shownName.length)
    const promotes = token.includes('成') && !token.includes('不成') && !['成香','成桂','成銀'].includes(shownName)
    const drop = token.includes('打')
    const fromMatch = token.match(/\(([1-9])([1-9])\)/)
    const from = fromMatch ? { row: Number(fromMatch[2]) - 1, col: 9 - Number(fromMatch[1]) } : null
    if (!drop && !from) throw new Error('移動元座標が必要です')
    return { owner, type, from, to, drop, promotes, pieceWasPromoted: Object.hasOwn(PROMOTED, type) && [shownName].some(n => Object.values(PROMOTED).includes(n)) }
}

export function validateMoves(moves) {
    const position = createStandardPosition()
    for (let i = 0; i < moves.length; i++) {
        try { applyMove(position, moves[i]) } catch (error) { return { valid: false, index: i, message: error.message } }
    }
    return { valid: true, position }
}

export function applyMove(position, move) {
    if (move.owner !== position.sideToMove) throw new Error('手番が一致しません')
    const { board, capturedPieces } = position
    if (board[move.to.row]?.[move.to.col]?.owner === move.owner) throw new Error('自分の駒があるマスには移動できません')
    if (move.drop) {
        if (board[move.to.row][move.to.col]) throw new Error('駒を空いていないマスへ打っています')
        if (!(capturedPieces[move.owner][move.type] > 0)) throw new Error('持っていない駒を打っています')
        if (isDeadEnd(move.type, move.owner, move.to.row)) throw new Error('行き場のない駒です')
        if (move.type === 'FU' && board.some(row => row[move.to.col]?.owner === move.owner && row[move.to.col]?.type === 'FU' && !row[move.to.col]?.promoted)) throw new Error('二歩です')
        board[move.to.row][move.to.col] = piece(move.type, move.owner)
        if (--capturedPieces[move.owner][move.type] === 0) delete capturedPieces[move.owner][move.type]
    } else {
        const moving = board[move.from.row]?.[move.from.col]
        if (!moving || moving.owner !== move.owner || moving.type !== move.type) throw new Error('移動元の駒が一致しません')
        if (Boolean(move.pieceWasPromoted) !== Boolean(moving.promoted)) throw new Error('駒の成り状態が一致しません')
        if (!canReach(board, moving, move.from, move.to)) throw new Error('駒の動きに反しています')
        if (move.promotes && (moving.promoted || !canPromoteAt(moving, move.from.row, move.to.row))) throw new Error('成れない手です')
        const captured = board[move.to.row][move.to.col]
        if (captured?.type === 'OU') throw new Error('玉を取る手は指せません')
        if (captured) capturedPieces[move.owner][captured.type] = (capturedPieces[move.owner][captured.type] ?? 0) + 1
        board[move.to.row][move.to.col] = { ...moving, promoted: moving.promoted || move.promotes }
        board[move.from.row][move.from.col] = null
        if (!board[move.to.row][move.to.col].promoted && isDeadEnd(move.type, move.owner, move.to.row)) throw new Error('行き場のない駒です')
    }
    if (isKingInCheck(board, move.owner)) throw new Error('王手を放置しています')
    position.sideToMove = move.owner === 'sente' ? 'gote' : 'sente'
    return position
}

function canReach(board, p, from, to) {
    const dir = p.owner === 'sente' ? -1 : 1, dr = to.row-from.row, dc = to.col-from.col
    const gold = [[dir,-1],[dir,0],[dir,1],[0,-1],[0,1],[-dir,0]]
    const silver = [[dir,-1],[dir,0],[dir,1],[-dir,-1],[-dir,1]]
    let steps = p.promoted && ['FU','KY','KE','GI'].includes(p.type) ? gold : p.type==='FU'?[[dir,0]]:p.type==='KE'?[[2*dir,-1],[2*dir,1]]:p.type==='GI'?silver:p.type==='KI'?gold:p.type==='OU'?[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]:[]
    if (steps.some(([r,c]) => r===dr && c===dc)) return true
    const diagonal = p.type==='KA' && Math.abs(dr)===Math.abs(dc), straight = (p.type==='HI' || p.type==='KY' && dc===0 && Math.sign(dr)===dir) && (dr===0 || dc===0)
    if (diagonal || straight) return clearPath(board, from, to)
    return p.promoted && ((p.type==='KA' && Math.abs(dr)+Math.abs(dc)===1) || (p.type==='HI' && Math.abs(dr)===1 && Math.abs(dc)===1))
}
function clearPath(board, from, to) { const sr=Math.sign(to.row-from.row), sc=Math.sign(to.col-from.col); let r=from.row+sr,c=from.col+sc; while(r!==to.row||c!==to.col){if(board[r][c])return false;r+=sr;c+=sc} return true }
function canPromoteAt(p, a, b) { if (!['FU','KY','KE','GI','KA','HI'].includes(p.type)) return false; return p.owner==='sente' ? a<=2||b<=2 : a>=6||b>=6 }
function isDeadEnd(type, owner, row) { return (type==='FU'||type==='KY') ? row===(owner==='sente'?0:8) : type==='KE' && (owner==='sente'?row<=1:row>=7) }
function isKingInCheck(board, owner) { let king; for(let r=0;r<9;r++)for(let c=0;c<9;c++)if(board[r][c]?.type==='OU'&&board[r][c].owner===owner)king={row:r,col:c}; if(!king)return true; for(let r=0;r<9;r++)for(let c=0;c<9;c++){const p=board[r][c];if(p&&p.owner!==owner&&canReach(board,p,{row:r,col:c},king))return true} return false }

export function formatMove(move, previousTo = null, includeOrigin = false) {
    const same = previousTo && previousTo.row === move.to.row && previousTo.col === move.to.col
    const destination = same ? '同　' : `${FULL[9-move.to.col]}${KANJI[move.to.row+1]}`
    const name = move.pieceWasPromoted ? PROMOTED[move.type] : NAMES[move.type]
    const suffix = move.drop ? '打' : move.promotes ? '成' : ''
    const origin = includeOrigin && move.from ? `(${9-move.from.col}${move.from.row+1})` : ''
    return `${destination}${name}${suffix}${origin}`
}

export function exportKifu(moves) {
    const result = validateMoves(moves)
    if (!result.valid) throw new Error(`${result.index + 1}手目: ${result.message}`)
    const lines = ['# KIF version=2.0 encoding=UTF-8', '手合割：平手', '手数----指手---------']
    let previousTo = null
    moves.forEach((move, index) => { lines.push(`${String(index+1).padStart(4)} ${formatMove(move, previousTo, true)}`); previousTo=move.to })
    return `${lines.join('\n')}\n`
}
