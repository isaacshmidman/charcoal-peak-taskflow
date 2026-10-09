/**
 * @file Terms of Service (/terms) and Privacy Policy (/privacy). Public:
 * readable signed out, because they're linked from outside the app (the
 * sign-in screen, and Stripe's public business details). The contact address
 * comes from the server (TASKFLOW_SUPPORT_EMAIL, else support@ the app's
 * domain).
 *
 * Every statement here describes what the code does today. Change the
 * code's behaviour (what's stored, who it's shared with, how long it's
 * kept) and this page has to change with it.
 */
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";

const UPDATED = "8 October 2026";

function Contact() {
  const { appPublicSettings } = useAuth();
  const email = /** @type {any} */ (appPublicSettings)?.support_email;
  // Public settings didn't load (offline, or the server is down).
  if (!email) return <>the support address, shown here once this page can reach Zephyrly</>;
  return (
    <a href={`mailto:${email}`} data-testid="legal-contact" className="underline underline-offset-2">
      {email}
    </a>
  );
}

/**
 * @param {{ title: string, children: import("react").ReactNode, other: { to: string, label: string } }} props
 */
function LegalPage({ title, children, other }) {
  return (
    <div className="min-h-screen px-4 py-10">
      <article className="mx-auto max-w-2xl text-slate-700 dark:text-slate-300">
        <Link to="/" className="mb-8 inline-flex items-center gap-2.5">
          <img src="/zephyrly-logo.png" alt="" className="h-8 w-8 rounded-lg object-cover" />
          <span className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">Zephyrly</span>
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{title}</h1>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Last updated {UPDATED}</p>
        <div className="mt-6 space-y-6 text-sm leading-6 [&_h2]:mb-1.5 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-900 dark:[&_h2]:text-slate-100 [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">
          {children}
        </div>
        <p className="mt-10 border-t border-border-hairline pt-4 text-xs text-slate-500 dark:text-slate-400">
          <Link to={other.to} className="underline underline-offset-2">
            {other.label}
          </Link>
          {" · "}
          <Link to="/" className="underline underline-offset-2">
            Back to Zephyrly
          </Link>
        </p>
      </article>
    </div>
  );
}

export function TermsPage() {
  return (
    <LegalPage title="Terms of Service" other={{ to: "/privacy", label: "Privacy Policy" }}>
      <p>
        These terms are the agreement between you and Zephyrly, the task, notes and schedule app at zephyrly.app. By making an
        account or using Zephyrly, you agree to them. If you don&apos;t, please don&apos;t use Zephyrly.
      </p>

      <section>
        <h2>Your account</h2>
        <p>
          You sign in with a Google account, so keep that account secure: whoever can sign in to it can open your Zephyrly. You
          need to be old enough to have your own Google account (13 or older in most countries). An account is for one person.
        </p>
      </section>

      <section>
        <h2>What you put in stays yours</h2>
        <p>
          Your tasks, notes, schedules and files belong to you. You let Zephyrly store them, show them to you, and send them where
          you ask, such as a calendar or an AI app you connect, only so the app can work. Zephyrly doesn&apos;t sell your content
          or use it for advertising. You can download a copy of everything at any time in Settings → Export &amp; restore.
        </p>
      </section>

      <section>
        <h2>Using Zephyrly fairly</h2>
        <p>
          Don&apos;t use Zephyrly to break the law, to store or share things you don&apos;t have the right to, or to harm
          anyone. Don&apos;t try to get into other people&apos;s accounts, get around the app&apos;s limits, overload it, or probe
          it for weaknesses. If you find a security problem, please tell us. Accounts that do these things may be suspended.
        </p>
      </section>

      <section>
        <h2>Paying for Zephyrly</h2>
        <p>
          Zephyrly is free to use today. If a paid upgrade is offered, its price is shown before you pay, and payment is handled
          by Stripe; Zephyrly never sees or stores your card details. A purchase isn&apos;t refundable, except where the law
          where you live says otherwise. If a payment is refunded or reversed, for example through a chargeback, what it bought
          is removed from the account.
        </p>
      </section>

      <section>
        <h2>Apps you connect</h2>
        <p>
          You can connect Google Calendar, Apple Calendar, and AI apps such as Claude, ChatGPT and Gemini. When you do, Zephyrly
          shares your data with them as you choose, and their own terms and privacy policies apply. AI apps can only read your
          Zephyrly unless you allow changes, and every change one makes is listed in Settings with an Undo. You&apos;re responsible
          for what you allow a connected app to do.
        </p>
      </section>

      <section>
        <h2>No guarantees</h2>
        <p>
          Zephyrly works hard to stay up and keep your data safe, but it&apos;s provided as it is, without warranties, and there may
          be bugs or downtime. Keep your own copy of anything important; the export makes that easy. As far as the law allows,
          Zephyrly isn&apos;t responsible for indirect or knock-on losses, and its total responsibility to you is limited to what
          you paid Zephyrly in the 12 months before the claim. Nothing here takes away rights that consumer law gives you and
          doesn&apos;t let anyone take away.
        </p>
      </section>

      <section>
        <h2>Ending</h2>
        <p>
          You can stop using Zephyrly whenever you like, and ask for your account to be deleted (see the Privacy Policy). Accounts
          that break these terms may be closed. If Zephyrly ever shuts down, you&apos;ll get as much notice as reasonably possible,
          so you can export your data.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          These terms may be updated. If a change matters, the app will tell you before it takes effect, and using Zephyrly after
          that means you accept it.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Questions about these terms: <Contact />.
        </p>
      </section>
    </LegalPage>
  );
}

