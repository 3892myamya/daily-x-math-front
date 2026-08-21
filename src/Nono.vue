<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const sizes = [5, 10, 15]
const boardHeight = ref(10)
const boardWidth = ref(10)
const customSizeOpen = ref(false)
const customHeight = ref(10)
const customWidth = ref(10)
const exportOpen = ref(false)
const exportUrlCopied = ref(false)
const appUrlCopied = ref(false)
const importOpen = ref(false)
const manualOpen = ref(false)
const importUrlText = ref('')
const importError = ref('')
const restorationNotice = ref(null)
const clearMessageVisible = ref(false)
const creationMethod = ref('board')
const inputMethod = ref('auto')
const manualRowClueTexts = ref(Array(boardHeight.value).fill(''))
const manualColumnClueTexts = ref(Array(boardWidth.value).fill(''))
const cells = ref(makeBoard(boardHeight.value, boardWidth.value))
const marks = ref(makeBoard(boardHeight.value, boardWidth.value))
const mode = ref('edit')
const solution = ref(makeBoard(boardHeight.value, boardWidth.value))
const puzzleRows = ref([])
const puzzleColumns = ref([])
const history = ref([])
const future = ref([])
const playClueMarks = ref({ rows: [], columns: [] })
const teacherSteps = ref([])
const teacherFocusSteps = ref([])
const teacherStepMeta = ref([])
const teacherStepIndex = ref(0)
const teacherMessages = ref([])
const teacherBaseMessages = ref([])
const stepListRef = ref(null)
const isPainting = ref(false)
const dragAction = ref('fill')
const pointerFocusRow = ref(null)
const pointerFocusColumn = ref(null)
const playHintMessage = ref('困ったら聞いてくださいね。')
const playHintFocus = ref({ rows: [], columns: [], cells: [] })
const visited = new Set()
const rowClueInputRefs = []
const teacherVariationIndexes = new Map()
let teacherAnalysisRequest = 0
let teacherAnalysisComplete = false
let teacherPuzzleKey = ''
let playPuzzleKey = ''
let playSession
let teacherStepHoldTimer
let teacherStepDidRepeat = false
let restorationNoticeTimer
let contextMenuResetTimer
let suppressBoardContextMenu = false
let clueRestoredState
let clueRestorationUntouched = false
let clueUniqueCheckPassed = false
let boardCreationReturnState
let clearMessagePuzzleKey = ''
let clearMessageShown = false
const isTeacherMode = computed(() => mode.value === 'teacher')
const showsPointerFocus = computed(
  () => mode.value === 'play' || (mode.value === 'edit' && creationMethod.value === 'board'),
)

function makeBoard(height, width = height) {
  return Array.from({ length: height }, () => Array(width).fill(false))
}

function snapshot() {
  return {
    cells: cells.value.map((row) => [...row]),
    marks: marks.value.map((row) => [...row]),
    clueMarks: {
      rows: playClueMarks.value.rows.map((line) => [...line]),
      columns: playClueMarks.value.columns.map((line) => [...line]),
    },
  }
}

function restore(state) {
  cells.value = state.cells.map((row) => [...row])
  marks.value = state.marks.map((row) => [...row])
  if (state.clueMarks) {
    playClueMarks.value = {
      rows: state.clueMarks.rows.map((line) => [...line]),
      columns: state.clueMarks.columns.map((line) => [...line]),
    }
  }
}

function commit() {
  history.value.push(snapshot())
  if (history.value.length > 60) history.value.shift()
  future.value = []
}

function forgetClueRestoration() {
  clueRestoredState = undefined
  clueRestorationUntouched = false
  clueUniqueCheckPassed = false
  boardCreationReturnState = undefined
}

function clearClueBoard() {
  cells.value = makeBoard(boardHeight.value, boardWidth.value)
  marks.value = makeBoard(boardHeight.value, boardWidth.value)
  solution.value = makeBoard(boardHeight.value, boardWidth.value)
  history.value = []
  future.value = []
}

function resizedBoard(board, height, width) {
  return Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, col) => board[row]?.[col] ?? false),
  )
}

function resizeBoard(height, width, { preserve = true } = {}) {
  const previousCells = cells.value
  const previousMarks = marks.value
  const previousRowTexts = manualRowClueTexts.value
  const previousColumnTexts = manualColumnClueTexts.value
  forgetClueRestoration()
  boardHeight.value = height
  boardWidth.value = width
  if (preserve && creationMethod.value === 'board') {
    cells.value = resizedBoard(previousCells, height, width)
    marks.value = resizedBoard(previousMarks, height, width)
    solution.value = cells.value.map((row) => [...row])
    puzzleRows.value = cells.value.map(clues)
    puzzleColumns.value = Array.from({ length: width }, (_, col) =>
      clues(cells.value.map((row) => row[col])),
    )
    manualRowClueTexts.value = puzzleRows.value.map((line) => formatClueText(line, ' '))
    manualColumnClueTexts.value = puzzleColumns.value.map((line) => formatClueText(line, '\n'))
  } else {
    cells.value = makeBoard(height, width)
    marks.value = makeBoard(height, width)
    solution.value = makeBoard(height, width)
    manualRowClueTexts.value = preserve
      ? Array.from({ length: height }, (_, row) => previousRowTexts[row] ?? '')
      : Array(height).fill('')
    manualColumnClueTexts.value = preserve
      ? Array.from({ length: width }, (_, col) => previousColumnTexts[col] ?? '')
      : Array(width).fill('')
    puzzleRows.value = manualRowClueTexts.value.map((text) => parseDelimitedClueText(text, ' ', width).clues)
    puzzleColumns.value = manualColumnClueTexts.value.map((text) => parseDelimitedClueText(text, '\n', height).clues)
  }
  history.value = []
  future.value = []
}

function selectSize(nextSize) {
  if (nextSize === boardHeight.value && nextSize === boardWidth.value) return
  resizeBoard(nextSize, nextSize)
}

function openCustomSize() {
  customHeight.value = boardHeight.value
  customWidth.value = boardWidth.value
  customSizeOpen.value = true
}

function applyCustomSize() {
  const requestedHeight = Number(customHeight.value)
  const requestedWidth = Number(customWidth.value)
  if (!Number.isFinite(requestedHeight) || !Number.isFinite(requestedWidth)) return
  const height = Math.min(30, Math.max(5, Math.trunc(requestedHeight)))
  const width = Math.min(30, Math.max(5, Math.trunc(requestedWidth)))
  customHeight.value = height
  customWidth.value = width
  resizeBoard(height, width)
  customSizeOpen.value = false
}

function formatClueText(lineClues, separator) {
  return lineClues.length === 1 && lineClues[0] === 0 ? '' : lineClues.join(separator)
}

function selectCreationMethod(nextMethod) {
  if (nextMethod === creationMethod.value) return
  if (nextMethod === 'clues') {
    const boardStateBeforeSwitch = snapshot()
    const boardRowClues = currentRowClues.value.map((line) => [...line])
    const boardColumnClues = currentColumnClues.value.map((line) => [...line])
    manualRowClueTexts.value = boardRowClues.map((line) => formatClueText(line, ' '))
    manualColumnClueTexts.value = boardColumnClues.map((line) => formatClueText(line, '\n'))
    puzzleRows.value = boardRowClues
    puzzleColumns.value = boardColumnClues
    if (clueRestoredState && clueRestorationUntouched) {
      restore(clueRestoredState)
      solution.value = clueRestoredState.cells.map((row) => [...row])
    } else {
      clearClueBoard()
    }
    boardCreationReturnState = cloneState(boardStateBeforeSwitch)
  } else {
    if (boardCreationReturnState) {
      restore(boardCreationReturnState)
      solution.value = boardCreationReturnState.cells.map((row) => [...row])
      boardCreationReturnState = undefined
      creationMethod.value = nextMethod
      history.value = []
      future.value = []
      return
    }
    if (!clueUniqueCheckPassed) {
      if (hasInput.value || hasManualClueInput.value) {
        const confirmed = window.confirm(
          '唯一解チェックが未完了で盤面入力へ切り替えた場合、ヒントと盤面がすべてリセットされます。続行しますか？',
        )
        if (!confirmed) return
      }
      manualRowClueTexts.value = Array(boardHeight.value).fill('')
      manualColumnClueTexts.value = Array(boardWidth.value).fill('')
      puzzleRows.value = Array.from({ length: boardHeight.value }, () => [0])
      puzzleColumns.value = Array.from({ length: boardWidth.value }, () => [0])
      clearClueBoard()
      forgetClueRestoration()
    }
    solution.value = cells.value.map((row) => [...row])
    cells.value = solution.value.map((row) => [...row])
    marks.value = makeBoard(boardHeight.value, boardWidth.value)
    clueUniqueCheckPassed = false
  }
  creationMethod.value = nextMethod
  history.value = []
  future.value = []
}

function selectInputMethod(nextMethod) {
  inputMethod.value = nextMethod
}

function currentPuzzleKey() {
  return JSON.stringify({
    height: boardHeight.value,
    width: boardWidth.value,
    rows: puzzleRows.value,
    columns: puzzleColumns.value,
  })
}

function savePlaySession() {
  playPuzzleKey = currentPuzzleKey()
  playSession = {
    state: snapshot(),
    history: history.value.map(cloneState),
    future: future.value.map(cloneState),
    clueMarks: {
      rows: playClueMarks.value.rows.map((line) => [...line]),
      columns: playClueMarks.value.columns.map((line) => [...line]),
    },
    hintMessage: playHintMessage.value,
    hintFocus: {
      rows: [...playHintFocus.value.rows],
      columns: [...playHintFocus.value.columns],
      cells: [...playHintFocus.value.cells],
    },
  }
}

function emptyPlayClueMarks() {
  return {
    rows: puzzleRows.value.map((line) => line.map(() => false)),
    columns: puzzleColumns.value.map((line) => line.map(() => false)),
  }
}

function togglePlayClueMark(type, lineIndex, clueIndex, number, event) {
  if (mode.value !== 'play' || number === 0) return
  event.preventDefault()
  commit()
  playClueMarks.value[type][lineIndex][clueIndex] =
    !playClueMarks.value[type][lineIndex][clueIndex]
}

function changeMode(nextMode) {
  if (nextMode === mode.value) return
  if (mode.value === 'edit' && creationMethod.value === 'clues' && hasInvalidManualClues.value) return
  if (mode.value === 'play') savePlaySession()
  if (mode.value === 'edit') {
    if (creationMethod.value === 'board') {
      solution.value = cells.value.map((row) => [...row])
      puzzleRows.value = cells.value.map(clues)
      puzzleColumns.value = Array.from({ length: boardWidth.value }, (_, col) =>
        clues(cells.value.map((row) => row[col])),
      )
    } else {
      puzzleRows.value = manualRowClues.value.map((line) => [...line])
      puzzleColumns.value = manualColumnClues.value.map((line) => [...line])
    }
  }
  const puzzleKey = currentPuzzleKey()
  const analysisRequest = ++teacherAnalysisRequest
  mode.value = nextMode

  if (nextMode === 'edit') {
    if (creationMethod.value === 'board') {
      cells.value = solution.value.map((row) => [...row])
      marks.value = makeBoard(boardHeight.value, boardWidth.value)
    } else if (clueRestoredState && clueRestorationUntouched) {
      restore(clueRestoredState)
    } else {
      cells.value = makeBoard(boardHeight.value, boardWidth.value)
      marks.value = makeBoard(boardHeight.value, boardWidth.value)
    }
    history.value = []
    future.value = []
    return
  }

  if (nextMode === 'play') {
    if (playSession && playPuzzleKey === puzzleKey) {
      restore(playSession.state)
      history.value = playSession.history.map(cloneState)
      future.value = playSession.future.map(cloneState)
      playClueMarks.value = playSession.clueMarks
        ? {
            rows: playSession.clueMarks.rows.map((line) => [...line]),
            columns: playSession.clueMarks.columns.map((line) => [...line]),
          }
        : emptyPlayClueMarks()
      playHintMessage.value = playSession.hintMessage ?? '困ったら聞いてくださいね。'
      playHintFocus.value = playSession.hintFocus
        ? {
            rows: [...playSession.hintFocus.rows],
            columns: [...playSession.hintFocus.columns],
            cells: [...playSession.hintFocus.cells],
          }
        : { rows: [], columns: [], cells: [] }
    } else {
      cells.value = makeBoard(boardHeight.value, boardWidth.value)
      marks.value = makeBoard(boardHeight.value, boardWidth.value)
      history.value = []
      future.value = []
      playClueMarks.value = emptyPlayClueMarks()
      clearPlayHint()
    }
    return
  }

  history.value = []
  future.value = []
  if (teacherAnalysisComplete && teacherPuzzleKey === puzzleKey && teacherSteps.value.length) {
    restore(teacherSteps.value[teacherStepIndex.value])
    return
  }

  if (nextMode === 'teacher') {
    cells.value = makeBoard(boardHeight.value, boardWidth.value)
    marks.value = makeBoard(boardHeight.value, boardWidth.value)
    teacherPuzzleKey = puzzleKey
    teacherAnalysisComplete = false
    teacherStepIndex.value = 0
    const initialState = snapshot()
    teacherSteps.value = [initialState]
    teacherFocusSteps.value = [{ rows: [], columns: [], cells: [] }]
    teacherStepMeta.value = [{ stepNumber: 0, phase: 'start' }]
    teacherMessages.value = ['問題を分析中です。少々お待ちください…']
    teacherBaseMessages.value = ['問題を分析中です。少々お待ちください…']
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (mode.value !== 'teacher' || analysisRequest !== teacherAnalysisRequest) return
        buildTeacherSteps()
        teacherAnalysisComplete = true
      }, 0)
    })
  }
}

