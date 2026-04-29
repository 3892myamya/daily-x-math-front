<script setup>
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';

const size = ref(5);
const floorCount = ref(1);
const maze = ref([]);
const distances = ref([]);
const showDistance = ref(false);
const selectionStep = ref(1);
const playerPos = ref({ f: 0, r: 0, c: 0 });
const gameCleared = ref(false);
const showModal = ref(false);
const showConfigModal = ref(false);

// Default to 'normal'
const branchSetting = ref('normal');
const stairSetting = ref('normal');

// 5-level configuration logic
const configValues = {
  branch: {
    low: 0.01,
    normal: 0.05,
    high: 0.2,
  },
  stair: {
    low: 50,
    normal: 10,
    high: 4,
  }
};

const startCount = computed(() => {
  let count = 0;
  maze.value.forEach(f => f.forEach(r => r.forEach(c => {
    if (c.type === 2) count++;
  })));
  return count;
});

const canStart = computed(() => startCount.value === 1);

const findStartNode = () => {
  if (!maze.value || maze.value.length === 0) {
    return { f: 0, r: 0, c: 0 };
  }
  for (let f = 0; f < floorCount.value; f++) {
    for (let r = 0; r < size.value; r++) {
      for (let c = 0; c < size.value; c++) {
        if (maze.value[f][r][c].type === 2) return { f, r, c };
      }
    }
  }
  return { f: 0, r: 0, c: 0 };
};

const initMaze = () => {
  const currentStart = findStartNode();
  const hasStart = startCount.value > 0;

  selectionStep.value = 1;
  gameCleared.value = false;
  showModal.value = false;
  distances.value = [];

  maze.value = Array.from({ length: floorCount.value }, (_, f) =>
    Array.from({ length: size.value }, (_, r) =>
      Array.from({ length: size.value }, (_, c) => {
        let type = 0;
        if (hasStart) {
          if (f === currentStart.f && r === currentStart.r && c === currentStart.c) {
            type = 2;
          }
        } else {
          if (f === 0 && r === 0 && c === 0) {
            type = 2;
          }
        }

        return {
          right: true,
          bottom: true,
          type: type
        };
      })
    )
  );
};

const generateMaze = () => {
  const s = size.value;
  const fCount = floorCount.value;
  const start = findStartNode();

  const bProb = configValues.branch[branchSetting.value];
  const sWeight = configValues.stair[stairSetting.value];

  for (let f = 0; f < fCount; f++) {
    for (let r = 0; r < s; r++) {
      for (let c = 0; c < s; c++) {
        maze.value[f][r][c].right = true;
        maze.value[f][r][c].bottom = true;
        if (maze.value[f][r][c].type !== 2) maze.value[f][r][c].type = 0;
      }
    }
  }

  const visited = Array.from({ length: fCount }, () =>
    Array.from({ length: s }, () => Array(s).fill(false))
  );

  const stack = [];
  visited[start.f][start.r][start.c] = true;
  stack.push(start);

  const directions = [
    { f: 0, r: -1, c: 0, type: 'plane' },
    { f: 0, r: 1, c: 0, type: 'plane' },
    { f: 0, r: 0, c: -1, type: 'plane' },
    { f: 0, r: 0, c: 1, type: 'plane' },
    { f: 1, r: 0, c: 0, type: 'floor' },
    { f: -1, r: 0, c: 0, type: 'floor' }
  ];

  while (stack.length > 0) {
    let index = stack.length - 1;
    if (Math.random() < bProb) index = Math.floor(Math.random() * stack.length);

    const curr = stack[index];
    const neighbors = [];

    for (const d of directions) {
      const nf = curr.f + d.f;
      const nr = curr.r + d.r;
      const nc = curr.c + d.c;

      if (nf >= 0 && nf < fCount && nr >= 0 && nr < s && nc >= 0 && nc < s && !visited[nf][nr][nc]) {
        const weight = d.type === 'plane' ? sWeight : 1;
        for (let i = 0; i < weight; i++) neighbors.push({ nf, nr, nc, d });
      }
    }

    if (neighbors.length > 0) {
      const { nf, nr, nc, d } = neighbors[Math.floor(Math.random() * neighbors.length)];

      if (d.type === 'plane') {
        if (d.r === 1) maze.value[curr.f][curr.r][curr.c].bottom = false;
        if (d.r === -1) maze.value[nf][nr][nc].bottom = false;
        if (d.c === 1) maze.value[curr.f][curr.r][curr.c].right = false;
        if (d.c === -1) maze.value[nf][nr][nc].right = false;
      } else {
        if (maze.value[curr.f][curr.r][curr.c].type === 0 && maze.value[nf][nr][nc].type === 0) {
          if (d.f === 1) {
            maze.value[curr.f][curr.r][curr.c].type = 4;
            maze.value[nf][nr][nc].type = 5;
          } else {
            maze.value[curr.f][curr.r][curr.c].type = 5;
            maze.value[nf][nr][nc].type = 4;
          }
        } else continue;
      }

      visited[nf][nr][nc] = true;
      stack.push({ f: nf, r: nr, c: nc });
    } else {
      stack.splice(index, 1);
    }
  }

  findAndSetFarthestGoal();
};

