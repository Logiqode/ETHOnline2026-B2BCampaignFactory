import { Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import FactoryConsole from './pages/FactoryConsole'
import BrandAPos from './pages/BrandAPos'
import BrandBRedeem from './pages/BrandBRedeem'

export default function App() {
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/" element={<FactoryConsole />} />
        <Route path="/brand-a" element={<BrandAPos />} />
        <Route path="/brand-b" element={<BrandBRedeem />} />
      </Routes>
    </>
  )
}