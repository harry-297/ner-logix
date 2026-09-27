import { useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";
import {
  CloudRain,
  AlertTriangle,
  Mountain,
  Waves,
  Clock3,
  Loader2,
  Info,
} from "lucide-react";

import { apiFetch } from "../lib/api";

/**
 * Combined landslide + flood prediction, backed by POST /api/ml/predict-disruption.
 *
 * This page used to display fixed numbers. It now calls both trained models
 * through the dispatcher and shows what they actually return, including the
 * parts that weaken the answer: the caveats list and the terrain damping are
 * surfaced rather than hidden, because a risk number with no stated
 * limitations is the one most likely to be trusted past its usefulness.
 *
 * With no rainfall supplied the backend fetches live 24h/3-day/7-day figures
 * from Open-Meteo. Entering a figure by hand switches the whole request to
 * manual so the result stays reproducible from the inputs on screen.
 */

interface HazardDetail {
  risk_score: number;
  risk_level: string;
  risk_score_raw_model?: number;
  terrain_adjusted_risk_score?: number;
  slope_proxy?: number;
  state_used?: string;
  rainfall_anomaly_ratio?: number;
  flood_probability?: number;
  terrain_exposure?: number;
  model?: string;
}

interface DisruptionResult {
  combined_risk_score: number;
  risk_level: string;
  dominant_hazard: string;
  recommended_action: string;
  expected_disruption_hours: number;
  asset_type: string;
  landslide: HazardDetail;
  flood: HazardDetail;
  caveats: string[];
  rainfall_used: {
    rainfall_24hr_mm: number;
    rainfall_3day_mm: number | null;
    rainfall_7day_mm: number | null;
  };
  rainfall_source: string;
}

const LOCATIONS = [
  { name: "Guwahati", state: "Assam", latitude: 26.14, longitude: 91.73 },
  { name: "Silchar", state: "Assam", latitude: 24.82, longitude: 92.8 },
  { name: "Dhubri", state: "Assam", latitude: 26.02, longitude: 89.98 },
  { name: "Dibrugarh", state: "Assam", latitude: 27.47, longitude: 94.91 },
  { name: "Shillong", state: "Meghalaya", latitude: 25.57, longitude: 91.88 },
  { name: "Cherrapunji", state: "Meghalaya", latitude: 25.3, longitude: 91.7 },
  { name: "Kohima", state: "Nagaland", latitude: 25.67, longitude: 94.11 },
  { name: "Imphal", state: "Manipur", latitude: 24.81, longitude: 93.94 },
  { name: "Aizawl", state: "Mizoram", latitude: 23.73, longitude: 92.72 },
  { name: "Agartala", state: "Tripura", latitude: 23.83, longitude: 91.28 },
  { name: "Gangtok", state: "Sikkim", latitude: 27.33, longitude: 88.61 },
  {
    name: "Itanagar",
    state: "Arunachal Pradesh",
    latitude: 27.1,
    longitude: 93.62,
  },
];

function toneFor(level: string): "good" | "warn" | "bad" {
  const value = (level ?? "").toLowerCase();
  if (value === "high" || value === "critical") return "bad";
  if (value === "moderate") return "warn";
  return "good";
}

function pct(value: number | undefined): string {
  return value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

function DisruptionPredictorPage() {
  const [locationName, setLocationName] = useState(LOCATIONS[0].name);
  const [assetType, setAssetType] = useState("road");
  const [manualRainfall, setManualRainfall] = useState("");

  const [result, setResult] = useState<DisruptionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handlePredict() {
    const location = LOCATIONS.find((entry) => entry.name === locationName);
    if (!location) return;

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const body: Record<string, unknown> = {
        latitude: location.latitude,
        longitude: location.longitude,
        state: location.state,
        asset_type: assetType,
      };

      // Only send rainfall if the operator typed one. Leaving it out is what
      // tells the backend to fetch live figures for all three windows.
      const trimmed = manualRainfall.trim();
      if (trimmed !== "") {
        const parsed = Number(trimmed);
        if (Number.isNaN(parsed) || parsed < 0) {
          throw new Error("Rainfall must be a number of millimetres, or blank.");
        }
        body.rainfall_24hr_mm = parsed;
      }

      const data = await apiFetch<DisruptionResult>(
        "/api/ml/predict-disruption",
        { method: "POST", body: JSON.stringify(body) },
      );
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prediction failed.");
    } finally {
      setLoading(false);
    }
  }

  const rainfallChart = result
    ? [
        { name: "24 hour", mm: result.rainfall_used.rainfall_24hr_mm ?? 0 },
        { name: "3 day", mm: result.rainfall_used.rainfall_3day_mm ?? 0 },
        { name: "7 day", mm: result.rainfall_used.rainfall_7day_mm ?? 0 },
      ]
    : [];

  const hazardChart = result
    ? [
        {
          name: "Landslide",
          raw: (result.landslide.risk_score_raw_model ?? 0) * 100,
          adjusted:
            (result.landslide.terrain_adjusted_risk_score ??
              result.landslide.risk_score) * 100,
          fill: "#f97316",
        },
        {
          name: "Flood",
          raw: (result.flood.risk_score_raw_model ?? 0) * 100,
          adjusted:
            (result.flood.terrain_adjusted_risk_score ??
              result.flood.risk_score) * 100,
          fill: "#3b82f6",
        },
      ]
    : [];

  return (
    <section className="content">
      <div className="page-heading">
        <div>
          <h2>Disruption Predictor</h2>
          <p>
            Combined landslide and flood forecasting for a point on the
            network, from the trained hazard models.
          </p>
        </div>
        <div className="status">
          <span />
          {result
            ? `${result.rainfall_source === "live" ? "LIVE" : "MANUAL"} RAINFALL`
            : "READY"}
        </div>
      </div>

      {/* INPUTS */}
      <div className="route-request-card">
        <div className="route-request-header">
          <div>
            <h3>Run a Prediction</h3>
            <p>
              Leave rainfall blank to pull live 24-hour, 3-day and 7-day
              figures from Open-Meteo. The flood model is trained on all three
              windows, so a manual 24-hour figure alone gives a weaker result
              and the response will say so.
            </p>
          </div>
        </div>

        <div className="route-form">
          <div className="route-input-group">
            <label>Location</label>
            <select
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
            >
              {LOCATIONS.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name}, {entry.state}
                </option>
              ))}
            </select>
          </div>

          <div className="route-input-group">
            <label>Asset Type</label>
            <select
              value={assetType}
              onChange={(e) => setAssetType(e.target.value)}
            >
              <option value="road">Road</option>
              <option value="bridge">Bridge</option>
              <option value="culvert">Culvert</option>
            </select>
          </div>

          <div className="route-input-group">
            <label>Rainfall 24h (mm) — optional</label>
            <input
              type="number"
              min={0}
              placeholder="Live"
              value={manualRainfall}
              onChange={(e) => setManualRainfall(e.target.value)}
            />
          </div>

          <button
            className="plan-route-button"
            onClick={handlePredict}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 size={18} className="spin" />
                Predicting...
              </>
            ) : (
              <>
                <CloudRain size={18} />
                Predict
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="route-error">
          <AlertTriangle size={20} />
          <div>
            <strong>Prediction Error</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {result && (
        <>
          <div className="stats-grid four">
            <StatCard
              label="Combined Risk"
              value={pct(result.combined_risk_score)}
              tone={toneFor(result.risk_level)}
              icon={<AlertTriangle size={16} />}
            />
            <StatCard
              label="Landslide"
              value={pct(
                result.landslide.terrain_adjusted_risk_score ??
                  result.landslide.risk_score,
              )}
              tone={toneFor(result.landslide.risk_level)}
              icon={<Mountain size={16} />}
            />
            <StatCard
              label="Flood"
              value={pct(
                result.flood.terrain_adjusted_risk_score ??
                  result.flood.risk_score,
              )}
              tone={toneFor(result.flood.risk_level)}
              icon={<Waves size={16} />}
            />
            <StatCard
              label="Expected Disruption"
              value={
                result.expected_disruption_hours > 0
                  ? `${result.expected_disruption_hours} h`
                  : "None"
              }
              tone={result.expected_disruption_hours > 24 ? "bad" : "warn"}
              icon={<Clock3 size={16} />}
            />
          </div>

          <div className="recommendation-card">
            <div className="recommendation-icon">
              <AlertTriangle size={22} />
            </div>
            <div>
              <h3>
                {result.risk_level.toUpperCase()} — dominant hazard:{" "}
                {result.dominant_hazard}
              </h3>
              <p>{result.recommended_action}</p>
            </div>
          </div>

          <div className="chart-grid">
            <div className="chart-card">
              <div className="card-header">
                <div>
                  <h3>Rainfall Windows</h3>
                  <p>
                    The three figures actually fed to the flood model (
                    {result.rainfall_source})
                  </p>
                </div>
              </div>
              <div className="chart-body" style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rainfallChart}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#eef1f5"
                      vertical={false}
                    />
                    <XAxis dataKey="name" />
                    <YAxis unit="mm" />
                    <Tooltip formatter={(v) => `${Number(v ?? 0)} mm`} />
                    <Bar dataKey="mm" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="chart-card">
              <div className="card-header">
                <div>
                  <h3>Raw Model vs Terrain-Adjusted</h3>
                  <p>
                    Why the headline number differs from each model on its own
                  </p>
                </div>
              </div>
              <div className="chart-body" style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hazardChart}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#eef1f5"
                      vertical={false}
                    />
                    <XAxis dataKey="name" />
                    <YAxis unit="%" domain={[0, 100]} />
                    <Tooltip
                      formatter={(v) => `${Number(v ?? 0).toFixed(1)}%`}
                    />
                    <Bar
                      dataKey="raw"
                      name="Raw model"
                      fill="#cbd5e1"
                      radius={[6, 6, 0, 0]}
                    />
                    <Bar
                      dataKey="adjusted"
                      name="Terrain-adjusted"
                      radius={[6, 6, 0, 0]}
                    >
                      {hazardChart.map((entry) => (
                        <Cell key={entry.name} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Raw Output</th>
                  <th>Terrain-Adjusted</th>
                  <th>Level</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>Landslide</strong>
                  </td>
                  <td>{pct(result.landslide.risk_score_raw_model)}</td>
                  <td>{pct(result.landslide.terrain_adjusted_risk_score)}</td>
                  <td>
                    <span
                      className={`risk-pill ${toneFor(result.landslide.risk_level) === "bad" ? "high" : "moderate"}`}
                    >
                      {result.landslide.risk_level}
                    </span>
                  </td>
                  <td className="td-sub">
                    State used: {result.landslide.state_used ?? "—"} · slope
                    proxy {result.landslide.slope_proxy ?? "—"}
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Flood</strong>
                  </td>
                  <td>{pct(result.flood.risk_score_raw_model)}</td>
                  <td>{pct(result.flood.terrain_adjusted_risk_score)}</td>
                  <td>
                    <span
                      className={`risk-pill ${toneFor(result.flood.risk_level) === "bad" ? "high" : "moderate"}`}
                    >
                      {result.flood.risk_level}
                    </span>
                  </td>
                  <td className="td-sub">
                    {result.flood.model ?? "—"} · terrain exposure{" "}
                    {result.flood.terrain_exposure ?? "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {result.caveats.length > 0 && (
            <div className="considered-incidents">
              <div className="section-title">
                <div>
                  <h3>What would make this score wrong</h3>
                  <p>Reported by the model for this specific request.</p>
                </div>
                <span>{result.caveats.length}</span>
              </div>

              <div className="incident-grid">
                {result.caveats.map((caveat) => (
                  <div className="considered-incident" key={caveat}>
                    <Info size={18} />
                    <div>
                      <span>{caveat}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: "good" | "warn" | "bad";
  icon: React.ReactNode;
}) {
  return (
    <div className="stat-card mini">
      <div className={`stat-mini-icon ${tone}`}>{icon}</div>
      <div>
        <span className="stat-title">{label}</span>
        <strong className="stat-value">{value}</strong>
      </div>
    </div>
  );
}

export default DisruptionPredictorPage;
