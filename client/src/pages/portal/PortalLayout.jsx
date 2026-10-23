import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useStudent } from '../../studentAuth.jsx';

export default function PortalLayout() {
  const { student, logout } = useStudent();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/portal/login');
  }

  return (
    <div className="portal">
      <header className="portal-top">
        <div className="portal-brand">
          <span className="brand-mark">
            <img src="/logo.png" alt="AttendX logo" />
          </span>
          <div>
            <strong>AttendX</strong>
            <span>Student portal</span>
          </div>
        </div>
        <div className="portal-user">
          <div className="portal-user-info">
            <span className="portal-user-name">
              {student.firstName} {student.lastName}
            </span>
            <span className="portal-user-no">
              {student.studentNo}
              {student.course ? ` · ${student.course}${student.yearLevel ? `-${student.yearLevel}` : ''}${student.section ? ` ${student.section}` : ''}` : ''}
            </span>
          </div>
          <button className="btn btn-sm" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>
      <nav className="portal-tabs">
        <NavLink to="/portal" end>
          Dashboard
        </NavLink>
        <NavLink to="/portal/history">Attendance history</NavLink>
        <NavLink to="/portal/corrections">Corrections</NavLink>
        <NavLink to="/portal/account">Account</NavLink>
      </nav>
      <div className="portal-main">
        <Outlet />
      </div>
    </div>
  );
}
