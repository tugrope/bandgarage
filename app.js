/**
 * Fretboard 14 - Web Audio API & Multi-Touch Controller
 * High-performance, zero-latency guitar physical modeling synthesizer
 */

// ギターの弦設定 (スタンダードチューニング: EADGBE)
// stringIndex 1 = 1弦(最高音: E4), stringIndex 6 = 6弦(最低音: E2)
const STRINGS_CONFIG = [
  { stringIndex: 1, baseMidi: 64, name: '1st (E4)' },
  { stringIndex: 2, baseMidi: 59, name: '2nd (B3)' },
  { stringIndex: 3, baseMidi: 55, name: '3rd (G3)' },
  { stringIndex: 4, baseMidi: 50, name: '4th (D3)' },
  { stringIndex: 5, baseMidi: 45, name: '5th (A2)' },
  { stringIndex: 6, baseMidi: 40, name: '6th (E2)' },
];

const NOTE_NAMES_EN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_JA = ['ド', 'ド#', 'レ', 'レ#', 'ミ', 'ファ', 'ファ#', 'ソ', 'ソ#', 'ラ', 'ラ#', 'シ'];

// 14フレット（0: 開放弦 〜 14フレット）
const TOTAL_FRETS = 14;

// ドットインレイ位置
const SINGLE_INLAY_FRETS = [3, 5, 7, 9];
const DOUBLE_INLAY_FRETS = [12];

class GuitarApp {
  constructor() {
    this.audioCtx = null;
    this.masterGain = null;
    this.activePointers = new Map(); // pointerId -> activeCell
    this.noteDisplayMode = 'english'; // 'english' | 'solfege' | 'none'
    this.volume = 0.8;

    this.initDOM();
    this.buildFretboard();
    this.bindEvents();
  }

  // DOM要素の参照
  initDOM() {
    this.fretboardEl = document.getElementById('fretboard');
    this.themeSelect = document.getElementById('fretboardTheme');
    this.noteDisplaySelect = document.getElementById('noteDisplay');
    this.volumeSlider = document.getElementById('masterVolume');
    this.volIcon = document.getElementById('volIcon');
    this.fullscreenBtn = document.getElementById('fullscreenBtn');
    this.currentNoteText = document.getElementById('currentNoteText');
  }

  // Web Audio Contextの初期化（iOS/Safariアンロック対応）
  initAudio() {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
      
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.setValueAtTime(this.volume, this.audioCtx.currentTime);
      this.masterGain.connect(this.audioCtx.destination);
    }

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  // MIDIノート番号から周波数計算
  midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // MIDIノート番号から音名文字列を取得
  getNoteInfo(midi) {
    const noteIndex = midi % 12;
    const octave = Math.floor(midi / 12) - 1;
    return {
      en: `${NOTE_NAMES_EN[noteIndex]}${octave}`,
      enShort: NOTE_NAMES_EN[noteIndex],
      ja: NOTE_NAMES_JA[noteIndex],
      midi
    };
  }

  /**
   * Karplus-Strong 撥弦物理合成による高品位ギターサウンド生成
   * 外部ファイル不要で即時発音・低遅延
   */
  playGuitarPluck(midi, stringIndex) {
    this.initAudio();

    const freq = this.midiToFreq(midi);
    const sampleRate = this.audioCtx.sampleRate;
    const N = Math.max(2, Math.round(sampleRate / freq));
    
    // サステイン長（低音弦は長め、高音弦はやや短め）
    const duration = 2.2 + (7 - stringIndex) * 0.2;
    const totalSamples = Math.floor(sampleRate * duration);
    
    const buffer = this.audioCtx.createBuffer(1, totalSamples, sampleRate);
    const channelData = buffer.getChannelData(0);

    // 1. ピックによる励起ノイズテーブル（初期状態）
    const table = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      // わずかに丸みを帯びたノイズでアタック感を自然に
      table[i] = (Math.random() * 2 - 1) * 0.95;
    }

