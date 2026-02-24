import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Shows from './pages/Shows';
import ShowDetails from './pages/ShowDetails';
import Booking from './pages/Booking';
import Confirmation from './pages/Confirmation';
import Admin from './pages/Admin';
import About from './pages/About';
import TechCrew from './pages/TechCrew';
import SetDesign from './pages/SetDesign';
import MusicalTheater from './pages/MusicalTheater';
import ParentsAssociation from './pages/ParentsAssociation';

import InterestMeeting from './pages/InterestMeeting';

export default function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/shows" element={<Shows />} />
          <Route path="/shows/:id" element={<ShowDetails />} />
          <Route path="/booking/:performanceId" element={<Booking />} />
          <Route path="/confirmation" element={<Confirmation />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/about" element={<About />} />
          <Route path="/tech-crew" element={<TechCrew />} />
          <Route path="/set-design" element={<SetDesign />} />
          <Route path="/musical-theater" element={<MusicalTheater />} />
          <Route path="/parents-association" element={<ParentsAssociation />} />
          <Route path="/interest-meeting" element={<InterestMeeting />} />
        </Routes>
      </Layout>
    </Router>
  );
}