function startPaint(row, col, event) {
  if (isTeacherMode.value || (mode.value === 'edit' && creationMethod.value === 'clues')) return
  if (event.button !== 0 && event.button !== 2) return
  event.preventDefault()
  if (mode.value === 'play') clearPlayHint()
  if (event.button === 2) {
    suppressBoardContextMenu = true
    if (contextMenuResetTimer !== undefined) window.clearTimeout(contextMenuResetTimer)
  }
  if (mode.value === 'edit' && creationMethod.value === 'board') {
    clueRestorationUntouched = false
  }
  commit()
  isPainting.value = true
  visited.clear()
  const paintMethod = inputMethod.value === 'auto'
    ? event.button === 0 ? 'black' : 'white'
    : inputMethod.value
  if (paintMethod === 'black') {
    // 左: 白・×は黒に、黒は白にする。
    dragAction.value = cells.value[row][col] ? 'erase' : 'fill'
  } else {
    // 右: 白・黒は×に、×は白にする。
    dragAction.value = marks.value[row][col] ? 'erase' : 'mark'
  }
  paint(row, col)
}

function paint(row, col) {
  if (!isPainting.value) return
  const key = `${row}:${col}`
  if (visited.has(key)) return
  visited.add(key)
  if (dragAction.value === 'fill') {
    cells.value[row][col] = true
    marks.value[row][col] = false
  } else if (dragAction.value === 'mark') {
    cells.value[row][col] = false
    marks.value[row][col] = true
  } else {
    cells.value[row][col] = false
    marks.value[row][col] = false
  }
}

function paintFromPointerMove(event) {
  if (!isPainting.value || event.pointerType === 'mouse') return
  event.preventDefault()

  const grid = event.currentTarget
  const pointerEvents = [...(event.getCoalescedEvents?.() ?? []), event]
  pointerEvents.forEach(({ clientX, clientY }) => {
    const cell = document.elementFromPoint(clientX, clientY)?.closest('.cell')
    if (!cell || !grid.contains(cell)) return
    paint(Number(cell.dataset.row), Number(cell.dataset.col))
  })
}

function enterCell(row, col, event) {
  paint(row, col)
  if (
    event.pointerType === 'mouse' &&
    showsPointerFocus.value
  ) {
    pointerFocusRow.value = row
    pointerFocusColumn.value = col
  }
}

function clearPointerFocus() {
  pointerFocusRow.value = null
  pointerFocusColumn.value = null
}

function stopPaint(event) {
  isPainting.value = false
  visited.clear()
  if (event?.type === 'blur') {
    suppressBoardContextMenu = false
    if (contextMenuResetTimer !== undefined) {
      window.clearTimeout(contextMenuResetTimer)
      contextMenuResetTimer = undefined
    }
  } else if (suppressBoardContextMenu) {
    if (contextMenuResetTimer !== undefined) window.clearTimeout(contextMenuResetTimer)
    contextMenuResetTimer = window.setTimeout(() => {
      suppressBoardContextMenu = false
      contextMenuResetTimer = undefined
    }, 750)
  }
}

function suppressPaintContextMenu(event) {
  if (!suppressBoardContextMenu) return
  event.preventDefault()
  event.stopPropagation()
  suppressBoardContextMenu = false
  if (contextMenuResetTimer !== undefined) {
    window.clearTimeout(contextMenuResetTimer)
    contextMenuResetTimer = undefined
  }
}

function undo() {
  if (!history.value.length) return
  future.value.push(snapshot())
  restore(history.value.pop())
}

function redo() {
  if (!future.value.length) return
  history.value.push(snapshot())
  restore(future.value.pop())
}

function clearBoard() {
  if (mode.value === 'edit' && creationMethod.value === 'clues') {
    const hasClueInput = manualRowClueTexts.value.some((text) => text.trim()) ||
      manualColumnClueTexts.value.some((text) => text.trim())
    if (!hasClueInput && !hasInput.value) return
    const confirmed = window.confirm('ヒントをリセットします。よろしいですか？')
    if (!confirmed) return
    manualRowClueTexts.value = Array(boardHeight.value).fill('')
    manualColumnClueTexts.value = Array(boardWidth.value).fill('')
    puzzleRows.value = Array.from({ length: boardHeight.value }, () => [0])
    puzzleColumns.value = Array.from({ length: boardWidth.value }, () => [0])
    clearClueBoard()
    forgetClueRestoration()
    return
  }
  if (mode.value === 'play') {
    if (!hasInput.value && !hasPlayClueMarks.value && !history.value.length && !future.value.length) return
    const confirmed = window.confirm(
      '解答をリセットします。よろしいですか？',
    )
    if (!confirmed) return
    cells.value = makeBoard(boardHeight.value, boardWidth.value)
    marks.value = makeBoard(boardHeight.value, boardWidth.value)
    playClueMarks.value = emptyPlayClueMarks()
    clearPlayHint()
    history.value = []
    future.value = []
    return
  }
  if (!hasInput.value) return
  if (mode.value === 'edit' && creationMethod.value === 'board') {
    const confirmed = window.confirm('盤面をリセット(全消し)します。よろしいですか？')
    if (!confirmed) return
    clueRestorationUntouched = false
  }
  commit()
  cells.value = makeBoard(boardHeight.value, boardWidth.value)
  marks.value = makeBoard(boardHeight.value, boardWidth.value)
}

function clues(line) {
  const result = []
  let run = 0
  for (const filled of line) {
    if (filled) run += 1
    else if (run) {
      result.push(run)
      run = 0
    }
  }
  if (run) result.push(run)
  return result.length ? result : [0]
}

const currentRowClues = computed(() => cells.value.map(clues))
const currentColumnClues = computed(() =>
  Array.from({ length: boardWidth.value }, (_, col) => clues(cells.value.map((row) => row[col]))),
)
function parseDelimitedClueText(text, separator, maxLength) {
  const normalized = text.trim()
  if (!normalized) return { clues: [0], valid: true }
  if (normalized === '0') return { clues: [0], valid: true }
  const tokens = normalized.split(separator)
  const numbers = tokens.map(Number)
  const validNumbers = tokens.every((token) => /^\d+$/.test(token)) &&
    numbers.every((number) => Number.isInteger(number) && number > 0)
  const requiredLength = numbers.reduce((total, number) => total + number, 0) + numbers.length - 1
  return {
    clues: validNumbers ? numbers : [0],
    valid: validNumbers && requiredLength <= maxLength,
  }
}

function parseRowClueText(text) {
  return parseDelimitedClueText(text, ' ', boardWidth.value)
}

function parseColumnClueText(text) {
  return parseDelimitedClueText(text, '\n', boardHeight.value)
}

function updateRowClueText(row, event) {
  const sanitized = event.target.value.replace(/[^\d ]/g, '')
  event.target.value = sanitized
  if (manualRowClueTexts.value[row] !== sanitized) {
    clearClueBoard()
    forgetClueRestoration()
  }
  manualRowClueTexts.value[row] = sanitized
  if (sanitized.startsWith(' ')) {
    const input = event.target
    nextTick(() => input.setSelectionRange(0, 0))
  }
}

function updateColumnClueText(col, event) {
  const sanitized = event.target.value.replace(/\r\n?/g, '\n').replace(/[^\d\n]/g, '')
  event.target.value = sanitized
  if (manualColumnClueTexts.value[col] !== sanitized) {
    clearClueBoard()
    forgetClueRestoration()
  }
  manualColumnClueTexts.value[col] = sanitized
}

function normalizeRowClueText(row, event) {
  const normalized = manualRowClueTexts.value[row].trim().replace(/ +/g, ' ')
  manualRowClueTexts.value[row] = normalized
  event.target.value = normalized
}

function normalizeColumnClueText(col, event) {
  const normalized = manualColumnClueTexts.value[col].trim().replace(/\n+/g, '\n')
  manualColumnClueTexts.value[col] = normalized
  event.target.value = normalized
}

function setRowClueInputRef(element, row) {
  if (element) rowClueInputRefs[row] = element
}

function focusNextRowClue(row) {
  rowClueInputRefs[row + 1]?.focus()
}

const parsedManualRows = computed(() => manualRowClueTexts.value.map(parseRowClueText))
const parsedManualColumns = computed(() => manualColumnClueTexts.value.map(parseColumnClueText))
const manualRowClues = computed(() => parsedManualRows.value.map(({ clues: line }) => line))
const manualColumnClues = computed(() => parsedManualColumns.value.map(({ clues: line }) => line))
const hasInvalidManualClues = computed(
  () =>
    parsedManualRows.value.some(({ valid }) => !valid) ||
    parsedManualColumns.value.some(({ valid }) => !valid),
)
const rowClues = computed(() =>
  mode.value === 'edit'
    ? creationMethod.value === 'board'
      ? currentRowClues.value
      : manualRowClues.value
    : puzzleRows.value,
)
const columnClues = computed(() =>
  mode.value === 'edit'
    ? creationMethod.value === 'board'
      ? currentColumnClues.value
      : manualColumnClues.value
    : puzzleColumns.value,
)
const filledCount = computed(() => cells.value.flat().filter(Boolean).length)
const hasInput = computed(() => filledCount.value > 0 || marks.value.flat().some(Boolean))
const hasManualClueInput = computed(() =>
  manualRowClueTexts.value.some((text) => text.trim()) ||
  manualColumnClueTexts.value.some((text) => text.trim()),
)
const hasPlayClueMarks = computed(() =>
  playClueMarks.value.rows.some((line) => line.some(Boolean)) ||
  playClueMarks.value.columns.some((line) => line.some(Boolean)),
)
const canClearCurrentMode = computed(() =>
  mode.value === 'edit' && creationMethod.value === 'clues'
    ? hasManualClueInput.value || hasInput.value
    : mode.value === 'play'
      ? hasInput.value || hasPlayClueMarks.value || history.value.length > 0 || future.value.length > 0
      : hasInput.value,
)
function clueSlotsFor(length) {
  return ({ 5: 3, 10: 5, 15: 7 })[length] ?? Math.ceil(length / 2)
}
const boardStyle = computed(() => ({
  '--rows': boardHeight.value,
  '--cols': boardWidth.value,
  '--row-clues': clueSlotsFor(boardWidth.value),
  '--column-clues': clueSlotsFor(boardHeight.value),
}))
const isClear = computed(() => {
  if (
    mode.value !== 'play' ||
    !puzzleRows.value.flat().some((number) => number > 0) ||
    !puzzleColumns.value.flat().some((number) => number > 0)
  ) return false
  return (
    JSON.stringify(currentRowClues.value) === JSON.stringify(puzzleRows.value) &&
    JSON.stringify(currentColumnClues.value) === JSON.stringify(puzzleColumns.value)
  )
})

watch([() => currentPuzzleKey(), isClear], ([puzzleKey, cleared]) => {
  if (puzzleKey !== clearMessagePuzzleKey) {
    clearMessagePuzzleKey = puzzleKey
    clearMessageShown = false
    clearMessageVisible.value = false
  }
  if (!cleared) {
    clearMessageVisible.value = false
  } else if (!clearMessageShown) {
    clearMessageShown = true
    clearMessageVisible.value = true
  }
})

function lineCandidates(lineClues, knownFilled, knownEmpty) {
  const lineLength = knownFilled.length
  if (lineClues.length === 1 && lineClues[0] === 0) {
    const emptyLine = Array(lineLength).fill(false)
    return knownFilled.some(Boolean) ? [] : [emptyLine]
  }

  const candidates = []
  const line = Array(lineLength).fill(false)
  function placeBlock(blockIndex, minimumStart) {
    if (blockIndex === lineClues.length) {
      const valid = line.every(
        (filled, index) => (!knownFilled[index] || filled) && (!knownEmpty[index] || !filled),
      )
      if (valid) candidates.push([...line])
      return
    }

    const remainingLength = lineClues
      .slice(blockIndex)
      .reduce((total, block) => total + block, 0)
    const remainingGaps = lineClues.length - blockIndex - 1
    const latestStart = lineLength - remainingLength - remainingGaps
    const blockLength = lineClues[blockIndex]
    for (let start = minimumStart; start <= latestStart; start += 1) {
      for (let cell = start; cell < start + blockLength; cell += 1) line[cell] = true
      placeBlock(blockIndex + 1, start + blockLength + 1)
      for (let cell = start; cell < start + blockLength; cell += 1) line[cell] = false
    }
  }
  placeBlock(0, 0)
  return candidates
}

const rowCandidates = computed(() =>
  rowClues.value.map((lineClues, row) =>
    lineCandidates(lineClues, cells.value[row], marks.value[row]),
  ),
)
const columnCandidates = computed(() =>
  columnClues.value.map((lineClues, col) =>
    lineCandidates(
      lineClues,
      cells.value.map((row) => row[col]),
      marks.value.map((row) => row[col]),
    ),
  ),
)
const rowWays = computed(() => rowCandidates.value.map((candidates) => candidates.length))
const columnWays = computed(() => columnCandidates.value.map((candidates) => candidates.length))
const focusedRows = computed(
  () => new Set(isTeacherMode.value ? teacherFocusSteps.value[teacherStepIndex.value]?.rows ?? [] : []),
)
const focusedColumns = computed(
  () => new Set(isTeacherMode.value ? teacherFocusSteps.value[teacherStepIndex.value]?.columns ?? [] : []),
)
const focusedCells = computed(
  () => new Set(isTeacherMode.value ? teacherFocusSteps.value[teacherStepIndex.value]?.cells ?? [] : []),
)
const playHintRows = computed(
  () => new Set(mode.value === 'play' && !isClear.value ? playHintFocus.value.rows : []),
)
const playHintColumns = computed(
  () => new Set(mode.value === 'play' && !isClear.value ? playHintFocus.value.columns : []),
)
const playHintCells = computed(
  () => new Set(mode.value === 'play' && !isClear.value ? playHintFocus.value.cells : []),
)
const highlightFocusedLinesOnBoard = computed(
  () => isTeacherMode.value && teacherFocusSteps.value[teacherStepIndex.value]?.highlightLinesOnBoard !== false,
)
const teacherActionCount = computed(
  () => teacherStepMeta.value.filter(({ phase }) => phase === 'answer').length,
)

