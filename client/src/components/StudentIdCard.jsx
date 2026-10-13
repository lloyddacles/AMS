import { QRCodeCanvas } from 'qrcode.react';
import { yearSection } from '../idCard.js';

export default function StudentIdCard({ student, qrSize = 320 }) {
  const detail = yearSection(student);
  return (
    <div className="id-card">
      <div className="id-card__bar">
        <span className="id-card__logo">AM</span>
        <span className="id-card__org">Attendance Monitor</span>
        <span className="id-card__tag">STUDENT PASS</span>
      </div>
      <div className="id-card__body">
        <div className="id-card__qr">
          <QRCodeCanvas value={student.qrToken} size={qrSize} level="M" />
        </div>
        <div className="id-card__info">
          <div className="id-card__name">
            {student.lastName}, {student.firstName}
          </div>
          {student.course && <div className="id-card__meta">{student.course}</div>}
          {detail && <div className="id-card__meta">{detail}</div>}
          <div className="id-card__no">{student.studentNo}</div>
        </div>
      </div>
    </div>
  );
}
