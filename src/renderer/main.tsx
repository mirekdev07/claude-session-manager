import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './styles/index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Brak elementu #root')

// Świadomie bez StrictMode: podwójne wywołanie efektów w trybie deweloperskim
// uruchamiałoby dwa procesy `claude` na każdy terminal.
createRoot(container).render(<App />)
