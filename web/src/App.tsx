// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { lazy, Suspense } from 'react';
import { Shell, Toasts } from './components/Shell.tsx';
import { TermsGate, useTermsRequired } from './components/TermsGate.tsx';
import { PageLoading } from './components/ui.tsx';
import { matchPath, useLocation } from './lib/router.tsx';
import { useApp } from './lib/store.ts';
import { AuthPage } from './pages/AuthPage.tsx';
import { Dashboard } from './pages/Dashboard.tsx';

const TermsPage = lazy(() => import('./pages/TermsPage.tsx').then((m) => ({ default: m.TermsPage })));
const NoticesPage = lazy(() => import('./pages/NoticesPage.tsx').then((m) => ({ default: m.NoticesPage })));
const StudySetup = lazy(() => import('./pages/StudySetup.tsx').then((m) => ({ default: m.StudySetup })));
const SessionPage = lazy(() => import('./pages/session/SessionPage.tsx').then((m) => ({ default: m.SessionPage })));
const ReviewPage = lazy(() => import('./pages/ReviewPage.tsx').then((m) => ({ default: m.ReviewPage })));
const WordsPage = lazy(() => import('./pages/WordsPage.tsx').then((m) => ({ default: m.WordsPage })));
const WordDetailPage = lazy(() => import('./pages/WordDetailPage.tsx').then((m) => ({ default: m.WordDetailPage })));
const WordFormPage = lazy(() => import('./pages/WordFormPage.tsx').then((m) => ({ default: m.WordFormPage })));
const ProgressPage = lazy(() => import('./pages/ProgressPage.tsx').then((m) => ({ default: m.ProgressPage })));
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage.tsx').then((m) => ({ default: m.SettingsPage })));
const ImportPage = lazy(() => import('./pages/ImportPage.tsx').then((m) => ({ default: m.ImportPage })));
const PracticeHub = lazy(() => import('./pages/practice/PracticeHub.tsx').then((m) => ({ default: m.PracticeHub })));
const FormsPractice = lazy(() => import('./pages/practice/FormsPractice.tsx').then((m) => ({ default: m.FormsPractice })));
const ClozePractice = lazy(() => import('./pages/practice/ClozePractice.tsx').then((m) => ({ default: m.ClozePractice })));
const ReadPractice = lazy(() => import('./pages/practice/ReadPractice.tsx').then((m) => ({ default: m.ReadPractice })));
const IdentifyPractice = lazy(() => import('./pages/practice/IdentifyPractice.tsx').then((m) => ({ default: m.IdentifyPractice })));
const ComprehensionPractice = lazy(() => import('./pages/practice/ComprehensionPractice.tsx').then((m) => ({ default: m.ComprehensionPractice })));
const WritingPractice = lazy(() => import('./pages/practice/WritingPractice.tsx').then((m) => ({ default: m.WritingPractice })));

function Routes() {
  const { path } = useLocation();
  let p: Record<string, string> | null;
  if (path === '/') return <Dashboard />;
  if (path === '/study') return <StudySetup />;
  // Keyed: "Study more" opens the next session on a fresh page, without the last one's state.
  if ((p = matchPath('/study/:sessionId', path))) return <SessionPage key={p.sessionId} sessionId={p.sessionId} />;
  if (path === '/review') return <ReviewPage />;
  if (path === '/practice') return <PracticeHub />;
  if (path === '/practice/forms') return <FormsPractice />;
  if (path === '/practice/cloze') return <ClozePractice />;
  if (path === '/practice/read') return <ReadPractice />;
  if (path === '/practice/identify') return <IdentifyPractice />;
  if (path === '/practice/comprehension') return <ComprehensionPractice />;
  if (path === '/practice/writing') return <WritingPractice />;
  if (path === '/words') return <WordsPage />;
  if (path === '/words/new') return <WordFormPage />;
  if ((p = matchPath('/words/:id/edit', path))) return <WordFormPage entryId={Number(p.id)} />;
  if ((p = matchPath('/words/:id', path))) return <WordDetailPage entryId={Number(p.id)} />;
  // /stats was the page's address before it became Progress: old links and bookmarks still lead there.
  if (path === '/progress' || path.startsWith('/progress/') || path === '/stats' || path.startsWith('/stats/')) return <ProgressPage />;
  if (path === '/import') return <ImportPage />;
  if (path === '/settings' || path.startsWith('/settings/')) return <SettingsPage />;
  if (path === '/terms') return <TermsPage />;
  if (path === '/notices') return <NoticesPage />;
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted-foreground">There is nothing at this address.</p>
      <a className="inline-flex h-10 items-center rounded-lg border bg-card px-4 text-sm font-medium shadow-xs outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50" href="/">
        Go to Today
      </a>
    </div>
  );
}

export function App() {
  const auth = useApp((s) => s.auth);
  const termsRequired = useTermsRequired();
  const { path } = useLocation();
  if (auth === 'loading') return <PageLoading label="Opening VocabBuilder" />;
  const signedOut = auth === 'setup' || auth === 'login';
  // The legal pages are readable before signing in, and while the updated terms wait to be accepted.
  if ((signedOut || termsRequired) && path === '/notices') {
    return (
      <Suspense fallback={<PageLoading />}>
        <NoticesPage standalone />
      </Suspense>
    );
  }
  if (signedOut && path === '/terms') {
    return (
      <Suspense fallback={<PageLoading />}>
        <TermsPage standalone />
      </Suspense>
    );
  }
  if (signedOut) return <AuthPage mode={auth} />;
  if (termsRequired) {
    return (
      <>
        <TermsGate />
        <Toasts />
      </>
    );
  }
  return (
    <>
      <Shell>
        <Suspense fallback={<PageLoading />}>
          <Routes />
        </Suspense>
      </Shell>
      <Toasts />
    </>
  );
}
