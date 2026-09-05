import { Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import CampaignWizard from './pages/CampaignWizard'
import CampaignsList from './pages/CampaignsList'
import BrandAPos from './pages/BrandAPos'
import BrandBRedeem from './pages/BrandBRedeem'

export default function App() {
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/" element={<CampaignWizard />} />
        <Route path="/campaigns" element={<CampaignsList />} />
        <Route path="/brand-a" element={<BrandAPos />} />
        <Route path="/brand-b" element={<BrandBRedeem />} />
      </Routes>
    </>
  )
}