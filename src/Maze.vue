<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';

const size = ref(5);
const floorCount = ref(1); 
const maze = ref([]);
const distances = ref([]); 
const showDistance = ref(false); 
const selectionStep = ref(1); 
const startPos = ref({ f: 0, r: 0, c: 0 }); 
const playerPos = ref({ f: 0, r: 0, c: 0 });
const gameCleared = ref(false);
const showModal = ref(false);

const initMaze = () => {
  selectionStep.value = 1; 
  gameCleared.value = false;
  showModal.value = false;
  // startPos.value = { f: 0, r: 0, c: 0 }; // ←ここをコメントアウト/削除して現在の位置を保持
  distances.value = []; 
  
  // startPos が範囲外にならないよう、念のためバリデーション（サイズ変更時用）
  if (startPos.value.f >= floorCount.value) startPos.value.f = floorCount.value - 1;
  if (startPos.value.r >= size.value) startPos.value.r = size.value - 1;
  if (startPos.value.c >= size.value) startPos.value.c = size.value - 1;

  maze.value = Array.from({ length: floorCount.value }, (_, f) =>
    Array.from({ length: size.value }, (_, r) =>
      Array.from({ length: size.value }, (_, c) => ({
        right: true,
        bottom: true,
        // startPosの位置にタイプ2(S)を設定するように修正
        type: (f === startPos.value.f && r === startPos.value.r && c === startPos.value.c) ? 2 : 0 
      }))
    )
  );
};

initMaze();
watch([size, floorCount], initMaze);

const handleCellClick = (f, r, c) => {
  if (selectionStep.value === 1) {
    maze.value[startPos.value.f][startPos.value.r][startPos.value.c].type = 0;
    startPos.value = { f, r, c };
    maze.value[f][r][c].type = 2;
  }
};

const generateMaze = () => {
  const s = size.value;
  const fCount = floorCount.value;

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
  const start = startPos.value;
  visited[start.f][start.r][start.c] = true;
  stack.push(start);

  while (stack.length > 0) {
    let index = stack.length - 1;
    if (Math.random() < 0.05) index = Math.floor(Math.random() * stack.length);
    
    const curr = stack[index];
    const neighbors = [];
    const directions = [
      { f: 0, r: -1, c: 0, type: 'plane' },
      { f: 0, r: 1, c: 0, type: 'plane' },
      { f: 0, r: 0, c: -1, type: 'plane' },
      { f: 0, r: 0, c: 1, type: 'plane' },
      { f: 1, r: 0, c: 0, type: 'floor' },
      { f: -1, r: 0, c: 0, type: 'floor' }
    ];

    for (const d of directions) {
      const nf = curr.f + d.f;
      const nr = curr.r + d.r;
      const nc = curr.c + d.c;
      if (nf >= 0 && nf < fCount && nr >= 0 && nr < s && nc >= 0 && nc < s && !visited[nf][nr][nc]) {
        const weight = d.type === 'plane' ? 10 : 1;
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
          if (d.f === 1) { maze.value[curr.f][curr.r][curr.c].type = 4; maze.value[nf][nr][nc].type = 5; } 
          else { maze.value[curr.f][curr.r][curr.c].type = 5; maze.value[nf][nr][nc].type = 4; }
        } else continue;
      }
      visited[nf][nr][nc] = true;
      stack.push({ f: nf, r: nr, c: nc });
    } else stack.splice(index, 1);
  }

  findAndSetFarthestGoal();
  playerPos.value = { ...startPos.value };
  selectionStep.value = 2;
  gameCleared.value = false;
};