export function PrivacyPage() {
  const { appPublicSettings } = useAuth();
  const days = Number(/** @type {any} */ (appPublicSettings)?.deleted_task_retention_days) || 7;
  return (
    <LegalPage title="Privacy Policy" other={{ to: "/terms", label: "Terms of Service" }}>
      <p>
        This page says what Zephyrly keeps about you, why, who else is involved, and what you can do about it. In short: Zephyrly
        keeps what it needs to work, has no ads or tracking, and never sells your data.
      </p>

      <section>
        <h2>What Zephyrly keeps</h2>
        <ul>
          <li>
            <strong>Your account:</strong> your name, email address and profile picture from Google, and the ID Google gives your
            account.
          </li>
          <li>
            <strong>What you put in:</strong> tasks, notes, schedules, tags, priorities, reminders, attached files and settings.
          </li>
          <li>
            <strong>Sign-ins:</strong> for each device you sign in on, the kind of browser and device, the IP address it came from,
            and when it was last used. You see these in Settings → Signed-in devices; they also help keep accounts safe.
          </li>
          <li>
            <strong>Calendars you connect:</strong> the access Google or Apple gives Zephyrly (stored encrypted) and the events it
            brings in.
          </li>
          <li>
            <strong>AI apps you connect:</strong> which apps, what you allowed them to do, and a list of the changes they made, so
            you can undo them.
          </li>
          <li>
            <strong>Notifications:</strong> if you turn them on, the address your browser gives Zephyrly for delivering them.
          </li>
          <li>
            <strong>Email you send us:</strong> your address and what you wrote, kept so we can answer.
          </li>
          <li>
            <strong>Purchases, if you make one:</strong> Stripe&apos;s reference for the payment, the amount, currency and date.
            Never your card details; Stripe keeps those.
          </li>
          <li>
            <strong>On your device:</strong> a sign-in cookie, and the app&apos;s offline copy of your data in your browser&apos;s
            storage. No advertising or tracking cookies.
          </li>
        </ul>
      </section>

      <section>
        <h2>What Zephyrly doesn&apos;t do</h2>
        <p>
          No ads, no analytics or tracking tools, no selling or renting your data. Your content isn&apos;t read by a person except
          to keep the service running, to fix a problem you ask about, or when the law requires it.
        </p>
      </section>

      <section>
        <h2>Who else is involved</h2>
        <ul>
          <li>
            <strong>Google</strong> for signing in, for the mailbox that support email arrives in, and Google Calendar if you
            connect it.
          </li>
          <li>
            <strong>Apple</strong> for iCloud Calendar, if you connect it.
          </li>
          <li>
            <strong>Stripe</strong>, if you buy a paid upgrade (
            <a href="https://stripe.com/privacy" className="underline underline-offset-2">
              Stripe&apos;s privacy policy
            </a>
            ).
          </li>
          <li>
            <strong>Cloudflare</strong> carries connections to Zephyrly, protects it from attacks, and passes on email sent to the
            support address, so it sees traffic the way any network provider does.
          </li>
          <li>
            <strong>Your browser&apos;s maker</strong> (Apple, Google or Mozilla) delivers push notifications.
          </li>
          <li>
            <strong>AI apps you connect</strong> see what you let them see.
          </li>
        </ul>
      </section>

      <section>
        <h2>Where and how it&apos;s kept</h2>
        <p>
          On Zephyrly&apos;s own server, reached only over encrypted connections. Sign-in tokens are stored only in scrambled
          (hashed) form, and calendar access is encrypted.
        </p>
      </section>

      <section>
        <h2>How long</h2>
        <ul>
          <li>Your account and what&apos;s in it: until you delete them or ask for your account to be deleted.</li>
          <li>
            Things you delete wait in Recently Deleted for {days} days, then they&apos;re gone.
          </li>
          <li>Sign-in records: until you sign out or the sign-in expires.</li>
          <li>Payment records, if you buy something: as long as tax and accounting rules require.</li>
        </ul>
      </section>

      <section>
        <h2>Your choices</h2>
        <ul>
          <li>Download everything at any time: Settings → Export &amp; restore.</li>
          <li>See and end sign-ins: Settings → Signed-in devices.</li>
          <li>Disconnect calendars and AI apps in Settings whenever you like.</li>
          <li>
            Ask for a copy, a correction, or for your account and everything in it to be deleted: write to <Contact /> from the
            email address on your account. Deletion is done within 30 days.
          </li>
        </ul>
      </section>

      <section>
        <h2>Children</h2>
        <p>Zephyrly isn&apos;t meant for children under 13.</p>
      </section>

      <section>
        <h2>Changes and contact</h2>
        <p>
          If this policy changes in a way that matters, the app will tell you. Questions: <Contact />.
        </p>
      </section>
    </LegalPage>
  );
}
