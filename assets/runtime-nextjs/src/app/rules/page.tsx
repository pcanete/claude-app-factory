import { requireRulesAccess } from "@/lib/auth";
import { ruleEventLabels } from "@/lib/rules";
import { requireEntity, runtimeSpec } from "@/lib/spec";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  await requireRulesAccess();
  const rules = runtimeSpec.rules ?? [];
  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Núcleo determinista</p>
          <h1>Reglas</h1>
          <p className="subtitle">Condiciones y acciones declaradas en AppSpec. Se ejecutan en el servidor antes de guardar y no realizan efectos externos.</p>
        </div>
      </div>
      {rules.length ? (
        <div className="rules-list">
          {rules.map((rule) => {
            const entity = requireEntity(rule.when.entity);
            return (
              <article className={`rule-card ${rule.enabled === false ? "disabled" : ""}`} key={rule.key}>
                <div className="rule-card-header">
                  <div>
                    <div className="rule-meta"><span>{entity.label}</span><span>{ruleEventLabels[rule.when.event]}</span><span>Prioridad {rule.priority ?? 100}</span></div>
                    <h2>{rule.label}</h2>
                    {rule.description && <p className="subtitle">{rule.description}</p>}
                  </div>
                  <span className={`rule-status ${rule.enabled === false ? "off" : "on"}`}>{rule.enabled === false ? "Inactiva" : "Activa"}</span>
                </div>
                <div className="rule-actions">
                  {rule.then.map((action, index) => action.action === "set" ? (
                    <span className="rule-action set" key={index}>Asignar {action.field}</span>
                  ) : (
                    <span className="rule-action block" key={index}>Bloquear operación</span>
                  ))}
                </div>
                <details>
                  <summary>Ver definición</summary>
                  <pre className="audit-json rule-json">{JSON.stringify({ if: rule.if, then: rule.then }, null, 2)}</pre>
                </details>
              </article>
            );
          })}
        </div>
      ) : <div className="empty">No hay reglas declaradas. El núcleo no inventa comportamiento de negocio.</div>}
      <div className="notice warning">Aprobaciones, tareas programadas, correo, webhooks, integraciones e IA pertenecen a extensiones específicas del cliente.</div>
    </>
  );
}
