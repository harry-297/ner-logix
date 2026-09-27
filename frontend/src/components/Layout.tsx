import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Map,
  Route,
  Truck,
  TriangleAlert,
  Bell,
  ChartNoAxesCombined,
  Settings,
  Search,
  Languages,
  Wifi,
  Satellite,
  CloudRain,
  ShieldAlert,
  Siren,
  PanelLeftClose,
  PanelLeftOpen,
  UserCog,
  ClipboardCheck,
  MessageSquareText,
  type LucideIcon,
} from "lucide-react";

import { MIN_ROLE, hasRole, type AppPath } from "../lib/access";
import { ROLE_LABELS } from "../services/authService";
import { useAppStore } from "../store/appStore";

interface NavItem {
  to: AppPath;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const primaryNav: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/live-map", label: "Live Map", icon: Map },
  { to: "/routes", label: "Routes", icon: Route },
  { to: "/vehicles", label: "Vehicles", icon: Truck },
  { to: "/incidents", label: "Incidents", icon: TriangleAlert },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/analytics", label: "Analytics", icon: ChartNoAxesCombined },
  { to: "/disruption-predictor", label: "Disruption Predictor", icon: CloudRain },
  { to: "/field-intelligence", label: "Field Intelligence", icon: ShieldAlert },
  { to: "/feedback", label: "Feedback", icon: MessageSquareText },
  { to: "/emergency-mode", label: "Emergency Mode", icon: Siren },
];

// Field Officer and above: reviewing what Users submit through the pages above.
const reviewNav: NavItem[] = [
  { to: "/field-reports-review", label: "Field Report Review", icon: ClipboardCheck },
  { to: "/feedback-review", label: "Feedback Review", icon: MessageSquareText },
];

const adminNav: NavItem[] = [
  { to: "/manage-users", label: "Manage Users", icon: UserCog },
];

function Layout() {
  const { language, setLanguage, connectivity, emergencyMode, notifications, user } = useAppStore();
  const [query, setQuery] = useState("");
  const [isNavigating, setIsNavigating] = useState(false);
  // Starts collapsed on every load/navigation; the user can still pin it open
  // with the sidebar-toggle button, but that choice isn't remembered across
  // reloads on purpose -- a fresh page load always opens with the sidebar closed.
  const [isSidebarHidden, setIsSidebarHidden] = useState(true);
  const navigationTimeout = useRef<number | null>(null);

  // Only show what this role can open. The routes are guarded too (App.tsx);
  // hiding a link is presentation, the guard is what blocks the page.
  const canOpen = (item: NavItem) => hasRole(user?.role, MIN_ROLE[item.to]);
  const visibleNav = primaryNav.filter(canOpen);
  const visibleReviewNav = reviewNav.filter(canOpen);
  const visibleAdminNav = adminNav.filter(canOpen);

  useEffect(() => {
    return () => {
      if (navigationTimeout.current !== null) {
        window.clearTimeout(navigationTimeout.current);
      }
    };
  }, []);

  const handleNavigation = () => {
    if (navigationTimeout.current !== null) {
      window.clearTimeout(navigationTimeout.current);
    }

    setIsNavigating(true);
    navigationTimeout.current = window.setTimeout(() => {
      setIsNavigating(false);
      navigationTimeout.current = null;
    }, 1000);
  };

  const searchHint = useMemo(() => {
    if (!query.trim()) {
      return "Search districts, roads, vehicles...";
    }

    return `Search results for “${query.trim()}”`;
  }, [query]);

  return (
    <div className={`app ${isSidebarHidden ? "sidebar-hidden" : ""}`}>
      {isNavigating && (
        <div className="route-loader" role="status" aria-live="polite" aria-label="Loading NER-LOGIX">
          <div className="route-loader-mark">N</div>
          <strong>NER-LOGIX</strong>
          <span>Logistics Intelligence</span>
          <div className="route-loader-bar" aria-hidden="true"><i /></div>
        </div>
      )}

      <aside className="sidebar">
        <div className="logo">
          <div className="logo-mark">N</div>
          <div>
            <h1>NER-LOGIX</h1>
            <span>Logistics Intelligence</span>
          </div>
        </div>

        <div className="nav-label">Operations</div>

        <nav className="navigation">
          {visibleNav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={handleNavigation}
              className={({ isActive }: { isActive: boolean }) => `nav-item ${isActive ? "active" : ""}`}
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        {visibleReviewNav.length > 0 && (
          <>
            <div className="nav-label">Review Queue</div>
            <nav className="navigation">
              {visibleReviewNav.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={handleNavigation}
                  className={({ isActive }: { isActive: boolean }) => `nav-item ${isActive ? "active" : ""}`}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </nav>
          </>
        )}

        {visibleAdminNav.length > 0 && (
          <>
            <div className="nav-label">Administration</div>
            <nav className="navigation">
              {visibleAdminNav.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={handleNavigation}
                  className={({ isActive }: { isActive: boolean }) => `nav-item ${isActive ? "active" : ""}`}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </nav>
          </>
        )}

        <div className="sidebar-bottom">
          <nav className="navigation">
            <NavLink
              to="/settings"
              onClick={handleNavigation}
              className={({ isActive }: { isActive: boolean }) => `nav-item ${isActive ? "active" : ""}`}
            >
              <Settings size={18} />
              <span>Settings</span>
            </NavLink>
          </nav>

          <div className="sidebar-footnote">
            <Satellite size={12} />
            <span>Region: North East India</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-start">
            <button
              className="sidebar-toggle"
              type="button"
              onClick={() => setIsSidebarHidden((hidden) => !hidden)}
              aria-label={isSidebarHidden ? "Show sidebar" : "Hide sidebar"}
              title={isSidebarHidden ? "Show sidebar" : "Hide sidebar"}
              aria-expanded={!isSidebarHidden}
            >
              {isSidebarHidden ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>

            <div className="search">
              <Search size={16} />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchHint}
              />
            </div>
          </div>

          <div className="topbar-right">
            <div className="sync-indicator">
              <Wifi size={14} />
              {connectivity === "OFFLINE" ? "Offline · Queue pending" : "Online · Synced 12s ago"}
            </div>

            <div className="language-switcher topbar-lang">
              <Languages size={14} />
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option>English</option>
                <option>Hindi</option>
                <option>Assamese</option>
                <option>Nepali</option>
              </select>
            </div>

            <button className="notification" title="Notifications">
              <Bell size={18} />
              {notifications > 0 && <span className="notification-dot"></span>}
            </button>

            <NavLink
              to="/profile"
              className="profile"
              onClick={handleNavigation}
              title="View profile and sign out"
            >
              <div className="avatar">{user?.avatar ?? "?"}</div>
              <div>
                <strong>{user?.name ?? "Signed out"}</strong>
                <span>{emergencyMode ? "Emergency ops" : user ? ROLE_LABELS[user.role] : "Not signed in"}</span>
              </div>
            </NavLink>
          </div>
        </header>

        <Outlet />
      </main>
    </div>
  );
}

export default Layout;
