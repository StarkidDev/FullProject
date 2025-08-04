import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { Toaster } from 'react-hot-toast';
import { supabase } from './config/supabase';
import { paymentsAPI } from './config/api';

// Context
import { AuthProvider, useAuth } from './contexts/AuthContext';

// Components
import Layout from './components/Layout/Layout';
import LoadingSpinner from './components/UI/LoadingSpinner';

// Pages
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import EventsPage from './pages/EventsPage';
import EventDetailPage from './pages/EventDetailPage';
import VotePage from './pages/VotePage';
import PaymentSuccessPage from './pages/PaymentSuccessPage';
import PaymentFailedPage from './pages/PaymentFailedPage';

// Dashboard Pages
import OrganizerDashboard from './pages/Dashboard/OrganizerDashboard';
import AdminDashboard from './pages/Dashboard/AdminDashboard';
import VoterDashboard from './pages/Dashboard/VoterDashboard';

// Organizer Pages
import CreateEventPage from './pages/Organizer/CreateEventPage';
import ManageEventPage from './pages/Organizer/ManageEventPage';
import EarningsPage from './pages/Organizer/EarningsPage';

// Admin Pages
import UsersManagementPage from './pages/Admin/UsersManagementPage';
import PlatformSettingsPage from './pages/Admin/PlatformSettingsPage';
import PaymentAnalyticsPage from './pages/Admin/PaymentAnalyticsPage';

// Error Pages
import NotFoundPage from './pages/NotFoundPage';
import UnauthorizedPage from './pages/UnauthorizedPage';

import './index.css';

// Initialize Stripe
let stripePromise;

function App() {
  const [stripePublishableKey, setStripePublishableKey] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Initialize Stripe and get payment settings
    const initializePayments = async () => {
      try {
        const response = await paymentsAPI.getSettings();
        const { stripe_publishable_key } = response.data;
        
        if (stripe_publishable_key) {
          setStripePublishableKey(stripe_publishable_key);
          stripePromise = loadStripe(stripe_publishable_key);
        }
      } catch (error) {
        console.warn('Failed to initialize Stripe:', error);
      } finally {
        setLoading(false);
      }
    };

    initializePayments();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise}>
      <AuthProvider>
        <Router>
          <div className="App">
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 4000,
                style: {
                  background: '#363636',
                  color: '#fff',
                },
                success: {
                  style: {
                    background: '#22c55e',
                  },
                },
                error: {
                  style: {
                    background: '#ef4444',
                  },
                },
              }}
            />
            <Routes>
              {/* Public Routes */}
              <Route path="/" element={<Layout><HomePage /></Layout>} />
              <Route path="/events" element={<Layout><EventsPage /></Layout>} />
              <Route path="/events/:id" element={<Layout><EventDetailPage /></Layout>} />
              <Route path="/vote/:contestantId" element={<Layout><VotePage /></Layout>} />
              
              {/* Auth Routes */}
              <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
              <Route path="/register" element={<GuestRoute><RegisterPage /></GuestRoute>} />
              
              {/* Payment Routes */}
              <Route path="/payment/success" element={<Layout><PaymentSuccessPage /></Layout>} />
              <Route path="/payment/failed" element={<Layout><PaymentFailedPage /></Layout>} />
              
              {/* Protected Routes */}
              <Route path="/dashboard" element={<ProtectedRoute><DashboardRouter /></ProtectedRoute>} />
              
              {/* Organizer Routes */}
              <Route path="/organizer/*" element={
                <ProtectedRoute roles={['organizer']}>
                  <OrganizerRoutes />
                </ProtectedRoute>
              } />
              
              {/* Admin Routes */}
              <Route path="/admin/*" element={
                <ProtectedRoute roles={['admin']}>
                  <AdminRoutes />
                </ProtectedRoute>
              } />
              
              {/* Error Routes */}
              <Route path="/unauthorized" element={<Layout><UnauthorizedPage /></Layout>} />
              <Route path="*" element={<Layout><NotFoundPage /></Layout>} />
            </Routes>
          </div>
        </Router>
      </AuthProvider>
    </Elements>
  );
}

// Route protection components
function GuestRoute({ children }) {
  const { user, loading } = useAuth();
  
  if (loading) {
    return <LoadingSpinner size="lg" />;
  }
  
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }
  
  return children;
}

function ProtectedRoute({ children, roles = [] }) {
  const { user, loading } = useAuth();
  
  if (loading) {
    return <LoadingSpinner size="lg" />;
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  if (roles.length > 0 && !roles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }
  
  return children;
}

// Dashboard router based on user role
function DashboardRouter() {
  const { user } = useAuth();
  
  switch (user?.role) {
    case 'admin':
      return <Layout><AdminDashboard /></Layout>;
    case 'organizer':
      return <Layout><OrganizerDashboard /></Layout>;
    default:
      return <Layout><VoterDashboard /></Layout>;
  }
}

// Organizer subroutes
function OrganizerRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Layout><OrganizerDashboard /></Layout>} />
      <Route path="/events/create" element={<Layout><CreateEventPage /></Layout>} />
      <Route path="/events/:id/manage" element={<Layout><ManageEventPage /></Layout>} />
      <Route path="/earnings" element={<Layout><EarningsPage /></Layout>} />
    </Routes>
  );
}

// Admin subroutes
function AdminRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Layout><AdminDashboard /></Layout>} />
      <Route path="/users" element={<Layout><UsersManagementPage /></Layout>} />
      <Route path="/settings" element={<Layout><PlatformSettingsPage /></Layout>} />
      <Route path="/analytics" element={<Layout><PaymentAnalyticsPage /></Layout>} />
    </Routes>
  );
}

export default App;