    // 2. 減衰係数（弦の太さに応じて調整）
    const damping = 0.991 + (7 - stringIndex) * 0.0012;

    // 3. Karplus-Strong ループ（低域通過平均化）
    let previousSample = 0;
    for (let i = 0; i < totalSamples; i++) {
      const idx = i % N;
      const filtered = 0.5 * (table[idx] + previousSample) * damping;
      table[idx] = filtered;
      previousSample = filtered;
      channelData[i] = filtered;
    }

    // 4. オーディオノードチェーン
    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;

    // ギターのボディ共鳴をシミュレートするフィルター
    const bodyFilter = this.audioCtx.createBiquadFilter();
    bodyFilter.type = 'lowpass';
    bodyFilter.frequency.setValueAtTime(Math.min(5000, freq * 8), this.audioCtx.currentTime);

    // 弦ごとの音量バランス
    const noteGain = this.audioCtx.createGain();
    const stringVolumeAdjust = 0.8 + (stringIndex - 1) * 0.05;
    noteGain.gain.setValueAtTime(stringVolumeAdjust, this.audioCtx.currentTime);

    // フェードアウトエンベロープ（プチノイズ防止）
    noteGain.gain.setTargetAtTime(0, this.audioCtx.currentTime + duration - 0.2, 0.08);

    source.connect(bodyFilter);
    bodyFilter.connect(noteGain);
    noteGain.connect(this.masterGain);

