"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ApplicationAssistantMessage } from "@/features/ai/agent";

type ToolState = ApplicationAssistantMessage["parts"][number] extends { state: infer STATE }
  ? STATE
  : string;

function toolStateLabel(state: ToolState) {
  if (state === "output-available") return "Consulta completada";
  if (state === "output-error") return "La consulta falló";
  if (state === "input-streaming") return "Preparando consulta…";
  return "Consultando datos…";
}

function AssistantMessageParts({ message }: { message: ApplicationAssistantMessage }) {
  return message.parts.map((part, index) => {
    const key = `${message.id}-${index}`;
    if (part.type === "text") return <div className="assistant-text" key={key}>{part.text}</div>;

    if (part.type === "tool-countRecords") {
      return (
        <div className="assistant-tool" key={key}>
          <span>Contar registros</span>
          <strong>{part.state === "output-available" ? `${part.output.count} ${part.output.label}` : toolStateLabel(part.state)}</strong>
        </div>
      );
    }

    if (part.type === "tool-searchRecords") {
      return (
        <div className="assistant-tool" key={key}>
          <span>Buscar registros</span>
          {part.state === "output-available" ? (
            <div className="assistant-sources">
              {part.output.records.length ? part.output.records.map((record) => (
                <Link href={record.href} key={record.id}>{record.label}</Link>
              )) : <small>Sin resultados</small>}
            </div>
          ) : <strong>{toolStateLabel(part.state)}</strong>}
        </div>
      );
    }

    if (part.type === "tool-getRecord") {
      return (
        <div className="assistant-tool" key={key}>
          <span>Abrir registro</span>
          {part.state === "output-available" ? (
            part.output.found
              ? <Link href={part.output.record.href}>{part.output.record.label}</Link>
              : <strong>Registro no encontrado</strong>
          ) : <strong>{toolStateLabel(part.state)}</strong>}
        </div>
      );
    }

    if (part.type === "tool-listEntities") {
      return (
        <div className="assistant-tool" key={key}>
          <span>Revisar estructura</span>
          <strong>{part.state === "output-available" ? `${part.output.entities.length} entidades disponibles` : toolStateLabel(part.state)}</strong>
        </div>
      );
    }

    return null;
  });
}

const SUGGESTIONS = [
  "¿Qué entidades y campos puedo consultar?",
  "Resumí los registros actualizados recientemente.",
  "¿Cuántos registros hay en cada entidad disponible?",
];

export function ApplicationAssistantChat({
  configured,
  conversationId,
  initialMessages,
}: {
  configured: boolean;
  conversationId: string;
  initialMessages: ApplicationAssistantMessage[];
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const transport = useMemo(
    () => new DefaultChatTransport<ApplicationAssistantMessage>({
      api: "/api/assistant",
      prepareSendMessagesRequest({ id, messages }) {
        return { body: { id, message: messages[messages.length - 1] } };
      },
    }),
    [],
  );
  const { messages, sendMessage, status, error, clearError, stop } = useChat<ApplicationAssistantMessage>({
    id: conversationId,
    messages: initialMessages,
    transport,
    onFinish: () => router.refresh(),
  });
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  function send(text: string) {
    const value = text.trim();
    if (!value || busy || !configured) return;
    clearError();
    void sendMessage({ text: value });
    setInput("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(input);
  }

  return (
    <section className="assistant-chat" aria-label="Conversación con el asistente">
      <div className="assistant-messages" aria-live="polite">
        {messages.length === 0 ? (
          <div className="assistant-welcome">
            <div className="assistant-orb" aria-hidden="true">✦</div>
            <h2>¿Qué querés saber?</h2>
            <p className="subtitle">Puedo consultar entidades y registros dentro de los permisos de tu rol.</p>
            <div className="assistant-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button disabled={!configured} key={suggestion} onClick={() => send(suggestion)} type="button">
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : messages.map((message) => (
          <article className={`assistant-message ${message.role}`} key={message.id}>
            <div className="assistant-message-role">{message.role === "user" ? "Vos" : "Asistente"}</div>
            <div className="assistant-message-body"><AssistantMessageParts message={message} /></div>
          </article>
        ))}
        {busy && <div className="assistant-thinking">Analizando y consultando datos…</div>}
        {error && <div className="notice import-error assistant-error">{error.message}</div>}
        <div ref={endRef} />
      </div>
      <form className="assistant-composer" onSubmit={handleSubmit}>
        <textarea
          aria-label="Mensaje"
          className="control"
          disabled={!configured || busy}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(input);
            }
          }}
          placeholder={configured ? "Preguntá sobre los datos de la aplicación…" : "Configurá el proveedor de IA para comenzar"}
          rows={3}
          value={input}
        />
        <div className="assistant-composer-footer">
          <small>Solo lectura · Máximo 25 registros por consulta</small>
          {busy ? (
            <button className="button secondary" onClick={stop} type="button">Detener</button>
          ) : (
            <button className="button" disabled={!configured || !input.trim()} type="submit">Enviar</button>
          )}
        </div>
      </form>
    </section>
  );
}
