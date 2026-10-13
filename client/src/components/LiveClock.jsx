import { useEffect, useState } from 'react';

function format(date) {
  const h24 = date.getHours();
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 || 12;
  const pad = (n) => String(n).padStart(2, '0');
  return {
    time: `${h12}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    ampm,
    date: date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
  };
}

export default function LiveClock({ className = '', showDate = true }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { time, ampm, date } = format(now);

  return (
    <div className={`live-clock ${className}`} title={date}>
      <span className="live-clock__time">{time}</span>
      <span className="live-clock__ampm">{ampm}</span>
      {showDate && <span className="live-clock__date">{date}</span>}
    </div>
  );
}
