import { Link } from 'react-router-dom';
import { ShieldCheck, Mic, CalendarCheck, HeartHandshake } from 'lucide-react';

// Figure 23: Public Landing Page.
export default function Landing() {
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between px-5 lg:px-10 h-16 max-w-6xl mx-auto">
        <span className="text-lg font-extrabold tracking-tight">OpenUp</span>
        <nav className="flex items-center gap-2">
          <Link to="/login" className="btn-quiet h-9 px-4">Sign in</Link>
          <Link to="/register" className="btn-primary h-9 px-4">Create account</Link>
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-5 lg:px-10">
        <section className="py-16 lg:py-24 max-w-2xl">
          <h1 className="text-[2.5rem] lg:text-6xl font-extrabold tracking-[-0.03em] leading-[1.05]">
            Somebody is ready to listen, and you do not have to give your name.
          </h1>
          <p className="mt-6 text-lg text-ink-soft leading-relaxed max-w-xl">
            OpenUp connects residents of Cebu City with licensed psychologists,
            round-the-clock support, and wellness tools your barangay helps pay for.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/register" className="btn-primary">Get support</Link>
            <Link to="/login" className="btn-quiet">I already have an account</Link>
          </div>
          <p className="mt-6 text-sm text-ink-faint">
            In immediate danger? Call the NCMH Crisis Hotline at 1553, free from any landline
            or mobile in the Philippines.
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 pb-20">
          {[
            { icon: HeartHandshake, title: 'Talk anonymously',
              body: 'Message a licensed psychologist without showing your real name.' },
            { icon: CalendarCheck, title: 'Book a session',
              body: 'One-on-one or group counseling, often covered by Care Credits from your barangay.' },
            { icon: Mic, title: 'Keep a voice journal',
              body: 'Say what is on your mind. OpenUp writes it down and reflects it back to you.' },
            { icon: ShieldCheck, title: 'Stay private',
              body: 'Your barangay sees community trends only, never your name or what you wrote.' },
          ].map(({ icon: Icon, title, body }) => (
            <article key={title} className="card p-5">
              <Icon size={20} className="text-tide-500" />
              <h2 className="mt-3 font-bold">{title}</h2>
              <p className="mt-1.5 text-sm text-ink-soft leading-relaxed">{body}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