const handleCellClick = (f, r, c, event) => {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const threshold = 8;
  const cell = maze.value[f][r][c];

  if (x > rect.width - threshold && c < size.value - 1) {
    cell.right = !cell.right;
  } else if (x < threshold && c > 0) {
    maze.value[f][r][c - 1].right = !maze.value[f][r][c - 1].right;
  } else if (y > rect.height - threshold && r < size.value - 1) {
    cell.bottom = !cell.bottom;
  } else if (y < threshold && r > 0) {
    maze.value[f][r - 1][c].bottom = !maze.value[f][r - 1][c].bottom;
  } else {
    const oldType = cell.type;
    const sequence = [2, 0, 4, 5, 6, 3];

    let availableTypes = sequence.filter(type => {
      if (type === 2) return oldType === 2 || startCount.value === 0;

      if (type === 4) {
        const canGoUp = f < floorCount.value - 1;
        if (!canGoUp) return false;
        const targetCell = maze.value[f + 1][r][c];
        // 上が空白、または既に自分のペア(5)がいるならOK
        return targetCell.type === 0 || (oldType === 4 && targetCell.type === 5);
      }

      if (type === 5 || type === 6) {
        const canGoDown = f > 0;
        if (!canGoDown) return false;
        const targetCell = maze.value[f - 1][r][c];

        if (type === 5) {
          // 下が空白、または既に自分のペア(4)がいるならOK
          return targetCell.type === 0 || (oldType === 5 && targetCell.type === 4);
        }

        if (type === 6) {
          // 【修正ポイント】
          // 下が空白、または「今自分が下り階段(5)で、下にそのペア(4)がいる」なら、
          // 次のクリックで4を消すことになるので、落とし穴(6)を選択肢に入れてOKとする
          return targetCell.type === 0 || (oldType === 5 && targetCell.type === 4);
        }
      }

      return true;
    });

    if (startCount.value === 0 && oldType !== 2) {
      availableTypes = [2];
    }

    if (availableTypes.length === 0) return;

    const currentIndex = availableTypes.indexOf(oldType);
    const nextType = currentIndex === -1
      ? availableTypes[0]
      : availableTypes[(currentIndex + 1) % availableTypes.length];

    // 3. 状態のクリーンアップ（新しいタイプをセットする前にペアを消去）
    // 自分が階段(4 or 5)から別のものに変わるなら、ペアを必ず消す
    if (oldType === 4 && f < floorCount.value - 1) {
      maze.value[f + 1][r][c].type = 0;
    } else if (oldType === 5 && f > 0) {
      maze.value[f - 1][r][c].type = 0;
    }

    // 4. 新しいタイプをセット
    cell.type = nextType;

    // 5. 新しいペアの生成
    if (nextType === 4) {
      maze.value[f + 1][r][c].type = 5;
    } else if (nextType === 5) {
      maze.value[f - 1][r][c].type = 4;
    }
    // 落とし穴(6)はペアを作らないのでここで終わり
  }
};