const findAndSetFarthestGoal = () => {
  const fCount = floorCount.value;
  const s = size.value;
  const start = startPos.value;
  const dist = Array.from({ length: fCount }, () =>
    Array.from({ length: s }, () => Array(s).fill(-1))
  );

  const queue = [{ f: start.f, r: start.r, c: start.c, d: 0 }];
  dist[start.f][start.r][start.c] = 0;

  while (queue.length > 0) {
    const curr = queue.shift();
    const cell = maze.value[curr.f][curr.r][curr.c];
    const moves = [];
    if (curr.c < s - 1 && !cell.right) moves.push({ f: curr.f, r: curr.r, c: curr.c + 1 });
    if (curr.r < s - 1 && !cell.bottom) moves.push({ f: curr.f, r: curr.r + 1, c: curr.c });
    if (curr.c > 0 && !maze.value[curr.f][curr.r][curr.c - 1].right) moves.push({ f: curr.f, r: curr.r, c: curr.c - 1 });
    if (curr.r > 0 && !maze.value[curr.f][curr.r - 1][curr.c].bottom) moves.push({ f: curr.f, r: curr.r - 1, c: curr.c });
    if (cell.type === 4) moves.push({ f: curr.f + 1, r: curr.r, c: curr.c });
    if (cell.type === 5) moves.push({ f: curr.f - 1, r: curr.r, c: curr.c });

    for (const m of moves) {
      if (dist[m.f][m.r][m.c] === -1) {
        dist[m.f][m.r][m.c] = curr.d + 1;
        queue.push({ ...m, d: curr.d + 1 });
      }
    }
  }

  distances.value = dist;
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

const useStairs = () => {
  if (selectionStep.value !== 2 || gameCleared.value) return;
  const { f, r, c } = playerPos.value;
  const cell = maze.value[f][r][c];
  if (cell.type === 4) playerPos.value.f++;
  else if (cell.type === 5) playerPos.value.f--;
};

const handleKeydown = (e) => {
  if (gameCleared.value) return;
  if (selectionStep.value === 2) {
    if (['ArrowUp', 'w'].includes(e.key)) { e.preventDefault(); movePlayer(-1, 0); }
    if (['ArrowDown', 's'].includes(e.key)) { e.preventDefault(); movePlayer(1, 0); }
    if (['ArrowLeft', 'a'].includes(e.key)) { e.preventDefault(); movePlayer(0, -1); }
    if (['ArrowRight', 'd'].includes(e.key)) { e.preventDefault(); movePlayer(0, 1); }
    if (e.key === 'Enter') { e.preventDefault(); useStairs(); }
  }
};

onMounted(() => window.addEventListener('keydown', handleKeydown, { passive: false }));
onUnmounted(() => window.removeEventListener('keydown', handleKeydown));
</script>

<template>
  <div class="container">
    <h1>3D Maze Generator</h1>
    
    <div class="controls">
      <div class="control-group">
        <label>Size: {{ size }}</label>
        <input type="range" v-model.number="size" min="5" max="12" :disabled="selectionStep === 2">
      </div>
      <div class="control-group">
        <label>Floors: {{ floorCount }}</label>
        <input type="range" v-model.number="floorCount" min="1" max="5" :disabled="selectionStep === 2">
      </div>
      
      <div class="control-group toggle-group">
        <label>Show Distance</label>
        <div class="toggle-switch">
          <input type="checkbox" id="distToggle" v-model="showDistance">
          <label for="distToggle" class="toggle-slider"></label>
        </div>
      </div>
    </div>

    <div class="status">
      <div v-if="selectionStep === 1" class="button-group">
        <button @click="generateMaze" class="generate-btn">Generate & Play!</button>
      </div>
      <div v-else class="play-status">
        <div v-if="!gameCleared" class="action-hint">
          <span>Use Arrow Keys to move.</span>
          <span v-if="maze[playerPos.f][playerPos.r][playerPos.c].type === 4" class="stair-hint">Press <b>Enter</b> to Go UP! ⬆️</span>
          <span v-if="maze[playerPos.f][playerPos.r][playerPos.c].type === 5" class="stair-hint">Press <b>Enter</b> to Go DOWN! ⬇️</span>
        </div>
        <button @click="initMaze" class="reset-btn-action">New Game</button>
      </div>
    </div>

    <div class="floors-container">
      <div v-for="(floor, f) in maze" :key="f" class="floor-wrapper" :class="{ 'active-floor': playerPos.f === f }">
        <div class="floor-label">Floor {{ f + 1 }} <span v-if="playerPos.f === f && selectionStep === 2">📍</span></div>
        <div class="maze-board" :style="{ '--grid-size': size }">
          <template v-for="(row, r) in floor" :key="r">
            <div 
              v-for="(cell, c) in row" 
              :key="c" 
              class="cell"
              :class="{ 
                'wall-right': cell.right && c !== size - 1, 
                'wall-bottom': cell.bottom && r !== size - 1,
                'start': cell.type === 2,
                'goal': cell.type === 3,
                'stair-up': cell.type === 4,
                'stair-down': cell.type === 5,
                'player': selectionStep === 2 && playerPos.f === f && playerPos.r === r && playerPos.c === c
              }"
              @click="handleCellClick(f, r, c)"
            >
              <span v-if="showDistance && distances[f]?.[r]?.[c] >= 0" class="dist-label">
                {{ distances[f][r][c] }}
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
  <div class="footer-note" style="margin-top: 28px; font-size: 0.7em; text-align: center;">
    ※
    <a href="https://3892myamya.github.io/introduction/" target="_blank" rel="noopener noreferrer">
      3892myamya tools
    </a>
    developed by
    <a href="https://twitter.com/3892myamya/" target="_blank" rel="noopener noreferrer">
      @3892myamya
    </a>
  </div>
