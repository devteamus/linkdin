'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Variants, Transition } from 'framer-motion';
import { toast } from 'sonner';
import {
  Users,
  Send,
  FileSpreadsheet,
  CalendarClock,
  BarChart3,
  ShieldCheck,
  CheckCircle,
  Mail,
  Clock,
  Globe,
  Menu,
  LogOut,
  LayoutDashboard,
  ArrowRight,
  ChevronRight,
  ChevronDown,
  Target,
  Zap,
} from 'lucide-react';

import { useAppStore } from '@/lib/store';
import type { LandingSection, LandingPageView } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// ─── Animation Variants ─────────────────────────────────────────────────────

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: 'easeOut' } as Transition,
  }),
};

const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const pageTransition = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } as Transition },
  exit: { opacity: 0, y: -12, transition: { duration: 0.2, ease: 'easeIn' } as Transition },
};

// ─── Nav Configuration ───────────────────────────────────────────────────────

// Scroll-to-section links (these stay on the home page)
const scrollNavLinks: { label: string; section: LandingSection }[] = [
  { label: 'Features', section: 'features' },
  { label: 'Pricing', section: 'pricing' },
];

// Full-page navigation links
const pageNavLinks: { label: string; page: LandingPageView }[] = [
  { label: 'About', page: 'about' },
  { label: 'Contact', page: 'contact' },
];

// ─── Features Data ──────────────────────────────────────────────────────────

const features = [
  {
    icon: Users,
    title: 'Multi-Account Management',
    description:
      'Connect up to 75 LinkedIn accounts (Enterprise plan) and manage them all from a single dashboard.',
  },
  {
    icon: Send,
    title: 'Single Post Publishing',
    description:
      'Create and publish individual posts with images, scheduling, and preview.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Bulk CSV Upload',
    description:
      'Upload a CSV file with hundreds of posts and schedule them all at once.',
  },
  {
    icon: CalendarClock,
    title: 'Smart Scheduling',
    description:
      'Set exact publish times or publish immediately. Full control over your content calendar.',
  },
  {
    icon: BarChart3,
    title: 'Post History & Analytics',
    description:
      'Track every post status: pending, scheduled, published, or failed with detailed logs.',
  },
  {
    icon: ShieldCheck,
    title: 'Secure Token Storage',
    description:
      'LinkedIn access tokens are encrypted at rest. Your credentials are never exposed.',
  },
];

// ─── Pricing Plans ────────────────────────────────────────────────────────
//
// Three tiers: Free / Pro ($49) / Enterprise ($149).
//
// Monthly capacity math (shown on the card so users see the real value):
//   Pro        : 25 accounts × 50 posts/day  × 30 days =  37,500 posts/month
//   Enterprise : 75 accounts × 250 posts/day × 30 days = 562,500 posts/month
//
type PricingPlan = {
  id: 'free' | 'pro' | 'enterprise'
  name: string
  price: number
  priceLabel: string
  badge?: string
  highlight?: boolean
  accounts: number
  postsPerDay: number
  monthlyPosts: number
  features: string[]
  cta: string
}

const pricingPlans: PricingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    priceLabel: '$0',
    accounts: 2,
    postsPerDay: 10,
    monthlyPosts: 600,
    features: [
      '2 LinkedIn accounts',
      '10 posts per account per day',
      'Single post publishing',
      'Post scheduling',
      'Post history & analytics',
      'Encrypted token storage',
    ],
    cta: 'Start Free',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 49,
    priceLabel: '$49',
    badge: 'Most Popular',
    highlight: true,
    accounts: 25,
    postsPerDay: 50,
    monthlyPosts: 37500,
    features: [
      '25 LinkedIn accounts',
      '50 posts per account per day',
      'Single & bulk post publishing',
      'CSV upload (up to 5 MB)',
      'Post scheduling + bulk pause/resume',
      'Post history & analytics',
      'Encrypted token storage',
      'Email support',
    ],
    cta: 'Get Pro Now',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 149,
    priceLabel: '$149',
    badge: 'Best Value',
    accounts: 75,
    postsPerDay: 250,
    monthlyPosts: 562500,
    features: [
      '75 LinkedIn accounts',
      '250 posts per account per day',
      'Single & bulk post publishing',
      'CSV upload (up to 5 MB)',
      'Post scheduling + bulk pause/resume',
      'Post history & analytics',
      'Encrypted token storage',
      'Priority email support',
    ],
    cta: 'Get Enterprise',
  },
];

function formatMonthlyPosts(n: number): string {
  return n.toLocaleString('en-US');
}

// ─── FAQ Data ───────────────────────────────────────────────────────────────