function candidatesForState(state) {
  const rows = puzzleRows.value.map((lineClues, row) =>
    lineCandidates(lineClues, state.cells[row], state.marks[row]),
  )
  const columns = puzzleColumns.value.map((lineClues, col) =>
    lineCandidates(
      lineClues,
      state.cells.map((row) => row[col]),
      state.marks.map((row) => row[col]),
    ),
  )
  return { rows, columns }
}

function distanceForCandidates(candidateSets) {
  const total = [...candidateSets.rows, ...candidateSets.columns].reduce(
    (sum, candidates) => sum + candidates.length,
    0,
  )
  return total - boardHeight.value - boardWidth.value
}

function stateIsComplete(state, distance) {
  return (
    distance === 0 &&
    state.cells.every((row, rowIndex) =>
      row.every((filled, colIndex) => filled || state.marks[rowIndex][colIndex]),
    )
  )
}

function deriveNextState(state, candidateSets) {
  const next = {
    cells: state.cells.map((row) => [...row]),
    marks: state.marks.map((row) => [...row]),
  }
  const determinedBlack = makeBoard(boardHeight.value, boardWidth.value)
  const determinedWhite = makeBoard(boardHeight.value, boardWidth.value)

  candidateSets.rows.forEach((candidates, row) => {
    if (!candidates.length) return
    for (let col = 0; col < boardWidth.value; col += 1) {
      if (candidates.every((candidate) => candidate[col])) determinedBlack[row][col] = true
      if (candidates.every((candidate) => !candidate[col])) determinedWhite[row][col] = true
    }
  })
  candidateSets.columns.forEach((candidates, col) => {
    if (!candidates.length) return
    for (let row = 0; row < boardHeight.value; row += 1) {
      if (candidates.every((candidate) => candidate[row])) determinedBlack[row][col] = true
      if (candidates.every((candidate) => !candidate[row])) determinedWhite[row][col] = true
    }
  })

  for (let row = 0; row < boardHeight.value; row += 1) {
    for (let col = 0; col < boardWidth.value; col += 1) {
      if (determinedBlack[row][col]) {
        next.cells[row][col] = true
        next.marks[row][col] = false
      } else if (determinedWhite[row][col]) {
        next.cells[row][col] = false
        next.marks[row][col] = true
      }
    }
  }
  return next
}

function lineDeterminations(candidates, knownFilled, knownEmpty) {
  const determinations = []
  if (!candidates.length) return determinations

  for (let index = 0; index < knownFilled.length; index += 1) {
    if (knownFilled[index] || knownEmpty[index]) continue
    if (candidates.every((candidate) => candidate[index])) {
      determinations.push({ index, filled: true })
    } else if (candidates.every((candidate) => !candidate[index])) {
      determinations.push({ index, filled: false })
    }
  }
  return determinations
}

function teacherMessageForRatio(ratio, focus) {
  const lineLabel = focus.rows.length ? '行' : '列'
  let key
  let messages
  if (ratio === 1) {
    key = 'ratio-100'
    messages = [`この${lineLabel}を見てください。`, `この${lineLabel}を片付けましょう。`]
  } else if (ratio >= 0.75) {
    key = 'ratio-75'
    messages = [
      `この${lineLabel}は手掛かりとして良さそうですね。`,
      `この${lineLabel}を進められるだけ進めましょう。`,
    ]
  } else if (ratio >= 0.5) {
    key = 'ratio-50'
    messages = [`この${lineLabel}が手掛かりになりそうです。`, `この${lineLabel}を調べてみましょう。`]
  } else if (ratio >= 0.25) {
    key = 'ratio-25'
    messages = [
      `この${lineLabel}はいくつか確定できそうです。`,
      `この${lineLabel}を少し進めてみましょう。`,
    ]
  } else {
    key = 'ratio-under-25'
    messages = [
      `そうですね…この${lineLabel}をよく見てください。`,
      `うーむ…この${lineLabel}あたりを調べましょうか？`,
    ]
  }
  return cyclicTeacherMessage(key, messages)
}

function playHintMessageForRatio(ratio, focus) {
  const lineLabel = focus.rows.length ? '行' : '列'
  if (ratio === 1) {
    return `この${lineLabel}は、残りのマスをすべて判断できそうです！じっくり見てみましょう。`
  }
  if (ratio >= 0.75) {
    return `この${lineLabel}には、確定できるマスが多くありそうです。ここから考えてみましょう。`
  }
  if (ratio >= 0.5) {
    return `この${lineLabel}を調べることで、盤面を大きく進められそうです。`
  }
  if (ratio >= 0.25) {
    return `この${lineLabel}には、いくつか確定できるマスがありそうです。探してみましょう。`
  }
  return `この${lineLabel}から少しだけ進められそうです。丁寧に確認してみましょう。`
}

function teacherAnswerMessage(ratio, focus) {
  const lineLabel = focus.rows.length ? '行' : '列'
  let key
  let messages
  if (ratio === 1) {
    key = 'answer-ratio-100'
    messages = [
      `この${lineLabel}はすべて確定できました！良かったです。`,
      `この${lineLabel}の残りのマスが全部決まりました！やりましたね。`,
    ]
  } else if (ratio >= 0.75) {
    key = 'answer-ratio-75'
    messages = [
      `この${lineLabel}がいい感じに決まってきました！この調子ですね。`,
      `この${lineLabel}が一気に進みました。いい感じですね。`,
    ]
  } else if (ratio >= 0.5) {
    key = 'answer-ratio-50'
    messages = [
      `この${lineLabel}はだいぶマスが確定してきましたね。`,
      `この${lineLabel}はまとまった数のマスが決まりましたね。`,
    ]
  } else if (ratio >= 0.25) {
    key = 'answer-ratio-25'
    messages = [
      `この${lineLabel}はここまでは決まりですね。`,
      `この${lineLabel}を少し進めることができましたね。`,
    ]
  } else {
    key = 'answer-ratio-under-25'
    messages = [
      `この${lineLabel}がちょっと埋まりました。焦らずに進みましょう。`,
      `少しだけこの${lineLabel}を進められました。地道に頑張りましょう。`,
    ]
  }
  return cyclicTeacherMessage(key, messages)
}

function appendTeacherEndStep(state, message) {
  const stepNumber = (teacherStepMeta.value.at(-1)?.stepNumber ?? 0) + 1
  teacherSteps.value.push(cloneState(state))
  teacherFocusSteps.value.push({ rows: [], columns: [], cells: [] })
  teacherStepMeta.value.push({ stepNumber, phase: 'end' })
  teacherMessages.value.push(message)
  teacherBaseMessages.value.push(message)
}
function cyclicTeacherMessage(key, messages) {
  const index = teacherVariationIndexes.get(key) ?? 0
  teacherVariationIndexes.set(key, index + 1)
  return messages[index % messages.length]
}

function teacherStepPrefix(stepNumber) {
  const prefixes = stepNumber === 1 ? ['まずは、'] : ['次に、', 'それから、', 'そして、']
  return cyclicTeacherMessage(stepNumber === 1 ? 'prefix-first' : 'prefix-next', prefixes)
}

function confirmedRatio(state) {
  const confirmed = state.cells.reduce(
    (total, row, rowIndex) =>
      total + row.filter((filled, colIndex) => filled || state.marks[rowIndex][colIndex]).length,
    0,
  )
  return confirmed / (boardHeight.value * boardWidth.value)
}

function incompleteLineCount(state) {
  const incompleteRows = state.cells.filter((row, rowIndex) =>
    row.some((filled, colIndex) => !filled && !state.marks[rowIndex][colIndex]),
  ).length
  const incompleteColumns = Array.from({ length: boardWidth.value }, (_, col) =>
    state.cells.some((row, rowIndex) => !row[col] && !state.marks[rowIndex][col]),
  ).filter(Boolean).length
  return incompleteRows + incompleteColumns
}

function teacherProgressMessage(previousRatio, nextRatio) {
  if (nextRatio >= 1) return undefined
  const milestones = [
    { ratio: 0.75, message: 'だいぶ埋まってきました。' },
    { ratio: 0.5, message: '半分ぐらいまで来ました。' },
    { ratio: 0.25, message: 'まだまだここからです。' },
  ]
  return milestones.find(
    ({ ratio }) => previousRatio < ratio && nextRatio >= ratio,
  )?.message
}

function teacherDifficultyMessage(attentionTotal) {
  const difficulty = attentionTotal / 10 + 0.5
  let comment
  if (difficulty <= 2.5) {
    comment = 'やさしい問題のようなので気楽にいきましょう。'
  } else if (difficulty <= 5) {
    comment = 'ほどよい難易度の問題のように見えます。'
  } else if (difficulty <= 10) {
    comment = 'それなりに歯ごたえがある問題のようですね。'
  } else {
    comment = '手ごわい問題のようですが、頑張りましょう。'
  }
  return `${comment}(推定難易度：★${difficulty.toFixed(1)})`
}

function changedCells(previous, next) {
  const changed = []
  for (let row = 0; row < boardHeight.value; row += 1) {
    for (let col = 0; col < boardWidth.value; col += 1) {
      if (
        previous.cells[row][col] !== next.cells[row][col] ||
        previous.marks[row][col] !== next.marks[row][col]
      ) {
        changed.push(`${row}:${col}`)
      }
    }
  }
  return changed
}

function teacherLinePriority({ type, line }) {
  return type === 'row' ? line : boardHeight.value + line
}

function deriveNextTeacherState(state, candidateSets) {
  const lines = []

  candidateSets.rows.forEach((candidates, row) => {
    const unresolved = state.cells[row].filter(
      (_, col) => !state.cells[row][col] && !state.marks[row][col],
    ).length
    const determinations = lineDeterminations(candidates, state.cells[row], state.marks[row])
    if (unresolved && determinations.length) {
      const ratio = determinations.length / unresolved
      lines.push({
        type: 'row',
        line: row,
        determinations,
        ratio,
        score: determinations.length * ratio,
      })
    }
  })

  candidateSets.columns.forEach((candidates, col) => {
    const knownFilled = state.cells.map((row) => row[col])
    const knownEmpty = state.marks.map((row) => row[col])
    const unresolved = knownFilled.filter((filled, row) => !filled && !knownEmpty[row]).length
    const determinations = lineDeterminations(candidates, knownFilled, knownEmpty)
    if (unresolved && determinations.length) {
      const ratio = determinations.length / unresolved
      lines.push({
        type: 'column',
        line: col,
        determinations,
        ratio,
        score: determinations.length * ratio,
      })
    }
  })

  if (!lines.length) return null
  const bestScore = Math.max(...lines.map(({ score }) => score))
  const selectedLine = lines
    .filter(({ score }) => Math.abs(score - bestScore) < Number.EPSILON)
    .sort((a, b) => teacherLinePriority(a) - teacherLinePriority(b))[0]
  const next = {
    cells: state.cells.map((row) => [...row]),
    marks: state.marks.map((row) => [...row]),
  }

  selectedLine.determinations.forEach(({ index, filled }) => {
    const row = selectedLine.type === 'row' ? selectedLine.line : index
    const col = selectedLine.type === 'row' ? index : selectedLine.line
    next.cells[row][col] = filled
    next.marks[row][col] = !filled
  })

  return {
    next,
    ratio: selectedLine.ratio,
    focus: {
      rows: selectedLine.type === 'row' ? [selectedLine.line] : [],
      columns: selectedLine.type === 'column' ? [selectedLine.line] : [],
      cells: changedCells(state, next),
    },
  }
}

function statesEqual(a, b) {
  return a.cells.every((row, rowIndex) =>
    row.every(
      (filled, colIndex) =>
        filled === b.cells[rowIndex][colIndex] &&
        a.marks[rowIndex][colIndex] === b.marks[rowIndex][colIndex],
    ),
  )
}

function cloneState(state) {
  const cloned = {
    cells: state.cells.map((row) => [...row]),
    marks: state.marks.map((row) => [...row]),
  }
  if (state.clueMarks) {
    cloned.clueMarks = {
      rows: state.clueMarks.rows.map((line) => [...line]),
      columns: state.clueMarks.columns.map((line) => [...line]),
    }
  }
  return cloned
}

function assignCell(state, row, col, filled) {
  const next = cloneState(state)
  next.cells[row][col] = filled
  next.marks[row][col] = !filled
  return next
}

function contradictionFocus(candidateSets) {
  return {
    rows: candidateSets.rows.flatMap((candidates, row) => (candidates.length ? [] : [row])),
    columns: candidateSets.columns.flatMap((candidates, col) => (candidates.length ? [] : [col])),
  }
}

function propagateState(state) {
  let current = cloneState(state)

  for (let step = 0; step <= boardHeight.value * boardWidth.value; step += 1) {
    const candidateSets = candidatesForState(current)
    const contradiction = contradictionFocus(candidateSets)
    if (contradiction.rows.length || contradiction.columns.length) {
      return { state: current, candidateSets, contradiction }
    }

    const next = deriveNextState(current, candidateSets)
    if (statesEqual(current, next)) {
      return { state: current, candidateSets, contradiction: null }
    }
    current = next
  }

  return {
    state: current,
    candidateSets: candidatesForState(current),
    contradiction: null,
  }
}

function prioritizedUnresolvedCells(state, candidateSets) {
  const unresolved = []
  for (let row = 0; row < boardHeight.value; row += 1) {
    for (let col = 0; col < boardWidth.value; col += 1) {
      if (state.cells[row][col] || state.marks[row][col]) continue
      unresolved.push({
        row,
        col,
        score: candidateSets.rows[row].length * candidateSets.columns[col].length,
      })
    }
  }
  return unresolved.sort((a, b) => a.score - b.score || a.row - b.row || a.col - b.col)
}

function testSingleAssumption(state) {
  const propagated = propagateState(state)
  if (propagated.contradiction) {
    return { viable: false, contradiction: propagated.contradiction }
  }
  return {
    viable: true,
    contradiction: null,
    state: propagated.state,
  }
}

