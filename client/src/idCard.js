const MM_PER_INCH = 25.4;

export function yearSection(student) {
  const year = (student.yearLevel || '').trim();
  const section = (student.section || '').trim();
  if (year && section) return `${year} · Sec ${section}`;
  return year || (section ? `Sec ${section}` : '');
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

const FONT = 'Inter, -apple-system, "Segoe UI", Arial, sans-serif';

// Renders a full ID-card (85.6 x 54 mm) to a canvas at the given DPI, using the
// provided QR canvas. Returns a ready-to-export HTMLCanvasElement.
export function composeIdCard(student, qrCanvas, dpi = 300) {
  const s = dpi / MM_PER_INCH;
  const W = Math.round(85.6 * s);
  const H = Math.round(54 * s);
  const radius = 3 * s;
  const headerH = 8.5 * s;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  roundRect(ctx, 0, 0, W, H, radius);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.save();
  roundRect(ctx, 0, 0, W, H, radius);
  ctx.clip();

  const grad = ctx.createLinearGradient(0, 0, W, headerH);
  grad.addColorStop(0, '#2563eb');
  grad.addColorStop(1, '#7c3aed');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, headerH);

  const logoSize = 5 * s;
  const logoX = 3 * s;
  const logoY = (headerH - logoSize) / 2;
  roundRect(ctx, logoX, logoY, logoSize, logoSize, 1.4 * s);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${2.2 * s}px ${FONT}`;
  ctx.fillText('AM', logoX + logoSize / 2, logoY + logoSize / 2 + 0.1 * s);

  ctx.textAlign = 'left';
  ctx.font = `700 ${2.7 * s}px ${FONT}`;
  ctx.fillText('Attendance Monitor', logoX + logoSize + 1.5 * s, headerH / 2 + 0.1 * s);

  ctx.textAlign = 'right';
  ctx.font = `600 ${1.9 * s}px ${FONT}`;
  ctx.fillText('STUDENT PASS', W - 3 * s, headerH / 2 + 0.1 * s);

  const bodyH = H - headerH;
  const qrSize = 34 * s;
  const qrX = 4 * s;
  const qrY = headerH + (bodyH - qrSize) / 2;

  roundRect(ctx, qrX - 1.5 * s, qrY - 1.5 * s, qrSize + 3 * s, qrSize + 3 * s, 2 * s);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 0.4 * s;
  ctx.strokeStyle = '#e2e8f0';
  ctx.stroke();
  if (qrCanvas) ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);

  const tx = qrX + qrSize + 4 * s;
  const maxTextW = W - 4 * s - tx;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const namePx = 3.8 * s;
  ctx.font = `800 ${namePx}px ${FONT}`;
  const nameLines = wrapText(ctx, `${student.lastName}, ${student.firstName}`, maxTextW).slice(0, 3);

  const metaPx = 2.6 * s;
  const metas = [student.course, yearSection(student)].filter(Boolean);

  const blockH = nameLines.length * namePx * 1.12 + 1 * s + metas.length * metaPx * 1.5 + 1.4 * s + 2.8 * s;
  let y = qrY + Math.max(0, (qrSize - blockH) / 2);

  ctx.fillStyle = '#0f172a';
  ctx.font = `800 ${namePx}px ${FONT}`;
  for (const line of nameLines) {
    ctx.fillText(line, tx, y);
    y += namePx * 1.12;
  }

  y += 1 * s;
  ctx.fillStyle = '#334155';
  ctx.font = `500 ${metaPx}px ${FONT}`;
  for (const meta of metas) {
    ctx.fillText(meta, tx, y);
    y += metaPx * 1.5;
  }

  y += 1.4 * s;
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 ${2.8 * s}px "SF Mono", Menlo, Consolas, monospace`;
  ctx.fillText(student.studentNo, tx, y);

  ctx.restore();

  roundRect(ctx, 0.5, 0.5, W - 1, H - 1, radius);
  ctx.lineWidth = 1 * s;
  ctx.strokeStyle = '#e2e8f0';
  ctx.stroke();

  return canvas;
}