const faqItems = [
  {
    question: 'How many LinkedIn accounts can I connect?',
    answer:
      'Free plan: up to 2 accounts. Pro plan ($49/month): up to 25 accounts. Enterprise plan ($149/month): up to 75 accounts. Each account is fully isolated with its own queue and history.',
  },
  {
    question: 'How many posts can I publish per day?',
    answer:
      'Per-account daily limits: Free = 10 posts, Pro = 50 posts, Enterprise = 250 posts. Across all your accounts, that means up to 1,250 posts/day on Pro (25 × 50) or up to 18,750 posts/day on Enterprise (75 × 250) — roughly 37,500 posts/month on Pro and 562,500 posts/month on Enterprise.',
  },
  {
    question: 'How does bulk posting work?',
    answer:
      "Upload a CSV file with your posts (caption, image_url / media_url / video_url, optional comment). We'll parse it and schedule all posts automatically. CSVs larger than your per-account daily limit auto-spread across multiple days so you never exceed LinkedIn's API limits.",
  },
  {
    question: 'Is my LinkedIn data secure?',
    answer:
      'Absolutely. Your LinkedIn access tokens are encrypted at rest using AES-256 encryption. We never expose tokens to the browser, and all API calls are authenticated.',
  },
  {
    question: 'What payment methods do you accept?',
    answer:
      'We accept USDT (TRC20) — auto-verified on-chain via TronScan — and Binance Pay (manual admin verification, usually approved within 24 hours). Choose your plan (Pro $49/month or Enterprise $149/month) on the dashboard after signing up.',
  },
  {
    question: 'Can I cancel anytime?',
    answer:
      'Yes, you can cancel your subscription at any time. There are no long-term contracts or hidden fees. Your plan stays active until the end of the current billing period.',
  },
  {
    question: 'Do you generate content for me?',
    answer:
      'No. PostGo is a publishing platform only. You provide the content, and we handle the scheduling and publishing logistics across all your LinkedIn accounts.',
  },
  {
    question: 'Can I upgrade from Pro to Enterprise later?',
    answer:
      'Yes — upgrade anytime from your dashboard. The Enterprise plan unlocks 75 accounts and 250 posts/day/account, giving you up to 562,500 posts/month of total capacity.',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-Page: About
// ═══════════════════════════════════════════════════════════════════════════════

function AboutPageContent() {
  return (
    <motion.div key="about" {...pageTransition} className="py-16 md:py-24">
      {/* Hero */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="text-center max-w-3xl mx-auto mb-20"
        >
          <motion.h1
            variants={fadeUp}
            custom={0}
            className="text-4xl md:text-5xl font-bold tracking-tight"
          >
            About{' '}
            <span className="gradient-text">PostGo</span>
          </motion.h1>
          <motion.p
            variants={fadeUp}
            custom={1}
            className="mt-6 text-lg text-muted-foreground leading-relaxed"
          >
            PostGo was created for social media managers, agencies, and content
            creators who need to publish on LinkedIn at scale. We simplify the
            complex process of managing multiple accounts and scheduling content.
          </motion.p>
        </motion.div>

        {/* Mission Section */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          variants={stagger}
          className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center mb-20"
        >
          <motion.div variants={fadeUp} custom={0}>
            <h2 className="text-3xl md:text-4xl font-bold">
              Our Mission
            </h2>
            <div className="mt-6 space-y-4 text-muted-foreground leading-relaxed">
              <p>
                Our mission is to provide a lightweight, powerful, and affordable
                tool that handles the logistics of LinkedIn publishing so you can
                focus on creating great content.
              </p>
              <p className="font-medium text-foreground">
                No content generation. No fluff. Just reliable publishing.
              </p>
            </div>
          </motion.div>

          {/* Dashboard Mock Visual */}
          <motion.div variants={fadeUp} custom={1}>
            <Card className="overflow-hidden shadow-lg">
              <div className="bg-muted/80 border-b px-4 py-3 flex items-center gap-2">
                <div className="size-3 rounded-full bg-destructive/60" />
                <div className="size-3 rounded-full bg-yellow-500/60" />
                <div className="size-3 rounded-full bg-primary/60" />
                <span className="ml-2 text-xs text-muted-foreground font-mono">
                  postgo.app/dashboard
                </span>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: '24', label: 'Accounts' },
                    { value: '156', label: 'Posts Today' },
                    { value: '89%', label: 'Success Rate' },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="bg-muted rounded-lg p-3 text-center"
                    >
                      <div className="text-xl font-bold text-primary">
                        {stat.value}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {stat.label}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="bg-muted rounded-lg p-3 flex items-center gap-3"
                    >
                      <div className="size-8 rounded-full bg-primary/10" />
                      <div className="flex-1 space-y-1.5">
                        <div
                          className="h-2.5 bg-muted-foreground/20 rounded"
                          style={{ width: `${20 + i * 10}%` }}
                        />
                        <div
                          className="h-2 bg-muted-foreground/10 rounded"
                          style={{ width: `${30 + i * 15}%` }}
                        />
                      </div>
                      <div className="h-6 w-16 rounded-full bg-primary/10" />
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </motion.div>
        </motion.div>

        {/* Values Section */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          variants={stagger}
          className="mb-12"
        >
          <motion.h2
            variants={fadeUp}
            custom={0}
            className="text-3xl md:text-4xl font-bold text-center mb-16"
          >
            What We Stand For
          </motion.h2>
          <motion.div
            variants={stagger}
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            {[
              {
                icon: Target,
                title: 'Simplicity',
                description:
                  'We believe publishing tools should be straightforward. No bloated features, no confusing interfaces. Just the tools you need.',
              },
              {
                icon: ShieldCheck,
                title: 'Security',
                description:
                  'Your LinkedIn credentials and data are encrypted at every step. We take security seriously so you can publish with confidence.',
              },
              {
                icon: Zap,
                title: 'Reliability',
                description:
                  'We build robust systems that deliver your content on time, every time. When you schedule a post, it goes out — period.',
              },
            ].map((value, i) => (
              <motion.div key={value.title} variants={fadeUp} custom={i}>
                <Card className="h-full hover:shadow-lg transition-shadow">
                  <CardContent className="p-6">
                    <div className="rounded-lg bg-primary/10 p-3 w-fit">
                      <value.icon className="size-6 text-primary" />
                    </div>
                    <h3 className="mt-4 text-lg font-semibold">{value.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                      {value.description}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-Page: Contact
// ═══════════════════════════════════════════════════════════════════════════════

function ContactPageContent() {
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactMessage, setContactMessage] = useState('');

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success('Message sent!', {
      description: "We'll get back to you within 24 hours.",
    });
    setContactName('');
    setContactEmail('');
    setContactMessage('');
  };

  return (
    <motion.div key="contact" {...pageTransition} className="py-16 md:py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Hero */}
        <motion.div
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="text-center max-w-3xl mx-auto mb-16"
        >
          <motion.h1
            variants={fadeUp}
            custom={0}
            className="text-4xl md:text-5xl font-bold tracking-tight"
          >
            Get in{' '}
            <span className="gradient-text">Touch</span>
          </motion.h1>
          <motion.p
            variants={fadeUp}
            custom={1}
            className="mt-6 text-lg text-muted-foreground"
          >
            Have questions? We&apos;d love to hear from you.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          variants={stagger}
          className="grid grid-cols-1 lg:grid-cols-5 gap-8 max-w-5xl mx-auto"
        >
          {/* Contact Form */}
          <motion.div variants={fadeUp} custom={0} className="lg:col-span-3">
            <Card>
              <CardContent className="p-6">
                <form onSubmit={handleContactSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="contact-name">Name</Label>
                    <Input
                      id="contact-name"
                      placeholder="Your name"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contact-email">Email</Label>
                    <Input
                      id="contact-email"
                      type="email"
                      placeholder="you@example.com"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contact-message">Message</Label>
                    <Textarea
                      id="contact-message"
                      placeholder="How can we help?"
                      rows={5}
                      value={contactMessage}
                      onChange={(e) => setContactMessage(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full">
                    Send Message
                    <ArrowRight className="size-4" />
                  </Button>
                </form>
              </CardContent>
            </Card>
          </motion.div>

          {/* Contact Info Cards */}
          <motion.div
            variants={fadeUp}
            custom={1}
            className="lg:col-span-2 flex flex-col gap-4"
          >
            {[
              {
                icon: Mail,
                label: 'Email',
                value: 'support@postgo.fun',
              },
              {
                icon: Clock,
                label: 'Response Time',
                value: 'Within 24 hours',
              },
              {
                icon: Globe,
                label: 'Location',
                value: 'Remote-first team',
              },
            ].map((item) => (
              <Card key={item.label} className="hover:shadow-lg transition-shadow">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="rounded-lg bg-primary/10 p-2.5">
                    <item.icon className="size-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.value}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-Page: Privacy Policy
// ═══════════════════════════════════════════════════════════════════════════════

function PrivacyPageContent() {
  return (
    <motion.div key="privacy" {...pageTransition} className="py-16 md:py-24">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="mb-12"
        >
          <motion.h1
            variants={fadeUp}
            custom={0}
            className="text-4xl md:text-5xl font-bold tracking-tight"
          >
            Privacy{' '}
            <span className="gradient-text">Policy</span>
          </motion.h1>
          <motion.p
            variants={fadeUp}
            custom={1}
            className="mt-4 text-sm text-muted-foreground"
          >
            Last Updated: January 2025
          </motion.p>
        </motion.div>

        {/* Content */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: 0.2, duration: 0.4 } }}
          className="space-y-8 text-sm text-muted-foreground leading-relaxed"
        >
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">1. Information We Collect</h2>
            <p className="mb-4">
              We collect the following types of information to provide and improve our service:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>
                <span className="font-medium text-foreground">Account Information:</span> Your name
                (optional) and email address when you create an account.
              </li>
              <li>
                <span className="font-medium text-foreground">LinkedIn Data:</span> Your LinkedIn member
                ID, account name, and access token to enable publishing on your behalf.
              </li>
              <li>
                <span className="font-medium text-foreground">Usage Data:</span> Post content, scheduling
                preferences, and interaction patterns within the application.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">2. How We Use Your Information</h2>
            <p className="mb-4">We use the information we collect to:</p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Provide, maintain, and improve the PostGo service</li>
              <li>Publish content to LinkedIn on your behalf as instructed</li>
              <li>Process and manage your scheduled posts</li>
              <li>Send you service-related notifications and updates</li>
              <li>Respond to your inquiries and provide customer support</li>
              <li>Detect and prevent fraud or abuse of the service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">3. Data Storage &amp; Security</h2>
            <p className="mb-4">
              Your data is stored in a secure, encrypted SQLite database hosted on our servers. We
              implement industry-standard security measures including:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>AES-256-CBC encryption for sensitive data at rest</li>
              <li>JWT httpOnly cookies for secure session management</li>
              <li>Rate limiting to protect against brute-force attacks</li>
              <li>Regular security reviews and updates</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">4. LinkedIn Access Tokens</h2>
            <p className="mb-4">
              Your LinkedIn access tokens are encrypted using AES-256-CBC encryption before being
              stored in our database. We:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Never store access tokens in plain text</li>
              <li>Never share your access tokens with third parties</li>
              <li>Only use tokens to publish content you have explicitly authorized</li>
              <li>Allow you to disconnect accounts and delete stored tokens at any time</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">5. Cookies</h2>
            <p className="mb-4">
              We use JWT (JSON Web Token) cookies for authentication. These cookies are:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>
                <span className="font-medium text-foreground">httpOnly:</span> Not accessible via
                JavaScript to prevent XSS attacks
              </li>
              <li>
                <span className="font-medium text-foreground">Secure:</span> Only transmitted over
                HTTPS
              </li>
              <li>
                <span className="font-medium text-foreground">SameSite:</span> Restricted to prevent
                cross-site request forgery
              </li>
              <li>Set to expire after 7 days of inactivity</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">6. Third-Party Services</h2>
            <p className="mb-4">
              Our service interacts with the LinkedIn API to publish your content. We do not sell,
              trade, or otherwise transfer your personal information to third parties except as
              required to:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Publish your authorized content to LinkedIn</li>
              <li>Comply with legal obligations</li>
              <li>Protect our rights, property, or safety</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">7. Data Retention</h2>
            <p>
              We retain your account data for as long as your account is active. If you delete your
              account, we will remove your personal information, LinkedIn access tokens, and
              associated posts within 30 days. LinkedIn posts that have already been published will
              not be affected, as they exist on LinkedIn&apos;s platform.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">8. Your Rights</h2>
            <p className="mb-4">You have the right to:</p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Access the personal data we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your account and associated data</li>
              <li>Disconnect your LinkedIn accounts at any time</li>
              <li>Export your post history and account data</li>
              <li>Object to certain types of data processing</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">9. Contact</h2>
            <p>
              If you have any questions about this Privacy Policy, please contact us at{' '}
              <a href="mailto:support@postgo.fun" className="text-primary hover:underline font-medium">
                support@postgo.fun
              </a>
              .
            </p>
          </section>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-Page: Terms of Service
// ═══════════════════════════════════════════════════════════════════════════════

function TermsPageContent() {
  return (
    <motion.div key="terms" {...pageTransition} className="py-16 md:py-24">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="mb-12"
        >
          <motion.h1
            variants={fadeUp}
            custom={0}
            className="text-4xl md:text-5xl font-bold tracking-tight"
          >
            Terms of{' '}
            <span className="gradient-text">Service</span>
          </motion.h1>
          <motion.p
            variants={fadeUp}
            custom={1}
            className="mt-4 text-sm text-muted-foreground"
          >
            Last Updated: January 2025
          </motion.p>
        </motion.div>

        {/* Content */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: 0.2, duration: 0.4 } }}
          className="space-y-8 text-sm text-muted-foreground leading-relaxed"
        >
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">1. Acceptance of Terms</h2>
            <p>
              By accessing or using PostGo (&quot;the Service&quot;), you agree to be bound by these
              Terms of Service (&quot;Terms&quot;). If you do not agree to these Terms, you may not
              access or use the Service. We reserve the right to modify these Terms at any time,
              and your continued use of the Service constitutes acceptance of any changes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">2. Description of Service</h2>
            <p>
              PostGo is a LinkedIn content publishing and scheduling tool. The Service allows you to
              connect your LinkedIn account(s), create and schedule posts, manage posting calendars,
              and publish content to LinkedIn in bulk via CSV upload. PostGo is not affiliated with,
              endorsed by, or connected to LinkedIn Corporation.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">3. User Accounts &amp; Responsibilities</h2>
            <p className="mb-4">To use the Service, you must:</p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Be at least 18 years of age</li>
              <li>Provide accurate and complete registration information</li>
              <li>Maintain the security of your account credentials</li>
              <li>Accept responsibility for all activities that occur under your account</li>
              <li>Promptly notify us of any unauthorized use of your account</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">4. Subscription &amp; Billing</h2>
            <p className="mb-4">
              PostGo offers subscription plans starting at <span className="font-semibold text-foreground">$49/month</span> (Pro) and <span className="font-semibold text-foreground">$149/month</span> (Enterprise).
              By subscribing, you agree to:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Pay the subscription fee for the duration of your subscription</li>
              <li>Provide valid payment information</li>
              <li>Auto-renewal of your subscription unless cancelled before the billing date</li>
              <li>Refunds are not provided for partial months of service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">5. Acceptable Use</h2>
            <p className="mb-4">
              You agree to use the Service in compliance with{' '}
              <span className="font-medium text-foreground">LinkedIn&apos;s Terms of Service</span> and all
              applicable laws. You must not:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Post spam, misleading, or deceptive content</li>
              <li>Impersonate other individuals or entities</li>
              <li>Violate any intellectual property rights</li>
              <li>Use the Service for any unlawful purpose</li>
              <li>Attempt to circumvent rate limits or security measures</li>
              <li>Share your account credentials with third parties</li>
              <li>Exceed the permitted number of connected accounts or daily posts</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">6. Content Responsibility</h2>
            <p>
              You retain full ownership of all content you create and publish through the Service.
              You are solely responsible for ensuring that your content complies with LinkedIn&apos;s
              policies and all applicable laws. PostGo does not review, edit, or endorse any user
              content. We reserve the right to remove content that violates these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">7. Intellectual Property</h2>
            <p className="mb-4">
              The PostGo service, including its software, design, logos, and documentation, is owned
              by PostGo and protected by intellectual property laws. You may not:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Copy, modify, or distribute any part of the Service</li>
              <li>Reverse engineer, decompile, or disassemble the Service</li>
              <li>Use our trademarks without prior written consent</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">8. Limitation of Liability</h2>
            <p>
              To the fullest extent permitted by law, PostGo shall not be liable for any indirect,
              incidental, special, consequential, or punitive damages, including but not limited to
              loss of profits, data, or business opportunities, arising out of or in connection with
              your use of the Service. Our total liability shall not exceed the amount you paid us
              in the 12 months preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">9. Termination</h2>
            <p className="mb-4">
              Either party may terminate this agreement at any time:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>
                <span className="font-medium text-foreground">You</span> may terminate your account
                at any time by deleting it through the Service or contacting support.
              </li>
              <li>
                <span className="font-medium text-foreground">PostGo</span> may suspend or terminate
                your account for violations of these Terms or for any other reason at our discretion.
              </li>
            </ul>
            <p className="mt-4">
              Upon termination, your right to use the Service will immediately cease. Provisions that
              by their nature should survive will remain in effect.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">10. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with applicable laws,
              without regard to conflict of law provisions. Any disputes arising from these Terms or
              your use of the Service shall be resolved through binding arbitration.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">11. Contact</h2>
            <p>
              If you have any questions about these Terms of Service, please contact us at{' '}
              <a href="mailto:support@postgo.fun" className="text-primary hover:underline font-medium">
                support@postgo.fun
              </a>
              .
            </p>
          </section>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main LandingPage Component
// ═══════════════════════════════════════════════════════════════════════════════

export default function LandingPage() {
  const {
    user,
    landingPage,
    scrollToSection,
    setLandingPage,
    setAuthModal,
    setView,
    logout,
  } = useAppStore();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [legalDropdownOpen, setLegalDropdownOpen] = useState(false);

  const closeMobileMenu = () => setMobileOpen(false);

  const handleNavPageClick = (page: LandingPageView) => {
    setLandingPage(page);
    closeMobileMenu();
  };

  const handleNavScrollClick = (section: LandingSection) => {
    scrollToSection(section);
    closeMobileMenu();
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* ─── 1. Header / Nav ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          {/* Logo */}
          <button
            onClick={() => scrollToSection('home')}
            className="flex items-center gap-2 group"
          >
            <div className="size-8 bg-primary rounded-lg flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">
                P
              </span>
            </div>
            <span className="text-xl font-bold tracking-tight">PostGo</span>
          </button>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            {scrollNavLinks.map((link) => (
              <button
                key={link.section}
                onClick={() => scrollToSection(link.section)}
                className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent"
              >
                {link.label}
              </button>
            ))}

            {pageNavLinks.map((link) => (
              <button
                key={link.page}
                onClick={() => setLandingPage(link.page)}
                className={`px-3 py-2 text-sm font-medium transition-colors rounded-md hover:bg-accent ${
                  landingPage === link.page
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {link.label}
              </button>
            ))}

            {/* Legal Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`px-3 py-2 text-sm font-medium transition-colors rounded-md hover:bg-accent flex items-center gap-1 ${
                    landingPage === 'privacy' || landingPage === 'terms'
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Legal
                  <ChevronDown className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setLandingPage('privacy')}>
                  Privacy Policy
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setLandingPage('terms')}>
                  Terms of Service
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>

          {/* Right Side */}
          <div className="hidden md:flex items-center gap-3">
            {user ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setView('dashboard')}
                >
                  <LayoutDashboard className="size-4" />
                  Dashboard
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-2">
                      <div className="size-6 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-xs font-medium text-primary">
                          {user.email.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <span className="max-w-[140px] truncate text-sm">
                        {user.email}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem variant="destructive" onClick={logout}>
                      <LogOut className="size-4" />
                      Log out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAuthModal('login')}
                >
                  Login
                </Button>
                <Button
                  size="sm"
                  onClick={() => setAuthModal('signup')}
                >
                  Get Started
                  <ArrowRight className="size-4" />
                </Button>
              </>
            )}
          </div>

          {/* Mobile Menu Trigger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild className="md:hidden">
              <Button variant="ghost" size="icon">
                <Menu className="size-5" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <div className="size-7 bg-primary rounded-lg flex items-center justify-center">
                    <span className="text-primary-foreground font-bold text-xs">
                      P
                    </span>
                  </div>
                  PostGo
                </SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col gap-1 px-4">
                {/* Scroll links */}
                {scrollNavLinks.map((link) => (
                  <button
                    key={link.section}
                    onClick={() => handleNavScrollClick(link.section)}
                    className="flex items-center gap-3 px-3 py-3 text-sm font-medium rounded-md hover:bg-accent transition-colors"
                  >
                    {link.label}
                    <ChevronRight className="size-4 ml-auto text-muted-foreground" />
                  </button>
                ))}

                {/* Page links */}
                {pageNavLinks.map((link) => (
                  <button
                    key={link.page}
                    onClick={() => handleNavPageClick(link.page)}
                    className={`flex items-center gap-3 px-3 py-3 text-sm font-medium rounded-md transition-colors ${
                      landingPage === link.page
                        ? 'bg-accent text-foreground'
                        : 'hover:bg-accent'
                    }`}
                  >
                    {link.label}
                    <ChevronRight className="size-4 ml-auto text-muted-foreground" />
                  </button>
                ))}

                {/* Legal expandable section */}
                <div>
                  <button
                    onClick={() => setLegalDropdownOpen(!legalDropdownOpen)}
                    className={`flex items-center gap-3 px-3 py-3 text-sm font-medium rounded-md transition-colors w-full ${
                      landingPage === 'privacy' || landingPage === 'terms'
                        ? 'bg-accent text-foreground'
                        : 'hover:bg-accent'
                    }`}
                  >
                    Legal
                    <ChevronDown
                      className={`size-4 ml-auto text-muted-foreground transition-transform ${
                        legalDropdownOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {legalDropdownOpen && (
                    <div className="ml-4 flex flex-col gap-1">
                      <button
                        onClick={() => handleNavPageClick('privacy')}
                        className={`flex items-center gap-3 px-3 py-2.5 text-sm rounded-md transition-colors ${
                          landingPage === 'privacy'
                            ? 'text-primary font-medium'
                            : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                        }`}
                      >
                        Privacy Policy
                      </button>
                      <button
                        onClick={() => handleNavPageClick('terms')}
                        className={`flex items-center gap-3 px-3 py-2.5 text-sm rounded-md transition-colors ${
                          landingPage === 'terms'
                            ? 'text-primary font-medium'
                            : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                        }`}
                      >
                        Terms of Service
                      </button>
                    </div>
                  )}
                </div>
              </nav>
              <div className="px-4 mt-4 flex flex-col gap-2">
                {user ? (
                  <>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        setView('dashboard');
                        closeMobileMenu();
                      }}
                    >
                      <LayoutDashboard className="size-4" />
                      Dashboard
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full text-destructive hover:text-destructive"
                      onClick={() => {
                        logout();
                        closeMobileMenu();
                      }}
                    >
                      <LogOut className="size-4" />
                      Log out
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        setAuthModal('login');
                        closeMobileMenu();
                      }}
                    >
                      Login
                    </Button>
                    <Button
                      className="w-full"
                      onClick={() => {
                        setAuthModal('signup');
                        closeMobileMenu();
                      }}
                    >
                      Get Started
                      <ArrowRight className="size-4" />
                    </Button>
                  </>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {/* ─── Main Content ─────────────────────────────────────────────── */}
      <main className="flex-1">
        <AnimatePresence mode="wait">
          {landingPage === 'home' ? (
            <>
              {/* ─── Hero Section ─────────────────────────────────────── */}
              <section
                id="section-home"
                className="relative py-24 md:py-32 overflow-hidden"
              >
                {/* Decorative blobs */}
                <div className="absolute top-10 -left-32 w-72 h-72 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute bottom-10 -right-32 w-96 h-96 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-3xl pointer-events-none" />

                <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                  <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={stagger}
                    className="max-w-4xl mx-auto"
                  >
                    <motion.h1
                      variants={fadeUp}
                      custom={0}
                      className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-tight"
                    >
                      Schedule LinkedIn Posts{' '}
                      <span className="gradient-text">at Scale</span>
                    </motion.h1>

                    <motion.p
                      variants={fadeUp}
                      custom={1}
                      className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto"
                    >
                      Connect up to 75 LinkedIn accounts. Publish single or bulk posts
                      from one powerful dashboard.
                    </motion.p>

                    <motion.div
                      variants={fadeUp}
                      custom={2}
                      className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
                    >
                      <Button
                        size="lg"
                        className="h-12 px-8 text-base"
                        onClick={() => setAuthModal('signup')}
                      >
                        Start Free Trial
                        <ArrowRight className="size-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="lg"
                        className="h-12 px-8 text-base"
                        onClick={() => scrollToSection('features')}
                      >
                        See Features
                      </Button>
                    </motion.div>

                    <motion.div
                      variants={fadeUp}
                      custom={3}
                      className="mt-14 flex flex-wrap items-center justify-center gap-4"
                    >
                      {[
                        { label: 'Up to 75 Accounts', icon: Users },
                        { label: 'Up to 250 Posts/Day/Account', icon: Send },
                        { label: 'From $49/month', icon: CalendarClock },
                      ].map((stat) => (
                        <div
                          key={stat.label}
                          className="flex items-center gap-2 rounded-full border bg-background px-4 py-2 text-sm font-medium shadow-sm"
                        >
                          <stat.icon className="size-4 text-primary" />
                          {stat.label}
                        </div>
                      ))}
                    </motion.div>
                  </motion.div>
                </div>
              </section>

              {/* ─── Features Section ─────────────────────────────────── */}
              <section id="section-features" className="py-20 md:py-24">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                  <motion.div
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: '-80px' }}
                    variants={stagger}
                    className="text-center max-w-3xl mx-auto mb-16"
                  >
                    <motion.h2
                      variants={fadeUp}
                      custom={0}
                      className="text-3xl md:text-4xl font-bold"
                    >
                      Everything You Need to Publish
                    </motion.h2>
                    <motion.p
                      variants={fadeUp}
                      custom={1}
                      className="text-muted-foreground text-lg mt-4"
                    >
                      A complete LinkedIn publishing toolkit designed for teams and
                      agencies.
                    </motion.p>
                  </motion.div>

                  <motion.div
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: '-80px' }}
                    variants={stagger}
                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
                  >
                    {features.map((feature, i) => (
                      <motion.div key={feature.title} variants={fadeUp} custom={i}>
                        <Card className="h-full hover:shadow-lg transition-shadow cursor-default">
                          <CardContent className="p-6">
                            <div className="rounded-lg bg-primary/10 p-3 w-fit">
                              <feature.icon className="size-6 text-primary" />
                            </div>
                            <h3 className="mt-4 text-lg font-semibold">
                              {feature.title}
                            </h3>
                            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                              {feature.description}
                            </p>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </motion.div>
                </div>
              </section>

              {/* ─── Pricing Section ──────────────────────────────────── */}
              <section
                id="section-pricing"
                className="py-20 md:py-24 bg-muted/50"
              >
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                  <motion.div
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: '-80px' }}
                    variants={stagger}
                    className="text-center max-w-3xl mx-auto mb-16"
                  >
                    <motion.h2
                      variants={fadeUp}
                      custom={0}
                      className="text-3xl md:text-4xl font-bold"
                    >
                      Simple, Transparent Pricing
                    </motion.h2>
                    <motion.p
                      variants={fadeUp}
                      custom={1}
                      className="text-muted-foreground text-lg mt-4"
                    >
                      Pick the plan that matches your scale. No hidden fees,
                      cancel anytime.
                    </motion.p>
                  </motion.div>

                  {/* ─── 3-Tier Pricing Grid ─────────────────────────── */}
                  <motion.div
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: '-80px' }}
                    variants={stagger}
                    className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto"
                  >
                    {pricingPlans.map((plan, i) => (
                      <motion.div
                        key={plan.id}
                        variants={fadeUp}
                        custom={i}
                        className={plan.highlight ? 'lg:-mt-4 lg:mb-4' : ''}
                      >
                        <Card
                          className={
                            'h-full relative ' +
                            (plan.highlight
                              ? 'ring-2 ring-primary shadow-xl scale-100 lg:scale-105'
                              : 'shadow-sm')
                          }
                        >
                          <CardHeader className="text-center pb-2">
                            {plan.badge && (
                              <div className="flex justify-center mb-2">
                                <Badge
                                  className={
                                    plan.highlight
                                      ? 'bg-primary text-primary-foreground'
                                      : 'bg-muted text-foreground border border-border'
                                  }
                                >
                                  {plan.badge}
                                </Badge>
                              </div>
                            )}
                            <CardTitle className="text-2xl font-bold">
                              {plan.name}
                            </CardTitle>
                            <div className="mt-4">
                              <span className="text-5xl font-bold">
                                {plan.priceLabel}
                              </span>
                              <span className="text-muted-foreground text-lg">
                                /month
                              </span>
                            </div>

                            {/* ─── Monthly capacity math (value proposition) ─── */}
                            <div className="mt-4 rounded-lg border bg-muted/40 px-3 py-3 text-left">
                              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                                Your monthly reach
                              </div>
                              <div className="text-sm font-semibold text-foreground">
                                {plan.accounts} accounts
                                <span className="text-muted-foreground"> × </span>
                                {plan.postsPerDay} posts/day
                                <span className="text-muted-foreground"> × 30 days</span>
                              </div>
                              <div className="mt-1 text-2xl font-bold text-primary">
                                {formatMonthlyPosts(plan.monthlyPosts)}
                                <span className="text-sm font-medium text-muted-foreground ml-1">
                                  posts/month
                                </span>
                              </div>
                            </div>
                          </CardHeader>

                          <CardContent className="pt-4 flex flex-col h-full">
                            <ul className="space-y-3 mb-8 flex-1">
                              {plan.features.map((feat) => (
                                <li
                                  key={feat}
                                  className="flex items-start gap-3 text-sm"
                                >
                                  <CheckCircle className="size-5 text-primary shrink-0 mt-0.5" />
                                  <span>{feat}</span>
                                </li>
                              ))}
                            </ul>
                            <Button
                              className="w-full h-11"
                              size="lg"
                              variant={plan.highlight ? 'default' : 'outline'}
                              onClick={() => setAuthModal('signup')}
                            >
                              {plan.cta}
                              <ArrowRight className="size-4" />
                            </Button>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </motion.div>

                  {/* ─── Value explanation banner ─── */}
                  <motion.div
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: '-80px' }}
                    variants={fadeUp}
                    custom={0}
                    className="mt-12 max-w-4xl mx-auto"
                  >
                    <div className="rounded-xl border bg-background p-6 md:p-8 text-center">
                      <h3 className="text-lg font-semibold mb-2">
                        Why PostGo pays for itself
                      </h3>
                      <p className="text-muted-foreground text-sm md:text-base leading-relaxed">
                        On the <span className="font-semibold text-foreground">Pro plan ($49/month)</span>,
                        you can publish up to{' '}
                        <span className="font-semibold text-primary">37,500 posts per month</span>{' '}
                        across 25 accounts — that&apos;s{' '}
                        <span className="font-semibold text-foreground">~$0.0013 per post</span>.
                        On the{' '}
                        <span className="font-semibold text-foreground">Enterprise plan ($149/month)</span>,
                        you can publish up to{' '}
                        <span className="font-semibold text-primary">562,500 posts per month</span>{' '}
                        across 75 accounts — that&apos;s{' '}
                        <span className="font-semibold text-foreground">under $0.0003 per post</span>.
                      </p>
                    </div>
                  </motion.div>
                </div>
              </section>

              {/* ─── FAQ Section ──────────────────────────────────────── */}
              <section
                id="section-faq"
                className="py-20 md:py-24 bg-muted/50"
              >
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                  <motion.div
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: '-80px' }}
                    variants={stagger}
                    className="text-center max-w-3xl mx-auto mb-16"
                  >
                    <motion.h2
                      variants={fadeUp}
                      custom={0}
                      className="text-3xl md:text-4xl font-bold"
                    >
                      Frequently Asked Questions
                    </motion.h2>
                  </motion.div>

                  <motion.div
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: '-80px' }}
                    variants={fadeUp}
                    custom={0}
                    className="max-w-3xl mx-auto"
                  >
                    <Accordion type="single" collapsible className="w-full">
                      {faqItems.map((item, i) => (
                        <AccordionItem key={i} value={`faq-${i}`}>
                          <AccordionTrigger className="text-left text-base">
                            {item.question}
                          </AccordionTrigger>
                          <AccordionContent className="text-muted-foreground leading-relaxed">
                            {item.answer}
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </motion.div>
                </div>
              </section>
            </>
          ) : landingPage === 'about' ? (
            <AboutPageContent />
          ) : landingPage === 'contact' ? (
            <ContactPageContent />
          ) : landingPage === 'privacy' ? (
            <PrivacyPageContent />
          ) : landingPage === 'terms' ? (
            <TermsPageContent />
          ) : null}
        </AnimatePresence>
      </main>

      {/* ─── Footer ────────────────────────────────────────────────────── */}
      <footer className="bg-foreground text-background mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {/* Column 1: Brand */}
            <div className="col-span-2 md:col-span-1">
              <button
                onClick={() => scrollToSection('home')}
                className="flex items-center gap-2 mb-4 hover:opacity-80 transition-opacity"
              >
                <div className="size-8 bg-primary rounded-lg flex items-center justify-center">
                  <span className="text-primary-foreground font-bold text-sm">
                    P
                  </span>
                </div>
                <span className="text-xl font-bold">PostGo</span>
              </button>
              <p className="text-sm text-background/60 leading-relaxed">
                LinkedIn publishing made simple.
              </p>
            </div>

            {/* Column 2: Product */}
            <div>
              <h4 className="font-semibold text-sm mb-4">Product</h4>
              <nav className="flex flex-col gap-2.5">
                <button
                  onClick={() => scrollToSection('features')}
                  className="text-sm text-background/60 hover:text-background transition-colors text-left"
                >
                  Features
                </button>
                <button
                  onClick={() => scrollToSection('pricing')}
                  className="text-sm text-background/60 hover:text-background transition-colors text-left"
                >
                  Pricing
                </button>
              </nav>
            </div>

            {/* Column 3: Company */}
            <div>
              <h4 className="font-semibold text-sm mb-4">Company</h4>
              <nav className="flex flex-col gap-2.5">
                <button
                  onClick={() => setLandingPage('about')}
                  className="text-sm text-background/60 hover:text-background transition-colors text-left"
                >
                  About
                </button>
                <button
                  onClick={() => setLandingPage('contact')}
                  className="text-sm text-background/60 hover:text-background transition-colors text-left"
                >
                  Contact
                </button>
              </nav>
            </div>

            {/* Column 4: Legal */}
            <div>
              <h4 className="font-semibold text-sm mb-4">Legal</h4>
              <nav className="flex flex-col gap-2.5">
                <button
                  onClick={() => setLandingPage('privacy')}
                  className="text-sm text-background/60 hover:text-background transition-colors text-left"
                >
                  Privacy Policy
                </button>
                <button
                  onClick={() => setLandingPage('terms')}
                  className="text-sm text-background/60 hover:text-background transition-colors text-left"
                >
                  Terms of Service
                </button>
              </nav>
            </div>
          </div>

          {/* Bottom Bar */}
          <div className="mt-12 pt-8 border-t border-background/10 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-background/60">
              &copy; 2025 PostGo. All rights reserved.
            </p>
            <p className="text-sm text-background/60">
              Made for LinkedIn power users.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
