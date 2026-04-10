import AboutContentPage from './AboutContentPage';
import InstagramGrid from '../components/InstagramGrid';

export default function About() {
  return (
    <>
      <AboutContentPage slug="about" />
      <div className="bg-stone-50">
        <InstagramGrid title="Backstage On Instagram" maxItems={18} />
      </div>
    </>
  );
}