function deriveAssumptionState(state, firstOnly = false) {
  const candidateSets = candidatesForState(state)
  const targets = prioritizedUnresolvedCells(state, candidateSets)
  const forced = []

  for (const target of targets) {
    const blackResult = testSingleAssumption(assignCell(state, target.row, target.col, true))
    const whiteResult = testSingleAssumption(assignCell(state, target.row, target.col, false))

    if (!blackResult.viable && !whiteResult.viable) {
      return { invalid: true }
    }
    if (blackResult.viable === whiteResult.viable) continue

    const filled = blackResult.viable
    const failedResult = filled ? whiteResult : blackResult
    forced.push({
      ...target,
      filled,
      triedFilled: !filled,
      contradiction: failedResult.contradiction ?? {
        rows: [target.row],
        columns: [target.col],
      },
    })
    if (firstOnly) break
  }

  if (!forced.length) return null
  let next = cloneState(state)
  forced.forEach(({ row, col, filled }) => {
    next = assignCell(next, row, col, filled)
  })

  return {
    next,
    ratio: 1,
    assumption: forced[0],
    focus: {
      rows: [...new Set(forced.map(({ row }) => row))],
      columns: [...new Set(forced.map(({ col }) => col))],
      cells: forced.map(({ row, col }) => `${row}:${col}`),
      assumptions: forced,
    },
  }
}

function clearPlayHint() {
  playHintMessage.value = '困ったら私がお手伝いします！いつでも聞いてくださいね。'
  playHintFocus.value = { rows: [], columns: [], cells: [] }
}

function requestPlayHint() {
  if (mode.value !== 'play' || isClear.value) return

  const current = snapshot()
  const candidateSets = candidatesForState(current)
  const invalidRow = candidateSets.rows.findIndex((candidates) => candidates.length === 0)
  if (invalidRow >= 0) {
    playHintFocus.value = { rows: [invalidRow], columns: [], cells: [] }
    playHintMessage.value = 'この行がヒントと合っていないようです。まずはここを見直しましょう。'
    return
  }

  const invalidColumn = candidateSets.columns.findIndex((candidates) => candidates.length === 0)
  if (invalidColumn >= 0) {
    playHintFocus.value = { rows: [], columns: [invalidColumn], cells: [] }
    playHintMessage.value = 'この列がヒントと合っていないようです。まずはここを見直しましょう。'
    return
  }

  const deterministic = deriveNextTeacherState(current, candidateSets)
  if (deterministic && !statesEqual(current, deterministic.next)) {
    playHintFocus.value = {
      rows: [...deterministic.focus.rows],
      columns: [...deterministic.focus.columns],
      cells: [],
    }
    playHintMessage.value = playHintMessageForRatio(deterministic.ratio, deterministic.focus)
    return
  }

  const assumption = deriveAssumptionState(current, true)
  if (assumption && !assumption.invalid && !statesEqual(current, assumption.next)) {
    const { row, col } = assumption.assumption
    playHintFocus.value = { rows: [], columns: [], cells: [`${row}:${col}`] }
    playHintMessage.value = '難しい状況ですね…このマスを仮定して、先を考えてはどうでしょう？'
    return
  }

  playHintFocus.value = { rows: [], columns: [], cells: [] }
  playHintMessage.value = '今の盤面では、私にはお力になれないようです…申し訳ありません。'
}

function showRestorationNotice(type, message) {
  restorationNotice.value = { type, message }
  if (restorationNoticeTimer !== undefined) window.clearTimeout(restorationNoticeTimer)
  restorationNoticeTimer = window.setTimeout(() => {
    restorationNotice.value = null
    restorationNoticeTimer = undefined
  }, 4200)
}

function restoreBoardFromClues() {
  const shouldApplySolvedBoard = creationMethod.value === 'clues'
  if (shouldApplySolvedBoard) clueUniqueCheckPassed = false
  if (shouldApplySolvedBoard && hasInvalidManualClues.value) {
    showRestorationNotice('error', '矛盾があります')
    return
  }

  puzzleRows.value = (shouldApplySolvedBoard ? manualRowClues.value : currentRowClues.value)
    .map((line) => [...line])
  puzzleColumns.value = (shouldApplySolvedBoard ? manualColumnClues.value : currentColumnClues.value)
    .map((line) => [...line])
  const previousState = snapshot()
  let current = {
    cells: makeBoard(boardHeight.value, boardWidth.value),
    marks: makeBoard(boardHeight.value, boardWidth.value),
  }
  let result = 'stuck'

  for (let step = 0; step <= boardHeight.value * boardWidth.value; step += 1) {
    const candidateSets = candidatesForState(current)
    const contradiction = contradictionFocus(candidateSets)
    if (contradiction.rows.length || contradiction.columns.length) {
      result = 'contradiction'
      break
    }

    const distance = distanceForCandidates(candidateSets)
    if (stateIsComplete(current, distance)) {
      result = 'complete'
      break
    }

    const deterministicNext = deriveNextState(current, candidateSets)
    if (!statesEqual(current, deterministicNext)) {
      current = deterministicNext
      continue
    }

    const assumption = deriveAssumptionState(current, false)
    if (assumption?.invalid) {
      result = 'contradiction'
      break
    }
    if (!assumption || statesEqual(current, assumption.next)) {
      result = 'stuck'
      break
    }
    current = assumption.next
  }

  if (shouldApplySolvedBoard) {
    history.value = [previousState]
    future.value = []
    restore(current)
    solution.value = current.cells.map((row) => [...row])
    clueRestoredState = cloneState(current)
    clueRestorationUntouched = true
  }

  if (result === 'complete') {
    if (shouldApplySolvedBoard) clueUniqueCheckPassed = true
    showRestorationNotice('success', 'この問題は唯一解です')
  } else if (result === 'contradiction') {
    showRestorationNotice('error', '矛盾があります')
  } else {
    showRestorationNotice('warning', '唯一解の確認ができませんでした')
  }
}

function teacherAssumptionQuestionMessage(assumption) {
  const triedColor = assumption.triedFilled ? '黒' : '白'
  return `…だいぶ困りましたが、ここのマスを黒または白と仮定して考えてみましょう。`
}

function teacherAssumptionAnswerMessage(assumption) {
  const triedColor = assumption.triedFilled ? '黒' : '白'
  const confirmedColor = assumption.filled ? '黒' : '白'
  return `${triedColor}とすると途中で破綻するようです。したがってこのマスは${confirmedColor}ですね。`
}

function buildTeacherSteps() {
  let current = snapshot()
  let attentionTotal = 0
  let difficultyMessage
  teacherVariationIndexes.clear()
  teacherSteps.value = [current]
  teacherFocusSteps.value = [{ rows: [], columns: [], cells: [] }]
  teacherStepMeta.value = [{ stepNumber: 0, phase: 'start' }]
  teacherMessages.value = ['これからこの問題を一緒に解いていきましょう！']
  teacherBaseMessages.value = ['これからこの問題を一緒に解いていきましょう！']

  for (let stepNumber = 1; stepNumber <= boardHeight.value * boardWidth.value; stepNumber += 1) {
    const currentCandidates = candidatesForState(current)
    const contradiction = contradictionFocus(currentCandidates)
    let endMessage
    let result
    let isAssumption = false

    if (contradiction.rows.length || contradiction.columns.length) {
      endMessage = 'おっと！どうも問題に矛盾があるようです。問題の数字が正しいか見直してみてください。'
    } else {
      result = deriveNextTeacherState(current, currentCandidates)
      if (!result || statesEqual(current, result.next)) {
        result = deriveAssumptionState(current, true)
        isAssumption = Boolean(result && !result.invalid)
      }
      if (result?.invalid) {
        endMessage = 'うーむ…ちょっとおかしい気がします。念のため問題の数字が正しいか見直していただけないでしょうか？'
      } else if (!result || statesEqual(current, result.next)) {
        endMessage = '手詰まりになってしまいました。私には難しかったようです…申し訳ありません。'
      }
    }

    if (!endMessage) {
      if (isAssumption) result.focus.highlightLinesOnBoard = false

      const questionFocus = isAssumption
        ? {
            ...result.focus,
            cells: [`${result.assumption.row}:${result.assumption.col}`],
            highlightLinesOnBoard: false,
          }
        : {
            ...result.focus,
            cells: [],
          }
      const questionStepMessage = isAssumption
        ? teacherAssumptionQuestionMessage(result.assumption)
        : teacherMessageForRatio(result.ratio, result.focus)
      const questionMessage = `${teacherStepPrefix(stepNumber)}${questionStepMessage}`
      teacherSteps.value.push(cloneState(current))
      teacherFocusSteps.value.push(questionFocus)
      teacherStepMeta.value.push({ stepNumber, phase: 'question' })
      teacherMessages.value.push(questionMessage)
      teacherBaseMessages.value.push(questionMessage)

      teacherSteps.value.push(result.next)
      teacherFocusSteps.value.push(result.focus)
      teacherStepMeta.value.push({ stepNumber, phase: 'answer' })
      attentionTotal += isAssumption
        ? incompleteLineCount(current)
        : result.focus.rows.length + result.focus.columns.length
      const progressMessage = teacherProgressMessage(confirmedRatio(current), confirmedRatio(result.next))
      const answerMessage = isAssumption
        ? teacherAssumptionAnswerMessage(result.assumption)
        : teacherAnswerMessage(result.ratio, result.focus)
      teacherBaseMessages.value.push(answerMessage)
      teacherMessages.value.push(
        [answerMessage, progressMessage].filter(Boolean).join(' '),
      )
      current = result.next

      const nextCandidates = candidatesForState(current)
      const nextDistance = distanceForCandidates(nextCandidates)
      if (stateIsComplete(current, nextDistance)) {
        difficultyMessage = teacherDifficultyMessage(attentionTotal)
        endMessage = 'クリアできました！お疲れ様でした。'
      }
    }

    if (endMessage) {
      appendTeacherEndStep(current, endMessage)
      break
    }
  }

  if (difficultyMessage) {
    const startMessage = `これからこの問題を一緒に解いていきましょう！ ${difficultyMessage}`
    teacherMessages.value[0] = startMessage
    teacherBaseMessages.value[0] = startMessage
  } else {
    const startMessage = 'これからこの問題を一緒に解いていきましょう！ 何やら雲行きが怪しいですが、行けるところまで頑張りましょう。'
    teacherMessages.value[0] = startMessage
    teacherBaseMessages.value[0] = startMessage
  }

  teacherStepIndex.value = 0
  restore(teacherSteps.value[0])
}

function selectTeacherStep(index) {
  if (!isTeacherMode.value || !teacherSteps.value[index]) return
  restore(teacherSteps.value[index])
  teacherStepIndex.value = index
}

function moveTeacherStep(offset) {
  const nextIndex = teacherStepIndex.value + offset
  if (nextIndex < 0 || nextIndex >= teacherSteps.value.length) return
  selectTeacherStep(nextIndex)
  nextTick(() => {
    const list = stepListRef.value
    const selected = list?.querySelector('.active')
    if (!list || !selected) return
    const listBounds = list.getBoundingClientRect()
    const selectedBounds = selected.getBoundingClientRect()
    if (selectedBounds.top < listBounds.top) {
      list.scrollBy({ top: selectedBounds.top - listBounds.top, behavior: 'smooth' })
    } else if (selectedBounds.bottom > listBounds.bottom) {
      list.scrollBy({ top: selectedBounds.bottom - listBounds.bottom, behavior: 'smooth' })
    }
  })
}

function startTeacherStepHold(offset) {
  stopTeacherStepHold()
  teacherStepDidRepeat = false
  const repeat = () => {
    teacherStepDidRepeat = true
    moveTeacherStep(offset)
    teacherStepHoldTimer = window.setTimeout(repeat, 90)
  }
  teacherStepHoldTimer = window.setTimeout(repeat, 350)
}

function stopTeacherStepHold(event) {
  if (teacherStepHoldTimer !== undefined) {
    window.clearTimeout(teacherStepHoldTimer)
    teacherStepHoldTimer = undefined
  }
  if (event?.type !== 'pointerup') teacherStepDidRepeat = false
}

function activateTeacherStep(offset) {
  if (teacherStepDidRepeat) {
    teacherStepDidRepeat = false
    return
  }
  moveTeacherStep(offset)
}

function problemText() {
  return JSON.stringify(
    {
      ...(boardHeight.value === boardWidth.value ? { size: boardHeight.value } : {}),
      width: boardWidth.value,
      height: boardHeight.value,
      rows: rowClues.value,
      columns: columnClues.value,
    },
    null,
    2,
  )
}

function pzprNumber(number) {
  if (number >= 0 && number < 16) return number.toString(16)
  if (number < 256) return `-${number.toString(16)}`
  return `+${number.toString(16)}`
}

function encodePzprNumbers(numbers) {
  let blankCount = 0
  let encoded = ''
  numbers.forEach((number) => {
    const numberText = number < 0 ? '' : pzprNumber(number)
    if (!numberText) blankCount += 1
    if (blankCount === 0) {
      encoded += numberText
    } else if (numberText || blankCount === 20) {
      encoded += (15 + blankCount).toString(36) + numberText
      blankCount = 0
    }
  })
  if (blankCount) encoded += (15 + blankCount).toString(36)
  return encoded
}

function pzprClueSlots(lines, slotCount) {
  return lines.flatMap((line) => {
    const cluesNearBoardFirst = line.length === 1 && line[0] === 0 ? [] : [...line].reverse()
    return [...cluesNearBoardFirst, ...Array(slotCount - cluesNearBoardFirst.length).fill(-1)]
  })
}

function encodedProblem({ width, height, rows, columns }) {
  const columnSlots = pzprClueSlots(columns, Math.ceil(height / 2))
  const rowSlots = pzprClueSlots(rows, Math.ceil(width / 2))
  return encodePzprNumbers([...columnSlots, ...rowSlots])
}

const encodedPuzzle = computed(() => {
  return encodedProblem({
    width: boardWidth.value,
    height: boardHeight.value,
    rows: rowClues.value,
    columns: columnClues.value,
  })
})

