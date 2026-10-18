'use client';
export default function Error({ reset }: { error: Error; reset: () => void }) { return <div className="auth-screen"><div className="auth-card"><h1>Something went wrong.</h1><p>Your saved data is still in the database.</p><button onClick={reset}>Try again</button></div></div>; }
