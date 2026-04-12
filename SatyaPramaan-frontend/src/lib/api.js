const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api/v1").replace(/\/$/, "")

function buildHeaders({ token, contentType, extraHeaders = {} }) {
  const headers = { ...extraHeaders }

  if (contentType) {
    headers["Content-Type"] = contentType
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

async function handleResponse(response) {
  const contentType = response.headers.get("content-type") || ""
  const isJson = contentType.includes("application/json")
  const payload = isJson ? await response.json() : await response.text()

  if (!response.ok) {
    const message = isJson
      ? payload?.error?.message || payload?.message || "Request failed"
      : String(payload || "Request failed")
    const details = isJson ? payload?.error?.details || null : null
    const error = new Error(message)
    error.status = response.status
    error.details = details
    throw error
  }

  return isJson ? payload : payload
}

export async function apiRequest(path, { method = "GET", token = null, body = null, headers = {} } = {}) {
  const url = `${API_BASE_URL}${path}`
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData

  const response = await fetch(url, {
    method,
    headers: buildHeaders({
      token,
      contentType: isFormData || body == null ? null : "application/json",
      extraHeaders: headers,
    }),
    body: body == null ? undefined : isFormData ? body : JSON.stringify(body),
  })

  return handleResponse(response)
}

export function downloadUrl(path, { token = null, query = {} } = {}) {
  const searchParams = new URLSearchParams(query)

  if (token) {
    searchParams.set("token", token)
  }

  const queryString = searchParams.toString()
  return `${API_BASE_URL}${path}${queryString ? `?${queryString}` : ""}`
}

export const api = {
  health: () => fetch((import.meta.env.VITE_API_ORIGIN || "http://localhost:4000") + "/health").then((res) => res.json()),

  authBootstrap: (token, payload) => apiRequest("/auth/bootstrap", { method: "POST", token, body: payload }),
  authMe: (token) => apiRequest("/auth/me", { token }),
  authUpdateMe: (token, payload) => apiRequest("/auth/me", { method: "PATCH", token, body: payload }),

  institutionProfile: (token) => apiRequest("/institutions/profile", { token }),
  institutionUpdateProfile: (token, payload) => apiRequest("/institutions/profile", { method: "PATCH", token, body: payload }),

  issueDocument: (token, formData) => apiRequest("/documents/issue", { method: "POST", token, body: formData }),

  listDocuments: (token) => apiRequest("/documents", { token }),
  getDocument: (token, documentId) => apiRequest(`/documents/${documentId}`, { token }),
  revokeDocument: (token, documentId, reason) =>
    apiRequest(`/documents/${documentId}/revoke`, { method: "POST", token, body: { reason } }),
  replaceDocument: (token, documentId, formData) =>
    apiRequest(`/documents/${documentId}/replace`, { method: "POST", token, body: formData }),
  documentVersions: (token, documentId) => apiRequest(`/documents/${documentId}/versions`, { token }),

  verifyQrPublic: (payload) => apiRequest("/public/verify/qr", { method: "POST", body: payload }),
  verifyUploadPublic: (formData) => apiRequest("/public/verify/upload", { method: "POST", body: formData }),
  verifyUploadAuth: (token, formData) => apiRequest("/verify/upload", { method: "POST", token, body: formData }),
  verificationJob: (jobId, { token = null, resultToken = null } = {}) =>
    apiRequest(`/verify/jobs/${jobId}${resultToken ? `?resultToken=${encodeURIComponent(resultToken)}` : ""}`, {
      token,
      method: "GET",
    }),
  verificationAttempt: (attemptId, { token = null, resultToken = null } = {}) =>
    apiRequest(`/verify/attempts/${attemptId}${resultToken ? `?resultToken=${encodeURIComponent(resultToken)}` : ""}`, {
      token,
      method: "GET",
    }),

  trustScore: (issuerUserId) => apiRequest(`/trust/${issuerUserId}`),
  trustHistory: (token, issuerUserId) => apiRequest(`/trust/${issuerUserId}/history`, { token }),

  auditList: (token, limit = 50) => apiRequest(`/audit?limit=${limit}`, { token }),
  auditEntry: (token, entryId) => apiRequest(`/audit/${entryId}`, { token }),
  auditVerifyChain: (token) => apiRequest("/audit/verify-chain", { method: "POST", token, body: {} }),
  auditAnchorStatus: (token) => apiRequest("/audit/anchor-status", { token }),
  auditAnchor: (token) => apiRequest("/audit/anchor", { method: "POST", token, body: {} }),
  auditAnchors: (token, limit = 20) => apiRequest(`/audit/anchors?limit=${limit}`, { token }),
  auditExportSnapshot: (token) => apiRequest("/audit/snapshot/export", { method: "POST", token, body: {} }),
  auditByDocument: (token, documentId, limit = 50) => apiRequest(`/audit/document/${documentId}?limit=${limit}`, { token }),
}

export { API_BASE_URL }
