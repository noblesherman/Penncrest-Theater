import { useEffect, useState } from 'react';
import AboutPageRenderer from '../components/about/AboutPageRenderer';
import { apiFetch } from '../lib/api';
import type { AboutPageContent, AboutPageSlug } from '../lib/aboutContent';

export default function AboutContentPage({ slug }: { slug: AboutPageSlug }) {
  const [page, setPage] = useState<AboutPageContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    setPage(null);

    apiFetch<AboutPageContent>(`/api/content/about/pages/${slug}`)
      .then((result) => {
        if (active) {
          setPage(result);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load page');
        }
      });

    return () => {
      active = false;
    };
  }, [slug]);

  if (error) {
    return (
      <div className="min-h-[50vh] bg-stone-50 px-6 py-16 text-stone-900 sm:px-10">
        <div className="mx-auto max-w-3xl rounded-[28px] border border-rose-200 bg-white p-8 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-600">About Content</p>
          <h1 className="mt-3 text-3xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
            This page could not be loaded.
          </h1>
          <p className="mt-4 text-stone-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!page) {
    return <div className="min-h-[50vh] bg-stone-50 flex items-center justify-center text-stone-500">Loading page...</div>;
  }

  return <AboutPageRenderer page={page} />;
}