const startPlay = () => {
  const hasGoal = maze.value.some(f => f.some(r => r.some(c => c.type === 3)));
  if (!hasGoal) findAndSetFarthestGoal();

  playerPos.value = findStartNode();
  selectionStep.value = 2;
  gameCleared.value = false;
};

const movePlayer = (dr, dc) => {
  if (selectionStep.value !== 2 || gameCleared.value) return;

  const { f, r, c } = playerPos.value;
  const cell = maze.value[f][r][c];
  let nr = r, nc = c;

  if (dr === -1 && r > 0 && !maze.value[f][r - 1][c].bottom) nr--;
  else if (dr === 1 && r < size.value - 1 && !cell.bottom) nr++;
  else if (dc === -1 && c > 0 && !maze.value[f][r][c - 1].right) nc--;
  else if (dc === 1 && c < size.value - 1 && !cell.right) nc++;
  else return;

  playerPos.value = { f, r: nr, c: nc };

  if (maze.value[f][nr][nc].type === 3) {
    gameCleared.value = true;
    showModal.value = true;
  }
};

const useAction = () => {
  if (selectionStep.value !== 2 || gameCleared.value) return;
  const { f, r, c } = playerPos.value;
  const cell = maze.value[f][r][c];
  if (cell.type === 4 && f < floorCount.value - 1) playerPos.value.f++;
  else if (cell.type === 5 && f > 0) playerPos.value.f--;
  else if (cell.type === 6 && f > 0) playerPos.value.f--;
};

const handleKeydown = (e) => {
  if (gameCleared.value) return;
  if (selectionStep.value === 2) {
    if (['ArrowUp', 'w'].includes(e.key)) { e.preventDefault(); movePlayer(-1, 0); }
    if (['ArrowDown', 's'].includes(e.key)) { e.preventDefault(); movePlayer(1, 0); }
    if (['ArrowLeft', 'a'].includes(e.key)) { e.preventDefault(); movePlayer(0, -1); }
    if (['ArrowRight', 'd'].includes(e.key)) { e.preventDefault(); movePlayer(0, 1); }
    if (e.key === 'Enter') { e.preventDefault(); useAction(); }
  }
};

const recalculateDistances = () => {
  const fCount = floorCount.value;
  const s = size.value;
  const dist = Array.from({ length: fCount }, () =>
    Array.from({ length: s }, () => Array(s).fill(-1))
  );
  const queue = [];

  for (let f = 0; f < fCount; f++) {
    for (let r = 0; r < s; r++) {
      for (let c = 0; c < s; c++) {
        if (maze.value[f][r][c].type === 2) {
          dist[f][r][c] = 0;
          queue.push({ f, r, c, d: 0 });
        }
      }
    }
  }

  while (queue.length > 0) {
    const curr = queue.shift();
    const cell = maze.value[curr.f][curr.r][curr.c];
    const moves = [];
    if (curr.c < s - 1 && !cell.right) moves.push({ f: curr.f, r: curr.r, c: curr.c + 1 });
    if (curr.r < s - 1 && !cell.bottom) moves.push({ f: curr.f, r: curr.r + 1, c: curr.c });
    if (curr.c > 0 && !maze.value[curr.f][curr.r][curr.c - 1].right) moves.push({ f: curr.f, r: curr.r, c: curr.c - 1 });
    if (curr.r > 0 && !maze.value[curr.f][curr.r - 1][curr.c].bottom) moves.push({ f: curr.f, r: curr.r - 1, c: curr.c });

    for (const m of moves) {
      if (dist[m.f][m.r][m.c] === -1) {
        dist[m.f][m.r][m.c] = curr.d + 1;
        queue.push({ ...m, d: curr.d + 1 });
      }
    }

    const actionMoves = [];
    if (cell.type === 4 && curr.f < fCount - 1) actionMoves.push({ f: curr.f + 1, r: curr.r, c: curr.c });
    if (cell.type === 5 && curr.f > 0) actionMoves.push({ f: curr.f - 1, r: curr.r, c: curr.c });
    if (cell.type === 6 && curr.f > 0) actionMoves.push({ f: curr.f - 1, r: curr.r, c: curr.c });

    for (const am of actionMoves) {
      if (dist[am.f][am.r][am.c] === -1) {
        dist[am.f][am.r][am.c] = curr.d + 1;
        queue.push({ ...am, d: curr.d + 1 });
      }
    }
  }
  distances.value = dist;
};

