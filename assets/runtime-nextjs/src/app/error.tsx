"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="error-box">
      <p className="eyebrow">Error del runtime</p>
      <h1>No pudimos mostrar esta pantalla</h1>
      <p className="subtitle">{error.message}</p>
      <button className="button" onClick={reset} type="button">Reintentar</button>
    </div>
  );
}
