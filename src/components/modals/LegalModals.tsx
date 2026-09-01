'use client';

import { useAppStore } from '@/lib/store';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

// ── Privacy Policy Content ──────────────────────────────────────────

function PrivacyPolicyContent() {
  return (
    <div className="space-y-6 text-sm text-muted-foreground">
      <p className="text-xs text-muted-foreground/60">Last Updated: January 2025</p>

      <section>
        <h3 className="text-base font-semibold text-foreground mb-2">1. Information We Collect</h3>
        <p className="mb-3">
          We collect the following types of information to provide and improve our service:
        </p>
        <ul className="list-disc list-inside space-y-1.5 ml-2">
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
        <h3 className="text-base font-semibold text-foreground mb-2">2. How We Use Your Information</h3>
        <p className="mb-3">We use the information we collect to:</p>
        <ul className="list-disc list-inside space-y-1.5 ml-2">
          <li>Provide, maintain, and improve the PostGo service</li>
          <li>Publish content to LinkedIn on your behalf as instructed</li>
          <li>Process and manage your scheduled posts</li>
          <li>Send you service-related notifications and updates</li>
          <li>Respond to your inquiries and provide customer support</li>
          <li>Detect and prevent fraud or abuse of the service</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground mb-2">3. Data Storage & Security</h3>
        <p className="mb-3">
          Your data is stored in a secure, encrypted SQLite database hosted on our servers. We
          implement industry-standard security measures including:
        </p>
        <ul className="list-disc list-inside space-y-1.5 ml-2">
          <li>AES-256-CBC encryption for sensitive data at rest</li>
          <li>JWT httpOnly cookies for secure session management</li>
          <li>Rate limiting to protect against brute-force attacks</li>
          <li>Regular security reviews and updates</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground mb-2">4. LinkedIn Access Tokens</h3>
        <p className="mb-3">
          Your LinkedIn access tokens are encrypted using AES-256-CBC encryption before being
          stored in our database. We:
        </p>
        <ul className="list-disc list-inside space-y-1.5 ml-2">
          <li>Never store access tokens in plain text</li>
          <li>Never share your access tokens with third parties</li>
          <li>Only use tokens to publish content you have explicitly authorized</li>
          <li>Allow you to disconnect accounts and delete stored tokens at any time</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground mb-2">5. Cookies</h3>
        <p className="mb-3">
          We use JWT (JSON Web Token) cookies for authentication. These cookies are:
        </p>
        <ul className="list-disc list-inside space-y-1.5 ml-2">
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
        <h3 className="text-base font-semibold text-foreground mb-2">6. Third-Party Services</h3>
        <p className="mb-3">
          Our service interacts with the LinkedIn API to publish your content. We do not sell,
          trade, or otherwise transfer your personal information to third parties except as
          required to:
        </p>
        <ul className="list-disc list-inside space-y-1.5 ml-2">
          <li>Publish your authorized content to LinkedIn</li>
          <li>Comply with legal obligations</li>
          <li>Protect our rights, property, or safety</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground mb-2">7. Data Retention</h3>
        <p>
          We retain your account data for as long as your account is active. If you delete your
          account, we will remove your personal information, LinkedIn access tokens, and
          associated posts within 30 days. LinkedIn posts that have already been published will
          not be affected, as they exist on LinkedIn&apos;s platform.
        </p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground mb-2">8. Your Rights</h3>
        <p className="mb-3">You have the right to:</p>
        <ul className="list-disc list-inside space-y-1.5 ml-2">
          <li>Access the personal data we hold about you</li>
          <li>Request correction of inaccurate data</li>
          <li>Request deletion of your account and associated data</li>
          <li>Disconnect your LinkedIn accounts at any time</li>
          <li>Export your post history and account data</li>
          <li>Object to certain types of data processing</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground mb-2">9. Contact</h3>
        <p>
          If you have any questions about this Privacy Policy, please contact us at{' '}
          <a href="mailto:support@postgo.fun" className="text-primary hover:underline font-medium">
            support@postgo.fun
          </a>
          .
        </p>
      </section>
    </div>
  );
}

// ── Terms of Service Content ────────────────────────────────────────