    source.start();
    source.stop(this.audioCtx.currentTime + duration);
  }

  // 指板のDOM構造を動的ビルド
  buildFretboard() {
    this.fretboardEl.innerHTML = '';

    for (let fret = 0; fret <= TOTAL_FRETS; fret++) {
      const col = document.createElement('div');
      col.className = 'fret-column';
      col.dataset.fret = fret;

      // ドットインレイの追加
      if (SINGLE_INLAY_FRETS.includes(fret)) {
        const dot = document.createElement('div');
        dot.className = 'inlay-dot';
        col.appendChild(dot);
      } else if (DOUBLE_INLAY_FRETS.includes(fret)) {
        const dotTop = document.createElement('div');
        dotTop.className = 'inlay-dot double-top';
        const dotBottom = document.createElement('div');
        dotBottom.className = 'inlay-dot double-bottom';
        col.appendChild(dotTop);
        col.appendChild(dotBottom);
      }

      // フレット番号表示（0フレットは「Open」）
      const numLabel = document.createElement('div');
      numLabel.className = 'fret-number';
      numLabel.textContent = fret === 0 ? '0' : fret;
      col.appendChild(numLabel);

      // 各弦の交点セル（1弦〜6弦）
      STRINGS_CONFIG.forEach(str => {
        const midi = str.baseMidi + fret;
        const noteInfo = this.getNoteInfo(midi);

        const cell = document.createElement('div');
        cell.className = 'fret-cell';
        cell.dataset.fret = fret;
        cell.dataset.string = str.stringIndex;
        cell.dataset.midi = midi;
        cell.dataset.noteEn = noteInfo.enShort;
        cell.dataset.noteEnFull = noteInfo.en;
        cell.dataset.noteJa = noteInfo.ja;

        // 弦要素
        const stringWire = document.createElement('div');
        stringWire.className = 'string-wire';
        cell.appendChild(stringWire);

        // 押弦「●」マーカー
        const marker = document.createElement('div');
        marker.className = 'press-marker';

        const label = document.createElement('span');
        label.className = 'note-label';
        label.textContent = this.getLabelText(noteInfo);
        marker.appendChild(label);

        cell.appendChild(marker);
        col.appendChild(cell);
      });

      this.fretboardEl.appendChild(col);
    }
  }

  // 表示モードに応じたラベルテキスト生成
  getLabelText(noteInfo) {
    if (this.noteDisplayMode === 'english') {
      return noteInfo.enShort;
    } else if (this.noteDisplayMode === 'solfege') {
      return noteInfo.ja;
    }
    return '';
  }

  // 音名表示モードの更新
  updateNoteLabels() {
    const cells = this.fretboardEl.querySelectorAll('.fret-cell');
    cells.forEach(cell => {
      const label = cell.querySelector('.note-label');
      if (label) {
        if (this.noteDisplayMode === 'english') {
          label.textContent = cell.dataset.noteEn;
        } else if (this.noteDisplayMode === 'solfege') {
          label.textContent = cell.dataset.noteJa;
        } else {
          label.textContent = '';
        }
      }
    });
  }

  // セルの押弦発音処理
  activateCell(cell) {
    if (!cell || !cell.classList.contains('fret-cell')) return;

    const midi = parseInt(cell.dataset.midi, 10);
    const stringIndex = parseInt(cell.dataset.string, 10);
    const fret = parseInt(cell.dataset.fret, 10);

    // サウンド再生
    this.playGuitarPluck(midi, stringIndex);

    // 「●」マーカーと振動アニメーション
    cell.classList.add('active', 'vibrating');

    // フッター情報更新
    const noteFull = cell.dataset.noteEnFull;
    const noteJa = cell.dataset.noteJa;
    this.currentNoteText.textContent = `${stringIndex}弦 ${fret === 0 ? '開放' : fret + 'F'}: ${noteFull} (${noteJa})`;

    // タップ後、少し余韻を残してマーカーをフェードアウト
    clearTimeout(cell._timer);
    cell._timer = setTimeout(() => {
      cell.classList.remove('vibrating');
      if (![...this.activePointers.values()].includes(cell)) {
        cell.classList.remove('active');
      }
    }, 450);
  }

  // セルの解除
  deactivateCell(cell) {
    if (!cell) return;
    cell.classList.remove('vibrating');
    setTimeout(() => {
      if (![...this.activePointers.values()].includes(cell)) {
        cell.classList.remove('active');
      }
    }, 300);
  }

  // Pointerイベント（マウス／マルチタッチ両対応）
  bindEvents() {
    // 指板コンテナでのPointerイベントハンドリング
    this.fretboardEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const cell = e.target.closest('.fret-cell');
      if (cell) {
        this.activePointers.set(e.pointerId, cell);
        this.activateCell(cell);
      }
    });

    this.fretboardEl.addEventListener('pointermove', (e) => {
      if (!this.activePointers.has(e.pointerId)) return;
      e.preventDefault();

      // 指の下にある要素を取得（スライド／ストローク演奏対応）
      const element = document.elementFromPoint(e.clientX, e.clientY);
      const cell = element ? element.closest('.fret-cell') : null;
      const prevCell = this.activePointers.get(e.pointerId);

      if (cell && cell !== prevCell) {
        this.deactivateCell(prevCell);
        this.activePointers.set(e.pointerId, cell);
        this.activateCell(cell);
      }
    });

    const handlePointerEnd = (e) => {
      if (this.activePointers.has(e.pointerId)) {
        const cell = this.activePointers.get(e.pointerId);
        this.deactivateCell(cell);
        this.activePointers.delete(e.pointerId);
      }
    };

    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);

    // 指板テーマ切り替え
    this.themeSelect.addEventListener('change', (e) => {
      document.body.className = e.target.value;
    });

    // 音名表示切り替え
    this.noteDisplaySelect.addEventListener('change', (e) => {
      this.noteDisplayMode = e.target.value;
      this.updateNoteLabels();
    });

    // ボリューム変更
    this.volumeSlider.addEventListener('input', (e) => {
      this.volume = parseFloat(e.target.value);
      if (this.masterGain && this.audioCtx) {
        this.masterGain.gain.setValueAtTime(this.volume, this.audioCtx.currentTime);
      }
      this.volIcon.textContent = this.volume === 0 ? '🔇' : (this.volume < 0.5 ? '🔉' : '🔊');
    });

    // 全画面切り替え
    this.fullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
  }
}

// アプリケーション起動
window.addEventListener('DOMContentLoaded', () => {
  new GuitarApp();
});
