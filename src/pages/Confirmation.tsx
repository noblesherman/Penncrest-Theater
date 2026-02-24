import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import confetti from 'canvas-confetti';
import { CheckCircle, Download, Calendar, MapPin } from 'lucide-react';
import { format } from 'date-fns';

export default function Confirmation() {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('orderId');
  const [orderData, setOrderData] = useState<any>(null);

  useEffect(() => {
    if (orderId) {
      const finalizeOrder = async () => {
        if (searchParams.get('mock_success')) {
           await fetch('/api/mock-webhook', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ orderId })
           });
        }
        
        fetch(`/api/orders/${orderId}`)
          .then(res => res.json())
          .then(data => {
              setOrderData(data);
              // Fire confetti
              const duration = 3 * 1000;
              const animationEnd = Date.now() + duration;
              const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

              const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

              const interval: any = setInterval(function() {
              const timeLeft = animationEnd - Date.now();

              if (timeLeft <= 0) {
                  return clearInterval(interval);
              }

              const particleCount = 50 * (timeLeft / duration);
              confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
              confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
              }, 250);
          });
      };

      finalizeOrder();
    }
  }, [orderId]);

  if (!orderData) return <div className="min-h-screen flex items-center justify-center">Loading confirmation...</div>;

  const { order, tickets } = orderData;
  const firstTicket = tickets[0];

  return (
    <div className="min-h-screen bg-yellow-50 py-20 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-stone-100">
          <div className="bg-stone-900 text-white p-12 text-center relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]"></div>
            <div className="relative z-10">
              <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                <CheckCircle className="w-10 h-10 text-white" />
              </div>
              <h1 className="text-4xl font-black mb-2">YOU'RE ALL SET!</h1>
              <p className="text-stone-400 text-lg">Order #{order.id.slice(0, 8)}</p>
            </div>
          </div>

          <div className="p-8 md:p-12">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold text-stone-900 mb-2">{firstTicket?.showTitle}</h2>
              <div className="flex flex-col md:flex-row items-center justify-center gap-4 text-stone-500 mt-4">
                <div className="flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
                  {firstTicket && format(new Date(firstTicket.date), 'EEEE, MMMM d, yyyy @ h:mm a')}
                </div>
                <div className="hidden md:block">•</div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  Penncrest High School Auditorium
                </div>
              </div>
            </div>

            <div className="bg-stone-50 rounded-2xl p-6 mb-8 border border-stone-100">
              <h3 className="font-bold text-stone-900 mb-4 uppercase tracking-wider text-sm">Your Tickets</h3>
              <div className="space-y-3">
                {tickets.map((ticket: any) => (
                  <div key={ticket.id} className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-stone-100">
                    <div>
                      <div className="font-bold text-lg">{ticket.sectionName}</div>
                      <div className="text-stone-500 text-sm">Row {ticket.row}, Seat {ticket.number}</div>
                    </div>
                    <div className="bg-stone-100 p-2 rounded-lg">
                        {/* Placeholder QR */}
                        <div className="w-8 h-8 bg-stone-900 rounded flex items-center justify-center text-white text-[8px]">QR</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <button className="w-full bg-yellow-400 text-stone-900 font-bold py-4 rounded-xl text-lg hover:bg-yellow-500 transition-colors flex items-center justify-center gap-2 shadow-md">
                <Download className="w-5 h-5" /> Download Tickets (PDF)
              </button>
              <Link to="/" className="w-full bg-white border-2 border-stone-200 text-stone-600 font-bold py-4 rounded-xl text-lg hover:bg-stone-50 hover:text-stone-900 transition-colors text-center">
                Return Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
