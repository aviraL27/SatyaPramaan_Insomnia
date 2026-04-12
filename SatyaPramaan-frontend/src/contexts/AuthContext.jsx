import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth"
import { firebaseAuth, isFirebaseConfigured } from "../lib/firebase"
import { api } from "../lib/api"

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null)
  const [token, setToken] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const refreshProfile = useCallback(async (idToken) => {
    if (!idToken) {
      setProfile(null)
      return null
    }

    const response = await api.authMe(idToken)
    setProfile(response.data)
    return response.data
  }, [])

  useEffect(() => {
    if (!firebaseAuth) {
      setLoading(false)
      return () => {}
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
      setFirebaseUser(user)

      if (!user) {
        setToken(null)
        setProfile(null)
        setLoading(false)
        return
      }

      const idToken = await user.getIdToken()
      setToken(idToken)

      try {
        await refreshProfile(idToken)
      } catch {
        setProfile(null)
      } finally {
        setLoading(false)
      }
    })

    return () => unsubscribe()
  }, [refreshProfile])

  const signIn = useCallback(async ({ email, password }) => {
    if (!firebaseAuth) {
      throw new Error("Firebase web configuration is missing. Set VITE_FIREBASE_* values in frontend env.")
    }

    const credential = await signInWithEmailAndPassword(firebaseAuth, email, password)
    const idToken = await credential.user.getIdToken()
    setToken(idToken)
    await refreshProfile(idToken)
    return credential.user
  }, [refreshProfile])

  const signInWithGoogle = useCallback(
    async ({ bootstrapProfile = {} } = {}) => {
      if (!firebaseAuth) {
        throw new Error("Firebase web configuration is missing. Set VITE_FIREBASE_* values in frontend env.")
      }

      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: "select_account" })

      const credential = await signInWithPopup(firebaseAuth, provider)
      const user = credential.user
      const idToken = await user.getIdToken()
      setToken(idToken)

      try {
        await refreshProfile(idToken)
      } catch (profileError) {
        if (!String(profileError?.message || "").includes("User not found for Firebase identity")) {
          throw profileError
        }

        const emailPrefix = String(user.email || "institution").split("@")[0].replace(/[^a-zA-Z0-9]/g, "") || "institution"

        await api.authBootstrap(idToken, {
          displayName: bootstrapProfile.displayName || user.displayName || emailPrefix,
          role: bootstrapProfile.role || "institution_admin",
          institutionName: bootstrapProfile.institutionName || user.displayName || "Institution",
          institutionCode: bootstrapProfile.institutionCode || emailPrefix.slice(0, 12).toLowerCase(),
          institutionType: bootstrapProfile.institutionType || "other",
          publicIssuerProfile: {
            description: `${bootstrapProfile.institutionName || user.displayName || "Institution"} issuer profile`,
          },
        })

        await refreshProfile(idToken)
      }

      return user
    },
    [refreshProfile]
  )

  const registerInstitution = useCallback(
    async ({ email, password, displayName, role, institutionName, institutionCode, institutionType }) => {
      if (!firebaseAuth) {
        throw new Error("Firebase web configuration is missing. Set VITE_FIREBASE_* values in frontend env.")
      }

      const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password)

      if (displayName) {
        await updateProfile(credential.user, { displayName })
      }

      const idToken = await credential.user.getIdToken()
      setToken(idToken)

      await api.authBootstrap(idToken, {
        displayName,
        role,
        institutionName,
        institutionCode,
        institutionType,
        publicIssuerProfile: {
          description: `${institutionName || displayName} issuer profile`,
        },
      })

      await refreshProfile(idToken)
      return credential.user
    },
    [refreshProfile]
  )

  const bootstrapExistingUser = useCallback(
    async ({ role, displayName, institutionName, institutionCode, institutionType }) => {
      if (!firebaseAuth) {
        throw new Error("Firebase web configuration is missing. Set VITE_FIREBASE_* values in frontend env.")
      }

      if (!firebaseAuth.currentUser) {
        throw new Error("No authenticated Firebase user")
      }

      const idToken = await firebaseAuth.currentUser.getIdToken()
      await api.authBootstrap(idToken, {
        displayName,
        role,
        institutionName,
        institutionCode,
        institutionType,
      })
      await refreshProfile(idToken)
    },
    [refreshProfile]
  )

  const logout = useCallback(async () => {
    if (firebaseAuth) {
      await signOut(firebaseAuth)
    }
    setToken(null)
    setProfile(null)
  }, [])

  const value = useMemo(
    () => ({
      firebaseUser,
      token,
      profile,
      loading,
      isFirebaseConfigured,
      isAuthenticated: Boolean(firebaseUser && token),
      signIn,
      signInWithGoogle,
      registerInstitution,
      bootstrapExistingUser,
      refreshProfile: () => refreshProfile(token),
      logout,
    }),
    [
      firebaseUser,
      token,
      profile,
      loading,
      signIn,
      signInWithGoogle,
      registerInstitution,
      bootstrapExistingUser,
      refreshProfile,
      logout,
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider")
  }

  return context
}
