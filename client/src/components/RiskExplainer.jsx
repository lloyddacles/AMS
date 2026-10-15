const LEVEL_LABEL = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  critical: 'Critical',
};

export default function RiskExplainer({ student, detail, context }) {
  const record = detail && !detail.error ? detail.student : null;
  const contributions = record?.contributions || student.drivers || [];
  const ctx = detail?.context || context;
  const risk = record?.risk ?? student.risk;
  const level = record?.riskLevel || student.riskLevel || 'low';

  const positive = contributions.filter((c) => c.contribution > 0);
  const top = positive[0] || contributions[0];

  return (
    <div className="risk-explain">
      <div className="risk-explain-head">
        <div>
          <strong>Why {risk}% risk?</strong>{' '}
          <span className={`risk-pill risk-${level}`}>{LEVEL_LABEL[level] || level}</span>
        </div>
        {ctx && (
          <span className="muted small">
            Transparent logistic model · exact SHAP (log-odds) · baseline{' '}
            {Math.round((ctx.expectedProbability ?? 0) * 100)}%
          </span>
        )}
      </div>

      {detail?.error && <div className="muted small">Could not load the full breakdown.</div>}
      {detail && !detail.error && !record && <div className="muted small">Loading breakdown…</div>}

      {top && (
        <p className="risk-summary">
          Mainly driven by <strong>{top.label.toLowerCase()}</strong>
          {top.text ? ` (${top.text})` : ''}.
        </p>
      )}

      <div className="driver-list">
        {contributions.map((c) => (
          <div className="driver-row" key={c.key}>
            <span className="driver-label">{c.label}</span>
            <span className="driver-text muted small">{c.text}</span>
            <div className="driver-bar" title={c.direction === 'up' ? 'Increases risk' : 'Reduces risk'}>
              <span className={`driver-fill ${c.direction}`} style={{ width: `${Math.max(c.pct, 3)}%` }} />
            </div>
            <span className={`driver-sign ${c.direction}`}>
              {c.direction === 'up' ? '+' : '−'}
              {Math.abs(c.contribution).toFixed(2)}
            </span>
            <span className="driver-pct muted small">{c.pct}%</span>
          </div>
        ))}
      </div>

      <p className="muted small risk-footnote">
        Contributions are additive on the log-odds scale and sum to the model's risk margin.
        Features measure the whole term, with extra weight on recent events. Weights are
        auditable calibrated priors (no labelled training data yet).
      </p>
    </div>
  );
}