const findAndSetFarthestGoal = () => {
  recalculateDistances();
  const fCount = floorCount.value;
  const s = size.value;
  const dist = distances.value;
  let maxDist = -1;
  let farthest = null;

  for (let f = 0; f < fCount; f++) {
    for (let r = 0; r < s; r++) {
      for (let c = 0; c < s; c++) {
        if (maze.value[f][r][c].type === 0 && dist[f][r][c] > maxDist) {
          maxDist = dist[f][r][c];
          farthest = { f, r, c };
        }
      }
    }
  }
  if (farthest) maze.value[farthest.f][farthest.r][farthest.c].type = 3;
};

initMaze();

const updateMazeStructure = () => {
  const newFloorCount = floorCount.value;
  const newSize = size.value;
  const oldMaze = maze.value;
  const newMaze = Array.from({ length: newFloorCount }, (_, f) =>
    Array.from({ length: newSize }, (_, r) =>
      Array.from({ length: newSize }, (_, c) => {
        const existingFloor = oldMaze[f];
        const existingRow = existingFloor ? existingFloor[r] : null;
        const existingCell = existingRow ? existingRow[c] : null;
        return existingCell ? { ...existingCell } : { right: true, bottom: true, type: 0 };
      })
    )
  );
  maze.value = newMaze;
};

watch([size, floorCount], updateMazeStructure);
watch([maze, showDistance], recalculateDistances, { deep: true });

onMounted(() => window.addEventListener('keydown', handleKeydown, { passive: false }));
onUnmounted(() => window.removeEventListener('keydown', handleKeydown));
</script>