</template>

<style scoped>
.container { display: flex; flex-direction: column; align-items: center; padding: 20px; font-family: 'Segoe UI', sans-serif; background-color: #f0f2f5; min-height: 700px; position: relative;}
.controls { display: flex; gap: 30px; margin-bottom: 15px; background: white; padding: 15px 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); align-items: center;}
.control-group { display: flex; flex-direction: column; gap: 8px; }

/* トグルスイッチのスタイル */
.toggle-group { align-items: center; }
.toggle-switch { position: relative; width: 50px; height: 26px; }
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.toggle-slider {
  position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
  background-color: #ccc; transition: .4s; border-radius: 34px;
}
.toggle-slider:before {
  position: absolute; content: ""; height: 20px; width: 20px; left: 3px; bottom: 3px;
  background-color: white; transition: .4s; border-radius: 50%;
}
input:checked + .toggle-slider { background-color: #2196F3; }
input:checked + .toggle-slider:before { transform: translateX(24px); }

.status { margin-bottom: 10px; height: 80px; display: flex; align-items: center; justify-content: center; width: 100%; gap: 15px;}
.play-status { display: flex; align-items: center; gap: 20px; font-weight: bold; }
.action-hint { display: flex; flex-direction: column; align-items: center; font-size: 0.9rem; color: #555; }
.stair-hint { color: #007bff; font-size: 1.1rem; margin-top: 4px; animation: pulse 1.5s infinite; }

.floors-container { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; }
.floor-wrapper { background: white; padding: 15px; border-radius: 12px; transition: transform 0.3s; border: 2px solid transparent; }
.active-floor { border-color: #007bff; transform: scale(1.05); box-shadow: 0 10px 20px rgba(0,0,0,0.1); }
.floor-label { font-weight: bold; margin-bottom: 10px; color: #555; text-align: center; }
.maze-board { display: grid; grid-template-columns: repeat(var(--grid-size), 34px); grid-template-rows: repeat(var(--grid-size), 34px); border: 3px solid #444; background-color: #fff; }
.cell { width: 34px; height: 34px; box-sizing: border-box; position: relative; }
.wall-right { border-right: 3px solid #444; }
.wall-bottom { border-bottom: 3px solid #444; }

.dist-label { 
  position: absolute; inset: 0; display: flex; justify-content: center; 
  align-items: center; font-size: 11px; color: #000; font-weight: bold; 
  background-color: rgba(255, 255, 255, 0.4);
  pointer-events: none; z-index: 20; 
}

.start { background-color: #d1f2eb; }
.start::after { content: 'S'; color: #16a085; position: absolute; inset: 0; display: flex; justify-content: center; align-items: center; font-size: 12px; font-weight: bold; z-index: 5;}
.goal { background-color: #fadbd8; }
.goal::after { content: 'G'; color: #e74c3c; position: absolute; inset: 0; display: flex; justify-content: center; align-items: center; font-size: 12px; font-weight: bold; z-index: 5;}
.stair-up { background-color: #fef9e7; }
.stair-up::after { content: '▲'; color: #f1c40f; font-size: 12px; position: absolute; inset: 0; display: flex; justify-content: center; align-items: center; z-index: 5;}
.stair-down { background-color: #f5eef8; }
.stair-down::after { content: '▼'; color: #9b59b6; font-size: 12px; position: absolute; inset: 0; display: flex; justify-content: center; align-items: center; z-index: 5;}
.player::before { content: '👤'; position: absolute; inset: 0; display: flex; justify-content: center; align-items: center; font-size: 18px; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.3)); z-index: 30; }

.modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.7); display: flex; justify-content: center; align-items: center; z-index: 100; backdrop-filter: blur(4px); }
.modal-content { background: white; padding: 40px; border-radius: 20px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); animation: modalPop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
.generate-btn { padding: 10px 20px; background: #007bff; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; }
.reset-btn-action { padding: 10px 20px; background: #6c757d; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
@keyframes modalPop { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
</style>