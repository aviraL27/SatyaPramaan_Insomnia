import { useEffect, useMemo, useState } from "react"
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
import { API_BASE_URL, api } from "./lib/api"

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

function App() {
  return (
    <AuthProvider>
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
  return (
    <div className="public-shell">
      <header className="public-header minimal-header">
        <Link to="/" className="brand-mark header-brand">
          <span>DigiSecure</span>
        </Link>
      </header>
      <main className="public-main">
        <Outlet />
      </main>
    </div>
  )
}

function InstitutionLayout() {
  const { profile, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate("/", { replace: true })
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar open">
        <div className="sidebar-top">
          <div className="brand-mark header-brand">
            <span>DigiSecure</span>
          </div>
          <small>{profile?.institutionName || profile?.displayName || "Institution Console"}</small>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.path} to={item.path} className={({ isActive }) => (isActive ? "sidebar-link active" : "sidebar-link")}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="app-main-area">
        <header className="topbar">
          <div className="topbar-left">
            <h1>Institution Workspace</h1>
          </div>
          <div className="topbar-right">
            <button className="btn btn-ghost" onClick={() => navigate("/verify")}>Public Verify</button>
            <button className="btn btn-primary" onClick={handleLogout}>Logout</button>
          </div>
        </header>
        <main className="workspace-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function LandingPage() {
  return (
    <div className="main-landing">
      <section className="card landing-intro">
        <p className="eyebrow">DigiSecure Trust Network</p>
        <h2>Secure document issuance, verification, and immutable audit trails.</h2>
        <p>Backend is live. Connect your institution account and start issuing verifiable documents.</p>
      </section>

      <section className="landing-choices">
        <Link to="/auth?mode=signin" className="landing-choice-card">
          <h3>Sign In</h3>
          <p>Use existing Firebase credentials and continue to your institution dashboard.</p>
          <span className="btn btn-primary">Continue</span>
        </Link>

        <Link to="/auth?mode=register" className="landing-choice-card">
          <h3>Register Institution</h3>
          <p>Create an institution account and bootstrap your issuer identity.</p>
          <span className="btn btn-secondary">Start</span>
        </Link>
      </section>

      <section className="card landing-secondary-actions">
        <div>
          <h4>Public Verification</h4>
          <p>Scan QR payloads or upload PDFs to verify authenticity.</p>
        </div>
        <Link to="/verify" className="btn btn-ghost">Open Verification</Link>
      </section>
    </div>
  )
}

function AuthPage() {
  const { signIn, signInWithGoogle, registerInstitution, bootstrapExistingUser, isAuthenticated, profile, loading, isFirebaseConfigured } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
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

  return (
    <section className="auth-layout card">
      <div className="auth-panel">
        <h3>{mode === "signin" ? "Sign In" : "Register Institution"}</h3>
        <p className="inline-note">Firebase authentication + backend bootstrap.</p>

        <div className="toggle-row">
          <button type="button" className={mode === "signin" ? "toggle-btn active" : "toggle-btn"} onClick={() => setMode("signin")}>Sign In</button>
          <button type="button" className={mode === "register" ? "toggle-btn active" : "toggle-btn"} onClick={() => setMode("register")}>Register</button>
        </div>

        <form className="form-grid" onSubmit={onSubmit}>
          {!isFirebaseConfigured ? (
            <ErrorState
              title="Firebase Config Missing"
              body="Set VITE_FIREBASE_* values in frontend env before using sign-in or registration."
            />
          ) : null}

          <label>
            Work Email
            <input type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} required />
          </label>

          <label>
            Password
            <input type="password" value={form.password} onChange={(event) => updateField("password", event.target.value)} required minLength={8} />
          </label>

          {mode === "register" ? (
            <>
              <label>
                Display Name
                <input type="text" value={form.displayName} onChange={(event) => updateField("displayName", event.target.value)} required />
              </label>
              <label>
                Institution Name
                <input type="text" value={form.institutionName} onChange={(event) => updateField("institutionName", event.target.value)} required />
              </label>
              <label>
                Institution Code
                <input type="text" value={form.institutionCode} onChange={(event) => updateField("institutionCode", event.target.value)} required />
              </label>
              <label>
                Institution Type
                <input type="text" value={form.institutionType} onChange={(event) => updateField("institutionType", event.target.value)} />
              </label>
              <label>
                Role
                <select value={form.role} onChange={(event) => updateField("role", event.target.value)}>
                  <option value="institution_admin">Institution Admin</option>
                  <option value="institution_operator">Institution Operator</option>
                  <option value="verifier">Verifier</option>
                </select>
              </label>
            </>
          ) : null}

          {error ? <ErrorState title="Authentication Error" body={error} /> : null}

          <button className="btn btn-google" type="button" onClick={onGoogleAuth} disabled={busy || !isFirebaseConfigured}>
            <span className="google-mark" aria-hidden="true">G</span>
            {busy ? "Please wait..." : "Continue with Google"}
          </button>
          <p className="inline-note">Google OAuth uses your Firebase project and auto-creates backend profile if needed.</p>

          <div className="auth-divider" role="separator" aria-label="Or continue with email credentials">
            <span>or continue with email</span>
          </div>

          <button className="btn btn-primary" type="submit" disabled={busy || !isFirebaseConfigured}>
            {busy ? "Please wait..." : mode === "signin" ? "Sign In" : "Create Account"}
          </button>
        </form>
      </div>
    </section>
  )
}

