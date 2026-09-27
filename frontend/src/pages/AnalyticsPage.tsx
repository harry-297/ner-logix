import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ShieldAlert, TrendingDown, TrendingUp, Siren, RouteOff } from "lucide-react";
import {
  districtConnectivity,
  disruptionTrend,
  cargoDistribution,
  corridorRiskMatrix,
  avgDeliveryDelay,
  emergencyRoutes,
} from "../data/mockData";

function AnalyticsPage() {
  return (
    <section className="content">
      <div className="page-heading">
        <div>
          <h2>Logistics &amp; Accessibility Analytics</h2>
          <p>
            Region-wide connectivity, bottleneck and delivery-performance
            intelligence for planning and monitoring.
          </p>
        </div>
        <div className="status">
          <span></span>
          Updated live
        </div>
      </div>

      <div className="stats-grid four">
        <div className="stat-card mini">
          <div className="stat-mini-icon good"><TrendingUp size={16} /></div>
          <div>
            <span className="stat-title">Network Accessibility</span>
            <strong className="stat-value">78.4%</strong>
          </div>
        </div>
        <div className="stat-card mini">
          <div className="stat-mini-icon warn"><ShieldAlert size={16} /></div>
          <div>
            <span className="stat-title">High-Risk Corridors</span>
            <strong className="stat-value">87</strong>
          </div>
        </div>
        <div className="stat-card mini">
          <div className="stat-mini-icon warn"><TrendingDown size={16} /></div>
          <div>
            <span className="stat-title">Avg. Delivery Delay</span>
            <strong className="stat-value">67 min</strong>
          </div>
        </div>
        <div className="stat-card mini">
          <div className="stat-mini-icon neutral"><Siren size={16} /></div>
          <div>
            <span className="stat-title">Emergency Routes Active</span>
            <strong className="stat-value">3 / 4</strong>
          </div>
        </div>
      </div>

      <div className="chart-grid two">
        <div className="chart-card">
          <div className="card-header">
            <div>
              <h3>District-wise Connectivity Status</h3>
              <p>Accessible vs. caution vs. blocked road share, by state</p>
            </div>
          </div>
          <div className="chart-body">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={districtConnectivity} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef1f5" vertical={false} />
                <XAxis dataKey="state" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={55} />
                <YAxis tick={{ fontSize: 11 }} unit="%" />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="accessible" stackId="a" fill="#22c55e" name="Accessible" radius={[0, 0, 0, 0]} />
                <Bar dataKey="caution" stackId="a" fill="#f5a623" name="Caution" />
                <Bar dataKey="blocked" stackId="a" fill="#e5484d" name="Blocked" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card">
          <div className="card-header">
            <div>
              <h3>Essential Cargo Distribution</h3>
              <p>Share of tracked consignments by commodity type</p>
            </div>
          </div>
          <div className="chart-body">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={cargoDistribution}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={62}
                  outerRadius={95}
                  paddingAngle={3}
                >
                  {cargoDistribution.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} layout="vertical" verticalAlign="middle" align="right" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="chart-grid two">
        <div className="chart-card">
          <div className="card-header">
            <div>
              <h3>Disruption &amp; Resolution Trend</h3>
              <p>Daily reported disruptions vs. resolved incidents (7 days)</p>
            </div>
          </div>
          <div className="chart-body">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={disruptionTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef1f5" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="disruptions" stroke="#e5484d" strokeWidth={2.5} name="New Disruptions" dot={{ r: 3 }} />
                <Line type="monotone" dataKey="resolved" stroke="#22c55e" strokeWidth={2.5} name="Resolved" dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card">
          <div className="card-header">
            <div>
              <h3>Average Delivery Delay</h3>
              <p>Monthly trend across all essential-cargo corridors (minutes)</p>
            </div>
          </div>
          <div className="chart-body">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={avgDeliveryDelay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef1f5" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="m" />
                <Tooltip />
                <Bar dataKey="delayMin" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Avg. Delay (min)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="table-card">
        <div className="card-header">
          <div>
            <h3>Corridor Risk Matrix</h3>
            <p>Number of monitored corridors by state and risk level</p>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>State</th>
              <th>Low</th>
              <th>Moderate</th>
              <th>High</th>
              <th>Critical</th>
            </tr>
          </thead>
          <tbody>
            {corridorRiskMatrix.map((row) => (
              <tr key={row.state}>
                <td><strong>{row.state}</strong></td>
                <td><span className="risk-pill low">{row.low}</span></td>
                <td><span className="risk-pill moderate">{row.moderate}</span></td>
                <td><span className="risk-pill high">{row.high}</span></td>
                <td><span className="risk-pill critical">{row.critical}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-card">
        <div className="card-header">
          <div>
            <h3><RouteOff size={16} style={{ marginRight: 6, verticalAlign: -3 }} />Emergency &amp; Disaster-Time Accessibility Routes</h3>
            <p>Designated corridors for evacuation, relief and priority medical transport</p>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Route</th>
              <th>Purpose</th>
              <th>Linked Districts</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {emergencyRoutes.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.name}</strong></td>
                <td>{r.purpose}</td>
                <td>{r.linkedDistricts}</td>
                <td>
                  <span
                    className={`status-pill ${
                      r.status === "Open" ? "active" : r.status === "Closed" ? "resolved" : "under-verification"
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default AnalyticsPage;
