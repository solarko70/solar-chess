import { solarAudio, type SolarAudio, type SoundThemeId } from '@/audio/solar-audio'
import { getPieceSet, getPieceSvg, setPieceSet, type PieceSetId } from './pieces'

export type ColorTheme = 'dark' | 'light'
export const COLOR_THEME_STORAGE_KEY = 'solar_chess_color_theme'

export function getColorTheme(): ColorTheme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

export function applyColorTheme(theme: ColorTheme): void {
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light')
  else document.documentElement.removeAttribute('data-theme')
  try {
    localStorage.setItem(COLOR_THEME_STORAGE_KEY, theme)
  } catch {
    // Keep appearance controls usable when storage is unavailable.
  }
}

export function restoreColorTheme(): void {
  try {
    const theme = localStorage.getItem(COLOR_THEME_STORAGE_KEY)
    if (theme === 'light' || theme === 'dark') applyColorTheme(theme)
  } catch {
    // Preserve the current document theme when storage cannot be read.
  }
}

interface SettingsOptions {
  audio?: SolarAudio
  onBack(): void
  onThemeChange?(): void
  onSoundChange?(): void
}

export class SettingsUI {
  private audio: SolarAudio

  constructor(private container: HTMLElement, options: SettingsOptions) {
    this.audio = options.audio ?? solarAudio
    restoreColorTheme()
    container.innerHTML = `
      <div class="settings-center">
        <header class="settings-header">
          <a href="#/" class="settings-back" id="settings-back">← В главное меню</a>
          <p class="settings-eyebrow">SOLAR CHESS</p>
          <h1>Настройки</h1>
          <p class="settings-intro">Ваш ритм игры. Ваш космос.</p>
        </header>
        <section class="settings-section" aria-labelledby="settings-audio-title">
          <h2 id="settings-audio-title">Аудио</h2>
          <div class="settings-switch-row">
            <div><h3 id="settings-sound-label">Глобальный звук</h3><p>Звуки ходов и интерфейса</p></div>
            <button type="button" id="settings-sound-toggle" class="settings-switch" role="switch" aria-labelledby="settings-sound-label" aria-checked="true">
              <span class="settings-switch-track" aria-hidden="true"><span></span></span>
              <span class="settings-switch-value">Вкл</span>
            </button>
          </div>
          <h3 id="settings-sound-theme-label">Звуковая тема</h3>
          <div class="settings-card-grid" role="group" aria-labelledby="settings-sound-theme-label">
            <div class="settings-sound-card">
              <button type="button" class="settings-choice" data-sound-theme="cosmic" aria-pressed="false">
                <span class="settings-swatch settings-swatch-cosmic" aria-hidden="true"></span>
                <strong>Космическая</strong><span>Солярный синтез и глубокие обертоны</span>
              </button>
              <button type="button" class="settings-preview" data-preview-theme="cosmic" aria-label="Тест космической темы">Тест</button>
            </div>
            <div class="settings-sound-card">
              <button type="button" class="settings-choice" data-sound-theme="classic" aria-pressed="false">
                <span class="settings-swatch settings-swatch-classic" aria-hidden="true"></span>
                <strong>Классическая</strong><span>Сухие деревянные клики</span>
              </button>
              <button type="button" class="settings-preview" data-preview-theme="classic" aria-label="Тест классической темы">Тест</button>
            </div>
          </div>
          <p class="settings-audio-note" role="status"></p>
        </section>
        <section class="settings-section" aria-labelledby="settings-appearance-title">
          <h2 id="settings-appearance-title">Оформление</h2>
          <h3 id="settings-color-label">Тема оформления</h3>
          <div class="settings-card-grid" role="group" aria-labelledby="settings-color-label">
            <button type="button" class="settings-choice" data-color-theme="dark" aria-pressed="false">
              <span class="settings-swatch settings-swatch-dark" aria-hidden="true"></span>
              <strong>Тёмная</strong><span>Космос</span>
            </button>
            <button type="button" class="settings-choice" data-color-theme="light" aria-pressed="false">
              <span class="settings-swatch settings-swatch-light" aria-hidden="true"></span>
              <strong>Светлая</strong><span>Солнце</span>
            </button>
          </div>
          <h3 id="settings-pieces-label">Набор фигур</h3>
          <div class="settings-card-grid" role="group" aria-labelledby="settings-pieces-label">
            <button type="button" class="settings-choice" data-piece-set="classic" aria-pressed="false">
              <span class="settings-piece-preview" aria-hidden="true">${getPieceSvg('pawn', 'white', 'classic')}${getPieceSvg('knight', 'black', 'classic')}</span>
              <strong>Классический</strong><span>Традиционные фигуры</span>
            </button>
            <button type="button" class="settings-choice" data-piece-set="solar" aria-pressed="false">
              <span class="settings-piece-preview" aria-hidden="true">${getPieceSvg('pawn', 'white', 'solar')}${getPieceSvg('knight', 'black', 'solar')}</span>
              <strong>Солярный (Solar Set)</strong><span>Планеты, плазма и звёздные короны</span>
            </button>
          </div>
        </section>
        <section class="settings-section" aria-labelledby="settings-language-title">
          <h2 id="settings-language-title">Язык</h2>
          <div class="settings-card-grid" role="group" aria-labelledby="settings-language-title">
            <button type="button" class="settings-choice" aria-pressed="true"><strong>Русский</strong><span>Активен</span></button>
            <button type="button" class="settings-choice" disabled><strong>English</strong><span class="settings-soon">Скоро</span></button>
          </div>
        </section>
      </div>`
    container.querySelector('#settings-back')?.addEventListener('click', (event) => {
      event.preventDefault()
      options.onBack()
    })
    container.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button')
      if (!button || button.disabled) return
      const soundTheme = button.dataset.soundTheme as SoundThemeId | undefined
      const preview = button.dataset.previewTheme as SoundThemeId | undefined
      const colorTheme = button.dataset.colorTheme as ColorTheme | undefined
      const pieceSet = button.dataset.pieceSet as PieceSetId | undefined
      if (soundTheme) this.audio.setSoundTheme(soundTheme)
      if (preview) this.audio.previewSoundTheme(preview)
      if (pieceSet) setPieceSet(pieceSet)
      if (colorTheme) {
        applyColorTheme(colorTheme)
        options.onThemeChange?.()
      }
      if (button.id === 'settings-sound-toggle') {
        this.audio.toggleMute()
        options.onSoundChange?.()
      }
      this.sync()
    })
    this.sync()
  }

  public sync(): void {
    const muted = this.audio.isMuted()
    this.container.querySelector('#settings-sound-toggle')?.setAttribute('aria-checked', String(!muted))
    const value = this.container.querySelector('.settings-switch-value')
    if (value) value.textContent = muted ? 'Выкл' : 'Вкл'
    const note = this.container.querySelector('.settings-audio-note')
    if (note) note.textContent = muted ? 'Звук выключен. Включите его для предпрослушивания.' : 'Нажмите «Тест», чтобы услышать взятие фигуры.'
    this.container.querySelectorAll<HTMLButtonElement>('[data-preview-theme]').forEach((button) => {
      button.disabled = muted
    })
    this.container.querySelectorAll<HTMLElement>('[data-sound-theme]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.soundTheme === this.audio.getSoundTheme()))
    })
    this.container.querySelectorAll<HTMLElement>('[data-color-theme]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.colorTheme === getColorTheme()))
    })
    this.container.querySelectorAll<HTMLButtonElement>('button[data-piece-set]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.pieceSet === getPieceSet()))
    })
  }
}
