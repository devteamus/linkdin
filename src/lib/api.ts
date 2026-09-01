const API_BASE = '/api';

// ── Token Storage ──────────────────────────────────────────

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('postgo-token');
}

export function setToken(token: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('postgo-token', token);
}

export function clearToken() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('postgo-token');
}

// ── Request Helper ─────────────────────────────────────────

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(data.error || 'An error occurred', res.status);
  }

  return data as T;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const api = {
  // Auth
  register: (data: { name?: string; email: string; password: string }) =>
    request<{ user: User; token: string }>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),

  login: (data: { email: string; password: string }) =>
    request<{ user: User; token: string }>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),

  logout: () =>
    request<{ success: boolean }>('/auth/logout', { method: 'POST' }),

  me: () =>
    request<{ user: User }>('/auth/me'),

  forgotPassword: (data: { email: string }) =>
    request<{ success: boolean; message: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify(data) }),

  resetPassword: (data: { email: string; code: string; password: string }) =>
    request<{ success: boolean }>('/auth/reset-password', { method: 'POST', body: JSON.stringify(data) }),

  // Accounts
  getAccounts: () =>
    request<{ accounts: LinkedinAccount[] }>('/accounts').then(r => r.accounts),

  addAccount: (data: { linkedinMemberId: string; accountName: string; accessToken: string }) =>
    request<LinkedinAccount>('/accounts', { method: 'POST', body: JSON.stringify(data) }),

  deleteAccount: (id: string) =>
    request<{ success: boolean }>(`/accounts/${id}`, { method: 'DELETE' }),

  refreshAccount: (id: string, accessToken: string) =>
    request<LinkedinAccount>(`/accounts/${id}/refresh`, { method: 'PATCH', body: JSON.stringify({ accessToken }) }),

  // Dashboard
  getStats: (accountId?: string) =>
    request<DashboardStats>(`/dashboard/stats${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`),

  getApiUsage: (accountId?: string) =>
    request<ApiUsageStats>(`/dashboard/api-usage${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`),

  // Posts
  createPost: (data: {
    accountId: string;
    caption: string;
    imageUrl?: string;
    videoUrl?: string;
    publishTime?: string;
  }) =>
    request<{ post: Post }>('/posts', { method: 'POST', body: JSON.stringify(data) }).then(r => r.post),

  getPosts: (params?: { status?: string; page?: number; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    const query = searchParams.toString();
    return request<{ posts: PostWithAccount[]; total: number; page: number; limit: number }>(
      `/posts${query ? `?${query}` : ''}`
    );
  },

  bulkUpload: (file: File, accountId: string, intervalValue: number, intervalUnit: string) => {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('accountId', accountId);
    formData.append('intervalValue', String(intervalValue));
    formData.append('intervalUnit', intervalUnit);
    return fetch(`${API_BASE}/posts/bulk`, {
      method: 'POST',
      headers,
      body: formData,
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new ApiError(data.error || 'Upload failed', res.status);
      return data as BulkUploadResult;
    });
  },

  getCsvUploadPosts: (uploadId: string) =>
    request<CsvUploadDetail>(`/posts/bulk/${uploadId}`),

  publishPost: (id: string) =>
    request<Post>(`/posts/${id}/publish`, { method: 'POST' }),

  // CSV Uploads (NEW — for the CSV History tab + schedule controls)
  getCsvUploads: () =>
    request<{ uploads: CsvUploadSummary[] }>('/csv-uploads').then(r => r.uploads),

  getCsvUploadDetail: (id: string) =>
    request<CsvUploadDetail>(`/csv-uploads/${id}`),

  updateCsvUploadSchedule: (id: string, scheduleState: 'active' | 'paused' | 'off') =>
    request<{ success: boolean; scheduleState: string }>(`/csv-uploads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ scheduleState }),
    }),

  deleteCsvUpload: (id: string) =>
    request<{ success: boolean }>(`/csv-uploads/${id}`, { method: 'DELETE' }),

  // Admin
  getAdminStats: () =>
    request<AdminStats>('/admin/stats'),

  getAdminUsers: (params?: { page?: number; limit?: number; search?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.search) searchParams.set('search', params.search);
    const query = searchParams.toString();
    return request<AdminUsersResponse>(
      `/admin/users${query ? `?${query}` : ''}`
    );
  },

  updateUserPlan: (id: string, data: { plan?: string; role?: string }) =>
    request<{ success: boolean }>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteUser: (id: string) =>
    request<{ success: boolean }>(`/admin/users/${id}`, { method: 'DELETE' }),

  deleteAdminAccount: (id: string) =>
    request<{ success: boolean }>(`/admin/accounts/${id}`, { method: 'DELETE' }),

  // Payments
  createPayment: (data: { method: 'usdt' | 'binance'; amount: number; plan: 'pro' | 'enterprise'; txHash?: string; transactionId?: string }) =>
    request<{ payment: Payment }>('/payment', { method: 'POST', body: JSON.stringify(data) }),

  verifyUsdt: (paymentId: string) =>
    request<{ success: boolean; message: string; plan: string }>('/payment/verify-usdt', { method: 'POST', body: JSON.stringify({ paymentId }) }),

  getPaymentHistory: () =>
    request<{ payments: Payment[] }>('/payment/history'),

  getAdminPayments: (params?: { status?: string; page?: number; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    const query = searchParams.toString();
    return request<AdminPaymentsResponse>(
      `/admin/payments${query ? `?${query}` : ''}`
    );
  },

  adminVerifyPayment: (id: string, action: 'verify' | 'reject') =>
    request<{ success: boolean; message: string }>(`/admin/payments/${id}`, { method: 'POST', body: JSON.stringify({ action }) }),
};

// Types
export interface User {
  id: string;
  name: string | null;
  email: string;
  role: string;
  plan: string;
  createdAt: string;
  // ─── Subscription expiry (paid plans only) ───
  planExpiresAt?: string | null;
  planRenewedAt?: string | null;
  // The EFFECTIVE plan (respects expiry). If the user's `plan` is 'pro'
  // but the subscription has expired, `effectivePlan` will be 'free'.
  effectivePlan?: string;
  isExpired?: boolean;
}

export interface LinkedinAccount {
  id: string;
  linkedinMemberId: string;
  accountName: string;
  isActive: boolean;
  createdAt: string;
}

export interface Post {
  id: string;
  accountId: string;
  caption: string;
  imageUrl: string | null;
  videoUrl?: string | null;
  comment?: string | null;
  status: string;
  publishTime: string | null;
  error: string | null;
  linkedinPostUrn?: string | null;
  createdAt: string;
}

export interface PostWithAccount extends Post {
  accountName: string;
}

export interface Payment {
  id: string;
  method: string;
  amount: number;
  txHash: string | null;
  transactionId: string | null;
  status: string;
  plan: string;
  verifiedAt: string | null;
  createdAt: string;
}

export interface AdminPayment extends Payment {
  user: {
    id: string;
    name: string | null;
    email: string;
  };
}

export interface DashboardStats {
  accountId?: string | null;
  plan?: string;
  rawPlan?: string;
  isExpired?: boolean;
  planExpiresAt?: string | null;
  totalAccounts: number;
  uniqueAccountsConnected?: number;
  maxAccounts?: number;
  todayPosts: number;
  scheduledPosts: number;
  failedPosts: number;
  // API usage summary (for the API Call Counter card)
  apiCallsUsed: number;
  apiCallsLimit: number;
  postsDailyLimit: number;
  // Monthly capacity
  postsThisMonth?: number;
  monthlyPostsLimit?: number;
  postsRemainingThisMonth?: number;
}

export interface ApiUsageStats {
  accountId?: string | null;
  plan?: string;
  rawPlan?: string;
  isExpired?: boolean;
  planExpiresAt?: string | null;
  apiCallsUsed: number;
  apiCallsLimit: number;
  apiCallsRemaining: number;
  postsPublishedToday: number;
  postsDailyLimit: number;
  postsRemainingToday: number;
  // Monthly capacity
  postsThisMonth?: number;
  monthlyPostsLimit?: number;
  postsRemainingThisMonth?: number;
  resetTime: string;
  windowStart: string;
}

export interface AdminStats {
  totalUsers: number;
  totalPosts: number;
  totalAccounts: number;
  totalRevenue: number;
  proUsers: number;
  enterpriseUsers: number;
  recentUsers: {
    id: string;
    name: string | null;
    email: string;
    plan: string;
    role: string;
    createdAt: string;
  }[];
}

export interface AdminUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  plan: string;
  createdAt: string;
  _count: {
    posts: number;
    linkedinAccounts: number;
  };
}

export interface AdminUsersResponse {
  users: AdminUser[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminPaymentsResponse {
  payments: AdminPayment[];
  total: number;
  page: number;
  limit: number;
}

export interface BulkUploadResult {
  uploadId: string;
  totalProcessed: number;
  validRows: number;
  skippedRows: number;
  errors: string[];
  scheduleInfo: {
    firstPublish: string;
    lastPublish: string;
    daysSpan: number;
    interval: string;
  };
}

export interface CsvUploadPost {
  id: string;
  caption: string;
  imageUrl: string | null;
  videoUrl?: string | null;
  comment?: string | null;
  status: string;
  publishTime: string | null;
  error: string | null;
  createdAt: string;
}

export interface CsvUploadDetail {
  upload: {
    id: string;
    filename: string;
    totalPosts: number;
    intervalValue: number;
    intervalUnit: string;
    status: string;
    scheduleState?: string;
    createdAt: string;
  };
  posts: CsvUploadPost[];
  statusCounts: {
    pending: number;
    scheduled: number;
    published: number;
    failed: number;
  };
}

// CSV Upload summary as returned by GET /api/csv-uploads
export interface CsvUploadSummary {
  id: string;
  filename: string;
  totalPosts: number;
  intervalValue: number;
  intervalUnit: string;
  status: string;
  scheduleState: 'active' | 'paused' | 'off';
  createdAt: string;
  accountId: string;
  statusCounts: {
    published: number;
    scheduled: number;
    pending: number;
    failed: number;
  };
}
