import { useLocation, Link } from 'react-router-dom';
import { Hammer, ArrowLeft } from 'lucide-react';

/**
 * Shown for a route inside a signed-in shell that does not exist yet.
 *
 * Without this, an unbuilt page falls through to the global catch-all and
 * redirects to the public landing page, which looks exactly like being
 * signed out. Several modules are still to come, so the honest version of
 * that is a page saying so while keeping the person where they are.
 */
export default function ComingSoon() {
  const { pathname } = useLocation();
  const home = '/' + pathname.split('/')[1];

  return (
    <div className="max-w-md py-8">
      <Hammer size={22} className="text-ink-faint" />
      <h1 className="mt-4 text-xl font-bold tracking-tight">Not built yet</h1>
      <p className="mt-2 text-sm text-ink-soft leading-relaxed">
        This part of OpenUp has not been written. The menu item is here because the
        module is planned, not because it works.
      </p>
      <p className="mt-2 text-xs text-ink-faint font-mono">{pathname}</p>
      <Link to={home} className="btn-quiet h-10 px-5 mt-6">
        <ArrowLeft size={15} />
        Back to dashboard
      </Link>
    </div>
  );
}
