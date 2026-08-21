import Link from "next/link";

export default function NotFoundPage() {
  return (
    <div className="error-box">
      <p className="eyebrow">404</p>
      <h1>No encontramos ese registro</h1>
      <p className="subtitle">La entidad o el registro solicitado no existe.</p>
      <Link className="button" href="/">Volver al inicio</Link>
    </div>
  );
}
