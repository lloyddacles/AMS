import { useEffect, useRef } from 'react';

export const IDLE_TIMEOUT = 5 * 60 * 1000;
const IDLE_FLAG_KEY = 'idle-logout';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'mousemove', 'touchstart', 'wheel', 'scroll'];

// Remembers that the sign-out was caused by inactivity, so the login page can
// explain it. The flag is consumed (read + cleared) on first read.
export function markIdleLogout() {
  try {
    sessionStorage.setItem(IDLE_FLAG_KEY, '1');
  } catch {
    /* ignore quota / privacy errors */
  }
}

export function takeIdleLogout() {
  try {
    const flag = sessionStorage.getItem(IDLE_FLAG_KEY);
    if (flag) sessionStorage.removeItem(IDLE_FLAG_KEY);
    return Boolean(flag);
  } catch {
    return false;
  }
}

// Logs the user out after `timeout` without any pointer/keyboard activity on
// the page. Listeners only run while `enabled` (i.e. someone is signed in).
export function useIdleLogout({ enabled, onLogout, timeout = IDLE_TIMEOUT }) {
  const logoutRef = useRef(onLogout);
  logoutRef.current = onLogout;

  useEffect(() => {
    if (!enabled) return undefined;
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => logoutRef.current(), timeout);
    };
    const opts = { passive: true };
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, reset, opts);
    reset();
    return () => {
      clearTimeout(timer);
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, reset, opts);
    };
  }, [enabled, timeout]);
}
