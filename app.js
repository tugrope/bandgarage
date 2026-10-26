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

const NOTE_NAMES_EN = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const NOTE_NAMES_JA = ['ド', 'レ♭', 'レ', 'ミ♭', 'ミ', 'ファ', 'ソ♭', 'ソ', 'ラ♭', 'ラ', 'シ♭', 'シ'];

// 14フレット（0: 開放弦 〜 14フレット）
const TOTAL_FRETS = 14;

// 24キー設定（メジャー12 / マイナー12）
// ルート音番号: C=0, C#/Db=1, D=2, D#/Eb=3, E=4, F=5, F#/Gb=6, G=7, G#/Ab=8, A=9, A#/Bb=10, B=11
const KEYS_CONFIG = {
  'C-major': { root: 0, type: 'major', name: 'C' },
  'Db-major': { root: 1, type: 'major', name: 'D♭' },
  'D-major': { root: 2, type: 'major', name: 'D' },
  'Eb-major': { root: 3, type: 'major', name: 'E♭' },
  'E-major': { root: 4, type: 'major', name: 'E' },
  'F-major': { root: 5, type: 'major', name: 'F' },
  'F#-major': { root: 6, type: 'major', name: 'F♯' },
  'G-major': { root: 7, type: 'major', name: 'G' },
  'G#-major': { root: 8, type: 'major', name: 'G♯' },
  'A-major': { root: 9, type: 'major', name: 'A' },
  'Bb-major': { root: 10, type: 'major', name: 'B♭' },
  'B-major': { root: 11, type: 'major', name: 'B' },

  'C-minor': { root: 0, type: 'minor', name: 'Cm' },
  'Db-minor': { root: 1, type: 'minor', name: 'D♭m' },
  'D-minor': { root: 2, type: 'minor', name: 'Dm' },
  'Eb-minor': { root: 3, type: 'minor', name: 'E♭m' },
  'E-minor': { root: 4, type: 'minor', name: 'Em' },
  'F-minor': { root: 5, type: 'minor', name: 'Fm' },
  'F#-minor': { root: 6, type: 'minor', name: 'F♯m' },
  'G-minor': { root: 7, type: 'minor', name: 'Gm' },
  'G#-minor': { root: 8, type: 'minor', name: 'G♯m' },
  'A-minor': { root: 9, type: 'minor', name: 'Am' },
  'Bb-minor': { root: 10, type: 'minor', name: 'B♭m' },
  'B-minor': { root: 11, type: 'minor', name: 'Bm' },
};

// メジャーキースケール構成音（アイオニアン）度数表記: R/9/3/11/5/13/7（半音オフセット 0〜11）
const MAJOR_DEGREE_MAP = {
  0: 'R',
  2: '9',
  4: '3',
  5: '11',
  7: '5',
  9: '13',
  11: '7',
};

// ナチュラルマイナースケール構成音（エオリアン）度数表記: R/9/♭3/11/5/♭13/♭7（半音オフセット 0〜11）
const MINOR_DEGREE_MAP = {
  0: 'R',
  2: '9',
  3: '♭3',
  5: '11',
  7: '5',
  8: '♭13',
  10: '♭7',
};

// ドットインレイ位置
const SINGLE_INLAY_FRETS = [3, 5, 7, 9];
const DOUBLE_INLAY_FRETS = [12];

class GuitarApp {
  constructor() {
    this.audioCtx = null;
    this.masterGain = null;
    this.compressor = null;
    this.activePointers = new Map(); // pointerId -> activeCell
    this.noteDisplayMode = 'all-english'; // 'none' | 'all-english' | 'natural-english' | 'all-solfege' | 'natural-solfege' | 'degree'
    this.currentKey = 'C-major'; // 選択中のキー
    this.popupMode = 'on'; // 'on' | 'off' (押弦ポップアップ制御)
    this.volume = 1.4; // 初期値（従来の約1.75倍、最大4.0倍）

    this.initDOM();
    this.buildFretboard();
    this.bindEvents();
  }

