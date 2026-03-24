import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Home from './pages/Home.jsx';
import Chat from './pages/Chat.jsx';
import CallPage from './pages/CallPage.jsx';
import ChannelPage from './pages/ChannelPage.jsx';
import ChannelInfoPage from './pages/ChannelInfoPage.jsx';
import ChannelPostComments from './pages/ChannelPostComments.jsx';
import JoinChannel from './pages/JoinChannel.jsx';
import Settings from './pages/Settings.jsx';
import AdminPanel from './pages/AdminPanel.jsx';
import Profile from './pages/Profile.jsx';
import PremiumPage from './pages/PremiumPage.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import { connectSocket, getSocket } from './socket.js';

const PENDING_INCOMING_CALL_KEY = 'pending_incoming_call';

function PrivateRoute({ children }) {
  return localStorage.getItem('token') ? children : <Navigate to="/login" replace />;
}

function PublicRoute({ children }) {
  return localStorage.getItem('token') ? <Navigate to="/" replace /> : children;
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

function GlobalIncomingCallOverlay() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location.pathname);
  const [incomingCall, setIncomingCall] = useState(null);

  useEffect(() => {
    locationRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const socket = connectSocket();
    if (!socket) return;

    const onCallOffer = ({ from, from_username, offer, callId }) => {
      if (!from || !offer || !callId) return;
      setIncomingCall((prev) => {
        if (prev?.from && prev.from !== from) {
          socket.emit('call_reject', { to: from, reason: 'busy', callId });
          return prev;
        }
        return {
          from,
          username: from_username || 'Пользователь',
          offer,
          callId,
        };
      });
    };

    const clearIncomingIfMatches = ({ from }) => {
      if (!from) return;
      setIncomingCall((prev) => (prev?.from === from ? null : prev));
    };

    socket.on('call_offer', onCallOffer);
    socket.on('call_end', clearIncomingIfMatches);
    socket.on('call_reject', clearIncomingIfMatches);

    return () => {
      socket.off('call_offer', onCallOffer);
      socket.off('call_end', clearIncomingIfMatches);
      socket.off('call_reject', clearIncomingIfMatches);
    };
  }, []);

  const declineCall = () => {
    const socket = getSocket();
    if (socket && incomingCall?.from) {
      socket.emit('call_reject', { to: incomingCall.from, reason: 'rejected', callId: incomingCall.callId });
    }
    setIncomingCall(null);
  };

  const acceptCall = () => {
    if (!incomingCall?.from || !incomingCall?.offer || !incomingCall?.callId) return;
    sessionStorage.setItem(
      PENDING_INCOMING_CALL_KEY,
      JSON.stringify({
        from: incomingCall.from,
        username: incomingCall.username,
        offer: incomingCall.offer,
        callId: incomingCall.callId,
        autoAccept: true,
        createdAt: Date.now(),
      })
    );
    window.dispatchEvent(new Event('pending_incoming_call'));
    setIncomingCall(null);
    if (locationRef.current !== `/chat/${incomingCall.from}`) {
      navigate(`/chat/${incomingCall.from}`);
    }
  };

  if (!incomingCall || !localStorage.getItem('token')) return null;

  return (
    <div className="global-call-overlay" onClick={declineCall}>
      <div className="global-call-card" onClick={(e) => e.stopPropagation()}>
        <div className="global-call-title">Входящий звонок</div>
        <div className="global-call-subtitle">{incomingCall.username}</div>
        <div className="global-call-actions">
          <button className="call-btn-decline" onClick={declineCall}>Отклонить</button>
          <button className="call-btn-accept" onClick={acceptCall}>Принять</button>
        </div>
      </div>
    </div>
  );
}

function AppRoutes() {
  return (
    <>
      <GlobalIncomingCallOverlay />
      <Routes>
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
        <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
        <Route path="/reset-password/:token" element={<ResetPassword />} />
        <Route path="/" element={<PrivateRoute><Home /></PrivateRoute>} />
        <Route path="/chat/:friendId" element={<PrivateRoute><Chat /></PrivateRoute>} />
        <Route path="/channel/:id" element={<PrivateRoute><ChannelPage /></PrivateRoute>} />
        <Route path="/channel/:id/info" element={<PrivateRoute><ChannelInfoPage /></PrivateRoute>} />
        <Route path="/channel/:id/post/:postId" element={<PrivateRoute><ChannelPostComments /></PrivateRoute>} />
        <Route path="/join/:code" element={<PrivateRoute><JoinChannel /></PrivateRoute>} />
        <Route path="/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />
        <Route path="/admin" element={<PrivateRoute><AdminPanel /></PrivateRoute>} />
        <Route path="/call/:friendId" element={<PrivateRoute><CallPage /></PrivateRoute>} />
        <Route path="/premium" element={<PrivateRoute><PremiumPage /></PrivateRoute>} />
        <Route path="/:publicId" element={<PrivateRoute><Profile /></PrivateRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </GoogleOAuthProvider>
  );
}
