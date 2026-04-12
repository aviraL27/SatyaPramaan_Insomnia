import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom"
import { GlobalWorkerOptions, getDocument } from "@pdfjs"
import QRCode from "qrcode"
import "./App.css"
import { AuthProvider, useAuth } from "./contexts/AuthContext"
import {
  APP_NAME,
  LanguageProvider,
  PAGE_TITLES,
  ThemeProvider,
  useLanguage,
  useTheme,
} from "./contexts/UiContext"
import { API_BASE_URL, api } from "./lib/api"
import landingShowcase from "./assets/banner.ef7bed301849ae15fcd2 copy.png"
import authShowcase from "./assets/login copy.jpg"

GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"

const NAV_ITEMS = [
  { label: "Dashboard", path: "/app/dashboard" },
  { label: "Issue Document", path: "/app/issue-document" },
  { label: "Documents", path: "/app/documents" },
  { label: "Verification Activity", path: "/app/verification-activity" },
  { label: "Audit Logs", path: "/app/audit-logs" },
  { label: "Trust Score", path: "/app/trust-score" },
  { label: "Institution Profile", path: "/app/profile" },
]

const VERIFY_RESULT_STORAGE_KEY = "digisecure_last_verification_result"
const DASHBOARD_DEMO_VIDEO_URL = "https://www.youtube.com/embed/G1gHbNcAPPE?si=oN5ZzKFnQWyLWEni"
let lastUploadedVerificationFile = null

function buildResultUrl({ jobId = null, attemptId = null, resultToken = null } = {}) {
  const params = new URLSearchParams()

  if (jobId) params.set("jobId", jobId)
  if (attemptId) params.set("attemptId", attemptId)
  if (resultToken) params.set("resultToken", resultToken)

  const query = params.toString()
  return query ? `/result?${query}` : "/result"
}

function saveVerificationResultSnapshot(payload) {
  if (typeof window === "undefined" || !payload) return

  try {
    window.sessionStorage.setItem(
      VERIFY_RESULT_STORAGE_KEY,
      JSON.stringify({ payload, savedAt: Date.now() })
    )
  } catch {
    // Ignore storage failures in private mode/quota-limited contexts.
  }
}

function loadVerificationResultSnapshot() {
  if (typeof window === "undefined") return null

  try {
    const raw = window.sessionStorage.getItem(VERIFY_RESULT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.payload || null
  } catch {
    return null
  }
}

function extractJsonObjectSegments(input) {
  if (typeof input !== "string") return []

  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  const segments = []

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === "{") {
      if (depth === 0) {
        start = index
      }
      depth += 1
      continue
    }

    if (char === "}") {
      if (depth > 0) {
        depth -= 1
        if (depth === 0 && start >= 0) {
          segments.push(input.slice(start, index + 1))
          start = -1
        }
      }
    }
  }

  return segments
}

function isLikelyQrPayload(value) {
  if (!value || typeof value !== "object") return false

  const requiredFields = ["documentId", "tenantId", "signatureId", "contentHash", "verificationToken", "issuedAt", "qrSignature"]
  return requiredFields.every((field) => {
    const raw = value[field]
    return typeof raw === "string" && raw.trim().length > 0
  })
}

function normalizePotentialQrEnvelope(value) {
  if (!value || typeof value !== "object") {
    return value
  }

  if (value.payload && typeof value.payload === "object") {
    return value.payload
  }

  if (value.data && typeof value.data === "object") {
    return value.data
  }

  return value
}

function parseQrPayloadText(rawValue) {
  const input = String(rawValue || "").trim()

  if (!input) {
    throw new Error("QR payload is required")
  }

  const candidates = [input]

  if (input.length % 2 === 0) {
    const midpoint = input.length / 2
    const firstHalf = input.slice(0, midpoint)
    const secondHalf = input.slice(midpoint)

    if (firstHalf === secondHalf) {
      candidates.push(firstHalf)
    }
  }

  const objectSegments = extractJsonObjectSegments(input)
  for (const segment of objectSegments) {
    if (segment && segment !== input) {
      candidates.push(segment)
    }
  }

  let latestParsedPayload = null
  let latestValidQrPayload = null

  for (const candidate of candidates) {
    try {
      let parsed = JSON.parse(candidate)

      for (let unwrap = 0; unwrap < 2; unwrap += 1) {
        if (typeof parsed === "string") {
          parsed = JSON.parse(parsed)
        }
      }

      const normalized = normalizePotentialQrEnvelope(parsed)

      if (normalized && typeof normalized === "object") {
        latestParsedPayload = normalized

        if (isLikelyQrPayload(normalized)) {
          latestValidQrPayload = normalized
        }
      }
    } catch {
      // Try next candidate.
    }
  }

  if (latestValidQrPayload) {
    return latestValidQrPayload
  }

  if (latestParsedPayload) {
    return latestParsedPayload
  }

  throw new Error("QR payload must be valid JSON")
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new window.Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("Could not load preview QR overlay"))
    image.src = src
  })
}

function mapAttemptToResultPayload(attempt) {
  if (!attempt) return null

  const normalizedStatus = String(attempt.resultStatus || "").toLowerCase()
  const includeTamperFindings = normalizedStatus === "tampered" || normalizedStatus === "suspicious"

  const detectors = attempt?.contentComparison?.detectors || attempt?.tamperFindings?.detectors || {
    textLayerChanged: false,
    ocrLayerChanged: false,
    visualLayerChanged: false,
  }

  const ocrDiffSummary = attempt?.tamperFindings?.ocrDiffSummary || {
    changedWordCount: 0,
    changedPages: [],
    confidence: null,
  }

  const visualDiffScoreByPage = attempt?.tamperFindings?.visualDiffScoreByPage || []

  return {
    attempt,
    result: {
      status: attempt.resultStatus || "pending",
      reasonCode: attempt.resultReasonCode || "-",
      reason: attempt.resultMessage || "Verification result loaded from attempt record",
      documentId: attempt.documentId || "-",
      trustScore: null,
      detectors,
      visualDiffScoreByPage,
      ocrDiffSummary,
      tamperFindings: includeTamperFindings ? (attempt.tamperFindings || null) : null,
    },
  }
}

function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <LanguageProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<PublicLayout />}>
                <Route path="/" element={<LandingPage />} />
                <Route path="/auth" element={<AuthPage />} />
                <Route path="/verify" element={<PublicVerificationPage />} />
                <Route path="/result" element={<VerificationResultPage />} />
              </Route>

              <Route element={<RequireAuth />}>
                <Route path="/app" element={<InstitutionLayout />}>
                  <Route index element={<Navigate to="dashboard" replace />} />
                  <Route path="dashboard" element={<DashboardPage />} />
                  <Route path="issue-document" element={<IssueDocumentPage />} />
                  <Route path="documents" element={<DocumentsPage />} />
                  <Route path="documents/:documentId" element={<DocumentDetailPage />} />
                  <Route path="verification-activity" element={<VerificationActivityPage />} />
                  <Route path="audit-logs" element={<AuditLogPage />} />
                  <Route path="trust-score" element={<TrustScorePage />} />
                  <Route path="profile" element={<ProfilePage />} />
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </LanguageProvider>
      </ThemeProvider>
    </AuthProvider>
  )
}

