import type { UIMessage } from "ai";
import { sql, transactionSql, withTransaction } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAiConversationId(value: string) {
  return UUID.test(value);
}

export type AiConversation = {
  id: string;
  title: string;
  modelId: string;
  createdAt: Date;
  updatedAt: Date;
};

type ConversationRow = {
  id: string;
  title: string;
  model_id: string;
  created_at: Date;
  updated_at: Date;
};

function toConversation(row: ConversationRow): AiConversation {
  return {
    id: row.id,
    title: row.title,
    modelId: row.model_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listAiConversations(userId: string) {
  const rows = await sql<ConversationRow>(
    `SELECT id, title, model_id, created_at, updated_at
       FROM ai_conversation
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT 40`,
    [userId],
  );
  return rows.map(toConversation);
}

export async function createAiConversation(userId: string, modelId: string) {
  const rows = await sql<ConversationRow>(
    `INSERT INTO ai_conversation (user_id, model_id)
     VALUES ($1, $2)
     RETURNING id, title, model_id, created_at, updated_at`,
    [userId, modelId],
  );
  return toConversation(rows[0]);
}

export async function getAiConversation(userId: string, conversationId: string) {
  const rows = await sql<ConversationRow>(
    `SELECT id, title, model_id, created_at, updated_at
       FROM ai_conversation
      WHERE id = $1 AND user_id = $2
      LIMIT 1`,
    [conversationId, userId],
  );
  return rows[0] ? toConversation(rows[0]) : null;
}

export async function loadAiMessages(userId: string, conversationId: string): Promise<UIMessage[]> {
  const rows = await sql<{ content: UIMessage }>(
    `SELECT message.content
       FROM ai_message AS message
       JOIN ai_conversation AS conversation ON conversation.id = message.conversation_id
      WHERE message.conversation_id = $1 AND conversation.user_id = $2
      ORDER BY message.position ASC
      LIMIT 120`,
    [conversationId, userId],
  );
  return rows.map((row) => row.content);
}

function conversationTitle(messages: UIMessage[]) {
  const firstUser = messages.find((message) => message.role === "user");
  const text = firstUser?.parts
    .filter((part): part is Extract<(typeof firstUser.parts)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > 64 ? `${text.slice(0, 61)}…` : text;
}

export async function saveAiMessages(userId: string, conversationId: string, messages: UIMessage[]) {
  if (messages.length > 120) throw new Error("La conversación alcanzó el límite de 120 mensajes.");
  await withTransaction(async (client) => {
    const owned = await transactionSql<{ title: string }>(
      client,
      `SELECT title FROM ai_conversation WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [conversationId, userId],
    );
    if (!owned[0]) throw new Error("Conversación inexistente o no autorizada.");
    await transactionSql(client, `DELETE FROM ai_message WHERE conversation_id = $1`, [conversationId]);
    for (const [position, message] of messages.entries()) {
      await transactionSql(
        client,
        `INSERT INTO ai_message (conversation_id, message_id, position, role, content)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [conversationId, message.id, position, message.role, JSON.stringify(message)],
      );
    }
    const title = owned[0].title === "Nueva conversación" ? conversationTitle(messages) : null;
    await transactionSql(
      client,
      `UPDATE ai_conversation
          SET title = COALESCE($3, title), updated_at = now()
        WHERE id = $1 AND user_id = $2`,
      [conversationId, userId, title],
    );
  });
}

export async function createAiRun(userId: string, conversationId: string, modelId: string) {
  const providerKey = modelId.split("/")[0] ?? "unknown";
  const rows = await sql<{ id: string }>(
    `INSERT INTO ai_run (conversation_id, user_id, provider_key, model_id, status)
     VALUES ($1, $2, $3, $4, 'running')
     RETURNING id`,
    [conversationId, userId, providerKey, modelId],
  );
  return rows[0].id;
}

export type AiToolCallAudit = {
  id: string;
  name: string;
  input: unknown;
};

export async function recordAiRunStep(
  runId: string,
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number },
  toolCalls: AiToolCallAudit[],
) {
  await withTransaction(async (client) => {
    await transactionSql(
      client,
      `UPDATE ai_run
          SET input_tokens = input_tokens + $2,
              output_tokens = output_tokens + $3,
              total_tokens = total_tokens + $4
        WHERE id = $1 AND status = 'running'`,
      [runId, usage.inputTokens ?? 0, usage.outputTokens ?? 0, usage.totalTokens ?? 0],
    );
    for (const call of toolCalls) {
      const boundedInput = JSON.stringify(call.input ?? {}).slice(0, 12_000);
      await transactionSql(
        client,
        `INSERT INTO ai_tool_call (run_id, tool_call_id, tool_name, input)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (run_id, tool_call_id) DO NOTHING`,
        [runId, call.id, call.name, boundedInput],
      );
    }
  });
}

export async function completeAiRun(runId: string, aborted: boolean) {
  await sql(
    `UPDATE ai_run
        SET status = $2, finished_at = now()
      WHERE id = $1 AND status = 'running'`,
    [runId, aborted ? "aborted" : "completed"],
  );
}

export async function failAiRun(runId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await sql(
    `UPDATE ai_run
        SET status = 'failed', error_message = $2, finished_at = now()
      WHERE id = $1 AND status = 'running'`,
    [runId, message.slice(0, 1_500)],
  );
}
