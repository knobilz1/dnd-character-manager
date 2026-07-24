import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const root = createRoot(document.getElementById('root')!)

// The /table window is a chrome-less TV / second-display surface (spike Feature
// 1). Render it standalone — no App shell (router, Drive/DM sync hooks, update
// banner) and no 3D preload — so the TV shows only the map.
if (window.location.pathname === '/table') {
  import('./pages/table/TableView').then(({ TableView }) =>
    root.render(<StrictMode><TableView /></StrictMode>),
  )
} else {
  import('./utils/preload3D') // start caching 3D assets immediately at app boot
  import('./App.tsx').then(({ default: App }) =>
    root.render(<StrictMode><App /></StrictMode>),
  )
}
