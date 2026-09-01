import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://postgo.fun'),
  title: {
    default: "PostGo - Schedule LinkedIn Posts at Scale",
    template: "%s | PostGo",
  },
  description:
    "Connect up to 75 LinkedIn accounts and publish single or bulk posts from one dashboard. Plans from $49/month. LinkedIn post scheduler with bulk CSV upload, smart scheduling, and encrypted token storage.",
  keywords: [
    "LinkedIn scheduler",
    "LinkedIn post scheduler",
    "LinkedIn bulk posting tool",
    "LinkedIn automation tool",
    "LinkedIn content scheduler",
    "schedule LinkedIn posts",
    "LinkedIn publishing tool",
    "multiple LinkedIn accounts",
    "LinkedIn bulk upload",
    "LinkedIn CSV posting",
    "LinkedIn post management",
    "social media scheduling",
    "LinkedIn marketing tool",
    "LinkedIn agency tool",
  ],
  authors: [{ name: "PostGo Team", url: "https://postgo.fun" }],
  creator: "PostGo",
  publisher: "PostGo",
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "PostGo - Schedule LinkedIn Posts at Scale",
    description:
      "Connect up to 75 LinkedIn accounts and publish single or bulk posts from one powerful dashboard. Plans from $49/month. LinkedIn scheduler with bulk CSV upload and smart scheduling.",
    url: "https://postgo.fun",
    siteName: "PostGo",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/og-image.png",
        width: 1344,
        height: 768,
        alt: "PostGo - Schedule LinkedIn Posts at Scale",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PostGo - Schedule LinkedIn Posts at Scale",
    description:
      "Connect up to 75 LinkedIn accounts and publish single or bulk posts from one powerful dashboard. Plans from $49/month.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: "https://postgo.fun",
  },
  category: "technology",
};

// ─── Comprehensive Schema Markup (JSON-LD) ─────────────────────────────────

const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "PostGo",
  url: "https://postgo.fun",
  description: "Schedule and publish LinkedIn posts at scale. Connect up to 75 accounts with bulk CSV upload and smart scheduling. Plans from $49/month (Pro) to $149/month (Enterprise).",
  potentialAction: {
    "@type": "SearchAction",
    target: "https://postgo.fun/?q={search_term_string}",
    "query-input": "required name=search_term_string",
  },
};

const softwareSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "PostGo",
  url: "https://postgo.fun",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description: "LinkedIn post scheduler with multi-account management, bulk CSV upload, smart scheduling, and encrypted token storage.",
  offers: {
    "@type": "AggregateOffer",
    lowPrice: "49",
    highPrice: "149",
    priceCurrency: "USD",
    offerCount: 2,
    offers: [
      {
        "@type": "Offer",
        name: "Pro Plan",
        description: "25 LinkedIn accounts, 50 posts per account per day, up to 37,500 posts per month.",
        price: "49",
        priceCurrency: "USD",
        billingIncrement: "P1M",
        availability: "https://schema.org/InStock",
      },
      {
        "@type": "Offer",
        name: "Enterprise Plan",
        description: "75 LinkedIn accounts, 250 posts per account per day, up to 562,500 posts per month.",
        price: "149",
        priceCurrency: "USD",
        billingIncrement: "P1M",
        availability: "https://schema.org/InStock",
      },
    ],
  },
  aggregateRating: {
    "@type": "AggregateRating",
    ratingValue: "4.8",
    bestRating: "5",
    worstRating: "1",
    ratingCount: "124",
  },
  featureList: [
    "Multi-account management (up to 75 LinkedIn accounts)",
    "Single post publishing with image & video support",
    "Bulk CSV upload for mass posting",
    "Smart scheduling with interval control",
    "Up to 250 posts per account per day (Enterprise plan)",
    "Post history and analytics",
    "AES-256 encrypted token storage",
    "USDT TRC20 and Binance Pay payment options",
  ],
};

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "PostGo",
  url: "https://postgo.fun",
  logo: "https://postgo.fun/favicon.svg",
  description: "LinkedIn publishing and scheduling platform for agencies and content creators.",
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "customer support",
    email: "support@postgo.fun",
    availableLanguage: ["English"],
  },
  sameAs: ["https://t.me/AaruViestaa"],
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "How many LinkedIn accounts can I connect?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Free plan: up to 2 accounts. Pro plan ($49/month): up to 25 accounts. Enterprise plan ($149/month): up to 75 accounts. Each account is fully isolated with its own queue and history.",
      },
    },
    {
      "@type": "Question",
      name: "Is there a limit on daily posts?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Per-account daily limits: Free = 10 posts, Pro = 50 posts, Enterprise = 250 posts. Across all your accounts, that's up to 1,250 posts/day on Pro (25 × 50) or up to 18,750 posts/day on Enterprise (75 × 250) — roughly 37,500 posts/month on Pro and 562,500 posts/month on Enterprise.",
      },
    },
    {
      "@type": "Question",
      name: "How does bulk posting work?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Upload a CSV file with your posts (caption, image_url / media_url / video_url, optional comment). Set a publish interval (minutes, hours, or days). We'll parse it and schedule all posts automatically, respecting the per-account daily limit. CSVs larger than the daily limit auto-spread across multiple days.",
      },
    },
    {
      "@type": "Question",
      name: "Is my LinkedIn data secure?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Absolutely. Your LinkedIn access tokens are encrypted at rest using AES-256-CBC encryption. We never expose tokens to the browser, and all API calls are authenticated.",
      },
    },
    {
      "@type": "Question",
      name: "Can I cancel anytime?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes, you can cancel your subscription at any time. There are no long-term contracts or hidden fees.",
      },
    },
    {
      "@type": "Question",
      name: "Do you generate content for me?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "No. PostGo is a publishing platform only. You provide the content, and we handle the scheduling and publishing logistics.",
      },
    },
  ],
};

const breadcrumbSchema = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: "https://postgo.fun",
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="canonical" href="https://postgo.fun" />
        <link rel="sitemap" type="application/xml" href="/sitemap.xml" />
        {/* JSON-LD Structured Data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {/* Google Analytics */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-Y4EEFHKVSB"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', 'G-Y4EEFHKVSB');
            `,
          }}
        />

        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