function TermsOfServiceContent() {
  return (
    <div className="space-y-6 text-sm text-muted-foreground">
      <p className="text-xs text-muted-foreground/60">Last Updated: January 2025</p>

      <section>
        <h3 className="text-base font-semibold text-foreground mb-2">1. Acceptance of Terms</h3>
        <p>
          By accessing or using PostGo (&quot;the Service&quot;), you agree to be bound by these
          Terms of Service (&quot;Terms&quot;). If you do not agree to these Terms, you may not
          access or use the Service. We reserve the right to modify these Terms at any time,
          and your continued use of the Service constitutes acceptance of any changes.
        </p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground mb-2">2. Description of Service</h3>
        <p>
          PostGo is a LinkedIn content publishing and scheduling tool. The Service allows you to
          connect your LinkedIn account(s), create and schedule posts, manage posting calendars,
          and publish content to LinkedIn in bulk via CSV upload. PostGo is not affiliated with,
          endorsed by, or connected to LinkedIn Corporation.
        </p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground mb-2">3. User Accounts & Responsibilities</h3>
        <p className="mb-3">To use the Service, you must:</p>
        <ul className="list-disc list-inside space-y-1.5 ml-2">
          <li>Be at least 18 years of age</li>
          <li>Provide accurate and complete registration information</li>
          <li>Maintain the security of your account credentials</li>
          <li>Accept responsibility for all activities that occur under your account</li>
          <li>Promptly notify us of any unauthorized use of your account</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground mb-2">4. Subscription &amp; Billing</h3>
        <p className="mb-3">
          PostGo offers subscription plans starting at <span className="font-semibold text-foreground">$49/month</span> (Pro) and <span className="font-semibold text-foreground">$149/month</span> (Enterprise).
          By subscribing, you agree to:
        </p>
        <ul className="list-disc list-inside space-y-1.5 ml-2">
          <li>Pay the subscription fee for the duration of your subscription</li>
          <li>Provide valid payment information</li>
          <li>Auto-renewal of your subscription unless cancelled before the billing date</li>
          <li>Refunds are not provided for partial months of service</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground mb-2">5. Acceptable Use</h3>
        <p className="mb-3">
          You agree to use the Service in compliance with{' '}
          <span className="font-medium text-foreground">LinkedIn&apos;s Terms of Service</span> and all
          applicable laws. You must not:
        </p>
        <ul className="list-disc list-inside space-y-1.5 ml-2">
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
        <h3 className="text-base font-semibold text-foreground mb-2">6. Content Responsibility</h3>
        <p>
          You retain full ownership of all content you create and publish through the Service.
          You are solely responsible for ensuring that your content complies with LinkedIn&apos;s
          policies and all applicable laws. PostGo does not review, edit, or endorse any user
          content. We reserve the right to remove content that violates these Terms.
        </p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground mb-2">7. Intellectual Property</h3>
        <p className="mb-3">
          The PostGo service, including its software, design, logos, and documentation, is owned
          by PostGo and protected by intellectual property laws. You may not:
        </p>
        <ul className="list-disc list-inside space-y-1.5 ml-2">
          <li>Copy, modify, or distribute any part of the Service</li>
          <li>Reverse engineer, decompile, or disassemble the Service</li>
          <li>Use our trademarks without prior written consent</li>
        </ul>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground mb-2">8. Limitation of Liability</h3>
        <p>
          To the fullest extent permitted by law, PostGo shall not be liable for any indirect,
          incidental, special, consequential, or punitive damages, including but not limited to
          loss of profits, data, or business opportunities, arising out of or in connection with
          your use of the Service. Our total liability shall not exceed the amount you paid us
          in the 12 months preceding the claim.
        </p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground mb-2">9. Termination</h3>
        <p className="mb-3">
          Either party may terminate this agreement at any time:
        </p>
        <ul className="list-disc list-inside space-y-1.5 ml-2">
          <li>
            <span className="font-medium text-foreground">You</span> may terminate your account
            at any time by deleting it through the Service or contacting support.
          </li>
          <li>
            <span className="font-medium text-foreground">PostGo</span> may suspend or terminate
            your account for violations of these Terms or for any other reason at our discretion.
          </li>
        </ul>
        <p className="mt-3">
          Upon termination, your right to use the Service will immediately cease. Provisions that
          by their nature should survive will remain in effect.
        </p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground mb-2">10. Governing Law</h3>
        <p>
          These Terms shall be governed by and construed in accordance with applicable laws,
          without regard to conflict of law provisions. Any disputes arising from these Terms or
          your use of the Service shall be resolved through binding arbitration.
        </p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground mb-2">11. Contact</h3>
        <p>
          If you have any questions about these Terms of Service, please contact us at{' '}
          <a href="mailto:support@postgo.fun" className="text-primary hover:underline font-medium">
            support@postgo.fun
          </a>
          .
        </p>
      </section>
    </div>
  );
}

// ── Main LegalModals ────────────────────────────────────────────────

export function LegalModals() {
  const legalModal = useAppStore((s) => s.legalModal);
  const setLegalModal = useAppStore((s) => s.setLegalModal);

  return (
    <>
      <Dialog
        open={legalModal === 'privacy'}
        onOpenChange={(open) => { if (!open) setLegalModal('none'); }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-2xl">Privacy Policy</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-4">
            <PrivacyPolicyContent />
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog
        open={legalModal === 'terms'}
        onOpenChange={(open) => { if (!open) setLegalModal('none'); }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-2xl">Terms of Service</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-4">
            <TermsOfServiceContent />
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
