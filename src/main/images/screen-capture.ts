/**
 * Zrzut fragmentu ekranu prosto do załączników (Etap 12.7, §14 specyfikacji).
 *
 * Przebieg jak w Narzędziu Wycinania: zamrażamy obraz ekranu, na którym jest kursor,
 * pokazujemy go w nakładce na pełny ekran, użytkownik zaznacza prostokąt, wycinamy.
 *
 * Nakładka nie ma preloadu ani dostępu do IPC. Wynik zaznaczenia przekazuje przez tytuł
 * strony — main nasłuchuje `page-title-updated`. To najprostszy kanał, który nie wymaga
 * wystawiania rendererowi żadnych uprawnień.
 */
import { BrowserWindow, desktopCapturer, screen, type NativeImage } from 'electron'
import { tMain } from '@main/i18n'

/** Prostokąt w pikselach obrazu (już po uwzględnieniu skalowania ekranu). */
export interface CaptureRegion {
  x: number
  y: number
  width: number
  height: number
}

/** Poniżej tej wielkości zaznaczenie to raczej przypadkowe kliknięcie niż zrzut. */
const MIN_REGION_PX = 8

/**
 * @returns PNG wyciętego fragmentu albo `null`, gdy użytkownik anulował (Esc / kliknięcie bez przeciągnięcia)
 */
export async function captureScreenRegion(mainWindow: BrowserWindow | null): Promise<Buffer | null> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { width, height } = display.size
  const scale = display.scaleFactor

  // Okno aplikacji zwykle zasłania to, co użytkownik chce uchwycić.
  const wasVisible = mainWindow !== null && !mainWindow.isDestroyed() && mainWindow.isVisible()
  if (wasVisible) mainWindow.hide()
  await delay(250)

  let frame: NativeImage
  try {
    frame = await grabDisplay(display.id, Math.round(width * scale), Math.round(height * scale))
  } catch (error) {
    if (wasVisible) mainWindow.show()
    throw error
  }

  try {
    const region = await selectRegion(display.bounds, frame)
    if (region === null) return null

    const scaled: CaptureRegion = {
      x: Math.round(region.x * scale),
      y: Math.round(region.y * scale),
      width: Math.round(region.width * scale),
      height: Math.round(region.height * scale),
    }
    return frame.crop(scaled).toPNG()
  } finally {
    if (wasVisible) mainWindow.show()
  }
}

async function grabDisplay(displayId: number, width: number, height: number): Promise<NativeImage> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  })
  const source =
    sources.find((candidate) => candidate.display_id === String(displayId)) ?? sources[0]
  if (!source) throw new Error(tMain('err.screenRead'))
  if (source.thumbnail.isEmpty()) throw new Error(tMain('err.screenEmpty'))
  return source.thumbnail
}

/** Pokazuje nakładkę i czeka na zaznaczenie. */
function selectRegion(
  bounds: Electron.Rectangle,
  frame: NativeImage
): Promise<CaptureRegion | null> {
  return new Promise((resolve) => {
    const overlay = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      fullscreen: true,
      hasShadow: false,
      backgroundColor: '#000000',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })

    let settled = false
    const finish = (region: CaptureRegion | null): void => {
      if (settled) return
      settled = true
      if (!overlay.isDestroyed()) overlay.close()
      resolve(region)
    }

    overlay.webContents.on('page-title-updated', (event, title) => {
      event.preventDefault()
      if (title === 'cancel') {
        finish(null)
        return
      }
      try {
        const parsed = JSON.parse(title) as CaptureRegion
        if (parsed.width < MIN_REGION_PX || parsed.height < MIN_REGION_PX) {
          finish(null)
          return
        }
        finish(parsed)
      } catch {
        // tytuł spoza protokołu — ignorujemy
      }
    })
    overlay.on('closed', () => finish(null))
    overlay.on('blur', () => finish(null))

    void overlay.loadURL(overlayPage(frame.toDataURL()))
  })
}

function overlayPage(imageDataUrl: string): string {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;overflow:hidden;cursor:crosshair;background:#000;user-select:none}
    #shot{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;filter:brightness(.55)}
    #sel{position:absolute;border:1px solid #d97757;background:rgba(217,119,87,.08);display:none;box-shadow:0 0 0 9999px rgba(0,0,0,.35)}
    #hint{position:absolute;top:14px;left:50%;transform:translateX(-50%);font:13px system-ui,sans-serif;color:#e8e8ec;background:rgba(20,20,23,.85);padding:6px 12px;border-radius:6px;border:1px solid #26262c}
    #size{position:absolute;font:11px ui-monospace,Consolas,monospace;color:#e8e8ec;background:rgba(20,20,23,.9);padding:2px 6px;border-radius:4px;display:none}
  </style></head><body>
    <img id="shot" src="${imageDataUrl}" draggable="false">
    <div id="sel"></div><div id="size"></div>
    <div id="hint">${escapeHtml(tMain('capture.hint'))}</div>
    <script>
      const sel=document.getElementById('sel'),size=document.getElementById('size');
      let start=null;
      const rect=(a,b)=>({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)});
      window.addEventListener('mousedown',e=>{if(e.button!==0)return;start={x:e.clientX,y:e.clientY};sel.style.display='block';size.style.display='block';draw(rect(start,start));});
      window.addEventListener('mousemove',e=>{if(!start)return;draw(rect(start,{x:e.clientX,y:e.clientY}));});
      window.addEventListener('mouseup',e=>{if(!start||e.button!==0)return;const r=rect(start,{x:e.clientX,y:e.clientY});start=null;document.title=JSON.stringify(r);});
      window.addEventListener('keydown',e=>{if(e.key==='Escape')document.title='cancel';});
      window.addEventListener('contextmenu',e=>{e.preventDefault();document.title='cancel';});
      function draw(r){sel.style.left=r.x+'px';sel.style.top=r.y+'px';sel.style.width=r.width+'px';sel.style.height=r.height+'px';size.textContent=r.width+' × '+r.height;size.style.left=(r.x+r.width+8)+'px';size.style.top=(r.y+r.height+8)+'px';}
    </script></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

/** Podpowiedź trafia do HTML nakładki — znaki specjalne nie mogą otworzyć znacznika. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? char)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
