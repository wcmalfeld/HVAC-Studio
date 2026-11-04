"use client";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui", padding: 40 }}>
        <h1 style={{ fontSize: 18 }}>HVAC Studio hit an unexpected error</h1>
        <p style={{ color: "#6f7c87", fontSize: 13 }}>{error.message}</p>
        <button onClick={reset} style={{ marginTop: 12 }}>
          Reload view
        </button>
      </body>
    </html>
  );
}
