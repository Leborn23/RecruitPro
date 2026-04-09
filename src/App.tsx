import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import Dashboard from './pages/Dashboard';
import Salary from './pages/Salary';
import Candidates from './pages/Candidates';
import CandidateDetail from './pages/CandidateDetail';
import Positions from './pages/Positions';
import Screening from './pages/Screening';
import Interviews from './pages/Interviews';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import AdminManagement from './pages/AdminManagement';
import InterviewRoom from './pages/InterviewRoom';
import OrganizationSettings from './pages/settings/OrganizationSettings';
import AiPolicySettings from './pages/settings/AiPolicySettings';
import BillingSettings from './pages/settings/BillingSettings';
import DangerSettings from './pages/settings/DangerSettings';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/auth/ProtectedRoute';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/interview-room/:interviewId" element={<ProtectedRoute><InterviewRoom /></ProtectedRoute>} />
          <Route path="/" element={<AppLayout />}>
            <Route index element={<ProtectedRoute permission="VIEW_DASHBOARD"><Dashboard /></ProtectedRoute>} />
            <Route path="positions" element={<ProtectedRoute permission="MANAGE_POSITIONS"><Positions /></ProtectedRoute>} />
            <Route path="screening" element={<ProtectedRoute permission="SCREEN_RESUMES"><Screening /></ProtectedRoute>} />
            <Route path="candidates" element={<ProtectedRoute permission="VIEW_CANDIDATES"><Candidates /></ProtectedRoute>} />
            <Route path="candidates/:id" element={<ProtectedRoute permission="VIEW_CANDIDATES"><CandidateDetail /></ProtectedRoute>} />
            <Route path="interviews" element={<ProtectedRoute permission="MANAGE_INTERVIEWS"><Interviews /></ProtectedRoute>} />
            <Route path="salary" element={<ProtectedRoute permission="VIEW_SALARY"><Salary /></ProtectedRoute>} />
            <Route path="settings" element={<ProtectedRoute permission="MANAGE_SETTINGS"><Settings /></ProtectedRoute>}>
              <Route index element={<Navigate to="organization" replace />} />
              <Route path="organization" element={<OrganizationSettings />} />
              <Route path="ai-policy" element={<AiPolicySettings />} />
              <Route path="access" element={<ProtectedRoute requireSuperAdmin><AdminManagement /></ProtectedRoute>} />
              <Route path="billing" element={<BillingSettings />} />
              <Route path="danger" element={<DangerSettings />} />
            </Route>
            <Route path="profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="admin/users" element={<Navigate to="/settings/access" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
