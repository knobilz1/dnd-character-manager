import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { WizardPage } from './pages/wizard/WizardPage';
import { SheetPage } from './pages/sheet/SheetPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="create" element={<WizardPage />} />
        <Route path="character/:id" element={<SheetPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
