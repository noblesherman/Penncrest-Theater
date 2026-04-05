import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import AboutContentPage from './AboutContentPage';
import NotFoundPage from './NotFound';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default function DynamicAboutPage() {
  const { aboutSlug = '' } = useParams<{ aboutSlug: string }>();

  const normalizedSlug = useMemo(() => aboutSlug.trim().toLowerCase(), [aboutSlug]);
  if (!normalizedSlug || !slugPattern.test(normalizedSlug)) {
    return <NotFoundPage />;
  }

  return <AboutContentPage slug={normalizedSlug} />;
}
