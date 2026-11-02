import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';
import Spinner from '../components/Spinner.jsx';

const POLICY_FIELDS = [
  {
    key: 'onTimeMaxMin',
    label: 'On-time window',
    suffix: 'minutes after start',
    min: 0,
    max: 120,
    hint: 'Check-ins inside this window are counted as on time.',
  },
  {
    key: 'lateMaxMin',
    label: 'Late cutoff',
    suffix: 'minutes after start',
    min: 1,
    max: 480,
    hint: 'After this, a missing check-in counts as absent. Must be after the on-time window.',
  },
  {
    key: 'timeoutOpenBeforeEndMin',
    label: 'Time-out opens',
    suffix: 'minutes before end',
    min: 0,
    max: 240,
    hint: 'How early students may time out before the event ends.',
  },
  {
    key: 'autoCloseGraceMin',
    label: 'Auto-close grace',
    suffix: 'minutes after end',
    min: 0,
    max: 1440,
    hint: '0 closes at the scheduled end. Events without an end time stay open.',
  },
  {
    key: 'autoArchiveAfterDays',
    label: 'Auto-archive after',
    suffix: 'days (0 = never)',
    min: 0,
    max: 365,
    hint: 'Closed events move to the Archived section after this many days.',
  },
];

const RISK_FIELDS = [
  {
    key: 'atRiskThreshold',
    label: 'At-risk threshold',
    suffix: '% attendance',
    min: 0,
    max: 100,
    hint: 'Students below this rate appear in the At-risk report.',
  },
  {
    key: 'atRiskMinEvents',
    label: 'Minimum events to score',
    suffix: 'events',
    min: 0,
    max: 1000,
    hint: 'Wait until this many events exist before flagging risk.',
  },
  {
    key: 'lowCheckinRate',
    label: 'Low check-in alert',
    suffix: '% attendance',
    min: 0,
    max: 100,
    hint: 'Raise an alert when an active event falls below this rate.',
  },
  {
    key: 'lowCheckinGraceMin',
    label: 'Alert grace period',
    suffix: 'minutes after start',
    min: 0,
    max: 240,
    hint: 'Wait this long after the start before checking turnout.',
  },
];

function Field({ field, value, onChange }) {
  return (
    <label>
      {field.label}
      <span className="settings-input">
        <input
          type="number"
          min={field.min}
          max={field.max}
          value={value ?? 0}
          onChange={(e) => onChange(field.key, Number(e.target.value))}
        />
        <span className="settings-suffix">{field.suffix}</span>
      </span>
      <span className="settings-hint">{field.hint}</span>
    </label>
  );
}

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);

  useEffect(() => {
    api
      .getSettings()
      .then((data) => {
        setSettings(data);
        setForm(data);
      })
      .catch((e) => setError(e.message));
  }, []);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: Number.isFinite(value) ? value : 0 }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSaved('');
    try {
      const next = await api.updateSettings(form);
      setSettings(next);
      setForm(next);
      setSaved('Policy saved. New scans and reports use it immediately.');
      setTimeout(() => setSaved(''), 3500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setError('');
    setRunResult(null);
    try {
      const result = await api.runAutomation();
      setRunResult(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  if (!form) {
    return (
      <div className="page">
        <PageHeader eyebrow="System" title="Settings" subtitle="Attendance policy and automation." />
        <div className="card">
          {error ? <div className="alert alert-error">{error}</div> : <Spinner label="Loading settings…" size="lg" variant="panel" />}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="System"
        title="Settings"
        subtitle="Tune attendance classification, alerts, and automatic event cleanup."
        actions={
          <button className="btn" onClick={runNow} disabled={running}>
            {running ? 'Running…' : 'Run maintenance now'}
          </button>
        }
      />

      {error && <div className="alert alert-error">{error}</div>}
      {saved && <div className="alert alert-success">{saved}</div>}

      <div className="stat-grid">
        <StatCard
          icon="clock"
          accent="blue"
          label="On-time window"
          value={`${settings?.onTimeMaxMin ?? 0}m`}
          hint="After the event starts"
        />
        <StatCard
          icon="alert"
          accent="amber"
          label="Late cutoff"
          value={`${settings?.lateMaxMin ?? 0}m`}
          hint="Then counted absent"
        />
        <StatCard
          icon="repeat"
          accent="purple"
          label="Auto-close"
          value={Number(settings?.autoCloseGraceMin) === 0 ? 'At end' : `+${settings?.autoCloseGraceMin}m`}
          hint="After scheduled end"
        />
        <StatCard
          icon="archive"
          accent="green"
          label="Auto-archive"
          value={Number(settings?.autoArchiveAfterDays) === 0 ? 'Off' : `${settings?.autoArchiveAfterDays}d`}
          hint="Closed events"
        />
      </div>

      <form className="card settings-card" onSubmit={save}>
        <div className="dash-card-head">
          <div>
            <h3>Attendance policy</h3>
            <p className="muted small">Applied to new scans and report calculations right away.</p>
          </div>
        </div>
        <div className="form grid-form settings-fields">
          {POLICY_FIELDS.map((field) => (
            <Field key={field.key} field={field} value={form[field.key]} onChange={setField} />
          ))}
        </div>

        <div className="settings-section">
          <div className="dash-card-head">
            <div>
              <h3>Alerts &amp; risk</h3>
              <p className="muted small">Controls the At-risk report and background notifications.</p>
            </div>
          </div>
          <div className="form grid-form settings-fields">
            {RISK_FIELDS.map((field) => (
              <Field key={field.key} field={field} value={form[field.key]} onChange={setField} />
            ))}
          </div>
        </div>

        <div className="settings-actions">
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save policy'}
          </button>
        </div>
      </form>

      <div className="card settings-automation">
        <div className="dash-card-head">
          <div>
            <h3>Background automation</h3>
            <p className="muted small">
              Runs on the daily Vercel cron, and lazily when the dashboard or live board is opened.
            </p>
          </div>
          <button className="btn btn-sm" onClick={runNow} disabled={running}>
            {running ? 'Running…' : 'Run now'}
          </button>
        </div>
        <ul className="about-list">
          <li>Closes active events after their end time plus the grace period.</li>
          <li>Records missing students as absent and locks the final event summary.</li>
          <li>Archives closed events after the configured number of days.</li>
          <li>Raises low check-in, at-risk, compliance, and daily summary notifications.</li>
        </ul>
        {runResult && (
          <div className="alert alert-info settings-run-result">
            Maintenance finished. Closed {runResult.closed?.length || 0} event(s), archived{' '}
            {runResult.archived?.length || 0} event(s).
            {runResult.closed?.length > 0 && (
              <span> Closed: {runResult.closed.map((e) => e.name).join(', ')}.</span>
            )}
            {runResult.archived?.length > 0 && (
              <span> Archived: {runResult.archived.map((e) => e.name).join(', ')}.</span>
            )}
          </div>
        )}
        <p className="muted small">
          Cron secret: configure <code>CRON_SECRET</code> on the API project. The daily schedule lives in{' '}
          <code>server/vercel.json</code>.
        </p>
      </div>
    </div>
  );
}