const pzprxsUrl = computed(() => (
  `https://pzprxs.vercel.app/p?nonogram/${boardWidth.value}/${boardHeight.value}/${encodedPuzzle.value}`
))

function appBaseUrl() {
  const pathParts = window.location.pathname.split('/').filter(Boolean)
  const appIndex = pathParts.findIndex((part) => part === 'nono.html' || part === 'nono')
  const appPath = appIndex >= 0 ? `/${pathParts.slice(0, appIndex + 1).join('/')}` : ''
  return `${window.location.origin}${appPath}`
}

function appUrlForProblem(problem) {
  return `${appBaseUrl()}/${problem.width}/${problem.height}/${encodedProblem(problem)}`
}

const appPuzzleUrl = computed(() => {
  return `${appBaseUrl()}/${boardWidth.value}/${boardHeight.value}/${encodedPuzzle.value}`
})

function openExport() {
  exportUrlCopied.value = false
  appUrlCopied.value = false
  exportOpen.value = true
}

function openImport() {
  const hasPuzzleData = hasInput.value ||
    solution.value.flat().some(Boolean) ||
    hasManualClueInput.value ||
    puzzleRows.value.some((line) => line.some((number) => number > 0)) ||
    puzzleColumns.value.some((line) => line.some((number) => number > 0))
  if (hasPuzzleData) {
    const confirmed = window.confirm('現在の画面から移動し、インポートした問題を解答モードで開きます。続けますか？')
    if (!confirmed) return
  }
  importUrlText.value = ''
  importError.value = ''
  importOpen.value = true
}

