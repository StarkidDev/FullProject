import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../config/supabase';
import { authAPI } from '../config/api';
import toast from 'react-hot-toast';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);

  useEffect(() => {
    // Get initial session
    const getInitialSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Error getting session:', error);
          setLoading(false);
          return;
        }

        if (session) {
          setSession(session);
          await fetchUserProfile(session.user);
        }
      } catch (error) {
        console.error('Error in getInitialSession:', error);
      } finally {
        setLoading(false);
      }
    };

    getInitialSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state change:', event, session?.user?.id);
        
        setSession(session);
        
        if (session?.user) {
          await fetchUserProfile(session.user);
        } else {
          setUser(null);
        }
        
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const fetchUserProfile = async (authUser) => {
    try {
      // Get user profile from our API
      const response = await authAPI.getProfile();
      const userProfile = response.data.user;
      
      setUser({
        ...authUser,
        ...userProfile
      });
    } catch (error) {
      console.error('Error fetching user profile:', error);
      // If profile fetch fails, set basic user info from auth
      setUser(authUser);
    }
  };

  const login = async (email, password) => {
    try {
      setLoading(true);
      
      const response = await authAPI.login({ email, password });
      const { user: userProfile, session: userSession } = response.data;
      
      setSession(userSession);
      setUser(userProfile);
      
      toast.success('Logged in successfully!');
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || 'Login failed';
      toast.error(message);
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  };

  const register = async (userData) => {
    try {
      setLoading(true);
      
      const response = await authAPI.register(userData);
      
      toast.success('Registration successful! Please check your email to confirm your account.');
      return { success: true, data: response.data };
    } catch (error) {
      const message = error.response?.data?.message || 'Registration failed';
      toast.error(message);
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      setLoading(true);
      
      await authAPI.logout();
      await supabase.auth.signOut();
      
      setUser(null);
      setSession(null);
      
      toast.success('Logged out successfully!');
      return { success: true };
    } catch (error) {
      console.error('Logout error:', error);
      // Even if API call fails, clear local state
      setUser(null);
      setSession(null);
      return { success: true };
    } finally {
      setLoading(false);
    }
  };

  const updateProfile = async (profileData) => {
    try {
      const response = await authAPI.updateProfile(profileData);
      const updatedUser = response.data.user;
      
      setUser(prevUser => ({
        ...prevUser,
        ...updatedUser
      }));
      
      toast.success('Profile updated successfully!');
      return { success: true, data: updatedUser };
    } catch (error) {
      const message = error.response?.data?.message || 'Profile update failed';
      toast.error(message);
      return { success: false, error: message };
    }
  };

  const requestOrganizerRole = async () => {
    try {
      const response = await authAPI.requestOrganizerRole();
      const updatedUser = response.data.user;
      
      setUser(prevUser => ({
        ...prevUser,
        ...updatedUser
      }));
      
      toast.success('Organizer role requested! Your request is under review.');
      return { success: true, data: updatedUser };
    } catch (error) {
      const message = error.response?.data?.message || 'Request failed';
      toast.error(message);
      return { success: false, error: message };
    }
  };

  const changePassword = async (currentPassword, newPassword) => {
    try {
      await authAPI.changePassword({
        current_password: currentPassword,
        new_password: newPassword
      });
      
      toast.success('Password changed successfully!');
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || 'Password change failed';
      toast.error(message);
      return { success: false, error: message };
    }
  };

  const forgotPassword = async (email) => {
    try {
      await authAPI.forgotPassword(email);
      
      toast.success('Password reset instructions sent to your email!');
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || 'Password reset failed';
      toast.error(message);
      return { success: false, error: message };
    }
  };

  const resetPassword = async (accessToken, refreshToken, newPassword) => {
    try {
      await authAPI.resetPassword({
        access_token: accessToken,
        refresh_token: refreshToken,
        new_password: newPassword
      });
      
      toast.success('Password reset successfully!');
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || 'Password reset failed';
      toast.error(message);
      return { success: false, error: message };
    }
  };

  // Helper functions
  const isAdmin = () => user?.role === 'admin';
  const isOrganizer = () => user?.role === 'organizer';
  const isApprovedOrganizer = () => user?.role === 'organizer' && user?.organizer_status === 'approved';
  const isVoter = () => user?.role === 'voter' || !user?.role;

  const value = {
    user,
    session,
    loading,
    login,
    register,
    logout,
    updateProfile,
    requestOrganizerRole,
    changePassword,
    forgotPassword,
    resetPassword,
    isAdmin,
    isOrganizer,
    isApprovedOrganizer,
    isVoter,
    refetchProfile: () => fetchUserProfile(session?.user)
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};