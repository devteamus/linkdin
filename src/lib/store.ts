'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { api, clearToken, type User, type LinkedinAccount, type DashboardStats, type ApiUsageStats } from './api';

type AppView = 'landing' | 'dashboard';
type DashboardTab =
  | 'overview'
  | 'accounts'
  | 'create-post'
  | 'bulk-post'
  | 'history'
  | 'csv-history'   // NEW — CSV Upload History tab
  | 'upgrade';
// LandingSection is used for scroll-to-section on the home page
type LandingSection = 'home' | 'features' | 'pricing' | 'faq';
// LandingPage is used for full-page client-side navigation
type LandingPageView = 'home' | 'about' | 'contact' | 'privacy' | 'terms';
type AuthModal = 'none' | 'login' | 'signup' | 'forgot-password';
type LegalModal = 'none' | 'privacy' | 'terms';

interface AppState {
  // View management
  view: AppView;
  setView: (view: AppView) => void;
  dashboardTab: DashboardTab;
  setDashboardTab: (tab: DashboardTab) => void;
  landingSection: LandingSection;
  setLandingSection: (section: LandingSection) => void;
  scrollToSection: (section: LandingSection) => void;

  // Client-side page navigation within landing
  landingPage: LandingPageView;
  setLandingPage: (page: LandingPageView) => void;

  // Auth
  user: User | null;
  isLoadingAuth: boolean;
  authModal: AuthModal;
  setAuthModal: (modal: AuthModal) => void;
  legalModal: LegalModal;
  setLegalModal: (modal: LegalModal) => void;
  fetchUser: () => Promise<void>;
  logout: () => Promise<void>;

  // Accounts
  accounts: LinkedinAccount[];
  isLoadingAccounts: boolean;
  fetchAccounts: () => Promise<void>;

  // Stats
  stats: DashboardStats | null;
  isLoadingStats: boolean;
  fetchStats: () => Promise<void>;

  // API Usage (NEW — for the API Call Counter card)
  apiUsage: ApiUsageStats | null;
  isLoadingApiUsage: boolean;
  fetchApiUsage: () => Promise<void>;

  // Which connected LinkedIn account the Overview dashboard's usage cards
  // are scoped to. `null` means "All accounts" (aggregate across every
  // connected account — the pre-existing behavior). Changing this and
  // calling refreshDashboard() re-fetches stats/usage scoped to just that
  // one account, so switching accounts never shows another account's numbers.
  selectedUsageAccountId: string | null;
  setSelectedUsageAccountId: (accountId: string | null) => void;

  // Refresh helpers
  refreshDashboard: () => Promise<void>;

  // Plan refresh
  refreshUserPlan: () => Promise<void>;

  // LinkedIn OAuth
  linkedinConnected: boolean;
  setLinkedinConnected: (val: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // View
      view: 'landing',
      setView: (view) => set({ view }),
      // dashboardTab is persisted — reloading the page keeps the user on
      // whatever sub-tab they had open (Overview / Accounts / Create Post /
      // Bulk Post / History / CSV History / Upgrade) instead of always
      // snapping back to Overview. This is the fix for the bug where
      // "open any function and reload → goes to Overview".
      dashboardTab: 'overview',
      setDashboardTab: (dashboardTab) => set({ dashboardTab }),
      landingSection: 'home',
      setLandingSection: (landingSection) => set({ landingSection }),
      scrollToSection: (section) => {
        set({ landingSection: section, landingPage: 'home' });
        // Small delay to allow section to render
        requestAnimationFrame(() => {
          const el = document.getElementById(`section-${section}`);
          if (el) el.scrollIntoView({ behavior: 'smooth' });
        });
      },

      // Client-side page navigation
      landingPage: 'home',
      setLandingPage: (page) => {
        set({ landingPage: page });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },

      // Auth
      user: null,
      isLoadingAuth: true,
      authModal: 'none',
      setAuthModal: (authModal) => set({ authModal }),
      legalModal: 'none',
      setLegalModal: (legalModal) => set({ legalModal }),
      fetchUser: async () => {
        set({ isLoadingAuth: true });
        try {
          const res = await api.me();
          set({ user: res.user, isLoadingAuth: false, view: 'dashboard' });
        } catch {
          set({ user: null, isLoadingAuth: false });
        }
      },
      logout: async () => {
        try {
          await api.logout();
        } catch {
          // Ignore
        }
        clearToken();
        // Reset tab back to overview on explicit logout so the next login
        // starts fresh.
        set({ user: null, view: 'landing', dashboardTab: 'overview', landingPage: 'home' });
      },

      // Accounts
      accounts: [],
      isLoadingAccounts: false,
      fetchAccounts: async () => {
        set({ isLoadingAccounts: true });
        try {
          const accounts = await api.getAccounts();
          set({ accounts, isLoadingAccounts: false });
        } catch {
          set({ isLoadingAccounts: false });
        }
      },

      // Stats
      stats: null,
      isLoadingStats: false,
      fetchStats: async () => {
        set({ isLoadingStats: true });
        try {
          const stats = await api.getStats(get().selectedUsageAccountId || undefined);
          set({ stats, isLoadingStats: false });
        } catch {
          set({ isLoadingStats: false });
        }
      },

      // API Usage (NEW)
      apiUsage: null,
      isLoadingApiUsage: false,
      fetchApiUsage: async () => {
        set({ isLoadingApiUsage: true });
        try {
          const apiUsage = await api.getApiUsage(get().selectedUsageAccountId || undefined);
          set({ apiUsage, isLoadingApiUsage: false });
        } catch {
          set({ isLoadingApiUsage: false });
        }
      },

      selectedUsageAccountId: null,
      setSelectedUsageAccountId: (accountId) => {
        set({ selectedUsageAccountId: accountId });
        // Immediately re-fetch both cards scoped to the newly selected account
        // (or back to the aggregate view when accountId is null) so the
        // dashboard never shows stale numbers from the previously selected account.
        const { fetchStats, fetchApiUsage } = get();
        fetchStats();
        fetchApiUsage();
      },

      refreshDashboard: async () => {
        const { fetchStats, fetchAccounts, fetchApiUsage } = get();
        await Promise.all([fetchStats(), fetchAccounts(), fetchApiUsage()]);
      },

      refreshUserPlan: async () => {
        try {
          const res = await api.me();
          set({ user: res.user });
        } catch {
          // ignore
        }
      },

      // LinkedIn OAuth
      linkedinConnected: false,
      setLinkedinConnected: (val) => set({ linkedinConnected: val }),
    }),
    {
      // Only persist the dashboard tab across reloads. Everything else
      // (user, accounts, stats, auth) is re-fetched on mount anyway, so
      // persisting them would just produce stale data flashes.
      name: 'postgo-ui-state',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ dashboardTab: state.dashboardTab }),
      version: 1,
    }
  )
);

export type { AppView, DashboardTab, LandingSection, LandingPageView, AuthModal, LegalModal };
