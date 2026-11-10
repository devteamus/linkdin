'use client';

import { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard,
  Users,
  PenSquare,
  FileSpreadsheet,
  History,
  HistoryIcon,
  LogOut,
  Menu,
  Send,
  CalendarClock,
  AlertCircle,
  AlertTriangle,
  Plus,
  Unplug,
  Eye,
  Download,
  Upload,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
  Crown,
  Lock,
  Copy,
  CheckCircle2,
  CreditCard,
  Wallet,
  Clock,
  XCircle,
  ExternalLink,
  Timer,
  RefreshCw,
  Activity,
  Play,
  Pause,
  Power,
  Trash2,
  Video,
  Image as ImageIcon,
  Gauge,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';

import { useAppStore } from '@/lib/store';
import {
  api,
  type PostWithAccount,
  type Payment,
  type BulkUploadResult,
  type CsvUploadDetail,
  type CsvUploadPost,
  type CsvUploadSummary,
  type AccountHistoryResponse,
  type AccountHistoryPost,
  ApiError,
} from '@/lib/api';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

// ─── Helper Functions ──────────────────────────────────────────────

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncate(str: string, len: number) {
  if (str.length <= len) return str;
  return str.slice(0, len) + '...';
}

function statusBadge(status: string) {
  switch (status) {
    case 'pending':
      return <Badge variant="outline" className="border-yellow-500 text-yellow-600 bg-yellow-50">Pending</Badge>;
    case 'scheduled':
      return <Badge variant="outline" className="border-blue-500 text-blue-600 bg-blue-50">Scheduled</Badge>;
    case 'published':
      return <Badge className="bg-[#0A66C2] text-white hover:bg-[#0A66C2]">Published</Badge>;
    case 'failed':
      return <Badge variant="destructive">Failed</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

// ─── Constants ─────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'overview' as const, label: 'Overview', icon: LayoutDashboard },
  { id: 'accounts' as const, label: 'Accounts', icon: Users },
  { id: 'create-post' as const, label: 'Create Post', icon: PenSquare },
  { id: 'bulk-post' as const, label: 'Bulk Post', icon: FileSpreadsheet },
  { id: 'history' as const, label: 'History', icon: History },
  { id: 'csv-history' as const, label: 'CSV History', icon: HistoryIcon },
  { id: 'account-history' as const, label: 'Account History', icon: Clock },
  { id: 'upgrade' as const, label: 'Upgrade', icon: Crown },
];

const TAB_TITLES: Record<string, string> = {
  overview: 'Overview',
  accounts: 'LinkedIn Accounts',
  'create-post': 'Create Post',
  'bulk-post': 'Bulk Upload',
  history: 'Post History',
  'csv-history': 'CSV Upload History',
  'account-history': 'Account History',
  'upgrade': 'Upgrade Plan',
};

// Public env var exposed by Next.js — set NEXT_PUBLIC_USDT_WALLET_ADDRESS in Coolify.
const USDT_WALLET_ADDRESS = process.env.NEXT_PUBLIC_USDT_WALLET_ADDRESS || '';

// ─── StatCard ──────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  icon: Icon,
  loading,
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  loading: boolean;
}) {
  return (
    <Card className="bg-card rounded-xl">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            {loading ? (
              <Skeleton className="h-8 w-16 mt-2" />
            ) : (
              <p className="text-3xl font-bold mt-1">{value}</p>
            )}
          </div>
          <div className="h-12 w-12 rounded-xl bg-[#0A66C2]/10 flex items-center justify-center">
            <Icon className="h-6 w-6 text-[#0A66C2]" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── SidebarContent (shared desktop/mobile) ────────────────────────

function SidebarContent({ onSelectTab, onLogout, currentTab }: {
  onSelectTab: (tab: 'overview' | 'accounts' | 'create-post' | 'bulk-post' | 'history' | 'csv-history' | 'account-history' | 'upgrade') => void;
  onLogout: () => void;
  currentTab: string;
}) {
  return (
    <div className="flex flex-col h-full py-4">
      <div className="px-6 mb-6">
        <h2 className="text-xl font-bold text-[#0A66C2]">LinkedIn PostGo</h2>
        <p className="text-xs text-muted-foreground">Post Manager</p>
      </div>
      <nav className="flex-1 px-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                onSelectTab(item.id);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                isActive
                  ? 'bg-[#0A66C2] text-white'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="px-3 mt-auto pt-4 border-t">
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors cursor-pointer"
        >
          <LogOut className="h-5 w-5" />
          Log Out
        </button>
      </div>
    </div>
  );
}

// ─── OverviewTab ───────────────────────────────────────────────────

function OverviewTab({ onSwitchTab }: { onSwitchTab: (tab: 'accounts' | 'create-post' | 'bulk-post' | 'history' | 'csv-history' | 'account-history' | 'upgrade') => void }) {
  const stats = useAppStore((s) => s.stats);
  const isLoadingStats = useAppStore((s) => s.isLoadingStats);
  const apiUsage = useAppStore((s) => s.apiUsage);
  const isLoadingApiUsage = useAppStore((s) => s.isLoadingApiUsage);
  const accounts = useAppStore((s) => s.accounts);
  const selectedUsageAccountId = useAppStore((s) => s.selectedUsageAccountId);
  const setSelectedUsageAccountId = useAppStore((s) => s.setSelectedUsageAccountId);

  const loading = isLoadingStats || !stats;
  const selectedAccountName = selectedUsageAccountId
    ? accounts.find((a) => a.id === selectedUsageAccountId)?.accountName
    : null;

  // API usage card numbers — fall back to stats-derived values if apiUsage
  // hasn't loaded yet so the card is never empty.
  const apiCallsUsed = apiUsage?.apiCallsUsed ?? stats?.apiCallsUsed ?? 0;
  const apiCallsLimit = apiUsage?.apiCallsLimit ?? stats?.apiCallsLimit ?? 150;
  const apiCallsRemaining = apiUsage?.apiCallsRemaining ?? Math.max(0, apiCallsLimit - apiCallsUsed);
  const postsToday = apiUsage?.postsPublishedToday ?? stats?.todayPosts ?? 0;
  const postsDailyLimit = apiUsage?.postsDailyLimit ?? stats?.postsDailyLimit ?? 50;
  const postsRemainingToday = apiUsage?.postsRemainingToday ?? Math.max(0, postsDailyLimit - postsToday);
  const resetTime = apiUsage?.resetTime;
  const usagePercent = apiCallsLimit > 0 ? Math.min(100, Math.round((apiCallsUsed / apiCallsLimit) * 100)) : 0;
  const postsPercent = postsDailyLimit > 0 ? Math.min(100, Math.round((postsToday / postsDailyLimit) * 100)) : 0;

  // ─── Monthly capacity numbers ───────────────────────────────────
  const postsThisMonth = apiUsage?.postsThisMonth ?? stats?.postsThisMonth ?? 0;
  const monthlyPostsLimit = apiUsage?.monthlyPostsLimit ?? stats?.monthlyPostsLimit ?? 0;
  const postsRemainingThisMonth = apiUsage?.postsRemainingThisMonth ?? stats?.postsRemainingThisMonth ?? Math.max(0, monthlyPostsLimit - postsThisMonth);
  const monthlyPercent = monthlyPostsLimit > 0 ? Math.min(100, Math.round((postsThisMonth / monthlyPostsLimit) * 100)) : 0;

  // ─── Subscription expiry numbers ────────────────────────────────
  // Only shown for paid plans (Free has no expiry).
  const user = useAppStore((s) => s.user);
  const rawPlan = stats?.rawPlan ?? apiUsage?.rawPlan ?? user?.plan ?? 'free';
  const isExpired = stats?.isExpired ?? apiUsage?.isExpired ?? user?.isExpired ?? false;
  const planExpiresAt = stats?.planExpiresAt ?? apiUsage?.planExpiresAt ?? user?.planExpiresAt ?? null;
  const isPaidPlan = rawPlan !== 'free';

  // Calculate days remaining (client-side, updates every render)
  const expiryDate = planExpiresAt ? new Date(planExpiresAt) : null;
  const now = new Date();
  const msRemaining = expiryDate ? expiryDate.getTime() - now.getTime() : 0;
  const daysRemaining = msRemaining > 0 ? Math.ceil(msRemaining / (24 * 60 * 60 * 1000)) : 0;
  const hoursRemaining = msRemaining > 0 ? Math.floor(msRemaining / (60 * 60 * 1000)) : 0;
  const isExpiringSoon = isPaidPlan && !isExpired && daysRemaining <= 5 && daysRemaining > 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Connected Accounts" value={stats?.totalAccounts ?? 0} icon={Users} loading={loading} />
        <StatCard title="Today's Posts" value={stats?.todayPosts ?? 0} icon={Send} loading={loading} />
        <StatCard title="Scheduled" value={stats?.scheduledPosts ?? 0} icon={CalendarClock} loading={loading} />
        <StatCard title="Failed" value={stats?.failedPosts ?? 0} icon={AlertCircle} loading={loading} />
      </div>

      {/* ─── Subscription Status Card (paid plans only) ─────────────── */}
      {isPaidPlan && (
        <Card
          className={
            'rounded-xl border-2 ' +
            (isExpired
              ? 'border-red-500 bg-red-50/50'
              : isExpiringSoon
              ? 'border-amber-500 bg-amber-50/50'
              : 'border-[#0A66C2]/30 bg-[#0A66C2]/5')
          }
        >
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div
                className={
                  'h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ' +
                  (isExpired
                    ? 'bg-red-100'
                    : isExpiringSoon
                    ? 'bg-amber-100'
                    : 'bg-[#0A66C2]/10')
                }
              >
                {isExpired ? (
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                ) : isExpiringSoon ? (
                  <AlertCircle className="h-5 w-5 text-amber-600" />
                ) : (
                  <Crown className="h-5 w-5 text-[#0A66C2]" />
                )}
              </div>
              <div className="flex-1">
                <CardTitle className="text-base flex items-center gap-2 capitalize">
                  {rawPlan} Plan Subscription
                  <Badge
                    className={
                      isExpired
                        ? 'bg-red-500 text-white hover:bg-red-500'
                        : isExpiringSoon
                        ? 'bg-amber-500 text-white hover:bg-amber-500'
                        : 'bg-[#0A66C2] text-white hover:bg-[#0A66C2]'
                    }
                  >
                    {isExpired ? 'Expired' : isExpiringSoon ? 'Expiring Soon' : 'Active'}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {isExpired
                    ? `Your ${rawPlan} subscription has expired — you're now on Free plan limits`
                    : `30-day subscription · ${expiryDate?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Big countdown display */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {isExpired ? 'Expired' : 'Days Remaining'}
                </p>
                <p
                  className={
                    'text-4xl font-bold mt-1 ' +
                    (isExpired
                      ? 'text-red-600'
                      : isExpiringSoon
                      ? 'text-amber-600'
                      : 'text-[#0A66C2]')
                  }
                >
                  {isExpired ? '0' : daysRemaining}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isExpired ? 'Renew to continue' : `~${hoursRemaining} hours`}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CalendarClock className="h-3 w-3" /> {isExpired ? 'Expired On' : 'Expires On'}
                </p>
                <p className="text-base font-bold mt-1">
                  {expiryDate?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {expiryDate?.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <RefreshCw className="h-3 w-3" /> Status
                </p>
                <p
                  className={
                    'text-base font-bold mt-1 capitalize ' +
                    (isExpired ? 'text-red-600' : 'text-green-600')
                  }
                >
                  {isExpired ? 'Expired' : 'Active'}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isExpired ? 'Renew now' : 'Auto-renew off'}
                </p>
              </div>
            </div>

            {/* Countdown progress bar (only when active) */}
            {!isExpired && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Subscription Progress (30 days)
                  </span>
                  <span className="text-xs font-bold">{30 - daysRemaining}/30 days used</span>
                </div>
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className={
                      'h-full transition-all duration-500 ' +
                      (isExpiringSoon ? 'bg-amber-500' : 'bg-[#0A66C2]/60')
                    }
                    style={{ width: `${((30 - daysRemaining) / 30) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Action button */}
            {(isExpired || isExpiringSoon) && (
              <Button
                className="w-full bg-[#0A66C2] hover:bg-[#004182] text-white"
                size="lg"
                onClick={() => onSwitchTab('upgrade')}
              >
                <Crown className="h-4 w-4 mr-2" />
                {isExpired ? 'Renew Subscription Now' : 'Renew Early (Keep Remaining Days)'}
              </Button>
            )}

            <p className="text-xs text-muted-foreground">
              <AlertCircle className="h-3 w-3 inline mr-1" />
              {isExpired
                ? `Your ${rawPlan} subscription has expired. All features have reverted to Free plan limits. Renew to restore your ${rawPlan} features.`
                : isExpiringSoon
                ? `Your ${rawPlan} subscription expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}. Renew now to keep your remaining days — renewals extend the expiry by 30 days.`
                : `Your ${rawPlan} subscription is active. When it expires, features will revert to Free plan limits until you renew.`}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ─── Monthly Capacity Card ──────────────────────────────────── */}
      <Card className="bg-card rounded-xl border-2 border-[#0A66C2]/20">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#0A66C2]/10 flex items-center justify-center shrink-0">
              <CalendarClock className="h-5 w-5 text-[#0A66C2]" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base flex items-center gap-2">
                Monthly Post Capacity
                <Badge variant="outline" className="border-[#0A66C2] text-[#0A66C2] bg-[#0A66C2]/5 capitalize">
                  {stats?.plan ?? apiUsage?.plan ?? 'free'} plan
                </Badge>
              </CardTitle>
              <CardDescription>
                Posts scheduled or published this calendar month — across all accounts
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoadingApiUsage ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-3 w-full" />
            </div>
          ) : (
            <>
              {/* Big number row */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Activity className="h-3 w-3" /> Used This Month
                  </p>
                  <p className="text-2xl font-bold mt-1">
                    {postsThisMonth.toLocaleString()}
                    <span className="text-sm text-muted-foreground font-normal">
                      /{monthlyPostsLimit.toLocaleString()}
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <RefreshCw className="h-3 w-3" /> Remaining
                  </p>
                  <p className="text-2xl font-bold mt-1 text-[#0A66C2]">
                    {postsRemainingThisMonth.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Resets
                  </p>
                  <p className="text-sm font-bold mt-1">
                    {new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">1st of next month</p>
                </div>
              </div>

              {/* Monthly progress bar */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Monthly Capacity Used
                  </span>
                  <span className="text-xs font-bold">{monthlyPercent}%</span>
                </div>
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      monthlyPercent >= 90
                        ? 'bg-red-500'
                        : monthlyPercent >= 70
                        ? 'bg-yellow-500'
                        : 'bg-[#0A66C2]/50'
                    }`}
                    style={{ width: `${monthlyPercent}%` }}
                  />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                <AlertCircle className="h-3 w-3 inline mr-1" />
                Your {(stats?.plan ?? apiUsage?.plan ?? 'free')} plan allows up to{' '}
                <span className="font-semibold text-foreground">
                  {monthlyPostsLimit.toLocaleString()} posts/month
                </span>{' '}
                total across all connected accounts. This limit is enforced server-side and cannot be bypassed.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* ─── API Call Counter Card ────────────────────────────────── */}
      <Card className="bg-card rounded-xl">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#0A66C2]/10 flex items-center justify-center shrink-0">
              <Gauge className="h-5 w-5 text-[#0A66C2]" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base flex items-center gap-2">
                API Usage
                <Badge variant="outline" className="border-[#0A66C2] text-[#0A66C2] bg-[#0A66C2]/5">
                  Last 24h
                </Badge>
              </CardTitle>
              <CardDescription>
                {selectedAccountName
                  ? <>LinkedIn API calls for <span className="font-medium text-foreground">{selectedAccountName}</span> vs. the 24-hour limit</>
                  : 'LinkedIn API calls used vs. the 24-hour limit — across all connected accounts'}
              </CardDescription>
            </div>
            {accounts.length > 0 && (
              <select
                className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shrink-0"
                value={selectedUsageAccountId ?? ''}
                onChange={(e) => setSelectedUsageAccountId(e.target.value || null)}
                aria-label="Filter API usage by account"
              >
                <option value="">All accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.accountName}</option>
                ))}
              </select>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoadingApiUsage ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-3 w-full" />
            </div>
          ) : (
            <>
              {/* Big number row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Activity className="h-3 w-3" /> API Calls Used
                  </p>
                  <p className="text-2xl font-bold mt-1">
                    {apiCallsUsed}<span className="text-sm text-muted-foreground font-normal">/{apiCallsLimit}</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <RefreshCw className="h-3 w-3" /> Remaining
                  </p>
                  <p className="text-2xl font-bold mt-1 text-[#0A66C2]">{apiCallsRemaining}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Send className="h-3 w-3" /> Posts Today
                  </p>
                  <p className="text-2xl font-bold mt-1">
                    {postsToday}<span className="text-sm text-muted-foreground font-normal">/{postsDailyLimit}</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Reset Time
                  </p>
                  <p className="text-sm font-bold mt-1">
                    {resetTime
                      ? new Date(resetTime).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">24h window</p>
                </div>
              </div>

              {/* API calls progress bar */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-muted-foreground">API Calls Progress (Today)</span>
                  <span className="text-xs font-bold">{usagePercent}%</span>
                </div>
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      usagePercent >= 90
                        ? 'bg-red-500'
                        : usagePercent >= 70
                        ? 'bg-yellow-500'
                        : 'bg-[#0A66C2]/50'
                    }`}
                    style={{ width: `${usagePercent}%` }}
                  />
                </div>
              </div>

              {/* Posts/day progress bar */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Posts / Day Safety Limit (max {postsDailyLimit}/day)
                  </span>
                  <span className="text-xs font-bold">{postsPercent}%</span>
                </div>
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      postsPercent >= 90
                        ? 'bg-red-500'
                        : postsPercent >= 70
                        ? 'bg-yellow-500'
                        : 'bg-[#0A66C2]/50'
                    }`}
                    style={{ width: `${postsPercent}%` }}
                  />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                <AlertCircle className="h-3 w-3 inline mr-1" />
                {selectedAccountName
                  ? `Your ${(stats?.plan ?? apiUsage?.plan ?? 'free')} plan budget: ${apiCallsLimit > 0 ? Math.round(apiCallsLimit / (stats?.totalAccounts || 1)) : 150} API calls / 24h per account. Posting capped at ${postsDailyLimit} posts/day for this account.`
                  : apiCallsLimit > 0
                    ? `Your ${(stats?.plan ?? apiUsage?.plan ?? 'free')} plan budget: ${apiCallsLimit / (stats?.totalAccounts || 1) || 150} API calls / 24h per account × ${stats?.totalAccounts || 0} connected = ${apiCallsLimit} API calls. Posting capped at ${postsDailyLimit} posts/day total.`
                    : 'Connect a LinkedIn account to get an API usage quota.'}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <h3 className="text-lg font-semibold mt-8">Quick Actions</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card
          className="bg-card rounded-xl cursor-pointer hover:border-[#0A66C2]/50 transition-colors"
          onClick={() => onSwitchTab('accounts')}
        >
          <CardContent className="p-6 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-[#0A66C2]/10 flex items-center justify-center shrink-0">
              <Plus className="h-6 w-6 text-[#0A66C2]" />
            </div>
            <div>
              <p className="font-semibold">Connect Account</p>
              <p className="text-sm text-muted-foreground">
                {accounts.length > 0
                  ? `${accounts.length} account${accounts.length > 1 ? 's' : ''} connected`
                  : 'Link your LinkedIn account to get started'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card
          className="bg-card rounded-xl cursor-pointer hover:border-[#0A66C2]/50 transition-colors"
          onClick={() => onSwitchTab('create-post')}
        >
          <CardContent className="p-6 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-[#0A66C2]/10 flex items-center justify-center shrink-0">
              <PenSquare className="h-6 w-6 text-[#0A66C2]" />
            </div>
            <div>
              <p className="font-semibold">Create Post</p>
              <p className="text-sm text-muted-foreground">
                Compose and publish a new LinkedIn post
              </p>
            </div>
          </CardContent>
        </Card>

        <Card
          className="bg-card rounded-xl cursor-pointer hover:border-[#0A66C2]/50 transition-colors"
          onClick={() => onSwitchTab('csv-history')}
        >
          <CardContent className="p-6 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-[#0A66C2]/10 flex items-center justify-center shrink-0">
              <HistoryIcon className="h-6 w-6 text-[#0A66C2]" />
            </div>
            <div>
              <p className="font-semibold">CSV Upload History</p>
              <p className="text-sm text-muted-foreground">
                View all uploaded CSV files and their post status
              </p>
            </div>
          </CardContent>
        </Card>

        <Card
          className="bg-card rounded-xl cursor-pointer hover:border-[#0A66C2]/50 transition-colors"
          onClick={() => onSwitchTab('bulk-post')}
        >
          <CardContent className="p-6 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-[#0A66C2]/10 flex items-center justify-center shrink-0">
              <Upload className="h-6 w-6 text-[#0A66C2]" />
            </div>
            <div>
              <p className="font-semibold">Bulk Upload</p>
              <p className="text-sm text-muted-foreground">
                Schedule many posts from a single CSV file
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── AccountsTab ───────────────────────────────────────────────────

function AccountsTab() {
  const user = useAppStore((s) => s.user);
  const accounts = useAppStore((s) => s.accounts);
  const stats = useAppStore((s) => s.stats);
  const isLoadingAccounts = useAppStore((s) => s.isLoadingAccounts);
  const refreshDashboard = useAppStore((s) => s.refreshDashboard);
  const selectedUsageAccountId = useAppStore((s) => s.selectedUsageAccountId);
  const setSelectedUsageAccountId = useAppStore((s) => s.setSelectedUsageAccountId);

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Plan-aware max account limit (mirrors src/lib/plan-limits.ts).
  // Free = 2, Pro = 25, Enterprise = 75.
  const maxAccounts =
    user?.plan === 'enterprise' ? 75 :
    user?.plan === 'pro' ? 25 :
    2;
  const accountsRemaining = Math.max(0, maxAccounts - accounts.length);
  const isAtLimit = accounts.length >= maxAccounts;

  function handleLinkedInConnect() {
    if (isAtLimit) {
      toast.error(
        `Your ${user?.plan ?? 'free'} plan allows up to ${maxAccounts} LinkedIn accounts. ` +
        (user?.plan === 'free' ? 'Upgrade to Pro (25) or Enterprise (75) to connect more.' : 'Upgrade your plan to connect more.')
      );
      return;
    }
    window.open('/api/linkedin/auth', '_blank', 'width=600,height=700,scrollbars=yes');
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api.deleteAccount(deleteTarget);
      toast.success('Account disconnected');
      // If the Overview's API Usage card was scoped to the account we just
      // deleted, fall back to "All accounts" — otherwise it'd keep querying
      // an accountId that no longer exists.
      if (selectedUsageAccountId === deleteTarget) {
        setSelectedUsageAccountId(null);
      }
      setDeleteTarget(null);
      // Connected-account count changes the "All accounts" API usage limit
      // (N accounts × 150/50), so stats + usage must refresh too, not just
      // the accounts list — otherwise Overview shows stale numbers.
      await refreshDashboard();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to disconnect');
    }
  }

  return (
    <div className="space-y-6">
      {/* Connect Button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Your LinkedIn Accounts</h3>
          <p className="text-sm text-muted-foreground">
            Manage your connected LinkedIn accounts
            {' '}<span className="font-medium text-foreground">({accounts.length}/{maxAccounts})</span>
            {isAtLimit && (
              <span className="text-red-600 ml-1">— limit reached</span>
            )}
            {!isAtLimit && accountsRemaining > 0 && (
              <span className="text-muted-foreground ml-1">— {accountsRemaining} remaining</span>
            )}
          </p>
          {/* ─── Lifetime unique account info (anti-cycling) ─── */}
          {stats?.uniqueAccountsConnected !== undefined && stats?.maxAccounts !== undefined && (
            <p className="text-xs text-muted-foreground mt-1">
              Lifetime accounts ever connected: <span className="font-medium text-foreground">
                {stats.uniqueAccountsConnected}/{stats.maxAccounts}
              </span>
              {stats.uniqueAccountsConnected >= stats.maxAccounts && (
                <span className="text-amber-600 ml-1">
                  — new account connections blocked (reconnection still allowed)
                </span>
              )}
            </p>
          )}
        </div>
        <Button
          onClick={handleLinkedInConnect}
          disabled={isAtLimit}
          className="bg-[#0A66C2] hover:bg-[#004182] text-white"
        >
          <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
          </svg>
          {isAtLimit ? 'Limit Reached' : 'Connect with LinkedIn'}
        </Button>
      </div>

      {/* Empty State */}
      {!isLoadingAccounts && accounts.length === 0 && (
        <Card className="bg-card rounded-xl">
          <CardContent className="p-12 flex flex-col items-center justify-center text-center">
            <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h4 className="text-lg font-semibold mb-2">No accounts connected</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Connect your first LinkedIn account to start posting.
            </p>
            <Button
              onClick={handleLinkedInConnect}
              className="bg-[#0A66C2] hover:bg-[#004182] text-white"
            >
              <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
              Connect with LinkedIn
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Account Table */}
      {accounts.length > 0 && (
        <Card className="bg-card rounded-xl">
          <CardContent className="p-0">
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account Name</TableHead>
                    <TableHead>Member ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingAccounts ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-20 ml-auto" /></TableCell>
                      </TableRow>
                    ))
                  ) : (
                    accounts.map((account) => (
                      <TableRow key={account.id}>
                        <TableCell className="font-medium">{account.accountName}</TableCell>
                        <TableCell className="text-muted-foreground">{account.linkedinMemberId}</TableCell>
                        <TableCell>
                          <Badge className={account.isActive ? 'bg-[#0A66C2] text-white hover:bg-[#0A66C2]' : 'bg-yellow-100 text-yellow-700'}>
                            {account.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{formatDate(account.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(account.id)}
                          >
                            <Unplug className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to disconnect this LinkedIn account? All associated posts will also be deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-white hover:bg-destructive/90">
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── CreatePostTab ─────────────────────────────────────────────────

function PostCreatorTab() {
  const { accounts, setDashboardTab } = useAppStore();
  const [accountId, setAccountId] = useState('');
  const [caption, setCaption] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [publishTime, setPublishTime] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const doSubmit = async (schedule: boolean) => {
    if (!accountId) { toast.error('Select an account'); return; }
    if (!caption.trim()) { toast.error('Enter a caption'); return; }
    setSubmitting(true);
    try {
      // datetime-local gives a timezone-less string (e.g. "2026-08-18T07:48").
      // new Date() in the BROWSER correctly interprets it using the browser's
      // own local timezone, so converting to ISO here bakes in the right UTC
      // instant before it ever reaches the server (which may run in UTC).
      const publishTimeIso = schedule && publishTime ? new Date(publishTime).toISOString() : undefined;
      const post = await api.createPost({
        accountId,
        caption: caption.trim(),
        imageUrl: imageUrl.trim() || undefined,
        videoUrl: videoUrl.trim() || undefined,
        publishTime: publishTimeIso,
      });
      if (schedule) {
        toast.success('Post scheduled');
      } else {
        // "Publish Now" must actually publish — createPost alone only
        // saves it as 'pending', it does not call LinkedIn.
        await api.publishPost(post.id);
        toast.success('Post published');
      }
      setAccountId(''); setCaption(''); setImageUrl(''); setVideoUrl(''); setPublishTime('');
      setDashboardTab('history');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setSubmitting(false); }
  };

  if (!Array.isArray(accounts) || accounts.length === 0) {
    return (
      <Card className="rounded-xl"><CardContent className="p-12 text-center">
        <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
        <h4 className="text-lg font-semibold mb-2">No accounts connected</h4>
        <p className="text-sm text-muted-foreground">Connect a LinkedIn account first.</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-6">
      <div><h3 className="text-lg font-semibold">Compose a Post</h3><p className="text-sm text-muted-foreground">Create a new LinkedIn post. Optional fields can be left blank.</p></div>
      <Card className="rounded-xl"><CardContent className="p-6 space-y-5">
        <div className="space-y-2"><Label>Account</Label>
          <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Select an account</option>
            {(Array.isArray(accounts) ? accounts : []).map((a) => (<option key={a.id} value={a.id}>{a.accountName}</option>))}
          </select>
        </div>
        <div className="space-y-2"><Label>Caption</Label>
          <Textarea placeholder="What's on your mind?" value={caption} onChange={(e) => setCaption(e.target.value)} rows={6} maxLength={3000} />
          <p className="text-xs text-muted-foreground text-right">{caption.length}/3000</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2"><Label className="flex items-center gap-1"><ImageIcon className="h-3 w-3" /> Image URL (optional)</Label>
            <Input placeholder="https://example.com/image.jpg" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
          </div>
          <div className="space-y-2"><Label className="flex items-center gap-1"><Video className="h-3 w-3" /> Video URL (optional)</Label>
            <Input placeholder="https://example.com/video.mp4" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground -mt-3">
          <AlertCircle className="h-3 w-3 inline mr-1" />
          If both image and video URLs are provided, the video takes precedence.
        </p>
        <div className="space-y-2"><Label>Publish Time (optional)</Label>
          <Input type="datetime-local" value={publishTime} onChange={(e) => setPublishTime(e.target.value)} />
        </div>
        <div className="flex items-center gap-3 pt-2">
          <Button onClick={() => doSubmit(false)} disabled={submitting}>{submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Publish Now</Button>
          <Button variant="outline" onClick={() => doSubmit(true)} disabled={submitting}>Schedule</Button>
        </div>
      </CardContent></Card>
    </div>
  );
}

// ─── BulkPostTab ───────────────────────────────────────────────────

function BulkPostTab() {
  const user = useAppStore((s) => s.user);
  const accounts = useAppStore((s) => s.accounts);
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState('');
  const [intervalValue, setIntervalValue] = useState(30);
  const [intervalUnit, setIntervalUnit] = useState('minute');
  const [uploading, setUploading] = useState(false);
  const [lastResult, setLastResult] = useState<BulkUploadResult | null>(null);

  // Upload detail view
  const [viewingUploadId, setViewingUploadId] = useState<string | null>(null);
  const [uploadDetail, setUploadDetail] = useState<CsvUploadDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadUploadDetail(uploadId: string) {
    setLoadingDetail(true);
    try {
      const detail = await api.getCsvUploadPosts(uploadId);
      setUploadDetail(detail);
    } catch {
      toast.error('Failed to load upload details');
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    if (viewingUploadId) {
      loadUploadDetail(viewingUploadId);
    }
  }, [viewingUploadId]);

  // Auto-refresh the upload detail every 10s to see status changes
  useEffect(() => {
    if (!viewingUploadId) return;
    const interval = setInterval(() => {
      loadUploadDetail(viewingUploadId);
    }, 10000);
    return () => clearInterval(interval);
  }, [viewingUploadId]);

  const hasNoAccounts = !Array.isArray(accounts) || accounts.length === 0;

  if (user?.plan === 'free') {
    return (
      <Card className="rounded-xl"><CardContent className="p-12 text-center">
        <Lock className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
        <h4 className="text-lg font-semibold mb-2">Upgrade Required</h4>
        <p className="text-sm text-muted-foreground mb-4">Bulk upload is available on Pro plan.</p>
        <Button onClick={() => useAppStore.getState().setDashboardTab('upgrade')} className="bg-[#0A66C2] hover:bg-[#004182] text-white">
          <Crown className="h-4 w-4 mr-2" />Upgrade Now
        </Button>
      </CardContent></Card>
    );
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (!selected.name.endsWith('.csv')) {
      toast.error('Please select a CSV file');
      return;
    }
    if (selected.size > 5 * 1024 * 1024) {
      toast.error('File size must be under 5MB');
      return;
    }
    setFile(selected);
  }

  async function handleUpload() {
    if (!file) { toast.error('Please select a file first'); return; }
    if (!accountId) { toast.error('Please select an account'); return; }
    if (intervalValue < 1) { toast.error('Interval must be at least 1'); return; }
    setUploading(true);
    try {
      const result = await api.bulkUpload(file, accountId, intervalValue, intervalUnit);
      setLastResult(result);
      toast.success(`${result.validRows} posts scheduled successfully!`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      // Auto-show the upload detail
      setViewingUploadId(result.uploadId);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function downloadTemplate() {
    // CSV template — includes the optional `media_url` (image OR video) column.
    // No `comment` column: LinkedIn's auto-comment API requires Community
    // Management API product access, which this app does not have.
    const csv = 'caption,image_url,media_url\n' +
      'Hello LinkedIn!,,https://example.com/image.jpg\n' +
      'Video post,,https://example.com/video.mp4\n' +
      'Text-only post,,\n' +
      'Another post with image,https://example.com/legacy-image.jpg,\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bulk_upload_template.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Template downloaded');
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Bulk Upload Posts</h3>
        <p className="text-sm text-muted-foreground">Upload a CSV file with caption and image URL. Posts will be scheduled automatically.</p>
      </div>

      {/* Upload Zone */}
      <Card className="bg-card rounded-xl">
        <CardContent className="p-6 space-y-5">
          {/* Account Selector */}
          <div className="space-y-2">
            <Label>Account <span className="text-destructive">*</span></Label>
            {hasNoAccounts ? (
              <p className="text-sm text-destructive">No accounts connected. <button className="underline" onClick={() => useAppStore.getState().setDashboardTab('accounts')}>Connect an account first</button>.</p>
            ) : (
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">Select an account</option>
                {accounts.map((a) => (<option key={a.id} value={a.id}>{a.accountName}</option>))}
              </select>
            )}
          </div>

          {/* Interval Settings */}
          <div className="space-y-2">
            <Label>Publish Interval <span className="text-destructive">*</span></Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Every</span>
              <Input
                type="number"
                min={1}
                value={intervalValue}
                onChange={(e) => setIntervalValue(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24"
              />
              <select
                className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={intervalUnit}
                onChange={(e) => setIntervalUnit(e.target.value)}
              >
                <option value="minute">Minute(s)</option>
                <option value="hour">Hour(s)</option>
                <option value="day">Day(s)</option>
              </select>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Timer className="h-3 w-3" />
              Max {user?.plan === 'enterprise' ? '250' : user?.plan === 'pro' ? '50' : '10'} posts per account per day (your {user?.plan ?? 'free'} plan). Posts exceeding daily limit will be scheduled for the next day.
            </p>
          </div>

          {/* File Upload Zone */}
          <div className="space-y-2">
            <Label>CSV File <span className="text-destructive">*</span></Label>
            <div
              className="border-2 border-dashed border-muted-foreground/25 rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:border-[#0A66C2]/60 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="font-medium">Click to select a CSV file</p>
              <p className="text-sm text-muted-foreground mt-1">Supports .csv files up to 5MB</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>

          {file && (
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <FileSpreadsheet className="h-5 w-5 text-[#0A66C2]" />
              <span className="text-sm font-medium flex-1 truncate">{file.name}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button
              className="bg-[#0A66C2] hover:bg-[#004182] text-white"
              onClick={handleUpload}
              disabled={uploading || !file || !accountId || hasNoAccounts}
            >
              {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Upload & Schedule
            </Button>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Schedule Info (after upload) */}
      {lastResult && (
        <Card className="rounded-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Last Upload Summary</CardTitle>
                <CardDescription>{lastResult.scheduleInfo.interval} interval</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setViewingUploadId(lastResult.uploadId)}>
                <Eye className="h-4 w-4 mr-1" />
                View Posts
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <p className="text-xl font-bold">{lastResult.validRows}</p>
                <p className="text-xs text-muted-foreground">Posts Scheduled</p>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <p className="text-xl font-bold">{lastResult.skippedRows}</p>
                <p className="text-xs text-muted-foreground">Skipped</p>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <p className="text-xl font-bold">{lastResult.scheduleInfo.daysSpan}</p>
                <p className="text-xs text-muted-foreground">Days Span</p>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <p className="text-sm font-bold">{lastResult.scheduleInfo.interval}</p>
                <p className="text-xs text-muted-foreground">Interval</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload Detail View */}
      {viewingUploadId && (
        <Card className="rounded-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Scheduled Posts</CardTitle>
                <CardDescription>
                  {uploadDetail
                    ? `${uploadDetail.upload.filename} — ${uploadDetail.upload.totalPosts} posts`
                    : 'Loading...'}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {uploadDetail && (
                  <div className="flex items-center gap-2 mr-2">
                    <Badge variant="outline" className="border-[#0A66C2] text-[#0A66C2] bg-[#0A66C2]/5">
                      {uploadDetail.statusCounts.published} Published
                    </Badge>
                    <Badge variant="outline" className="border-blue-500 text-blue-600 bg-blue-50">
                      {uploadDetail.statusCounts.scheduled} Scheduled
                    </Badge>
                    <Badge variant="outline" className="border-yellow-500 text-yellow-600 bg-yellow-50">
                      {uploadDetail.statusCounts.pending} Pending
                    </Badge>
                    {uploadDetail.statusCounts.failed > 0 && (
                      <Badge variant="destructive">
                        {uploadDetail.statusCounts.failed} Failed
                      </Badge>
                    )}
                  </div>
                )}
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => loadUploadDetail(viewingUploadId)}>
                  <RefreshCw className={`h-4 w-4 ${loadingDetail ? 'animate-spin' : ''}`} />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setViewingUploadId(null); setUploadDetail(null); }}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* ─── Schedule Management Controls (NEW) ───────────────── */}
            {uploadDetail && (
              <ScheduleControls
                uploadId={uploadDetail.upload.id}
                scheduleState={(uploadDetail.upload.scheduleState as 'active' | 'paused' | 'off') || 'active'}
                onUpdated={() => loadUploadDetail(uploadDetail.upload.id)}
                onDelete={() => { setViewingUploadId(null); setUploadDetail(null); }}
              />
            )}
          </CardHeader>
          <CardContent className="p-0">
            {loadingDetail && !uploadDetail ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : uploadDetail && uploadDetail.posts.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No posts found</div>
            ) : uploadDetail ? (
              <div className="max-h-[500px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Caption</TableHead>
                      <TableHead>Media</TableHead>
                      <TableHead>Scheduled Time</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {uploadDetail.posts.map((post, idx) => (
                      <TableRow key={post.id}>
                        <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                        <TableCell className="text-sm max-w-48">
                          <p className="truncate" title={post.caption}>{post.caption}</p>
                        </TableCell>
                        <TableCell className="text-xs max-w-32">
                          {post.videoUrl ? (
                            <a
                              href={post.videoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate block text-purple-600 hover:underline"
                              title={post.videoUrl}
                            >
                              <Video className="h-3 w-3 inline mr-1" />{truncate(post.videoUrl, 24)}
                            </a>
                          ) : post.imageUrl ? (
                            <a
                              href={post.imageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate block text-[#0A66C2] hover:underline"
                              title={post.imageUrl}
                            >
                              <ImageIcon className="h-3 w-3 inline mr-1" />{truncate(post.imageUrl, 24)}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {post.publishTime ? formatDate(post.publishTime) : '—'}
                        </TableCell>
                        <TableCell className="text-center">
                          {post.status === 'published' ? (
                            post.error ? (
                              <Badge
                                className="bg-[#0A66C2] text-white hover:bg-[#0A66C2] cursor-help"
                                title={`Post published, but: ${post.error}`}
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />Published
                                <AlertTriangle className="h-3 w-3 ml-1" />
                              </Badge>
                            ) : (
                              <Badge className="bg-[#0A66C2] text-white hover:bg-[#0A66C2]">
                                <CheckCircle2 className="h-3 w-3 mr-1" />Published
                              </Badge>
                            )
                          ) : post.status === 'scheduled' ? (
                            <Badge variant="outline" className="border-blue-500 text-blue-600 bg-blue-50">
                              <Clock className="h-3 w-3 mr-1" />Scheduled
                            </Badge>
                          ) : post.status === 'failed' ? (
                            <Badge variant="destructive" className="cursor-help" title={post.error || undefined}>
                              <XCircle className="h-3 w-3 mr-1" />Failed
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-yellow-500 text-yellow-600 bg-yellow-50">Pending</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* CSV Format Help */}
      <Card className="bg-card rounded-xl">
        <CardHeader>
          <CardTitle className="text-base">CSV Format</CardTitle>
          <CardDescription>Your CSV should have the following columns:</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Column</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-mono text-sm">caption</TableCell>
                  <TableCell><Badge className="bg-[#0A66C2] text-white hover:bg-[#0A66C2]">Yes</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">Post caption text (max 3000 chars)</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-sm">image_url</TableCell>
                  <TableCell><Badge variant="outline">No</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">URL to an image (legacy — prefer media_url)</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-sm">media_url <Badge variant="outline" className="ml-1">NEW</Badge></TableCell>
                  <TableCell><Badge variant="outline">No</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">URL to an image OR a video — auto-detected by content-type</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-sm">video_url</TableCell>
                  <TableCell><Badge variant="outline">No</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">URL to a video (alternative to media_url)</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            <AlertCircle className="h-3 w-3 inline mr-1" />
            <strong>Multi-day auto-continuation:</strong> If your CSV has more than 50 posts, the scheduler
            automatically spreads them across multiple days (50 posts/day max) — no manual intervention needed.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── ScheduleControls (NEW) ──────────────────────────────────────────
// Reusable schedule management control bar — used inside the bulk upload
// detail view AND inside the CSV history table. Implements:
//   - Schedule ON/OFF (toggle between 'active' and 'off')
//   - Pause Schedule (sets state to 'paused')
//   - Resume Schedule (sets state back to 'active')
//   - Delete Schedule (deletes the upload + all its posts)

function ScheduleControls({
  uploadId,
  scheduleState,
  onUpdated,
  onDelete,
  compact,
}: {
  uploadId: string;
  scheduleState: 'active' | 'paused' | 'off';
  onUpdated?: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<'on' | 'off' | 'pause' | 'resume' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function setState(newState: 'active' | 'paused' | 'off', busyKey: 'on' | 'off' | 'pause' | 'resume') {
    setBusy(busyKey);
    try {
      await api.updateCsvUploadSchedule(uploadId, newState);
      toast.success(
        newState === 'active'
          ? 'Schedule resumed'
          : newState === 'paused'
          ? 'Schedule paused'
          : 'Schedule turned off'
      );
      await onUpdated?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update schedule');
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    setBusy('delete');
    try {
      await api.deleteCsvUpload(uploadId);
      toast.success('CSV upload deleted');
      setConfirmDelete(false);
      await onDelete?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete');
    } finally {
      setBusy(null);
    }
  }

  const isActive = scheduleState === 'active';
  const isPaused = scheduleState === 'paused';
  const isOff = scheduleState === 'off';

  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? '' : 'p-3 bg-muted/50 rounded-lg'}`}>
      <span className="text-xs font-medium text-muted-foreground mr-2">Schedule:</span>

      {/* State badge */}
      {isActive && (
        <Badge className="bg-[#0A66C2] text-white hover:bg-[#0A66C2]">
          <Play className="h-3 w-3 mr-1" /> Active
        </Badge>
      )}
      {isPaused && (
        <Badge variant="outline" className="border-yellow-500 text-yellow-600 bg-yellow-50">
          <Pause className="h-3 w-3 mr-1" /> Paused
        </Badge>
      )}
      {isOff && (
        <Badge variant="outline" className="border-red-500 text-red-600 bg-red-50">
          <Power className="h-3 w-3 mr-1" /> Off
        </Badge>
      )}

      <div className="flex-1" />

      {/* Action buttons */}
      {(isPaused || isOff) && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setState('active', 'resume')}
          disabled={busy !== null}
          className="border-[#0A66C2] text-[#0A66C2] hover:bg-[#0A66C2]/5"
        >
          {busy === 'resume' ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
          Resume
        </Button>
      )}
      {isActive && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setState('paused', 'pause')}
          disabled={busy !== null}
          className="border-yellow-500 text-yellow-600 hover:bg-yellow-50"
        >
          {busy === 'pause' ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Pause className="h-3 w-3 mr-1" />}
          Pause
        </Button>
      )}
      {!isOff ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setState('off', 'off')}
          disabled={busy !== null}
          className="border-red-500 text-red-600 hover:bg-red-50"
        >
          {busy === 'off' ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Power className="h-3 w-3 mr-1" />}
          Turn Off
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setState('active', 'on')}
          disabled={busy !== null}
          className="border-[#0A66C2] text-[#0A66C2] hover:bg-[#0A66C2]/5"
        >
          {busy === 'on' ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Power className="h-3 w-3 mr-1" />}
          Turn On
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setConfirmDelete(true)}
        disabled={busy !== null}
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
      >
        <Trash2 className="h-3 w-3 mr-1" />
        Delete
      </Button>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete CSV Upload?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the upload record and all of its posts (including published ones).
              Posts already live on LinkedIn will remain there, but you will no longer be able to track them from this dashboard.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={busy !== null}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {busy === 'delete' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── CsvHistoryTab (NEW) ─────────────────────────────────────────────
// Shows a list of all CSV uploads for the current user with per-upload
// status counts (published / scheduled / pending / failed) and
// schedule management controls.

function CsvHistoryTab() {
  const [uploads, setUploads] = useState<CsvUploadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingUploadId, setViewingUploadId] = useState<string | null>(null);
  const [uploadDetail, setUploadDetail] = useState<CsvUploadDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const refreshList = async () => {
    setLoading(true);
    try {
      const list = await api.getCsvUploads();
      setUploads(list);
    } catch {
      toast.error('Failed to load CSV upload history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshList();
  }, []);

  // Auto-refresh the list every 15s so the user sees real-time updates
  // as posts get published by the cron worker.
  useEffect(() => {
    const interval = setInterval(refreshList, 15000);
    return () => clearInterval(interval);
  }, []);

  async function loadUploadDetail(uploadId: string) {
    setLoadingDetail(true);
    try {
      // Reuse the existing /api/posts/bulk/[uploadId] endpoint so the
      // post list UI stays identical between the Bulk Post tab and this tab.
      const detail = await api.getCsvUploadPosts(uploadId);
      setUploadDetail(detail);
    } catch {
      toast.error('Failed to load upload details');
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    if (viewingUploadId) loadUploadDetail(viewingUploadId);
  }, [viewingUploadId]);

  useEffect(() => {
    if (!viewingUploadId) return;
    const interval = setInterval(() => loadUploadDetail(viewingUploadId), 10000);
    return () => clearInterval(interval);
  }, [viewingUploadId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">CSV Upload History</h3>
          <p className="text-sm text-muted-foreground">
            View all uploaded CSV files and manage their schedules.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshList} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {loading && uploads.length === 0 ? (
        <Card className="bg-card rounded-xl">
          <CardContent className="p-6 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : uploads.length === 0 ? (
        <Card className="bg-card rounded-xl">
          <CardContent className="p-12 flex flex-col items-center justify-center text-center">
            <HistoryIcon className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h4 className="text-lg font-semibold mb-2">No CSV uploads yet</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Upload a CSV file from the Bulk Post tab to see it here.
            </p>
            <Button
              onClick={() => useAppStore.getState().setDashboardTab('bulk-post')}
              className="bg-[#0A66C2] hover:bg-[#004182] text-white"
            >
              <Upload className="h-4 w-4 mr-2" />
              Go to Bulk Upload
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-card rounded-xl">
          <CardContent className="p-0">
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Filename</TableHead>
                    <TableHead className="text-center">Total</TableHead>
                    <TableHead className="text-center">Published</TableHead>
                    <TableHead className="text-center">Pending</TableHead>
                    <TableHead className="text-center">Failed</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploads.map((upload) => (
                    <TableRow key={upload.id}>
                      <TableCell className="font-medium text-sm">
                        <div className="flex items-center gap-2">
                          <FileSpreadsheet className="h-4 w-4 text-[#0A66C2] shrink-0" />
                          <span className="truncate max-w-32" title={upload.filename}>{upload.filename}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center text-sm font-medium">{upload.totalPosts}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="border-[#0A66C2] text-[#0A66C2] bg-[#0A66C2]/5">
                          {upload.statusCounts.published}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="border-blue-500 text-blue-600 bg-blue-50">
                          {upload.statusCounts.scheduled}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {upload.statusCounts.failed > 0 ? (
                          <Badge variant="destructive">{upload.statusCounts.failed}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">0</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {upload.scheduleState === 'active' && (
                          <Badge className="bg-[#0A66C2] text-white hover:bg-[#0A66C2]">
                            <Play className="h-3 w-3 mr-1" /> Active
                          </Badge>
                        )}
                        {upload.scheduleState === 'paused' && (
                          <Badge variant="outline" className="border-yellow-500 text-yellow-600 bg-yellow-50">
                            <Pause className="h-3 w-3 mr-1" /> Paused
                          </Badge>
                        )}
                        {upload.scheduleState === 'off' && (
                          <Badge variant="outline" className="border-red-500 text-red-600 bg-red-50">
                            <Power className="h-3 w-3 mr-1" /> Off
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(upload.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setViewingUploadId(upload.id)}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload Detail View */}
      {viewingUploadId && (
        <Card className="rounded-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Scheduled Posts</CardTitle>
                <CardDescription>
                  {uploadDetail
                    ? `${uploadDetail.upload.filename} — ${uploadDetail.upload.totalPosts} posts`
                    : 'Loading...'}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {uploadDetail && (
                  <div className="flex items-center gap-2 mr-2">
                    <Badge variant="outline" className="border-[#0A66C2] text-[#0A66C2] bg-[#0A66C2]/5">
                      {uploadDetail.statusCounts.published} Published
                    </Badge>
                    <Badge variant="outline" className="border-blue-500 text-blue-600 bg-blue-50">
                      {uploadDetail.statusCounts.scheduled} Scheduled
                    </Badge>
                    <Badge variant="outline" className="border-yellow-500 text-yellow-600 bg-yellow-50">
                      {uploadDetail.statusCounts.pending} Pending
                    </Badge>
                    {uploadDetail.statusCounts.failed > 0 && (
                      <Badge variant="destructive">
                        {uploadDetail.statusCounts.failed} Failed
                      </Badge>
                    )}
                  </div>
                )}
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => loadUploadDetail(viewingUploadId)}>
                  <RefreshCw className={`h-4 w-4 ${loadingDetail ? 'animate-spin' : ''}`} />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setViewingUploadId(null); setUploadDetail(null); }}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {uploadDetail && (
              <ScheduleControls
                uploadId={uploadDetail.upload.id}
                scheduleState={(uploadDetail.upload.scheduleState as 'active' | 'paused' | 'off') || 'active'}
                onUpdated={async () => {
                  await loadUploadDetail(uploadDetail.upload.id);
                  await refreshList();
                }}
                onDelete={async () => {
                  setViewingUploadId(null);
                  setUploadDetail(null);
                  await refreshList();
                }}
              />
            )}
          </CardHeader>
          <CardContent className="p-0">
            {loadingDetail && !uploadDetail ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : uploadDetail && uploadDetail.posts.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No posts found</div>
            ) : uploadDetail ? (
              <div className="max-h-[500px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Caption</TableHead>
                      <TableHead>Media</TableHead>
                      <TableHead>Scheduled Time</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {uploadDetail.posts.map((post, idx) => (
                      <TableRow key={post.id}>
                        <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                        <TableCell className="text-sm max-w-48">
                          <p className="truncate" title={post.caption}>{post.caption}</p>
                        </TableCell>
                        <TableCell className="text-xs max-w-32">
                          {post.videoUrl ? (
                            <a
                              href={post.videoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate block text-purple-600 hover:underline"
                              title={post.videoUrl}
                            >
                              <Video className="h-3 w-3 inline mr-1" />{truncate(post.videoUrl, 24)}
                            </a>
                          ) : post.imageUrl ? (
                            <a
                              href={post.imageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate block text-[#0A66C2] hover:underline"
                              title={post.imageUrl}
                            >
                              <ImageIcon className="h-3 w-3 inline mr-1" />{truncate(post.imageUrl, 24)}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {post.publishTime ? formatDate(post.publishTime) : '—'}
                        </TableCell>
                        <TableCell className="text-center">
                          {post.status === 'published' ? (
                            post.error ? (
                              <Badge
                                className="bg-[#0A66C2] text-white hover:bg-[#0A66C2] cursor-help"
                                title={`Post published, but: ${post.error}`}
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />Published
                                <AlertTriangle className="h-3 w-3 ml-1" />
                              </Badge>
                            ) : (
                              <Badge className="bg-[#0A66C2] text-white hover:bg-[#0A66C2]">
                                <CheckCircle2 className="h-3 w-3 mr-1" />Published
                              </Badge>
                            )
                          ) : post.status === 'scheduled' ? (
                            <Badge variant="outline" className="border-blue-500 text-blue-600 bg-blue-50">
                              <Clock className="h-3 w-3 mr-1" />Scheduled
                            </Badge>
                          ) : post.status === 'failed' ? (
                            <Badge variant="destructive" className="cursor-help" title={post.error || undefined}>
                              <XCircle className="h-3 w-3 mr-1" />Failed
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-yellow-500 text-yellow-600 bg-yellow-50">Pending</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── HistoryTab ────────────────────────────────────────────────────

function HistoryTab() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [posts, setPosts] = useState<PostWithAccount[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [viewPost, setViewPost] = useState<PostWithAccount | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);

  const limit = 10;

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const params: { status?: string; page: number; limit: number } = { page, limit };
        if (statusFilter !== 'all') params.status = statusFilter;
        const res = await api.getPosts(params);
        setPosts(res.posts);
        setTotal(res.total);
      } catch {
        toast.error('Failed to load posts');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [statusFilter, page]);

  const totalPages = Math.ceil(total / limit);

  async function handlePublish(id: string) {
    setPublishing(id);
    try {
      await api.publishPost(id);
      toast.success('Post published successfully');
      const res = await api.getPosts({
        page,
        limit,
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
      });
      setPosts(res.posts);
      setTotal(res.total);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to publish');
    } finally {
      setPublishing(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Post History</h3>
          <p className="text-sm text-muted-foreground">View and manage all your posts.</p>
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Posts Table */}
      <Card className="bg-card rounded-xl">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-5 flex-1" />
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-5 w-20" />
                </div>
              ))}
            </div>
          ) : posts.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-center">
              <History className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h4 className="text-lg font-semibold mb-2">No posts found</h4>
              <p className="text-sm text-muted-foreground">
                {statusFilter !== 'all'
                  ? 'No posts match the selected filter.'
                  : 'Create your first post to see it here.'}
              </p>
            </div>
          ) : (
            <>
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead>Caption</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Publish Time</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {posts.map((post) => (
                      <TableRow key={post.id}>
                        <TableCell className="font-medium text-sm">{post.accountName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-48">
                          {truncate(post.caption, 60)}
                        </TableCell>
                        <TableCell>{statusBadge(post.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {post.publishTime ? formatDate(post.publishTime) : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {post.status === 'pending' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-[#0A66C2] hover:text-[#004182]"
                                onClick={() => handlePublish(post.id)}
                                disabled={publishing === post.id}
                              >
                                {publishing === post.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Send className="h-4 w-4" />
                                )}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setViewPost(post)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between p-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    Page {page} of {totalPages} ({total} posts)
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm font-medium px-2">{page}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* View Post Dialog */}
      <Dialog open={!!viewPost} onOpenChange={(open) => { if (!open) setViewPost(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Post Caption</DialogTitle>
            <DialogDescription>
              {viewPost?.accountName} — {viewPost?.status && statusBadge(viewPost.status)}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 overflow-y-auto">
            <p className="text-sm whitespace-pre-wrap">{viewPost?.caption || ''}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewPost(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── UpgradeTab ──────────────────────────────────────────────────

// Plan metadata (mirrors src/lib/plan-limits.ts for the client bundle).
const UPGRADE_PLANS = [
  {
    id: 'pro' as const,
    name: 'Pro',
    price: 49,
    accounts: 25,
    postsPerDay: 50,
    monthlyPosts: 37500,
    features: [
      '25 LinkedIn accounts',
      '50 posts per account per day',
      'Single & bulk post publishing',
      'CSV upload (up to 5 MB)',
      'Post history & analytics',
      'Email support',
    ],
  },
  {
    id: 'enterprise' as const,
    name: 'Enterprise',
    price: 149,
    accounts: 75,
    postsPerDay: 250,
    monthlyPosts: 562500,
    features: [
      '75 LinkedIn accounts',
      '250 posts per account per day',
      'Single & bulk post publishing',
      'CSV upload (up to 5 MB)',
      'Post history & analytics',
      'Priority email support',
    ],
  },
];

function UpgradeTab() {
  const user = useAppStore((s) => s.user);
  const refreshUserPlan = useAppStore((s) => s.refreshUserPlan);

  // Selected plan: 'pro' (default) or 'enterprise'.
  // If user is already on Pro, default the selector to Enterprise so they
  // can see the upgrade path.
  const [selectedPlan, setSelectedPlan] = useState<'pro' | 'enterprise'>(
    user?.plan === 'pro' ? 'enterprise' : 'pro'
  );

  // Toggles the inline Enterprise upgrade form for Pro users (hidden by default)
  const [showEnterpriseUpgradeForm, setShowEnterpriseUpgradeForm] = useState(false);

  // USDT form state
  const [usdtTxHash, setUsdtTxHash] = useState('');
  const [usdtSubmitting, setUsdtSubmitting] = useState(false);
  const [usdtCopied, setUsdtCopied] = useState(false);

  // Binance form state
  const [binanceTxId, setBinanceTxId] = useState('');
  const [binanceSubmitting, setBinanceSubmitting] = useState(false);
  const [binanceCopied, setBinanceCopied] = useState(false);

  // Payment history
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);

  useEffect(() => {
    async function loadPayments() {
      setLoadingPayments(true);
      try {
        const res = await api.getPaymentHistory();
        setPayments(res.payments);
      } catch {
        // silent
      } finally {
        setLoadingPayments(false);
      }
    }
    loadPayments();
  }, []);

  function copyToClipboard(text: string, type: 'usdt' | 'binance') {
    navigator.clipboard.writeText(text);
    if (type === 'usdt') {
      setUsdtCopied(true);
      setTimeout(() => setUsdtCopied(false), 2000);
    } else {
      setBinanceCopied(true);
      setTimeout(() => setBinanceCopied(false), 2000);
    }
  }

  const activePlanMeta = UPGRADE_PLANS.find((p) => p.id === selectedPlan) ?? UPGRADE_PLANS[0];

  async function handleUsdtSubmit() {
    if (!usdtTxHash.trim()) { toast.error('Please enter the transaction hash'); return; }
    setUsdtSubmitting(true);
    try {
      const { payment } = await api.createPayment({
        method: 'usdt',
        amount: activePlanMeta.price,
        plan: activePlanMeta.id,
        txHash: usdtTxHash.trim(),
      });
      const verifyRes = await api.verifyUsdt(payment.id);
      if (verifyRes.success) {
        toast.success(`Payment verified! You are now on the ${activePlanMeta.name} plan.`);
        await refreshUserPlan();
        setUsdtTxHash('');
        const histRes = await api.getPaymentHistory();
        setPayments(histRes.payments);
      } else {
        toast.info(verifyRes.message || 'Payment submitted. Verification may take a moment.');
        const histRes = await api.getPaymentHistory();
        setPayments(histRes.payments);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Payment submission failed');
    } finally {
      setUsdtSubmitting(false);
    }
  }

  async function handleBinanceSubmit() {
    if (!binanceTxId.trim()) { toast.error('Please enter the transaction ID'); return; }
    setBinanceSubmitting(true);
    try {
      await api.createPayment({
        method: 'binance',
        amount: activePlanMeta.price,
        plan: activePlanMeta.id,
        transactionId: binanceTxId.trim(),
      });
      toast.success('Payment submitted successfully! An admin will verify your payment within 24 hours.');
      setBinanceTxId('');
      const histRes = await api.getPaymentHistory();
      setPayments(histRes.payments);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Payment submission failed');
    } finally {
      setBinanceSubmitting(false);
    }
  }

  function paymentStatusBadge(status: string) {
    switch (status) {
      case 'pending_manual':
        return <Badge variant="outline" className="border-yellow-500 text-yellow-600 bg-yellow-50">Pending</Badge>;
      case 'pending':
        return <Badge variant="outline" className="border-blue-500 text-blue-600 bg-blue-50">Pending</Badge>;
      case 'verified':
        return <Badge className="bg-[#0A66C2] text-white hover:bg-[#0A66C2]">Verified</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  }

  // ─── Paid user (Pro or Enterprise) ─────────────────────────────
  // Show their current plan + offer Enterprise upgrade if they're on Pro.
  if (user && user.plan !== 'free') {
    const currentPlanMeta = UPGRADE_PLANS.find((p) => p.id === user.plan);
    const isEnterprise = user.plan === 'enterprise';
    return (
      <div className="space-y-6">
        <Card className="rounded-xl">
          <CardContent className="p-12 text-center">
            <CheckCircle2 className="h-16 w-16 mx-auto text-[#0A66C2] mb-4" />
            <h3 className="text-xl font-bold mb-2">
              You&apos;re on the {currentPlanMeta?.name ?? user.plan} plan!
            </h3>
            <p className="text-muted-foreground mb-6">You have access to all premium features.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto text-left">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-[#0A66C2] mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">{currentPlanMeta?.accounts ?? 0} LinkedIn Accounts</p>
                  <p className="text-xs text-muted-foreground">All connected & ready to post</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-[#0A66C2] mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">{currentPlanMeta?.postsPerDay ?? 0} Posts/Day/Account</p>
                  <p className="text-xs text-muted-foreground">Per account daily posting limit</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-[#0A66C2] mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Bulk Upload</p>
                  <p className="text-xs text-muted-foreground">Upload CSV files with unlimited posts</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-[#0A66C2] mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">{isEnterprise ? 'Priority Support' : 'Email Support'}</p>
                  <p className="text-xs text-muted-foreground">{isEnterprise ? 'Faster response times' : 'Standard response time'}</p>
                </div>
              </div>
            </div>

            {/* Monthly capacity reminder */}
            <div className="mt-6 inline-block rounded-lg bg-muted/50 px-4 py-2 text-sm">
              <span className="text-muted-foreground">Your monthly reach:</span>{' '}
              <span className="font-bold text-[#0A66C2]">
                {((currentPlanMeta?.accounts ?? 0) * (currentPlanMeta?.postsPerDay ?? 0) * 30).toLocaleString('en-US')} posts/month
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Pro → Enterprise upgrade CTA */}
        {!isEnterprise && (
          <Card className="rounded-xl border-2 border-[#0A66C2]/30">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Crown className="h-4 w-4 text-[#0A66C2]" />
                    Upgrade to Enterprise
                  </CardTitle>
                  <CardDescription className="mt-1">
                    75 accounts × 250 posts/day = 562,500 posts/month capacity.
                  </CardDescription>
                </div>
                <Badge className="bg-[#0A66C2] text-white hover:bg-[#0A66C2]">$149/month</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Triple your account limit (25 → 75) and 5× your per-account daily post limit
                (50 → 250). Total monthly capacity jumps from 37,500 → 562,500 posts.
              </p>
              <Button
                className="w-full bg-[#0A66C2] hover:bg-[#004182] text-white"
                onClick={() => {
                  setSelectedPlan('enterprise');
                  // Scroll to top so the user sees the payment form below — but
                  // since we're in a paid branch, we need to swap to the upgrade
                  // flow. The simplest UX: switch the visible branch by setting
                  // a local override that re-renders the payment form.
                  setShowEnterpriseUpgradeForm(true);
                }}
              >
                Upgrade to Enterprise
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Inline Enterprise upgrade form (only shown when user clicks Upgrade) */}
        {showEnterpriseUpgradeForm && (
          <UpgradePaymentForm
            plan={UPGRADE_PLANS[1]}
            usdtTxHash={usdtTxHash}
            setUsdtTxHash={setUsdtTxHash}
            usdtSubmitting={usdtSubmitting}
            usdtCopied={usdtCopied}
            onUsdtSubmit={handleUsdtSubmit}
            binanceTxId={binanceTxId}
            setBinanceTxId={setBinanceTxId}
            binanceSubmitting={binanceSubmitting}
            binanceCopied={binanceCopied}
            onBinanceSubmit={handleBinanceSubmit}
            onCopy={copyToClipboard}
            onCancel={() => setShowEnterpriseUpgradeForm(false)}
          />
        )}

        {/* Payment history still shown for paid users */}
        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle className="text-base">Payment History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Method</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingPayments ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      </TableRow>
                    ))
                  ) : payments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No payment history</TableCell>
                    </TableRow>
                  ) : (
                    payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-sm">
                          <div className="flex items-center gap-2">
                            <CreditCard className="h-4 w-4 text-muted-foreground" />
                            <span className="capitalize">{p.method === 'usdt' ? 'USDT TRC20' : 'Binance Pay'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">${p.amount}</TableCell>
                        <TableCell className="capitalize">{p.plan}</TableCell>
                        <TableCell>{paymentStatusBadge(p.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(p.createdAt)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Free plan — show plan selector + payment options ────────
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Upgrade your plan</h3>
        <p className="text-sm text-muted-foreground">
          Pick a plan and pay with USDT (auto-verified) or Binance Pay (manual verify).
        </p>
      </div>

      {/* Plan selector */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {UPGRADE_PLANS.map((plan) => {
          const isSelected = selectedPlan === plan.id;
          return (
            <button
              key={plan.id}
              type="button"
              onClick={() => setSelectedPlan(plan.id)}
              className={
                'text-left rounded-xl border-2 p-5 transition-all ' +
                (isSelected
                  ? 'border-[#0A66C2] bg-[#0A66C2]/5 shadow-md'
                  : 'border-border hover:border-[#0A66C2]/40')
              }
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-base font-bold">{plan.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {plan.accounts} accounts · {plan.postsPerDay} posts/day/account
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-[#0A66C2]">${plan.price}</div>
                  <div className="text-xs text-muted-foreground">/month</div>
                </div>
              </div>
              <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
                <span className="text-muted-foreground">Monthly reach: </span>
                <span className="font-semibold text-foreground">
                  {plan.monthlyPosts.toLocaleString('en-US')} posts/month
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Payment forms (bound to the selected plan) */}
      <UpgradePaymentForm
        plan={activePlanMeta}
        usdtTxHash={usdtTxHash}
        setUsdtTxHash={setUsdtTxHash}
        usdtSubmitting={usdtSubmitting}
        usdtCopied={usdtCopied}
        onUsdtSubmit={handleUsdtSubmit}
        binanceTxId={binanceTxId}
        setBinanceTxId={setBinanceTxId}
        binanceSubmitting={binanceSubmitting}
        binanceCopied={binanceCopied}
        onBinanceSubmit={handleBinanceSubmit}
        onCopy={copyToClipboard}
      />

      {/* Payment History */}
      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle className="text-base">Payment History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingPayments ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    </TableRow>
                  ))
                ) : payments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No payment history</TableCell>
                  </TableRow>
                ) : (
                  payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">
                        <div className="flex items-center gap-2">
                          <CreditCard className="h-4 w-4 text-muted-foreground" />
                          <span className="capitalize">{p.method === 'usdt' ? 'USDT TRC20' : 'Binance Pay'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">${p.amount}</TableCell>
                      <TableCell className="capitalize">{p.plan}</TableCell>
                      <TableCell>{paymentStatusBadge(p.status)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(p.createdAt)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Local state hook to control the Enterprise upgrade form visibility from
// inside the paid-user branch. Declared as a module-level let + accessor
// would be fragile, so we use a tiny React hook + state inside UpgradeTab.
// This is hoisted out so the component can re-render cleanly.
//
// We can't use a hook above the early return — so instead we use a
// useState declared AT THE TOP of UpgradeTab (before any conditional
// return). Below is the helper component that renders the actual payment
// form (used by both the free-user branch and the Enterprise-upgrade branch).

type UpgradePaymentFormProps = {
  plan: typeof UPGRADE_PLANS[number]
  usdtTxHash: string
  setUsdtTxHash: (v: string) => void
  usdtSubmitting: boolean
  usdtCopied: boolean
  onUsdtSubmit: () => void
  binanceTxId: string
  setBinanceTxId: (v: string) => void
  binanceSubmitting: boolean
  binanceCopied: boolean
  onBinanceSubmit: () => void
  onCopy: (text: string, type: 'usdt' | 'binance') => void
  onCancel?: () => void
};

function UpgradePaymentForm({
  plan,
  usdtTxHash,
  setUsdtTxHash,
  usdtSubmitting,
  usdtCopied,
  onUsdtSubmit,
  binanceTxId,
  setBinanceTxId,
  binanceSubmitting,
  binanceCopied,
  onBinanceSubmit,
  onCopy,
  onCancel,
}: UpgradePaymentFormProps) {
  return (
    <div className="space-y-4">
      {/* Plan summary banner */}
      <div className="rounded-xl border bg-muted/30 p-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-sm text-muted-foreground">Paying for</div>
          <div className="text-lg font-bold capitalize">
            {plan.name} — ${plan.price}/month
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {plan.accounts} accounts × {plan.postsPerDay} posts/day × 30 days ={' '}
            <span className="font-semibold text-foreground">
              {plan.monthlyPosts.toLocaleString('en-US')} posts/month
            </span>
          </div>
        </div>
        {onCancel && (
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* USDT TRC20 Card */}
        <Card className="rounded-xl">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-[#0A66C2]/10 flex items-center justify-center shrink-0">
                <Wallet className="h-5 w-5 text-[#0A66C2]" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-base">USDT TRC20</CardTitle>
                <CardDescription>Auto-verified payment</CardDescription>
              </div>
              <Badge className="bg-[#0A66C2] text-white hover:bg-[#0A66C2]">Auto Verify</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Wallet Address */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Wallet Address (TRC20)</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-muted/50 border rounded-md px-3 py-2 font-mono text-xs break-all">
                  {USDT_WALLET_ADDRESS || 'USDT wallet not configured'}
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => USDT_WALLET_ADDRESS && onCopy(USDT_WALLET_ADDRESS, 'usdt')}
                  disabled={!USDT_WALLET_ADDRESS}
                >
                  {usdtCopied ? <CheckCircle2 className="h-4 w-4 text-[#0A66C2]" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Amount (read-only, locked to plan price) */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Amount (USDT) — locked to {plan.name} price
              </Label>
              <Input
                type="number"
                value={plan.price}
                disabled
                className="bg-muted/50 font-semibold"
              />
              <p className="text-xs text-muted-foreground">
                Send exactly <span className="font-semibold">${plan.price} USDT</span> (TRC20) to the wallet above.
              </p>
            </div>

            {/* Transaction Hash */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Transaction Hash</Label>
              <Input
                placeholder="Enter your TRC20 transaction hash"
                value={usdtTxHash}
                onChange={(e) => setUsdtTxHash(e.target.value)}
              />
            </div>

            <Button
              className="w-full bg-[#0A66C2] hover:bg-[#004182] text-white"
              onClick={onUsdtSubmit}
              disabled={usdtSubmitting}
            >
              {usdtSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Submit & Verify
            </Button>
          </CardContent>
        </Card>

        {/* Binance Pay Card */}
        <Card className="rounded-xl">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-yellow-100 flex items-center justify-center shrink-0">
                <CreditCard className="h-5 w-5 text-yellow-600" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-base">Binance Pay</CardTitle>
                <CardDescription>Manual verification by admin</CardDescription>
              </div>
              <Badge variant="outline" className="border-yellow-500 text-yellow-600 bg-yellow-50">Manual Verify</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Pay ID */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Binance Pay ID</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-muted/50 border rounded-md px-3 py-2 font-mono text-xs">
                  402905217
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => onCopy('402905217', 'binance')}
                >
                  {binanceCopied ? <CheckCircle2 className="h-4 w-4 text-[#0A66C2]" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Amount (read-only, locked to plan price) */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Amount (USD) — locked to {plan.name} price
              </Label>
              <Input
                type="number"
                value={plan.price}
                disabled
                className="bg-muted/50 font-semibold"
              />
              <p className="text-xs text-muted-foreground">
                Send exactly <span className="font-semibold">${plan.price} USD</span> via Binance Pay to the ID above.
              </p>
            </div>

            {/* Transaction ID */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Transaction ID</Label>
              <Input
                placeholder="Enter your Binance transaction ID"
                value={binanceTxId}
                onChange={(e) => setBinanceTxId(e.target.value)}
              />
            </div>

            <Button
              className="w-full bg-[#0A66C2] hover:bg-[#004182] text-white"
              onClick={onBinanceSubmit}
              disabled={binanceSubmitting}
            >
              {binanceSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Clock className="h-4 w-4 mr-2" />}
              Submit Payment
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              <Clock className="h-3 w-3 inline mr-1" />
              Admin verification may take up to 24 hours
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── AccountHistoryTab (NEW — account-wise publish history) ─────────
// Per-account view: pick one LinkedIn account and see every CSV batch
// uploaded to it, how many posts are already published vs scheduled,
// the exact publish time of the NEXT post, and each upload's posts in
// original CSV serial order (#1 = first CSV row).

function AccountHistoryTab() {
  const accounts = useAppStore((s) => s.accounts);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [history, setHistory] = useState<AccountHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [openUploadId, setOpenUploadId] = useState<string | null>(null);
  const [postsDetail, setPostsDetail] = useState<AccountHistoryPost[] | null>(null);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Auto-select the first account once accounts load
  useEffect(() => {
    if (!selectedAccountId && accounts.length > 0) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  const loadHistory = async (accountId: string) => {
    setLoading(true);
    try {
      const h = await api.getAccountHistory(accountId);
      setHistory(h);
    } catch {
      toast.error('Failed to load account history');
    } finally {
      setLoading(false);
    }
  };

  // Load history when the selected account changes
  useEffect(() => {
    if (selectedAccountId) {
      setOpenUploadId(null);
      setPostsDetail(null);
      loadHistory(selectedAccountId);
    }
  }, [selectedAccountId]);

  // Auto-refresh the overview every 15s so published counts and the
  // next-post time stay live while the scheduler works through a CSV.
  useEffect(() => {
    if (!selectedAccountId) return;
    const interval = setInterval(() => loadHistory(selectedAccountId), 15000);
    return () => clearInterval(interval);
  }, [selectedAccountId]);

  async function toggleUpload(uploadId: string) {
    if (openUploadId === uploadId) {
      setOpenUploadId(null);
      setPostsDetail(null);
      return;
    }
    setOpenUploadId(uploadId);
    setPostsDetail(null);
    setStatusFilter('all');
    setLoadingPosts(true);
    try {
      const res = await api.getAccountHistoryPosts(selectedAccountId, uploadId);
      setPostsDetail(res.posts);
    } catch {
      toast.error('Failed to load posts for this upload');
    } finally {
      setLoadingPosts(false);
    }
  }

  const filteredPosts = postsDetail
    ? statusFilter === 'all'
      ? postsDetail
      : postsDetail.filter((p) => p.status === statusFilter)
    : null;

  const nextPost = history?.nextPost;
  const minutesUntilNext = nextPost?.publishTime
    ? Math.max(0, Math.round((new Date(nextPost.publishTime).getTime() - Date.now()) / 60000))
    : null;
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  return (
    <div className="space-y-6">
      {/* Account selector */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="w-full sm:w-72">
          <Label className="text-xs text-muted-foreground mb-1.5">LinkedIn account</Label>
          <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select an account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((acc) => (
                <SelectItem key={acc.id} value={acc.id}>
                  {acc.accountName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedAccount && (
          <Badge variant={selectedAccount.isActive ? 'outline' : 'destructive'}>
            {selectedAccount.isActive ? 'Active' : 'Inactive'}
          </Badge>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card rounded-xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Published</p>
            {loading ? (
              <Skeleton className="h-7 w-16 mt-1" />
            ) : (
              <p className="text-2xl font-bold mt-1">{history?.totals.published ?? 0}</p>
            )}
          </CardContent>
        </Card>
        <Card className="bg-card rounded-xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Scheduled</p>
            {loading ? (
              <Skeleton className="h-7 w-16 mt-1" />
            ) : (
              <p className="text-2xl font-bold mt-1">{history?.totals.scheduled ?? 0}</p>
            )}
          </CardContent>
        </Card>
        <Card className="bg-card rounded-xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Failed</p>
            {loading ? (
              <Skeleton className="h-7 w-16 mt-1" />
            ) : (
              <p className="text-2xl font-bold mt-1 text-destructive">{history?.totals.failed ?? 0}</p>
            )}
          </CardContent>
        </Card>
        <Card className="bg-card rounded-xl border-[#0A66C2]/30">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Next post</p>
            {loading ? (
              <Skeleton className="h-7 w-32 mt-1" />
            ) : nextPost?.publishTime ? (
              <div className="mt-1">
                <p className="text-sm font-bold">{formatDate(nextPost.publishTime)}</p>
                <p className="text-xs text-muted-foreground">
                  in {minutesUntilNext} min — {truncate(nextPost.captionPreview, 40)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mt-1">None scheduled</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Uploads (CSV batches for this account) */}
      {loading && !history ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : history && history.uploads.length > 0 ? (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">CSV Uploads ({history.uploads.length})</h3>
          {history.uploads.map((u) => {
            const isOpen = openUploadId === u.id;
            return (
              <Card key={u.id} className="rounded-xl">
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{u.filename}</CardTitle>
                      <CardDescription>
                        {u.totalPosts} posts · every {u.intervalValue} {u.intervalUnit}(s) · uploaded{' '}
                        {formatDate(u.createdAt)}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {u.scheduleState === 'active' ? (
                        <Badge className="bg-green-600 text-white hover:bg-green-600">Active</Badge>
                      ) : u.scheduleState === 'paused' ? (
                        <Badge variant="outline" className="border-yellow-500 text-yellow-600 bg-yellow-50">
                          Paused
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Off</Badge>
                      )}
                      <Button size="sm" variant="outline" onClick={() => toggleUpload(u.id)}>
                        {isOpen ? 'Hide posts' : 'View posts (serial order)'}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge className="bg-[#0A66C2] text-white hover:bg-[#0A66C2]">
                      Published {u.counts.published}
                    </Badge>
                    <Badge variant="outline" className="border-blue-500 text-blue-600 bg-blue-50">
                      Scheduled {u.counts.scheduled}
                    </Badge>
                    <Badge variant="outline" className="border-yellow-500 text-yellow-600 bg-yellow-50">
                      Pending {u.counts.pending}
                    </Badge>
                    <Badge variant="outline">Processing {u.counts.processing}</Badge>
                    {u.counts.failed > 0 && <Badge variant="destructive">Failed {u.counts.failed}</Badge>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <p>
                      <Clock className="h-3 w-3 inline mr-1" />
                      First: {u.firstPublishAt ? formatDate(u.firstPublishAt) : '—'}
                    </p>
                    <p>
                      <Timer className="h-3 w-3 inline mr-1" />
                      Next: {u.nextPublishAt ? formatDate(u.nextPublishAt) : '—'}
                    </p>
                    <p>
                      <CalendarClock className="h-3 w-3 inline mr-1" />
                      Last: {u.lastPublishAt ? formatDate(u.lastPublishAt) : '—'}
                    </p>
                  </div>

                  {isOpen && (
                    <div className="pt-2">
                      {loadingPosts ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin text-[#0A66C2]" />
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground">Filter:</span>
                            {['all', 'published', 'scheduled', 'pending', 'processing', 'failed'].map((f) => (
                              <button
                                key={f}
                                onClick={() => setStatusFilter(f)}
                                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                                  statusFilter === f
                                    ? 'bg-[#0A66C2] text-white border-[#0A66C2]'
                                    : 'bg-card text-muted-foreground hover:bg-muted'
                                }`}
                              >
                                {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                              </button>
                            ))}
                            <span className="text-xs text-muted-foreground ml-auto">
                              {filteredPosts ? `${filteredPosts.length} / ${postsDetail?.length ?? 0} posts` : ''}
                            </span>
                          </div>
                          <div className="rounded-lg border overflow-x-auto max-h-[520px] overflow-y-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-16">Serial</TableHead>
                                  <TableHead>Caption</TableHead>
                                  <TableHead className="w-28">Status</TableHead>
                                  <TableHead className="w-44">Publish time</TableHead>
                                  <TableHead className="w-20">Retries</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {(filteredPosts ?? []).map((p) => (
                                  <TableRow key={p.id} className={p.status === 'processing' ? 'bg-blue-50/50' : undefined}>
                                    <TableCell className="font-mono text-xs text-muted-foreground">#{p.serial}</TableCell>
                                    <TableCell className="max-w-[280px]">
                                      <p className="text-sm truncate" title={p.captionPreview}>
                                        {p.captionPreview}
                                      </p>
                                      {p.error && (
                                        <p className="text-xs text-destructive truncate mt-0.5" title={p.error}>
                                          {p.error}
                                        </p>
                                      )}
                                    </TableCell>
                                    <TableCell>{statusBadge(p.status)}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                      {p.publishTime ? formatDate(p.publishTime) : '—'}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                      {p.retryCount > 0 ? p.retryCount : '—'}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="rounded-xl">
          <CardContent className="py-10 text-center">
            <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              No CSV uploads for this account yet. Upload a CSV from the Bulk Post tab — its full publish
              history will appear here in serial order.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Dashboard (main, default export) ───────────────────────────────

export default function Dashboard() {
  const dashboardTab = useAppStore((s) => s.dashboardTab);
  const setDashboardTab = useAppStore((s) => s.setDashboardTab);
  const user = useAppStore((s) => s.user);
  const setView = useAppStore((s) => s.setView);
  const logout = useAppStore((s) => s.logout);
  const refreshDashboard = useAppStore((s) => s.refreshDashboard);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    refreshDashboard();
  }, [refreshDashboard]);

  async function handleLogout() {
    await logout();
    setView('landing');
  }

  function handleSelectTab(tab: 'overview' | 'accounts' | 'create-post' | 'bulk-post' | 'history' | 'csv-history' | 'account-history' | 'upgrade') {
    setDashboardTab(tab);
    setMobileMenuOpen(false);
  }

  function renderTab() {
    switch (dashboardTab) {
      case 'overview':
        return <OverviewTab onSwitchTab={(tab) => setDashboardTab(tab)} />;
      case 'accounts':
        return <AccountsTab />;
      case 'create-post':
        return <PostCreatorTab />;
      case 'bulk-post':
        return <BulkPostTab />;
      case 'history':
        return <HistoryTab />;
      case 'csv-history':
        return <CsvHistoryTab />;
      case 'account-history':
        return <AccountHistoryTab />;
      case 'upgrade':
        return <UpgradeTab />;
      default:
        return <OverviewTab onSwitchTab={(tab) => setDashboardTab(tab)} />;
    }
  }

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : user?.email?.slice(0, 2).toUpperCase() || 'U';

  return (
    <div className="h-screen flex bg-muted/30">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 bg-card border-r flex-col shrink-0">
        <SidebarContent onSelectTab={handleSelectTab} onLogout={handleLogout} currentTab={dashboardTab} />
      </aside>

      {/* Main Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-14 bg-card border-b flex items-center px-4 gap-4 shrink-0">
          {/* Mobile Menu */}
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
              </SheetHeader>
              <SidebarContent onSelectTab={handleSelectTab} onLogout={handleLogout} currentTab={dashboardTab} />
            </SheetContent>
          </Sheet>

          <h1 className="text-lg font-semibold">{TAB_TITLES[dashboardTab] || 'Dashboard'}</h1>

          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {user?.email || ''}
            </span>
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-[#0A66C2] text-white text-xs">{initials}</AvatarFallback>
            </Avatar>
          </div>
        </header>

        {/* Tab Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6 max-w-6xl mx-auto">
            {renderTab()}
          </div>
        </main>
      </div>
    </div>
  );
}