  // DOM要素の参照
  initDOM() {
    this.appContainer = document.getElementById('appContainer');
    this.fretboardEl = document.getElementById('fretboard');
    this.themeSelect = document.getElementById('fretboardTheme');
    this.neckDirectionSelect = document.getElementById('neckDirection');
    this.noteDisplaySelect = document.getElementById('noteDisplay');
    this.keySelect = document.getElementById('keySelect');
    this.popupSelect = document.getElementById('popupDisplay');
    this.volumeSlider = document.getElementById('masterVolume');
    this.volIcon = document.getElementById('volIcon');
    this.fullscreenBtn = document.getElementById('fullscreenBtn');
    this.currentNoteText = document.getElementById('currentNoteText');
    this.iosFullscreenHint = document.getElementById('iosFullscreenHint');
  }

  // Web Audio Contextの初期化（コンプレッサー＆マスターゲイン構成）
  initAudio() {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtxClass();

      // 1. マスターコンプレッサー／リミッター（大音量時の音割れ防止と太い音圧を両立）
      this.compressor = this.audioCtx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-14, this.audioCtx.currentTime);
      this.compressor.knee.setValueAtTime(8, this.audioCtx.currentTime);
      this.compressor.ratio.setValueAtTime(5, this.audioCtx.currentTime);
      this.compressor.attack.setValueAtTime(0.002, this.audioCtx.currentTime);
      this.compressor.release.setValueAtTime(0.12, this.audioCtx.currentTime);

      // 2. マスターゲイン（最大4.0倍対応）
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.setValueAtTime(this.volume, this.audioCtx.currentTime);

