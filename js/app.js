/* ============================================ */
/*         NCE Learning Site - App Logic        */
/* ============================================ */

// ─── State ───────────────────────────────────
const state = {
  book: null,
  lessons: [],
  currentLesson: null,
  currentSentence: 0,
  audio: null,
  isPlaying: false,
  progress: {},
  showChinese: true,
  notesOpen: false,
  loaded: false,
};

const DATA_PATH = '/data/book1.json';
const XP_PER_LESSON = 10;

// ─── Init ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadProgress();
  initPage();
});

function loadProgress() {
  try {
    const saved = localStorage.getItem('nce_progress');
    state.progress = saved ? JSON.parse(saved) : {};
  } catch { state.progress = {}; }
}

function saveProgress() {
  try { localStorage.setItem('nce_progress', JSON.stringify(state.progress)); } catch {}
}

function getCompletion(lessonNum) {
  return state.progress[lessonNum] || 0;
}

function markComplete(lessonNum) {
  state.progress[lessonNum] = 1;
  saveProgress();
}

function getBookStats() {
  const done = state.lessons.filter(l => getCompletion(l.lesson_num) === 1).length;
  return { total: state.lessons.length, done };
}

// ─── Router ──────────────────────────────────
function initPage() {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);

  if (path.startsWith('/study')) {
    const id = params.get('id');
    if (id) { loadStudyPage(id); return; }
  }
  loadHomePage();
}

// ─── Toast ────────────────────────────────────
function showToast(msg, emoji) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = (emoji || '') + ' ' + msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ─── Load Data ───────────────────────────────
async function loadData() {
  if (state.book) return state.book;
  try {
    const resp = await fetch(DATA_PATH);
    state.book = await resp.json();
    state.lessons = state.book.lessons
      .filter(l => l.lesson_num)
      .sort((a, b) => {
        const aNum = parseInt(a.lesson_num.split('-')[0]);
        const bNum = parseInt(b.lesson_num.split('-')[0]);
        return aNum - bNum;
      });
    return state.book;
  } catch (e) {
    console.error('Failed to load data:', e);
    return null;
  }
}

function getLessonByNum(num) {
  return state.lessons.find(l => l.lesson_num === num);
}

