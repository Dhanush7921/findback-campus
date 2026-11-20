import { lazy, Suspense } from 'react';
import { BrowserRouter, HashRouter, Route, Routes } from 'react-router';
import Layout from './components/Layout';
import { ToastProvider } from './components/toast';
import { PageSkeleton } from './components/ui';
import { ConfigProvider } from './lib/config';
import { IS_NATIVE } from './lib/env';
import { I18nProvider } from './lib/i18n';
import Home from './pages/public/Home';

const HowItWorks = lazy(() => import('./pages/public/HowItWorks'));
const Report = lazy(() => import('./pages/public/Report'));
const Success = lazy(() => import('./pages/public/Success'));
const Track = lazy(() => import('./pages/public/Track'));
const Help = lazy(() => import('./pages/public/Help'));
const Privacy = lazy(() => import('./pages/public/Privacy'));
const NotFound = lazy(() => import('./pages/public/NotFound'));
const PhoneAccess = lazy(() => import('./pages/public/PhoneAccess'));
const ReporterDashboard = lazy(() => import('./pages/reporter/Dashboard'));
const ReporterComplaint = lazy(() => import('./pages/reporter/Complaint'));

const PortalLayout = lazy(() => import('./pages/portal/PortalLayout'));
const PortalOverview = lazy(() => import('./pages/portal/Overview'));
const PortalDetails = lazy(() => import('./pages/portal/Details'));
const PortalTimeline = lazy(() => import('./pages/portal/Timeline'));
const PortalMatches = lazy(() => import('./pages/portal/Matches'));
const PortalClaim = lazy(() => import('./pages/portal/Claim'));
const PortalNotifications = lazy(() => import('./pages/portal/Notifications'));
const PortalUpdate = lazy(() => import('./pages/portal/Update'));
const PortalCollection = lazy(() => import('./pages/portal/Collection'));

const StaffLayout = lazy(() => import('./pages/staff/StaffLayout'));
const StaffDashboard = lazy(() => import('./pages/staff/Dashboard'));
const StaffRegister = lazy(() => import('./pages/staff/RegisterItem'));
const StaffInventory = lazy(() => import('./pages/staff/Inventory'));
const StaffItem = lazy(() => import('./pages/staff/ItemDetail'));
const StaffComplaints = lazy(() => import('./pages/staff/Complaints'));
const StaffComplaint = lazy(() => import('./pages/staff/ComplaintDetail'));
const StaffMatching = lazy(() => import('./pages/staff/Matching'));
const StaffClaims = lazy(() => import('./pages/staff/Claims'));
const StaffHandovers = lazy(() => import('./pages/staff/Handovers'));
const StaffUnclaimed = lazy(() => import('./pages/staff/Unclaimed'));
const StaffActivity = lazy(() => import('./pages/staff/Activity'));
const StaffAnalytics = lazy(() => import('./pages/staff/Analytics'));
const StaffSettings = lazy(() => import('./pages/staff/Settings'));
const ManagementLayout = lazy(() => import('./pages/management/ManagementLayout'));
const ManagementPage = lazy(() => import('./pages/management/ManagementPage'));

// Native apps load from a local origin, where hash routing avoids server rewrites.
const Router = IS_NATIVE ? HashRouter : BrowserRouter;

export default function App() {
  return (
    <I18nProvider>
      <ToastProvider>
        <ConfigProvider>
          <Router basename={IS_NATIVE ? undefined : import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
            <Suspense fallback={<PageSkeleton />}>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<Home />} />
                  <Route path="how-it-works" element={<HowItWorks />} />
                  <Route path="report" element={<Report />} />
                  <Route path="report/success" element={<Success />} />
                  <Route path="track" element={<Track />} />
                  <Route path="help" element={<Help />} />
                  <Route path="privacy" element={<Privacy />} />
                  <Route path="access/:mode" element={<PhoneAccess />} />
                  <Route path="dashboard" element={<ReporterDashboard />} />
                  <Route path="dashboard/complaints/:id" element={<ReporterComplaint />} />
                  <Route path="portal" element={<PortalLayout />}>
                    <Route index element={<PortalOverview />} />
                    <Route path="details" element={<PortalDetails />} />
                    <Route path="timeline" element={<PortalTimeline />} />
                    <Route path="matches" element={<PortalMatches />} />
                    <Route path="matches/:itemId/claim" element={<PortalClaim />} />
                    <Route path="updates" element={<PortalNotifications />} />
                    <Route path="edit" element={<PortalUpdate />} />
                    <Route path="collection" element={<PortalCollection />} />
                  </Route>
                  <Route path="*" element={<NotFound />} />
                </Route>
                <Route path="staff" element={<StaffLayout />}>
                  <Route index element={<StaffDashboard />} />
                  <Route path="register" element={<StaffRegister />} />
                  <Route path="inventory" element={<StaffInventory />} />
                  <Route path="inventory/:id" element={<StaffItem />} />
                  <Route path="complaints" element={<StaffComplaints />} />
                  <Route path="complaints/:id" element={<StaffComplaint />} />
                  <Route path="matching" element={<StaffMatching />} />
                  <Route path="claims" element={<StaffClaims />} />
                  <Route path="handovers" element={<StaffHandovers />} />
                  <Route path="unclaimed" element={<StaffUnclaimed />} />
                  <Route path="activity" element={<StaffActivity />} />
                  <Route path="analytics" element={<StaffAnalytics />} />
                  <Route path="settings" element={<StaffSettings />} />
                </Route>
                <Route path="management" element={<ManagementLayout />}>
                  <Route index element={<ManagementPage />} />
                  <Route path="analytics" element={<ManagementPage />} />
                  <Route path="hotspots" element={<ManagementPage />} />
                  <Route path="audit" element={<ManagementPage />} />
                  <Route path="policies" element={<ManagementPage />} />
                </Route>
              </Routes>
            </Suspense>
          </Router>
        </ConfigProvider>
      </ToastProvider>
    </I18nProvider>
  );
}
