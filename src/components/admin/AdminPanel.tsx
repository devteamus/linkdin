'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  Users,
  DollarSign,
  LogOut,
  Menu,
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Trash2,
  UserPlus,
  FileText,
  Link2,
  TrendingUp,
  Crown,
  CreditCard,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';

import { useAppStore } from '@/lib/store';
import { api, type AdminStats, type AdminUser, type AdminUsersResponse, type AdminPayment, ApiError } from '@/lib/api';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

// ── Constants ─────────────────────────────────────────

type AdminTab = 'overview' | 'users' | 'payments' | 'revenue';

const NAV_ITEMS: { key: AdminTab; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Overview', icon: <LayoutDashboard className="h-5 w-5" /> },
  { key: 'users', label: 'Users', icon: <Users className="h-5 w-5" /> },
  { key: 'payments', label: 'Payments', icon: <CreditCard className="h-5 w-5" /> },
  { key: 'revenue', label: 'Revenue', icon: <DollarSign className="h-5 w-5" /> },
];

const TAB_TITLES: Record<AdminTab, string> = {
  overview: 'Overview',
  users: 'User Management',
  payments: 'Payment Verification',
  revenue: 'Revenue Analytics',
};

// ── Helpers ───────────────────────────────────────────

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getInitials(name: string | null, email: string) {
  if (name) {
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  }
  return email.slice(0, 2).toUpperCase();
}

function planBadge(plan: string) {
  const variants: Record<string, string> = {
    free: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    pro: 'bg-[#0A66C2]/10 text-[#004182] dark:bg-[#4D9DE0]/30 dark:text-[#4D9DE0]',
    enterprise: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  };
  return (
    <Badge variant="secondary" className={variants[plan] || variants.free}>
      {plan.charAt(0).toUpperCase() + plan.slice(1)}
    </Badge>
  );
}

// ── Stat Card ──────────────────────────────────────────

function AdminStatCard({ title, value, icon, loading }: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <Card className="rounded-xl">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{title}</p>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="text-2xl font-bold">{value}</p>
            )}
          </div>
          <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Sidebar Content ────────────────────────────────────