function RequireAuth() {
  const { isAuthenticated, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <PageLoading />
  }

  if (!isAuthenticated) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`)
    return <Navigate to={`/auth?mode=signin&next=${next}`} replace />
  }

  return <Outlet />
}

function PublicLayout() {
  const location = useLocation()
  const { t } = useLanguage()
  const isLandingPage = location.pathname === "/"

  return (
    <div className="public-shell">
      {isLandingPage ? null : (
        <header className="public-header minimal-header">
          <Link to="/app/dashboard" className="brand-mark header-brand" aria-label={t("SatyaPramaan dashboard")}>
            <span>{APP_NAME}</span>
          </Link>
        </header>
      )}
      <main className={isLandingPage ? "public-main landing-main" : "public-main"}>
        <Outlet />
      </main>
      <ThemeFloatingToggle />
    </div>
  )
}

function InstitutionLayout() {
  const { profile, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useLanguage()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [globalSearchQuery, setGlobalSearchQuery] = useState("")
  const title =
    t(PAGE_TITLES[location.pathname] || "") ||
    (location.pathname.startsWith("/app/documents/")
      ? t("Document Detail")
      : t("Institution Workspace"))
  const isDashboard = location.pathname === "/app/dashboard"
  const isAuditPage = location.pathname === "/app/audit-logs"
  const isDocumentsPage = location.pathname === "/app/documents"
  const isProfilePage = location.pathname === "/app/profile"
  const isIssueDocumentPage = location.pathname === "/app/issue-document"
  const showTopbarSearch = isDashboard || isDocumentsPage

  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (location.pathname === "/app/documents") {
      const params = new URLSearchParams(location.search)
      setGlobalSearchQuery(params.get("q") || "")
    }
  }, [location.pathname, location.search])

  async function handleLogout() {
    navigate("/", { replace: true })
    await logout()
  }

  function handleGlobalSearchSubmit(event) {
    event.preventDefault()
    const query = globalSearchQuery.trim()

    if (!query) {
      navigate("/app/documents")
      return
    }

    const params = new URLSearchParams({ q: query })
    navigate(`/app/documents?${params.toString()}`)
  }

  return (
    <div className="app-shell">
      <aside className={`app-sidebar ${sidebarOpen ? "open" : ""}`.trim()}>
        <div className="sidebar-top">
          <Link to="/app/dashboard" className="brand-mark header-brand" aria-label={t("SatyaPramaan dashboard")}>
            <span>{APP_NAME}</span>
          </Link>
        </div>

        <nav className="sidebar-nav" aria-label={t("Institution navigation")}>
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.path} to={item.path} className={({ isActive }) => (isActive ? "sidebar-link active" : "sidebar-link")}>
              {t(item.label)}
            </NavLink>
          ))}
        </nav>
      </aside>

      {sidebarOpen ? (
        <button
          className="sidebar-overlay"
          aria-label={t("Close navigation")}
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <div className={`app-main-area ${isDashboard ? "dashboard-main-area" : ""} ${isProfilePage ? "profile-main-area" : ""} ${isAuditPage ? "audit-main-area" : ""}`.trim()}>
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="menu-toggle"
              onClick={() => setSidebarOpen((open) => !open)}
              aria-label={t("Open navigation")}
            >
              {t("Menu")}
            </button>
            {isDashboard ? (
              <p className="dashboard-welcome-typewriter">{t("Welcome to SatyaPramaan")}</p>
            ) : (
              <h1>{title}</h1>
            )}
          </div>
          <div className="topbar-right">
            {showTopbarSearch ? (
              <form className="search-wrap" role="search" aria-label={t("Search")} onSubmit={handleGlobalSearchSubmit}>
                <input
                  type="search"
                  value={globalSearchQuery}
                  onChange={(event) => setGlobalSearchQuery(event.target.value)}
                  placeholder={t("Search documents, IDs, recipients")}
                />
              </form>
            ) : null}
            {isIssueDocumentPage ? (
              <button className="btn btn-ghost chip-btn issue-verify-btn" onClick={() => navigate("/verify")}>
                {t("Public Verify")}
              </button>
            ) : null}
            <button
              className="logout-icon-btn"
              onClick={handleLogout}
              aria-label={t("Logout")}
              title={t("Logout")}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M3 3.75A1.75 1.75 0 0 1 4.75 2h7A1.75 1.75 0 0 1 13.5 3.75V20.25A1.75 1.75 0 0 1 11.75 22h-7A1.75 1.75 0 0 1 3 20.25V3.75Zm1.75-.25a.25.25 0 0 0-.25.25V20.25c0 .138.112.25.25.25h7a.25.25 0 0 0 .25-.25V3.75a.25.25 0 0 0-.25-.25h-7ZM16.47 7.47a.75.75 0 0 1 1.06 0l3 3a.75.75 0 0 1 0 1.06l-3 3a.75.75 0 1 1-1.06-1.06l1.72-1.72H8.75a.75.75 0 0 1 0-1.5h9.44l-1.72-1.72a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </button>
          </div>
        </header>
        <main className={`workspace-content ${isDashboard ? "dashboard-viewport" : ""} ${isProfilePage ? "profile-viewport" : ""} ${isAuditPage ? "audit-viewport" : ""}`.trim()}>
          <Outlet />
        </main>
      </div>

      <ThemeFloatingToggle />
    </div>
  )
}

function LanguageSwitcher({ compact = false }) {
  const { language, setLanguage, t } = useLanguage()

  return (
    <label className={`lang-switch ${compact ? "compact" : ""}`.trim()}>
      <span>{t("Language")}</span>
      <select value={language} onChange={(event) => setLanguage(event.target.value)}>
        <option value="en">{t("English")}</option>
        <option value="hi">{t("Hindi")}</option>
      </select>
    </label>
  )
}

function ThemeToggleButton({ className = "theme-fab" }) {
  const { theme, toggleTheme } = useTheme()
  const { t } = useLanguage()

  return (
    <button
      type="button"
      className={className}
      onClick={toggleTheme}
      aria-label={theme === "dark" ? t("Switch to Light Mode") : t("Switch to Dark Mode")}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7.2 7.2 0 1 0 9.8 9.8Z" />
      </svg>
    </button>
  )
}

function ThemeFloatingToggle() {
  return (
    <div className="theme-dock">
      <LanguageSwitcher compact />
      <ThemeToggleButton />
    </div>
  )
}

function LandingPage() {
  const { t } = useLanguage()

  return (
    <div className="main-landing neon-landing">
      <section className="landing-crazy-shell">
        <div className="landing-crazy-glow landing-crazy-glow-a" />
        <div className="landing-crazy-glow landing-crazy-glow-b" />

        <div className="landing-crazy-topbar">
          <Link to="/app/dashboard" className="brand-mark landing-brand" aria-label={t("SatyaPramaan dashboard")}>
            <span>{APP_NAME}</span>
          </Link>
        </div>

        <div className="landing-crazy-copy">
          <h1 className="landing-crazy-title">{t("Proof Looks Better Than Promises.")}</h1>
          <p className="landing-crazy-tagline">
            {t("Every issued document carries visible trust, cryptographic certainty, and instant verification.")}
          </p>
          <div className="landing-crazy-actions">
            <Link to="/auth?mode=signin" className="btn btn-primary landing-action-btn">{t("Sign In")}</Link>
            <Link to="/auth?mode=register" className="btn btn-secondary landing-action-btn">{t("Register")}</Link>
          </div>
        </div>

        <figure className="landing-crazy-visual">
          <div className="landing-crazy-orbit" />
          <img
            src={landingShowcase}
            alt={`${APP_NAME} landing preview`}
            className="landing-phone-image"
          />
        </figure>
      </section>
    </div>
  )
}

function AuthPage() {
  const { signIn, signInWithGoogle, registerInstitution, bootstrapExistingUser, isAuthenticated, profile, loading, isFirebaseConfigured } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useLanguage()
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search])
  const initialMode = searchParams.get("mode") === "register" ? "register" : "signin"
  const [mode, setMode] = useState(initialMode)
  const [form, setForm] = useState({
    email: "",
    password: "",
    displayName: "",
    role: "institution_admin",
    institutionName: "",
    institutionCode: "",
    institutionType: "",
  })
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode])

  useEffect(() => {
    if (!loading && isAuthenticated && profile) {
      navigate("/app/dashboard", { replace: true })
    }
  }, [isAuthenticated, loading, navigate, profile])

  async function onSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError("")

    try {
      if (mode === "signin") {
        await signIn({ email: form.email, password: form.password })
      } else {
        await registerInstitution({
          email: form.email,
          password: form.password,
          displayName: form.displayName,
          role: form.role,
          institutionName: form.institutionName,
          institutionCode: form.institutionCode,
          institutionType: form.institutionType,
        })
      }

      const next = searchParams.get("next")
      navigate(next && next.startsWith("/") ? next : "/app/dashboard", { replace: true })
    } catch (submitError) {
      if (submitError?.message?.includes("User not found for Firebase identity")) {
        try {
          await bootstrapExistingUser({
            role: "institution_admin",
            displayName: form.displayName || form.email,
            institutionName: form.institutionName || "Institution",
            institutionCode: form.institutionCode || `inst${Date.now().toString().slice(-5)}`,
            institutionType: form.institutionType || "other",
          })
          navigate("/app/dashboard", { replace: true })
        } catch (bootstrapError) {
          setError(bootstrapError.message || "Could not bootstrap backend profile")
        }
      } else {
        setError(submitError.message || "Authentication failed")
      }
    } finally {
      setBusy(false)
    }
  }

  async function onGoogleAuth() {
    setBusy(true)
    setError("")

    try {
      await signInWithGoogle({
        bootstrapProfile: {
          role: form.role || "institution_admin",
          displayName: form.displayName || form.email || "Institution User",
          institutionName: form.institutionName || "Institution",
          institutionCode: form.institutionCode || `inst${Date.now().toString().slice(-5)}`,
          institutionType: form.institutionType || "other",
        },
      })

      const next = searchParams.get("next")
      navigate(next && next.startsWith("/") ? next : "/app/dashboard", { replace: true })
    } catch (authError) {
      setError(authError.message || "Google sign-in failed")
    } finally {
      setBusy(false)
    }
  }

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const modeTitle =
    mode === "signin"
      ? t("Access your institution workspace")
      : t("Create a trusted institution account")
  const modeSubtitle =
    mode === "signin"
      ? t("Continue to dashboard, issuance, verification, and audit tools.")
      : t("Set up secure issuance roles and start publishing verifiable documents.")

  return (
    <section className="auth-layout card">
      <div className="auth-panel">
        <p className="eyebrow">{t("Secure Access")}</p>
        <h3>{modeTitle}</h3>
        <p className="inline-note">{modeSubtitle}</p>

        <div className="toggle-row">
          <button type="button" className={mode === "signin" ? "toggle-btn active" : "toggle-btn"} onClick={() => setMode("signin")}>{t("Sign In")}</button>
          <button type="button" className={mode === "register" ? "toggle-btn active" : "toggle-btn"} onClick={() => setMode("register")}>{t("Register Institution")}</button>
        </div>

        <form className="form-grid" onSubmit={onSubmit}>
          {!isFirebaseConfigured ? (
            <ErrorState
              title={t("Firebase Config Missing")}
              body={t("Set VITE_FIREBASE_* values in frontend env before using sign-in or registration.")}
            />
          ) : null}

          <label>
            {t("Work Email")}
            <input type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} required />
            <small className="field-help">{t("Use your official institution domain email.")}</small>
          </label>

          <label>
            {t("Password")}
            <input type="password" value={form.password} onChange={(event) => updateField("password", event.target.value)} required minLength={8} />
            <small className="field-help">{t("Minimum 8 characters including one number.")}</small>
          </label>

          {mode === "register" ? (
            <>
              <label>
                {t("Role")}
                <select value={form.role} onChange={(event) => updateField("role", event.target.value)}>
                  <option value="institution_admin">{t("Institution Admin")}</option>
                  <option value="institution_operator">{t("Institution Operator")}</option>
                  <option value="verifier">{t("Verifier")}</option>
                </select>
              </label>
              <label>
                {t("Display Name")}
                <input type="text" value={form.displayName} onChange={(event) => updateField("displayName", event.target.value)} required />
              </label>
              <label>
                {t("Institution Name")}
                <input type="text" value={form.institutionName} onChange={(event) => updateField("institutionName", event.target.value)} required />
              </label>
              <label>
                {t("Institution Code")}
                <input type="text" value={form.institutionCode} onChange={(event) => updateField("institutionCode", event.target.value)} required />
              </label>
              <label>
                {t("Institution Type")}
                <input type="text" value={form.institutionType} onChange={(event) => updateField("institutionType", event.target.value)} />
              </label>
            </>
          ) : null}

          <div className="auth-form-meta">
            <label className="remember-check">
              <input type="checkbox" defaultChecked />
              {t("Keep me signed in")}
            </label>
            <a href="mailto:support@digisecure.local" className="link-inline">
              {t("Need help signing in?")}
            </a>
          </div>

          {error ? <ErrorState title={t("Authentication Error")} body={error} /> : null}

          <button className="google-auth-btn" type="button" onClick={onGoogleAuth} disabled={busy || !isFirebaseConfigured}>
            <span className="google-auth-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="img" aria-hidden="true" focusable="false">
                <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.2.8 3.9 1.4l2.6-2.5C16.9 3.4 14.7 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12S6.8 21.5 12 21.5c6.9 0 9.1-4.8 9.1-7.3 0-.5-.1-.8-.1-1.2H12z" />
                <path fill="#34A853" d="M3.5 7.6l3.2 2.4C7.5 8.3 9.6 6.7 12 6.7c1.9 0 3.2.8 3.9 1.4l2.6-2.5C16.9 4 14.7 3.1 12 3.1 8.4 3.1 5.3 5.1 3.5 7.6z" />
                <path fill="#FBBC05" d="M12 20.9c2.6 0 4.8-.9 6.4-2.4l-3-2.4c-.8.6-1.9 1.1-3.4 1.1-2.4 0-4.5-1.6-5.2-3.8l-3.2 2.5c1.8 3.5 5 5 8.4 5z" />
                <path fill="#4285F4" d="M21.1 12.4c0-.6-.1-1-.2-1.5H12v3h5.1c-.2 1.1-.9 2.6-2.7 3.6l3 2.4c1.8-1.6 2.8-4 2.8-7.5z" />
              </svg>
            </span>
            {busy ? t("Please wait...") : t("Continue with Google")}
          </button>
          <p className="inline-note">{t("Google OAuth uses your Firebase project and auto-creates backend profile if needed.")}</p>

          <div className="auth-divider" role="separator" aria-label={t("or continue with email")}>
            <span>{t("or continue with email")}</span>
          </div>

          <button className="btn btn-primary" type="submit" disabled={busy || !isFirebaseConfigured}>
            {busy ? t("Please wait...") : mode === "signin" ? t("Sign In") : t("Create Account")}
          </button>
        </form>
      </div>

      <aside className="auth-trust auth-photo-panel">
        <img src={authShowcase} alt={`${APP_NAME} onboarding visual`} className="auth-photo-image" />
      </aside>
    </section>
  )
}

function DashboardPage() {
  const { token, profile } = useAuth()
  const { t } = useLanguage()
  const [documents, setDocuments] = useState([])
  const [audit, setAudit] = useState([])
  const [trust, setTrust] = useState(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let mounted = true

    async function load() {
      try {
        const [docsRes, auditRes, trustRes] = await Promise.all([
          api.listDocuments(token),
          api.auditList(token, 8),
          profile?._id ? api.trustScore(profile._id) : Promise.resolve({ data: null }),
        ])

        if (!mounted) return
        setDocuments(docsRes.data || [])
        setAudit(auditRes.data || [])
        setTrust(trustRes.data || null)
      } catch (loadError) {
        if (!mounted) return
        setError(loadError.message || "Could not load dashboard")
      }
    }

    if (token && profile?._id) {
      load()
    }

    return () => {
      mounted = false
    }
  }, [token, profile])

  const hasTrustActivity =
    Number(trust?.metrics?.totalVerifications || 0) > 0 ||
    Number(trust?.metrics?.tamperedDetections || 0) > 0 ||
    Number(trust?.metrics?.revokedDocuments || 0) > 0 ||
    documents.length > 0
  const trustDisplayValue = hasTrustActivity ? trust?.currentScore ?? "-" : "-"
  const verifiedAttempts = (audit || []).filter((entry) => String(entry?.action || "").includes("VERIFIED")).length
  const tamperAlerts = (audit || []).filter((entry) => {
    const action = String(entry?.action || "")
    const payload = String(JSON.stringify(entry?.payload || {})).toLowerCase()
    return action.includes("TAMPER") || payload.includes("tampered")
  }).length
  const summaryName = profile?.institutionName || profile?.displayName || t("Institution Console")
  const highlights = [
    {
      label: t("Documents Issued"),
      value: documents.length,
      meta: t("Live from issuance records"),
      tone: "up",
    },
    {
      label: t("Documents Verified"),
      value: verifiedAttempts,
      meta: t("Live from verification activity"),
      tone: "up",
    },
    {
      label: t("Tamper Alerts"),
      value: tamperAlerts,
      meta: t("Derived from tamper signals"),
      tone: tamperAlerts > 0 ? "down" : "up",
    },
  ]

  return (
    <div className="page-stack dashboard-page dashboard-v2">
      <section className="card dashboard-hero">
        <div className="dashboard-hero-copy">
          <p className="eyebrow">{t("Operational Snapshot")}</p>
          <h3>{t("Trust-first operations, minus the noise.")}</h3>
          <p className="inline-note">
            {error || t("Single-view confidence. Deep detail is already available in dedicated pages.")}
          </p>
          <Link className="btn btn-primary" to="/app/issue-document">{t("Issue New Document")}</Link>
        </div>

        <article className="dashboard-hero-score" aria-label={t("Current Trust Score")}>
          <small>{t("Current Trust Score")}</small>
          <strong>{trustDisplayValue}</strong>
          <span>{trust?.scoreBand || t("Band unavailable")}</span>
        </article>
      </section>

      <section className="dashboard-v2-stats">
        {highlights.map((item) => (
          <article key={item.label} className="card dashboard-v2-stat-card">
            <p>{item.label}</p>
            <h3>{item.value}</h3>
            <small className={`kpi-delta ${item.tone}`.trim()}>{item.meta}</small>
          </article>
        ))}
      </section>

      <section className="card dashboard-atmosphere-card">
        <div className="dashboard-atmosphere-copy">
          <h3>{t("Quick Platform Walkthrough")}</h3>
          <p className="inline-note">{t("Watch the demo to learn issuance, verification, and audit flow in under two minutes.")}</p>
          <div className="dashboard-signal-row">
            <span className="signal-chip positive">{t("Start Here")}</span>
            <span className="signal-chip neutral">{t("Issue Flow")}</span>
            <span className="signal-chip positive">{t("Verify + Audit")}</span>
          </div>
          <p className="inline-note">{`${summaryName} ${t("is connected with live issuance, verification, trust, and audit streams.")}`}</p>
        </div>
        <div className="dashboard-atmosphere-visual">
          {DASHBOARD_DEMO_VIDEO_URL ? (
            <iframe
              className="dashboard-demo-player"
              src={DASHBOARD_DEMO_VIDEO_URL}
              title={t("SatyaPramaan Product Demo")}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          ) : (
            <div className="dashboard-demo-placeholder">
              <strong>{t("Video slot is ready")}</strong>
              <small>{t("Share your link and I will wire it to play here.")}</small>
            </div>
          )}
        </div>
      </section>

    </div>
  )
}

function IssueDocumentPage() {
  const { token, profile } = useAuth()
  const { t } = useLanguage()
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    title: "",
    documentType: "certificate",
    recipientName: "",
    recipientReference: "",
    metadata: "{}",
  })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [issuedDocument, setIssuedDocument] = useState(null)
  const [qrCodeImage, setQrCodeImage] = useState("")
  const [pageCount, setPageCount] = useState(null)
  const [previewImage, setPreviewImage] = useState("")
  const [previewError, setPreviewError] = useState("")

  useEffect(() => {
    let active = true

    async function generateQr() {
      if (!issuedDocument?.qrPayload) {
        setQrCodeImage("")
        return
      }

      try {
        const qrText = JSON.stringify(issuedDocument.qrPayload)
        const image = await QRCode.toDataURL(qrText, { width: 220, margin: 1 })
        if (!active) return
        setQrCodeImage(image)
      } catch {
        if (!active) return
        setQrCodeImage("")
      }
    }

    generateQr()

    return () => {
      active = false
    }
  }, [issuedDocument])

  useEffect(() => {
    let active = true

    async function inspectFile() {
      if (!file) {
        setPageCount(null)
        setPreviewImage("")
        setPreviewError("")
        return
      }

      try {
        const previewPayload = {
          mode: "issuance_preview",
          title: form.title || "Draft document",
          documentType: form.documentType || "certificate",
          recipientName: form.recipientName || "Recipient",
          recipientReference: form.recipientReference || null,
          metadataHash: shortHash(String(form.metadata || "{}")),
        }
        const [buffer, previewQr] = await Promise.all([
          file.arrayBuffer(),
          QRCode.toDataURL(JSON.stringify(previewPayload), {
            width: 160,
            margin: 1,
          }),
        ])
        const loadingTask = getDocument({ data: buffer, disableWorker: true })
        const pdf = await loadingTask.promise
        const page = await pdf.getPage(1)
        const viewport = page.getViewport({ scale: 1.1 })
        const canvas = window.document.createElement("canvas")
        const context = canvas.getContext("2d")

        if (!context) {
          throw new Error("Preview canvas is unavailable in this browser")
        }

        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)

        await page.render({ canvasContext: context, viewport }).promise

        const overlay = await loadImageElement(previewQr)
        const qrSize = Math.max(86, Math.round(Math.min(canvas.width, canvas.height) * 0.18))
        const padding = 18
        const labelHeight = 26
        const frameX = canvas.width - qrSize - padding - 8
        const frameY = canvas.height - qrSize - padding - labelHeight - 8

        context.fillStyle = "rgba(255, 255, 255, 0.96)"
        context.fillRect(frameX, frameY, qrSize + 16, qrSize + labelHeight + 16)
        context.strokeStyle = "#1c4a86"
        context.lineWidth = 2
        context.strokeRect(frameX, frameY, qrSize + 16, qrSize + labelHeight + 16)
        context.fillStyle = "#173a6a"
        context.font = "600 12px 'IBM Plex Sans', sans-serif"
        context.fillText("QR + signature", frameX + 8, frameY + 17)
        context.drawImage(overlay, frameX + 8, frameY + labelHeight + 4, qrSize, qrSize)

        if (!active) return
        setPageCount(pdf.numPages || null)
        setPreviewImage(canvas.toDataURL("image/png"))
        setPreviewError("")
        page.cleanup()
        await pdf.destroy()
      } catch (inspectError) {
        if (!active) return
        setPageCount(null)
        setPreviewImage("")
        setPreviewError(inspectError.message || "Could not render the PDF preview")
      }
    }

    inspectFile()

    return () => {
      active = false
    }
  }, [file, form.title, form.documentType, form.recipientName, form.recipientReference, form.metadata])

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError("")
    setMessage("")
    setIssuedDocument(null)

    try {
      if (!file) throw new Error("Please choose a PDF file")

      const formData = new FormData()
      formData.append("file", file)
      formData.append("title", form.title)
      formData.append("documentType", form.documentType)
      formData.append("recipientName", form.recipientName)
      if (form.recipientReference) formData.append("recipientReference", form.recipientReference)
      formData.append("metadata", form.metadata || "{}")

      const response = await api.issueDocument(token, formData)
      setMessage(`Issued document ${response.data.document.documentId}`)
      setIssuedDocument(response.data.document || null)
      setForm({ title: "", documentType: "certificate", recipientName: "", recipientReference: "", metadata: "{}" })
      setFile(null)
      setStep(5)
    } catch (submitError) {
      setError(submitError.message || "Issuance failed")
    } finally {
      setBusy(false)
    }
  }

  async function downloadIssuedPdf() {
    if (!issuedDocument?.documentId) return

    try {
      const response = await fetch(`${API_BASE_URL}/documents/${issuedDocument.documentId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) throw new Error("Download failed")

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = window.document.createElement("a")
      anchor.href = url
      anchor.download = `${issuedDocument.documentId}.pdf`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (downloadError) {
      setError(downloadError.message || "Download failed")
    }
  }

  function resetWizard() {
    setStep(1)
    setMessage("")
    setError("")
    setIssuedDocument(null)
    setFile(null)
    setForm({
      title: "",
      documentType: "certificate",
      recipientName: "",
      recipientReference: "",
      metadata: "{}",
    })
  }

  const steps = [
    t("Document Metadata"),
    t("PDF Upload"),
    t("Verification Setup Review"),
    t("QR Placement + Signature Review"),
    t("Complete"),
  ]

  const metadataHashPreview = shortHash(String(form.metadata || "{}"))

  return (
    <div className="page-stack">
      <section className="card stepper-card">
        <div className="step-track">
          {steps.map((stepName, index) => {
            const stepNumber = index + 1
            const stateClass = stepNumber < step ? "done" : stepNumber === step ? "active" : ""
            return (
              <button key={stepName} className={`step-pill ${stateClass}`.trim()} onClick={() => setStep(stepNumber)}>
                <span>{stepNumber}</span>
                {stepName}
              </button>
            )
          })}
        </div>

        <div className="wizard-grid">
          <article className="wizard-main card soft">
            <form className="form-grid two-col-form" onSubmit={handleSubmit}>
              {step === 1 ? (
                <>
                  <h3>{t("Step 1: Document Metadata")}</h3>
                  <label>
                    {t("Document Title")}
                    <input value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} required />
                  </label>
                  <label>
                    {t("Document Type")}
                    <input value={form.documentType} onChange={(event) => setForm((prev) => ({ ...prev, documentType: event.target.value }))} required />
                  </label>
                  <label>
                    {t("Recipient Name")}
                    <input value={form.recipientName} onChange={(event) => setForm((prev) => ({ ...prev, recipientName: event.target.value }))} required />
                  </label>
                  <label>
                    {t("Recipient Reference ID")}
                    <input value={form.recipientReference} onChange={(event) => setForm((prev) => ({ ...prev, recipientReference: event.target.value }))} />
                  </label>
                  <label className="full-width">
                    {t("Notes / Issuance Metadata")}
                    <textarea rows={4} value={form.metadata} onChange={(event) => setForm((prev) => ({ ...prev, metadata: event.target.value }))} />
                  </label>
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <h3>{t("Step 2: PDF Upload")}</h3>
                  <label className="full-width">
                    {t("PDF File")}
                    <input type="file" accept="application/pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} required />
                  </label>
                  <div className="inline-grid full-width">
                    <article className="soft-panel">
                      <h4>{t("File Details")}</h4>
                      <p>{t("Filename")}: {file?.name || t("No file selected")}</p>
                      <p>{t("Page Count")}: {pageCount ?? "-"}</p>
                    </article>
                    <article className="soft-panel">
                      <h4>{t("Validation Feedback")}</h4>
                      <p>{file ? t("PDF selected and ready for issuance.") : t("Select a PDF to continue.")}</p>
                      <p>{file ? `${t("Size")}: ${Math.round(file.size / 1024)} KB` : t("No file selected")}</p>
                    </article>
                  </div>
                </>
              ) : null}

              {step === 3 ? (
                <>
                  <h3>{t("Step 3: Verification Setup Review")}</h3>
                  <ul className="review-list full-width">
                    <li>{t("Canonical metadata hash preview")}: {metadataHashPreview}</li>
                    <li>{t("Signing fingerprint")}: {t("generated by backend during issuance")}</li>
                    <li>{t("Generated document ID")}: {issuedDocument?.documentId || t("Generated after issue")}</li>
                    <li>{t("Verification token preview")}: {issuedDocument?.verificationToken || issuedDocument?.qrPayload?.verificationToken || t("Generated after issue")}</li>
                  </ul>
                </>
              ) : null}

              {step === 4 ? (
                <>
                  <h3>{t("Step 4: QR Placement + Signature Review")}</h3>
                  <div className="inline-grid full-width">
                    <article className="soft-panel pdf-mini">
                      <p>{t("PDF preview with QR placement")}</p>
                      <div className="mini-page">
                        {previewImage ? (
                          <img className="mini-page-image" src={previewImage} alt={t("PDF preview with QR placement")} />
                        ) : (
                          <div className="mini-qr" />
                        )}
                      </div>
                      <p className="inline-note">
                        {previewError || (file
                          ? t("Preview shows page 1 with the issuance QR/signature block placed on the document.")
                          : t("Upload a PDF to generate the placement preview."))}
                      </p>
                    </article>
                    <article className="soft-panel">
                      <h4>{t("Signature / Hash Summary")}</h4>
                      <p>{t("Signature type")}: {t("backend-configured signing")}</p>
                      <p>{t("Content hash")}: {t("generated on issue")}</p>
                      <p>{t("Metadata hash")}: {metadataHashPreview}</p>
                    </article>
                  </div>
                  <button className={busy ? "btn btn-primary is-loading full-width" : "btn btn-primary full-width"} disabled={busy || !file} aria-busy={busy}>
                    {busy ? (
                      <>
                        <span className="btn-spinner" aria-hidden="true" />
                        <span>{t("Issuing Document...")}</span>
                      </>
                    ) : (
                      t("Issue Document")
                    )}
                  </button>
                </>
              ) : null}

              {step === 5 ? (
                <div className="success-wrap full-width">
                  <h3>{t("Step 5: Complete")}</h3>
                  <p>{issuedDocument ? t("Document issued and signed successfully.") : t("Run issuance to complete this step.")}</p>
                  {issuedDocument ? (
                    <div className="action-row">
                      <button type="button" className="btn btn-primary" onClick={downloadIssuedPdf}>{t("Download Issued PDF")}</button>
                      <button type="button" className="btn btn-secondary" onClick={() => navigator.clipboard.writeText(issuedDocument.documentId || "")}>{t("Copy Document ID")}</button>
                      <button type="button" className="btn btn-secondary" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/verify?documentId=${issuedDocument.documentId}`)}>{t("Copy Verification Link")}</button>
                      <button type="button" className="btn btn-ghost" onClick={resetWizard}>{t("Issue Another Document")}</button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {message ? <Toast message={message} /> : null}
              {error ? <ErrorState title={t("Issuance Error")} body={error} /> : null}

              <div className="wizard-actions full-width">
                <button type="button" className="btn btn-ghost" onClick={() => setStep((value) => Math.max(1, value - 1))}>{t("Previous")}</button>
                <button type="button" className="btn btn-primary" onClick={() => setStep((value) => Math.min(5, value + 1))}>{step === 5 ? t("Done") : t("Next Step")}</button>
              </div>
            </form>
          </article>

          <aside className="card soft wizard-side">
            <h4>{t("Context Summary")}</h4>
            <p>{t("Institution")}: {profile?.institutionName || profile?.displayName || "-"}</p>
            <p>{t("Draft Title")}: {form.title || "-"}</p>
            <p>{t("Recipient")}: {form.recipientName || "-"}</p>
            <p>{t("Preview status")}: {file ? t("Ready for issuance signing") : t("Waiting for PDF upload")}</p>
            {issuedDocument ? <p>{t("Issued Document ID")}: {issuedDocument.documentId}</p> : null}
            {issuedDocument ? (
              <div className="qr-preview-block">
                {qrCodeImage ? <img className="qr-image" src={qrCodeImage} alt={t("Issued document QR code")} /> : null}
                <div className="action-row">
                  <button className="btn btn-secondary" type="button" onClick={() => navigator.clipboard.writeText(JSON.stringify(issuedDocument.qrPayload || {}, null, 2))}>
                    {t("Copy QR JSON")}
                  </button>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      </section>
    </div>
  )
}

function DocumentsPage() {
  const { token } = useAuth()
  const { t } = useLanguage()
  const location = useLocation()
  const queryFromUrl = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return params.get("q") || ""
  }, [location.search])
  const [documents, setDocuments] = useState([])
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [searchQuery, setSearchQuery] = useState(queryFromUrl)
  const [typeFilter, setTypeFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [revokeModal, setRevokeModal] = useState({ open: false, documentId: "", reason: "" })

  async function loadDocuments() {
    try {
      const response = await api.listDocuments(token)
      setDocuments(response.data || [])
      setError("")
    } catch (loadError) {
      setError(loadError.message || "Could not load documents")
    }
  }

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const response = await api.listDocuments(token)
        if (!active) return
        setDocuments(response.data || [])
        setError("")
      } catch (loadError) {
        if (!active) return
        setError(loadError.message || "Could not load documents")
      }
    }

    if (token) {
      void load()
    }

    return () => {
      active = false
    }
  }, [token])

  useEffect(() => {
    setSearchQuery(queryFromUrl)
  }, [queryFromUrl])

  async function revokeDocument() {
    if (!revokeModal.documentId || !revokeModal.reason.trim()) {
      setError("Enter a revocation reason")
      return
    }

    try {
      await api.revokeDocument(token, revokeModal.documentId, revokeModal.reason.trim())
      setMessage("Document revoked successfully")
      setRevokeModal({ open: false, documentId: "", reason: "" })
      await loadDocuments()
    } catch (revokeError) {
      setError(revokeError.message || "Revoke failed")
    }
  }

  const documentTypes = [...new Set(documents.map((document) => String(document.documentType || "unknown")))]
  const filteredDocuments = documents.filter((document) => {
    const matchesType = typeFilter === "all" || String(document.documentType || "unknown") === typeFilter
    const matchesStatus = statusFilter === "all" || String(document.status || "issued").toLowerCase() === statusFilter
    const searchText = `${document.title || ""} ${document.recipientName || ""} ${document.documentId || ""}`.toLowerCase()
    const matchesSearch = !searchQuery.trim() || searchText.includes(searchQuery.trim().toLowerCase())
    return matchesType && matchesStatus && matchesSearch
  })

  return (
    <div className="page-stack audit-page">
      <section className="card filter-toolbar audit-filter-toolbar">
        <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t("Search title, recipient, or document ID")} />
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="all">{t("Type")}</option>
          {documentTypes.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">{t("Status")}</option>
          <option value="issued">{t("Issued")}</option>
          <option value="verified">{t("Verified")}</option>
          <option value="revoked">{t("Revoked")}</option>
          <option value="superseded">{t("Superseded")}</option>
          <option value="tampered">{t("Tampered")}</option>
        </select>
      </section>

      <section className="card page-stack">
        <div className="section-head">
          <h3>{t("Issued Documents")}</h3>
          <Link className="btn btn-primary" to="/app/issue-document">{t("Issue New Document")}</Link>
        </div>
        {error ? <ErrorState title={t("Document Error")} body={error} /> : null}
        {message ? <Toast message={message} /> : null}

        <table className="data-table">
          <thead>
            <tr>
              <th>Document ID</th>
              <th>{t("Document Title")}</th>
              <th>{t("Recipient")}</th>
              <th>{t("Issued At")}</th>
              <th>{t("Status")}</th>
              <th>{t("Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {filteredDocuments.length ? filteredDocuments.map((document) => (
              <tr key={document.documentId}>
                <td data-label={t("Document ID")}>{document.documentId}</td>
                <td data-label={t("Document Title")}>
                  <Link to={`/app/documents/${document.documentId}`} className="link-inline">{document.title}</Link>
                </td>
                <td data-label={t("Recipient")}>{document.recipientName || "-"}</td>
                <td data-label={t("Issued At")}>{formatDate(document.issuedAt)}</td>
                <td data-label={t("Status")}><StatusBadge status={document.status || "issued"} /></td>
                <td data-label={t("Actions")} className="table-actions-cell">
                  <div className="table-actions">
                    <Link to={`/app/documents/${document.documentId}`} className="btn btn-ghost">{t("Detail")}</Link>
                    <button className="btn btn-ghost" onClick={() => setRevokeModal({ open: true, documentId: document.documentId, reason: "" })}>{t("Revoke")}</button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} data-label={t("Results")}>{t("No documents match current filters.")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {revokeModal.open ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <article className="modal card">
            <h3>{t("Confirm Revocation")}</h3>
            <p>{t("Revoking this document will mark all future verification attempts as revoked.")}</p>
            <label>
              {t("Revocation Reason")}
              <textarea rows={3} value={revokeModal.reason} onChange={(event) => setRevokeModal((prev) => ({ ...prev, reason: event.target.value }))} />
            </label>
            <div className="action-row">
              <button className="btn btn-ghost" onClick={() => setRevokeModal({ open: false, documentId: "", reason: "" })}>{t("Cancel")}</button>
              <button className="btn btn-primary" onClick={revokeDocument}>{t("Confirm Revoke")}</button>
            </div>
          </article>
        </div>
      ) : null}
    </div>
  )
}

function DocumentDetailPage() {
  const { token } = useAuth()
  const { t } = useLanguage()
  const { documentId } = useParams()
  const [document, setDocument] = useState(null)
  const [versions, setVersions] = useState([])
  const [history, setHistory] = useState([])
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [replaceFile, setReplaceFile] = useState(null)
  const [revokeReason, setRevokeReason] = useState("")
  const [qrCodeImage, setQrCodeImage] = useState("")

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const [docResponse, versionsResponse, historyResponse] = await Promise.all([
          api.getDocument(token, documentId),
          api.documentVersions(token, documentId),
          api.auditByDocument(token, documentId, 25),
        ])
        if (!active) return
        setDocument(docResponse.data)
        setVersions(versionsResponse.data || [])
        setHistory(historyResponse.data || [])
        setError("")
      } catch (loadError) {
        if (!active) return
        setError(loadError.message || "Could not load document")
      }
    }

    if (token && documentId) {
      void load()
    }

    return () => {
      active = false
    }
  }, [token, documentId])

  useEffect(() => {
    let active = true

    async function renderQr() {
      if (!document?.qrPayload) {
        setQrCodeImage("")
        return
      }

      try {
        const image = await QRCode.toDataURL(JSON.stringify(document.qrPayload), { width: 220, margin: 1 })
        if (!active) return
        setQrCodeImage(image)
      } catch {
        if (!active) return
        setQrCodeImage("")
      }
    }

    renderQr()

    return () => {
      active = false
    }
  }, [document])

  async function replaceDocument() {
    if (!replaceFile || !document) {
      setError("Select a PDF to replace")
      return
    }

    try {
      const formData = new FormData()
      formData.append("file", replaceFile)
      formData.append("title", document.title)
      formData.append("documentType", document.documentType)
      formData.append("recipientName", document.recipientName)
      if (document.recipientReference) formData.append("recipientReference", document.recipientReference)
      formData.append("metadata", JSON.stringify(document.customMetadata || {}))
      await api.replaceDocument(token, document.documentId, formData)
      const [docResponse, versionsResponse, historyResponse] = await Promise.all([
        api.getDocument(token, documentId),
        api.documentVersions(token, documentId),
        api.auditByDocument(token, documentId, 25),
      ])
      setDocument(docResponse.data)
      setVersions(versionsResponse.data || [])
      setHistory(historyResponse.data || [])
      setReplaceFile(null)
      setMessage("Document replaced successfully")
    } catch (replaceError) {
      setError(replaceError.message || "Replace failed")
    }
  }

  async function revokeDocument() {
    if (!document?.documentId) return
    if (!revokeReason.trim()) {
      setError("Enter revocation reason")
      return
    }

    try {
      await api.revokeDocument(token, document.documentId, revokeReason.trim())
      const [docResponse, versionsResponse, historyResponse] = await Promise.all([
        api.getDocument(token, documentId),
        api.documentVersions(token, documentId),
        api.auditByDocument(token, documentId, 25),
      ])
      setDocument(docResponse.data)
      setVersions(versionsResponse.data || [])
      setHistory(historyResponse.data || [])
      setRevokeReason("")
      setMessage("Document revoked successfully")
    } catch (revokeError) {
      setError(revokeError.message || "Revoke failed")
    }
  }

  async function downloadDocument() {
    if (!document) return

    try {
      const response = await fetch(`${API_BASE_URL}/documents/${document.documentId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) throw new Error("Download failed")

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = window.document.createElement("a")
      anchor.href = url
      anchor.download = `${document.documentId}.pdf`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (downloadError) {
      setError(downloadError.message || "Download failed")
    }
  }

  function downloadQrPng() {
    if (!qrCodeImage || !document?.documentId) return

    const anchor = window.document.createElement("a")
    anchor.href = qrCodeImage
    anchor.download = `${document.documentId}-qr.png`
    anchor.click()
  }

  if (!document) {
    return <section className="card">{error ? <ErrorState title={t("Document Error")} body={error} /> : <PageLoading />}</section>
  }

  return (
    <div className="page-stack">
      <section className="card detail-header">
        <div>
          <h2>{document.documentId || t("Document Detail")}</h2>
          <p>{document.title || "-"} - {document.issuerName || t("Issuer")}</p>
        </div>
        <StatusBadge status={document.status || "issued"} large />
      </section>

      <section className="two-col-grid">
        <article className="card">
          <h3>{t("Metadata")}</h3>
          <dl className="meta-list">
            <div>
              <dt>{t("Recipient")}</dt>
              <dd>{document.recipientName || "-"}</dd>
            </div>
            <div>
              <dt>{t("Version")}</dt>
              <dd>v{document.versionNumber || 1}</dd>
            </div>
            <div>
              <dt>{t("Issued At")}</dt>
              <dd>{formatDate(document.issuedAt)}</dd>
            </div>
            <div>
              <dt>{t("Type")}</dt>
              <dd>{document.documentType || "-"}</dd>
            </div>
          </dl>
        </article>

        <article className="card">
          <h3>{t("Verification History")}</h3>
          <ul className="activity-list compact">
            {history.filter((entry) => String(entry.action || "").includes("VERIFIED")).slice(0, 6).map((entry) => (
              <li key={entry.entryId}>
                <div>
                  <strong>{formatDate(entry.timestamp)}</strong>
                  <small>{entry.action}</small>
                </div>
                <StatusBadge status={entry.payload?.result?.status || "verified"} />
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="two-col-grid">
        <article className="card">
          <h3>{t("Version Chain")}</h3>
          <ul className="review-list">
            {versions.map((version) => (
              <li key={version.documentId}>{version.documentId} - v{version.versionNumber} - {formatDate(version.issuedAt)}</li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h3>{t("QR Evidence")}</h3>
          {qrCodeImage ? <img className="qr-image" src={qrCodeImage} alt={t("Document QR code")} /> : null}
          <div className="action-row">
            <button className="btn btn-secondary" onClick={() => navigator.clipboard.writeText(JSON.stringify(document.qrPayload || {}, null, 2))}>{t("Copy QR JSON")}</button>
            <button className="btn btn-secondary" onClick={downloadQrPng} disabled={!qrCodeImage}>{t("Download QR PNG")}</button>
          </div>
        </article>
      </section>

      <section className="card page-stack">
        <h3>{t("Actions")}</h3>
        <div className="action-row">
          <button className="btn btn-primary" onClick={downloadDocument}>{t("Download Issued PDF")}</button>
          <button className="btn btn-ghost" onClick={replaceDocument} disabled={!replaceFile}>{t("Replace Document")}</button>
        </div>

        <label>
          {t("Replacement PDF")}
          <input type="file" accept="application/pdf" onChange={(event) => setReplaceFile(event.target.files?.[0] || null)} />
        </label>

        <label>
          {t("Revoke Reason")}
          <input value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} placeholder={t("Provide reason for revocation")} />
        </label>
        <button className="btn btn-primary" onClick={revokeDocument}>{t("Revoke Document")}</button>

        {message ? <Toast message={message} /> : null}
        {error ? <ErrorState title={t("Action Error")} body={error} /> : null}
      </section>

      {document.qrPayload ? (
        <section className="card">
          <h3>{t("QR Payload")}</h3>
          <pre className="code-block">{JSON.stringify(document.qrPayload, null, 2)}</pre>
        </section>
      ) : null}
    </div>
  )
}

function PublicVerificationPage() {
  const { token, isAuthenticated } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const uploadInputRef = useRef(null)
  const [qrPayload, setQrPayload] = useState("")
  const [documentId, setDocumentId] = useState("")
  const [uploadFile, setUploadFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [activeVerification, setActiveVerification] = useState("")
  const [error, setError] = useState("")

  async function verifyQr() {
    setActiveVerification("qr")
    setBusy(true)
    setError("")

    try {
      const parsed = parseQrPayloadText(qrPayload)
      const response = await api.verifyQrPublic(parsed)
      const resultToken = response.data?.resultAccessToken || null
      const attemptId = response.data?.attempt?.attemptId || null
      saveVerificationResultSnapshot(response.data)
      navigate(buildResultUrl({ attemptId, resultToken }), { state: { source: "qr", response: response.data } })
    } catch (verifyError) {
      setError(verifyError.message || "QR verification failed")
    } finally {
      setBusy(false)
      setActiveVerification("")
    }
  }

  async function verifyUpload() {
    if (!uploadFile) {
      setError(t("Select a PDF file"))
      return
    }

    setBusy(true)
    setActiveVerification("upload")
    setError("")

    try {
      const formData = new FormData()
      formData.append("file", uploadFile)

      if (documentId) formData.append("documentId", documentId)
      if (qrPayload) {
        const normalizedQrPayload = parseQrPayloadText(qrPayload)
        formData.append("qrPayload", JSON.stringify(normalizedQrPayload))
      }

      const response = isAuthenticated
        ? await api.verifyUploadAuth(token, formData)
        : await api.verifyUploadPublic(formData)
      const resultToken = response.data?.resultAccessToken || null
      const attemptId = response.data?.attempt?.attemptId || null
      const jobId = response.data?.jobId || null
      lastUploadedVerificationFile = uploadFile
      saveVerificationResultSnapshot(response.data)
      navigate(buildResultUrl({ attemptId, jobId, resultToken }), {
        state: { source: "upload", response: response.data, uploadedFile: uploadFile },
      })
    } catch (verifyError) {
      setError(verifyError.message || "Upload verification failed")
    } finally {
      setBusy(false)
      setActiveVerification("")
    }
  }

  return (
    <div className="page-stack">
      <section className="verify-layout">
        <article className="card verify-panel verify-panel-qr">
          <h2>{t("Verify QR Payload")}</h2>
          <label>
            {t("QR Payload")}
            <textarea className="verify-payload-input" rows={10} value={qrPayload} onChange={(event) => setQrPayload(event.target.value)} placeholder={t("Paste QR payload")} />
          </label>
          <button
            className={busy && activeVerification === "qr" ? "btn btn-primary is-loading" : "btn btn-primary"}
            onClick={verifyQr}
            disabled={busy || !qrPayload}
            aria-busy={busy && activeVerification === "qr"}
          >
            {busy && activeVerification === "qr" ? (
              <>
                <span className="btn-spinner" aria-hidden="true" />
                <span>{t("Verifying QR...")}</span>
              </>
            ) : (
              t("Verify QR Payload")
            )}
          </button>
        </article>

        <article className="card verify-panel verify-panel-upload">
          <h2>{t("Upload PDF for Verification")}</h2>
          <label className="file-picker-label">
            {t("PDF File")}
            <input
              ref={uploadInputRef}
              className="file-input-hidden"
              type="file"
              accept="application/pdf"
              onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
            />
            <div className="file-picker-row">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => uploadInputRef.current?.click()}
              >
                {t("Choose File")}
              </button>
              <span className="file-picker-name">{uploadFile?.name || t("No file selected")}</span>
            </div>
          </label>
          <label>
            {t("Manual Document ID")}
            <input value={documentId} onChange={(event) => setDocumentId(event.target.value)} placeholder={t("Manual document ID")} />
          </label>
          <button
            className={busy && activeVerification === "upload" ? "btn btn-primary is-loading" : "btn btn-primary"}
            onClick={verifyUpload}
            disabled={busy}
            aria-busy={busy && activeVerification === "upload"}
          >
            {busy && activeVerification === "upload" ? (
              <>
                <span className="btn-spinner" aria-hidden="true" />
                <span>{t("Verifying Upload...")}</span>
              </>
            ) : (
              t("Verify Document")
            )}
          </button>

          {error ? (
            <div className="error-stack">
              <ErrorState title={t("Verification Error")} body={error} />
            </div>
          ) : null}
        </article>
      </section>

      <section className="card tips-grid">
        <article>
          <h4>{t("Verification Tips")}</h4>
          <p>{t("Use original PDF exports to reduce parsing mismatches.")}</p>
        </article>
        <article>
          <h4>{t("Supported Files")}</h4>
          <p>{t("PDF only. Embedded images and scanned documents are supported.")}</p>
        </article>
        <article>
          <h4>{t("Result Guide")}</h4>
          <p>{t("Verified, Tampered, Suspicious, Revoked, and Not Found states.")}</p>
        </article>
      </section>
    </div>
  )
}

function VerificationResultPage() {
  const { token } = useAuth()
  const { t } = useLanguage()
  const location = useLocation()
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search])
  const [payload, setPayload] = useState(() => location.state?.response || loadVerificationResultSnapshot() || null)
  const [uploadedFile] = useState(location.state?.uploadedFile || lastUploadedVerificationFile || null)
  const [pollError, setPollError] = useState("")

  const queryJobId = searchParams.get("jobId") || null
  const queryAttemptId = searchParams.get("attemptId") || null
  const queryResultToken = searchParams.get("resultToken") || null

  useEffect(() => {
    if (!payload) return
    saveVerificationResultSnapshot(payload)
  }, [payload])

  useEffect(() => {
    let active = true

    async function hydrateFromQuery() {
      if (payload) return

      try {
        if (queryJobId) {
          const response = await api.verificationJob(queryJobId, {
            token,
            resultToken: queryResultToken,
          })

          if (!active) return

          const jobData = response.data
          if (jobData?.status === "completed" && jobData.result) {
            setPayload(jobData.result)
            return
          }

          setPayload(jobData)
          return
        }

        if (queryAttemptId) {
          const response = await api.verificationAttempt(queryAttemptId, {
            token,
            resultToken: queryResultToken,
          })

          if (!active) return
          setPayload(mapAttemptToResultPayload(response.data))
        }
      } catch (loadError) {
        if (!active) return
        setPollError(loadError.message || "Could not load verification result")
      }
    }

    hydrateFromQuery()

    return () => {
      active = false
    }
  }, [payload, queryAttemptId, queryJobId, queryResultToken, token])

  useEffect(() => {
    if (!payload?.status || payload.status !== "pending" || !payload.jobId) {
      return () => {}
    }

    const resultToken = payload.resultAccessToken || null
    let active = true
    const intervalId = setInterval(async () => {
      try {
        const response = await api.verificationJob(payload.jobId, {
          token,
          resultToken,
        })

        if (!active) return
        const data = response.data

        if (data.status === "completed" && data.result) {
          setPayload(data.result)
          clearInterval(intervalId)
        }

        if (data.status === "error") {
          setPollError(data.error?.message || "Verification job failed")
          clearInterval(intervalId)
        }
      } catch (error) {
        if (!active) return
        setPollError(error.message || "Could not poll verification job")
        clearInterval(intervalId)
      }
    }, 2000)

    return () => {
      active = false
      clearInterval(intervalId)
    }
  }, [payload, token])

  if (!payload) {
    return (
      <section className="card">
        <EmptyState title={t("No verification result")} body={t("Run verification from /verify or open /result with attemptId/jobId query parameters.")} />
      </section>
    )
  }

  const result = payload.result || payload
  const normalizedStatus = String(result.status || "").toLowerCase()
  const shouldShowTamperWarnings = normalizedStatus === "tampered" || normalizedStatus === "suspicious"
  const statusBandTone =
    normalizedStatus === "verified"
      ? "verified"
      : normalizedStatus === "tampered"
        ? "tampered"
        : normalizedStatus === "suspicious"
          ? "suspicious"
          : normalizedStatus === "revoked"
            ? "revoked"
            : normalizedStatus === "pending"
              ? "pending"
              : "neutral"
  const detectors = result.detectors || result.tamperFindings?.detectors || {
    textLayerChanged: false,
    ocrLayerChanged: false,
    visualLayerChanged: false,
  }
  const ocrDiffSummary = result.ocrDiffSummary || result.tamperFindings?.ocrDiffSummary || {
    changedWordCount: 0,
    changedPages: [],
    confidence: null,
  }
  const visualDiffScoreByPage = result.visualDiffScoreByPage || result.tamperFindings?.visualDiffScoreByPage || []
  const visualFlaggedPages = shouldShowTamperWarnings
    ? (result.tamperFindings?.visualChangedPages || visualDiffScoreByPage
      .filter((entry) => Number(entry?.score) > 0)
      .map((entry) => Number(entry.pageNumber)))
      .filter((value) => Number.isFinite(value) && value > 0)
    : []
  const changedPagesWithoutBoxes = visualFlaggedPages.filter((pageNumber) => {
    const boxes = result.tamperFindings?.rectanglesByPage?.[String(pageNumber)] || []
    return boxes.length === 0
  })
  const triggerLabels = [
    detectors.textLayerChanged ? "Text Layer" : null,
    detectors.ocrLayerChanged ? "OCR Layer" : null,
    detectors.visualLayerChanged ? "Visual Layer" : null,
  ].filter(Boolean)
  const decisionReasonLine =
    triggerLabels.length > 0
      ? `${t("Triggered by")} ${triggerLabels.join(", ")}`
      : result.reason || result.resultMessage || t("No detector trigger metadata was returned")
  const formatAsPercent = (value, decimals = 1) => {
    if (!Number.isFinite(value)) {
      return "-"
    }

    const normalized = Number(value)
    const percentValue = normalized > 1 ? normalized : normalized * 100
    return `${percentValue.toFixed(decimals)}%`
  }
  const detectorHitCount = [detectors.textLayerChanged, detectors.ocrLayerChanged, detectors.visualLayerChanged]
    .filter(Boolean)
    .length
  const detectorTriggerRate = Math.round((detectorHitCount / 3) * 100)
  const ocrChangedWordCount = Number(ocrDiffSummary.changedWordCount || 0)
  const ocrChangeIntensity = Math.min(100, Math.round((ocrChangedWordCount / 40) * 100))
  const visualPeak = visualDiffScoreByPage.reduce((peak, entry) => {
    const value = Number(entry?.score)

    if (!Number.isFinite(value)) {
      return peak
    }

    return Math.max(peak, value)
  }, 0)
  const visualPeakPercent = Math.min(100, Math.round((visualPeak > 1 ? visualPeak : visualPeak * 100)))
  const outcomeScore =
    normalizedStatus === "verified"
      ? 92
      : normalizedStatus === "tampered"
        ? 14
        : normalizedStatus === "revoked"
          ? 28
          : normalizedStatus === "pending"
            ? 50
            : 60
  const resultDocumentId = result.documentId || payload.attempt?.documentId || "-"
  const resultRecipient = result.recipientName || payload.attempt?.recipientName || "-"
  const resultType = result.documentType || "-"
  const resultIssuedAt = formatDate(result.issuedAt)
  const resultIssuer = result.issuerName || result.issuer?.institutionName || "-"
  const resultVerifiedAt = formatDate(result.verifiedAt || payload.attempt?.verifiedAt || new Date().toISOString())
  const trustScoreValueRaw =
    typeof result.trustScore === "object" && result.trustScore !== null
      ? result.trustScore.currentScore
      : result.trustScore
  const trustScoreValue = Number.isFinite(Number(trustScoreValueRaw)) ? Number(trustScoreValueRaw).toFixed(1) : "-"
  const trustBandValue =
    result.trustBand ||
    (typeof result.trustScore === "object" && result.trustScore !== null ? result.trustScore.scoreBand : null) ||
    t("Band unavailable")
  const rectanglesByPage = result.tamperFindings?.rectanglesByPage || {}
  const tamperPages = [
    ...Object.keys(rectanglesByPage).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0),
    ...visualFlaggedPages,
  ]
  const uniqueTamperPages = [...new Set(tamperPages)].sort((left, right) => left - right)

  return (
    <div className="page-stack">
      <section className={`status-band ${statusBandTone} card`}>
        <div>
          <StatusBadge status={result.status || "pending"} large />
          <p>{result.reason || result.resultMessage || t("No reason provided by backend.")}</p>
          <p className="inline-note">{t("Decision Basis")}: {decisionReasonLine}</p>
          {pollError ? <ErrorState title={t("Job Polling Error")} body={pollError} /> : null}
        </div>
        <dl>
          <div>
            <dt>{t("Document")}</dt>
            <dd>{resultDocumentId}</dd>
          </div>
          <div>
            <dt>{t("Issuer")}</dt>
            <dd>{resultIssuer}</dd>
          </div>
          <div>
            <dt>{t("Verified At")}</dt>
            <dd>{resultVerifiedAt}</dd>
          </div>
        </dl>
      </section>

      <section className="result-grid">
        <div className="stacked-panel">
          <article className="card">
            <h3>{t("Document Metadata")}</h3>
            <dl className="meta-list">
              <div>
                <dt>{t("Document ID")}</dt>
                <dd>{resultDocumentId}</dd>
              </div>
              <div>
                <dt>{t("Recipient")}</dt>
                <dd>{resultRecipient}</dd>
              </div>
              <div>
                <dt>{t("Type")}</dt>
                <dd>{resultType}</dd>
              </div>
              <div>
                <dt>{t("Issued Date")}</dt>
                <dd>{resultIssuedAt}</dd>
              </div>
              <div>
                <dt>{t("Status")}</dt>
                <dd><StatusBadge status={result.status || "pending"} /></dd>
              </div>
            </dl>
          </article>

          <article className="card">
            <h3>{t("Issuer Trust")}</h3>
            <p className="score-big">{trustScoreValue}</p>
            <p>{trustBandValue}</p>
            <p>{t("Score impact: +successful verifications, -tamper incidents")}</p>
          </article>

          <article className="card">
            <h3>{t("Verification Findings")}</h3>
            <ul className="check-list">
              <li>{t("Reason Code")}: <strong>{result.reasonCode || result.resultReasonCode || "-"}</strong></li>
              <li>{t("OCR changed words")}: <strong>{ocrDiffSummary.changedWordCount || 0}</strong></li>
              <li>{t("OCR confidence")}: <strong>{formatAsPercent(ocrDiffSummary.confidence, 0)}</strong></li>
              <li>{t("Visual diff peak")}: <strong>{visualPeakPercent}%</strong></li>
            </ul>
            <div className="detector-chip-row">
              <DetectorChip label={t("Text Layer")} active={detectors.textLayerChanged} />
              <DetectorChip label={t("OCR Layer")} active={detectors.ocrLayerChanged} />
              <DetectorChip label={t("Visual Layer")} active={detectors.visualLayerChanged} />
            </div>
          </article>

          <article className="card">
            <h3>{t("Detector Evidence")}</h3>
            <div className="verification-stats-grid">
              <MetricBar label="Outcome Confidence" value={outcomeScore} tone={normalizedStatus === "verified" ? "good" : normalizedStatus === "tampered" ? "risk" : "neutral"} helper={normalizedStatus || "pending"} />
              <MetricBar label="Detector Trigger Rate" value={detectorTriggerRate} tone={detectorTriggerRate >= 67 ? "risk" : detectorTriggerRate >= 34 ? "warn" : "good"} helper={`${detectorHitCount} of 3 detectors triggered`} />
              <MetricBar label="OCR Change Intensity" value={ocrChangeIntensity} tone={ocrChangeIntensity >= 60 ? "risk" : ocrChangeIntensity >= 25 ? "warn" : "good"} helper={`${ocrChangedWordCount} changed words`} />
              <MetricBar label="Visual Diff Peak" value={visualPeakPercent} tone={visualPeakPercent >= 60 ? "risk" : visualPeakPercent >= 25 ? "warn" : "good"} helper={visualDiffScoreByPage.length ? `${visualDiffScoreByPage.length} page score entries` : "No visual scores returned"} />
            </div>
            {visualDiffScoreByPage.length ? (
              <div className="detector-score-grid">
                {visualDiffScoreByPage.map((entry) => (
                  <article key={entry.pageNumber} className="detector-score-card">
                    <strong>{t("Page")} {entry.pageNumber}</strong>
                    <span>{formatAsPercent(entry.score, 1)}</span>
                  </article>
                ))}
              </div>
            ) : null}
          </article>
        </div>

        <article className="card viewer-card">
          <div className="viewer-toolbar">
            <div className="action-row compact-actions">
              <strong>{t("Tamper Overlay Preview")}</strong>
            </div>
            <div className="action-row compact-actions">
              <span>{uniqueTamperPages.length ? `${uniqueTamperPages.length} ${t("impacted page(s)")}` : t("No impacted pages")}</span>
            </div>
          </div>

          <VerificationVisualPreview
            uploadedFile={uploadedFile}
            rectanglesByPage={rectanglesByPage}
            flaggedPages={visualFlaggedPages}
            status={result.status}
            warnOnVisualOnly={shouldShowTamperWarnings}
          />

          <div className="finding-list">
            <h4>{t("Tampered Sections")}</h4>
            {uniqueTamperPages.length ? uniqueTamperPages.map((page) => (
              <p key={page} className="finding-btn">
                {t("Page")} {page}
                {changedPagesWithoutBoxes.includes(page) ? ` ${t("flagged by visual diff without box geometry")}` : ` ${t("contains detector evidence")}`}
              </p>
            )) : <p className="inline-note">{t("No altered regions were returned in this result.")}</p>}
          </div>
        </article>
      </section>
    </div>
  )
}

function DetectorChip({ label, active }) {
  return <span className={active ? "detector-chip active" : "detector-chip"}>{label}</span>
}

function MetricBar({ label, value, helper, tone = "neutral" }) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0))
  const toneClass = tone === "good" ? "good" : tone === "risk" ? "risk" : tone === "warn" ? "warn" : "neutral"

  return (
    <article className="verification-metric-card">
      <div className="verification-metric-head">
        <strong>{label}</strong>
        <span>{safeValue}%</span>
      </div>
      <div className={`metric-track ${toneClass}`} aria-hidden="true">
        <span style={{ width: `${safeValue}%` }} />
      </div>
      <small>{helper}</small>
    </article>
  )
}

function VerificationVisualPreview({ uploadedFile, rectanglesByPage, flaggedPages = [], status, warnOnVisualOnly = false }) {
  const { t } = useLanguage()
  const [renderedPages, setRenderedPages] = useState([])
  const [error, setError] = useState("")

  const buildFallbackPreviews = useCallback(({ rectangleMap, visualOnlyPages, currentStatus, warnOnVisualOnly: fallbackWarnOnVisualOnly }) => {
    const candidatePages = [
      ...Object.keys(rectangleMap || {}).map((value) => Number(value)),
      ...visualOnlyPages,
    ]
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((left, right) => left - right)

    const pageList = candidatePages.length ? [...new Set(candidatePages)] : [1]
    const visualOnlySet = new Set(visualOnlyPages)

    return pageList.map((pageNumber) => {
      const canvas = window.document.createElement("canvas")
      const context = canvas.getContext("2d")
      canvas.width = 800
      canvas.height = 1120

      context.fillStyle = "#ffffff"
      context.fillRect(0, 0, canvas.width, canvas.height)

      // Draw subtle text rows so overlays are visually inspectable even without PDF parsing.
      context.fillStyle = "#eef3fa"
      for (let row = 0; row < 28; row += 1) {
        const y = 40 + row * 34
        const width = 620 - ((row % 4) * 40)
        context.fillRect(48, y, width, 10)
      }

      const rectangles = (rectangleMap && rectangleMap[String(pageNumber)]) || []

      rectangles.forEach((box) => {
        // Source coordinates are usually PDF points; normalize against common page size.
        const x = (Number(box.x || 0) / 595) * canvas.width
        const y = (Number(box.y || 0) / 842) * canvas.height
        const width = Math.max((Number(box.width || 0) / 595) * canvas.width, 8)
        const height = Math.max((Number(box.height || 0) / 842) * canvas.height, 8)

        if (box.source === "visual_diff") {
          context.strokeStyle = "#7a0019"
          context.fillStyle = "rgba(82, 0, 18, 0.42)"
        } else {
          context.strokeStyle = "#e63946"
          context.fillStyle = "rgba(230, 57, 70, 0.28)"
        }

        context.lineWidth = 3
        context.fillRect(x, y, width, height)
        context.strokeRect(x, y, width, height)
      })

      if (!rectangles.length) {
        const shouldWarnRed =
          fallbackWarnOnVisualOnly && (visualOnlySet.has(pageNumber) || String(currentStatus || "").toLowerCase() === "tampered")

        if (shouldWarnRed) {
          context.fillStyle = "rgba(90, 8, 24, 0.14)"
          context.fillRect(0, 0, canvas.width, canvas.height)
          context.strokeStyle = "#8f1332"
        } else {
          context.strokeStyle = "#2a9d8f"
        }

        context.lineWidth = 5
        context.strokeRect(4, 4, canvas.width - 8, canvas.height - 8)
      }

      return {
        pageNumber,
        changedCount: rectangles.length,
        visualOnlyFlagged: visualOnlySet.has(pageNumber) && rectangles.length === 0,
        imageUrl: canvas.toDataURL("image/png"),
      }
    })
  }, [])

  useEffect(() => {
    let active = true

    async function renderPages() {
      if (!uploadedFile) {
        setRenderedPages([])
        setError("")
        return
      }

      try {
        const buffer = await uploadedFile.arrayBuffer()
        const loadingTask = getDocument({ data: buffer, disableWorker: true })
        const pdf = await loadingTask.promise
        const changedPages = Object.keys(rectanglesByPage || {})
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
          .sort((left, right) => left - right)
        const visualOnlyPages = (flaggedPages || [])
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
        const pagesToRender = [...new Set([...changedPages, ...visualOnlyPages])]
          .sort((left, right) => left - right)
        const fallbackPages = pagesToRender.length ? pagesToRender : [1]
        const visualOnlyPageSet = new Set(visualOnlyPages)
        const previews = []

        for (const pageNumber of fallbackPages) {
          const page = await pdf.getPage(pageNumber)
          const baseViewport = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: 1.5 })
          const scaleX = viewport.width / Math.max(baseViewport.width, 1)
          const scaleY = viewport.height / Math.max(baseViewport.height, 1)
          const canvas = window.document.createElement("canvas")
          const context = canvas.getContext("2d")

          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)

          await page.render({ canvasContext: context, viewport }).promise

          const rectangles = (rectanglesByPage && rectanglesByPage[String(pageNumber)]) || []

          context.lineWidth = 2

          rectangles.forEach((box) => {
            const x = Number(box.x || 0) * scaleX
            const y = Number(box.y || 0) * scaleY
            const width = Math.max(Number(box.width || 0) * scaleX, 4)
            const height = Math.max(Number(box.height || 0) * scaleY, 4)

            if (box.source === "visual_diff") {
              context.strokeStyle = "#7a0019"
              context.fillStyle = "rgba(82, 0, 18, 0.42)"
            } else {
              context.strokeStyle = "#e63946"
              context.fillStyle = "rgba(230, 57, 70, 0.28)"
            }

            context.fillRect(x, y, width, height)
            context.strokeRect(x, y, width, height)
          })

          if (!rectangles.length) {
            const shouldWarnRed =
              warnOnVisualOnly && (visualOnlyPageSet.has(pageNumber) || String(status || "").toLowerCase() === "tampered")

            if (shouldWarnRed) {
              context.fillStyle = "rgba(90, 8, 24, 0.14)"
              context.fillRect(0, 0, canvas.width, canvas.height)
              context.strokeStyle = "#8f1332"
            } else {
              context.strokeStyle = "#2a9d8f"
            }

            context.lineWidth = 4
            context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4)
          }

          previews.push({
            pageNumber,
            changedCount: rectangles.length,
            visualOnlyFlagged: visualOnlyPageSet.has(pageNumber) && rectangles.length === 0,
            imageUrl: canvas.toDataURL("image/png")
          })

          page.cleanup()
        }

        await pdf.destroy()

        if (!active) return
        setRenderedPages(previews)
        setError("")
      } catch (renderError) {
        if (!active) return
        const fallbackPreviews = buildFallbackPreviews({
          rectangleMap: rectanglesByPage,
          visualOnlyPages: flaggedPages,
          currentStatus: status,
          warnOnVisualOnly,
        })

        if (fallbackPreviews.length) {
          setRenderedPages(fallbackPreviews)
          setError("")
          return
        }

        setRenderedPages([])
        setError(renderError.message || t("Could not render tamper highlights"))
      }
    }

    renderPages()

    return () => {
      active = false
    }
  }, [uploadedFile, rectanglesByPage, flaggedPages, status, warnOnVisualOnly, t, buildFallbackPreviews])

  if (!uploadedFile) {
    return <p className="inline-note">{t("Visual preview appears for upload verification results in the same session. For QR-only verification there is no uploaded file preview.")}</p>
  }

  if (error) {
    return <ErrorState title={t("Tamper Overlay Error")} body={error} />
  }

  if (!renderedPages.length) {
    return null
  }

  return (
    <div className="page-stack">
      <p className="inline-note">
        {warnOnVisualOnly
          ? t("Red overlays show changed regions detected in the uploaded PDF.")
          : t("Green border indicates no explicit changed regions were highlighted for this result.")}
      </p>
      <div className="tamper-preview-grid">
      {renderedPages.map((page) => (
        <article key={page.pageNumber} className="tamper-preview-card">
          <div className="tamper-preview-head">
            <strong>{t("Page")} {page.pageNumber}</strong>
            <span>{page.visualOnlyFlagged ? t("visual diff flagged") : `${page.changedCount} ${t("changes")}`}</span>
          </div>
          {page.visualOnlyFlagged ? <p className="inline-note">{t("Page")} {page.pageNumber} {t("flagged by visual diff without box geometry")}</p> : null}
          <img src={page.imageUrl} alt={`${t("Tamper highlights for page")} ${page.pageNumber}`} />
        </article>
      ))}
      </div>
    </div>
  )
}