// ─── Sentence Parsing ───────────────────────
function parseSentences(lesson) {
  const sec = lesson.sections || {};
  let enText = sec.text_en || lesson.eng_title || '';
  let cnText = sec.text_cn || lesson.chinese || '';

  // Protect abbreviations (Mr., Mrs., Ms., Dr., etc.) before splitting
  const protectAbbr = (t) => t
    .replace(/\b(Mr|Mrs|Ms|Dr|St|Rd|Ave|Prof|Capt|Lt|Col|Sgt|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\./g, '$1<DOT>')
    .replace(/\b(MRS|MR|MRS|DR|ST|RD)\./g, '$1<DOT>');
  const restoreAbbr = (t) => t.replace(/<DOT>/g, '.');

  // Also protect ... and ellipsis
  enText = enText.replace(/\.\.\./g, '<ELLIPSIS>');
  enText = protectAbbr(enText);

  // Split English text by sentence endings
  let sentences = enText.split(/(?<=[.!?])\s*/).filter(s => s.trim().length > 0).map(s => restoreAbbr(s.trim()));
  sentences = sentences.map(s => s.replace(/<ELLIPSIS>/g, '...'));

  // Split Chinese text by sentence endings
  const cnSentences = cnText.split(/(?<=[。！？])/).filter(s => s.trim().length > 0).map(s => s.trim());

  // Pair them up: each English sentence gets a Chinese translation
  const result = sentences.map((en, i) => ({
    english: en,
    chinese: cnSentences[i] || (i === 0 ? cnText : ''),
  }));

  // Fallback: if only 1 English sentence but Chinese has many, pair word-by-word
  if (result.length === 1 && cnSentences.length > 1) {
    return result;
  }
  return result;
}

// ─── Vocabulary Parsing ─────────────────────
function parseVocab(lesson) {
  const sec = lesson.sections || {};
  const rawVocab = sec.vocab;
  if (!rawVocab || !rawVocab[0]) return [];

  const text = rawVocab[0];
  // Split on word-boundary where a word starts with POS tag (matching original Next.js logic)
  const items = text.split(/\s+(?=[a-zA-Z-]+\s+(?:v\.|adj\.|adv\.|prep\.|conj\.|pron\.|n\.|int\.|num\.|art\.|det\.))/);
  
  return items.map(item => {
    const m = item.match(/^([a-zA-Z-]+)\s+(.+)/);
    if (m) {
      // Clean up the definition
      let def = m[2].trim();
      // If def starts with "possessive" or "auxiliary", keep as-is
      return { word: m[1], def: def };
    }
    // Fallback: first space-split takes word, rest is def
    const parts = item.split(/\s+/);
    return { word: parts[0] || item, def: parts.slice(1).join(' ') || '' };
  }).filter(v => v.word && v.def);
}

function parseSupplementaryVocab(lesson) {
  const sec = lesson.sections || {};
  const raw = sec.vocab2;
  if (!raw || !Array.isArray(raw)) return [];
  
  return raw.map(item => {
    const m = item.match(/^([a-zA-Z-]+)\s+(.+)/);
    if (m) return { word: m[1], def: m[2].trim() };
    return { word: item, def: '' };
  });
}

function parseNotes(lesson) {
  const sec = lesson.sections || {};
  return sec.notes || '';
}

// ─── Homepage ─────────────────────────────
async function loadHomePage() {
  const data = await loadData();
  if (!data) {
    document.getElementById('app').innerHTML = '<p class="text-center text-muted mt-4">数据加载失败</p>';
    return;
  }

  const stats = getBookStats();
  let totalWords = 0;
  state.lessons.forEach(l => {
    if (l.sections && l.sections.vocab && l.sections.vocab[0]) {
      totalWords += l.sections.vocab[0].split(/\s+(?=\S+)/).length;
    }
  });

  const app = document.getElementById('app');
  app.innerHTML = `
    <section class="hero fade-in">
      <h1><span class="en">New Concept English</span><br><span class="cn">新概念英语 · 逐句精学</span></h1>
      <p>点击句子逐句精学 · 单词自动筛选 · 学习进度跟踪</p>
    </section>
    <div class="stats-bar fade-in">
      <div class="stat-card">
        <span class="num">${stats.done}</span>
        <span class="label">已完成 / ${stats.total} 课</span>
      </div>
      <div class="stat-card">
        <span class="num">${totalWords}</span>
        <span class="label">词汇量</span>
      </div>
      <div class="stat-card">
        <span class="num">${stats.total > 0 ? Math.round(stats.done / stats.total * 100) : 0}%</span>
        <span class="label">总进度</span>
      </div>
    </div>
    <h2 style="font-size:1.1rem; margin-bottom:12px;">选择册别</h2>
    <div class="book-grid">
      <div class="book-card" onclick="window.location.href='/study?id=${state.lessons[0]?.lesson_num}'">
        <div class="book-icon">📗</div>
        <h3>第一册</h3>
        <div class="book-sub">First Things First · 72课</div>
        <div class="progress-mini">
          <div class="bar ${stats.done === stats.total ? 'done' : ''}" style="width:${stats.total > 0 ? (stats.done/stats.total*100) : 0}%"></div>
        </div>
        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:6px;">${stats.done}/${stats.total} 课已完成</div>
      </div>
      ${[2,3,4].map(n => {
        const names = ['第二册','第三册','第四册'];
        const ens = ['Practice & Progress','Developing Skills','Fluency in English'];
        const emojis = ['📘','📙','📕'];
        return `<div class="book-card coming">
          <div class="book-icon">${emojis[n-2]}</div>
          <h3>${names[n-2]}</h3>
          <div class="book-sub">${ens[n-2]} · ${[96,60,48][n-2]}课</div>
          <div class="lock">🔒</div>
          <div class="book-sub" style="color:var(--text-muted); margin-top:4px;">即将推出</div>
        </div>`;
      }).join('')}
    </div>
    <h2 style="font-size:1.1rem; margin: 24px 0 12px;">第一册课程列表</h2>
    <div class="lesson-grid">
      ${state.lessons.map(l => {
        const done = getCompletion(l.lesson_num) === 1;
        let titleCn = l.eng_title ? l.eng_title.replace(/^[A-Za-z0-9\s\-\',.!?]+/, '').trim() : '';
        let titleEn = l.eng_title ? l.eng_title.replace(titleCn, '').trim() : l.title || '';
        return `<div class="lesson-item" onclick="window.location.href='/study?id=${l.lesson_num}'">
          <span class="num">${l.lesson_num}</span>
          <div class="title">
            <span class="en">${titleEn || l.eng_title || ''}</span>
            <span class="cn">${titleCn || ''}</span>
          </div>
          <span class="status ${done ? 'done' : 'pending'}">${done ? '✅ 已完成' : '未学习'}</span>
        </div>`;
      }).join('')}
    </div>
  `;
}

// ─── Study Page ──────────────────────────────
async function loadStudyPage(lessonNum) {
  const data = await loadData();
  if (!data) return;

  const lesson = getLessonByNum(lessonNum);
  if (!lesson) {
    document.getElementById('app').innerHTML = '<p class="text-center text-muted mt-4">课程未找到</p>';
    return;
  }

  state.currentLesson = lesson;
  state.currentSentence = 0;
  state.isPlaying = false;
  state.notesOpen = false;
  state.showChinese = true;
  state.loaded = false;

  const sentences = parseSentences(lesson);
  const allVocab = parseVocab(lesson);
  const extraVocab = parseSupplementaryVocab(lesson);
  const notesHtml = parseNotes(lesson);

  lesson._sentences = sentences;
  lesson._vocab = allVocab;
  lesson._extraVocab = extraVocab;

  const done = getCompletion(lesson.lesson_num) === 1;
  const displayTitle = lesson.eng_title || lesson.title || '';

  const app = document.getElementById('app');
  app.innerHTML = `
    <!-- Top Bar -->
    <div class="study-topbar">
      <a href="/" class="back">← 返回</a>
      <div class="title-area">
        <div class="lesson-num">第 ${lesson.lesson_num} 课</div>
        <div class="lesson-title">${displayTitle}</div>
      </div>
      <div class="lesson-nav">
        <button class="prev-next" id="prevLessonBtn">← 上一课</button>
        <button class="prev-next" id="nextLessonBtn">下一课 →</button>
      </div>
      <button class="done-btn ${done ? 'done' : ''}" id="completeBtn">
        ${done ? '✅ 已完成' : `⭐ 完成 <span class="xp">+${XP_PER_LESSON}XP</span>`}
      </button>
    </div>

    <!-- Audio Player -->
    <div class="audio-bar">
      <button class="play-btn" id="playBtn" aria-label="播放">▶</button>
      <div class="progress-wrap">
        <span class="time" id="currentTime">0:00</span>
        <div class="progress-track" id="progressTrack">
          <div class="fill" id="progressFill" style="width:0%"></div>
        </div>
        <span class="time" id="totalTime">0:00</span>
      </div>
      <a class="download-link" href="${lesson.audio_url || '#'}" target="_blank" download>⬇ 下载</a>
    </div>

    <!-- Main Two-Column Layout -->
    <div class="study-main">
      <div class="study-left" id="sentencePanel">
        <div class="sentence-list" id="sentenceList">
          ${sentences.map((s, i) => `
            <div class="sentence-item" data-index="${i}" id="sent-${i}">
              <span class="idx">
                <span class="num">${i + 1}</span>
                <span class="play-arrow">▶</span>
              </span>
              <span class="text">${s.english}</span>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="study-right" id="infoPanel">
        <!-- Chinese -->
        <div class="right-section">
          <div class="section-title"><span class="icon">🌐</span> 中文翻译</div>
          <div class="chinese-block" id="chineseBlock">
            ${sentences.map(s => s.chinese).filter(Boolean).join(' ')}
          </div>
        </div>
        <!-- Current Sentence Words -->
        <div class="right-section" id="currentVocabSection">
          <div class="section-title"><span class="icon">📝</span> 本句单词</div>
          <div class="word-grid" id="currentVocab">
            <span class="text-muted" style="font-size:0.85rem;">点击句子查看</span>
          </div>
        </div>
        <!-- Supplementary Vocabulary -->
        ${extraVocab.length > 0 ? `
        <div class="right-section">
          <div class="section-title"><span class="icon">📚</span> 补充词汇</div>
          <div class="word-grid" id="extraVocab">
            ${extraVocab.map(v => `
              <div class="word-item">
                <div class="en">${v.word}</div>
                <div class="cn">${v.def}</div>
              </div>
            `).join('')}
          </div>
        </div>` : ''}
        <!-- Notes -->
        ${notesHtml ? `
        <div class="right-section">
          <div class="section-title"><span class="icon">📖</span> 课文详注</div>
          <button class="notes-toggle" id="notesToggle">展开查看 ▸</button>
          <div class="notes-content" id="notesContent">${formatNotes(notesHtml)}</div>
        </div>` : ''}
      </div>
    </div>

    <!-- Bottom Bar -->
    <div class="study-bottombar">
      <div class="nav-buttons">
        <button class="prev-next" id="prevSentenceBtn">↑ 上一句</button>
        <button class="prev-next" id="nextSentenceBtn">↓ 下一句</button>
      </div>
      <div class="action-buttons">
        <label class="cn-toggle">
          <input type="checkbox" id="cnToggle" checked>
          <span>中文</span>
        </label>
        <button class="complete-btn ${done ? 'done' : ''}" id="completeBtn2">
          ${done ? '✅ 已完成' : `⭐ 完成 <span class="xp">+${XP_PER_LESSON}XP</span>`}
        </button>
      </div>
    </div>
  `;

  // Init audio
  initAudio(lesson);
  // Bind events
  bindStudyEvents(lesson, sentences);
  // Select first sentence to show its vocab
  selectSentence(0, sentences, lesson);
  state.loaded = true;
}

function formatNotes(html) {
  // Convert plain text with numbered items to HTML
  const lines = html.split('\n').map(l => l.trim()).filter(Boolean);
  return lines.map(line => {
    if (/^\d+[.．]/.test(line)) {
      return `<p class="note-title">${line}</p>`;
    }
    return `<p class="note-line">${line}</p>`;
  }).join('');
}

// ─── Audio ──────────────────────────────────
function initAudio(lesson) {
  if (state.audio) {
    state.audio.pause();
    state.audio.src = '';
  }
  const url = lesson.audio_url;
  if (!url) return;

  state.audio = new Audio(url);
  state.audio.preload = 'metadata';

  state.audio.addEventListener('loadedmetadata', () => {
    const el = document.getElementById('totalTime');
    if (el) el.textContent = formatTime(state.audio.duration);
  });
  state.audio.addEventListener('timeupdate', () => {
    if (!state.audio || !state.audio.duration) return;
    const pct = (state.audio.currentTime / state.audio.duration) * 100;
    const fill = document.getElementById('progressFill');
    const cur = document.getElementById('currentTime');
    if (fill) fill.style.width = pct + '%';
    if (cur) cur.textContent = formatTime(state.audio.currentTime);
  });
  state.audio.addEventListener('ended', () => {
    state.isPlaying = false;
    updatePlayBtn();
  });
  state.audio.addEventListener('error', () => {
    const btn = document.getElementById('playBtn');
    if (btn) btn.textContent = '⚠';
  });
}

function togglePlay() {
  if (!state.audio) return;
  if (state.isPlaying) {
    state.audio.pause();
    state.isPlaying = false;
  } else {
    state.audio.play().catch(() => {});
    state.isPlaying = true;
  }
  updatePlayBtn();
}

function updatePlayBtn() {
  const btn = document.getElementById('playBtn');
  if (!btn) return;
  btn.textContent = state.isPlaying ? '⏸' : '▶';
  btn.classList.toggle('playing', state.isPlaying);
}

function formatTime(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Sentence Selection ─────────────────────
function selectSentence(index, sentences, lesson) {
  if (!sentences || index < 0 || index >= sentences.length) return;
  state.currentSentence = index;

  // Update highlights
  document.querySelectorAll('.sentence-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.index) === index);
  });

  // Scroll into view
  const activeEl = document.getElementById(`sent-${index}`);
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  // Update vocab
  updateCurrentVocab(index, sentences, lesson);

  // Update buttons
  const prevBtn = document.getElementById('prevSentenceBtn');
  const nextBtn = document.getElementById('nextSentenceBtn');
  if (prevBtn) prevBtn.style.opacity = index === 0 ? '0.4' : '1';
  if (nextBtn) nextBtn.style.opacity = index >= sentences.length - 1 ? '0.4' : '1';
}

function updateCurrentVocab(index, sentences, lesson) {
  const currentSentence = sentences[index];
  if (!currentSentence) return;

  const allVocab = lesson._vocab || [];
  const enText = currentSentence.english.toLowerCase();

  // Find words that appear in the current sentence
  const relevant = allVocab.filter(v => {
    const word = v.word.toLowerCase().replace(/[^a-z]/g, '');
    return enText.includes(word);
  });

  const container = document.getElementById('currentVocab');
  if (!container) return;

  if (relevant.length === 0) {
    container.innerHTML = '<span class="text-muted" style="font-size:0.85rem;">本句无生词</span>';
    return;
  }
  container.innerHTML = relevant.map(v => `
    <div class="word-item fade-in">
      <div class="en">${v.word} <span class="pos">${v.def.includes('.') ? v.def.split(' ')[0] : ''}</span></div>
      <div class="cn">${v.def}</div>
    </div>
  `).join('');
}

// ─── Events ────────────────────────────────
function bindStudyEvents(lesson, sentences) {
  // Play button
  document.getElementById('playBtn')?.addEventListener('click', togglePlay);

  // Seek
  document.getElementById('progressTrack')?.addEventListener('click', (e) => {
    if (!state.audio || !state.audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    state.audio.currentTime = pct * state.audio.duration;
  });

  // Sentence clicks
  document.querySelectorAll('.sentence-item').forEach(el => {
    el.addEventListener('click', () => {
      selectSentence(parseInt(el.dataset.index), sentences, lesson);
    });
  });

  // Prev/Next sentence
  document.getElementById('prevSentenceBtn')?.addEventListener('click', () => {
    if (state.currentSentence > 0) selectSentence(state.currentSentence - 1, sentences, lesson);
  });
  document.getElementById('nextSentenceBtn')?.addEventListener('click', () => {
    if (state.currentSentence < sentences.length - 1) selectSentence(state.currentSentence + 1, sentences, lesson);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (!state.loaded) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      if (state.currentSentence > 0) selectSentence(state.currentSentence - 1, sentences, lesson);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (state.currentSentence < sentences.length - 1) selectSentence(state.currentSentence + 1, sentences, lesson);
    } else if (e.key === ' ') {
      e.preventDefault();
      togglePlay();
    }
  });

  // Chinese toggle
  document.getElementById('cnToggle')?.addEventListener('change', (e) => {
    state.showChinese = e.target.checked;
    const block = document.getElementById('chineseBlock');
    if (block) block.classList.toggle('hidden', !state.showChinese);
  });

  // Notes toggle
  document.getElementById('notesToggle')?.addEventListener('click', () => {
    state.notesOpen = !state.notesOpen;
    const content = document.getElementById('notesContent');
    const toggle = document.getElementById('notesToggle');
    if (content) content.classList.toggle('open', state.notesOpen);
    if (toggle) toggle.textContent = state.notesOpen ? '收起 ▾' : '展开查看 ▸';
  });

  // Complete
  const completeLesson = () => {
    if (getCompletion(lesson.lesson_num) === 1) {
      showToast('已完成', '✅');
      return;
    }
    markComplete(lesson.lesson_num);
    document.querySelectorAll('#completeBtn, #completeBtn2').forEach(btn => {
      btn.className = btn.id === 'completeBtn' ? 'done-btn done' : 'complete-btn done';
      btn.innerHTML = '✅ 已完成';
    });
    showToast(`+${XP_PER_LESSON} XP`, '🎉');
  };
  document.getElementById('completeBtn')?.addEventListener('click', completeLesson);
  document.getElementById('completeBtn2')?.addEventListener('click', completeLesson);

  // Prev/Next lesson
  document.getElementById('prevLessonBtn')?.addEventListener('click', () => {
    const idx = state.lessons.findIndex(l => l.lesson_num === lesson.lesson_num);
    if (idx > 0) window.location.href = `/study?id=${state.lessons[idx - 1].lesson_num}`;
  });
  document.getElementById('nextLessonBtn')?.addEventListener('click', () => {
    const idx = state.lessons.findIndex(l => l.lesson_num === lesson.lesson_num);
    if (idx < state.lessons.length - 1) window.location.href = `/study?id=${state.lessons[idx + 1].lesson_num}`;
  });
}
