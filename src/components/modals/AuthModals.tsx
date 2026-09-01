'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { api, setToken } from '@/lib/api';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
      {message}
    </div>
  );
}

export function AuthModals() {
  const authModal = useAppStore((s) => s.authModal);

  return (
    <>
      {authModal === 'login' && <LoginModal />}
      {authModal === 'signup' && <SignupModal />}
      {authModal === 'forgot-password' && <ForgotPasswordModal />}
    </>
  );
}

// ── Login Modal ─────────────────────────────────────────────

function LoginModal() {
  const { setAuthModal, fetchUser } = useAppStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError('Email is required'); return; }
    if (!password.trim()) { setError('Password is required'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await api.login({ email: email.trim(), password });
      setToken(res.token);
      await fetchUser();
      setAuthModal('none');
      toast.success('Welcome back!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) setAuthModal('none'); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl">Welcome Back</DialogTitle>
          <DialogDescription>Sign in to your PostGo account</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <ErrorBanner message={error} />}
          <div className="space-y-2">
            <Label htmlFor="login-email">Email</Label>
            <Input id="login-email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="login-password">Password</Label>
            <Input id="login-password" type="password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Login
          </Button>
          <div className="flex items-center justify-between text-sm">
            <button type="button" className="text-primary hover:underline" onClick={() => setAuthModal('forgot-password')}>Forgot password?</button>
            <button type="button" className="text-primary hover:underline" onClick={() => setAuthModal('signup')}>Don&apos;t have an account? <span className="font-semibold">Sign up</span></button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Signup Modal ───────────────────────────────────────────

function SignupModal() {
  const { setAuthModal, fetchUser } = useAppStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError('Email is required'); return; }
    if (!password || password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await api.register({ name: name.trim() || undefined, email: email.trim(), password });
      setToken(res.token);
      await fetchUser();
      setAuthModal('none');
      toast.success('Account created! Welcome to PostGo.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) setAuthModal('none'); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl">Create Your Account</DialogTitle>
          <DialogDescription>Get started with PostGo today</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <ErrorBanner message={error} />}
          <div className="space-y-2">
            <Label htmlFor="signup-name">Name <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input id="signup-name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="signup-email">Email</Label>
            <Input id="signup-email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="signup-password">Password</Label>
            <Input id="signup-password" type="password" placeholder="Min. 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Account
          </Button>
          <div className="text-center text-sm">
            <button type="button" className="text-primary hover:underline" onClick={() => setAuthModal('login')}>Already have an account? <span className="font-semibold">Log in</span></button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Forgot Password Modal ───────────────────────────────────
// Two steps: (1) request a code by email, (2) enter the 6-digit code +
// new password. The email is limited server-side to 3 codes / 24h and
// each code is valid for 15 minutes and works once.

function ForgotPasswordModal() {
  const { setAuthModal } = useAppStore();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const requestCode = async (isResend = false) => {
    setError('');
    if (isResend) setResending(true); else setLoading(true);
    try {
      const res = await api.forgotPassword({ email: email.trim() });
      toast.success(res.message || 'Verification code sent!');
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send verification code');
    } finally {
      setLoading(false);
      setResending(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError('Email is required'); return; }
    await requestCode(false);
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) { setError('Enter the 6-digit code from your email'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    setError('');
    setLoading(true);
    try {
      await api.resetPassword({ email: email.trim(), code: code.trim(), password });
      setAuthModal('none');
      toast.success('Password reset successfully! Please log in.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) setAuthModal('none'); }}>
      <DialogContent className="sm:max-w-md">
        {step === 'email' ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl">Reset Password</DialogTitle>
              <DialogDescription>Enter your email and we&apos;ll send you a 6-digit verification code</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              {error && <ErrorBanner message={error} />}
              <div className="space-y-2">
                <Label htmlFor="forgot-email">Email</Label>
                <Input id="forgot-email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send Verification Code
              </Button>
              <div className="text-center text-sm">
                <button type="button" className="text-primary hover:underline" onClick={() => setAuthModal('login')}>Back to Login</button>
              </div>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl">Enter Verification Code</DialogTitle>
              <DialogDescription>
                We sent a 6-digit code to <span className="font-medium">{email}</span>. Check your inbox and spam/promotions folder — it expires in 15 minutes.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCodeSubmit} className="space-y-4">
              {error && <ErrorBanner message={error} />}
              <div className="space-y-2">
                <Label htmlFor="reset-code">Verification Code</Label>
                <Input
                  id="reset-code"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  className="tracking-[0.5em] text-center text-lg"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reset-password">New Password</Label>
                <Input id="reset-password" type="password" placeholder="Min. 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reset-confirm-password">Confirm New Password</Label>
                <Input id="reset-confirm-password" type="password" placeholder="Re-enter new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Reset Password
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button type="button" className="text-primary hover:underline" onClick={() => setStep('email')}>Change email</button>
                <button
                  type="button"
                  className="text-primary hover:underline disabled:opacity-50 disabled:no-underline"
                  disabled={resending}
                  onClick={() => requestCode(true)}
                >
                  {resending ? 'Sending...' : 'Resend code'}
                </button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
