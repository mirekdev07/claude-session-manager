import type { ITheme } from '@xterm/xterm'

/**
 * Paleta terminala dobrana tak, aby TUI Claude Code było czytelne na ciemnym tle aplikacji:
 * tło zgodne z panelem, akcent pomarańczowy jak w reszcie interfejsu, kolory ANSI o zbliżonej jasności.
 */
export const terminalTheme: ITheme = {
  background: '#0d0d0f',
  foreground: '#e8e8ec',
  cursor: '#d97757',
  cursorAccent: '#0d0d0f',
  selectionBackground: '#33333f',
  selectionForeground: '#ffffff',

  black: '#1a1a1f',
  red: '#d9615c',
  green: '#4ba86a',
  yellow: '#d9a441',
  blue: '#5b8dd9',
  magenta: '#b071c7',
  cyan: '#4fa8a8',
  white: '#c8c8d0',

  brightBlack: '#5a5a66',
  brightRed: '#f07a75',
  brightGreen: '#63c485',
  brightYellow: '#f0bd5c',
  brightBlue: '#7aa6f0',
  brightMagenta: '#c98ede',
  brightCyan: '#68c4c4',
  brightWhite: '#f2f2f6',
}
