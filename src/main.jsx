import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/500.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
import '@fontsource/ibm-plex-sans-arabic/700.css'
import '@fontsource-variable/manrope'
import './index.css'
import App from './App.jsx'
import { installMobileZoomLock } from './mobileZoomLock.js'

const removeMobileZoomLock = installMobileZoomLock()

if (import.meta.hot) import.meta.hot.dispose(removeMobileZoomLock)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
