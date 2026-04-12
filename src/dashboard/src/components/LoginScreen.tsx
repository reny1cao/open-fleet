import { useState } from "react"
import { validateToken, setToken } from "../lib/api"

interface Props {
  onLogin: () => void
}

export function LoginScreen({ onLogin }: Props) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = password.trim()
    if (!trimmed) return

    setLoading(true)
    setError(null)

    const valid = await validateToken(trimmed)
    if (valid) {
      setToken(trimmed)
      onLogin()
    } else {
      setError("Invalid token")
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-xl font-bold">Fleet Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Enter your API token to continue
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              placeholder="API token"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError(null)
              }}
              autoFocus
              autoComplete="current-password"
              className={`w-full px-4 py-2.5 text-sm rounded-lg border bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                error
                  ? "border-red-300 dark:border-red-700"
                  : "border-gray-200 dark:border-slate-700"
              }`}
            />
            {error && (
              <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={!password.trim() || loading}
            className="w-full py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Validating..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  )
}
