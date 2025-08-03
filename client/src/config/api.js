import axios from 'axios';
import { getSession } from './supabase';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// Create axios instance
const api = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 30000,
});

// Request interceptor to add auth token
api.interceptors.request.use(
  async (config) => {
    try {
      const { session } = await getSession();
      if (session?.access_token) {
        config.headers.Authorization = `Bearer ${session.access_token}`;
      }
    } catch (error) {
      console.warn('Failed to get session for API request:', error);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Redirect to login if unauthorized
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// API endpoints
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  refreshToken: (refreshToken) => api.post('/auth/refresh', { refresh_token: refreshToken }),
  getProfile: () => api.get('/auth/me'),
  updateProfile: (data) => api.put('/auth/me', data),
  requestOrganizerRole: () => api.post('/auth/request-organizer'),
  changePassword: (data) => api.post('/auth/change-password', data),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
  resetPassword: (data) => api.post('/auth/reset-password', data),
};

export const eventsAPI = {
  getEvents: (params) => api.get('/events', { params }),
  getEvent: (id) => api.get(`/events/${id}`),
  getMyEvents: (params) => api.get('/events/organizer/my-events', { params }),
  createEvent: (data) => api.post('/events', data),
  updateEvent: (id, data) => api.put(`/events/${id}`, data),
  activateEvent: (id) => api.post(`/events/${id}/activate`),
  endEvent: (id) => api.post(`/events/${id}/end`),
  deleteEvent: (id) => api.delete(`/events/${id}`),
  getEventStats: (id) => api.get(`/events/${id}/stats`),
};

export const categoriesAPI = {
  getEventCategories: (eventId) => api.get(`/categories/event/${eventId}`),
  getCategory: (id) => api.get(`/categories/${id}`),
  createCategory: (data) => api.post('/categories', data),
  updateCategory: (id, data) => api.put(`/categories/${id}`, data),
  deleteCategory: (id) => api.delete(`/categories/${id}`),
  reorderCategories: (data) => api.post('/categories/reorder', data),
  getCategoryStats: (id) => api.get(`/categories/${id}/stats`),
};

export const contestantsAPI = {
  getCategoryContestants: (categoryId) => api.get(`/contestants/category/${categoryId}`),
  getContestant: (id) => api.get(`/contestants/${id}`),
  createContestant: (data) => api.post('/contestants', data),
  updateContestant: (id, data) => api.put(`/contestants/${id}`, data),
  deleteContestant: (id) => api.delete(`/contestants/${id}`),
  reorderContestants: (data) => api.post('/contestants/reorder', data),
  getContestantStats: (id) => api.get(`/contestants/${id}/stats`),
  bulkCreateContestants: (data) => api.post('/contestants/bulk', data),
};

export const votesAPI = {
  getEventVotes: (eventId, params) => api.get(`/votes/event/${eventId}`, { params }),
  getMyVotes: (params) => api.get('/votes/my-votes', { params }),
  createVote: (data) => api.post('/votes', data),
  getContestantStats: (contestantId) => api.get(`/votes/contestant/${contestantId}/stats`),
  getEventFeed: (eventId, params) => api.get(`/votes/event/${eventId}/feed`, { params }),
  getLeaderboard: (eventId, params) => api.get(`/votes/event/${eventId}/leaderboard`, { params }),
  canVote: (contestantId) => api.get(`/votes/can-vote/${contestantId}`),
};

export const paymentsAPI = {
  getSettings: () => api.get('/payments/settings'),
  createStripeIntent: (data) => api.post('/payments/stripe/create-intent', data),
  initializePaystack: (data) => api.post('/payments/paystack/initialize', data),
  verifyPayment: (paymentId) => api.get(`/payments/verify/${paymentId}`),
  getPaymentHistory: (params) => api.get('/payments/history', { params }),
  cancelPayment: (paymentId) => api.post(`/payments/cancel/${paymentId}`),
};

export const adminAPI = {
  getDashboard: () => api.get('/admin/dashboard'),
  getUsers: (params) => api.get('/admin/users', { params }),
  updateUser: (userId, data) => api.put(`/admin/users/${userId}`, data),
  deleteUser: (userId) => api.delete(`/admin/users/${userId}`),
  getSettings: () => api.get('/admin/settings'),
  updateSettings: (data) => api.put('/admin/settings', data),
  getEvents: (params) => api.get('/admin/events', { params }),
  forceEndEvent: (eventId) => api.post(`/admin/events/${eventId}/force-end`),
  getPaymentAnalytics: (params) => api.get('/admin/payments/analytics', { params }),
  getWithdrawals: (params) => api.get('/admin/withdrawals', { params }),
  processWithdrawal: (withdrawalId, data) => api.post(`/admin/withdrawals/${withdrawalId}/process`, data),
  getSystemHealth: () => api.get('/admin/system/health'),
};

export const organizerAPI = {
  getDashboard: () => api.get('/organizer/dashboard'),
  getEarnings: (params) => api.get('/organizer/earnings', { params }),
  getWithdrawals: (params) => api.get('/organizer/withdrawals', { params }),
  requestWithdrawal: (data) => api.post('/organizer/withdrawals', data),
  cancelWithdrawal: (withdrawalId) => api.delete(`/organizer/withdrawals/${withdrawalId}`),
  getEarningsAnalytics: (params) => api.get('/organizer/analytics/earnings', { params }),
  getWithdrawalInfo: () => api.get('/organizer/withdrawal-info'),
};

export const uploadAPI = {
  uploadEventBanner: (file) => {
    const formData = new FormData();
    formData.append('banner', file);
    return api.post('/upload/event-banner', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  uploadContestantImage: (file) => {
    const formData = new FormData();
    formData.append('image', file);
    return api.post('/upload/contestant-image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  uploadContestantImages: (files) => {
    const formData = new FormData();
    files.forEach(file => formData.append('images', file));
    return api.post('/upload/contestant-images', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  deleteImage: (data) => api.delete('/upload/image', { data }),
  getUploadUrl: (type, params) => api.get(`/upload/upload-url/${type}`, { params }),
  getImageInfo: (params) => api.get('/upload/image/info', { params }),
  listImages: (params) => api.get('/upload/images', { params }),
};

export default api;