function DashboardPage() {
  const { token, profile } = useAuth()
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

  const documentAuditEntries = useMemo(
    () => (audit || []).filter((entry) => Boolean(entry?.documentId)).length,
    [audit]
  )
  const hasTrustActivity =
    Number(trust?.metrics?.totalVerifications || 0) > 0 ||
    Number(trust?.metrics?.tamperedDetections || 0) > 0 ||
    Number(trust?.metrics?.revokedDocuments || 0) > 0 ||
    documents.length > 0
  const trustDisplayValue = hasTrustActivity ? trust?.currentScore ?? "-" : "-"

  return (
    <div className="page-stack">
      <section className="card">
        <h3>Operational Snapshot</h3>
        <p>{error || "Connected to backend and loading live data."}</p>
      </section>

      <section className="kpi-grid">
        <article className="card kpi-card">
          <p>Documents Issued</p>
          <h3>{documents.length}</h3>
        </article>
        <article className="card kpi-card">
          <p>Audit Entries (Docs)</p>
          <h3>{documentAuditEntries}</h3>
        </article>
        <article className="card kpi-card">
          <p>Trust Score</p>
          <h3>{trustDisplayValue}</h3>
        </article>
      </section>

      <section className="card">
        <div className="section-head">
          <h3>Recent Documents</h3>
          <Link to="/app/documents" className="btn btn-ghost">View All</Link>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Recipient</th>
              <th>Issued</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {documents.slice(0, 5).map((document) => (
              <tr key={document.documentId}>
                <td data-label="Title">
                  <Link className="link-inline" to={`/app/documents/${document.documentId}`}>{document.title}</Link>
                </td>
                <td data-label="Recipient">{document.recipientName}</td>
                <td data-label="Issued">{formatDate(document.issuedAt)}</td>
                <td data-label="Status"><StatusBadge status={document.status || "issued"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function IssueDocumentPage() {
  const { token } = useAuth()
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
    } catch (submitError) {
      setError(submitError.message || "Issuance failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card page-stack">
      <h3>Issue Secure Document</h3>
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>Title<input value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} required /></label>
        <label>Document Type<input value={form.documentType} onChange={(event) => setForm((prev) => ({ ...prev, documentType: event.target.value }))} required /></label>
        <label>Recipient Name<input value={form.recipientName} onChange={(event) => setForm((prev) => ({ ...prev, recipientName: event.target.value }))} required /></label>
        <label>Recipient Reference<input value={form.recipientReference} onChange={(event) => setForm((prev) => ({ ...prev, recipientReference: event.target.value }))} /></label>
        <label>Metadata JSON<textarea value={form.metadata} onChange={(event) => setForm((prev) => ({ ...prev, metadata: event.target.value }))} rows={4} /></label>
        <label>PDF File<input type="file" accept="application/pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} required /></label>

        {message ? <Toast message={message} variant="success" /> : null}
        {error ? <ErrorState title="Issuance Error" body={error} /> : null}

        <button className={busy ? "btn btn-primary is-loading" : "btn btn-primary"} disabled={busy} aria-busy={busy}>
          {busy ? (
            <>
              <span className="btn-spinner" aria-hidden="true" />
              <span>Issuing Document...</span>
            </>
          ) : (
            "Issue Document"
          )}
        </button>
      </form>

      {issuedDocument ? (
        <section className="card soft qr-preview-block">
          <h4>Issued QR And Payload</h4>
          <div className="qr-preview-grid">
            <div>
              {qrCodeImage ? <img className="qr-image" src={qrCodeImage} alt="Issued document QR code" /> : null}
            </div>
            <div>
              <p><strong>Document ID:</strong> {issuedDocument.documentId}</p>
              <div className="action-row">
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => navigator.clipboard.writeText(JSON.stringify(issuedDocument.qrPayload || {}, null, 2))}
                >
                  Copy QR JSON
                </button>
              </div>
              <pre className="code-block">{JSON.stringify(issuedDocument.qrPayload || {}, null, 2)}</pre>
            </div>
          </div>
        </section>
      ) : null}
    </section>
  )
}

function DocumentsPage() {
  const { token } = useAuth()
  const [documents, setDocuments] = useState([])
  const [error, setError] = useState("")

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

  async function revoke(documentId) {
    const reason = window.prompt("Revocation reason")
    if (!reason) return

    try {
      await api.revokeDocument(token, documentId, reason)
      const response = await api.listDocuments(token)
      setDocuments(response.data || [])
    } catch (revokeError) {
      setError(revokeError.message || "Revoke failed")
    }
  }

  return (
    <section className="card page-stack">
      <h3>Issued Documents</h3>
      {error ? <ErrorState title="Document Error" body={error} /> : null}
      <table className="data-table">
        <thead>
          <tr>
            <th>Document ID</th>
            <th>Title</th>
            <th>Recipient</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => (
            <tr key={document.documentId}>
              <td data-label="Document ID">{document.documentId}</td>
              <td data-label="Title">
                <Link to={`/app/documents/${document.documentId}`} className="link-inline">{document.title}</Link>
              </td>
              <td data-label="Recipient">{document.recipientName}</td>
              <td data-label="Status"><StatusBadge status={document.status} /></td>
              <td data-label="Actions" className="action-row">
                <button className="btn btn-ghost" onClick={() => revoke(document.documentId)}>Revoke</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function DocumentDetailPage() {
  const { token } = useAuth()
  const { documentId } = useParams()
  const [document, setDocument] = useState(null)
  const [versions, setVersions] = useState([])
  const [error, setError] = useState("")
  const [replaceFile, setReplaceFile] = useState(null)
  const [qrCodeImage, setQrCodeImage] = useState("")

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const [docResponse, versionsResponse] = await Promise.all([
          api.getDocument(token, documentId),
          api.documentVersions(token, documentId),
        ])
        if (!active) return
        setDocument(docResponse.data)
        setVersions(versionsResponse.data || [])
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
      const [docResponse, versionsResponse] = await Promise.all([
        api.getDocument(token, documentId),
        api.documentVersions(token, documentId),
      ])
      setDocument(docResponse.data)
      setVersions(versionsResponse.data || [])
      setReplaceFile(null)
    } catch (replaceError) {
      setError(replaceError.message || "Replace failed")
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
    return <section className="card">{error ? <ErrorState title="Document Error" body={error} /> : <PageLoading />}</section>
  }

  return (
    <div className="page-stack">
      <section className="card">
        <h3>{document.title}</h3>
        <p>Document ID: {document.documentId}</p>
        <p>Recipient: {document.recipientName}</p>
        <p>Status: <StatusBadge status={document.status} /></p>
        <div className="action-row">
          <button className="btn btn-primary" onClick={downloadDocument}>Download Issued PDF</button>
        </div>
      </section>

      {document.qrPayload ? (
        <section className="card page-stack">
          <h4>QR Evidence</h4>
          {qrCodeImage ? <img className="qr-image" src={qrCodeImage} alt="Document QR code" /> : null}
          <div className="action-row">
            <button
              className="btn btn-secondary"
              onClick={() => navigator.clipboard.writeText(JSON.stringify(document.qrPayload, null, 2))}
            >
              Copy QR JSON
            </button>
            <button className="btn btn-secondary" onClick={downloadQrPng} disabled={!qrCodeImage}>
              Download QR PNG
            </button>
          </div>
          <pre className="code-block">{JSON.stringify(document.qrPayload, null, 2)}</pre>
        </section>
      ) : null}

      <section className="card page-stack">
        <h4>Replace Document</h4>
        <label>Replacement PDF<input type="file" accept="application/pdf" onChange={(event) => setReplaceFile(event.target.files?.[0] || null)} /></label>
        <button className="btn btn-secondary" onClick={replaceDocument}>Replace</button>
      </section>

      <section className="card">
        <h4>Version Chain</h4>
        <ul className="activity-list">
          {versions.map((version) => (
            <li key={version.documentId}>
              <div>
                <strong>{version.documentId}</strong>
                <small>Version {version.versionNumber} • {formatDate(version.issuedAt)}</small>
              </div>
              <StatusBadge status={version.status} />
            </li>
          ))}
        </ul>
      </section>

      {error ? <ErrorState title="Action Error" body={error} /> : null}
    </div>
  )
}

function PublicVerificationPage() {
  const { token, isAuthenticated } = useAuth()
  const navigate = useNavigate()
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
      const parsed = JSON.parse(qrPayload)
      const response = await api.verifyQrPublic(parsed)
      navigate("/result", { state: { source: "qr", response: response.data } })
    } catch (verifyError) {
      setError(verifyError.message || "QR verification failed")
    } finally {
      setBusy(false)
      setActiveVerification("")
    }
  }

  async function verifyUpload() {
    if (!uploadFile) {
      setError("Select a PDF file")
      return
    }

    setBusy(true)
    setActiveVerification("upload")
    setError("")

    try {
      const formData = new FormData()
      formData.append("file", uploadFile)

      if (documentId) formData.append("documentId", documentId)
      if (qrPayload) formData.append("qrPayload", qrPayload)

      const response = isAuthenticated
        ? await api.verifyUploadAuth(token, formData)
        : await api.verifyUploadPublic(formData)

      navigate("/result", { state: { source: "upload", response: response.data, uploadedFile: uploadFile } })
    } catch (verifyError) {
      setError(verifyError.message || "Upload verification failed")
    } finally {
      setBusy(false)
      setActiveVerification("")
    }
  }

  return (
    <section className="card page-stack">
      <h3>Public Verification</h3>
      <p className="inline-note">Submit QR payload or upload PDF. Authenticated users can use private verify route.</p>

      <label>
        QR Payload JSON
        <textarea rows={7} value={qrPayload} onChange={(event) => setQrPayload(event.target.value)} placeholder='{"documentId":"..."}' />
      </label>
      <button
        className={busy && activeVerification === "qr" ? "btn btn-secondary is-loading" : "btn btn-secondary"}
        onClick={verifyQr}
        disabled={busy || !qrPayload}
        aria-busy={busy && activeVerification === "qr"}
      >
        {busy && activeVerification === "qr" ? (
          <>
            <span className="btn-spinner" aria-hidden="true" />
            <span>Verifying QR...</span>
          </>
        ) : (
          "Verify QR"
        )}
      </button>

      <label>
        Document ID (optional when QR payload exists)
        <input value={documentId} onChange={(event) => setDocumentId(event.target.value)} />
      </label>
      <label>
        PDF File
        <input type="file" accept="application/pdf" onChange={(event) => setUploadFile(event.target.files?.[0] || null)} />
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
            <span>Verifying Upload...</span>
          </>
        ) : (
          "Verify Upload"
        )}
      </button>

      {error ? <ErrorState title="Verification Error" body={error} /> : null}
    </section>
  )
}

function VerificationResultPage() {
  const { token } = useAuth()
  const location = useLocation()
  const [payload, setPayload] = useState(location.state?.response || null)
  const [uploadedFile] = useState(location.state?.uploadedFile || null)
  const [pollError, setPollError] = useState("")

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
        <EmptyState title="No verification result" body="Run a verification from the verification page first." />
      </section>
    )
  }

  const result = payload.result || payload
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
  const visualFlaggedPages = (result.tamperFindings?.visualChangedPages || visualDiffScoreByPage
    .filter((entry) => Number(entry?.score) > 0)
    .map((entry) => Number(entry.pageNumber)))
    .filter((value) => Number.isFinite(value) && value > 0)
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
      ? `Triggered by ${triggerLabels.join(", ")}`
      : result.reason || result.resultMessage || "No detector trigger metadata was returned"
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
  const normalizedStatus = String(result.status || "").toLowerCase()
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

  return (
    <div className="page-stack">
      <section className="card">
        <h3>Verification Result</h3>
        {pollError ? <ErrorState title="Job Polling Error" body={pollError} /> : null}
        <p>Status: <StatusBadge status={result.status || "pending"} /></p>
        <p>Reason: {result.reason || result.resultMessage || "-"}</p>
        <p>Reason Code: {result.reasonCode || result.resultReasonCode || "-"}</p>
        <p>Document ID: {result.documentId || payload.attempt?.documentId || "-"}</p>
        <p className="inline-note">Decision Basis: {decisionReasonLine}</p>

        <div className="detector-chip-row">
          <DetectorChip label="Text Layer" active={detectors.textLayerChanged} />
          <DetectorChip label="OCR Layer" active={detectors.ocrLayerChanged} />
          <DetectorChip label="Visual Layer" active={detectors.visualLayerChanged} />
        </div>
      </section>

      <section className="card page-stack">
        <h4>Verification Snapshot</h4>
        <div className="verification-stats-grid">
          <MetricBar
            label="Outcome Confidence"
            value={outcomeScore}
            tone={normalizedStatus === "verified" ? "good" : normalizedStatus === "tampered" ? "risk" : "neutral"}
            helper={normalizedStatus ? `Derived from status: ${normalizedStatus}` : "Derived from verification status"}
          />
          <MetricBar
            label="Detector Trigger Rate"
            value={detectorTriggerRate}
            tone={detectorTriggerRate >= 67 ? "risk" : detectorTriggerRate >= 34 ? "warn" : "good"}
            helper={`${detectorHitCount} of 3 detectors triggered`}
          />
          <MetricBar
            label="OCR Change Intensity"
            value={ocrChangeIntensity}
            tone={ocrChangeIntensity >= 60 ? "risk" : ocrChangeIntensity >= 25 ? "warn" : "good"}
            helper={`${ocrChangedWordCount} changed words`}
          />
          <MetricBar
            label="Visual Diff Peak"
            value={visualPeakPercent}
            tone={visualPeakPercent >= 60 ? "risk" : visualPeakPercent >= 25 ? "warn" : "good"}
            helper={visualDiffScoreByPage.length ? `${visualDiffScoreByPage.length} page score entries` : "No visual scores returned"}
          />
        </div>
      </section>

      {result.tamperFindings ? (
        <section className="card">
          <h4>Tamper Findings</h4>
          <p>Changed words: {result.tamperFindings.changedWordCount}</p>
          <p>Changed pages: {(result.tamperFindings.changedPages || []).join(", ") || "None"}</p>
          {changedPagesWithoutBoxes.length ? (
            <p className="inline-note">Visual-only flags: {changedPagesWithoutBoxes.map((page) => `Page ${page} flagged by visual diff`).join("; ")}</p>
          ) : null}
        </section>
      ) : null}

      <section className="card page-stack">
        <h4>Detector Evidence</h4>
        <p>OCR changed words: {ocrDiffSummary.changedWordCount || 0}</p>
        <p>OCR changed pages: {(ocrDiffSummary.changedPages || []).join(", ") || "None"}</p>
        <p>OCR confidence: {formatAsPercent(ocrDiffSummary.confidence, 0)}</p>

        {visualDiffScoreByPage.length ? (
          <div className="detector-score-grid">
            {visualDiffScoreByPage.map((entry) => (
              <article key={entry.pageNumber} className="detector-score-card">
                <strong>Page {entry.pageNumber}</strong>
                <span>{formatAsPercent(entry.score, 1)}</span>
              </article>
            ))}
          </div>
        ) : (
          <p className="inline-note">No visual diff scores were returned for this verification.</p>
        )}
      </section>

      <section className="card">
        <h4>Visual Verification Preview</h4>
        <VerificationVisualPreview
          uploadedFile={uploadedFile}
          rectanglesByPage={result.tamperFindings?.rectanglesByPage || {}}
          flaggedPages={visualFlaggedPages}
          status={result.status}
        />
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

function VerificationVisualPreview({ uploadedFile, rectanglesByPage, flaggedPages = [], status }) {
  const [renderedPages, setRenderedPages] = useState([])
  const [error, setError] = useState("")

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
        const loadingTask = getDocument({ data: buffer })
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
            const shouldWarnRed = visualOnlyPageSet.has(pageNumber) || String(status || "").toLowerCase() === "tampered"

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
        setRenderedPages([])
        setError(renderError.message || "Could not render tamper highlights")
      }
    }

    renderPages()

    return () => {
      active = false
    }
  }, [uploadedFile, rectanglesByPage, flaggedPages, status])

  if (!uploadedFile) {
    return <p className="inline-note">Visual preview appears for upload verification results in the same session. For QR-only verification there is no uploaded file preview.</p>
  }

  if (error) {
    return <ErrorState title="Tamper Overlay Error" body={error} />
  }

  if (!renderedPages.length) {
    return null
  }

  return (
    <div className="page-stack">
      <p className="inline-note">
        {String(status || "").toLowerCase() === "tampered"
          ? "Red overlays show changed regions detected in the uploaded PDF."
          : "Green border indicates no explicit changed regions were highlighted for this result."}
      </p>
      <div className="tamper-preview-grid">
      {renderedPages.map((page) => (
        <article key={page.pageNumber} className="tamper-preview-card">
          <div className="tamper-preview-head">
            <strong>Page {page.pageNumber}</strong>
            <span>{page.visualOnlyFlagged ? "visual diff flagged" : `${page.changedCount} changes`}</span>
          </div>
          {page.visualOnlyFlagged ? <p className="inline-note">Page {page.pageNumber} flagged by visual diff without box geometry.</p> : null}
          <img src={page.imageUrl} alt={`Tamper highlights for page ${page.pageNumber}`} />
        </article>
      ))}
      </div>
    </div>
  )
}

