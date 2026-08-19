import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/noto-sans-arabic'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
