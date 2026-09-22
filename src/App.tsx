import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { HomePage } from './routes/HomePage'
import { PlayPage } from './routes/PlayPage'
export default function App() {
  return <BrowserRouter><Routes><Route path="/" element={<HomePage />} /><Route path="/play" element={<PlayPage />} /></Routes><Analytics /></BrowserRouter>
}