function downloadProblem() {
  const blob = new Blob([problemText()], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `azarashi-pixel-puzzle-tool-${boardWidth.value}x${boardHeight.value}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function normalizeImportedClues(lines, lineCount, lineLength, label) {
  if (!Array.isArray(lines) || lines.length !== lineCount) {
    throw new Error(`${label}の本数が盤面サイズと一致しません。`)
  }
  return lines.map((line) => {
    if (!Array.isArray(line) || !line.length) throw new Error(`${label}の形式が正しくありません。`)
    const numbers = line.map(Number)
    if (!numbers.every(Number.isInteger)) throw new Error(`${label}には整数を指定してください。`)
    if (numbers.length === 1 && numbers[0] === 0) return [0]
    if (numbers.some((number) => number <= 0)) throw new Error(`${label}には正の整数を指定してください。`)
    const requiredLength = numbers.reduce((total, number) => total + number, 0) + numbers.length - 1
    if (requiredLength > lineLength) throw new Error(`${label}が盤面サイズに収まりません。`)
    return numbers
  })
}

function normalizeImportedProblem(data) {
  if (!data || typeof data !== 'object') throw new Error('問題データの形式が正しくありません。')
  const height = Number(data.height ?? data.size)
  const width = Number(data.width ?? data.size)
  if (!Number.isInteger(height) || !Number.isInteger(width) || height < 5 || height > 30 || width < 5 || width > 30) {
    throw new Error('高さ・幅は5～30の整数にしてください。')
  }
  return {
    height,
    width,
    rows: normalizeImportedClues(data.rows, height, width, '行'),
    columns: normalizeImportedClues(data.columns, width, height, '列'),
  }
}

function restoreImportedProblem(problem) {
  ++teacherAnalysisRequest
  resizeBoard(problem.height, problem.width, { preserve: false })
  puzzleRows.value = problem.rows.map((line) => [...line])
  puzzleColumns.value = problem.columns.map((line) => [...line])
  manualRowClueTexts.value = problem.rows.map((line) => formatClueText(line, ' '))
  manualColumnClueTexts.value = problem.columns.map((line) => formatClueText(line, '\n'))
  creationMethod.value = 'clues'
  mode.value = 'edit'
  playSession = undefined
  playPuzzleKey = ''
  teacherPuzzleKey = ''
  teacherAnalysisComplete = false
  teacherSteps.value = []
  teacherFocusSteps.value = []
  teacherStepMeta.value = []
  teacherMessages.value = []
  teacherBaseMessages.value = []
  teacherStepIndex.value = 0
  importOpen.value = false
  importError.value = ''
}

async function importJsonFile(event) {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    const data = JSON.parse(await file.text())
    window.location.assign(appUrlForProblem(normalizeImportedProblem(data)))
  } catch (error) {
    importError.value = error instanceof Error ? error.message : 'ファイルを読み込めませんでした。'
    event.target.value = ''
  }
}

function decodePzprNumbers(encoded, length) {
  const numbers = Array(length).fill(-1)
  let slot = 0
  let index = 0
  while (index < encoded.length && slot < length) {
    const character = encoded[index]
    if (/^[0-9a-f]$/.test(character)) {
      numbers[slot] = parseInt(character, 16)
      slot += 1
      index += 1
    } else if (character === '-' || character === '+') {
      const digitCount = character === '-' ? 2 : 3
      const digits = encoded.slice(index + 1, index + 1 + digitCount)
      if (!new RegExp(`^[0-9a-f]{${digitCount}}$`).test(digits)) throw new Error('URLの数字形式が正しくありません。')
      numbers[slot] = parseInt(digits, 16)
      slot += 1
      index += digitCount + 1
    } else if (character === '.') {
      numbers[slot] = -2
      slot += 1
      index += 1
    } else if (/^[g-z]$/.test(character)) {
      slot += parseInt(character, 36) - 15
      if (slot > length) throw new Error('URLのヒント数が盤面サイズを超えています。')
      index += 1
    } else {
      throw new Error('URLの圧縮データが正しくありません。')
    }
  }
  return numbers
}

function cluesFromPzprSlots(numbers, offset, lineCount, slotCount) {
  return Array.from({ length: lineCount }, (_, lineIndex) => {
    const start = offset + lineIndex * slotCount
    const nearBoardFirst = numbers.slice(start, start + slotCount).filter((number) => number >= 0)
    return nearBoardFirst.length ? nearBoardFirst.reverse() : [0]
  })
}

function problemFromPzprParts(parts) {
  if (parts[0] !== 'nonogram' || parts.length < 4) throw new Error('対応しているピクチャーパズルURLではありません。')
  const width = Number(parts[1])
  const height = Number(parts[2])
  if (!Number.isInteger(height) || !Number.isInteger(width) || height < 5 || height > 30 || width < 5 || width > 30) {
    throw new Error('高さ・幅が5～30のURLを入力してください。')
  }
  const columnSlotCount = Math.ceil(height / 2)
  const rowSlotCount = Math.ceil(width / 2)
  const columnSlotLength = width * columnSlotCount
  const totalSlotLength = columnSlotLength + height * rowSlotCount
  const numbers = decodePzprNumbers(parts[3], totalSlotLength)
  return normalizeImportedProblem({
    height,
    width,
    columns: cluesFromPzprSlots(numbers, 0, width, columnSlotCount),
    rows: cluesFromPzprSlots(numbers, columnSlotLength, height, rowSlotCount),
  })
}

function problemFromPzprxsUrl(text) {
  let url
  try {
    url = new URL(text.trim())
  } catch {
    throw new Error('ピクチャーパズルURLを入力してください。')
  }
  const supportedHosts = new Set([
    'pzprxs.vercel.app',
    'puzz.link',
    'pzplus.tck.mn',
  ])
  if (!supportedHosts.has(url.hostname)) {
    throw new Error('pzprxs、puzz.link、pzplusのURLを入力してください。')
  }
  return problemFromPzprParts(url.search.slice(1).split('/'))
}

function problemFromAppPath(pathname) {
  const pathParts = pathname.split('/').filter(Boolean)
  const appIndex = pathParts.findIndex((part) => part === 'nono.html' || part === 'nono')
  const puzzleParts = appIndex >= 0 ? pathParts.slice(appIndex + 1) : pathParts
  if (puzzleParts.length !== 3) return null
  const [width, height, encoded] = puzzleParts
  return problemFromPzprParts(['nonogram', width, height, decodeURIComponent(encoded)])
}

function restoreProblemFromAppPath() {
  try {
    const problem = problemFromAppPath(window.location.pathname)
    if (problem) {
      restoreImportedProblem(problem)
      changeMode('play')
    }
  } catch (error) {
    showRestorationNotice(
      'error',
      error instanceof Error ? error.message : 'URLから問題を読み込めませんでした。',
    )
  }
}

function importPzprxsUrl() {
  try {
    window.location.assign(appUrlForProblem(problemFromPzprxsUrl(importUrlText.value)))
  } catch (error) {
    importError.value = error instanceof Error ? error.message : 'URLを読み込めませんでした。'
  }
}

async function copyPzprxsUrl() {
  try {
    await navigator.clipboard.writeText(pzprxsUrl.value)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = pzprxsUrl.value
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
  exportUrlCopied.value = true
  window.setTimeout(() => (exportUrlCopied.value = false), 1800)
}

async function copyAppPuzzleUrl() {
  try {
    await navigator.clipboard.writeText(appPuzzleUrl.value)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = appPuzzleUrl.value
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
  appUrlCopied.value = true
  window.setTimeout(() => (appUrlCopied.value = false), 1800)
}

restoreProblemFromAppPath()

window.addEventListener('pointerup', stopPaint)
window.addEventListener('pointercancel', stopPaint)
window.addEventListener('blur', stopPaint)
window.addEventListener('contextmenu', suppressPaintContextMenu, true)
window.addEventListener('pointerup', stopTeacherStepHold)
window.addEventListener('pointercancel', stopTeacherStepHold)
window.addEventListener('blur', stopTeacherStepHold)
onBeforeUnmount(() => {
  window.removeEventListener('pointerup', stopPaint)
  window.removeEventListener('pointercancel', stopPaint)
  window.removeEventListener('blur', stopPaint)
  window.removeEventListener('contextmenu', suppressPaintContextMenu, true)
  window.removeEventListener('pointerup', stopTeacherStepHold)
  window.removeEventListener('pointercancel', stopTeacherStepHold)
  window.removeEventListener('blur', stopTeacherStepHold)
  stopTeacherStepHold()
  if (contextMenuResetTimer !== undefined) window.clearTimeout(contextMenuResetTimer)
  if (restorationNoticeTimer !== undefined) window.clearTimeout(restorationNoticeTimer)
})
</script>

<template>
  <main
    class="page"
    :class="{
      'painting-fill': isPainting && dragAction === 'fill',
      'painting-mark': isPainting && dragAction === 'mark',
      'painting-erase': isPainting && dragAction === 'erase',
    }"
  >
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span>AZARASHI<br /><b>PIXEL PUZZLE TOOL</b></span>
      </div>
      <div class="top-actions">
        <button class="export-button manual-button" aria-label="説明書を開く" @click="manualOpen = true">
          <span>説明書</span><b>?</b>
        </button>
        <button class="export-button import-button" aria-label="問題をインポート" @click="openImport">
          <span>インポート</span><b>↙</b>
        </button>
        <button class="export-button" aria-label="問題をエクスポート" @click="openExport">
          <span>エクスポート</span><b>↗</b>
        </button>
      </div>
    </header>

    <section class="workspace">
      <aside class="panel">
        <span class="label mode-label">モード</span>
        <div class="mode-switch panel-mode-switch" aria-label="モード切り替え">
          <button :class="{ active: mode === 'edit' }" @click="changeMode('edit')">作成</button>
          <button :class="{ active: mode === 'play' }" @click="changeMode('play')">解答</button>
          <button :class="{ active: mode === 'teacher' }" @click="changeMode('teacher')">解説</button>
        </div>
        <div class="panel-top-rule" aria-hidden="true"></div>

        <div v-if="mode === 'edit'" class="field-group">
          <span class="label">問題の作り方</span>
          <div class="creation-picker">
            <button :class="{ active: creationMethod === 'board' }" @click="selectCreationMethod('board')">
              盤面入力
            </button>
            <button :class="{ active: creationMethod === 'clues' }" @click="selectCreationMethod('clues')">
              ヒント入力
            </button>
          </div>
          <p v-if="creationMethod === 'clues'" class="clue-input-help">
            行は半角スペース区切り、列は改行区切りで入力
          </p>
          <p v-if="creationMethod === 'clues' && hasInvalidManualClues" class="clue-input-error">
            盤面サイズに収まる正の整数を入力してください。ヒントなしは空欄または0です。
          </p>
        </div>

        <div v-if="mode === 'edit'" class="field-group">
          <span class="label">盤面サイズ</span>
          <div class="size-picker">
            <button
              v-for="option in sizes"
              :key="option"
              :class="{ active: boardHeight === option && boardWidth === option }"
              :disabled="mode !== 'edit'"
              @click="selectSize(option)"
            >
              <b>{{ option }} × {{ option }}</b>
            </button>
            <button
              :class="{ active: !sizes.some((option) => boardHeight === option && boardWidth === option) }"
              @click="openCustomSize"
            >
              <b>カスタム</b>
            </button>
          </div>
        </div>

        <div v-if="!isTeacherMode && !(mode === 'edit' && creationMethod === 'clues')" class="field-group">
          <span class="label">入力方式</span>
          <div class="input-method-picker">
            <button
              :class="{ active: inputMethod === 'auto' }"
              :disabled="mode === 'edit' && creationMethod === 'clues'"
              @click="selectInputMethod('auto')"
            ><span class="input-method-icon auto-icon" aria-hidden="true"><i></i></span><span>自動</span></button>
            <button
              :class="{ active: inputMethod === 'black' }"
              :disabled="mode === 'edit' && creationMethod === 'clues'"
              @click="selectInputMethod('black')"
            ><span class="input-method-icon black-icon" aria-hidden="true"></span><span>黒マス</span></button>
            <button
              :class="{ active: inputMethod === 'white' }"
              :disabled="mode === 'edit' && creationMethod === 'clues'"
              @click="selectInputMethod('white')"
            ><span class="input-method-icon white-icon" aria-hidden="true"></span><span>白マス</span></button>
          </div>
        </div>

        <div v-if="mode === 'play'" class="field-group history-field">
          <span class="label">操作履歴</span>
          <div class="history-controls">
            <button :disabled="!history.length" @click="undo"><b>↶</b><span>戻る</span></button>
            <button :disabled="!future.length" @click="redo"><span>進む</span><b>↷</b></button>
          </div>
        </div>

        <div v-if="mode === 'play'" class="play-helper-field">
          <span class="label">お助けアザラシ</span>
          <div class="teacher-message play-helper-message">
            <img src="/azarashi.png" alt="アザラシ" />
            <div class="play-helper-content">
              <p>{{ isClear ? 'おめでとうございます！お見事です！' : playHintMessage }}</p>
              <button type="button" class="hint-button" :disabled="isClear" @click="requestPlayHint">ヒントをもらう</button>
            </div>
          </div>
        </div>

        <div v-if="mode === 'teacher'" class="teacher-message">
          <img src="/azarashi.png" alt="アザラシ" />
          <p>{{ teacherMessages[teacherStepIndex] }}</p>
        </div>

        <div v-if="isTeacherMode" class="teacher-log-section">
          <div class="step-history">
            <div class="step-history-title"><span>解き方の手順</span><b>{{ teacherActionCount }}手順</b></div>
            <div ref="stepListRef" class="step-list">
              <button
                v-for="(_, index) in teacherSteps"
                :key="index"
                :class="{ active: teacherStepIndex === index }"
                @click="selectTeacherStep(index)"
              >
                <i></i>
                <span v-if="teacherStepMeta[index]?.phase === 'start'">STEP 0 START</span>
                <span v-else>
                  STEP {{ teacherStepMeta[index]?.stepNumber }} {{ teacherStepMeta[index]?.phase.toUpperCase() }}
                </span>
                <b>{{ teacherStepIndex === index ? '表示中' : '↗' }}</b>
              </button>
            </div>
          </div>

          <div class="step-controls teacher-step-controls">
            <button
              :disabled="teacherStepIndex === 0"
              @pointerdown="startTeacherStepHold(-1)"
              @click="activateTeacherStep(-1)"
            >
              <b>←</b><span>前へ</span>
            </button>
            <button
              :disabled="teacherStepIndex === teacherSteps.length - 1"
              @pointerdown="startTeacherStepHold(1)"
              @click="activateTeacherStep(1)"
            >
              <span>次へ</span><b>→</b>
            </button>
          </div>
        </div>

        <button
          v-if="mode === 'edit'"
          class="restore-board-button"
          @click="restoreBoardFromClues"
        >唯一解チェック</button>

        <button v-if="!isTeacherMode" class="clear-button" :disabled="!canClearCurrentMode" @click="clearBoard">
          {{ mode === 'play' ? '解答をリセット' : creationMethod === 'clues' ? 'ヒントをリセット' : '盤面をリセット' }}
        </button>
      </aside>

      <div class="editor-area">
        <div class="board-wrap" :style="boardStyle">
          <Transition name="notice">
            <button
              v-if="restorationNotice"
              class="restoration-notice"
              :class="restorationNotice.type"
              type="button"
              role="status"
              @click="restorationNotice = null"
            >{{ restorationNotice.message }}</button>
          </Transition>
          <div class="corner"><span>行</span><i></i><b>列</b></div>
          <div class="column-clues">
            <div
              v-for="(clue, col) in columnClues"
              :key="col"
              class="column-clue"
              :class="{
                focused: focusedColumns.has(col),
                pointerFocused: showsPointerFocus && pointerFocusColumn === col,
                hintFocused: playHintColumns.has(col),
              }"
            >
              <small v-if="isTeacherMode">{{ columnWays[col].toLocaleString() }}</small>
              <textarea
                v-if="mode === 'edit' && creationMethod === 'clues'"
                :value="manualColumnClueTexts[col]"
                :class="{ invalid: !parsedManualColumns[col].valid }"
                :aria-label="`${col + 1}列目のヒント`"
                inputmode="numeric"
                rows="4"
                @input="updateColumnClueText(col, $event)"
                @blur="normalizeColumnClueText(col, $event)"
              ></textarea>
              <template v-else>
                <span
                  v-for="(number, i) in clue"
                  :key="i"
                  :class="{
                    zero: number === 0,
                    'play-clue': mode === 'play' && number !== 0,
                    confirmed: mode === 'play' && playClueMarks.columns[col]?.[i],
                  }"
                  @click="togglePlayClueMark('columns', col, i, number, $event)"
                  @contextmenu="togglePlayClueMark('columns', col, i, number, $event)"
                >{{ number }}</span>
              </template>
            </div>
          </div>
          <div class="row-clues">
            <div
              v-for="(clue, row) in rowClues"
              :key="row"
              class="row-clue"
              :class="{
                focused: focusedRows.has(row),
                pointerFocused: showsPointerFocus && pointerFocusRow === row,
                hintFocused: playHintRows.has(row),
              }"
            >
              <small v-if="isTeacherMode">{{ rowWays[row].toLocaleString() }}</small>
              <input
                v-if="mode === 'edit' && creationMethod === 'clues'"
                :ref="(element) => setRowClueInputRef(element, row)"
                :value="manualRowClueTexts[row]"
                :class="{ invalid: !parsedManualRows[row].valid }"
                :aria-label="`${row + 1}行目のヒント`"
                inputmode="text"
                @input="updateRowClueText(row, $event)"
                @blur="normalizeRowClueText(row, $event)"
                @keydown.enter.prevent="focusNextRowClue(row)"
              />
              <template v-else>
                <span
                  v-for="(number, i) in clue"
                  :key="i"
                  :class="{
                    zero: number === 0,
                    'play-clue': mode === 'play' && number !== 0,
                    confirmed: mode === 'play' && playClueMarks.rows[row]?.[i],
                  }"
                  @click="togglePlayClueMark('rows', row, i, number, $event)"
                  @contextmenu="togglePlayClueMark('rows', row, i, number, $event)"
                >{{ number }}</span>
              </template>
            </div>
          </div>
          <div
            class="grid"
            :class="{ readonly: isTeacherMode || (mode === 'edit' && creationMethod === 'clues') }"
            @contextmenu.prevent
            @pointermove="paintFromPointerMove"
            @pointerleave="clearPointerFocus"
          >
            <Transition name="clear">
              <button
                v-if="clearMessageVisible"
                type="button"
                class="clear-message"
                aria-label="完成メッセージを閉じる"
                @click="clearMessageVisible = false"
              ><small>PUZZLE COMPLETE</small><b>CLEAR</b><span>✦</span></button>
            </Transition>
            <template v-for="(row, rowIndex) in cells" :key="rowIndex">
              <button
                v-for="(filled, colIndex) in row"
                :key="colIndex"
                class="cell"
                :data-row="rowIndex"
                :data-col="colIndex"
                :class="{ filled, marked: marks[rowIndex][colIndex], lineFocused: highlightFocusedLinesOnBoard && (focusedRows.has(rowIndex) || focusedColumns.has(colIndex)), hintLineFocused: playHintRows.has(rowIndex) || playHintColumns.has(colIndex), pointerLineFocused: showsPointerFocus && (pointerFocusRow === rowIndex || pointerFocusColumn === colIndex), pointerFocused: showsPointerFocus && pointerFocusRow === rowIndex && pointerFocusColumn === colIndex, hintFocused: playHintCells.has(`${rowIndex}:${colIndex}`), focused: focusedCells.has(`${rowIndex}:${colIndex}`), fifthCol: (colIndex + 1) % 5 === 0 && colIndex + 1 < boardWidth, fifthRow: (rowIndex + 1) % 5 === 0 && rowIndex + 1 < boardHeight }"
                :aria-label="`${rowIndex + 1}行 ${colIndex + 1}列${marks[rowIndex][colIndex] ? '、×' : ''}`"
                :aria-pressed="filled"
                @pointerdown="startPaint(rowIndex, colIndex, $event)"
                @pointerenter="enterCell(rowIndex, colIndex, $event)"
              ></button>
            </template>
          </div>
        </div>

      </div>
    </section>

    <div v-if="manualOpen" class="modal-backdrop" @click.self="manualOpen = false">
      <section class="size-modal export-modal manual-modal" role="dialog" aria-modal="true" aria-labelledby="manual-title">
        <small>ご利用ガイド</small>
        <h2 id="manual-title">AZARASHI PIXEL PUZZLE TOOL 説明書</h2>

        <div class="manual-content">
          <section>
            <h3>1. アプリの概要</h3>
            <p>行と列のヒント数字を頼りにマスを塗り、絵を完成させるピクチャーパズルを作成・解答・解説できるアプリです。解答中のヒントや一手ずつの解説を、アザラシがお手伝いします！</p>
          </section>

          <section>
            <h3>2. 作成モード</h3>
            <p><b>盤面入力</b>ではマスを塗って問題を作り、ヒントを自動算出します。<b>ヒント入力</b>では行と列の数字を直接入力して問題を作ります。</p>
            <p>盤面サイズは、高さ・幅をそれぞれ5～30マスの範囲で指定できます。「唯一解チェック」では、入力した問題を本アプリの解法で最後まで確定できるか確認します。ヒント入力では解けたところまで盤面にも反映し、盤面入力では盤面を変更せず結果だけをお知らせします。</p>
          </section>

          <section>
            <h3>3. 解答モード</h3>
            <p>入力方式を「自動・黒マス・白マス」から選んで盤面を解きます。自動では左操作で黒マス、右操作で白マスを入力できます。</p>
            <p>ヒント数字の消し込みや、「戻る・進む」で操作履歴を辿ることも可能です。</p>
            <p><b>お助けアザラシ</b>の「ヒントをもらう」を押すと、現在の盤面を調べて、次に注目する行・列を案内してくれます。困ったときに活用してください。</p>
          </section>

          <section>
            <h3>4. 解説モード</h3>
            <p>アザラシが問題の解き方を一手ずつ説明してくれます。「前へ・次へ」を押すか、手順一覧から任意の手順を確認できます。</p>
            <p>手順の最初に推定難易度も教えてくれます。ただし、問題によっては最後まで解説できず、手詰まりになることがあります。</p>
          </section>

          <section>
            <h3>5. インポート・エクスポート</h3>
            <p><b>エクスポート</b>では、現在の問題をJSONファイルとして保存できます。また、このアプリで問題を開くURLと、外部サイトのpzprxsで開くURLを表示・コピーできます。このアプリのURLを共有すると、受け取った人が解答モードですぐに問題を始められます。</p>
            <p><b>インポート</b>では、このアプリから保存したJSONファイル、またはpzprxs・puzz.link・pzplusのピクチャーパズルURLを読み込めます。読み込み後は問題を埋め込んだこのアプリのURLへ移動し、解答モードで開きます。現在の盤面やヒントがある場合は、移動前に確認が表示されます。</p>
          </section>

          <section>
            <h3>6. 注意点・免責事項</h3>
            <p>「唯一解チェック」は、すべての解を列挙して数学的に唯一性を証明するものではなく、本アプリが対応している確定処理と1段階の仮置きで最後まで解けるかを確認する機能です。「唯一解の確認ができませんでした」は複数解であることを断定せず、対応している解法では確認できなかったことを表します。</p>
            <p>解析結果や難易度は目安であり、問題の正しさや完全性を保証するものではありません。大切な問題は、ページを閉じる前にエクスポートしてください。外部サイトを利用する場合は、各サイトの利用条件をご確認ください。</p>
            <p>問題の解析や盤面の処理はサーバーでは行わず、ご利用のブラウザ上で実行されます。大きな盤面や複雑な問題では、ご利用の端末やブラウザ環境によって処理に時間がかかったり、画面が一時的に応答しなくなったりする場合があります。</p>
            <p>このアプリで使用しているアザラシの画像は、生成AIを利用して作成したものです。</p>
            <p>このアプリへのお問い合わせは、<a href="https://x.com/3892myamya" target="_blank" rel="noopener noreferrer">https://x.com/3892myamya</a>までお願いします。</p>
          </section>
        </div>

        <div class="modal-actions export-close-action">
          <button type="button" @click="manualOpen = false">閉じる</button>
        </div>
      </section>
    </div>

    <div v-if="customSizeOpen" class="modal-backdrop" @click.self="customSizeOpen = false">
      <form class="size-modal" @submit.prevent="applyCustomSize">
        <small>盤面サイズの設定</small>
        <h2>盤面サイズを指定</h2>
        <div class="custom-size-fields">
          <label>
            <span>高さ</span>
            <input v-model.number="customHeight" type="number" min="5" max="30" required />
          </label>
          <b>×</b>
          <label>
            <span>幅</span>
            <input v-model.number="customWidth" type="number" min="5" max="30" required />
          </label>
        </div>
        <p>高さ・幅ともに5～30で指定できます。</p>
        <div class="modal-actions">
          <button type="button" @click="customSizeOpen = false">キャンセル</button>
          <button type="submit">適用する</button>
        </div>
      </form>
    </div>

    <div v-if="exportOpen" class="modal-backdrop" @click.self="exportOpen = false">
      <section class="size-modal export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <small>EXPORT PUZZLE</small>
        <h2 id="export-title">問題をエクスポート</h2>

        <div class="export-option">
          <div>
            <b>ファイルダウンロード</b>
            <p>現在の問題をJSON形式のテキストファイルとして保存します。</p>
          </div>
          <button type="button" class="download-button" @click="downloadProblem">ダウンロード</button>
        </div>

        <div class="export-option url-option">
          <div>
            <b>このアプリのURLとして出力</b>
          </div>
          <label class="export-url-field">
            <input :value="appPuzzleUrl" aria-label="このアプリで開くURL" readonly @focus="$event.target.select()" />
          </label>
          <div class="export-url-actions">
            <button type="button" @click="copyAppPuzzleUrl">{{ appUrlCopied ? 'コピーしました' : 'URLをコピー' }}</button>
            <a :href="appPuzzleUrl" target="_blank" rel="noopener noreferrer">このアプリで開く ↗</a>
          </div>
        </div>

        <div class="export-option url-option">
          <div>
            <b>pzprxsのURLとして出力</b>
          </div>
          <label class="export-url-field">
            <input :value="pzprxsUrl" aria-label="pzprxsで開くURL" readonly @focus="$event.target.select()" />
          </label>
          <div class="export-url-actions">
            <button type="button" @click="copyPzprxsUrl">{{ exportUrlCopied ? 'コピーしました' : 'URLをコピー' }}</button>
            <a :href="pzprxsUrl" target="_blank" rel="noopener noreferrer">pzprxsで開く ↗</a>
          </div>
        </div>

        <div class="modal-actions export-close-action">
          <button type="button" @click="exportOpen = false">閉じる</button>
        </div>
      </section>
    </div>

    <div v-if="importOpen" class="modal-backdrop" @click.self="importOpen = false">
      <section class="size-modal export-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <small>IMPORT PUZZLE</small>
        <h2 id="import-title">問題をインポート</h2>

        <label class="export-option import-file-option">
          <div>
            <b>JSONファイルを読み込む</b>
            <p>AZARASHI PIXEL PUZZLE TOOLからエクスポートしたファイルを選択してください。</p>
          </div>
          <span class="file-select-button">ファイルを選択</span>
          <input type="file" accept="application/json,.json,text/plain" @change="importJsonFile" />
        </label>

        <div class="export-option url-option">
          <div>
            <b>ピクチャーパズルURLを読み込む</b>
            <p>pzprxs・puzz.link・pzplusのURLを貼り付けてください。</p>
          </div>
          <label class="export-url-field">
            <input
              v-model.trim="importUrlText"
              type="url"
              aria-label="読み込むピクチャーパズルURL"
              placeholder="https://pzprxs.vercel.app/p?nonogram/..."
              @keydown.enter.prevent="importPzprxsUrl"
            />
          </label>
          <button type="button" class="import-url-button" :disabled="!importUrlText" @click="importPzprxsUrl">URLを読み込む</button>
        </div>

        <p v-if="importError" class="import-error" role="alert">{{ importError }}</p>
        <div class="modal-actions export-close-action">
          <button type="button" @click="importOpen = false">閉じる</button>
        </div>
      </section>
    </div>
  </main>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Noto+Sans+JP:wght@400;500;600;700;800&display=swap');

:root { font-family: 'Noto Sans JP', sans-serif; color: #17364d; background: #edf5f9; font-synthesis: none; }
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; min-height: 100vh; }
button, input, textarea { font: inherit; }
button { color: inherit; }
button:focus-visible, input:focus-visible { outline: 3px solid #20a9e0; outline-offset: 2px; }

.page { min-height: 100vh; background: radial-gradient(circle at 92% 4%, rgba(105, 201, 235, .22), transparent 30%), #edf5f9; }
.page.painting-fill, .page.painting-fill * { cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Cpath d='M7 25c-1.8 0-3 1.2-3 3 2.8.4 6.1-.2 7.2-2.6l.7-1.7-3.7-2.9-.7 1.8c-.2.6-.2 1.2-.5 1.7-.2.4-.5.7-1 .7Z' fill='%2342c5ef' stroke='%2317364d' stroke-width='1.5'/%3E%3Cpath d='m9 20 3.9 3.1L27 6.7c.8-1 .6-2.4-.4-3.2s-2.5-.6-3.3.4L9 20Z' fill='%23f7fcff' stroke='%2317364d' stroke-width='2'/%3E%3C/svg%3E") 5 27, crosshair !important; }
.page.painting-mark, .page.painting-mark * { cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='13' fill='%23f7fcff' stroke='%2317364d' stroke-width='2'/%3E%3Cpath d='m10 10 12 12m0-12L10 22' stroke='%2320a9e0' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E") 16 16, crosshair !important; }
.page.painting-erase, .page.painting-erase * { cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Cpath d='m5.5 20.5 11-14c1-1.3 2.9-1.5 4.2-.5l5.8 4.6c1.3 1 1.5 2.9.5 4.2L17.4 27H11l-5-3.9c-.8-.7-1-1.8-.5-2.6Z' fill='%2365d5f5' stroke='%2317364d' stroke-width='2'/%3E%3Cpath d='m10 15 10 7.8' stroke='%2317364d' stroke-width='2'/%3E%3Cpath d='M11 27h12' stroke='%2317364d' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E") 7 24, crosshair !important; }
.topbar { height: 84px; padding: 0 clamp(24px, 5vw, 78px); border-bottom: 1px solid #cfcdc5; display: flex; align-items: center; justify-content: flex-start; gap: clamp(20px, 3vw, 42px); }
.brand { color: #17364d; text-decoration: none; display: flex; align-items: center; gap: 12px; font-family: 'DM Mono'; font-size: 12px; line-height: 1.25; letter-spacing: .14em; }
.brand span:last-child { white-space: nowrap; }
.brand b { font-size: 16px; }
.brand-mark { width: 34px; height: 34px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 3px; transform: rotate(45deg); }
.brand-mark i { background: #17364d; border-radius: 1px; }
.brand-mark i:nth-child(2), .brand-mark i:nth-child(3) { background: #20a9e0; }
.top-actions { display: flex; align-items: center; gap: 8px; }
.mode-switch { height: 42px; display: flex; padding: 3px; border: 1px solid #c7c5bd; background: rgba(255,255,255,.28); }
.mode-switch button { min-width: 82px; padding: 0 12px; border: 0; background: transparent; color: #777c79; font-size: 12px; font-weight: 700; cursor: pointer; }
.mode-switch button.active { color: white; background: #176b99; }
.icon-button { border: 1px solid #cfcdc5; background: rgba(255,255,255,.28); height: 42px; width: 44px; font-size: 24px; cursor: pointer; }
.icon-button:disabled, .clear-button:disabled { opacity: .3; cursor: default; }
.export-button { height: 42px; padding: 0 6px 0 19px; margin: 0; border: 0; color: white; background: #17364d; display: flex; align-items: center; gap: 15px; font-size: 14px; font-weight: 700; cursor: pointer; }
.export-button b { display: grid; place-items: center; width: 31px; height: 31px; background: #42c5ef; color: #17364d; font-size: 17px; }
.import-button { background: #176b99; }
.import-button b { background: #bdefff; }
.manual-button { border: 1px solid #176b99; background: transparent; color: #176b99; }
.manual-button b { background: #dff5fc; color: #176b99; }

.workspace { width: 100%; margin: 0; padding: 52px clamp(24px, 4.5vw, 64px) 64px; display: grid; grid-template-columns: 304px minmax(0, 1fr); gap: clamp(35px, 5vw, 75px); align-items: start; }
.panel { padding-top: 0; }
.mode-label { margin-bottom: 10px; }
.panel-mode-switch { width: 100%; margin-bottom: 12px; }
.panel-mode-switch button { min-width: 0; flex: 1; }
.panel-top-rule { margin-bottom: 22px; border-top: 2px solid #17364d; }
.field-group { margin-bottom: 27px; }
.field-group label, .label { display: block; margin-bottom: 10px; font-size: 13px; font-weight: 700; letter-spacing: .07em; }
.field-group input { width: 100%; height: 44px; background: rgba(255,255,255,.42); border: 1px solid #c7c5bd; padding: 0 12px; font-size: 15px; font-weight: 600; }
.field-group input:disabled { color: #777c79; opacity: .65; }
.creation-picker { display: grid; grid-template-columns: 1fr 1fr; }
.creation-picker button { min-height: 44px; padding: 8px; border: 1px solid #b8ced9; background: rgba(255,255,255,.32); color: #607989; font-size: 12px; font-weight: 700; cursor: pointer; }
.creation-picker button + button { border-left: 0; }
.creation-picker button.active { border-color: #176b99; background: #176b99; color: white; }
.input-method-picker { display: grid; grid-template-columns: repeat(3, 1fr); }
.input-method-picker button { min-height: 48px; padding: 7px 3px; border: 1px solid #b8ced9; border-right: 0; background: rgba(255,255,255,.32); color: #607989; display: flex; align-items: center; justify-content: center; gap: 7px; font-size: 12px; font-weight: 700; cursor: pointer; }
.input-method-picker button:last-child { border-right: 1px solid #b8ced9; }
.input-method-picker button.active { border-color: #176b99; background: #176b99; color: white; }
.input-method-picker button:disabled { cursor: default; opacity: .45; }
.input-method-picker button.active:disabled { opacity: .7; }
.input-method-icon { position: relative; flex: 0 0 18px; width: 18px; height: 18px; border: 2px solid currentColor; background: #fff; }
.history-field { margin-top: -6px; }
.history-controls { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.history-controls button { height: 42px; padding: 0 8px; border: 1px solid #6a96ad; background: rgba(255,255,255,.42); display: flex; align-items: center; justify-content: space-between; color: #245b78; font-size: 12px; font-weight: 700; cursor: pointer; }
.history-controls button b { width: 27px; height: 27px; display: grid; place-items: center; background: #176b99; color: white; font: 500 17px 'DM Mono'; }
.history-controls button:disabled { opacity: .35; cursor: default; }
.auto-icon { background: linear-gradient(135deg, #17364d 0 48%, #fff 52% 100%); }
.black-icon { border-color: #17364d; background: #17364d; }
.white-icon::before, .white-icon::after { content: ''; position: absolute; left: 2px; right: 2px; top: 7px; height: 2px; background: currentColor; transform: rotate(45deg); }
.white-icon::after { transform: rotate(-45deg); }
.input-method-picker button.active .input-method-icon { border-color: white; }
.input-method-picker button.active .black-icon { background: white; }
.clue-input-help, .clue-input-error { margin: 8px 0 0; font-size: 11px; line-height: 1.6; }
.clue-input-help { color: #607989; }
.clue-input-error { color: #b44545; font-weight: 700; }
.size-picker { display: grid; grid-template-columns: repeat(4, 1fr); }
.size-picker button { padding: 10px 2px 9px; border: 1px solid #c8c6be; border-right: 0; background: rgba(255,255,255,.25); cursor: pointer; }
.size-picker button:last-child { border-right: 1px solid #c8c6be; }
.size-picker button.active { color: white; background: #176b99; border-color: #176b99; }
.size-picker button:disabled { cursor: default; opacity: .55; }
.size-picker button.active:disabled { opacity: 1; }
.size-picker b { display: block; font-family: 'DM Mono'; font-size: 13px; }
.size-picker small { display: block; font-family: 'DM Mono'; font-size: 9px; letter-spacing: .12em; opacity: .65; margin-top: 3px; }
.teacher-message { position: relative; min-height: 148px; margin: 0 0 16px; padding: 12px 18px 12px 122px; border: 1px solid #a8d7e8; background: #f7fcff; display: flex; align-items: center; }
.teacher-message::before { content: ''; position: absolute; left: 108px; top: calc(50% - 6px); width: 12px; height: 12px; border-left: 1px solid #a8d7e8; border-bottom: 1px solid #a8d7e8; background: #f7fcff; transform: rotate(45deg); }
.teacher-message img { position: absolute; left: 10px; top: 50%; width: 98px; height: 98px; object-fit: contain; transform: translateY(-50%); }
.teacher-message p { position: relative; margin: 0; color: #245b78; font-size: 14px; font-weight: 700; line-height: 1.75; }
.play-helper-content { position: relative; width: 100%; }
.hint-button { width: 100%; min-height: 40px; margin-top: 13px; border: 1px solid #176b99; background: #176b99; color: white; font-size: 12px; font-weight: 700; cursor: pointer; }
.hint-button:hover { background: #125b83; }
.hint-button:disabled { border-color: #9fb2bb; background: #c5d1d6; color: #6f8189; cursor: default; }
.teacher-log-section { min-width: 0; }
.step-controls { margin-top: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.teacher-step-controls { margin: 0 0 16px; }
.step-controls button { height: 39px; padding: 0 5px; border: 1px solid #6a96ad; color: #17364d; background: #65d5f5; display: flex; align-items: center; justify-content: space-between; cursor: pointer; }
.step-controls button span { font: 500 11px 'DM Mono'; letter-spacing: .1em; }
.step-controls button b { width: 27px; height: 27px; display: grid; place-items: center; color: white; background: #17364d; font: 500 15px 'DM Mono'; }
.step-controls button:disabled { color: #8d9691; background: #4c5551; border-color: #59615e; cursor: default; }
.step-controls button:disabled b { color: #89918d; }
.step-history { margin: 0 0 8px; border: 1px solid #c9c6bd; background: rgba(255,255,255,.24); }
.step-history-title { height: 36px; padding: 0 10px; border-bottom: 1px solid #d2cfc7; display: flex; align-items: center; justify-content: space-between; font: 500 10px 'DM Mono'; letter-spacing: .1em; }
.step-history-title b { color: #167cae; font-weight: 500; }
.step-list { max-height: 190px; padding: 5px; overflow-y: auto; }
.step-list button { width: 100%; height: 34px; padding: 0 8px; border: 0; border-bottom: 1px solid #ddd9d0; background: transparent; display: grid; grid-template-columns: 8px 1fr auto; align-items: center; gap: 8px; color: #777c79; text-align: left; cursor: pointer; }
.step-list button:last-child { border-bottom: 0; }
.step-list button:hover { background: #e5f1f6; }
.step-list button.active { color: #17364d; background: #dceef6; }
.step-list button i { width: 5px; height: 5px; border: 1px solid #999d99; transform: rotate(45deg); }
.step-list button.active i { border-color: #1689bd; background: #42c5ef; }
.step-list button span { font: 500 11px 'DM Mono'; letter-spacing: .06em; }
.step-list button b { color: #a4a6a1; font: 500 9px 'DM Mono'; letter-spacing: .08em; }
.step-list button.active b { color: #167cae; }
.restore-board-button { width: 100%; min-height: 44px; margin-top: 8px; border: 1px solid #176b99; background: #176b99; color: white; font-size: 13px; font-weight: 700; cursor: pointer; }
.clear-button { width: 100%; min-height: 44px; margin-top: 16px; padding: 10px 14px; border: 1px solid #c75b5b; background: #fff0f0; color: #a23f3f; font-size: 13px; font-weight: 700; box-shadow: inset 4px 0 0 #c75b5b; cursor: pointer; }
.clear-button:hover:not(:disabled) { background: #ffe2e2; border-color: #ad4141; color: #8f3030; }

.restoration-notice { position: absolute; z-index: 25; left: 50%; top: 10px; width: min(430px, calc(100vw - 32px)); padding: 15px 42px 15px 17px; border: 1px solid #79b8d3; border-left: 5px solid #1689bd; background: #f7fcff; color: #245b78; text-align: left; font-size: 13px; font-weight: 700; line-height: 1.55; box-shadow: 8px 8px 0 rgba(23,54,77,.16); cursor: pointer; transform: translateX(-50%); }
.restoration-notice::after { content: '×'; position: absolute; right: 14px; top: 12px; color: #607989; font-size: 17px; }
.restoration-notice.success { border-left-color: #23835c; }
.restoration-notice.warning { border-left-color: #d29b28; background: #fffaf0; }
.restoration-notice.error { border-left-color: #b44545; background: #fff2f2; color: #873838; }
.notice-enter-active, .notice-leave-active { transition: opacity .2s ease, transform .25s ease; }
.notice-enter-from, .notice-leave-to { opacity: 0; transform: translate(-50%, -10px); }

.editor-area { min-width: 0; position: relative; }
.clear-message { position: absolute; z-index: 5; left: 50%; top: 50%; transform: translate(-50%, -50%) rotate(-2deg); min-width: 230px; padding: 24px 40px 20px; border: 2px solid #17364d; outline: 5px solid rgba(237,245,249,.9); background: #42c5ef; color: #17364d; text-align: center; box-shadow: 8px 8px 0 rgba(23,54,77,.22); cursor: pointer; }
.clear-message small { display: block; font: 500 9px 'DM Mono'; letter-spacing: .2em; }
.clear-message b { display: block; margin-top: 2px; font: 500 44px 'DM Mono'; letter-spacing: .08em; }
.clear-message span { position: absolute; right: 12px; top: 9px; }
.clear-enter-active { transition: opacity .25s ease, transform .35s cubic-bezier(.2,1.5,.4,1); }
.clear-leave-active { transition: opacity .18s ease; }
.clear-enter-from { opacity: 0; transform: translate(-50%, -42%) rotate(-2deg) scale(.8); }
.clear-leave-to { opacity: 0; }
.board-wrap { --cell: min(38px, calc((78vw - 350px) / var(--cols))); position: relative; display: grid; grid-template-columns: calc(var(--row-clues) * 25px + 20px) calc(var(--cols) * var(--cell)); grid-template-rows: calc(var(--column-clues) * 22px + 18px) calc(var(--rows) * var(--cell)); width: max-content; max-width: 100%; }
.corner { position: relative; border-right: 1px solid #b7b5ad; border-bottom: 1px solid #b7b5ad; overflow: hidden; font-family: 'DM Mono'; font-size: 9px; color: #858b88; }
.corner i { position: absolute; width: 160%; border-top: 1px solid #d0cec7; transform: rotate(26deg); left: -18%; top: 50%; }
.corner span { position: absolute; bottom: 8px; left: 8px; }
.corner b { position: absolute; top: 8px; right: 8px; font-weight: 400; }
.column-clues { display: grid; grid-template-columns: repeat(var(--cols), var(--cell)); align-items: stretch; border-bottom: 1px solid #17364d; }
.column-clue { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 2px; padding-bottom: 7px; font: 500 13px 'DM Mono'; }
.column-clue textarea { width: calc(100% - 4px); height: calc(100% - 6px); min-height: 0; margin: 3px 2px; padding: 5px 2px; resize: none; overflow: hidden; border: 1px solid #a9c6d5; border-radius: 0; background: rgba(255,255,255,.72); color: #17364d; text-align: center; font: 500 12px/1.45 'DM Mono'; }
.column-clue textarea.invalid { border-color: #c45c5c; background: #fff0f0; }
.column-clue.pointerFocused { background: rgba(32, 169, 224, .07); box-shadow: inset 0 -2px 0 rgba(22, 143, 196, .55); }
.column-clue.focused { background: rgba(32, 169, 224, .16); box-shadow: inset 0 -3px 0 #168fc4; }
.column-clue.hintFocused { background: rgba(238, 174, 48, .18); box-shadow: inset 0 -3px 0 #d58e16; }
.column-clue > small { position: absolute; top: 7px; color: #167cae; font: 500 9px 'DM Mono'; writing-mode: vertical-rl; }
.row-clues { display: grid; grid-template-rows: repeat(var(--rows), var(--cell)); border-right: 1px solid #17364d; }
.row-clue { position: relative; display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding-right: 10px; font: 500 13px 'DM Mono'; }
.row-clue input { width: calc(100% - 12px); height: calc(100% - 6px); margin: 3px 6px; padding: 0 8px; border: 1px solid #a9c6d5; border-radius: 0; background: rgba(255,255,255,.72); color: #17364d; text-align: right; font: 500 12px 'DM Mono'; }
.row-clue input.invalid { border-color: #c45c5c; background: #fff0f0; }
.row-clue.pointerFocused { background: rgba(32, 169, 224, .07); box-shadow: inset -2px 0 0 rgba(22, 143, 196, .55); }
.row-clue.focused { background: rgba(32, 169, 224, .16); box-shadow: inset -3px 0 0 #168fc4; }
.row-clue.hintFocused { background: rgba(238, 174, 48, .18); box-shadow: inset -3px 0 0 #d58e16; }
.row-clue > small { position: absolute; left: 7px; color: #167cae; font: 500 9px 'DM Mono'; }
.zero { color: #b1b2ad; }
.play-clue { cursor: pointer; user-select: none; transition: color .15s ease, opacity .15s ease; }
.play-clue:hover { color: #168fc4; }
.play-clue.confirmed { color: #82909a; opacity: .65; text-decoration: line-through 2px #168fc4; text-decoration-skip-ink: none; }
.grid { position: relative; display: grid; grid-template-columns: repeat(var(--cols), var(--cell)); grid-template-rows: repeat(var(--rows), var(--cell)); border: 2px solid #17364d; border-top: 0; border-left: 0; background: #f9fdff; touch-action: none; user-select: none; }
.grid.readonly .cell { cursor: default; }
.grid.readonly .cell:hover { background: transparent; }
.cell { position: relative; width: var(--cell); height: var(--cell); margin: 0; padding: 0; border: 0; border-right: 1px solid #d0cec6; border-bottom: 1px solid #d0cec6; border-radius: 0; background: transparent; cursor: crosshair; }
.cell:hover { background: #e3f2f8; }
.cell.pointerLineFocused { background: rgba(32, 169, 224, .06); }
.cell.pointerLineFocused:hover { background: rgba(32, 169, 224, .12); }
.cell.pointerFocused { background: rgba(32, 169, 224, .18); box-shadow: inset 0 0 0 2px rgba(32, 169, 224, .65); }
.cell.lineFocused { background: rgba(32, 169, 224, .1); box-shadow: inset 0 0 0 1px rgba(22, 143, 196, .22); }
.cell.focused { background: rgba(32, 169, 224, .34); box-shadow: inset 0 0 0 2px #20a9e0; }
.cell.filled { background: #17364d; box-shadow: inset 0 0 0 1px #edf5f9; }
.cell.filled.pointerLineFocused { background: #1d465e; box-shadow: inset 0 0 0 1px rgba(101, 213, 245, .5); }
.cell.filled.pointerFocused { background: #24516b; box-shadow: inset 0 0 0 2px rgba(101, 213, 245, .72); }
.cell.filled.lineFocused { box-shadow: inset 0 0 0 1px #579bb9; }
.cell.filled.focused { box-shadow: inset 0 0 0 2px #42c5ef; }
.cell.hintLineFocused { background: rgba(238, 174, 48, .12); box-shadow: inset 0 0 0 1px rgba(213, 142, 22, .4); }
.cell.hintFocused { background: rgba(238, 174, 48, .3); box-shadow: inset 0 0 0 2px #d58e16; }
.cell.filled.hintLineFocused { background: #55462e; box-shadow: inset 0 0 0 1px rgba(255, 202, 91, .62); }
.cell.filled.hintFocused { background: #65502b; box-shadow: inset 0 0 0 2px #ffca5b; }
.cell.marked::after { content: '×'; position: absolute; inset: 0; display: grid; place-items: center; color: #8d9691; font: 400 clamp(13px, calc(var(--cell) * .58), 21px) 'DM Mono'; }
.cell.fifthCol { border-right: 2px solid #78807d; }
.cell.fifthRow { border-bottom: 2px solid #78807d; }

.modal-backdrop { position: fixed; z-index: 30; inset: 0; padding: 20px; background: rgba(15, 43, 61, .52); display: grid; place-items: center; }
.size-modal { width: min(420px, 100%); padding: 28px; border: 1px solid #8ebed2; background: #f7fcff; box-shadow: 12px 12px 0 rgba(23,54,77,.2); }
.size-modal > small { color: #1689bd; font: 500 10px 'DM Mono'; letter-spacing: .16em; }
.size-modal h2 { margin: 5px 0 22px; color: #17364d; font-size: 20px; }
.custom-size-fields { display: grid; grid-template-columns: 1fr auto 1fr; align-items: end; gap: 12px; }
.custom-size-fields label span { display: block; margin-bottom: 7px; color: #426d82; font-size: 12px; font-weight: 700; }
.custom-size-fields input { width: 100%; height: 48px; border: 1px solid #a9c6d5; background: white; color: #17364d; text-align: center; font: 500 17px 'DM Mono'; }
.custom-size-fields > b { padding-bottom: 12px; color: #607989; }
.size-modal > p { margin: 10px 0 22px; color: #607989; font-size: 12px; }
.modal-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.modal-actions button { height: 42px; border: 1px solid #a9c6d5; background: transparent; color: #426d82; font-size: 13px; font-weight: 700; cursor: pointer; }
.modal-actions button:last-child { border-color: #176b99; background: #176b99; color: white; }
.export-modal { width: min(620px, 100%); max-height: calc(100vh - 40px); overflow-y: auto; }
.manual-modal { width: min(720px, 100%); }
.manual-content { display: grid; gap: 14px; }
.manual-content section { padding: 16px 18px; border: 1px solid #b8d2df; background: rgba(255,255,255,.55); }
.manual-content h3 { margin: 0 0 9px; color: #176b99; font-size: 15px; }
.manual-content p { margin: 0; color: #426d82; font-size: 13px; line-height: 1.75; }
.manual-content p + p { margin-top: 8px; }
.manual-content b { color: #17364d; }
.manual-content a { color: #176b99; font-weight: 700; overflow-wrap: anywhere; }
.export-option { padding: 17px; border: 1px solid #b8d2df; background: rgba(255,255,255,.55); display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 14px; }
.export-option + .export-option { margin-top: 12px; }
.export-option b { font-size: 14px; }
.export-option p { margin: 5px 0 0; color: #607989; font-size: 11px; line-height: 1.55; }
.export-option button, .export-option a, .file-select-button { min-height: 40px; padding: 0 15px; border: 1px solid #176b99; background: #176b99; color: white; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; text-decoration: none; cursor: pointer; }
.export-option button:disabled { opacity: .4; cursor: default; }
.url-option { grid-template-columns: 1fr; }
.export-url-field input { width: 100%; height: 43px; padding: 0 11px; border: 1px solid #a9c6d5; background: white; color: #17364d; font: 500 11px 'DM Mono'; }
.export-url-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.export-url-actions a { border-color: #a9c6d5; background: transparent; color: #176b99; }
.export-close-action { margin-top: 18px; grid-template-columns: 1fr; }
.import-file-option { position: relative; cursor: pointer; }
.import-file-option input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.import-file-option:focus-within { outline: 3px solid #20a9e0; outline-offset: 2px; }
.import-url-button { width: 100%; }
.import-error { margin: 12px 0 0; padding: 10px 12px; border-left: 3px solid #b44545; background: #fff0f0; color: #9c3737; font-size: 12px; font-weight: 700; line-height: 1.5; }

@media (max-width: 850px) {
  .export-button { margin-left: 0; padding-left: 6px; gap: 0; }
  .export-button > span { display: none; }
  .workspace { grid-template-columns: 1fr; }
  .panel { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }
  .mode-label, .panel-mode-switch, .panel-top-rule { grid-column: 1 / -1; }
  .teacher-message, .teacher-log-section, .play-helper-field { grid-column: 1 / -1; }
  .clear-button { grid-column: 1 / -1; }
  .editor-area { overflow-x: auto; padding-bottom: 10px; }
  .board-wrap { --cell: min(38px, calc((94vw - (var(--row-clues) * 25px) - 52px) / var(--cols))); margin: 0; }
}
@media (max-width: 540px) {
  .topbar { height: 70px; padding: 0 18px; }
  .brand span:last-child { display: none; }
  .top-actions { gap: 4px; }
  .mode-switch button { padding: 0 5px; }
  .workspace { padding: 32px 12px 42px; gap: 24px; }
  .panel { grid-template-columns: 1fr; padding: 18px 6px 0; }
  .field-group { margin-bottom: 20px; }
  .board-wrap { --cell: min(34px, calc((96vw - (var(--row-clues) * 21px) - 26px) / var(--cols))); grid-template-columns: calc(var(--row-clues) * 21px + 12px) calc(var(--cols) * var(--cell)); }
  .row-clue { gap: 5px; padding-right: 6px; font-size: 11px; }
  .column-clue { font-size: 11px; }
  .export-option { grid-template-columns: 1fr; }
  .export-option .download-button { width: 100%; }
  .export-url-actions { grid-template-columns: 1fr; }
}
</style>