<template>
  <div class="container">
    <h1>3D Maze Generator</h1>

    <div class="controls">
      <div class="control-group">
        <label>Size: {{ size }}</label>
        <input type="range" v-model.number="size" min="5" max="12">
      </div>
      <div class="control-group">
        <label>Floors: {{ floorCount }}</label>
        <input type="range" v-model.number="floorCount" min="1" max="5">
      </div>
      <div class="control-group toggle-group">
        <label>Show Distance</label>
        <div class="toggle-switch">
          <input type="checkbox" id="distToggle" v-model="showDistance">
          <label for="distToggle" class="toggle-slider"></label>
        </div>
      </div>
      <button @click="showConfigModal = true" class="config-btn">⚙️ Config</button>

      <div v-if="showConfigModal" class="modal-overlay">
        <div class="modal-content config-modal">
          <h2>Generation Settings</h2>

          <div class="config-section">
            <label>Branch Frequency</label>
            <div class="radio-group-vertical">
              <label><input type="radio" v-model="branchSetting" value="low"> Low</label>
              <label><input type="radio" v-model="branchSetting" value="normal"> Normal</label>
              <label><input type="radio" v-model="branchSetting" value="high"> High</label>
            </div>
          </div>

          <div class="config-section">
            <label>Stair Frequency</label>
            <div class="radio-group-vertical">
              <label><input type="radio" v-model="stairSetting" value="low"> Low</label>
              <label><input type="radio" v-model="stairSetting" value="normal"> Normal</label>
              <label><input type="radio" v-model="stairSetting" value="high"> High</label>
            </div>
          </div>

          <button @click="showConfigModal = false" class="generate-btn close-btn">Apply & Close</button>
        </div>
      </div>
    </div>

    <div class="status">
      <div class="action-container">
        <div v-if="selectionStep === 1" class="button-group">
          <button @click="generateMaze" class="generate-btn" :disabled="!canStart">
            Auto Generate
          </button>
          <button @click="startPlay" class="play-only-btn" :disabled="!canStart">
            Start Game
          </button>
        </div>

        <div v-else class="play-status">
          <div v-if="!gameCleared" class="action-hint">
            <div class="hint-row">
              <span>Use Arrow Keys to move.</span>
              <button @click="selectionStep = 1" class="quit-btn">Quit Game</button>
            </div>
            <span v-if="maze[playerPos.f][playerPos.r][playerPos.c].type === 4" class="stair-hint">
              Press <b>Enter</b> to Go UP! ⬆️
            </span>
            <span v-if="maze[playerPos.f][playerPos.r][playerPos.c].type === 5" class="stair-hint">
              Press <b>Enter</b> to Go DOWN! ⬇️
            </span>
            <span v-if="maze[playerPos.f][playerPos.r][playerPos.c].type === 6" class="stair-hint pit-hint">
              Press <b>Enter</b> to FALL! 🕳️
            </span>
          </div>
          <div v-else class="button-group">
            <button @click="selectionStep = 1" class="edit-btn">Return to Setup</button>
          </div>
        </div>
      </div>
      <div class="util-group">
        <button @click="initMaze" class="reset-btn-action">Reset All</button>
      </div>
    </div>

    <div class="floors-container">
      <div v-for="(floor, f) in maze" :key="f" class="floor-wrapper" :class="{ 'active-floor': playerPos.f === f }">
        <div class="floor-label">Floor {{ f + 1 }} <span v-if="playerPos.f === f && selectionStep === 2">📍</span></div>
        <div class="maze-board" :style="{ '--grid-size': size }">
          <template v-for="(row, r) in floor" :key="r">
            <div v-for="(cell, c) in row" :key="c" class="cell" :class="{
              'wall-right': cell.right && c !== size - 1,
              'wall-bottom': cell.bottom && r !== size - 1,
              'start': cell.type === 2,
              'goal': cell.type === 3,
              'stair-up': cell.type === 4,
              'stair-down': cell.type === 5,
              'pitfall': cell.type === 6,
              'player': selectionStep === 2 && playerPos.f === f && playerPos.r === r && playerPos.c === c
            }" @click="handleCellClick(f, r, c, $event)">
              <span v-if="showDistance" class="dist-label">
                {{ distances[f]?.[r]?.[c] >= 0 ? distances[f][r][c] : '×' }}
              </span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay">
      <div class="modal-content">
        <div class="modal-icon">🏆</div>
        <h2 class="clear-msg">✨ Maze Cleared! ✨</h2>
        <p>Congratulations! You found the way out.</p>
        <button @click="showModal = false" class="generate-btn close-btn">Close</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* (Styles are mostly preserved, adding/updating modal specific styles) */
.container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  background-color: #f0f2f5;
  min-height: 700px;
}

.controls {
  display: flex;
  gap: 30px;
  margin-bottom: 15px;
  background: white;
  padding: 15px 30px;
  border-radius: 12px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  align-items: center;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toggle-group {
  align-items: center;
}

.toggle-switch {
  position: relative;
  width: 50px;
  height: 26px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: #ccc;
  transition: .4s;
  border-radius: 34px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 20px;
  width: 20px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: .4s;
  border-radius: 50%;
}

input:checked+.toggle-slider {
  background-color: #2196F3;
}

input:checked+.toggle-slider:before {
  transform: translateX(24px);
}

.status {
  margin-bottom: 10px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 800px;
  padding: 0 20px;
  box-sizing: border-box;
}

.action-container {
  flex: 1;
  display: flex;
  justify-content: center;
}

.button-group {
  display: flex;
  gap: 10px;
}

button {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: bold;
  transition: all 0.2s;
}

.generate-btn {
  background: #007bff;
  color: #fff;
}

.play-only-btn {
  background: #28a745;
  color: #fff;
}

.play-only-btn:hover {
  background: #218838;
}

.edit-btn {
  background: #6c757d;
  color: #fff;
}

.play-status {
  display: flex;
  align-items: center;
  gap: 20px;
}

.action-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  font-size: 0.9rem;
  color: #555;
}

