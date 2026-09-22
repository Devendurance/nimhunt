import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { SitePresenceBeacon } from './hooks/useSitePresence.ts'
import { HomePage } from './routes/HomePage'
import { PlayPage } from './routes/PlayPage'
export default function App() {
  return <BrowserRouter><SitePresenceBeacon /><Routes><Route path="/" element={<HomePage />} /><Route path="/play" element={<PlayPage />} /></Routes></BrowserRouter>
}
