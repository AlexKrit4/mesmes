import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Home from './pages/Home.jsx';
import Chat from './pages/Chat.jsx';
import ChannelPage from './pages/ChannelPage.jsx';
import ChannelPostComments from './pages/ChannelPostComments.jsx';
import JoinChannel from './pages/JoinChannel.jsx';
import Settings from './pages/Settings.jsx';
import AdminPanel from './pages/AdminPanel.jsx';
import Profile from './pages/Profile.jsx';
import PremiumPage from './pages/PremiumPage.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';

function PrivateRoute({ children }) {
  return localStorage.getItem('token') ? children : <Navigate to="/login" replace />;
}

function PublicRoute({ children }) {
  return localStorage.getItem('token') ? <Navigate to="/" replace /> : children;
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export default function App() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
          <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
          <Route path="/reset-password/:token" element={<ResetPassword />} />
          <Route path="/" element={<PrivateRoute><Home /></PrivateRoute>} />
          <Route path="/chat/:friendId" element={<PrivateRoute><Chat /></PrivateRoute>} />
          <Route path="/channel/:id" element={<PrivateRoute><ChannelPage /></PrivateRoute>} />
          <Route path="/channel/:id/post/:postId" element={<PrivateRoute><ChannelPostComments /></PrivateRoute>} />
          <Route path="/join/:code" element={<PrivateRoute><JoinChannel /></PrivateRoute>} />
          <Route path="/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />
          <Route path="/admin" element={<PrivateRoute><AdminPanel /></PrivateRoute>} />
          <Route path="/premium" element={<PrivateRoute><PremiumPage /></PrivateRoute>} />
          <Route path="/:publicId" element={<PrivateRoute><Profile /></PrivateRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </GoogleOAuthProvider>
  );
}
