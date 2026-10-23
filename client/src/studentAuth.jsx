import { createContext, useContext, useEffect, useState } from 'react';
import { api, getStudentToken, setStudentToken } from './api.js';
import { markIdleLogout, useIdleLogout } from './idle.js';

const StudentContext = createContext(null);
const STUDENT_USER_KEY = 'student_user';

// Cache the signed-in student so portal pages open without a round-trip.
function loadCachedStudent() {
  try {
    return JSON.parse(localStorage.getItem(STUDENT_USER_KEY) || 'null');
  } catch {
    return null;
  }
}

function saveCachedStudent(student) {
  try {
    if (student) localStorage.setItem(STUDENT_USER_KEY, JSON.stringify(student));
    else localStorage.removeItem(STUDENT_USER_KEY);
  } catch {
    /* ignore quota / privacy errors */
  }
}

export function StudentProvider({ children }) {
  const [student, setStudent] = useState(loadCachedStudent);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getStudentToken()) {
      setLoading(false);
      return;
    }
    api
      .studentMe()
      .then(({ student: fresh }) => {
        setStudent(fresh);
        saveCachedStudent(fresh);
      })
      .catch((err) => {
        // Offline: keep the session so portal pages keep rendering.
        if (err?.network) {
          const cached = loadCachedStudent();
          if (cached) setStudent(cached);
        } else {
          setStudentToken(null);
          saveCachedStudent(null);
          setStudent(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function signIn(studentNo, password) {
    const { token, student: next } = await api.studentLogin({ studentNo, password });
    setStudentToken(token);
    setStudent(next);
    saveCachedStudent(next);
    return next;
  }

  async function setup(payload) {
    const { token, student: next } = await api.studentSetup(payload);
    setStudentToken(token);
    setStudent(next);
    saveCachedStudent(next);
    return next;
  }

  function logout() {
    setStudentToken(null);
    saveCachedStudent(null);
    setStudent(null);
  }

  // Auto sign-out after 5 minutes without activity in the portal.
  useIdleLogout({
    enabled: Boolean(student),
    onLogout: () => {
      logout();
      markIdleLogout();
    },
  });

  return (
    <StudentContext.Provider value={{ student, loading, signIn, setup, logout }}>
      {children}
    </StudentContext.Provider>
  );
}

export function useStudent() {
  return useContext(StudentContext);
}
