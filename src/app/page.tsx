'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import LandingPage from '@/components/landing/LandingPage';
import Dashboard from '@/components/dashboard/Dashboard';
import AdminPanel from '@/components/admin/AdminPanel';
import { AuthModals } from '@/components/modals/AuthModals';
import TelegramChat from '@/components/landing/TelegramChat';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

function LinkedInCallbackHandler() {
  const { linkedinConnected, setLinkedinConnected, fetchAccounts, setDashboardTab } = useAppStore();
  const searchParams = useSearchParams();
  const linkedinParam = searchParams.get('linkedin');

  useEffect(() => {
    if (!linkedinParam) return;
    if (linkedinParam === 'connected' && !linkedinConnected) {
      setLinkedinConnected(true);
      fetchAccounts();
      setDashboardTab('accounts');
      toast.success('LinkedIn account connected successfully!');
    } else if (linkedinParam === 'error') {
      toast.error('Failed to connect LinkedIn account. Please try again.');
    } else if (linkedinParam === 'limit') {
      toast.error('Your plan\u2019s account limit has been reached. Upgrade to connect more.');
    }
  }, [linkedinParam, linkedinConnected, setLinkedinConnected, fetchAccounts, setDashboardTab]);

  return null;
}

function AuthGate() {
  const { view, user, isLoadingAuth } = useAppStore();

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-lg">P</span>
          </div>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // Admin users see AdminPanel instead of Dashboard
  const isAdmin = view === 'dashboard' && user?.role === 'admin';

  return (
    <>
      {view === 'landing' ? <LandingPage /> : isAdmin ? <AdminPanel /> : <Dashboard />}
      <AuthModals />
      <TelegramChat />
    </>
  );
}

export default function Home() {
  const { fetchUser } = useAppStore();

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <LinkedInCallbackHandler />
      <AuthGate />
    </Suspense>
  );
}
