import { Link } from 'react-router-dom';
import { APP_NAME, AUTHOR } from '../meta.js';

export default function Footer({ compact = false }) {
  const year = new Date().getFullYear();
  return (
    <footer className={`app-footer ${compact ? 'app-footer--compact' : ''}`}>
      <div className="app-footer__line">
        © {year} {APP_NAME} · All Rights Reserved.
      </div>
      <div className="app-footer__line">
        Designed &amp; developed by {AUTHOR}.
        {!compact && (
          <>
            {' '}·{' '}
            <Link className="link" to="/about">
              About this app
            </Link>
          </>
        )}
      </div>
    </footer>
  );
}