function AdminSidebarContent({ activeTab, onTabChange, onLogout, userName, userEmail }: {
  activeTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  onLogout: () => void;
  userName: string | null;
  userEmail: string;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-lg">P</span>
          </div>
          <div>
            <h2 className="font-semibold text-sm">PostGo</h2>
            <p className="text-xs text-muted-foreground">Admin Panel</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            onClick={() => onTabChange(item.key)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === item.key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      <div className="p-4 border-t">
        <div className="flex items-center gap-3 mb-3 px-2">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
              {getInitials(userName, userEmail)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{userName || 'Admin'}</p>
            <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 transition-colors"
        >
          <LogOut className="h-5 w-5" />
          Sign out
        </button>
      </div>
    </div>
  );
}

// ── Overview Tab ───────────────────────────────────────

function OverviewTab({ stats, loading, onNavigate }: {
  stats: AdminStats | null;
  loading: boolean;
  onNavigate: (tab: AdminTab) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <AdminStatCard
          title="Total Users"
          value={stats?.totalUsers ?? 0}
          icon={<Users className="h-6 w-6" />}
          loading={loading}
        />
        <AdminStatCard
          title="Total Posts"
          value={stats?.totalPosts ?? 0}
          icon={<FileText className="h-6 w-6" />}
          loading={loading}
        />
        <AdminStatCard
          title="Total Accounts"
          value={stats?.totalAccounts ?? 0}
          icon={<Link2 className="h-6 w-6" />}
          loading={loading}
        />
        <AdminStatCard
          title="Monthly Revenue"
          value={`$${stats?.totalRevenue ?? 0}`}
          icon={<DollarSign className="h-6 w-6" />}
          loading={loading}
        />
      </div>

      <Card className="rounded-xl">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Recent Users</CardTitle>
              <CardDescription>Latest 5 registered users</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => onNavigate('users')}>
              View all
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !stats?.recentUsers.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">No users yet</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.recentUsers.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-xs bg-primary/10 text-primary">
                              {getInitials(u.name, u.email)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium">{u.name || 'No name'}</p>
                            <p className="text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{planBadge(u.plan)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(u.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Users Tab ──────────────────────────────────────────

function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const limit = 10;

  const totalPages = Math.ceil(total / limit);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data: AdminUsersResponse = await api.getAdminUsers({ page, limit, search });
      setUsers(data.users);
      setTotal(data.total);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handlePlanChange = async (userId: string, plan: string) => {
    setActionLoading(userId);
    try {
      await api.updateUserPlan(userId, { plan });
      toast.success('Plan updated successfully');
      fetchUsers();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update plan');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    setActionLoading(deleteTarget.id);
    try {
      await api.deleteUser(deleteTarget.id);
      toast.success('User deleted successfully');
      setDeleteTarget(null);
      fetchUsers();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete user');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-sm w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-9 rounded-lg"
          />
        </div>
        <Button onClick={handleSearch} size="sm" variant="outline">
          Search
        </Button>
      </div>

      <Card className="rounded-xl">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : !users.length ? (
            <div className="py-16 text-center">
              <Users className="h-12 w-12 mx-auto text-muted-foreground/40" />
              <p className="mt-4 text-muted-foreground text-sm">
                {search ? 'No users match your search' : 'No users registered yet'}
              </p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="text-center">Posts</TableHead>
                    <TableHead className="text-center">Accounts</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-xs bg-primary/10 text-primary">
                              {getInitials(u.name, u.email)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium">{u.name || 'No name'}</p>
                            <p className="text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="cursor-pointer">
                              {planBadge(u.plan)}
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={() => handlePlanChange(u.id, 'free')}>
                              <span className="h-2 w-2 rounded-full bg-gray-400 mr-2" />
                              Free
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handlePlanChange(u.id, 'pro')}>
                              <span className="h-2 w-2 rounded-full bg-[#0A66C2]/50 mr-2" />
                              Pro ($49/mo)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handlePlanChange(u.id, 'enterprise')}>
                              <span className="h-2 w-2 rounded-full bg-purple-500/60 mr-2" />
                              Enterprise ($149/mo)
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-sm text-muted-foreground">{u._count.posts}</span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-sm text-muted-foreground">{u._count.linkedinAccounts}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">{formatDate(u.createdAt)}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-red-600"
                          onClick={() => setDeleteTarget(u)}
                          disabled={actionLoading === u.id}
                        >
                          {actionLoading === u.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {Math.min((page - 1) * limit + 1, total)}–{Math.min(page * limit, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <span className="text-sm font-medium">Page {page} of {totalPages}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name || deleteTarget?.email}</strong>?
              This will permanently remove the user and all their data including posts, accounts, and uploads.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={!!actionLoading}
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Revenue Tab ────────────────────────────────────────

// Plan prices (mirrors src/lib/plan-limits.ts PLAN_PRICES for the client bundle)
const ADMIN_PLAN_PRICES = { pro: 49, enterprise: 149 };

function RevenueTab({ stats, loading }: {
  stats: AdminStats | null;
  loading: boolean;
}) {
  // Count users per plan (free / pro / enterprise).
  // The admin stats API returns proUsers & enterpriseUsers, but for visual
  // consistency we re-fetch via getAdminUsers to also show free count.
  const [planData, setPlanData] = useState<{ free: number; pro: number; enterprise: number }>({
    free: 0,
    pro: 0,
    enterprise: 0,
  });

  useEffect(() => {
    async function fetchPlanData() {
      try {
        const data = await api.getAdminUsers({ page: 1, limit: 1000 });
        const counts = { free: 0, pro: 0, enterprise: 0 };
        data.users.forEach((u) => {
          if (u.plan === 'pro') counts.pro++;
          else if (u.plan === 'enterprise') counts.enterprise++;
          else counts.free++;
        });
        setPlanData(counts);
      } catch {
        // silently fail
      }
    }
    fetchPlanData();
  }, []);

  const revenuePerPlan = {
    free: 0,
    pro: planData.pro * ADMIN_PLAN_PRICES.pro,
    enterprise: planData.enterprise * ADMIN_PLAN_PRICES.enterprise,
  };

  const totalRevenue = revenuePerPlan.pro + revenuePerPlan.enterprise;

  const planCards = [
    {
      name: 'Free',
      icon: <UserPlus className="h-6 w-6" />,
      count: planData.free,
      price: '$0/mo',
      revenue: '$0',
      color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
      iconBg: 'bg-gray-100 dark:bg-gray-800',
    },
    {
      name: 'Pro',
      icon: <Crown className="h-6 w-6" />,
      count: planData.pro,
      price: `$${ADMIN_PLAN_PRICES.pro}/mo`,
      revenue: `$${revenuePerPlan.pro}`,
      color: 'bg-[#0A66C2]/10 text-[#004182] dark:bg-[#4D9DE0]/30 dark:text-[#4D9DE0]',
      iconBg: 'bg-[#0A66C2]/10 dark:bg-[#4D9DE0]/30',
    },
    {
      name: 'Enterprise',
      icon: <Crown className="h-6 w-6" />,
      count: planData.enterprise,
      price: `$${ADMIN_PLAN_PRICES.enterprise}/mo`,
      revenue: `$${revenuePerPlan.enterprise}`,
      color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
      iconBg: 'bg-purple-100 dark:bg-purple-900/40',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {planCards.map((plan) => (
          <Card key={plan.name} className="rounded-xl">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${plan.iconBg}`}>
                  {plan.icon}
                </div>
                <Badge variant="secondary" className={plan.color}>
                  {plan.name}
                </Badge>
              </div>
              <div className="space-y-1">
                <p className="text-3xl font-bold">{plan.count}</p>
                <p className="text-sm text-muted-foreground">users on this plan</p>
              </div>
              <div className="mt-4 pt-4 border-t flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Price</span>
                <span className="text-sm font-medium">{plan.price}</span>
              </div>
              <div className="mt-2 flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Revenue</span>
                <span className="text-sm font-semibold text-primary">{plan.revenue}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Revenue Breakdown
          </CardTitle>
          <CardDescription>Monthly revenue based on current plan distribution</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                <span className="text-sm font-medium">Pro Revenue</span>
                <span className="text-sm text-muted-foreground">
                  {planData.pro} users × ${ADMIN_PLAN_PRICES.pro}
                </span>
                <span className="font-semibold">${revenuePerPlan.pro}</span>
              </div>
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                <span className="text-sm font-medium">Enterprise Revenue</span>
                <span className="text-sm text-muted-foreground">
                  {planData.enterprise} users × ${ADMIN_PLAN_PRICES.enterprise}
                </span>
                <span className="font-semibold">${revenuePerPlan.enterprise}</span>
              </div>
              <div className="flex items-center justify-between p-4 rounded-lg bg-primary/10 border border-primary/20">
                <span className="font-semibold">Total Monthly Revenue</span>
                <span className="text-xl font-bold text-primary">${totalRevenue}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle className="text-lg">User Growth Info</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="text-center p-4 rounded-lg bg-muted/50">
                <p className="text-2xl font-bold">{stats?.totalUsers ?? 0}</p>
                <p className="text-sm text-muted-foreground mt-1">Total Users</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted/50">
                <p className="text-2xl font-bold">{planData.pro}</p>
                <p className="text-sm text-muted-foreground mt-1">Paid Users</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted/50">
                <p className="text-2xl font-bold">
                  {stats?.totalUsers ? Math.round((planData.pro / stats.totalUsers) * 100) : 0}%
                </p>
                <p className="text-sm text-muted-foreground mt-1">Conversion Rate</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Payments Tab ────────────────────────────────────

function PaymentsTab() {
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('pending_manual');
  const limit = 10;

  const totalPages = Math.ceil(total / limit);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAdminPayments({ status: statusFilter, page, limit });
      setPayments(data.payments);
      setTotal(data.total);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const handleAction = async (id: string, action: 'verify' | 'reject') => {
    setActionLoading(id);
    try {
      const res = await api.adminVerifyPayment(id, action);
      toast.success(res.message);
      fetchPayments();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to ${action} payment`);
    } finally {
      setActionLoading(null);
    }
  };

  const paymentStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="border-blue-500 text-blue-600 bg-blue-50">Pending (USDT)</Badge>;
      case 'pending_manual':
        return <Badge variant="outline" className="border-yellow-500 text-yellow-600 bg-yellow-50">Pending Manual</Badge>;
      case 'verified':
        return <Badge className="bg-[#0A66C2] text-white hover:bg-[#0A66C2]">Verified</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Payment Verification</h3>
          <p className="text-sm text-muted-foreground">Review and verify user payments</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending_manual">Pending Manual</SelectItem>
              <SelectItem value="pending">Pending USDT</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => fetchPayments()} size="sm" variant="outline">
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Card className="rounded-xl">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : !payments.length ? (
            <div className="py-16 text-center">
              <CreditCard className="h-12 w-12 mx-auto text-muted-foreground/40" />
              <p className="mt-4 text-muted-foreground text-sm">No payments found with this status</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>TX ID / Hash</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">{p.user.name || 'No name'}</p>
                          <p className="text-xs text-muted-foreground">{p.user.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={p.method === 'usdt' ? 'border-[#0A66C2] text-[#0A66C2]' : 'border-amber-500 text-amber-600'}>
                          {p.method === 'usdt' ? 'USDT TRC20' : 'Binance Pay'}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        ${p.amount.toFixed(2)}
                      </TableCell>
                      <TableCell>{planBadge(p.plan)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-28 truncate">
                        {p.transactionId || p.txHash || '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(p.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {p.status !== 'verified' && p.status !== 'rejected' ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-[#0A66C2] hover:text-[#004182] hover:bg-[#0A66C2]/5"
                              onClick={() => handleAction(p.id, 'verify')}
                              disabled={!!actionLoading}
                            >
                              {actionLoading === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                              <span className="ml-1 hidden sm:inline">Verify</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => handleAction(p.id, 'reject')}
                              disabled={!!actionLoading}
                            >
                              {actionLoading === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                              <span className="ml-1 hidden sm:inline">Reject</span>
                            </Button>
                          </div>
                        ) : (
                          paymentStatusBadge(p.status)
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {Math.min((page - 1) * limit + 1, total)}–{Math.min(page * limit, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <span className="text-sm font-medium">Page {page} of {totalPages}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Admin Panel ───────────────────────────────────

export default function AdminPanel() {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  const { user, logout } = useAppStore();

  const fetchStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const data = await api.getAdminStats();
      setStats(data);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to load stats');
    } finally {
      setLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleTabChange = (tab: AdminTab) => {
    setActiveTab(tab);
    setMobileOpen(false);
  };

  const handleLogout = () => {
    logout();
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 flex-col border-r bg-card">
        <AdminSidebarContent
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onLogout={handleLogout}
          userName={user?.name ?? null}
          userEmail={user?.email ?? ''}
        />
      </aside>

      {/* Mobile Sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-64">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <AdminSidebarContent
            activeTab={activeTab}
            onTabChange={handleTabChange}
            onLogout={handleLogout}
            userName={user?.name ?? null}
            userEmail={user?.email ?? ''}
          />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-16 border-b flex items-center px-6 gap-4 bg-card">
          <button
            className="lg:hidden p-2 rounded-lg hover:bg-muted"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold">{TAB_TITLES[activeTab]}</h1>
        </header>

        {/* Content */}
        <div className="flex-1 p-6 overflow-y-auto">
          {activeTab === 'overview' && (
            <OverviewTab stats={stats} loading={loadingStats} onNavigate={handleTabChange} />
          )}
          {activeTab === 'users' && <UsersTab />}
          {activeTab === 'payments' && <PaymentsTab />}
          {activeTab === 'revenue' && <RevenueTab stats={stats} loading={loadingStats} />}
        </div>
      </main>
    </div>
  );
}
