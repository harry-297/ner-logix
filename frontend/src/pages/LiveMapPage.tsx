import NERMap from "../components/NERMap";
import "./routes-page.css";

function LiveMapPage() {
  return (
    <section className="content">
      <div className="page-heading">
        <div>
          <h2>Live Map</h2>
          <p>Real-time regional transportation accessibility across the North Eastern Region.</p>
        </div>

        <div className="status">
          <span></span>
          Live
        </div>
      </div>

      <div className="simple-page-content">
        <div style={{ height: "calc(100vh - 230px)", minHeight: 480 }}>
          <NERMap />
        </div>
      </div>
    </section>
  );
}

export default LiveMapPage;