.stair-hint {
  color: #007bff;
  font-size: 1.1rem;
  margin-top: 4px;
  animation: pulse 1.5s infinite;
}

.util-group {
  margin-left: 20px;
}

.reset-btn-action {
  padding: 8px 16px;
  background: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
  font-size: 0.9rem;
}

.reset-btn-action:hover {
  background: #f1b0b7;
}

.hint-row {
  display: flex;
  align-items: center;
  gap: 15px;
}

.quit-btn {
  background: #ff9800;
  color: white;
}

.quit-btn:hover {
  background: #e68a00;
}

.floors-container {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  justify-content: center;
}

.floor-wrapper {
  background: white;
  padding: 15px;
  border-radius: 12px;
  transition: transform 0.3s;
  border: 2px solid transparent;
}

.active-floor {
  border-color: #007bff;
  transform: scale(1.05);
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1);
}

.floor-label {
  font-weight: bold;
  margin-bottom: 10px;
  color: #555;
  text-align: center;
}

.maze-board {
  display: grid;
  grid-template-columns: repeat(var(--grid-size), 34px);
  grid-template-rows: repeat(var(--grid-size), 34px);
  border: 3px solid #444;
  background-color: #fff;
}

.cell {
  width: 34px;
  height: 34px;
  box-sizing: border-box;
  position: relative;
}

.wall-right {
  border-right: 3px solid #444;
}

.wall-bottom {
  border-bottom: 3px solid #444;
}

.dist-label {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 11px;
  color: #000;
  font-weight: bold;
  background-color: rgba(255, 255, 255, 0.4);
  pointer-events: none;
  z-index: 20;
}

.start {
  background-color: #d1f2eb;
}

.goal {
  background-color: #fadbd8;
}

.stair-up {
  background-color: #fef9e7;
}

.stair-down {
  background-color: #f5eef8;
}

.start::after,
.goal::after,
.stair-up::after,
.stair-down::after {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 12px;
  font-weight: bold;
  z-index: 5;
}

.start::after {
  content: 'S';
  color: #16a085;
}

.goal::after {
  content: 'G';
  color: #e74c3c;
}

.stair-up::after {
  content: '▲';
  color: #f1c40f;
}

.stair-down::after {
  content: '▼';
  color: #9b59b6;
}

.player::before {
  content: '👤';
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 18px;
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.3));
  z-index: 30;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 100;
  backdrop-filter: blur(4px);
}

.modal-content {
  background: white;
  padding: 40px;
  border-radius: 20px;
  text-align: center;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  animation: modalPop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.config-modal {
  text-align: left;
  min-width: 350px;
}

.config-section {
  margin: 20px 0;
}

.config-section label {
  display: block;
  font-weight: bold;
  margin-bottom: 12px;
  font-size: 1rem;
  color: #333;
}

.radio-group-vertical {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.radio-group-vertical label {
  font-weight: normal;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.2s;
}

.radio-group-vertical label:hover {
  background: #f8f9fa;
}

.pitfall {
  background-color: #f0f0f0;
}

.pitfall::after {
  content: '●';
  color: #333;
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 16px;
  z-index: 5;
}

.config-btn {
  background: #6c757d;
  color: white;
  margin-right: 10px;
}

@keyframes pulse {

  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.5;
  }
}

@keyframes modalPop {
  from {
    transform: scale(0.8);
    opacity: 0;
  }

  to {
    transform: scale(1);
    opacity: 1;
  }
}

button:disabled {
  background-color: #ccc !important;
  cursor: not-allowed;
}
</style>
