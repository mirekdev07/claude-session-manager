/**
 * Most między rendererem a main. Wystawia wyłącznie zamknięty zbiór operacji z kontraktu —
 * renderer nie dostaje `ipcRenderer` ani niczego, czym mógłby wywołać dowolny kanał (§24 planu).
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC, PUSH, type RendererApi } from '@shared/ipc-contract'
import type {
  AppEvent,
  PtyExitEvent,
  PtyStatusEvent,
  SpeechDownloadProgress,
  UsageReport,
} from '@shared/types'

/** Opakowuje `ipcRenderer.on` tak, aby wołający dostał gotową funkcję odsubskrybowującą. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: RendererApi = {
  claude: {
    info: () => ipcRenderer.invoke(IPC.claude.info),
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(IPC.clipboard.writeText, text),
  },
  app: {
    setActivePty: (ptyId) => ipcRenderer.invoke(IPC.app.setActivePty, ptyId),
    onFocusPty: (listener) => subscribe<string>(PUSH.focusPty, listener),
  },
  usage: {
    get: () => ipcRenderer.invoke(IPC.usage.get),
    refresh: () => ipcRenderer.invoke(IPC.usage.refresh),
    onChange: (listener) => subscribe<UsageReport>(PUSH.usageChanged, listener),
    byProject: (window) => ipcRenderer.invoke(IPC.usage.byProject, window),
  },
  projects: {
    list: () => ipcRenderer.invoke(IPC.projects.list),
    pickFolder: () => ipcRenderer.invoke(IPC.projects.pickFolder),
    add: (path) => ipcRenderer.invoke(IPC.projects.add, path),
    remove: (path) => ipcRenderer.invoke(IPC.projects.remove, path),
    rename: (path, displayName) => ipcRenderer.invoke(IPC.projects.rename, { path, displayName }),
    setFavorite: (path, isFavorite) =>
      ipcRenderer.invoke(IPC.projects.setFavorite, { path, isFavorite }),
    openFolder: (path) => ipcRenderer.invoke(IPC.projects.openFolder, path),
    openInEditor: (path) => ipcRenderer.invoke(IPC.projects.openInEditor, path),
  },
  sessions: {
    listForProject: (projectPath) => ipcRenderer.invoke(IPC.sessions.listForProject, projectPath),
    listRecent: (limit) => ipcRenderer.invoke(IPC.sessions.listRecent, limit),
    rescan: () => ipcRenderer.invoke(IPC.sessions.rescan),
    setLabel: (sessionId, label) => ipcRenderer.invoke(IPC.sessions.setLabel, { sessionId, label }),
    setFavorite: (sessionId, isFavorite) =>
      ipcRenderer.invoke(IPC.sessions.setFavorite, { sessionId, isFavorite }),
    removeFromIndex: (sessionId) => ipcRenderer.invoke(IPC.sessions.removeFromIndex, sessionId),
    setNotes: (sessionId, notes) => ipcRenderer.invoke(IPC.sessions.setNotes, { sessionId, notes }),
    setTags: (sessionId, tags) => ipcRenderer.invoke(IPC.sessions.setTags, { sessionId, tags }),
    contextBreakdown: (sessionId) => ipcRenderer.invoke(IPC.sessions.contextBreakdown, sessionId),
    search: (query) => ipcRenderer.invoke(IPC.sessions.search, query),
    summarize: (sessionId) => ipcRenderer.invoke(IPC.sessions.summarize, sessionId),
    exportMarkdown: (sessionId) => ipcRenderer.invoke(IPC.sessions.exportMarkdown, sessionId),
  },
  tabs: {
    save: (tabs) => ipcRenderer.invoke(IPC.tabs.save, tabs),
    load: () => ipcRenderer.invoke(IPC.tabs.load),
  },
  images: {
    readClipboard: () => ipcRenderer.invoke(IPC.images.readClipboard),
    addFromClipboard: () => ipcRenderer.invoke(IPC.images.addFromClipboard),
    addFromPaths: (paths) => ipcRenderer.invoke(IPC.images.addFromPaths, paths),
    addFromBytes: (fileName, bytes) =>
      ipcRenderer.invoke(IPC.images.addFromBytes, { fileName, bytes }),
    pick: () => ipcRenderer.invoke(IPC.images.pick),
    discard: (attachmentId) => ipcRenderer.invoke(IPC.images.discard, attachmentId),
    captureScreen: () => ipcRenderer.invoke(IPC.images.captureScreen),
    send: (params) => ipcRenderer.invoke(IPC.images.send, params),
  },
  speech: {
    status: () => ipcRenderer.invoke(IPC.speech.status),
    pickExecutable: () => ipcRenderer.invoke(IPC.speech.pickExecutable),
    downloadModel: (modelId) => ipcRenderer.invoke(IPC.speech.downloadModel, modelId),
    cancelDownload: () => ipcRenderer.invoke(IPC.speech.cancelDownload),
    transcribe: (wav) => ipcRenderer.invoke(IPC.speech.transcribe, { wav }),
    onDownloadProgress: (listener) =>
      subscribe<SpeechDownloadProgress>(PUSH.speechProgress, listener),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settings.get),
    update: (patch) => ipcRenderer.invoke(IPC.settings.update, patch),
  },
  pty: {
    create: (req) => ipcRenderer.invoke(IPC.pty.create, req),
    write: (ptyId, data) => ipcRenderer.invoke(IPC.pty.write, { ptyId, data }),
    resize: (ptyId, cols, rows) => ipcRenderer.invoke(IPC.pty.resize, { ptyId, cols, rows }),
    kill: (ptyId) => ipcRenderer.invoke(IPC.pty.kill, ptyId),
    onData: (ptyId, listener) => subscribe<string>(PUSH.ptyData(ptyId), listener),
    onExit: (listener) => subscribe<PtyExitEvent>(PUSH.ptyExit, listener),
    onStatus: (listener) => subscribe<PtyStatusEvent>(PUSH.ptyStatus, listener),
  },
  events: {
    on: (listener) => subscribe<AppEvent>(PUSH.appEvent, listener),
  },
}

contextBridge.exposeInMainWorld('api', api)