function VerificationActivityPage() {
  const { token } = useAuth()
  const { t } = useLanguage()
  const [entries, setEntries] = useState([])
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [methodFilter, setMethodFilter] = useState("all")
  const [resultFilter, setResultFilter] = useState("all")

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const response = await api.auditList(token, 100)
        if (!active) return
        setEntries((response.data || []).filter((entry) => entry.action?.includes("VERIFIED")))
      } catch (loadError) {
        if (!active) return
        setError(loadError.message || t("Could not load verification activity"))
      }
    }

    if (token) load()

    return () => {
      active = false
    }
  }, [token])

  const verificationEntries = entries.map((entry) => {
    const payloadString = String(JSON.stringify(entry.payload || {})).toLowerCase()
    const method = payloadString.includes("qr") ? "QR" : "Upload"
    const result = String(entry.payload?.result?.status || "verified").toLowerCase()
    return {
      ...entry,
      method,
      result,
    }
  })

  const filteredEntries = verificationEntries.filter((entry) => {
    const text = `${entry.entryId || ""} ${entry.documentId || ""} ${entry.action || ""}`.toLowerCase()
    const matchesQuery = !query.trim() || text.includes(query.trim().toLowerCase())
    const matchesMethod = methodFilter === "all" || entry.method.toLowerCase() === methodFilter
    const matchesResult = resultFilter === "all" || entry.result === resultFilter
    return matchesQuery && matchesMethod && matchesResult
  })

  const tamperedAttempts = verificationEntries.filter((entry) => entry.result === "tampered").length
  const suspiciousAttempts = verificationEntries.filter((entry) => entry.result === "suspicious").length
  const verifiedAttempts = verificationEntries.filter((entry) => entry.result === "verified").length

  return (
    <div className="page-stack">
      <section className="card filter-toolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Attempt ID or Document ID")} />
        <select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}>
          <option value="all">{t("Method")}</option>
          <option value="qr">QR</option>
          <option value="upload">{t("Upload")}</option>
        </select>
        <select value={resultFilter} onChange={(event) => setResultFilter(event.target.value)}>
          <option value="all">{t("Result")}</option>
          <option value="verified">{t("Verified")}</option>
          <option value="tampered">{t("Tampered")}</option>
          <option value="suspicious">{t("Suspicious")}</option>
          <option value="revoked">{t("Revoked")}</option>
        </select>
      </section>

      <section className="kpi-grid">
        <article className="card kpi-card">
          <p>{t("Total Attempts")}</p>
          <h3>{verificationEntries.length}</h3>
        </article>
        <article className="card kpi-card">
          <p>{t("Verified Attempts")}</p>
          <h3>{verifiedAttempts}</h3>
        </article>
        <article className="card kpi-card">
          <p>{t("Tampered Attempts")}</p>
          <h3>{tamperedAttempts}</h3>
        </article>
        <article className="card kpi-card">
          <p>{t("Suspicious Attempts")}</p>
          <h3>{suspiciousAttempts}</h3>
        </article>
      </section>

      <section className="card page-stack">
        <h3>{t("Verification Activity")}</h3>
        {error ? <ErrorState title={t("Activity Error")} body={error} /> : null}
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("Attempt ID")}</th>
              <th>{t("Document ID")}</th>
              <th>{t("Method")}</th>
              <th>{t("Result")}</th>
              <th>{t("Time")}</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.length ? filteredEntries.map((entry) => (
              <tr key={entry.entryId}>
                <td data-label={t("Attempt ID")}>{entry.entryId || `SEQ-${entry.sequenceNumber}`}</td>
                <td data-label={t("Document ID")}>{entry.documentId || "-"}</td>
                <td data-label={t("Method")}>{entry.method === "Upload" ? t("Upload") : entry.method}</td>
                <td data-label={t("Result")}><StatusBadge status={entry.result} /></td>
                <td data-label={t("Time")}>{formatDate(entry.timestamp)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={5} data-label={t("Results")}>{t("No verification attempts match current filters.")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function AuditLogPage() {
  const { token, firebaseUser } = useAuth()
  const { t } = useLanguage()
  const [entries, setEntries] = useState([])
  const [chainResult, setChainResult] = useState(null)
  const [snapshotBusy, setSnapshotBusy] = useState(false)
  const [snapshotError, setSnapshotError] = useState("")
  const [snapshotMessage, setSnapshotMessage] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [actionFilter, setActionFilter] = useState("all")
  const [integrityFilter, setIntegrityFilter] = useState("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [documentFilter, setDocumentFilter] = useState("")
  const [selectedEntryId, setSelectedEntryId] = useState("")
  const [entryActionBusy, setEntryActionBusy] = useState(false)
  const [entryActionError, setEntryActionError] = useState("")
  const [entryActionMessage, setEntryActionMessage] = useState("")
  const [selectedQrImage, setSelectedQrImage] = useState("")
  const [error, setError] = useState("")

  const loadAuditData = useCallback(async () => {
    const entriesResponse = await api.auditList(token, 100)
    setEntries(entriesResponse.data || [])
  }, [token])

  useEffect(() => {
    let active = true

    async function load() {
      try {
        await loadAuditData()
        if (!active) return
        setError("")
      } catch (loadError) {
        if (!active) return
        setError(loadError.message || t("Could not load audit logs"))
      }
    }

    if (token) {
      void load()
    }

    return () => {
      active = false
    }
  }, [token, loadAuditData])

  useEffect(() => {
    if (!entries.length) {
      setSelectedEntryId("")
      return
    }

    if (!selectedEntryId || !entries.some((entry) => entry.entryId === selectedEntryId)) {
      setSelectedEntryId(entries[0].entryId)
    }
  }, [entries, selectedEntryId])

  const selectedEntry = entries.find((entry) => entry.entryId === selectedEntryId) || null

  useEffect(() => {
    let active = true

    async function renderSelectedQr() {
      if (!selectedEntry?.payload?.qrPayload) {
        setSelectedQrImage("")
        return
      }

      try {
        const image = await QRCode.toDataURL(JSON.stringify(selectedEntry.payload.qrPayload), { width: 200, margin: 1 })
        if (!active) return
        setSelectedQrImage(image)
      } catch {
        if (!active) return
        setSelectedQrImage("")
      }
    }

    renderSelectedQr()

    return () => {
      active = false
    }
  }, [selectedEntry])

  async function verifyChain() {
    setError("")
    try {
      const response = await api.auditVerifyChain(token)
      setChainResult(response.data)
    } catch (verifyError) {
      setError(verifyError.message || "Could not verify chain")
    }
  }

  async function exportSnapshot() {
    setSnapshotBusy(true)
    setSnapshotError("")
    setSnapshotMessage("")

    try {
      const response = await api.auditExportSnapshot(token)
      const payload = response.data || {}
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const anchor = window.document.createElement("a")
      const sequence = payload?.snapshot?.sequenceNumber || "latest"
      anchor.href = url
      anchor.download = `digisecure-audit-snapshot-${sequence}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      setSnapshotMessage("Signed snapshot exported")
    } catch (snapshotRequestError) {
      setSnapshotError(snapshotRequestError.message || "Could not export signed snapshot")
    } finally {
      setSnapshotBusy(false)
    }
  }

  function toSearchText(entry) {
    const raw = [
      entry.sequenceNumber,
      entry.action,
      entry.documentId,
      entry.actorType,
      entry.actorId,
      entry.integrityStatus,
      entry.entryId,
      entry.currentEntryHash,
      entry.previousEntryHash,
      formatDate(entry.timestamp),
      JSON.stringify(entry.payload || {})
    ]
      .filter((item) => item !== undefined && item !== null)
      .join(" ")

    return raw.toLowerCase()
  }

  async function resolveEntryQrPayload(entry) {
    if (entry?.payload?.qrPayload) {
      return entry.payload.qrPayload
    }

    if (entry?.documentId) {
      const response = await api.getDocument(token, entry.documentId)
      return response?.data?.qrPayload || null
    }

    return null
  }

  function downloadJsonFile({ fileName, payload }) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = window.document.createElement("a")
    anchor.href = url
    anchor.download = fileName
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function downloadSelectedEntryJson() {
    if (!selectedEntry) return

    setEntryActionBusy(true)
    setEntryActionError("")
    setEntryActionMessage("")

    try {
      downloadJsonFile({
        fileName: `audit-entry-${selectedEntry.sequenceNumber}.json`,
        payload: selectedEntry
      })
      setEntryActionMessage(`Downloaded audit entry #${selectedEntry.sequenceNumber}`)
    } catch (actionError) {
      setEntryActionError(actionError.message || "Could not download selected entry")
    } finally {
      setEntryActionBusy(false)
    }
  }

  async function downloadSelectedDocumentPdf() {
    if (!selectedEntry?.documentId) return

    setEntryActionBusy(true)
    setEntryActionError("")
    setEntryActionMessage("")

    try {
      const safeDocumentId = encodeURIComponent(String(selectedEntry.documentId).trim())
      const downloadUrl = `${API_BASE_URL}/documents/${safeDocumentId}/download`

      async function requestDownload(idToken) {
        return fetch(downloadUrl, {
          headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
        })
      }

      let response = await requestDownload(token)

      if ((response.status === 401 || response.status === 403) && firebaseUser) {
        const refreshedToken = await firebaseUser.getIdToken(true)
        response = await requestDownload(refreshedToken)
      }

      if (!response.ok) {
        const contentType = response.headers.get("content-type") || ""
        const isJson = contentType.includes("application/json")
        const payload = isJson ? await response.json() : await response.text()
        const message = isJson
          ? payload?.error?.message || payload?.message || t("Could not download document PDF")
          : String(payload || t("Could not download document PDF"))
        throw new Error(message)
      }

      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      const anchor = window.document.createElement("a")
      anchor.href = blobUrl
      anchor.download = `${selectedEntry.documentId}.pdf`
      window.document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1200)
      setEntryActionMessage(`Downloaded PDF for ${selectedEntry.documentId}`)
    } catch (actionError) {
      setEntryActionError(actionError.message || "Could not download selected document")
    } finally {
      setEntryActionBusy(false)
    }
  }

  async function downloadSelectedQrJson() {
    if (!selectedEntry) return

    setEntryActionBusy(true)
    setEntryActionError("")
    setEntryActionMessage("")

    try {
      const qrPayload = await resolveEntryQrPayload(selectedEntry)

      if (!qrPayload) {
        throw new Error(t("No QR payload available for selected entry"))
      }

      downloadJsonFile({
        fileName: `qr-payload-${selectedEntry.documentId || selectedEntry.sequenceNumber}.json`,
        payload: qrPayload
      })
      setEntryActionMessage("Downloaded selected QR payload JSON")
    } catch (actionError) {
      setEntryActionError(actionError.message || "Could not download QR JSON")
    } finally {
      setEntryActionBusy(false)
    }
  }

  async function downloadSelectedQrPng() {
    if (!selectedEntry) return

    setEntryActionBusy(true)
    setEntryActionError("")
    setEntryActionMessage("")

    try {
      const qrPayload = await resolveEntryQrPayload(selectedEntry)

      if (!qrPayload) {
        throw new Error(t("No QR payload available for selected entry"))
      }

      const image = await QRCode.toDataURL(JSON.stringify(qrPayload), { width: 280, margin: 1 })
      const anchor = window.document.createElement("a")
      anchor.href = image
      anchor.download = `qr-${selectedEntry.documentId || selectedEntry.sequenceNumber}.png`
      anchor.click()
      setEntryActionMessage("Downloaded selected QR as PNG")
    } catch (actionError) {
      setEntryActionError(actionError.message || "Could not download QR PNG")
    } finally {
      setEntryActionBusy(false)
    }
  }

  const filteredEntries = entries.filter((entry) => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    const normalizedAction = String(entry.action || "").toLowerCase()
    const normalizedIntegrity = String(entry.integrityStatus || "valid").toLowerCase()
    const normalizedDocument = String(entry.documentId || "").toLowerCase()
    const entryDate = entry.timestamp ? new Date(entry.timestamp) : null

    const matchesQuery = !normalizedQuery || toSearchText(entry).includes(normalizedQuery)
    const matchesAction = actionFilter === "all" || normalizedAction.includes(actionFilter)
    const matchesIntegrity = integrityFilter === "all" || normalizedIntegrity === integrityFilter
    const matchesDocument = !documentFilter.trim() || normalizedDocument.includes(documentFilter.trim().toLowerCase())
    const matchesFrom = !dateFrom || (entryDate && entryDate >= new Date(`${dateFrom}T00:00:00`))
    const matchesTo = !dateTo || (entryDate && entryDate <= new Date(`${dateTo}T23:59:59`))

    return Boolean(matchesQuery && matchesAction && matchesIntegrity && matchesDocument && matchesFrom && matchesTo)
  })
  const uniqueDocumentCount = new Set(entries.map((entry) => entry.documentId).filter(Boolean)).size
  const verificationEventCount = entries.filter((entry) => String(entry.action || "").includes("VERIFIED")).length
  const integrityIssueCount = entries.filter((entry) => String(entry.integrityStatus || "valid") !== "valid").length
  const chainStatusLabel = chainResult ? (chainResult.isValid ? t("Healthy") : t("Issue detected")) : t("Unknown")
  const lastIntegrityCheckAt = chainResult?.checkedAt || entries[0]?.timestamp || null

  return (
    <div className="page-stack">
      <section className="card filter-toolbar">
        <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
          <option value="all">{t("Action Type")}</option>
          <option value="issue">{t("Issue")}</option>
          <option value="verify">{t("Verify")}</option>
          <option value="revoke">{t("Revoke")}</option>
          <option value="replace">{t("Replace")}</option>
        </select>
        <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label={t("Date from")} />
        <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label={t("Date to")} />
        <input value={documentFilter} onChange={(event) => setDocumentFilter(event.target.value)} placeholder={t("Document ID")} />
        <select value={integrityFilter} onChange={(event) => setIntegrityFilter(event.target.value)}>
          <option value="all">{t("Integrity Status")}</option>
          <option value="valid">{t("Healthy")}</option>
          <option value="warning">{t("Warning")}</option>
          <option value="invalid">{t("Invalid")}</option>
        </select>
      </section>

      <section className="chain-summary-grid audit-chain-summary">
        <article className="card">
          <p>{t("Current Chain Status")}</p>
          <h3>{chainStatusLabel}</h3>
        </article>
        <article className="card">
          <p>{t("Last Integrity Verification")}</p>
          <h3>{formatDate(lastIntegrityCheckAt)}</h3>
        </article>
        <article className="card">
          <p>{t("Total Entries")}</p>
          <h3>{entries.length}</h3>
        </article>
      </section>

      <section className="card page-stack audit-main-card">
        <div className="section-head">
          <h3>{t("Immutable Audit Ledger")}</h3>
          <div className="action-row">
            <button className="btn btn-secondary" onClick={verifyChain}>{t("Verify Chain")}</button>
            <button className="btn btn-primary" onClick={exportSnapshot} disabled={snapshotBusy}>
              {snapshotBusy ? t("Exporting...") : t("Export Signed Snapshot")}
            </button>
          </div>
        </div>

        <p className="inline-note">{t("Every issuance and verification event is chained by sequence, previous hash, and current hash for traceable evidence.")}</p>

        <section className="kpi-grid audit-kpi-grid">
          <article className="card kpi-card">
            <p>{t("Total Events")}</p>
            <h3>{entries.length}</h3>
          </article>
          <article className="card kpi-card">
            <p>{t("Documents Referenced")}</p>
            <h3>{uniqueDocumentCount}</h3>
          </article>
          <article className="card kpi-card">
            <p>{t("Verification Events")}</p>
            <h3>{verificationEventCount}</h3>
          </article>
          <article className="card kpi-card">
            <p>{t("Integrity Alerts")}</p>
            <h3>{integrityIssueCount}</h3>
          </article>
        </section>

        {error ? <ErrorState title={t("Audit Error")} body={error} /> : null}
        {snapshotError ? <ErrorState title={t("Snapshot Export Error")} body={snapshotError} /> : null}
        {snapshotMessage ? <Toast message={snapshotMessage} /> : null}

        <label>
          {t("Search events")}
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t("Filter by seq, action, actor, document ID, hash, or payload")}
          />
        </label>

        <section className="card soft page-stack audit-actions-card">
        <h4>{t("Selected Audit Entry Actions")}</h4>
        <p className="inline-note">
          {selectedEntry
            ? `${t("Selected")} #${selectedEntry.sequenceNumber} (${selectedEntry.action})`
            : t("Select an audit row below to enable targeted downloads.")}
        </p>
        <div className="action-row">
          <button className="btn btn-secondary" onClick={downloadSelectedEntryJson} disabled={!selectedEntry || entryActionBusy}>
            {t("Download Entry JSON")}
          </button>
          <button className="btn btn-secondary" onClick={downloadSelectedDocumentPdf} disabled={!selectedEntry?.documentId || entryActionBusy}>
            {t("Download Selected PDF")}
          </button>
          <button className="btn btn-secondary" onClick={downloadSelectedQrJson} disabled={!selectedEntry || entryActionBusy}>
            {t("Download QR JSON")}
          </button>
          <button className="btn btn-secondary" onClick={downloadSelectedQrPng} disabled={!selectedEntry || entryActionBusy}>
            {t("Download QR PNG")}
          </button>
        </div>
        {entryActionError ? <ErrorState title={t("Entry Action Error")} body={entryActionError} /> : null}
        {entryActionMessage ? <Toast message={entryActionMessage} /> : null}
        {selectedQrImage ? <img className="qr-image" src={selectedQrImage} alt={t("Selected entry QR")} /> : null}
      </section>

      <div className="audit-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("Select")}</th>
            <th>{t("Seq")}</th>
            <th>{t("Action")}</th>
            <th>{t("Document")}</th>
            <th>{t("Actor")}</th>
            <th>{t("Hash Proof")}</th>
            <th>{t("Integrity")}</th>
            <th>{t("Timestamp")}</th>
          </tr>
        </thead>
        <tbody>
          {filteredEntries.length ? filteredEntries.map((entry) => (
            <tr
              key={entry.entryId}
              className={entry.entryId === selectedEntryId ? "selected-row" : ""}
              onClick={() => setSelectedEntryId(entry.entryId)}
            >
              <td data-label={t("Select")}>
                <input
                  type="radio"
                  name="selected-audit-entry"
                  checked={entry.entryId === selectedEntryId}
                  onChange={() => setSelectedEntryId(entry.entryId)}
                  onClick={(event) => event.stopPropagation()}
                />
              </td>
              <td data-label={t("Seq")}>{entry.sequenceNumber}</td>
              <td data-label={t("Action")}>{entry.action}</td>
              <td data-label={t("Document")}>{entry.documentId || "-"}</td>
              <td data-label={t("Actor")}>{entry.actorType || "-"}</td>
              <td data-label={t("Hash Proof")}>{shortHash(entry.currentEntryHash)}</td>
              <td data-label={t("Integrity")}>{entry.integrityStatus || "valid"}</td>
              <td data-label={t("Timestamp")}>{formatDate(entry.timestamp)}</td>
            </tr>
          )) : (
            <tr>
              <td colSpan={8} data-label={t("Results")}>{t("No audit entries match your search.")}</td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
      </section>
    </div>
  )
}

function TrustScorePage() {
  const { token, profile } = useAuth()
  const { t } = useLanguage()
  const [trust, setTrust] = useState(null)
  const [history, setHistory] = useState([])
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true

    async function load() {
      if (!profile?._id) return

      try {
        const trustResponse = await api.trustScore(profile._id)
        const trustData = trustResponse?.data || null
        let historyData = Array.isArray(trustData?.history) ? trustData.history : []

        if (token) {
          try {
            const historyResponse = await api.trustHistory(token, profile._id)
            if (Array.isArray(historyResponse?.data)) {
              historyData = historyResponse.data
            }
          } catch {
            // Fall back to embedded trust history when the dedicated history endpoint is unavailable.
          }
        }

        if (!active) return
        setTrust(trustData)
        setHistory(historyData)
        setError("")
      } catch (loadError) {
        if (!active) return
        setError(loadError.message || t("Could not load trust score"))
      }
    }

    load()

    return () => {
      active = false
    }
  }, [profile, token])

  const embeddedHistory = Array.isArray(trust?.history) ? trust.history : []
  const historyFeed = history.length ? history : embeddedHistory
  const latestHistoryEntry = historyFeed.length ? historyFeed[historyFeed.length - 1] : null
  const historyForChart = historyFeed.length
    ? historyFeed.slice(-7)
    : Number.isFinite(Number(trust?.currentScore))
      ? [{
        eventId: "current-score",
        newScore: Number(trust.currentScore),
        computedAt: trust?.lastComputedAt || new Date().toISOString(),
      }]
      : []
  const hasTrustActivity =
    Number(trust?.metrics?.totalVerifications || 0) > 0 ||
    Number(trust?.metrics?.tamperedDetections || 0) > 0 ||
    Number(trust?.metrics?.revokedDocuments || 0) > 0 ||
    historyFeed.length > 0 ||
    Number(trust?.currentScore || 0) > 0
  const displayScore = hasTrustActivity ? trust?.currentScore ?? "-" : "-"
  const displayBand = hasTrustActivity ? trust?.scoreBand || "-" : t("Not Rated")
  const scoreTrend = historyFeed.length > 1
    ? Number(historyFeed[historyFeed.length - 1]?.newScore || 0) - Number(historyFeed[Math.max(0, historyFeed.length - 2)]?.newScore || 0)
    : 0
  const chartMax = Math.max(1, ...historyForChart.map((item) => Number(item.newScore || 0)))
  const chartMin = historyForChart.length ? Math.min(...historyForChart.map((item) => Number(item.newScore || 0))) : 0
  const chartRange = Math.max(1, chartMax - chartMin)
  const latestChartScore = historyForChart.length ? Number(historyForChart[historyForChart.length - 1]?.newScore || 0) : null
  const trustMetrics = trust?.metrics || {}
  const weightBreakdown = latestHistoryEntry?.weightsApplied || {}

  return (
    <div className="page-stack">
      <section className="trust-top-grid">
        <article className="card trust-score-card">
          <p>{t("Current Score")}</p>
          <h2>{displayScore}</h2>
          <p>{displayBand}</p>
          <p>{t("Trend")}: {scoreTrend >= 0 ? "+" : ""}{scoreTrend.toFixed(1)} {t("from latest event")}</p>
        </article>

        <article className="card">
          <h3>{t("Formula Breakdown")}</h3>
          <ul className="formula-list">
            <li>
              <span>{t("Base score")}</span>
              <strong>{Number(weightBreakdown.base || 50).toFixed(1)}</strong>
            </li>
            <li>
              <span>{t("Issuer age contribution")}</span>
              <strong>{Number(weightBreakdown.issuerAgeWeight || 0).toFixed(1)}</strong>
            </li>
            <li>
              <span>{t("Successful verification contribution")}</span>
              <strong>{Number(weightBreakdown.successRateWeight || 0).toFixed(1)}</strong>
            </li>
            <li>
              <span>{t("Verification volume contribution")}</span>
              <strong>{Number(weightBreakdown.volumeConfidenceWeight || 0).toFixed(1)}</strong>
            </li>
            <li>
              <span>{t("Clean recent contribution")}</span>
              <strong>{Number(weightBreakdown.cleanRecentWeight || 0).toFixed(1)}</strong>
            </li>
            <li>
              <span>{t("Tamper penalty")}</span>
              <strong>-{Number(weightBreakdown.tamperPenalty || 0).toFixed(1)}</strong>
            </li>
            <li>
              <span>{t("Revoked penalty")}</span>
              <strong>-{Number(weightBreakdown.revokedPenalty || 0).toFixed(1)}</strong>
            </li>
            <li>
              <span>{t("Anomaly penalty")}</span>
              <strong>-{Number(weightBreakdown.anomalyPenalty || 0).toFixed(1)}</strong>
            </li>
          </ul>
        </article>
      </section>

      <section className="card">
        <h3>{t("Score History")}</h3>
        {error ? <ErrorState title={t("Trust Error")} body={error} /> : null}
        <div className="history-chart-shell">
          {historyForChart.length ? (
            <>
              <div className="history-chart-meta">
                <small>{t("Latest")}: {latestChartScore?.toFixed(1)}</small>
                <small>{t("Range")}: {chartMin.toFixed(1)} - {chartMax.toFixed(1)}</small>
              </div>
              <div className="history-chart">
                {historyForChart.map((item, index) => {
                  const value = Number(item.newScore || 0)
                  const normalized = historyForChart.length === 1
                    ? 72
                    : Math.max(12, Math.round(((value - chartMin) / chartRange) * 100))

                  return (
                    <div key={item.eventId || `${item.computedAt}-${index}`} className="bar-wrap">
                      <small className="bar-value">{value.toFixed(1)}</small>
                      <div className="history-bar-track">
                        <div style={{ height: `${normalized}%` }} className="history-bar" />
                      </div>
                      <small className="bar-index">{index + 1}</small>
                    </div>
                  )
                })}
              </div>
            </>
          ) : <p className="inline-note">{t("No trust history yet")}</p>}
        </div>
        <p className="inline-note">
          {t("Totals")}: {t("Verifications")} {Number(trustMetrics.totalVerifications || 0)}, {t("Successful")} {Number(trustMetrics.successfulVerifications || 0)}, {t("Tampered")} {Number(trustMetrics.tamperedDetections || 0)}, {t("Revoked")} {Number(trustMetrics.revokedDocuments || 0)}
        </p>
      </section>
    </div>
  )
}

function ProfilePage() {
  const { token, profile, refreshProfile } = useAuth()
  const { t } = useLanguage()
  const [form, setForm] = useState({
    displayName: "",
    contactPhone: "",
    institutionName: "",
    institutionType: "",
    primaryDomain: "",
    verificationContactEmail: "",
    timeZone: "UTC",
  })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    setForm({
      displayName: profile?.displayName || "",
      contactPhone: profile?.contactPhone || "",
      institutionName: profile?.institutionName || "",
      institutionType: profile?.institutionType || "",
      primaryDomain: profile?.publicIssuerProfile?.primaryDomain || "",
      verificationContactEmail: profile?.publicIssuerProfile?.verificationContactEmail || profile?.email || "",
      timeZone: profile?.publicIssuerProfile?.timeZone || "UTC",
    })
  }, [profile])

  async function save() {
    setBusy(true)
    setError("")
    setMessage("")

    try {
      await api.authUpdateMe(token, {
        displayName: form.displayName,
        contactPhone: form.contactPhone,
      })

      await api.institutionUpdateProfile(token, {
        institutionName: form.institutionName,
        institutionType: form.institutionType,
        contactPhone: form.contactPhone,
      })

      await refreshProfile()
      setMessage(t("Profile updated"))
    } catch (saveError) {
      setError(saveError.message || t("Could not update profile"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-stack profile-page">
      <section className="card">
        <h3>{t("Institution Profile")}</h3>
        <form className="form-grid two-col-form" onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}>
          <label>
            {t("Institution Name")}
            <input value={form.institutionName} onChange={(event) => setForm((prev) => ({ ...prev, institutionName: event.target.value }))} />
          </label>
          <label>
            {t("Primary Domain")}
            <input value={form.primaryDomain} onChange={(event) => setForm((prev) => ({ ...prev, primaryDomain: event.target.value }))} />
          </label>
          <label>
            {t("Verification Contact Email")}
            <input value={form.verificationContactEmail} onChange={(event) => setForm((prev) => ({ ...prev, verificationContactEmail: event.target.value }))} />
          </label>
          <label>
            {t("Time Zone")}
            <select value={form.timeZone} onChange={(event) => setForm((prev) => ({ ...prev, timeZone: event.target.value }))}>
              <option value="UTC">UTC</option>
              <option value="IST">IST</option>
            </select>
          </label>
          <label>
            {t("Display Name")}
            <input value={form.displayName} onChange={(event) => setForm((prev) => ({ ...prev, displayName: event.target.value }))} />
          </label>
          <label>
            {t("Contact Phone")}
            <input value={form.contactPhone} onChange={(event) => setForm((prev) => ({ ...prev, contactPhone: event.target.value }))} />
          </label>
          <label>
            {t("Institution Type")}
            <input value={form.institutionType} onChange={(event) => setForm((prev) => ({ ...prev, institutionType: event.target.value }))} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t("Saving...") : t("Save Profile")}</button>
        </form>
      </section>

      <section className="card">
        <h3>{t("Status System")}</h3>
        <div className="status-grid">
          <StatusBadge status="verified" />
          <StatusBadge status="tampered" />
          <StatusBadge status="suspicious" />
          <StatusBadge status="revoked" />
          <StatusBadge status="pending" />
          <StatusBadge status="error" />
          <StatusBadge status="notfound" />
        </div>
      </section>

      {message ? <Toast message={message} /> : null}
      {error ? <ErrorState title={t("Profile Error")} body={error} /> : null}
    </div>
  )
}

function PageLoading() {
  const { t } = useLanguage()

  return (
    <section className="card">
      <p>{t("Loading")}</p>
    </section>
  )
}

function StatusBadge({ status, large = false }) {
  const { t } = useLanguage()
  const normalized = String(status || "pending").toLowerCase()
  const labels = {
    verified: t("Verified"),
    valid: t("Verified"),
    issued: t("Issued"),
    tampered: t("Tampered"),
    suspicious: t("Suspicious"),
    revoked: t("Revoked"),
    pending: t("Pending"),
    error: t("Error"),
    notfound: t("Not Found"),
  }

  const label = labels[normalized] || normalized

  return (
    <span className={`status-badge ${normalized} ${large ? "large" : ""}`.trim()}>
      <span className="status-dot" aria-hidden="true" />
      {label}
    </span>
  )
}

function EmptyState({ title, body, compact = false }) {
  const { t } = useLanguage()
  return (
    <article className={`empty-state ${compact ? "compact" : ""}`.trim()}>
      <h4>{t(title || "")}</h4>
      <p>{t(body || "No data available.")}</p>
    </article>
  )
}

function ErrorState({ title, body }) {
  const { t } = useLanguage()
  return (
    <article className="error-state">
      <h4>{t(title || "Something went wrong")}</h4>
      <p>{t(body || "")}</p>
    </article>
  )
}

function Toast({ message }) {
  const { t } = useLanguage()
  return <div className="toast success">{t(message || "Updated")}</div>
}

function formatDate(value) {
  if (!value) return "-"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString()
}

function shortHash(value) {
  if (!value || value.length < 14) return value || "-"
  return `${value.slice(0, 8)}...${value.slice(-6)}`
}

export default App