function VerificationActivityPage() {
  const { token } = useAuth()
  const [entries, setEntries] = useState([])
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const response = await api.auditList(token, 100)
        if (!active) return
        setEntries((response.data || []).filter((entry) => entry.action?.includes("VERIFIED")))
      } catch (loadError) {
        if (!active) return
        setError(loadError.message || "Could not load verification activity")
      }
    }

    if (token) load()

    return () => {
      active = false
    }
  }, [token])

  return (
    <section className="card page-stack">
      <h3>Verification Activity</h3>
      {error ? <ErrorState title="Activity Error" body={error} /> : null}
      <ul className="activity-list">
        {entries.map((entry) => (
          <li key={entry.entryId}>
            <div>
              <strong>{entry.action}</strong>
              <small>{formatDate(entry.timestamp)} • {entry.documentId || "-"}</small>
            </div>
            <span>#{entry.sequenceNumber}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function AuditLogPage() {
  const { token } = useAuth()
  const [entries, setEntries] = useState([])
  const [chainResult, setChainResult] = useState(null)
  const [snapshotBusy, setSnapshotBusy] = useState(false)
  const [snapshotError, setSnapshotError] = useState("")
  const [snapshotMessage, setSnapshotMessage] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedEntryId, setSelectedEntryId] = useState("")
  const [entryActionBusy, setEntryActionBusy] = useState(false)
  const [entryActionError, setEntryActionError] = useState("")
  const [entryActionMessage, setEntryActionMessage] = useState("")
  const [selectedQrImage, setSelectedQrImage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const entriesResponse = await api.auditList(token, 100)
        if (!active) return
        setEntries(entriesResponse.data || [])
        setError("")
      } catch (loadError) {
        if (!active) return
        setError(loadError.message || "Could not load audit logs")
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
      const response = await fetch(`${API_BASE_URL}/documents/${selectedEntry.documentId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) {
        throw new Error("Could not download document PDF")
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = window.document.createElement("a")
      anchor.href = url
      anchor.download = `${selectedEntry.documentId}.pdf`
      anchor.click()
      URL.revokeObjectURL(url)
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
        throw new Error("No QR payload available for selected entry")
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
        throw new Error("No QR payload available for selected entry")
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

    if (!normalizedQuery) {
      return true
    }

    return toSearchText(entry).includes(normalizedQuery)
  })
  const uniqueDocumentCount = new Set(entries.map((entry) => entry.documentId).filter(Boolean)).size
  const verificationEventCount = entries.filter((entry) => String(entry.action || "").includes("VERIFIED")).length
  const integrityIssueCount = entries.filter((entry) => String(entry.integrityStatus || "valid") !== "valid").length

  return (
    <section className="card page-stack">
      <div className="section-head">
        <h3>Immutable Audit Ledger</h3>
        <div className="action-row">
          <button className="btn btn-secondary" onClick={verifyChain}>Verify Chain</button>
          <button className="btn btn-primary" onClick={exportSnapshot} disabled={snapshotBusy}>
            {snapshotBusy ? "Exporting..." : "Export Signed Snapshot"}
          </button>
        </div>
      </div>

      <p className="inline-note">Every issuance and verification event is chained by sequence, previous hash, and current hash for traceable evidence.</p>

      <section className="kpi-grid">
        <article className="card kpi-card">
          <p>Total Events</p>
          <h3>{entries.length}</h3>
        </article>
        <article className="card kpi-card">
          <p>Documents Referenced</p>
          <h3>{uniqueDocumentCount}</h3>
        </article>
        <article className="card kpi-card">
          <p>Verification Events</p>
          <h3>{verificationEventCount}</h3>
        </article>
        <article className="card kpi-card">
          <p>Integrity Alerts</p>
          <h3>{integrityIssueCount}</h3>
        </article>
      </section>

      {chainResult ? (
        <div className="card soft">
          <p><strong>Chain Integrity:</strong> {chainResult.isValid ? "Verified" : "Issue detected"}</p>
          <p><strong>Checked entries:</strong> {chainResult.checkedEntries}</p>
          {!chainResult.isValid ? <p><strong>First broken sequence:</strong> {chainResult.firstBrokenSequence || "-"}</p> : null}
        </div>
      ) : null}

      {error ? <ErrorState title="Audit Error" body={error} /> : null}
      {snapshotError ? <ErrorState title="Snapshot Export Error" body={snapshotError} /> : null}
      {snapshotMessage ? <Toast message={snapshotMessage} /> : null}

      <label>
        Search events
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Filter by seq, action, actor, document ID, hash, or payload"
        />
      </label>

      <section className="card soft page-stack">
        <h4>Selected Audit Entry Actions</h4>
        <p className="inline-note">
          {selectedEntry
            ? `Selected #${selectedEntry.sequenceNumber} (${selectedEntry.action})`
            : "Select an audit row below to enable targeted downloads."}
        </p>
        <div className="action-row">
          <button className="btn btn-secondary" onClick={downloadSelectedEntryJson} disabled={!selectedEntry || entryActionBusy}>
            Download Entry JSON
          </button>
          <button className="btn btn-secondary" onClick={downloadSelectedDocumentPdf} disabled={!selectedEntry?.documentId || entryActionBusy}>
            Download Selected PDF
          </button>
          <button className="btn btn-secondary" onClick={downloadSelectedQrJson} disabled={!selectedEntry || entryActionBusy}>
            Download QR JSON
          </button>
          <button className="btn btn-secondary" onClick={downloadSelectedQrPng} disabled={!selectedEntry || entryActionBusy}>
            Download QR PNG
          </button>
        </div>
        {entryActionError ? <ErrorState title="Entry Action Error" body={entryActionError} /> : null}
        {entryActionMessage ? <Toast message={entryActionMessage} /> : null}
        {selectedQrImage ? <img className="qr-image" src={selectedQrImage} alt="Selected entry QR" /> : null}
      </section>

      <table className="data-table">
        <thead>
          <tr>
            <th>Select</th>
            <th>Seq</th>
            <th>Action</th>
            <th>Document</th>
            <th>Actor</th>
            <th>Hash Proof</th>
            <th>Integrity</th>
            <th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {filteredEntries.length ? filteredEntries.map((entry) => (
            <tr
              key={entry.entryId}
              className={entry.entryId === selectedEntryId ? "selected-row" : ""}
              onClick={() => setSelectedEntryId(entry.entryId)}
            >
              <td data-label="Select">
                <input
                  type="radio"
                  name="selected-audit-entry"
                  checked={entry.entryId === selectedEntryId}
                  onChange={() => setSelectedEntryId(entry.entryId)}
                  onClick={(event) => event.stopPropagation()}
                />
              </td>
              <td data-label="Seq">{entry.sequenceNumber}</td>
              <td data-label="Action">{entry.action}</td>
              <td data-label="Document">{entry.documentId || "-"}</td>
              <td data-label="Actor">{entry.actorType || "-"}</td>
              <td data-label="Hash Proof">{shortHash(entry.currentEntryHash)}</td>
              <td data-label="Integrity">{entry.integrityStatus || "valid"}</td>
              <td data-label="Timestamp">{formatDate(entry.timestamp)}</td>
            </tr>
          )) : (
            <tr>
              <td colSpan={8} data-label="Results">No audit entries match your search.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}

function TrustScorePage() {
  const { token, profile } = useAuth()
  const [trust, setTrust] = useState(null)
  const [history, setHistory] = useState([])
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true

    async function load() {
      if (!profile?._id) return

      try {
        const [trustResponse, historyResponse] = await Promise.all([
          api.trustScore(profile._id),
          api.trustHistory(token, profile._id),
        ])

        if (!active) return
        setTrust(trustResponse.data)
        setHistory(historyResponse.data || [])
      } catch (loadError) {
        if (!active) return
        setError(loadError.message || "Could not load trust score")
      }
    }

    load()

    return () => {
      active = false
    }
  }, [profile, token])

  const hasTrustActivity =
    Number(trust?.metrics?.totalVerifications || 0) > 0 ||
    Number(trust?.metrics?.tamperedDetections || 0) > 0 ||
    Number(trust?.metrics?.revokedDocuments || 0) > 0
  const displayScore = hasTrustActivity ? trust?.currentScore ?? "-" : "-"
  const displayBand = hasTrustActivity ? trust?.scoreBand || "-" : "Not Rated"

  return (
    <section className="card page-stack">
      <h3>Trust Score</h3>
      {error ? <ErrorState title="Trust Error" body={error} /> : null}
      <div className="kpi-grid">
        <article className="card kpi-card">
          <p>Current Score</p>
          <h3>{displayScore}</h3>
        </article>
        <article className="card kpi-card">
          <p>Band</p>
          <h3>{displayBand}</h3>
        </article>
      </div>

      <h4>Score History</h4>
      <ul className="activity-list">
        {history.slice().reverse().slice(0, 20).map((item) => (
          <li key={item.eventId}>
            <div>
              <strong>{item.triggerType}</strong>
              <small>{formatDate(item.computedAt)}</small>
            </div>
            <span>{item.newScore}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ProfilePage() {
  const { token, profile, refreshProfile } = useAuth()
  const [form, setForm] = useState({
    displayName: "",
    contactPhone: "",
    institutionName: "",
    institutionType: "",
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
      setMessage("Profile updated")
    } catch (saveError) {
      setError(saveError.message || "Could not update profile")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card page-stack">
      <h3>Institution Profile</h3>

      <label>Display Name<input value={form.displayName} onChange={(event) => setForm((prev) => ({ ...prev, displayName: event.target.value }))} /></label>
      <label>Contact Phone<input value={form.contactPhone} onChange={(event) => setForm((prev) => ({ ...prev, contactPhone: event.target.value }))} /></label>
      <label>Institution Name<input value={form.institutionName} onChange={(event) => setForm((prev) => ({ ...prev, institutionName: event.target.value }))} /></label>
      <label>Institution Type<input value={form.institutionType} onChange={(event) => setForm((prev) => ({ ...prev, institutionType: event.target.value }))} /></label>

      <div className="action-row">
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving..." : "Save Profile"}</button>
      </div>

      {message ? <Toast message={message} /> : null}
      {error ? <ErrorState title="Profile Error" body={error} /> : null}
    </section>
  )
}

function PageLoading() {
  return (
    <section className="card">
      <p>Loading...</p>
    </section>
  )
}

function StatusBadge({ status }) {
  const normalized = String(status || "pending").toLowerCase()
  return <span className={`status-chip ${normalized}`}>{normalized}</span>
}

function EmptyState({ title, body }) {
  return (
    <article className="card soft">
      <h4>{title}</h4>
      <p>{body}</p>
    </article>
  )
}

function ErrorState({ title, body }) {
  return (
    <article className="card soft">
      <h4>{title}</h4>
      <p>{body}</p>
    </article>
  )
}

function Toast({ message }) {
  return <div className="toast success">{message}</div>
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