      // 接続: ノード群 -> compressor -> masterGain -> destination
      this.compressor.connect(this.masterGain);
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
    // 白鍵（ナチュラル音）判定: C, D, E, F, G, A, B (黒鍵: 1, 3, 6, 8, 10)
    const isNatural = ![1, 3, 6, 8, 10].includes(noteIndex);
    return {
      en: `${NOTE_NAMES_EN[noteIndex]}${octave}`,
      enShort: NOTE_NAMES_EN[noteIndex],
      ja: NOTE_NAMES_JA[noteIndex],
      isNatural,
      midi
    };
  }

  // 現在の選択キーにおける度数情報を取得（スケール外の場合はdegree: null）
  getDegreeInfo(midi) {
    const keyConfig = KEYS_CONFIG[this.currentKey];
    if (!keyConfig) return null;

    const noteIndex = midi % 12;
    const interval = (noteIndex - keyConfig.root + 12) % 12;
    const degreeMap = keyConfig.type === 'major' ? MAJOR_DEGREE_MAP : MINOR_DEGREE_MAP;
    const degree = degreeMap[interval] || null;

    return {
      degree,
      isRoot: degree === 'R',
      inScale: degree !== null,
      interval,
      keyName: keyConfig.name
    };
  }

  /**
   * 改良型 Karplus-Strong 撥弦物理合成
   * - 1・2弦高フレットの「ペシペシ」感を解消（基音ブレンド＋周波数適応型ダンピング）
   * - エレキギターらしい太さと芯のある伸びやかなロングトーン
   */
  playGuitarPluck(midi, stringIndex) {
    this.initAudio();

    const freq = this.midiToFreq(midi);
    const sampleRate = this.audioCtx.sampleRate;
    const N = Math.max(2, Math.round(sampleRate / freq));

    // サステイン長（高音域も短く切れることなく、伸びやかに保持）
    const duration = Math.max(2.4, 2.2 + (7 - stringIndex) * 0.18);
    const totalSamples = Math.floor(sampleRate * duration);

    const buffer = this.audioCtx.createBuffer(1, totalSamples, sampleRate);
    const channelData = buffer.getChannelData(0);

    // 1. ピック励起テーブル（高音域のペシペシ感を解消するため、基音サイン波をブレンド）
    const table = new Float32Array(N);
    // 高周波になるほどサイン波のブレンド比率を高めて「音の芯」を確保
    const sineRatio = Math.min(0.55, 0.22 + (freq / 1200) * 0.35);

    for (let i = 0; i < N; i++) {
      const noise = (Math.random() * 2 - 1) * 0.9;
      const sine = Math.sin((2 * Math.PI * i) / N);
      table[i] = (1 - sineRatio) * noise + sineRatio * sine;
    }

    // 2. 周波数適応型ダンピング（高周波でも急激にエネルギーが失われないよう調整）
    // ループ頻度が高くなる高音域ほど1周期あたりの減衰を緩やかにしてサステインを維持
    const damping = Math.pow(0.9972, 220 / freq);
    // 低域通過フィルタのブレンド率（高音ほど平均化をゆるやかにして抜けを保つ）
    const blend = Math.max(0.28, Math.min(0.5, 0.5 * Math.sqrt(300 / freq)));

    // 3. Karplus-Strong ループ
    let previousSample = 0;
    for (let i = 0; i < totalSamples; i++) {
      const idx = i % N;
      const current = table[idx];
      const filtered = ((1 - blend) * current + blend * previousSample) * damping;
      table[idx] = filtered;
      previousSample = filtered;
      channelData[i] = filtered;
    }

    // 4. オーディオノードチェーン
    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;

    // (A) エレキギターのピックアップ特性（中低域の太さを強化するピーキングEQ）
    const bodyEQ = this.audioCtx.createBiquadFilter();
    bodyEQ.type = 'peaking';
    bodyEQ.frequency.setValueAtTime(380, this.audioCtx.currentTime); // 380Hz付近の温かみと太さ
    bodyEQ.gain.setValueAtTime(3.5, this.audioCtx.currentTime);
    bodyEQ.Q.setValueAtTime(1.0, this.audioCtx.currentTime);

    // (B) アタックの抜けを演出するハイミッドEQ
    const presenceEQ = this.audioCtx.createBiquadFilter();
    presenceEQ.type = 'peaking';
    presenceEQ.frequency.setValueAtTime(2600, this.audioCtx.currentTime); // 2.6kHzのエレキらしいヌケ
    presenceEQ.gain.setValueAtTime(2.5, this.audioCtx.currentTime);
    presenceEQ.Q.setValueAtTime(1.2, this.audioCtx.currentTime);

    // (C) 耳障りな超高域ノイズカット用ローパス
    const lowpass = this.audioCtx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(Math.min(7500, freq * 7), this.audioCtx.currentTime);

    // (D) 弦ごとの音量バランス補正（1・2弦の音量を底上げ）
    const noteGain = this.audioCtx.createGain();
    const stringVolumeAdjust = 1.05 + (stringIndex <= 2 ? 0.2 : 0) + (stringIndex - 1) * 0.04;
    noteGain.gain.setValueAtTime(stringVolumeAdjust, this.audioCtx.currentTime);

    // フェードアウトエンベロープ
    noteGain.gain.setTargetAtTime(0, this.audioCtx.currentTime + duration - 0.25, 0.08);

    // ノード接続: source -> bodyEQ -> presenceEQ -> lowpass -> noteGain -> compressor
    source.connect(bodyEQ);
    bodyEQ.connect(presenceEQ);
    presenceEQ.connect(lowpass);
    lowpass.connect(noteGain);
    noteGain.connect(this.compressor);

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
        dot.className = 'inlay-dot inlay-single';
        col.appendChild(dot);
      } else if (DOUBLE_INLAY_FRETS.includes(fret)) {
        const dot1 = document.createElement('div');
        dot1.className = 'inlay-dot inlay-double-top';
        const dot2 = document.createElement('div');
        dot2.className = 'inlay-dot inlay-double-bottom';
        col.appendChild(dot1);
        col.appendChild(dot2);
      }

      // フレット番号ラベル
      const numLabel = document.createElement('div');
      numLabel.className = 'fret-number';
      numLabel.textContent = fret === 0 ? '0' : fret;
      col.appendChild(numLabel);

      // 各弦（1〜6弦）のセル
      STRINGS_CONFIG.forEach((str) => {
        const cell = document.createElement('div');
        cell.className = 'fret-cell';
        cell.dataset.fret = fret;
        cell.dataset.string = str.stringIndex;

        // MIDIノート番号計算
        const midi = str.baseMidi + fret;
        cell.dataset.midi = midi;

        // 弦ワイヤー
        const wire = document.createElement('div');
        wire.className = `string-wire string-wire-${str.stringIndex}`;
        cell.appendChild(wire);

        // 押弦ハイライトマーカー
        const marker = document.createElement('div');
        marker.className = 'press-marker';
        cell.appendChild(marker);

        // 音名バッジ
        const badge = document.createElement('div');
        badge.className = 'note-badge';
        cell.appendChild(badge);

        // 押弦時フローティングポップアップ
        const popup = document.createElement('div');
        popup.className = 'note-popup';
        cell.appendChild(popup);

        col.appendChild(cell);
      });

      this.fretboardEl.appendChild(col);
    }

    this.updateNoteLabels();
  }

  // 音名バッジの表示更新（なし / 全音名 / 白音名 / 全音階 / 白音階 / 度数）
  updateNoteLabels() {
    const cells = this.fretboardEl.querySelectorAll('.fret-cell');
    cells.forEach((cell) => {
      const midi = parseInt(cell.dataset.midi, 10);
      const noteInfo = this.getNoteInfo(midi);
      const badge = cell.querySelector('.note-badge');

      if (!badge) return;

      badge.classList.remove('badge-root');

      switch (this.noteDisplayMode) {
        case 'none':
          badge.style.display = 'none';
          break;
        case 'all-english':
          badge.style.display = 'flex';
          badge.textContent = noteInfo.enShort;
          break;
        case 'natural-english':
          if (noteInfo.isNatural) {
            badge.style.display = 'flex';
            badge.textContent = noteInfo.enShort;
          } else {
            badge.style.display = 'none';
          }
          break;
        case 'all-solfege':
          badge.style.display = 'flex';
          badge.textContent = noteInfo.ja;
          break;
        case 'natural-solfege':
          if (noteInfo.isNatural) {
            badge.style.display = 'flex';
            badge.textContent = noteInfo.ja;
          } else {
            badge.style.display = 'none';
          }
          break;
        case 'degree': {
          const degInfo = this.getDegreeInfo(midi);
          if (degInfo && degInfo.inScale) {
            badge.style.display = 'flex';
            badge.textContent = degInfo.degree;
            if (degInfo.isRoot) {
              badge.classList.add('badge-root');
            }
          } else {
            badge.style.display = 'none';
          }
          break;
        }
        default:
          badge.style.display = 'none';
      }
    });
  }

  // セルの押弦・発音処理
  activateCell(cell) {
    if (!cell) return;

    cell.classList.add('active', 'vibrating');

    const midi = parseInt(cell.dataset.midi, 10);
    const stringIndex = parseInt(cell.dataset.string, 10);
    const fret = parseInt(cell.dataset.fret, 10);

    // 発音
    this.playGuitarPluck(midi, stringIndex);

    // 音名表示の更新（緑文字でスッキリ表示）
    const noteInfo = this.getNoteInfo(midi);
    const noteFull = noteInfo.en;
    const noteJa = noteInfo.ja;
    const degInfo = this.getDegreeInfo(midi);

    const marker = cell.querySelector('.press-marker');
    if (marker) {
      if (this.noteDisplayMode === 'degree') {
        marker.setAttribute('data-active-note', degInfo && degInfo.degree ? degInfo.degree : noteInfo.enShort);
      } else {
        marker.setAttribute('data-active-note', noteInfo.enShort);
      }
    }

    if (this.currentNoteText) {
      if (this.noteDisplayMode === 'degree') {
        const degText = degInfo && degInfo.degree ? ` [${degInfo.degree}]` : ' [スケール外]';
        this.currentNoteText.textContent = `${stringIndex}弦 ${fret === 0 ? '開放' : fret + 'F'} : ${noteFull}${degText}`;
      } else {
        this.currentNoteText.textContent = `${stringIndex}弦 ${fret === 0 ? '開放' : fret + 'F'} : ${noteFull} (${noteJa})`;
      }
    }

    // 押弦ポップアップ吹き出しの更新・表示（PU: 有/無 制御）
    const popup = cell.querySelector('.note-popup');
    if (popup) {
      if (this.popupMode === 'on') {
        // 音名/音階/度数の決定
        if (this.noteDisplayMode === 'all-solfege' || this.noteDisplayMode === 'natural-solfege') {
          popup.textContent = noteInfo.ja;
        } else if (this.noteDisplayMode === 'degree') {
          popup.textContent = degInfo && degInfo.degree ? degInfo.degree : noteInfo.enShort;
        } else {
          popup.textContent = noteInfo.enShort;
        }

        // 最上段の弦（通常時は1弦、ネック右反転時は6弦）は下向きにポップアップして見切れ防止
        const isNeckRight = this.neckDirectionSelect && this.neckDirectionSelect.value === 'right';
        const isTopString = isNeckRight ? stringIndex === 6 : stringIndex === 1;
        if (isTopString) {
          popup.classList.add('popup-down');
        } else {
          popup.classList.remove('popup-down');
        }

        popup.classList.add('show');
      } else {
        popup.classList.remove('show');
      }
    }
  }

  // セルの離弦処理
  deactivateCell(cell) {
    if (!cell) return;
    cell.classList.remove('active');

    // ポップアップの非表示
    const popup = cell.querySelector('.note-popup');
    if (popup) {
      popup.classList.remove('show');
    }

    setTimeout(() => {
      cell.classList.remove('vibrating');
    }, 400);
  }

  // フルスクリーン切り替え（クロスブラウザ対応 ＆ iOS Safari案内）
  toggleFullscreen() {
    const doc = document.documentElement;
    const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;

    if (!isFullscreen) {
      if (doc.requestFullscreen) {
        doc.requestFullscreen().catch(() => this.showIosFullscreenHint());
      } else if (doc.webkitRequestFullscreen) {
        doc.webkitRequestFullscreen();
      } else if (doc.mozRequestFullScreen) {
        doc.mozRequestFullScreen();
      } else if (doc.msRequestFullscreen) {
        doc.msRequestFullscreen();
      } else {
        this.showIosFullscreenHint();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => { });
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    }
  }

  // iOS Safari等でFullscreen APIが非対応の場合のヒント表示
  showIosFullscreenHint() {
    if (!this.iosFullscreenHint) return;
    this.iosFullscreenHint.classList.add('show');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => {
      this.iosFullscreenHint.classList.remove('show');
    }, 3500);
  }

  // イベントバインド
  bindEvents() {
    // マルチタッチ・ポインター操作（複数指・和音・スライド演奏対応）
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

    // 指板テーマ切り替え（Maple / Rose）
    this.themeSelect.addEventListener('change', (e) => {
      document.body.className = e.target.value;
    });

    // ネック向き切り替え（横左 / 横右）
    if (this.neckDirectionSelect) {
      this.neckDirectionSelect.addEventListener('change', (e) => {
        if (e.target.value === 'right') {
          this.appContainer.classList.add('neck-right');
        } else {
          this.appContainer.classList.remove('neck-right');
        }
      });
    }

    // 音名表示切り替え（音名 / 階名 / なし / 度数）
    this.noteDisplaySelect.addEventListener('change', (e) => {
      this.noteDisplayMode = e.target.value;
      this.updateNoteLabels();
    });

    // キー切り替え（24キー）
    if (this.keySelect) {
      this.keySelect.addEventListener('change', (e) => {
        this.currentKey = e.target.value;
        if (this.noteDisplayMode === 'degree') {
          this.updateNoteLabels();
        }
      });
    }

    // ポップアップ切り替え（PU: 有 / PU: 無）
    if (this.popupSelect) {
      this.popupSelect.addEventListener('change', (e) => {
        this.popupMode = e.target.value;
        if (this.popupMode === 'off') {
          const activePopups = this.fretboardEl.querySelectorAll('.note-popup.show');
          activePopups.forEach((p) => p.classList.remove('show'));
        }
      });
    }

    // ボリューム変更（最大2.0倍）
    this.volumeSlider.addEventListener('input', (e) => {
      this.volume = parseFloat(e.target.value);
      if (this.masterGain && this.audioCtx) {
        this.masterGain.gain.setValueAtTime(this.volume, this.audioCtx.currentTime);
      }
      this.volIcon.textContent = this.volume === 0 ? '🔇' : (this.volume < 0.6 ? '🔉' : '🔊');
    });

    // 全画面切り替えボタン
    this.fullscreenBtn.addEventListener('click', () => {
      this.toggleFullscreen();
    });
  }
}

// アプリケーション起動
window.addEventListener('DOMContentLoaded', () => {
  new GuitarApp();
});
