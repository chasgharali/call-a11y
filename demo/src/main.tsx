import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'call-a11y/styles.css'
import './demo.css'
import { CallDemo } from './CallDemo'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <CallDemo />
    </StrictMode>,
  )
}
