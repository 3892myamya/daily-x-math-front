<script setup>
import { computed, nextTick, ref } from 'vue'
import { allQuestions, characters } from './bcvqData.js'

const faceModules = import.meta.glob('./assets/bcvq/faces/*.png', {
  eager: true,
  import: 'default',
})
const faces = Object.fromEntries(
  Object.entries(faceModules).map(([path, url]) => [path.split('/').pop().replace('.png', ''), url]),
)
const characterImages = Object.fromEntries(characters.map((character) => [character.name, faces[character.image]]))
const randomImage = faces.penancier

const step = ref('start')
const current = ref(0)
const score = ref(0)
const resultMark = ref(null)
const markPosition = ref(null)
const questions = ref([])
const answers = ref([])
const candidates = ref(characters)
const panelQuestion = ref(null)
const choices = ref([])
const answered = ref(false)
const selectedChoice = ref(null)
const panelSelected = ref([])
const panelState = ref('playing')
const cleared = ref(false)
const revealed = ref([])

const imageFor = (name) => characterImages[name]
const shuffle = (items) => {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function generateChoices(correct) {
  const correctVoices = allQuestions.filter((q) => q.name === correct).map((q) => q.voice)
  const duplicateNames = new Set(
    allQuestions.filter((q) => q.name !== correct && correctVoices.includes(q.voice)).map((q) => q.name),
  )
  const available = characters.map((c) => c.name).filter((name) => name !== correct && !duplicateNames.has(name))
  return shuffle([correct, ...shuffle(available).slice(0, 7)])
}

function makePanelQuestion(name) {
  const correctVoices = allQuestions.filter((q) => q.name === name).map((q) => q.voice)
  const wrong = shuffle(
    allQuestions.filter((q) => q.name !== name && !correctVoices.includes(q.voice)).map((q) => q.voice),
  ).slice(0, Math.max(0, 16 - correctVoices.length))
  return { character: name, correctVoices, choices: shuffle([...correctVoices, ...wrong]) }
}

function startQuiz() {
  const grouped = new Map()
  for (const question of allQuestions) {
    if (!grouped.has(question.name)) grouped.set(question.name, [])
    grouped.get(question.name).push(question)
  }
  questions.value = shuffle([...grouped.values()].map((group) => group[Math.floor(Math.random() * group.length)])).slice(0, 10)
  current.value = 0
  score.value = 0
  answers.value = []
  prepareQuestion()
  step.value = 'quiz'
}

function prepareQuestion() {
  answered.value = false
  selectedChoice.value = null
  resultMark.value = null
  markPosition.value = null
  choices.value = questions.value[current.value] ? generateChoices(questions.value[current.value].name) : []
}

function startPanel() {
  candidates.value = characters
  step.value = 'characterSelect'
}

function startBirthday() {
  const today = new Date()
  const todayText = `${today.getMonth() + 1}月${today.getDate()}日`
  const birthdayCharacters = characters.filter((character) => character.birthday === todayText)
  if (!birthdayCharacters.length) {
    window.alert(`${todayText}が誕生日の生徒はいません`)
  } else if (birthdayCharacters.length === 1) {
    selectCharacter(birthdayCharacters[0].name)
  } else {
    candidates.value = birthdayCharacters
    step.value = 'characterSelect'
  }
}

function selectCharacter(name) {
  panelQuestion.value = makePanelQuestion(name)
  score.value = 0
  panelSelected.value = []
  panelState.value = 'playing'
  cleared.value = false
  revealed.value = []
  step.value = 'panelQuiz'
}

function randomCharacter() {
  selectCharacter(candidates.value[Math.floor(Math.random() * candidates.value.length)].name)
}

function setMark(event, correct) {
  const rect = event.currentTarget.getBoundingClientRect()
  markPosition.value = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  resultMark.value = correct ? 'correct' : 'wrong'
}

function answerNormal(choice, event) {
  if (answered.value) return
  answered.value = true
  selectedChoice.value = choice
  const question = questions.value[current.value]
  const isCorrect = choice === question.name
  setMark(event, isCorrect)
  if (isCorrect) score.value += 1
  answers.value.push({ question: question.voice, selected: choice, correct: question.name, isCorrect })
  window.setTimeout(() => {
    resultMark.value = null
    if (current.value + 1 < questions.value.length) {
      current.value += 1
      prepareQuestion()
    } else {
      step.value = 'result'
    }
  }, 800)
}

function answerPanel(voice, event) {
  if (panelState.value === 'finished') {
    revealed.value = revealed.value.includes(voice)
      ? revealed.value.filter((item) => item !== voice)
      : [...revealed.value, voice]
    return
  }
  if (panelSelected.value.includes(voice)) return
  const isCorrect = panelQuestion.value.correctVoices.includes(voice)
  setMark(event, isCorrect)
  panelSelected.value.push(voice)
  if (isCorrect) {
    score.value += 1
    if (score.value === panelQuestion.value.correctVoices.length) {
      panelState.value = 'finished'
      cleared.value = true
    }
  } else {
    panelState.value = 'finished'
    cleared.value = false
  }
  window.setTimeout(() => { resultMark.value = null }, 800)
}

const panelStatus = computed(() => {
  if (panelState.value === 'playing') return '挑戦中…'
  return cleared.value ? '🎉全問正解！' : '❌終了…'
})
const normalShareText = computed(() => `ブルアカカフェボイスクイズで ${score.value}/10 問正解しました！ #ブルアカカフェボイスクイズ https://bluaca-quiz.3892myamya.com/`)
const panelShareText = computed(() => panelQuestion.value
  ? `${panelQuestion.value.character}のカフェボイスを ${score.value} / ${panelQuestion.value.correctVoices.length} 正解しました！ #ブルアカカフェボイスクイズ https://bluaca-quiz.3892myamya.com/`
  : '')
const voiceCharacter = (voice) => allQuestions.find((question) => question.voice === voice)?.name
const shareToX = (text) => window.open(`https://twitter.com/intent/tweet?${new URLSearchParams({ text })}`, '_blank', 'noopener,noreferrer')
const restart = async () => {
  step.value = 'start'
  resultMark.value = null
  await nextTick()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
</script>

<template>
  <main class="container">
    <section v-if="step === 'start'" class="startContainer">
      <h1 class="title">ブルアカカフェボイスクイズ</h1>
      <div class="modeGrid">
        <article class="modeCard"><h2>ノーマル</h2><p>誰のカフェボイスかを当ててください。問題は10問出題されます。</p><button class="primaryButton" @click="startQuiz">はじめる</button></article>
        <article class="modeCard"><h2>生徒</h2><p>選んだ生徒のカフェボイスをすべて当ててください。</p><button class="primaryButton" @click="startPanel">はじめる</button></article>
        <article class="modeCard"><h2>バースデー生徒</h2><p>今日が誕生日の生徒のカフェボイスをすべて当ててください。</p><button class="primaryButton" @click="startBirthday">はじめる</button></article>
      </div>
      <footer class="footer">
        <p>※本サイトはブルーアーカイブの非公式ファンサイトです。Nexon、Nexon GamesおよびYostarとは無関係です。</p>
        <p>※本サイトの情報は個人の調査・検証に基づくものであり、正確性を保証するものではありません。</p>
        <p>※サイトの利用は自己責任でお願いします。また、サイト内の画像の権利は各権利者に帰属します。</p>
        <p>※お問い合わせ・不具合の報告は<a href="https://x.com/3892myamya" target="_blank" rel="noopener noreferrer">@3892myamya</a>まで。</p>
      </footer>
    </section>

    <section v-else-if="step === 'characterSelect'" class="card">
      <h2>生徒を選んでください</h2>
      <div class="characterGrid">
        <button v-if="candidates.length === characters.length" class="choiceButton" @click="randomCharacter"><img :src="randomImage" alt="" class="choiceImage"><span>（ランダム）</span></button>
        <button v-for="character in candidates" :key="character.name" class="choiceButton" @click="selectCharacter(character.name)"><img :src="imageFor(character.name)" :alt="character.name" class="choiceImage"><span>{{ character.name }}</span></button>
      </div>
      <button class="secondaryButton" @click="restart">最初に戻る</button>
    </section>

    <section v-else-if="step === 'quiz' && questions[current]" class="card">
      <h2>問題{{ current + 1 }}</h2><p>{{ questions[current].voice }}</p>
      <div class="choicesContainer">
        <button v-for="choice in choices" :key="choice" class="choiceButton" :class="{ correctChoice: answered && choice === questions[current].name, wrongChoice: answered && choice === selectedChoice && choice !== questions[current].name }" @click="answerNormal(choice, $event)"><img :src="imageFor(choice)" :alt="choice" class="choiceImage"><span>{{ choice }}</span></button>
      </div>
      <button class="secondaryButton" @click="restart">最初に戻る</button>
    </section>

    <section v-else-if="step === 'panelQuiz' && panelQuestion" class="card">
      <h2>{{ panelQuestion.character }}のカフェボイスはどれ？</h2>
      <img :src="imageFor(panelQuestion.character)" :alt="panelQuestion.character" class="choiceImage">
      <p>{{ panelStatus }}正解数：{{ score }} / {{ panelQuestion.correctVoices.length }}</p>
      <div class="grid16">
        <button v-for="voice in panelQuestion.choices" :key="voice" class="panelButton" :class="{ panelCorrect: panelSelected.includes(voice) && panelQuestion.correctVoices.includes(voice), panelRevealCorrect: panelState === 'finished' && !panelSelected.includes(voice) && panelQuestion.correctVoices.includes(voice), panelWrong: panelState === 'finished' && panelSelected.includes(voice) && !panelQuestion.correctVoices.includes(voice) }" @click="answerPanel(voice, $event)">
          <template v-if="panelState === 'finished' && revealed.includes(voice)"><img :src="imageFor(voiceCharacter(voice))" :alt="voiceCharacter(voice)" class="choiceImage"><span>{{ voiceCharacter(voice) }}</span></template><span v-else>{{ voice }}</span>
        </button>
      </div>
      <div class="buttonGroup"><button class="secondaryButton" @click="restart">最初に戻る</button><button v-if="panelState === 'finished'" class="shareButton" @click="shareToX(panelShareText)">𝕏で共有</button></div>
    </section>

    <section v-else-if="step === 'result'" class="center">
      <h2>結果</h2><p>{{ score }} / 10 問正解！</p>
      <table class="resultTable"><thead><tr><th>ボイス</th><th>正解</th><th>回答</th><th>正誤</th></tr></thead><tbody><tr v-for="(answer, index) in answers" :key="index"><td>{{ index + 1 }}. {{ answer.question }}</td><td><img :src="imageFor(answer.correct)" :alt="answer.correct" :title="answer.correct" class="resultImage"></td><td><img :src="imageFor(answer.selected)" :alt="answer.selected" :title="answer.selected" class="resultImage"></td><td :class="answer.isCorrect ? 'correct' : 'wrong'">{{ answer.isCorrect ? '○' : '×' }}</td></tr></tbody></table>
      <div class="buttonGroup"><button class="secondaryButton" @click="restart">最初に戻る</button><button class="shareButton" @click="shareToX(normalShareText)">𝕏で共有</button></div>
    </section>

    <div v-if="resultMark && markPosition" class="overlay" :class="resultMark" :style="{ left: `${markPosition.x}px`, top: `${markPosition.y}px` }">{{ resultMark === 'correct' ? '○' : '×' }}</div>
  </main>
</template>
